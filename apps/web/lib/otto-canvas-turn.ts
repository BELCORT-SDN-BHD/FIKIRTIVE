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
 *   4. 线程失败        → Failed；
 *   5. 其余            → Ready。
 *
 * 只有 1 和 3 允许转圈（`runStateSpins` 的同一条规矩：停着的东西不许有动画）。
 */
import type { OttoStatusData } from "./otto-stream-bridge";
import type { TraceStepView } from "./otto-status-helpers";
import { turnNarrationText } from "./otto-turn-narration";
import { STILL_WORKING_NOTE } from "./progress-format";

/** 画布卡的状态面。`dotTone` 是设计稿 `CanvasReference.tsx` 的 STATUS_META 那五个色。 */
export type CanvasTurnPhase =
  | "generating"
  | "needs-confirmation"
  | "working"
  | "failed"
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
  /** durable thread 的状态（"failed" 时卡面要说失败）。 */
  threadStatus?: string | null;
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
  if (input.threadStatus === "failed") {
    return { phase: "failed", label: "Failed", dot: "bg-destructive", detail: null, busy: false };
  }
  return { phase: "ready", label: "Ready", dot: "bg-success", detail: null, busy: false };
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
