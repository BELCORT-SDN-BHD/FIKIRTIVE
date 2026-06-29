/**
 * otto-status-helpers — PURE helpers for reading data-status / data-error parts
 * from a UIMessage's parts array (or from a DataUIPart callback).
 *
 * Pure (no React, no I/O) so they are unit-testable in the node harness.
 */
import type { OttoStatusData, OttoErrorData, OttoStepData } from "./otto-stream-bridge";

/** Minimal shape of what a data-* part looks like at runtime. */
interface RawDataPart {
  type: string;
  data?: unknown;
}

/**
 * Given the latest `data-status` payload received during a streaming turn, return
 * the text to display in the live status line, or null if there's no live status
 * to show (terminal or unrecognised kind).
 *
 * - kind "planning" → its text (live, shown while busy)
 * - all other kinds → null (terminal; the status line hides when isBusy=false)
 */
export function pickLiveStatusText(status: OttoStatusData | null): string | null {
  if (!status) return null;
  if (status.kind === "planning") return status.text;
  return null;
}

/**
 * Narrow a raw part object to `OttoStatusData` if its type is "data-status",
 * otherwise return null. Used to type-safely consume parts from message.parts
 * or from the onData callback.
 */
export function asStatusData(part: RawDataPart): OttoStatusData | null {
  if (part.type !== "data-status") return null;
  return part.data as OttoStatusData;
}

/**
 * Narrow a raw part object to `OttoErrorData` if its type is "data-error",
 * otherwise return null.
 */
export function asErrorData(part: RawDataPart): OttoErrorData | null {
  if (part.type !== "data-error") return null;
  return part.data as OttoErrorData;
}

/** Narrow a raw part to `OttoStepData` if its type is "data-step", else null. */
export function asStepData(part: RawDataPart): OttoStepData | null {
  if (part.type !== "data-step") return null;
  return part.data as OttoStepData;
}

/** A step as the trace UI consumes it. */
export interface TraceStepView {
  label: string;
  status: "done" | "active" | "pending";
}

/**
 * Fold the ordered `data-step` events of a turn into a display step list:
 * first-seen order; a step stays "active" until its `done` event arrives. When the
 * run reports `done`, every step is marked done. We never invent "pending" steps —
 * the agent only narrates tools as it calls them. Pure + unit-tested.
 */
export function deriveTraceSteps(
  events: OttoStepData[],
  liveStatus: OttoStatusData | null,
): TraceStepView[] {
  const order: string[] = [];
  const byId = new Map<string, TraceStepView>();
  for (const ev of events) {
    let s = byId.get(ev.id);
    if (!s) {
      s = { label: ev.label, status: "active" };
      byId.set(ev.id, s);
      order.push(ev.id);
    }
    if (ev.phase === "done") s.status = "done";
  }
  const steps = order.map((id) => ({ ...byId.get(id)! }));
  if (liveStatus?.kind === "done") steps.forEach((s) => (s.status = "done"));
  return steps;
}
