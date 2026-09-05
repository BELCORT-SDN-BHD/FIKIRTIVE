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
   *  skill declared `effect: "write"` (registry.ts). It is the structural half of §7.2⑤'s
   *  「这一轮交付了什么」 verdict — a completed call to one of these is a canvas node, a saved
   *  product, a written message artifact; a completed call to anything else is a READ, which
   *  hands the merchant nothing they still have after the turn dies. Derived from the SAME
   *  `deps.skills` as `actionNames`, so the two can never drift. */
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
  const agent = new Agent<OttoContext>({
    name: "Otto",
    instructions: ottoInstructions,
    model: deps.modelRuntime.binding,
    modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
    tools: deps.skills.map((s) => s.tool),
  });
  return Object.freeze({
    profile,
    modelRuntime: deps.modelRuntime,
    agent,
    maxTurns: OTTO_MAX_STEPS,
    // ENGINE-A2: the trace's action whitelist, derived from the very same list the tools are
    // built from — one registry, so the two can never drift into "traced but not composed".
    actionNames: Object.freeze(new Set(deps.skills.map((s) => s.name))) as ReadonlySet<string>,
    // ENGINE-A4: same list, one filter. `effect` is a DECLARED field on every skill
    // (skill.ts) — the refund verdict therefore reads a property the skill author already had
    // to fill in, not a second hand-maintained roster that a new skill could be forgotten from.
    deliveringActionNames: Object.freeze(
      new Set(deps.skills.filter((s) => s.effect === "write").map((s) => s.name)),
    ) as ReadonlySet<string>,
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
 * The COUNTER §7.2⑤ asks for: how many deliverables this turn left behind.
 *
 * 「交付」的口径是**结构性**的,不是读文本 —— 没有任何一处去看模型说了什么:
 *   · `cards`  = 铸出的卡片:停在审批位上的调用。商家屏幕上就是一张等他确认的卡。
 *   · `writes` = 落盘的产物:**完成**的写动作(画布节点、保存的产品、记下的品牌事实……),
 *                名字必须在 `deliveringActionNames`(= 声明了 `effect: "write"` 的技能)里。
 *
 * 一次成功的**读**(查产品、搜网页、看排期)不算交付:轮子死了之后商家手里什么都没多。
 * 这正是本段与钱的接缝 —— 搜索腿也跟着整笔退(§7.2⑤「搜索腿一并退」),而一轮只搜不写的
 * 截断轮,按这个口径就是零交付。
 */
export type OttoTurnDelivery = {
  readonly cards: number;
  readonly writes: number;
};

/**
 * Fold one finished/truncated run into the delivery counter.
 *
 * 与②段的 `collectTurnTraceFacts` **同一份事实**:同一个 `generatedItemsOf(state)`、同一种
 * 结构读法(never cast),所以「档案说这一轮调了什么」与「钱说这一轮交付了没有」不可能各说
 * 各话。SDK 的 state 形状变了就退化成「数不到交付」—— 方向是**退钱**,不是照收。
 */
export function collectTurnDelivery(
  state: unknown,
  deliveringActionNames: ReadonlySet<string>,
): OttoTurnDelivery {
  let cards = 0;
  let writes = 0;
  for (const item of generatedItemsOf(state)) {
    const type = (item as { type?: unknown }).type;
    if (type === "tool_approval_item") {
      cards += 1;
      continue;
    }
    const raw = rawItemOf(item);
    if (!raw) continue;
    if (
      type === "tool_call_output_item" &&
      raw.type === "function_call_result" &&
      raw.status === "completed" &&
      typeof raw.name === "string" &&
      deliveringActionNames.has(raw.name)
    ) {
      writes += 1;
    }
  }
  return { cards, writes };
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
    // 判定读的是错误自己带回来的 RunState,与②段的档案同一份事实(collectTurnDelivery)。
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
      if (!turnDelivered(collectTurnDelivery(state, runtime.deliveringActionNames))) return null;
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
 * ENGINE-A4 (spec §7.2⑤): the truncated exit is ALSO where the money verdict is made. The same
 * RunState the trace is folded from decides, through `ottoBudgetArgsFor`'s `usageOnError`,
 * whether this turn delivered anything — zero delivery ⇒ the whole hold is refunded. The
 * runner's own control flow is unchanged: the error still propagates untouched.
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
  const MaxTurnsError = execution.maxTurnsExceededError ?? MaxTurnsExceededError;
  try {
    const result = await execution.meter(
      ottoBudgetArgsFor(runtime, request, context, execution.maxTurnsExceededError),
      async () => {
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
          return { result, usage: mr.mapUsage(result.state.usage) };
        }
        const r = await execution.runAgent(runtime.agent, request.input as never, {
          context,
          maxTurns: runtime.maxTurns,
        });
        const result = r as unknown as OttoTurnRunResult;
        return { result, usage: mr.mapUsage(result.state.usage) };
      },
    );
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
