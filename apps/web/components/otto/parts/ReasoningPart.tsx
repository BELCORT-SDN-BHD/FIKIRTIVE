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
        gap: "0.75rem",
      }}
    >
      {/* Spacer matching the 32px avatar used in assistant bubbles so it aligns. */}
      <div style={{ width: 32, flexShrink: 0 }} />
      <div
        style={{
          fontSize: "0.875rem",
          color: "var(--muted-foreground)",
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
            gap: "0.25rem",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-geist)",
            fontSize: "0.875rem",
            color: "var(--muted-foreground)",
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
          Otto&apos;s thinking
        </button>

        {open && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem 1rem",
              background: "var(--surface-subtle, var(--background))",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              lineHeight: "1.65",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--muted-foreground)",
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
