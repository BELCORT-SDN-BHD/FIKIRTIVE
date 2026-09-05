/**
 * runtime.ts — the OTTO composition root (engine spec §6.2, WO-OTTO-PHASE1 · Phase 1).
 *
 * A BEHAVIOR-PRESERVING seam, not a rewrite: the production entries (fresh
 * non-stream ottoTurn, stream route, approval-resume ottoApprove) all converge on
 * the SAME application runner (`runOttoTurn`)
 * and finalizer projection (`finalizeOttoTurn`), and every billing-relevant value —
 * model binding, billable model id, resolved model policy, usage mapper, cache
 * capabilities, pricing, and the `withLlmBudget` parameters — derives from ONE
 * atomic `OttoModelRuntime` manifest instead of per-entry constants.
 *
 * Composition rules (spec §6.2, enforced by construction + runtime.test.ts):
 *  - A runtime is injected ONLY at process composition/bootstrap by server-owned
 *    code (`createOttoRuntime(deps, profile)`) and is frozen for the process
 *    lifetime. There is NO env / header / cookie / query / body channel that can
 *    select a runtime or change the billable model — `createOttoRuntime` reads no
 *    ambient state at all.
 *  - The production artifact composes exactly one model runtime: the Anthropic
 *    manifest in model.ts (`ottoModelRuntime`). A fixture/CLI runtime is a SEPARATE
 *    test composition; its manifest must declare `billableModelId:
 *    "fixture-no-charge"`, which is the one and only way the runner derives
 *    `paid: false` (withLlmBudget's zero-metering path).
 *  - A profile ONLY limits tools/steps. It never duplicates billing, state, or
 *    receipt logic: every profile carries the full skill toolset at OTTO_MAX_STEPS.
 *    (#791-4 removed the tool-less `worker-verdict` profile along with the automatic
 *    post-generation Review round it existed for.)
 *  - production composition never imports a CLI model driver; subscription credentials
 *    must not enter the service image.
 */
import { Agent, run, MaxTurnsExceededError } from "@openai/agents";
import type { AgentInputItem, Model, RunStreamEvent, RunState } from "@openai/agents";
import { OTTO_MAX_STEPS, OTTO_OUTPUT_CAP_TOKENS, OTTO_CONVERSATION_TURN_MARGIN, OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, OTTO_CHAT_MIN_START_INTERNAL, OTTO_CHAT_MAX_SEARCHES_PER_TURN, searchChargeInternal, searchUnitChargeInternal } from "@fikirtive/core";
import type { LlmPrices } from "@fikirtive/core";
import type { OttoContext } from "./context.js";
import type { OttoSkill } from "./skill.js";
import { ottoInstructions } from "./instructions.js";
import { withLlmBudget, type TokenUsage } from "./meter.js";
import { collectApprovalInterruptions, type ApprovalInterruption } from "./approval-tools.js";
import { extractText } from "./run-output.js";

// ─────────────────────────────────────────────────────────────────────────────
// §6.2 types
// ─────────────────────────────────────────────────────────────────────────────

/** The run profiles. A profile only limits tools/steps (see createOttoRuntime). */
export type OttoRunProfile = "interactive" | "approval-resume" | "eval";

/** The SDK-level model object an Agent binds to (production: the aisdk-adapted
 *  Anthropic model in model.ts; simulator: a fixture/qualified-CLI Model). */
export type ModelBinding = Model;

/** The deterministic model policy the binding implements — documentation-grade
 *  facts frozen next to the binding so they can never drift apart silently. */
export type ResolvedModelPolicy = {
  readonly primaryModelId: string;
  readonly fallbackModelId: string | null;
  /** "same-tier-529-only": structured 529 overload → same-tier sibling (model.ts).
   *  "none": no failover (fixture compositions). */
  readonly failover: "same-tier-529-only" | "none";
};

/** Maps an SDK run-usage object to withLlmBudget's TokenUsage (production: mapOttoUsage). */
export type UsageMapper = (usage: {
  inputTokens: number;
  outputTokens: number;
  requestUsageEntries?: Array<{
    inputTokens: number;
    outputTokens: number;
    inputTokensDetails: Record<string, number>;
  }>;
}) => TokenUsage;

/** What the binding's prompt-cache layer does (production: the ephemeral prefix
 *  marking in model.ts, kill switch OTTO_PROMPT_CACHE). Pricing for cache read/write
 *  tiers lives in PricingLookup — the SAME manifest, atomically. */
export type CacheCapabilities = {
  readonly promptCache: boolean;
};

/** Credit price lookup for a billable model id (production: llmPricesFor — ENGINE-A5(①段):
 *  一个不在价目表里的型号 THROWS。猜价(子串匹配 → sonnet 兜底)已经删掉,所以这里再没有
 *  「查不到也能收钱」的那条路。 */
export type PricingLookup = (modelId: string) => LlmPrices;

/**
 * The atomic model-runtime manifest: model binding, billable model, usage mapping,
 * cache capabilities and pricing travel as ONE frozen value. No entry may hold an
 * independent model/price constant (PH1-A1).
 */
export type OttoModelRuntime = {
  readonly binding: ModelBinding;
  readonly billableModelId: string | "fixture-no-charge";
  readonly resolvedModelPolicy: ResolvedModelPolicy;
  readonly mapUsage: UsageMapper;
  readonly cacheCapabilities: CacheCapabilities;
  readonly pricing: PricingLookup;
};

/** Everything a composition root injects. Server-owned code only. */
export type OttoRuntimeDeps = {
  readonly modelRuntime: OttoModelRuntime;
  readonly skills: readonly OttoSkill[];
};

/** A composed, frozen runtime: the agent (profile-limited tools), the step cap,
 *  and the manifest every billing parameter derives from. */
