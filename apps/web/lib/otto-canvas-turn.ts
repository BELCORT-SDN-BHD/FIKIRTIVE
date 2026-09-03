/**
 * otto-canvas-turn —— 画布上那张**始终可见**的 Otto 卡片，此刻该说什么。纯函数，没有 React。
 *
 * 规格：`docs/specs/creation-engine.md`（验收 CREATE-A1，画布路径的判定落在 Otto 确认卡片上）。
 * 触发：2026-09-04 staging 走查 P0-3 / P0-4。
 *
 * ## 病根
 *
 * 那张卡从前只有两句话：忙的时候一句写死的「Working through your latest request…」，
 * 不忙的时候把最后一条助手消息的**原始文本**截三行。于是走查录到 49 秒里屏幕一个字没变，
 * 而计数器在旁边从 1 跳到 6 —— 产品明明知道自己在做什么，就是不说。
 *
 * 而这些阶段信号**本来就全都在**：`data-status`（`otto-turn-narration.ts` 折成三句人话）、
 * `data-step`（工具边界，`TOOL_STEP_LABELS` 已经有商家读得懂的标签）、卡片自己的
 * `CardState`。这个文件不发明任何一个新阶段、不写第二份文案，只回答一句话：
 * **这一刻该显示哪一个已有的句子**，以及那颗圆点是什么颜色。
 *
 * ## 优先级（从确定到不确定）
 *
 *   1. 有卡在跑        → Generating —— 钱已经花出去了，这是屏幕上最该说的一件事；
 *   2. 有卡等确认      → Needs confirmation —— 停在商家身上，产品不该假装自己在忙；
 *   3. 这一轮在飞      → 正在跑的那一步的标签（真的工具名），没有就退回三句叙述之一；
 *   4. 这一轮的终局是失败 → Failed；
 *   5. 这一轮的终局是产出 → Done；
 *   6. 其余            → Ready。
 *
 * 只有 1 和 3 允许转圈（`runStateSpins` 的同一条规矩：停着的东西不许有动画）。
 *
 * ## 状态漂移（Codex QA-CRE-004，2026-09-04 只读审计 §4.2）
 *
 * 这张卡曾经有**两个**状态源：圆点读的是在飞的任务，正文读的是「整条对话里最后一条
 * assistant TEXT」——不管那句话有多老。于是审计录到：同一个画布里先失败一次、再成功一次
 * 直出视频之后，卡上是绿灯「Ready」配着上一轮那句「That generation didn't go through」；
 * 强制刷新，还是同一句。成功的产物、它花了多少钱，一个字都没有。
 *
 * 病根不是那句话选错了，是**没有排序**：一条 TEXT 一旦落库就永远是「最后一句」，哪怕
 * 后来又落了一条 GEN_RESULT。所以这个文件现在只认一件事 —— **谁更新**：
 *
 *   · `latestTurnTerminal` 找这一轮最新的那个终局任务事件（GEN_RESULT / TURN_ERROR）；
 *   · 正文（`canvasTurnText`）在「Otto 后来说过的话」与「那个终局自己」之间取**更新的那个**；
 *   · 状态词也由同一个终局给（不再由 `thread.status` 给 —— 见下）。
 *
 * 顺带修掉一件死掉的接线：`failed` 从前的唯一触发是 `ChatThreadDTO.status`，而画布这条路
 * 上的 thread 由 `toChatThreadDTO` 建（`lib/dto.ts:196`），**它根本不写 status**（只有线程
 * 列表那份 `toChatThreadMetaDTO` 写）。也就是说画布卡的 failed 态从来没有可能出现过。
 * 现在它和 done 一样，由这一轮自己的消息给 —— 一个来源，不是两个。
 */
import type { OttoStatusData } from "./otto-stream-bridge";
import type { TraceStepView } from "./otto-status-helpers";
import { turnNarrationText } from "./otto-turn-narration";
import { STILL_WORKING_NOTE } from "./progress-format";
import { creditsLabel } from "./credit-format";

