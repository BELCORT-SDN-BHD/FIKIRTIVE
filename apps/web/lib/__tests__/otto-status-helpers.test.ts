/**
 * otto-status-helpers.test.ts — unit tests for the PURE status/error narrowing
 * helpers (pickLiveStatusText, asStatusData, asErrorData). Pure: no React, no
 * SDK construction, runs in the node harness.
 */
import { describe, it, expect } from "vitest";
import { pickLiveStatusText, asStatusData, asErrorData } from "@/lib/otto-status-helpers";
import type { OttoStatusData } from "@/lib/otto-stream-bridge";

describe("pickLiveStatusText", () => {
  it("returns the text for a planning status", () => {
    const s: OttoStatusData = { kind: "planning", text: "planning your ad…" };
    expect(pickLiveStatusText(s)).toBe("planning your ad…");
  });

  it("returns null for null", () => {
    expect(pickLiveStatusText(null)).toBeNull();
  });

  it("returns null for terminal kinds (done, degraded, stale, needs_approval)", () => {
    expect(pickLiveStatusText({ kind: "done", threadId: "thr_1" })).toBeNull();
    expect(pickLiveStatusText({ kind: "degraded", text: "something went wrong" })).toBeNull();
    expect(pickLiveStatusText({ kind: "stale", text: "stale" })).toBeNull();
    expect(pickLiveStatusText({ kind: "needs_approval", pendingCardIds: ["c1"] })).toBeNull();
  });
});

describe("asStatusData", () => {
  it("returns the data for a data-status part", () => {
    const payload: OttoStatusData = { kind: "planning", text: "planning…" };
    expect(asStatusData({ type: "data-status", data: payload })).toEqual(payload);
  });

  it("returns null for non-data-status parts", () => {
    expect(asStatusData({ type: "data-error", data: { kind: "error", text: "oops" } })).toBeNull();
    expect(asStatusData({ type: "text" })).toBeNull();
  });
});

describe("asErrorData", () => {
  it("returns the data for a data-error part", () => {
    const payload = { kind: "error" as const, text: "oops" };
    expect(asErrorData({ type: "data-error", data: payload })).toEqual(payload);
  });

  it("returns the data for insufficient_credits", () => {
    const payload = { kind: "insufficient_credits" as const, text: "Top up your credits" };
    expect(asErrorData({ type: "data-error", data: payload })).toEqual(payload);
  });

  it("returns null for non-data-error parts", () => {
    expect(asErrorData({ type: "data-status", data: { kind: "planning", text: "…" } })).toBeNull();
  });
});
