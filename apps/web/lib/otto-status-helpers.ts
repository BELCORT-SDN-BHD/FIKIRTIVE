/**
 * otto-status-helpers — PURE helpers for reading data-status / data-error parts
 * from a UIMessage's parts array (or from a DataUIPart callback).
 *
 * Pure (no React, no I/O) so they are unit-testable in the node harness.
 */
import type { OttoStatusData, OttoErrorData } from "./otto-stream-bridge";

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
