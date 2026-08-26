/**
 * otto-thread-state.ts —— 一条线程此刻处在哪一态,以及那一态商家读到的是哪个词。
 *
 * Founder 2026-08-26 裁决第 1 条:approval 与 status 全部走线程/聊天记录 ——「像我在
 * Claude Code 开 parallel session:第一个完成时可以回去看报告、回答、继续」。要做到
 * 那一句,列表里的每一行都必须当场说清三件事之一:**它还在跑**、**它在等你**、
 * **它做完了**。
 *
 * 为什么不给 `ChatThreadDTO.status` 加一个 "waiting" 档:那个类型是服务端与客户端共用的
 * 数据形状,它今天说的是「这一轮生成跑到哪了」。「在等商家」不是生成的状态,是**线程里
 * 有一件事还没被回答** —— 它的证据在消息里(一张还没被处理完的卡),不在线程头上。所以
 * 这里是一个**推导**:读线程与它的消息,得出商家该读到的那一个词。推导只有一处,列表、
 * 面板头、画布三面读的因此是同一句话。
 *
 * 纯函数,没有 React,也没有 `Date.now()` —— 三面共用的判断不该各带各的时钟。
 */
import type { ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

/** 商家读得到的三态,外加两个不属于三态但真的会发生的边角。 */
export type OttoThreadState = "working" | "needs-you" | "done" | "failed" | "idle";

/**
 * 每一态商家读到的那个词。**人话**,不是状态机的名字:
 * 「Needs you」而不是 `AWAITING_INPUT`,「Needs attention」而不是 `FAILED`。
 */
export const OTTO_THREAD_STATE_LABEL: Record<Exclude<OttoThreadState, "idle">, string> = {
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Needs attention",
};

/** 一条消息身上挂着的、还没被商家处理完的那件事(有它 = 这条线程在等人)。 */
export type OttoWaitingMark = { kind: "research" | "question"; label: string };

type LoosePayload = Record<string, unknown> | null | undefined;

function payloadOf(message: ChatMessageDTO): LoosePayload {
  return message.payload as LoosePayload;
}

/**
 * 这条消息是不是「还在等商家」。
 *
 * 两种形状:研究托付的分类卡(还有一类没被 Approve / Skip),以及线程内的问答卡
 * (还没选)。两者都把自己的待办写在 payload 里 —— 界面画的与这里读的是同一份事实,
 * 不是各存一份。
 */
export function waitingMarkOf(message: ChatMessageDTO): OttoWaitingMark | null {
  const payload = payloadOf(message);
  if (!payload) return null;
  const research = payload.ottoResearch as { stage?: string } | undefined;
  if (research?.stage === "waiting") return { kind: "research", label: "Waiting for you" };
  const ask = payload.ottoAsk as { answered?: boolean; skipped?: boolean } | undefined;
  if (ask && !ask.answered && !ask.skipped) return { kind: "question", label: "Waiting for you" };
  return null;
}

/** 线程里第一件还在等商家的事 —— 没有就是 `null`。 */
export function threadWaitingMark(thread: ChatThreadDTO): OttoWaitingMark | null {
  for (const message of thread.messages) {
    const mark = waitingMarkOf(message);
    if (mark) return mark;
  }
  return null;
}

/**
 * 这条线程该读成哪一态。
 *
 * 顺序有意义:**等你**排在**还在跑**前面。一条线程可以同时「后台还有一步没跑完」和
 * 「有一张卡在等商家点」——那种时候商家该读到的是「该我了」,不是「等它跑」:前者他做得了
 * 什么,后者他只能干等。
 */
export function ottoThreadState(thread: ChatThreadDTO): OttoThreadState {
  if (threadWaitingMark(thread)) return "needs-you";
  if (thread.status === "failed") return "failed";
  if (thread.status === "working") return "working";
  if (thread.status === "done") return "done";
  return "idle";
}

/* ── creation 线程(来自 Create 弹窗 / 画布)───────────────────────────────────── */

/**
 * 一条线程属于哪一块板。
 *
 * Founder 裁决第 1/2 条:creation 对话与非画布 Otto 对话是**分开的线程**,但同列在一张
 * 表里 —— 商家不该为了找回自己二十分钟前那块板,先去猜它算哪一类对话。creation 的那几行
 * 行尾带一条安静的「Open canvas」,点了回它自己的项目画布。
 *
 * 标记跟着**消息**走,不跟着线程头走:`ChatThreadDTO` 没有多余的格子,而消息的 payload
 * 本来就是「这条消息还带着什么」的去处(`ottoAnswer` 走的是同一条路)。真接后端的那一面,
 * 这份归属由线程自己的 project 与画布节点给出,判断仍然只有这一处。
 */
export type OttoCanvasMark = { projectId: string; projectName: string };

export function canvasMarkOf(thread: ChatThreadDTO): OttoCanvasMark | null {
  for (const message of thread.messages) {
    const payload = payloadOf(message);
    const mark = payload?.ottoCanvas as Partial<OttoCanvasMark> | undefined;
    if (mark && typeof mark.projectId === "string" && typeof mark.projectName === "string") {
      return { projectId: mark.projectId, projectName: mark.projectName };
    }
  }
  return null;
}