export type OttoRuntime = {
  readonly profile: OttoRunProfile;
  readonly modelRuntime: OttoModelRuntime;
  readonly agent: Agent<OttoContext>;
  /** The profile's step cap — BOTH the run() maxTurns AND the reserve maxSteps,
   *  so the reserve is always priced for exactly the steps the run may take. */
  readonly maxTurns: number;
  /** ENGINE-A2 — the composed action names, frozen at composition time from the SAME
   *  `deps.skills` the agent's tools come from (registry.ts is the one registry). It is the
   *  WHITELIST the turn trace folds tool names through: a name that is not in here can never
   *  reach the trace row, so no model-authored string can ride in on that field. */
  readonly actionNames: ReadonlySet<string>;
  /** ENGINE-A4 — the subset of `actionNames` that can LEAVE SOMETHING BEHIND: every composed
   *  skill declared `effect: "write"` (registry.ts). A call to one of these can be a canvas
   *  node, a saved product, a written message artifact; a call to anything else is a READ,
   *  which hands the merchant nothing they still have after the turn dies. Derived from the
   *  SAME `deps.skills` as `actionNames`, so the two can never drift.
   *
   *  这份名单是**包装名单**,不是判词:一个名字在这里,只说明它那把工具被
   *  `countingDeliveryTool` 包了一层;这一轮到底落没落盘,由那一层当场记的账说了算。 */
  readonly deliveringActionNames: ReadonlySet<string>;
};

/**
 * Execution primitives used by the shared application runner. Production callers
 * pass the package exports they already use; keeping this tiny seam explicit lets
 * existing entry tests replace the SDK runner/meter without replacing the runtime
 * manifest. It is server-owned code, never request/client data.
 */
export type OttoRuntimeExecution = {
  readonly runAgent: typeof run;
  readonly meter: typeof withLlmBudget;
  readonly maxTurnsExceededError?: typeof MaxTurnsExceededError;
};

const defaultRuntimeExecution: OttoRuntimeExecution = Object.freeze({
  runAgent: run,
  meter: withLlmBudget,
});

// ─────────────────────────────────────────────────────────────────────────────
// createOttoRuntime — composition root factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compose one immutable runtime from deps + profile. Reads NO ambient state (no
 * env, no request): the caller — a process composition root — decides everything.
 *
 * Profile → tools/steps (the ONLY thing a profile changes):
 *  - interactive / approval-resume / eval: full deps.skills toolset, OTTO_MAX_STEPS.
 *    (approval-resume carries the full set per the frozen B9 recovery rule —
 *    恢复轮全量装载; eval mirrors the production budget, spec §13.3.)
 */
