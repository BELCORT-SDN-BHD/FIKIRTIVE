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

/** Credit price lookup for a billable model id (production: llmPricesFor — unknown
 *  model falls back to sonnet pricing, NEVER zero). */
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
};

/** Structural view of a RunResult/StreamedRunResult that the finalizer consumes. */
export type OttoTurnRunResult = {
  state: { toString(): string; usage: Parameters<UsageMapper>[0] };
  interruptions?: unknown[];
};

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
    usageOnError: (e: unknown) =>
      e instanceof MaxTurnsError && (e as { state?: { usage?: unknown } }).state?.usage
        ? mr.mapUsage((e as { state: { usage: Parameters<UsageMapper>[0] } }).state.usage)
        : null,
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
 */
export async function runOttoTurn(
  request: OttoTurnRequest,
  context: OttoContext,
  runtime: OttoRuntime,
  execution: OttoRuntimeExecution = defaultRuntimeExecution,
): Promise<OttoTurnRunResult> {
  const mr = runtime.modelRuntime;
  assertResumedStateCarriesLiveContext(request.input, context);
  return execution.meter(
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
