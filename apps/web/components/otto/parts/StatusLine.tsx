"use client";
import React from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import type { OttoStatusData } from "@/lib/otto-stream-bridge";

export interface StatusLineProps {
  /** Whether a turn is currently in-flight (status === "submitted" | "streaming"). */
  isBusy: boolean;
  /** The latest data-status received for the in-flight turn, or null if none yet. */
  liveStatus: OttoStatusData | null;
  /**
   * The useChat stream status. "submitted" = request sent, no tokens yet →
   * show the skeleton/shimmer bubble. "streaming" = tokens arriving → hide
   * the StatusLine (the real TextPart bubble is now visible).
   */
  chatStatus?: "submitted" | "streaming" | "ready" | "error";
  /** Whether the assistant has begun emitting text (first token arrived). */
  hasAssistantText?: boolean;
}

/**
 * Renders the live "Otto is thinking…" bubble for an in-flight turn.
 *
 * Phase A — submitted, no tokens yet: show a shimmer skeleton placeholder bubble.
 * Phase B — streaming with assistant text: hide (the real TextPart has taken over).
 * Phase C — busy with planning status text: show the status text with a crossfade
 *            when the text changes.
 *
 * The shimmer is defined via the `otto-shimmer` keyframe injected ONCE in
 * OttoChatStream's root <style> block (alongside otto-caret-blink).
 *
 * Hidden once the turn is no longer in-flight (isBusy === false).
 */
export function StatusLine({ isBusy, liveStatus, chatStatus, hasAssistantText }: StatusLineProps) {
  if (!isBusy) return null;

  // Phase B: tokens are arriving — real bubble is rendering, hide the status line.
  if (hasAssistantText) return null;

  // Phase A: submitted but no tokens yet — show shimmer skeleton bubble.
  if (chatStatus === "submitted") {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <OttoAvatar size={32} state="thinking" />
        <div
          style={{
            width: 180,
            height: 38,
            borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
            background:
              "linear-gradient(90deg, var(--border-subtle) 25%, var(--surface-card) 50%, var(--border-subtle) 75%)",
            backgroundSize: "200% 100%",
            animation: "otto-shimmer 1.4s ease-in-out infinite",
          }}
          aria-label="Otto is responding…"
          role="status"
        />
      </div>
    );
  }

  // Phase C: planning status text (or default thinking text), crossfade on change.
  const statusText =
    liveStatus?.kind === "planning" ? liveStatus.text : "Otto is thinking…";

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
      <OttoAvatar size={32} state="thinking" />
      {/* key={statusText} triggers a React remount (→ CSS animation restart) when the
          text changes, giving a crossfade between "Otto is thinking…" and planning text. */}
      <StatusText key={statusText} text={statusText} />
    </div>
  );
}

/**
 * The status text bubble. Receives a `key` from the parent that changes with `text`,
 * so React remounts this element on each status text change — restarting the
 * `otto-status-fadein` CSS animation for a smooth crossfade feel.
 */
function StatusText({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "var(--space-3) var(--space-4)",
        background: "var(--surface-card)",
        borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
        border: "1px solid var(--border-subtle)",
        fontSize: "var(--text-sm)",
        color: "var(--text-muted)",
        fontStyle: "italic",
        animation: "otto-status-fadein var(--dur-base, 220ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1)) both",
      }}
    >
      {text}
    </div>
  );
}

export default StatusLine;
