"use client";
import React from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
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
  if (role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", ...enterStyle }}>
        <div
          style={{
            maxWidth: "75%",
            padding: "0.75rem 1rem",
            background: "var(--brand-strong)",
            color: "var(--primary-foreground)",
            borderRadius: "20px 20px 0.25rem 20px",
            fontSize: "0.875rem",
            lineHeight: "1.45",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", ...enterStyle }}>
      <OttoAvatar size={32} state={streaming ? "thinking" : "idle"} />
      <div
        style={{
          maxWidth: "80%",
          padding: "0.75rem 1rem",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "0 20px 20px 20px",
          fontSize: "0.875rem",
          lineHeight: "1.5",
          color: "var(--foreground)",
          wordBreak: "break-word",
        }}
      >
        <OttoMarkdown text={text} streaming={streaming} />
      </div>
    </div>
  );
}

export default TextPart;
