import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_NODE_LOCK_REASON, getCanvasNodeWriteLock } from "../canvas-node-lock";

describe("getCanvasNodeWriteLock", () => {
  it("keeps node write actions unlocked by default", () => {
    expect(getCanvasNodeWriteLock({})).toEqual({
      locked: false,
      reason: DEFAULT_CANVAS_NODE_LOCK_REASON,
    });
  });

  it("locks node write actions with the caller-facing reason", () => {
    expect(getCanvasNodeWriteLock({
      directToolsLocked: true,
      directToolsLockedReason: "Open a campaign to edit the canvas.",
    })).toEqual({
      locked: true,
      reason: "Open a campaign to edit the canvas.",
    });
  });

  it("falls back to the default reason for blank copy", () => {
    expect(getCanvasNodeWriteLock({ directToolsLocked: true, directToolsLockedReason: "  " })).toEqual({
      locked: true,
      reason: DEFAULT_CANVAS_NODE_LOCK_REASON,
    });
  });
});
