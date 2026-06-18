import { describe, it, expect } from "vitest";
import { ALL_MODEL_IDS, isKnownModelId, enabledVideoModels, isModelDisabled, knownDisabledSet } from "./model-registry.js";
import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { REFGEN_MODELS } from "./refgen.js";

describe("ALL_MODEL_IDS", () => {
  it("is the deduped union of the three typed catalogs (REFGEN included)", () => {
    const expected = new Set<string>([...GEN_MODELS, ...GEN_VIDEO_MODELS, ...REFGEN_MODELS]);
    expect(new Set(ALL_MODEL_IDS)).toEqual(expected);
    // seedream appears in GEN_MODELS AND REFGEN_MODELS but exactly once in the union
    expect(ALL_MODEL_IDS.filter((m) => m === "seedream")).toHaveLength(1);
  });
  it("isKnownModelId accepts a catalog id and rejects garbage", () => {
    expect(isKnownModelId("seedream")).toBe(true);
    expect(isKnownModelId("kling")).toBe(true);
    expect(isKnownModelId("nonexistent")).toBe(false);
    expect(isKnownModelId("")).toBe(false);
  });
});

describe("isModelDisabled / enabledVideoModels (additive narrowing only)", () => {
  it("nothing disabled → full typed video menu, nothing reported disabled", () => {
    const none = new Set<string>();
    expect(enabledVideoModels(none)).toEqual([...GEN_VIDEO_MODELS]);
    expect(isModelDisabled("kling", none)).toBe(false);
  });
  it("a disabled id is filtered out of the video menu and reported disabled", () => {
    const d = new Set(["kling"]);
    expect(enabledVideoModels(d)).not.toContain("kling");
    expect(enabledVideoModels(d).length).toBe(GEN_VIDEO_MODELS.length - 1);
    expect(isModelDisabled("kling", d)).toBe(true);
    expect(isModelDisabled("veo3.1", d)).toBe(false);
  });
  it("subset property: the enabled set is ALWAYS a subset of the typed menu for ANY (even garbage) disabled set", () => {
    const garbage = new Set(["kling", "not-a-model", "", "💸"]);
    const enabled = enabledVideoModels(garbage);
    for (const m of enabled) expect((GEN_VIDEO_MODELS as readonly string[]).includes(m)).toBe(true);
    // a garbage disabled id can't change the menu (it was never in it)
    expect(isModelDisabled("not-a-model", garbage)).toBe(true); // disable-set membership is literal
  });
  it("the union dedup matters: GEN_MODELS===REFGEN_MODELS===['seedream']", () => {
    expect([...GEN_MODELS]).toEqual(["seedream"]);
    expect([...REFGEN_MODELS]).toEqual(["seedream"]);
  });
});

describe("knownDisabledSet (unknown ignored at the resolver boundary)", () => {
  it("drops unknown ids and keeps known ones — unknowns never enter the set", () => {
    const set = knownDisabledSet(["kling", "not-a-model", "", "💸", "seedream"]);
    expect(set.has("kling")).toBe(true);
    expect(set.has("seedream")).toBe(true);
    expect(set.has("not-a-model")).toBe(false);
    expect(set.has("")).toBe(false);
    expect(set.has("💸")).toBe(false);
    expect(set.size).toBe(2);
  });
  it("an unknown id, even if asked to disable, can never reach a spend chokepoint", () => {
    // isModelDisabled is a literal predicate — but at the resolver boundary the set is
    // built via knownDisabledSet, so the unknown id was never admitted in the first place.
    const set = knownDisabledSet(["ghost-model"]);
    expect(isModelDisabled("ghost-model", set)).toBe(false);
  });
});