export function createOttoRuntime(deps: OttoRuntimeDeps, profile: OttoRunProfile): OttoRuntime {
  // ENGINE-A4: one filter, used twice — 决定给谁包一层,以及对外公布的那份名单。`effect` 是
  // 每个技能自己声明的字段(skill.ts),所以这不是第二份手抄名册,新技能也不会被漏掉。
  const delivering = new Set(deps.skills.filter((s) => s.effect === "write").map((s) => s.name));
  const agent = new Agent<OttoContext>({
    name: "Otto",
    instructions: ottoInstructions,
    model: deps.modelRuntime.binding,
    modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
    // ENGINE-A4:写技能多包一层,好在它**真的落盘**的那一刻记一笔(countingDeliveryTool)。
    // 为什么不能事后从 SDK 的 state 上数出来,见那个函数的注释:「跑完了」与「落盘了」在
    // state 上长得一模一样。
    tools: deps.skills.map((s) => (delivering.has(s.name) ? countingDeliveryTool(s.tool) : s.tool)),
  });
  return Object.freeze({
    profile,
    modelRuntime: deps.modelRuntime,
    agent,
    maxTurns: OTTO_MAX_STEPS,
    // ENGINE-A2: the trace's action whitelist, derived from the very same list the tools are
    // built from — one registry, so the two can never drift into "traced but not composed".
    actionNames: Object.freeze(new Set(deps.skills.map((s) => s.name))) as ReadonlySet<string>,
    // ENGINE-A4: the very set the tools above were wrapped from — one filter, no second copy.
    deliveringActionNames: Object.freeze(delivering) as ReadonlySet<string>,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// runOttoTurn — the shared application runner
// ─────────────────────────────────────────────────────────────────────────────

/** What an entry passes the shared runner. Identity (orgId) and the reservation
 *  refId stay caller-owned — they come from the verified session/job, never from
 *  the model or the manifest. */
export type OttoTurnRequest = {
  readonly orgId: string;
  readonly refId: string;
  /** Fresh input items (or a plain string), or a restored RunState (approval-resume). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors run()'s own RunState<any, Agent<any, any>> input constraint
  readonly input: string | AgentInputItem[] | RunState<any, any>;
  /** stream:true runs the SDK in streaming mode; onStream drains the event stream
   *  (the runner itself awaits completion before settlement — usage is only known
   *  after the stream is fully drained). */
  readonly stream?: boolean;
  readonly onStream?: (stream: AsyncIterable<RunStreamEvent>) => Promise<void> | void;
  /** ENGINE-A2 — where this turn's structural facts go. Optional: a caller that passes no
   *  sink is byte-identical to before (no read, no write, no extra await). */
  readonly trace?: OttoTurnTracePort;
  /** ENGINE-A6 — the turns this entry trimmed off the history, and where their summary goes.
   *  Optional: a caller that passes none is byte-identical to before (no model call, no write). */
  readonly rollingSummary?: OttoRollingSummaryPort;
};

/** Structural view of a RunResult/StreamedRunResult that the finalizer consumes. */
export type OttoTurnRunResult = {
  state: { toString(): string; usage: Parameters<UsageMapper>[0] };
  interruptions?: unknown[];
};

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE-A2 — the per-turn debug trace (spec §7.2②)
// ─────────────────────────────────────────────────────────────────────────────

/** Which door this turn came through. A CLOSED set, mirrored verbatim by the
 *  `OttoTurnTrace.surface` column's comment in schema.prisma. */
export type OttoTraceSurface = "stream" | "action" | "approve-resume" | "worker-research";

/** The fold of one action across this turn: its NAME and three COUNTS. Nothing else —
 *  no arguments, no return value, no error message. */
export type OttoTraceToolCall = {
  readonly name: string;
  /** how many times the model asked for it */
  readonly calls: number;
  /** results that came back `completed` */
  readonly ok: number;
  /** results that came back anything else (`incomplete`) */
  readonly failed: number;
};

/**
 * The WHITELISTED, content-free facts one turn produces — the whole payload the sink may
 * persist (spec §7.2②「不记商家内容的机器保证」).
 *
 * The guarantee is STRUCTURAL, not a convention: this type has **no free-text field**. Every
 * string on it comes from a closed source —
 *   · `name`      → folded through `runtime.actionNames` (registry.ts); anything else becomes
 *                   the fixed literal UNREGISTERED_ACTION, so a model-authored tool name has
 *                   nowhere to land;
 *   · `surface`   → the caller's literal union above;
 *   · `modelId`   → the frozen manifest's billableModelId;
 *   · `skillFiles`→ the knowledge-cabinet listing (empty until §7.2⑥ builds the cabinet).
 * A prompt, a message body, or a tool argument cannot be represented here at all. The fence
 * test that pins this is runtime-turn-trace.test.ts.
 */
export type OttoTurnTraceFacts = {
  readonly refId: string;
  readonly orgId: string;
  readonly threadId: string | null;
  readonly surface: OttoTraceSurface;
  readonly modelId: string;
  readonly steps: number;
  readonly toolCalls: readonly OttoTraceToolCall[];
  readonly skillFiles: readonly string[];
  readonly truncated: boolean;
};

/** The injected persistence port. The engine package never touches prisma — each entry
 *  supplies its own writer, exactly like every other port on `ctx`. */
export type OttoTurnTraceSink = (facts: OttoTurnTraceFacts) => void | Promise<void>;

/** What an entry hands the runner: the caller-owned identity bits the engine cannot know,
 *  plus the sink. `threadId` is caller-owned for the same reason `orgId` is — it comes from
 *  the verified session, never from the model. */
export type OttoTurnTracePort = {
  readonly surface: OttoTraceSurface;
  readonly threadId?: string | null;
  readonly sink: OttoTurnTraceSink;
};

/** Where a tool name lands when it is not in the composed registry. A fixed literal, never
 *  the observed string — that is the whole point of the fold. */
export const UNREGISTERED_ACTION = "(unregistered)";

/** ⑥段(技能文件柜)之前恒为空数组 — spec §7.2②. There is no cabinet to list yet, so the
 *  column is honestly empty rather than filled with a guess. */
const NO_SKILL_FILES: readonly string[] = Object.freeze([]);

type ObservedRunState = {
  _currentTurn?: unknown;
  _generatedItems?: unknown;
};

/** `RunItem`s the SDK keeps on the state. Read structurally (never cast) so a shape change
 *  in the SDK degrades to "fewer facts", never to a crash inside a paid turn. */
function generatedItemsOf(state: unknown): unknown[] {
  const items = (state as ObservedRunState | null | undefined)?._generatedItems;
  return Array.isArray(items) ? items : [];
}

function rawItemOf(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object") return null;
  const raw = (item as { rawItem?: unknown }).rawItem;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

/**
 * Fold one finished/truncated run into the trace facts.
 *
 * Exported for the fence test, which feeds it a state stuffed with prompts, message bodies and
 * tool arguments and asserts that none of them appear anywhere in the output.
 */
export function collectTurnTraceFacts(
  state: unknown,
  runtime: Pick<OttoRuntime, "modelRuntime" | "actionNames">,
  port: OttoTurnTracePort,
  identity: Pick<OttoTurnRequest, "orgId" | "refId">,
  truncated: boolean,
): OttoTurnTraceFacts {
  const steps = (state as ObservedRunState | null | undefined)?._currentTurn;
  // The fold key is the WHITELISTED name, so two different unregistered names collapse into
  // one `(unregistered)` row instead of each smuggling its own string through.
  const byName = new Map<string, { calls: number; ok: number; failed: number }>();
  const bucket = (rawName: unknown) => {
    const name =
      typeof rawName === "string" && runtime.actionNames.has(rawName) ? rawName : UNREGISTERED_ACTION;
    let entry = byName.get(name);
    if (!entry) {
      entry = { calls: 0, ok: 0, failed: 0 };
      byName.set(name, entry);
    }
    return entry;
  };

  for (const item of generatedItemsOf(state)) {
    const type = (item as { type?: unknown }).type;
    const raw = rawItemOf(item);
    if (!raw) continue;
    if (type === "tool_call_item" && raw.type === "function_call") {
      bucket(raw.name).calls += 1;
      continue;
    }
    if (type === "tool_call_output_item" && raw.type === "function_call_result") {
      const entry = bucket(raw.name);
      if (raw.status === "completed") entry.ok += 1;
      else entry.failed += 1;
    }
  }

  return {
    refId: identity.refId,
    orgId: identity.orgId,
    threadId: port.threadId ?? null,
    surface: port.surface,
    modelId: runtime.modelRuntime.billableModelId,
    steps: typeof steps === "number" && Number.isFinite(steps) ? steps : 0,
    toolCalls: [...byName].map(([name, counts]) => ({ name, ...counts })),
    skillFiles: NO_SKILL_FILES,
    truncated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE-A4 — 这一轮交付了什么(spec §7.2⑤)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The COUNTER §7.2⑤ asks for: how many deliverables THIS turn left behind.
 *
 * 「交付」的口径是**结构性**的,不是读文本 —— 没有任何一处去看模型说了什么:
 *   · `cards`  = 铸出的卡片:**这一轮新**停在审批位上的调用。商家屏幕上就是一张等他确认的卡。
 *   · `writes` = 落盘的产物:**这一轮真的写成了**的写动作(画布节点、保存的产品、记下的品牌
 *                事实……),由包在写技能外面的 `countingDeliveryTool` 当场记账。
 *
 * 一次成功的**读**(查产品、搜网页、看排期)不算交付:轮子死了之后商家手里什么都没多。
 * 这正是本段与钱的接缝 —— 搜索腿也跟着整笔退(§7.2⑤「搜索腿一并退」),而一轮只搜不写的
 * 截断轮,按这个口径就是零交付。
 */
export type OttoTurnDelivery = {
  readonly cards: number;
  readonly writes: number;
};

/** 这一轮的落盘记账本。键是**这一轮自己的 `OttoContext` 对象** —— 每个请求现造一个,和
 *  `ctx.research.searchSlots` 是同一种「随 run 走的计数器」(§7.2⑤ 的原话就是「由 runOttoTurn
 *  侧的计数器给出」)。并行的两轮因此互不串账,ctx 被回收时这条记录跟着走。用 WeakMap 而不是
 *  往 ctx 上加一个字段,只是因为 `context.ts` 不在本段写集里(§7.5 表 A);记在哪里不改口径。 */
const turnDeliveryTallies = new WeakMap<object, { writes: number }>();

/**
 * 「跑完了」≠「落盘了」——这一条是本段全部机关的由来。
 *
 * SDK 对 function tool 的结果**一律**写 `status: "completed"`(`@openai/agents-core` 的
 * `getToolCallOutputItem`,两条返回路径都是写死的 'completed'),而我们的写技能失败有三种
 * 长相,三种都躲在那面「completed」的牌子后面:
 *   ① `execute` 抛错 —— `tool()` 我们没传 `errorFunction`,SDK 的 `defaultToolErrorFunction`
 *      把错误折成**一句普通文本**当作返回值(skill.ts:191-193 的注释原话就是这件事);
 *   ② `requires` 闸拦下 —— 返回 `{ needMoreInfo: [...] }`(skill.ts);
 *   ③ 技能自己拒绝 —— 返回 `{ ok: false, error: … }`(manage-canvas.ts 一连串就是这个,也正是
 *      「Otto 拿错参数反复重试直到跑满步数」那条最典型的死胡同)。
 *
 * 所以「有没有落盘」只能在**工具返回值**这一层判,而且判的是**我们自己的信封**、不是模型的
 * 散文:对象里出现 `error` 或 `needMoreInfo` ⇒ 没落盘;返回值根本不是对象(①那句字符串)
 * ⇒ 没落盘。判不出来就当没落盘 —— fail closed 的方向是退钱。
 */
function landedOnDisk(out: unknown): boolean {
  if (!out || typeof out !== "object") return false;
  return !("error" in out) && !("needMoreInfo" in out);
}

/**
 * 给一个 `effect: "write"` 的技能包一层:它**真的落盘**的那一刻,在这一轮的记账本上记一笔。
 *
 * 只做这一件事 —— 参数、审批闸、抛出去的错误、返回值一个字节都不改(SDK 照旧把抛错折成返回
 * 值,我们照旧原样交回去),所以模型看到的东西与本改动之前逐字相同,记账失败也不会打断一轮
 * 已经在跑的对话。
 */
function countingDeliveryTool(skillTool: OttoSkill["tool"]): OttoSkill["tool"] {
  const invoke = skillTool.invoke.bind(skillTool);
  return {
    ...skillTool,
    invoke: async (runContext, input, details) => {
      const out = await invoke(runContext, input, details);
      const context: unknown = runContext?.context;
      if (landedOnDisk(out) && context && typeof context === "object") {
        const tally = turnDeliveryTallies.get(context) ?? { writes: 0 };
        tally.writes += 1;
        turnDeliveryTallies.set(context, tally);
      }
      return out;
    },
  };
}

/**
 * Fold one finished/truncated run into the delivery counter.
 *
 * `cards` 与②段的 `collectTurnTraceFacts` **同一份事实**(同一个 `generatedItemsOf(state)`、
 * 同一种结构读法,never cast),`writes` 来自上面那本记账本。SDK 的 state 形状变了就退化成
 * 「数不到交付」—— 方向是**退钱**,不是照收。
 *
 * `baselineItems` 是**这一轮的起点**。`RunState.fromString` 把上一轮的 `_generatedItems` 整条
 * 带回来(SDK 侧 `generatedItems = preStepItems.concat(newStepItems)`,序列化与反序列化都原样
 * 保留,全包只有新建 state 那一处会清空),所以恢复轮从 0 数起的话,`ottoApprove` 那一门在
 * **一步都还没跑**的时候就已经是「有交付」——上一轮那张 `tool_approval_item` 就在里面,而那张
 * 卡的钱早在别的 refId 下付过了。只数这一轮新长出来的那一截。
 */
export function collectTurnDelivery(
  state: unknown,
  context?: object,
  baselineItems = 0,
): OttoTurnDelivery {
  let cards = 0;
  const items = generatedItemsOf(state);
  for (let i = Math.max(0, baselineItems); i < items.length; i += 1) {
    if ((items[i] as { type?: unknown }).type === "tool_approval_item") cards += 1;
  }
  return { cards, writes: context ? (turnDeliveryTallies.get(context)?.writes ?? 0) : 0 };
}

/** 这一轮**输入自带**的 item 数,也就是交付计数的起点。新鲜的一轮(字符串/数组输入)天然
 *  是 0;恢复轮是上一轮留下的那条历史的长度。 */
export function turnBaselineItemCount(input: OttoTurnRequest["input"]): number {
  return generatedItemsOf(input).length;
}

/** 零交付 = 卡片和落盘产物都是 0。一个字段都不许缺省成「有」—— fail closed 的方向是退钱。 */
export function turnDelivered(delivery: OttoTurnDelivery): boolean {
  return delivery.cards + delivery.writes > 0;
}

/** Hand the facts to the sink. A trace is DIAGNOSTIC: it must never be able to fail a turn the
 *  merchant already paid for, so every throw stops here with one log line. The facts arrive as a
 *  thunk on purpose: collecting them walks SDK-shaped state, so that walk has to sit INSIDE this
 *  try too — otherwise a collector throw would surface out of an already-settled turn. */
async function emitTurnTrace(
  collect: () => OttoTurnTraceFacts,
  sink: OttoTurnTraceSink,
  refId: string,
): Promise<void> {
  try {
    await sink(collect());
  } catch (e) {
    console.error(
      `[otto:trace] failed for ${refId} (category=${e instanceof Error ? e.name : typeof e})`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE-A6 — 长对话摘要（规格 §7.2④ 第二刀：摘要生成与计费）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an entry hands the runner so the turns it trimmed away are not simply forgotten.
 *
 * The split of duties is the same one every other port on this file follows: the ENTRY owns
 * identity and persistence (it read the thread row, it writes the thread row — the engine
 * package never touches prisma), the ENGINE owns the model call and its billing.
 */
export type OttoRollingSummaryPort = {
  /** The oldest turns `trimHistoryToBudget` (run-input.ts) removed from this turn's input,
   *  oldest first. Empty ⇒ nothing to fold ⇒ no model call at all. */
  readonly dropped: readonly AgentInputItem[];
  /** The thread's rolling summary BEFORE this turn (null on a thread never trimmed). The fold
   *  rewrites it whole, so the summary stays one bounded block instead of a growing chain. */
  readonly priorSummary: string | null;
  /** Persist the folded summary. Called once, AFTER the meter has settled this turn. */
  readonly save: (summary: string) => void | Promise<void>;
};

/** Output ceiling for the fold. The summary is re-injected on EVERY later turn, so its size is
 *  a recurring cost — this is the constant that keeps the rolling summary from becoming the
 *  next unbounded input. */
const ROLLING_SUMMARY_OUTPUT_CAP_TOKENS = 400;

/** Input ceiling for the fold, in characters of serialized history. A thread can drop a very
 *  large prefix on one turn (or a single oversized item); without this the "cheap small call"
 *  would be the most expensive call of the turn. Oldest content is cut first — the newest
 *  dropped turns are the ones the merchant is most likely to refer back to. */
const ROLLING_SUMMARY_INPUT_CHAR_CAP = 24_000;

const ROLLING_SUMMARY_INSTRUCTIONS =
  "You compress the older part of one conversation between a merchant and their marketing " +
  "assistant so it can be carried forward in far fewer tokens. Write a single dense block of " +
  "plain English notes: what the merchant asked for, decisions and preferences they stated, " +
  "names and ids that were agreed, and what was produced or refused. Keep concrete details " +
  "(names, ids, numbers) verbatim; drop pleasantries, restatements and step-by-step narration. " +
  "Write notes, not a reply — never address the merchant, never offer to help, never invent " +
  "anything that is not in the material.";

/** Serialize the dropped turns for the fold, newest-biased and hard-capped. */
function foldMaterial(port: OttoRollingSummaryPort): string {
  const parts: string[] = [];
  for (const item of port.dropped) {
    try {
      parts.push(JSON.stringify(item) ?? "");
    } catch {
      /* an unserializable item contributes nothing rather than failing the fold */
    }
  }
  const joined = parts.join("\n");
  return joined.length > ROLLING_SUMMARY_INPUT_CHAR_CAP
    ? joined.slice(joined.length - ROLLING_SUMMARY_INPUT_CHAR_CAP)
    : joined;
}

/**
 * ENGINE-A6 — fold the trimmed-away turns into the next rolling summary.
 *
 * MONEY (spec §7.2④「不新开钱路、不新增幂等键，沿用本轮的 refId」): this runs INSIDE the turn's
 * own `withLlmBudget` body, so the hold was already taken on this turn's refId and the tokens it
 * burns are ADDED to the usage that turn settles. There is no second reserve, no second refId
 * and no second idempotency key — a second `withLlmBudget` on the same refId would collide on
 * `reserve:<refId>`, no-op, and leave the real turn running against nothing. Because settle is
 * clamped to the hold (meter.ts invariant #2), the fold can only ever consume part of what was
 * already held; it can never raise the ceiling.
 *
 * It reuses the manifest's own binding, usage mapper and output redaction — no second model
 * constant, no second provider wiring (PH1-A1: one manifest is the single billing source).
 *
 * NEVER LOAD-BEARING: any throw is swallowed and the turn continues with the summary unchanged.
 * The cost of that is bounded (a stretch of old context is lost); the cost of the alternative is
 * failing a turn the merchant is paying for, over a diagnostic-grade nicety.
 */
async function foldRollingSummary(
  runtime: OttoRuntime,
  execution: OttoRuntimeExecution,
  port: OttoRollingSummaryPort,
): Promise<{ summary: string; usage: TokenUsage } | null> {
  try {
    const material = foldMaterial(port);
    if (!material) return null;
    const agent = new Agent({
      name: "Otto rolling summary",
      instructions: ROLLING_SUMMARY_INSTRUCTIONS,
      model: runtime.modelRuntime.binding,
      modelSettings: { maxTokens: ROLLING_SUMMARY_OUTPUT_CAP_TOKENS },
      tools: [],
    });
    const prompt =
      (port.priorSummary?.trim()
        ? `Notes so far (rewrite them together with the new material into ONE block):\n${port.priorSummary.trim()}\n\n`
        : "") + `Older conversation turns to fold in:\n${material}`;
    // maxTurns: 1 — a tool-less agent cannot take a second step, and pinning it says so.
    const r = await execution.runAgent(agent as never, prompt as never, { maxTurns: 1 });
    const result = r as unknown as OttoTurnRunResult;
    const summary = extractText(r).trim();
    if (!summary) return null;
    return { summary, usage: runtime.modelRuntime.mapUsage(result.state.usage) };
  } catch (e) {
    console.error(
      `[otto:summary] fold failed (category=${e instanceof Error ? e.name : typeof e}) — history was trimmed, summary left unchanged`,
    );
    return null;
  }
}

/** Add the fold's tokens to the turn's tokens. One settle, one refId — see foldRollingSummary. */
function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const cached = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  const cacheWrite = (a.cacheWriteInputTokens ?? 0) + (b.cacheWriteInputTokens ?? 0);
  return {
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
    cachedInputTokens: cached > 0 ? cached : undefined,
    cacheWriteInputTokens: cacheWrite > 0 ? cacheWrite : undefined,
  };
}

/**
 * Derive the FULL withLlmBudget parameter set from the runtime manifest (PH1-A1):
 * billable model, paid flag, step cap, prices, and the truncation usage mapper all
 * come from the SAME manifest — an entry only contributes identity + refId.
 * `paid` is false IFF the manifest declares itself fixture-no-charge; there is no
 * other no-charge channel.
 *
 * The one value that does NOT come from the manifest is the PRICE of a conversation turn
 * (`margin`, plus the hold shape it governs). It is a product decision, not a model fact —
 * Founder's second ruling 2026-08-18 prices a chat turn at the provider's cost plus 5% — so it
 * comes from the same composition-time constants file as the step caps (@fikirtive/core
 * otto-budget.ts) and never from a request, an env var, or the manifest.
 */
export function ottoBudgetArgsFor(
  runtime: OttoRuntime,
  request: Pick<OttoTurnRequest, "orgId" | "refId" | "input">,
  context?: Pick<OttoContext, "research">,
  MaxTurnsError: typeof MaxTurnsExceededError = MaxTurnsExceededError,
): Parameters<typeof withLlmBudget>[0] {
  const mr = runtime.modelRuntime;
  // MONEY-A10(spec §7.4)—— 聊天的**第二条钱腿**:搜索。它不是从 token 数算出来的,所以它
  // 走 M1-c 的 extra 通道,和深研那条腿同一套费率、同一个函数(searchChargeInternal,3×)。
  //
  // 只有当这一轮真的接了 search 端口**并且**带了槽计数器,这条腿才存在:没接 = 搜不了 =
  // 没有钱腿;接了却没槽 = 技能会 fail closed 拒绝搜索(research-web.ts),所以同样没有钱腿。
  // 两边是同一个条件,不可能一边收钱一边不让搜、或者一边搜一边不收钱。
  //
  //   hold   = **按整格坚实预留**(最多 5 格 × 单次费率):账本在读余额的同一笔事务里算出这一轮
  //            买得起几格,坚实持有那几格,并把格数写回 slots.granted。判官 P1 实测过平铺
  //            worst-case 的下场——低余额下它会跟 LLM 腿一起被压掉,而工具照发满额的槽,
  //            settle 随后被 clamp,平台吃差额。
  //   settle = 这一轮真正**成功**的搜索次数 × 单次费率(跑完才知道;失败的调用已经把槽还回去了)。
  //            succeeded ≤ taken ≤ granted,所以它必然 ≤ 坚实预留的那一份。
  const slots = context?.research?.search ? context.research.searchSlots : undefined;
  // A conversation turn is priced by ONE number. Founder's second ruling 2026-08-18 set it to
  // 1.05 — the provider's API cost plus 5% — so a turn charges what it actually used, and a long
  // thinking turn can never cost the platform more than it earns. See
  // OTTO_CONVERSATION_TURN_MARGIN in otto-budget.ts for the ruling and the arithmetic.
  //
  // The hold shape below rides on the same number: it is the shape of a PRICED turn, so it is
  // passed whenever the multiplier is above 0 and stands down if conversation is ever free again
  // (a turn that holds nothing has no hold to cap and no door to stand at). That one condition,
  // rather than two hand-maintained switches, is what made both directions of this ruling a
  // single-constant change.
  const chatChargesCredits = OTTO_CONVERSATION_TURN_MARGIN > 0;
  // ENGINE-A4:交付计数的**起点**,现在就折。恢复轮的 `RunState` 会在跑的过程中被**就地**
  // 追加(错误身上带回来的就是同一个对象),所以这一步晚一刻做就等于没做 —— 到 usageOnError
  // 那一刻再数,起点已经等于终点,这一轮新铸的卡会被一起抹掉。
  const baselineItems = turnBaselineItemCount(request.input);
  return {
    orgId: request.orgId,
    refId: request.refId,
    model: mr.billableModelId,
    paid: mr.billableModelId !== "fixture-no-charge",
    maxSteps: runtime.maxTurns,
    // The chat price. Explicit here rather than defaulted to ottoLlmMargin() so the conversation
    // turn's price is a composition-time fact and not an ambient env read.
    margin: OTTO_CONVERSATION_TURN_MARGIN,
    // #543 — cap the conversation-turn HOLD (not the charge) so a small balance stays
    // spendable to the last credit. Composition-time constant; see otto-budget.ts.
    reserveCapInternal: chatChargesCredits ? OTTO_CONVERSATION_TURN_RESERVE_INTERNAL : undefined,
    // #898 — the cap alone was still a door: a balance under it could not open a turn at all.
    // With a minimum the hold shrinks to fit the balance instead, so the last credit is
    // spendable. Composition-time constant; see otto-budget.ts.
    reserveMinInternal: chatChargesCredits ? OTTO_CHAT_MIN_START_INTERNAL : undefined,
    // MONEY-A10 的两条腿(见上)。没有槽 ⇒ 三个字段都不存在 ⇒ 与本改动之前逐字节相同。
    extraHoldUnits: slots
      ? { unitInternal: searchUnitChargeInternal("basic"), maxUnits: OTTO_CHAT_MAX_SEARCHES_PER_TURN }
      : undefined,
    onExtraUnitsGranted: slots
      ? (granted: number) => {
          slots.granted = granted;
        }
      : undefined,
    extraSettleInternal: slots ? () => searchChargeInternal(slots.succeeded) : undefined,
    prices: mr.pricing(mr.billableModelId),
    // ENGINE-A4(规格 §7.2⑤,Founder S1 九问 1② 的裁决)—— **截断且零交付的一轮全额退款**。
    //
    // 从前这里只问一件事:「跑满步数的错误身上带着真实用量吗?」带着就按实结算。meter.ts 的
    // 不变量 #10 把那条路写成 by design:「delivery-less but paid」。裁决把它改了 —— 商家手里
    // 什么都没多出来的一轮,不收钱;烧掉的 token 与已经成功的搜索由平台吸收。
    //
    // 判定读两样东西:错误自己带回来的 RunState(卡片,与②段的档案同一份事实),以及这一轮
    // 写技能的当场记账(落盘产物,`countingDeliveryTool`)—— 后者不能从 state 上数,因为 SDK
    // 对失败的工具也写 status:"completed"(见 landedOnDisk)。
    // 返回 null ⇒ 走 meter.ts 的整笔退款分支:退的是**整个预扣**(含 extraHoldUnits 那几格
    // 坚实预留的搜索钱,refundReservation 的金额读自 RESERVE 行,不分腿),并触发既有的
    // `onRefundedFailure` 只读钩子,让入口能对商家说实话。账本形态不变:reserve/refund 成对、
    // 净变 0,不新增幂等键。
    //
    // 有交付的截断轮**维持原状**按实际用量结算 —— 卡片、画布节点、写下的产物都已经在商家
    // 手里了,那一轮不是白跑。
    usageOnError: (e: unknown) => {
      if (!(e instanceof MaxTurnsError)) return null;
      const state = (e as { state?: { usage?: unknown } }).state;
      if (!state?.usage) return null;
      // 起点在上面**跑之前**就折好了(见 baselineItems),只数这一轮新长出来的那一截。
      const delivery = collectTurnDelivery(state, context, baselineItems);
      if (!turnDelivered(delivery)) return null;
      return mr.mapUsage((state as { usage: Parameters<UsageMapper>[0] }).usage);
    },
  };
}

/**
 * Fail-closed guard for the resume leg (#566). The SDK IGNORES options.context when the input is a
 * RunState — the state's OWN context wins — so a state restored with RunState.fromString resumes
 * with a JSON-rebuilt context that has lost every function port (ctx.startGen, ctx.schedule.*, …).
 * That failure was silent in production for five weeks. Restoring through
 * tryRestoreRunStateWithContext(agent, serialized, ctx) is the fix; this guard is what stops the
 * mistake from ever being made again quietly: a resumed state whose context is not the live one
 * throws HERE, before any model call and before any reservation, instead of re-entering the tool
 * port-less.
 *
 * FAIL-CLOSED (#566 R2 review). The classification is positive, not duck-typed: a fresh run is a
 * string or an item array — everything else IS the resume leg and MUST present a comparable
 * context. So a missing `_context`, an SDK internal reshape, or a test double that never installed
 * one now THROWS instead of waving the run through into metering. Reading `_context` optionally
 * (the earlier shape) meant exactly those cases resumed unguarded; billing must never be entered on
 * a state we cannot vouch for.
 */
function assertResumedStateCarriesLiveContext(input: OttoTurnRequest["input"], context: OttoContext): void {
  if (typeof input === "string" || Array.isArray(input)) return; // fresh run — the SDK honours options.context
  const wrapper = (input as { _context?: unknown } | null | undefined)?._context;
  const stateContext =
    wrapper !== null && typeof wrapper === "object" && "context" in wrapper
      ? (wrapper as { context: unknown }).context
      : undefined;
  if (stateContext === undefined) {
    throw new Error(
      "[otto] resume input is not a fresh string/array and exposes no comparable RunState context — " +
        "refusing to run it (an unverifiable state could re-enter a tool with its ports stripped). " +
        "Restore with tryRestoreRunStateWithContext(agent, serialized, ctx) (#566).",
    );
  }
  if (stateContext !== context) {
    throw new Error(
      "[otto] resumed RunState carries a different context object than the one passed to runOttoTurn — " +
        "its injected ports would be missing. Restore it with tryRestoreRunStateWithContext(agent, serialized, ctx) (#566).",
    );
  }
}

/**
 * The ONE metered agent-loop path every entry runs through: reserve → run →
 * usage → settle/refund, with the profile's step cap on both sides. Streaming
 * differs ONLY in draining events through `onStream` and awaiting `completed`
 * before usage settlement — the metering contract is byte-identical.
 *
 * ENGINE-A2 (spec §7.2②): when the caller injects a `trace` port, the runner accumulates
 * this turn's structural facts and hands them to that port AFTER the meter has finished.
 * Two rules make the addition non-load-bearing:
 *  - it runs on BOTH exits. A truncated turn (MaxTurnsExceededError, which withLlmBudget
 *    settles and rethrows) is exactly the turn worth looking at, so its facts are read off the
 *    error's own state and emitted before the error propagates unchanged;
 *  - it can only observe. Collecting the facts AND the sink's throw are both swallowed
 *    (emitTurnTrace takes the collector as a thunk), nothing here touches
 *    the reserve/settle/refund parameters, and the runner's return value and thrown errors are
 *    byte-identical to before with or without a port.
 *
 * ENGINE-A6 (spec §7.2④): when the caller injects a `rollingSummary` port carrying trimmed-away
 * turns, the runner folds them into one summary INSIDE this turn's own hold — same refId, no
 * second reserve, no second idempotency key — adds the fold's tokens to what this turn settles,
 * and hands the summary to the entry's writer once the meter is done. A caller that passes no
 * port makes no model call and no write.
 *
 * ENGINE-A4 (spec §7.2⑤): the truncated exit is ALSO where the money verdict is made. The same
 * RunState the trace is folded from decides, through `ottoBudgetArgsFor`'s `usageOnError`,
 * whether this turn delivered anything — zero delivery ⇒ the whole hold is refunded. The
 * runner's own control flow is unchanged: the error still propagates untouched. The fold above
 * rides inside the SAME hold, and it produces no deliverable of its own (no tool call, no card),
 * so a truncated zero-delivery turn is still refunded WHOLE — the fold's tokens included.
 */
export async function runOttoTurn(
  request: OttoTurnRequest,
  context: OttoContext,
  runtime: OttoRuntime,
  execution: OttoRuntimeExecution = defaultRuntimeExecution,
): Promise<OttoTurnRunResult> {
  const mr = runtime.modelRuntime;
  assertResumedStateCarriesLiveContext(request.input, context);
  const port = request.trace;
  const summaryPort = request.rollingSummary;
  const MaxTurnsError = execution.maxTurnsExceededError ?? MaxTurnsExceededError;
  // ENGINE-A6 — filled inside the metered body, persisted after the meter has settled (so a turn
  // that never completed cannot leave a summary standing over history the merchant still has).
  let foldedSummary: string | null = null;
  try {
    const result = await execution.meter(
      ottoBudgetArgsFor(runtime, request, context, execution.maxTurnsExceededError),
      async () => {
        // ENGINE-A6 (spec §7.2④): the fold rides INSIDE this turn's hold, so its tokens settle on
        // the same refId. It runs before the agent so a failed fold cannot strand a finished turn.
        const folded =
          summaryPort && summaryPort.dropped.length > 0
            ? await foldRollingSummary(runtime, execution, summaryPort)
            : null;
        if (folded) foldedSummary = folded.summary;
        const withFold = (usage: TokenUsage): TokenUsage =>
          folded ? addTokenUsage(usage, folded.usage) : usage;
        if (request.stream) {
          const r = await execution.runAgent(runtime.agent, request.input as never, {
            context,
            maxTurns: runtime.maxTurns,
            stream: true,
          });
          if (request.onStream) await request.onStream(r);
          // Ensure the run is fully settled before reading usage/state (usage is only
          // known after the stream is drained).
          await r.completed;
          const result = r as unknown as OttoTurnRunResult;
          return { result, usage: withFold(mr.mapUsage(result.state.usage)) };
        }
        const r = await execution.runAgent(runtime.agent, request.input as never, {
          context,
          maxTurns: runtime.maxTurns,
        });
        const result = r as unknown as OttoTurnRunResult;
        return { result, usage: withFold(mr.mapUsage(result.state.usage)) };
      },
    );
    if (summaryPort && foldedSummary !== null) {
      // Diagnostic-grade like the trace below: a failed write costs some old context on the next
      // turn, and must never throw out of a turn the ledger has already settled.
      try {
        await summaryPort.save(foldedSummary);
      } catch (e) {
        console.error(
          `[otto:summary] save failed for ${request.refId} (category=${e instanceof Error ? e.name : typeof e})`,
        );
      }
    }
    if (port) {
      await emitTurnTrace(
        () => collectTurnTraceFacts(result?.state, runtime, port, request, false),
        port.sink,
        request.refId,
      );
    }
    return result;
  } catch (e) {
    // A reserve refusal (InsufficientCredits / SpendCapBlocked) never ran the model, so there
    // are no facts and no row — only a turn that actually ran gets an archive entry.
    if (port && e instanceof MaxTurnsError) {
      const state = (e as { state?: unknown }).state;
      await emitTurnTrace(
        () => collectTurnTraceFacts(state, runtime, port, request, true),
        port.sink,
        request.refId,
      );
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// finalizeOttoTurn — the shared finalizer projection
// ─────────────────────────────────────────────────────────────────────────────

/** The single post-run projection every entry persists from: serialized state,
 *  the interruption verdict, the approval-gated parks (registry closed set), and
 *  the assistant text. Entry-specific persistence (thread CAS, cards, receipts)
 *  consumes THIS instead of re-deriving its own copies. */
export type OttoTurnFinalization = {
  readonly newOttoState: string;
  readonly interrupted: boolean;
  readonly approvals: ApprovalInterruption[];
  readonly text: string;
};

/** Pure projection of a completed/interrupted run (no DB, no IO). */
export function finalizeOttoTurn(result: OttoTurnRunResult, _runtime: OttoRuntime): OttoTurnFinalization {
  const interruptions = Array.isArray(result.interruptions) ? result.interruptions : [];
  return {
    newOttoState: result.state.toString(),
    interrupted: interruptions.length > 0,
    approvals: interruptions.length > 0 ? collectApprovalInterruptions(interruptions) : [],
    text: extractText(result),
  };
}
