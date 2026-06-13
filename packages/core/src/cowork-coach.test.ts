import { describe, expect, it } from "vitest";
import { lintPrompt, looksLikeTagSoup } from "./cowork-coach.js";
import type { ModelDirectiveRules } from "./cowork-directives.js";

const ids = (hs: { id: string }[]) => hs.map((h) => h.id);

describe("looksLikeTagSoup", () => {
  it("flags many short comma-separated fragments", () => {
    expect(looksLikeTagSoup("a, b, c, d")).toBe(true);
    expect(looksLikeTagSoup("cinematic lighting, shallow depth of field, rich detail, dynamic composition")).toBe(true);
  });
  it("does not flag natural sentences", () => {
    expect(looksLikeTagSoup("A lone fisherman stands on the dock, watching the storm roll in across the grey sea")).toBe(false);
    expect(looksLikeTagSoup("a calm wide shot of a quiet street at dawn")).toBe(false);
  });
  it("needs at least ~4 segments (3 commas)", () => {
    expect(looksLikeTagSoup("a, b, c")).toBe(false);
  });
});

describe("lintPrompt", () => {
  it("no rules → no hints", () => {
    expect(lintPrompt({ text: "a, b, c, d", mode: "t2i", rules: undefined, characterCount: 3 })).toEqual([]);
  });

  it("i2vMotionNotScene only fires in i2v / i2v-tail", () => {
    const rules: ModelDirectiveRules = { i2vMotionNotScene: true };
    expect(ids(lintPrompt({ text: "x", mode: "i2v", rules, characterCount: 0 }))).toContain("i2v-motion");
    expect(ids(lintPrompt({ text: "x", mode: "i2v-tail", rules, characterCount: 0 }))).toContain("i2v-motion");
    expect(ids(lintPrompt({ text: "x", mode: "t2i", rules, characterCount: 0 }))).not.toContain("i2v-motion");
  });

  it("maxConcurrentMotions surfaces a note with the number", () => {
    const hs = lintPrompt({ text: "x", mode: "t2v", rules: { maxConcurrentMotions: 2 }, characterCount: 0 });
    expect(ids(hs)).toContain("max-motions");
    expect(hs.find((h) => h.id === "max-motions")?.message).toContain("2");
  });

  it("noTagCommas fires only when the text looks like tag soup", () => {
    const rules: ModelDirectiveRules = { noTagCommas: true };
    expect(ids(lintPrompt({ text: "a, b, c, d", mode: "t2i", rules, characterCount: 0 }))).toContain("tag-soup");
    expect(ids(lintPrompt({ text: "a calm street at dawn", mode: "t2i", rules, characterCount: 0 }))).not.toContain("tag-soup");
  });

  it("castSeverity warns only with 2+ characters", () => {
    const rules: ModelDirectiveRules = { castSeverity: "warn" };
    expect(ids(lintPrompt({ text: "x", mode: "t2v", rules, characterCount: 2 }))).toContain("multi-char");
    expect(ids(lintPrompt({ text: "x", mode: "t2v", rules, characterCount: 1 }))).not.toContain("multi-char");
  });

  it("pitfalls each become a note", () => {
    const hs = lintPrompt({ text: "x", mode: "t2v", rules: { pitfalls: ["avoid negation", "keep it short"] }, characterCount: 0 });
    expect(hs.filter((h) => h.id.startsWith("pitfall:"))).toHaveLength(2);
  });

  it("combines multiple applicable rules", () => {
    const rules: ModelDirectiveRules = { i2vMotionNotScene: true, maxConcurrentMotions: 2, castSeverity: "warn" };
    expect(ids(lintPrompt({ text: "x", mode: "i2v", rules, characterCount: 3 })).sort()).toEqual(
      ["i2v-motion", "max-motions", "multi-char"],
    );
  });
});
