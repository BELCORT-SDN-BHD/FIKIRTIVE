"use client";
import React from "react";
import { OttoAvatar } from "@/components/fk";

export interface TextPartProps {
  /** Whose turn this text belongs to. */
  role: "user" | "assistant";
  /** The (possibly mid-stream) text content. */
  text: string;
  /** True while this part is actively streaming → render a blinking caret. */
  streaming?: boolean;
}

/**
 * One text bubble in the Otto stream. The bubble styles are reused VERBATIM from
 * OttoConversation (user bubble + Otto bubble) so the streaming chat looks identical
 * to the classic chat. While `streaming`, an assistant bubble shows a blinking caret.
 */
export function TextPart({ role, text, streaming }: TextPartProps) {
  if (role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            maxWidth: "75%",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--brand)",
            color: "var(--text-on-brand)",
            borderRadius: "var(--radius-lg) var(--radius-lg) var(--space-1) var(--radius-lg)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-normal)",
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
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
      <OttoAvatar size={32} state={streaming ? "thinking" : "idle"} />
      <div
        style={{
          maxWidth: "80%",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
          fontSize: "var(--text-sm)",
          lineHeight: "var(--leading-normal)",
          color: "var(--text-body)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
        {streaming && <BlinkingCaret />}
      </div>
    </div>
  );
}

/** A small blinking text caret appended to streaming assistant text. */
function BlinkingCaret() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "0.5em",
        marginLeft: "1px",
        color: "var(--text-muted)",
        animation: "otto-caret-blink 1s steps(1) infinite",
      }}
    >
      ▋
    </span>
  );
}

export default TextPart;
