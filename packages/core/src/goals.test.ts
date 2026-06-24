import { describe, it, expect } from "vitest";
import { GOAL_PRESETS, isGoalKey } from "./goals.js";

describe("GOAL_PRESETS", () => {
  it("has the v1 goal presets with plain-language openings", () => {
    expect(Object.keys(GOAL_PRESETS)).toEqual(
      expect.arrayContaining(["sell-product", "announce-sale", "get-followers", "make-video"]),
    );
    expect(GOAL_PRESETS["sell-product"].opening).toMatch(/product/i);
    expect(isGoalKey("sell-product")).toBe(true);
    expect(isGoalKey("nope")).toBe(false);
  });
});