/** 画布卡的状态面。`dotTone` 是设计稿 `CanvasReference.tsx` 的 STATUS_META 那五个色。 */
export type CanvasTurnPhase =
  | "generating"
  | "needs-confirmation"
  | "working"
  | "failed"
  | "done"
  | "ready";

export interface CanvasTurnStatus {
  phase: CanvasTurnPhase;
  /** 右上角那颗圆点旁边的词。 */
  label: string;
  /** 圆点的 token 类名（设计稿同一套）。 */
  dot: string;
  /** 卡里那句「Otto 此刻在做什么」；不该叙述时是 null（正文自己会说话）。 */
  detail: string | null;
  /** 头像与圆点是否该有活着的表达。 */
  busy: boolean;
}

export interface CanvasTurnInput {
  /** useChat 的 submitted / streaming。 */
  isBusy: boolean;
  /** 第一个字吐出来了没有 —— 吐出来了就让正文说话，不再叙述阶段。 */
  hasAssistantText: boolean;
  /** 这一轮最后一个 data-status。 */
  liveStatus: OttoStatusData | null;
  /** 这一轮的步骤轨迹（`deriveTraceSteps` 的产物）。 */
  steps: readonly TraceStepView[];
  /** 有多少张卡的付费任务正在排队/生成。 */
  workingCardCount: number;
  /** 有多少张卡在等商家按确认。 */
  pendingConfirmCount: number;
  /** 这一轮最新的那个终局任务事件（`latestTurnTerminal` 的产物）；没有就是 null。 */
  terminal?: TurnTerminal | null;
  /** 距离上一次「屏幕上真的变了」过去了多少秒。超过 30 秒就补一句 still working。 */
  secondsSinceProgress?: number;
}

/** 超过这个秒数还没有任何变化，就明说自己还在做 —— 而不是同一句话冻在那里。 */
export const STILL_WORKING_AFTER_SECONDS = 30;

/** 正在跑的那一步的标签（`data-step` 给的真工具名），没有就是 null。 */
export function activeStepLabel(steps: readonly TraceStepView[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === "active") return steps[i].label;
  }
  return null;
}

/**
 * 这一刻该显示的进度句。**一个新文案都不写**：要么是某个工具步骤自己的标签，
 * 要么是 `otto-turn-narration.ts` 那三句之一。都没有就是 null。
 */
export function canvasProgressDetail(input: CanvasTurnInput): string | null {
  const { isBusy, hasAssistantText, liveStatus, steps } = input;
  if (!isBusy) return null;
  const step = activeStepLabel(steps);
  if (step) return step;
  return turnNarrationText({ isBusy, liveStatus, hasAssistantText });
}

/** 卡片此刻的整张脸。 */
export function canvasTurnStatus(input: CanvasTurnInput): CanvasTurnStatus {
  const detailBase = canvasProgressDetail(input);
  const stalled =
    (input.secondsSinceProgress ?? 0) >= STILL_WORKING_AFTER_SECONDS;

  if (input.workingCardCount > 0) {
    return {
      phase: "generating",
      label: "Generating",
      dot: "bg-brand",
      // 生成阶段没有 data-step 可读（worker 在流之外跑），所以这里说的是那一件确定的事。
      detail: stalled ? STILL_WORKING_NOTE : null,
      busy: true,
    };
  }
  if (input.pendingConfirmCount > 0) {
    return {
      phase: "needs-confirmation",
      label: "Needs confirmation",
      dot: "bg-brand",
      detail: null,
      busy: false,
    };
  }
  if (input.isBusy) {
    return {
      phase: "working",
      label: "Working",
      dot: "bg-brand",
      detail: stalled && detailBase ? `${detailBase} ${STILL_WORKING_NOTE}` : detailBase,
      busy: true,
    };
  }
  // 这一轮的终局。停着的时候，卡面说的就是这一轮真正结束在哪 —— 而不是「Ready」。
  const outcome = input.terminal?.outcome;
  if (outcome === "failed") {
    return { phase: "failed", label: "Failed", dot: "bg-destructive", detail: null, busy: false };
  }
  if (outcome === "done") {
    return { phase: "done", label: "Done", dot: "bg-success", detail: null, busy: false };
  }
  return { phase: "ready", label: "Ready", dot: "bg-success", detail: null, busy: false };
}

