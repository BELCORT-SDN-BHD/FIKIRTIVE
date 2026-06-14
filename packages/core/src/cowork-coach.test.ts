import { describe, expect, it } from "vitest";
import { lintPrompt, looksLikeTagSoup, countMotionCues } from "./cowork-coach.js";
import type { ModelDirectiveRules } from "./cowork-directives.js";

const ids = (hs: { id: string }[]) => hs.map((h) => h.id);
const tone = (hs: { id: string; tone: string }[], id: string) => hs.find((h) => h.id === id)?.tone;

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
    expect(tone(hs, "max-motions")).toBe("info"); // under budget → passive tip
  });

  it("max-motions ESCALATES to warn when an i2v prompt is over the motion budget", () => {
    const rules: ModelDirectiveRules = { maxConcurrentMotions: 2 };
    // subject shifts + particles drift + camera pushes = 3 motion cues > 2 (i2v: reliable)
    const hs = lintPrompt({ text: "the subject shifts as particles drift upward while the camera pushes in", mode: "i2v", rules, characterCount: 0 });
    expect(tone(hs, "max-motions")).toBe("warn");
    expect(hs.find((h) => h.id === "max-motions")?.message).toContain("3");
  });

  it("does NOT warn on t2v even when over budget — verb count over-fires on scene-rich prose", () => {
    const rules: ModelDirectiveRules = { maxConcurrentMotions: 2 };
    // a richly-described single car action trips many motion VERBS but is ~1-2 concurrent motions
    expect(tone(lintPrompt({ text: "the car glides and drifts and races and turns as it drives", mode: "t2v", rules, characterCount: 0 }), "max-motions")).toBe("info");
  });

  it("the camera-motion preset counts toward the i2v motion budget", () => {
    const rules: ModelDirectiveRules = { maxConcurrentMotions: 2 };
    // two subject motions in prose, under budget on their own (i2v: reliable mode)...
    expect(tone(lintPrompt({ text: "the subject drifts as a flag waves", mode: "i2v", rules, characterCount: 0 }), "max-motions")).toBe("info");
    // ...but a third motion from the camera preset tips it over
    expect(tone(lintPrompt({ text: "the subject drifts as a flag waves", mode: "i2v", rules, characterCount: 0, cameraMotion: "slow dolly in" }), "max-motions")).toBe("warn");
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

  it("nudges on PROSE multi-character (no @mention chip) via person cues, info-tone", () => {
    const rules: ModelDirectiveRules = { castSeverity: "warn" };
    // "two old friends" typed as prose → characterCount 0, but the person cue fires a softer hint
    const hs = lintPrompt({ text: "two old friends laughing at a cafe", mode: "t2v", rules, characterCount: 0 });
    expect(ids(hs)).toContain("multi-char-prose");
    expect(tone(hs, "multi-char-prose")).toBe("info");
    // a single-subject prose prompt does NOT trip it
    expect(ids(lintPrompt({ text: "a lone cyclist on a coastal road", mode: "t2v", rules, characterCount: 0 }))).not.toContain("multi-char-prose");
    // bare numbers/pronouns must NOT over-fire (Codex guard)
    expect(ids(lintPrompt({ text: "two red apples on a table", mode: "t2v", rules, characterCount: 0 }))).not.toContain("multi-char-prose");
    // non-person collectives / idioms must NOT over-fire (group/team/family/couple)
    for (const t of ["a group of islands", "a team of horses", "the family home", "a couple of apples on a plate"]) {
      expect(ids(lintPrompt({ text: t, mode: "t2v", rules, characterCount: 0 }))).not.toContain("multi-char-prose");
    }
    // and the chip-based warning takes precedence (no double-fire)
    expect(ids(lintPrompt({ text: "friends", mode: "t2v", rules, characterCount: 2 }))).not.toContain("multi-char-prose");
  });

  it("countMotionCues counts distinct motion verbs (deduped), whole-word only", () => {
    expect(countMotionCues("a static portrait")).toBe(0);
    expect(countMotionCues("the camera pushes in")).toBe(1);
    expect(countMotionCues("she walks as the camera pans and zooms")).toBe(3);
    expect(countMotionCues("drifting, drifting, drifting")).toBe(1); // deduped
    // whole-word boundaries: prefix-colliding NOUNS must NOT count as motion
    expect(countMotionCues("driftwood and a pullover near the dashboard, a panda and panorama")).toBe(0);
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
