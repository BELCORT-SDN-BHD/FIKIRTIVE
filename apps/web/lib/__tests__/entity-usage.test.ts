import { describe, it, expect } from "vitest";
import { tallyEntityUsage } from "../entity-usage";

describe("tallyEntityUsage", () => {
  it("returns {} for empty jobs array", () => {
    expect(tallyEntityUsage([])).toEqual({});
  });

  it("counts each entity id across jobs", () => {
    const result = tallyEntityUsage([
      { entityIds: ["a", "b"] },
      { entityIds: ["a"] },
    ]);
    expect(result).toEqual({ a: 2, b: 1 });
  });

  it("jobs with empty entityIds contribute nothing", () => {
    const result = tallyEntityUsage([
      { entityIds: [] },
      { entityIds: ["x"] },
    ]);
    expect(result).toEqual({ x: 1 });
  });

  it("counts each occurrence within a single job's entityIds (per-occurrence)", () => {
    // If an id appears twice in one job's array, it counts twice (simple accumulation)
    const result = tallyEntityUsage([{ entityIds: ["a", "a"] }]);
    expect(result).toEqual({ a: 2 });
  });

  it("handles multiple jobs with multiple ids", () => {
    const result = tallyEntityUsage([
      { entityIds: ["a", "b", "c"] },
      { entityIds: ["b", "c"] },
      { entityIds: ["c"] },
    ]);
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });
});
