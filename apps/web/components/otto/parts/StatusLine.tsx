"use client";
import React from "react";
import { OttoAvatar } from "@/components/fk";
import type { OttoStatusData } from "@/lib/otto-stream-bridge";

export interface StatusLineProps {
  /** Whether a turn is currently in-flight (status === "submitted" | "streaming"). */
  isBusy: boolean;
  /** The latest data-status received for the in-flight turn, or null if none yet. */
  liveStatus: OttoStatusData | null;
}

/**
 * Renders the live "Otto is thinking…" bubble for an in-flight turn.
 *
 * - While busy and no data-status received yet → "Otto is thinking…"
 * - While busy and data-status.kind === "planning" → status.text
 * - Hidden once the turn is no longer in-flight (isBusy === false), regardless
 *   of what terminal kind arrived (done/needs_approval/degraded/stale).
 *   The terminal signals are handled upstream (onFinish refetch, Task 5 plan-card
 *   wiring for needs_approval, degraded text is persisted as a TEXT message by the
 *   route and flows through the normal message render).
 *
 * Task 5 seam: when needs_approval arrives, the plan card wiring should trigger here.
 * For now, StatusLine simply hides (isBusy will be false when the route closes the
 * stream after emitting needs_approval).
 */
export function StatusLine({ isBusy, liveStatus }: StatusLineProps) {
  if (!isBusy) return null;

  const statusText =
    liveStatus?.kind === "planning" ? liveStatus.text : "Otto is thinking…";

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
      <OttoAvatar size={32} state="thinking" />
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          background: "var(--surface-card)",
          borderRadius: "0 var(--radius-lg) var(--radius-lg) var(--radius-lg)",
          border: "1px solid var(--border-subtle)",
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          fontStyle: "italic",
        }}
      >
        {statusText}
      </div>
    </div>
  );
}

export default StatusLine;
