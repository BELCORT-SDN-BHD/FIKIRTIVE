import { describe, it, expect } from "vitest";
import {
  SCHEDULED_POST_STATUSES,
  canTransition,
  type ScheduledPostStatus,
} from "./schedule-state.js";

describe("SCHEDULED_POST_STATUSES", () => {
  it("is exactly the working-level status set from the schema", () => {
    expect([...SCHEDULED_POST_STATUSES]).toEqual([
      "DRAFT",
      "SCHEDULED",
      "PUBLISHING",
      "PUBLISHED",
      "FAILED",
      "NEEDS_ATTENTION",
      "CANCELLED",
    ]);
  });
});

describe("canTransition — legal transitions (spec §四D)", () => {
  const legal: Array<[ScheduledPostStatus, ScheduledPostStatus]> = [
    // owner/OTTO drafts, owner approves
    ["DRAFT", "SCHEDULED"],
    // cancel from either pre-publish state
    ["DRAFT", "CANCELLED"],
    ["SCHEDULED", "CANCELLED"],
    // slice 2: scheduler claim → publish
    ["SCHEDULED", "PUBLISHING"],
    ["PUBLISHING", "PUBLISHED"],
    // transient fail / reminder
    ["PUBLISHING", "NEEDS_ATTENTION"],
    ["PUBLISHING", "FAILED"],
    // recovery from a stuck/failed post: re-queue or cancel
    ["NEEDS_ATTENTION", "SCHEDULED"],
    ["NEEDS_ATTENTION", "CANCELLED"],
    ["FAILED", "SCHEDULED"],
    ["FAILED", "CANCELLED"],
  ];

  for (const [from, to] of legal) {
    it(`allows ${from} -> ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }
});

describe("canTransition — illegal transitions rejected", () => {
  it("terminal states go nowhere", () => {
    // PUBLISHED is terminal
    for (const to of SCHEDULED_POST_STATUSES) {
      expect(canTransition("PUBLISHED", to)).toBe(false);
    }
    // CANCELLED is terminal
    for (const to of SCHEDULED_POST_STATUSES) {
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
  });

  it("cannot skip the publish pipeline", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("DRAFT", "PUBLISHING")).toBe(false);
    expect(canTransition("DRAFT", "NEEDS_ATTENTION")).toBe(false);
    expect(canTransition("DRAFT", "FAILED")).toBe(false);
    expect(canTransition("SCHEDULED", "PUBLISHED")).toBe(false);
    expect(canTransition("SCHEDULED", "NEEDS_ATTENTION")).toBe(false);
    expect(canTransition("SCHEDULED", "FAILED")).toBe(false);
  });

  it("cannot un-publish or move backwards illegally", () => {
    expect(canTransition("SCHEDULED", "DRAFT")).toBe(false);
    expect(canTransition("PUBLISHING", "SCHEDULED")).toBe(false);
    expect(canTransition("PUBLISHING", "DRAFT")).toBe(false);
    expect(canTransition("PUBLISHING", "CANCELLED")).toBe(false); // in-flight publish can't be cancelled
    expect(canTransition("NEEDS_ATTENTION", "PUBLISHED")).toBe(false);
    expect(canTransition("FAILED", "PUBLISHED")).toBe(false);
  });

  it("a state never transitions to itself", () => {
    for (const s of SCHEDULED_POST_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});
