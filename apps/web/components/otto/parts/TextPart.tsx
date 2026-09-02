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
import { OttoMarkdown } from "./OttoMarkdown";
import { MSG_ENTER_STYLE } from "./motion";

export interface TextPartProps {
  /** Whose turn this text belongs to. */
  role: "user" | "assistant";
  /** The (possibly mid-stream) text content. */
  text: string;
  /** True while this part is actively streaming → render a blinking caret. */
  streaming?: boolean;
  /** When true, applies the entry animation. Pass false for seeded history messages. */
  animateIn?: boolean;
}

/**
 * One text bubble in the Otto stream (user bubble + Otto bubble). While `streaming`,
 * an assistant bubble shows a blinking caret.
 *
 * #586: the ASSISTANT bubble renders markdown (OttoMarkdown). The USER bubble stays
 * literal pre-wrap text — the merchant typed those characters and is entitled to see
 * them back unchanged, and their own text is never run through a parser.
 */
export function TextPart({ role, text, streaming, animateIn }: TextPartProps) {
  const enterStyle = animateIn ? MSG_ENTER_STYLE : undefined;
  const isUser = role === "user";

  return (
    <Message align={isUser ? "end" : "start"} style={enterStyle}>
      {!isUser && (
        <MessageAvatar aria-hidden>
          <OttoAvatar size={32} state={streaming ? "thinking" : "idle"} />
        </MessageAvatar>
      )}
      <MessageContent>
        {!isUser && <MessageHeader>Otto</MessageHeader>}
        <Bubble
          align={isUser ? "end" : "start"}
          variant={isUser ? "default" : "outline"}
        >
          <BubbleContent className={isUser ? "whitespace-pre-wrap" : undefined}>
            {isUser ? text : <OttoMarkdown text={text} streaming={streaming} />}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

export default TextPart;
