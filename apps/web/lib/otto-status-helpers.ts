/**
 * otto-status-helpers — PURE helpers for reading data-status / data-error parts
 * from a UIMessage's parts array (or from a DataUIPart callback).
 *
 * Pure (no React, no I/O) so they are unit-testable in the node harness.
 */
import type { OttoStatusData, OttoErrorData, OttoStepData, OttoCostData } from "./otto-stream-bridge";
import type { CardState } from "./otto-inject-helpers";

/** Minimal shape of what a data-* part looks like at runtime. */
interface RawDataPart {
  type: string;
  data?: unknown;
}

/**
 * Given the latest `data-status` payload received during a streaming turn, return
 * the text to display in the live status line, or null if there's no live status
 * to show (terminal or unrecognised kind).
 *
 * - kind "planning" → its text (live, shown while busy)
 * - all other kinds → null (terminal; the status line hides when isBusy=false)
 */
export function pickLiveStatusText(status: OttoStatusData | null): string | null {
  if (!status) return null;
  if (status.kind === "planning") return status.text;
  return null;
}

/**
 * Narrow a raw part object to `OttoStatusData` if its type is "data-status",
 * otherwise return null. Used to type-safely consume parts from message.parts
 * or from the onData callback.
 */
export function asStatusData(part: RawDataPart): OttoStatusData | null {
  if (part.type !== "data-status") return null;
  return part.data as OttoStatusData;
}

/**
 * Narrow a raw part object to `OttoErrorData` if its type is "data-error",
 * otherwise return null.
 */
export function asErrorData(part: RawDataPart): OttoErrorData | null {
  if (part.type !== "data-error") return null;
  return part.data as OttoErrorData;
}

/**
 * Return the first `data-error` payload carried by a message's parts, or null.
 *
 * A run failure streams a NON-transient `data-error` part, which AI SDK v6 both fires
 * on `onData` AND persists into the assistant message's `parts` (verified against the
 * installed ai@6.0.208: processUIMessageStream pushes the part to message.parts and
 * calls onData for non-transient data chunks). The live `onData` handler mirrors it
 * into React state for the alert; this reads the SAME error off the DURABLE part so the
 * renderer can surface it even if that ephemeral state was ever missed — state honesty
 * (宪法 11) must not hinge on a single one-shot callback. Pure + unit-tested.
 */
export function dataErrorOf(parts: readonly RawDataPart[]): OttoErrorData | null {
  for (const part of parts) {
    const err = asErrorData(part);
    if (err) return err;
  }
  return null;
}

/**
 * Recover the typed stream failure stored on a durable TURN_ERROR payload.
 * Older TURN_ERROR rows predate the nested `error` contract; they remain visible
 * as generic errors using their durable text.
 */
export function persistedStreamErrorOf(payload: unknown, fallbackText: string): OttoErrorData {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const kind = (error as { kind?: unknown }).kind;
      const text = (error as { text?: unknown }).text;
      if (
        (kind === "insufficient_credits" || kind === "spend_cap" || kind === "error")
        && typeof text === "string"
      ) {
        return { kind, text };
      }
    }
  }
  return { kind: "error", text: fallbackText };
}

/** The durable USER message that caused a TURN_ERROR, when recorded. */
export function persistedStreamErrorUserMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const userMessageId = (payload as { userMessageId?: unknown }).userMessageId;
  return typeof userMessageId === "string" ? userMessageId : null;
}

/**
 * Return the settled cost of a turn from its assistant message's parts, or null when the
 * turn carried no cost part (a free/mock turn, a refunded failure, or an older message
 * predating #555). Read off the DURABLE part for the same reason as dataErrorOf: what a
 * merchant was charged must not depend on catching one ephemeral callback.
 *
 * A non-positive or non-finite number is treated as "no cost to report" — the line must
 * never claim a charge that did not happen. Pure + unit-tested.
 */
export function turnCostOf(parts: readonly RawDataPart[]): number | null {
  for (const part of parts) {
    if (part.type !== "data-cost") continue;
    const credits = (part.data as OttoCostData | undefined)?.credits;
    if (typeof credits === "number" && Number.isFinite(credits) && credits > 0) return credits;
  }
  return null;
}

/** Narrow a raw part to `OttoStepData` if its type is "data-step", else null. */
export function asStepData(part: RawDataPart): OttoStepData | null {
  if (part.type !== "data-step") return null;
  return part.data as OttoStepData;
}

// ---------------------------------------------------------------------------
// 运行状态代数（#580 复审 r1 P1-3）
// ---------------------------------------------------------------------------
//
// 根因同一条：界面「说的」不是从执行「做的」派生。具体表现两个 ——
//   1. 一轮以 degraded / stale / data-error 结束时，最后一个步骤永远停在 "active"，
//      转圈动画就永远转下去，屏幕上说「正在做」而其实什么都不会再发生；
//   2. 卡片一拿到 genJobId 就说 “making this now”，可是那时任务很可能还在队列里
//      （客户端拿不到 QUEUED / GENERATING 的区分：thread DTO 把两者都折叠成
//       "working"，见 lib/thread-status.ts），于是又是一句无凭据的断言。
//
// 对策不是逐条改文案，而是先把界面允许出现的状态写成一个封闭集合，再规定
// 哪些是终态、哪一个才允许出现动画。所有展示分支只能从这里取判断。

