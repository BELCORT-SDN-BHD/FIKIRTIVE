/**
 * otto-status-helpers — PURE helpers for reading data-status / data-error parts
 * from a UIMessage's parts array (or from a DataUIPart callback).
 *
 * Pure (no React, no I/O) so they are unit-testable in the node harness.
 */
import type { OttoStatusData, OttoErrorData, OttoStepData, OttoCostData } from "./otto-stream-bridge";

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

/**
 * Return the first `data-error` payload carried by a message's parts, or null.
 *
 * A run failure streams a NON-transient `data-error` part, which AI SDK v6 both fires
 * on `onData` AND persists into the assistant message's `parts` (verified against the
 * installed ai@6.0.208: processUIMessageStream pushes the part to message.parts and
 * calls onData for non-transient data chunks). The live `onData` handler mirrors it
 * into React state for the alert; this reads the SAME error off the DURABLE part so the
 * renderer can surface it even if that ephemeral state was ever missed — state honesty
 * (宪法 11) must not hinge on a single one-shot callback. Pure + unit-tested.
 */
export function dataErrorOf(parts: readonly RawDataPart[]): OttoErrorData | null {
  for (const part of parts) {
    const err = asErrorData(part);
    if (err) return err;
  }
  return null;
}

/**
 * Recover the typed stream failure stored on a durable TURN_ERROR payload.
 * Older TURN_ERROR rows predate the nested `error` contract; they remain visible
 * as generic errors using their durable text.
 */
export function persistedStreamErrorOf(payload: unknown, fallbackText: string): OttoErrorData {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const kind = (error as { kind?: unknown }).kind;
      const text = (error as { text?: unknown }).text;
      if (
        (kind === "insufficient_credits" || kind === "error")
        && typeof text === "string"
      ) {
        return { kind, text };
      }
    }
  }
  return { kind: "error", text: fallbackText };
}

/** The durable USER message that caused a TURN_ERROR, when recorded. */
export function persistedStreamErrorUserMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const userMessageId = (payload as { userMessageId?: unknown }).userMessageId;
  return typeof userMessageId === "string" ? userMessageId : null;
}

/**
 * Return the settled cost of a turn from its assistant message's parts, or null when the
 * turn carried no cost part (a free/mock turn, a refunded failure, or an older message
 * predating #555). Read off the DURABLE part for the same reason as dataErrorOf: what a
 * merchant was charged must not depend on catching one ephemeral callback.
 *
 * A non-positive or non-finite number is treated as "no cost to report" — the line must
 * never claim a charge that did not happen. Pure + unit-tested.
 */
export function turnCostOf(parts: readonly RawDataPart[]): number | null {
  for (const part of parts) {
    if (part.type !== "data-cost") continue;
    const credits = (part.data as OttoCostData | undefined)?.credits;
    if (typeof credits === "number" && Number.isFinite(credits) && credits > 0) return credits;
  }
  return null;
}

/** Narrow a raw part to `OttoStepData` if its type is "data-step", else null. */
export function asStepData(part: RawDataPart): OttoStepData | null {
  if (part.type !== "data-step") return null;
  return part.data as OttoStepData;
}

/** A step as the trace UI consumes it. */
export interface TraceStepView {
  label: string;
  status: "done" | "active" | "pending" | "waiting";
}

/**
 * Fold the ordered `data-step` events of a turn into a display step list:
 * first-seen order; a step stays "active" until its `done` event arrives. When the
 * run reports `done`, every step is marked done. We never invent "pending" steps —
 * the agent only narrates tools as it calls them.
 *
 * #591 (state honesty, 宪法 11): a run PARKED on approval is doing nothing. Its
 * unfinished steps become "waiting", never "active" — otherwise the panel shows a
 * running progress bar while the same screen says nothing has started, and the
 * merchant waits forever for work that will only begin when they confirm on the
 * card. Pure + unit-tested.
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
  else if (liveStatus?.kind === "needs_approval") {
    steps.forEach((s) => {
      if (s.status !== "done") s.status = "waiting";
    });
  }
  return steps;
}
