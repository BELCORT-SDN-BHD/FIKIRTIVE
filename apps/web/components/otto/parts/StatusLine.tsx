"use client";
import React from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import type { OttoStatusData } from "@/lib/otto-stream-bridge";
import { turnNarrationText } from "@/lib/otto-turn-narration";

export interface StatusLineProps {
  /** Whether a turn is currently in-flight (status === "submitted" | "streaming"). */
  isBusy: boolean;
  /** The latest data-status received for the in-flight turn, or null if none yet. */
  liveStatus: OttoStatusData | null;
  /** Whether the assistant has begun emitting text (first token arrived). */
  hasAssistantText?: boolean;
}

/**
 * 一轮在飞时,那句「Otto 正在做什么」。
 *
 * #996(W2-9,spec §3.4「生成进度」/ §3.5 原则 ⑤):这里以前是一块 shimmer 骨架加一句写死的
 * "Otto is thinking…" —— 一个不说话的转圈。现在它叙述**已有的**回合阶段,一个阶段一句短句,
 * 措辞全部来自 `lib/otto-turn-narration.ts` 那一份常量(没有新阶段,也没有第二处文案)。
 *
 * 第一个字吐出来之后就让位:真气泡开始写字了,再挂一句「正在思考」就是同一件事说两遍。
 * 这一轮结束(`isBusy === false`)就整块消失。
 */
export function StatusLine({ isBusy, liveStatus, hasAssistantText }: StatusLineProps) {
  const text = turnNarrationText({ isBusy, liveStatus, hasAssistantText });
  if (text === null) return null;

  return (
    <Message align="start">
      <MessageAvatar aria-hidden>
        <OttoAvatar size={32} state="thinking" />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Otto</MessageHeader>
        {/* key={text} triggers a React remount (→ CSS animation restart) when the phase
            changes, so each new sentence fades in instead of swapping in place. */}
        <StatusText key={text} text={text} />
      </MessageContent>
    </Message>
  );
}

/**
 * The status text bubble. Receives a `key` from the parent that changes with `text`,
 * so React remounts this element on each status text change — restarting the
 * `otto-status-fadein` CSS animation for a smooth crossfade feel.
 */
function StatusText({ text }: { text: string }) {
  return (
    <Bubble variant="status">
      <BubbleContent
        role="status"
        aria-live="polite"
        style={{
          animation: "otto-status-fadein var(--dur-base, 220ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1)) both",
        }}
      >
        {text}
      </BubbleContent>
    </Bubble>
  );
}

export default StatusLine;