/** 界面上唯一合法的运行状态集合。 */
export type OttoRunState =
  /** 已被接受、但**没有任何证据**已经开始跑（含 GenJob 排队中）。 */
  | "queued"
  /** 有活证据正在跑（流里正在进行的步骤）。只有这个状态允许动画。 */
  | "running"
  /** 停在商家身上：等一次确认。什么都没在跑。 */
  | "waiting"
  | "done"
  | "failed"
  /** 商家自己叫停的 —— 终态，而且**不是失败**（#602 T3 · spec #599 D4）。
   *  从前取消写的是 FAILED，于是卡面红着说「这一条没成」还递一颗「再试一次」，
   *  替商家自己的决定道歉。它有了自己的词，卡面就必须有自己的脸。 */
  | "cancelled"
  /** 会话已被别的轮次取代（CAS stale）—— 终态。 */
  | "stale"
  /** 这一轮被降级收尾（例如超出最大回合数）—— 终态。 */
  | "degraded"
  /** 这一轮以流错误收尾 —— 终态。 */
  | "data-error";

/** 终态：不会再有进展，因此界面必须停止一切「进行中」的表达（动画、计步、进度条）。 */
export const TERMINAL_RUN_STATES: ReadonlySet<OttoRunState> = new Set<OttoRunState>([
  "done",
  "failed",
  "cancelled",
  "stale",
  "degraded",
  "data-error",
]);

export function isTerminalRunState(state: OttoRunState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

/** 只有真的在跑才允许转圈。终态、排队、等确认一律静止。 */
export function runStateSpins(state: OttoRunState): boolean {
  return state === "running";
}

/**
 * 一轮对话流当前处在哪个状态。`streamError` 优先于 `liveStatus`：一条 data-error
 * 就是这一轮的结局，后面不会再有进展。返回 null 表示流没给出任何结论性信号
 * （步骤自己说话）。
 */
export function runStateOfStream(
  liveStatus: OttoStatusData | null,
  streamError: OttoErrorData | null,
): OttoRunState | null {
  if (streamError) return "data-error";
  if (!liveStatus) return null;
  switch (liveStatus.kind) {
    case "done":
      return "done";
    case "needs_approval":
      return "waiting";
    case "degraded":
      return "degraded";
    case "stale":
      return "stale";
    case "planning":
      return "running";
  }
}

/**
 * 一张生成卡处在哪个状态。
 *
 * 注意 `working` → `queued`：卡片手上只有「任务已建立」这一个事实，拿不到任务到底
 * 排队还是已经在跑（DTO 把 QUEUED 与 GENERATING 折叠成同一个 working）。拿不到就不许
 * 断言 —— 如实说排队，等结果落地再改口。
 */
export function runStateOfCard(cardState: CardState): OttoRunState {
  switch (cardState) {
    case "idle":
      return "waiting";
    case "working":
      return "queued";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

/** A step as the trace UI consumes it.
 *  "stopped" = 这一轮以终态收尾，而这个步骤没跑完 —— 它不会再动了。 */
export interface TraceStepView {
  label: string;
  status: "done" | "active" | "pending" | "waiting" | "stopped";
}

/**
 * Fold the ordered `data-step` events of a turn into a display step list:
 * first-seen order; a step stays "active" until its `done` event arrives. We never
 * invent "pending" steps — the agent only narrates tools as it calls them.
 *
 * 未完成步骤的去向完全由 `runStateOfStream` 的状态代数决定，本函数不另设判断：
 *   - done            → 全部 done；
 *   - waiting（挂在商家确认上）→ waiting（#591：停着就不许显示进度条）；
 *   - 其它终态（degraded / stale / data-error）→ stopped（不再转圈）；
 *   - 没有结论性信号  → 保持 active（真的在跑）。
 * Pure + unit-tested.
 */
export function deriveTraceSteps(
  events: OttoStepData[],
  liveStatus: OttoStatusData | null,
  streamError: OttoErrorData | null = null,
): TraceStepView[] {
  const order: string[] = [];
  const byId = new Map<string, TraceStepView>();
  for (const ev of events) {
    let s = byId.get(ev.id);
    if (!s) {
      s = { label: ev.label, status: "active" };
      byId.set(ev.id, s);
      order.push(ev.id);
    }
    if (ev.phase === "done") s.status = "done";
  }
  const steps = order.map((id) => ({ ...byId.get(id)! }));
  const runState = runStateOfStream(liveStatus, streamError);
  if (runState === "done") steps.forEach((s) => (s.status = "done"));
  else if (runState === "waiting") {
    steps.forEach((s) => {
      if (s.status !== "done") s.status = "waiting";
    });
  } else if (runState && isTerminalRunState(runState)) {
    steps.forEach((s) => {
      if (s.status !== "done") s.status = "stopped";
    });
  }
  return steps;
}

/**
 * 挂起面板该不该出现（#580 复审 r1 P1-4）。
 *
 * 旧写法是 OttoTrace 里的模块级全局广播：任意一张卡批准成功就把**所有**等待面板藏掉，
 * 而且通用批准卡根本不发这个信号。这里改成由父层用「这条会话还剩哪些卡等批准」来决定 ——
 * 一个纯判断，父层在拿到服务端返回的新待批集合之后才调用它。
 *
 * 规则：面板停在「等你确认」形态，但这条会话已经没有任何卡在等批准了 ⇒ 它描述的是一件
 * 已经发生过的事，必须让位给卡自己的实时状态，而不是继续要一次已经点过的确认。
 */
export function shouldShowTracePanel(args: {
  steps: readonly TraceStepView[];
  pendingCardIds: ReadonlySet<string>;
}): boolean {
  const { steps, pendingCardIds } = args;
  if (steps.length === 0) return false;
  const parked = steps.some((s) => s.status === "waiting");
  if (parked && pendingCardIds.size === 0) return false;
  return true;
}