/**
 * 「这一轮」从第几条消息开始 —— 也就是最后一条商家自己说的话之后。
 *
 * 那张始终可见的卡是**当前回合**卡（设计源 `CanvasReference.tsx` 的 `CurrentTurn`），
 * 所以它上面的确认位只能是 Otto 这一轮提出来的东西。走查 P1-2 记到一件相关的事：Otto
 * 重建方案时会**再生一对新卡**，旧的那一对没有任何东西标成过时 —— 抽屉里于是攒着四张
 * 长得几乎一样的卡。要是把它们全堆进这张 280px 的卡，商家会在一叠里挑一个付钱。
 *
 * 早先几轮里没按的卡**没有消失**，也照旧可以批准：它们仍在对话抽屉里，那才是历史该待
 * 的地方。这里只回答「此刻这一轮在等什么」。
 */
export function currentTurnStartIndex(
  messages: readonly { role: string }[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}

/**
 * 那张卡该显示哪一段正文。
 *
 * 走查 P1-1：从前它取「最后一条 assistant 消息的 text 部件」，而 `threadToUiMessages`
 * 给每一条**非 TEXT** 的持久消息都塞了一个占位串（GEN_RESULT → `🖼 result`，
 * GEN_CARD → `📋 plan card`）。那些串是给渲染器认领用的内部记号，不是给商家读的话，
 * 于是一次成功的生成之后，卡上写着「🖼 result」。
 *
 * 所以这里只认**真的 TEXT**：durable kind 是 "TEXT" 的，或者根本没有 durable metadata 的
 * （实时流下来的那一条，还没落库）。
 */
export function latestAssistantSayable(
  messages: readonly { role: string; metadata?: { kind?: string } | null; parts: readonly unknown[] }[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const kind = m.metadata?.kind;
    if (kind !== undefined && kind !== "TEXT") continue;
    const text = m.parts
      .filter((part): part is { type: "text"; text: string } =>
        !!part && typeof part === "object"
        && (part as { type?: unknown }).type === "text"
        && typeof (part as { text?: unknown }).text === "string")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 这一轮的终局 —— Codex QA-CRE-004
// ─────────────────────────────────────────────────────────────────────────────

/** 那条消息在列表里的位置（一起带出来，因为「谁更新」就是靠它判的）。 */
export interface TurnTerminal {
  index: number;
  /** `cancelled` 是商家自己按停的（#602 T3），不是失败 —— 与线程徽章同一条口径。 */
  outcome: "done" | "failed" | "cancelled";
  /** 成功时这一件产出是什么（GEN_RESULT payload 自己写的 kind）。读不出来就是 null。 */
  kind: "image" | "video" | null;
  /** 成功时产出了几件（payload 自己的 urls 长度）。 */
  count: number;
  /** 成功时真的收了多少 credit（worker 写在 GEN_RESULT payload 上那个数）。没有就是 null。 */
  costCredits: number | null;
  /** 失败/取消时那条持久消息自己那句**给商家读**的话（`appendCoworkResult` 写的）。 */
  text: string | null;
}

/** 一条消息的 text 部件拼起来。`latestAssistantSayable` 与这里共用同一条判据。 */
function textOf(parts: readonly unknown[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } =>
      !!part && typeof part === "object"
      && (part as { type?: unknown }).type === "text"
      && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

type TurnMessage = {
  role: string;
  metadata?: { kind?: string; payload?: unknown } | null;
  parts: readonly unknown[];
};

/**
 * 这一轮（`currentTurnStartIndex` 之后）最新的那个**终局任务事件**，没有就是 null。
 *
 * 只认 worker 真的落库的那两种终局消息（GEN_RESULT / TURN_ERROR）—— 卡片自己的运行态
 * (`deriveCardState`) 读的也是同一对，所以圆点、卡面、抽屉里的卡不可能各说各话。
 *
 * 为什么要按轮切：商家做完一次生成再开口说下一句，那一次成功就不再是「此刻这一轮」的结论了。
 * 卡上还挂着上一轮的 Done，就是同一种漂移换个方向。
 */
export function latestTurnTerminal(messages: readonly TurnMessage[]): TurnTerminal | null {
  const start = currentTurnStartIndex(messages);
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i];
    const kind = m.metadata?.kind;
    if (kind !== "GEN_RESULT" && kind !== "TURN_ERROR") continue;
    const payload = (m.metadata?.payload ?? {}) as {
      kind?: unknown;
      urls?: unknown;
      costCredits?: unknown;
      cancelled?: unknown;
    };
    if (kind === "TURN_ERROR") {
      return {
        index: i,
        outcome: payload.cancelled === true ? "cancelled" : "failed",
        kind: null,
        count: 0,
        costCredits: null,
        text: textOf(m.parts) || null,
      };
    }
    return {
      index: i,
      outcome: "done",
      kind: payload.kind === "video" || payload.kind === "image" ? payload.kind : null,
      count: Array.isArray(payload.urls) ? payload.urls.length : 0,
      costCredits: typeof payload.costCredits === "number" ? payload.costCredits : null,
      // 成功那条的 text 是内部占位串（`🖼 result`），不是给商家读的话 —— 不带出来。
      text: null,
    };
  }
  return null;
}

/** 一个终局自己该怎么说。成功那一句是这张卡唯一的新文案，用词跟着卡上确认位走
 *  （「1 video · 11 credits」），数字全部来自 payload，一个都不算、不猜。 */
function terminalSentence(terminal: TurnTerminal): string | null {
  if (terminal.outcome !== "done") return terminal.text;
  const noun = terminal.kind === "video" ? "video" : terminal.kind === "image" ? "image" : null;
  const made = noun && terminal.count > 0
    ? `${terminal.count} ${noun}${terminal.count === 1 ? "" : "s"}`
    : null;
  const cost = terminal.costCredits === null ? null : creditsLabel(terminal.costCredits);
  if (made && cost) return `Made ${made} · ${cost}.`;
  if (made) return `Made ${made}.`;
  if (cost) return `Made it · ${cost}.`;
  return "Made it.";
}

/**
 * 那张卡此刻该显示的正文 —— **一个来源，按时间排序**（Codex QA-CRE-004）。
 *
 * 在「Otto 最后说的那句话」与「这一轮的终局」之间取更新的那个：
 *
 *   · Otto 后来解释过了（TEXT 比终局新）→ 说他的原话；
 *   · 终局比 Otto 最后一句新 → 终局自己说话（成功 = 产物 + 收费；失败/取消 = 那条持久
 *     消息自己那句给商家读的话）。
 *
 * 审计录到的那一幕正落在第二条上：失败之后 Otto 说了「didn't go through」，再成功一次，
 * 屏幕上还是那句 —— 因为从前只有第一条，而且没有比较。
 */
export function canvasTurnText(messages: readonly TurnMessage[]): string | null {
  const terminal = latestTurnTerminal(messages);
  const said = latestAssistantSayable(messages);
  if (!terminal) return said;
  if (said !== null) {
    // Otto 那句话在不在终局之后？在，就说他的原话。
    for (let i = messages.length - 1; i > terminal.index; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const kind = m.metadata?.kind;
      if (kind !== undefined && kind !== "TEXT") continue;
      if (textOf(m.parts)) return said;
    }
  }
  return terminalSentence(terminal) ?? said;
}
