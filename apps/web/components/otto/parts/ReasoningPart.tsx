"use client";
import React, { useState } from "react";
import type { ReasoningUIPart } from "ai";

export interface ReasoningPartProps {
  /** The reasoning part from the UIMessage parts array. */
  part: ReasoningUIPart;
}

/**
 * Renders a single reasoning part as a collapsible disclosure block, collapsed
 * by default. The toggle label is "Otto's thinking".
 *
 * Graceful: only rendered when the caller has a reasoning part to show. If no
 * reasoning parts arrive (most models omit them), callers render nothing here
 * and the status line is the primary in-flight signal.
 *
 * Uses .fk CSS variables only; no globals.css changes.
 */
export function ReasoningPart({ part }: ReasoningPartProps) {
  const [open, setOpen] = useState(false);

  if (!part.text) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
      }}
    >
      {/* Spacer matching the 32px avatar used in assistant bubbles so it aligns. */}
      <div style={{ width: 32, flexShrink: 0 }} />
      <div
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          maxWidth: "80%",
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            fontStyle: "italic",
            userSelect: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              transition: "transform 0.15s",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              fontSize: "0.65em",
            }}
          >
            ▶
          </span>
          Otto's thinking
        </button>

        {open && (
          <div
            style={{
              marginTop: "var(--space-2)",
              padding: "var(--space-3) var(--space-4)",
              background: "var(--surface-subtle, var(--bg-page))",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              lineHeight: "var(--leading-relaxed)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--text-muted)",
            }}
          >
            {part.text}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReasoningPart;
