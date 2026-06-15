import { describe, expect, it } from "vitest";
import { GEN_VIDEO_MODELS, modelFamily, deriveMode, MODEL_FAMILIES, GEN_MODES, genRequest } from "./gen.js";

describe("modelFamily", () => {
  // every shipping video model resolves to a known family (version-agnostic, by prefix)
  const expected: Record<string, string> = {
    kling: "kling",
    "kling-2.6": "kling",
    "kling-3": "kling",
    "veo3.1-lite": "veo",
    "veo3.1-fast": "veo",
    "veo3.1": "veo",
    "ltx-2": "ltx",
    "seedance-2-fast": "seedance",
    "pixverse-v6": "pixverse",
    "grok-imagine": "grok",
    "wan-2.5": "wan",
    "hailuo-02": "hailuo",
    "seedance-2": "seedance",
  };
  it("maps every video model to a family", () => {
    for (const m of GEN_VIDEO_MODELS) {
      expect(modelFamily(m)).toBe(expected[m]);
    }
  });
  it("maps the image model seedream", () => {
    expect(modelFamily("seedream")).toBe("seedream");
  });
  it("is version-agnostic by prefix (future bumps inherit the family)", () => {
    expect(modelFamily("kling-4")).toBe("kling");
    expect(modelFamily("veo4")).toBe("veo");
  });
  it("seedream vs seedance disambiguate (both start with 'seed')", () => {
    expect(modelFamily("seedream")).toBe("seedream");
    expect(modelFamily("seedance-2-fast")).toBe("seedance");
  });
  it("unknown id → undefined (family-neutral fallback, never throws)", () => {
    expect(modelFamily("totally-unknown")).toBeUndefined();
    expect(modelFamily("")).toBeUndefined();
  });
  it("every returned family is in MODEL_FAMILIES", () => {
    for (const m of [...GEN_VIDEO_MODELS, "seedream"]) {
      const f = modelFamily(m);
      expect(f && MODEL_FAMILIES.includes(f)).toBe(true);
    }
  });
});

describe("deriveMode", () => {
  it("image: conditioning refs → i2i, else t2i", () => {
    expect(deriveMode({ kind: "image" })).toBe("t2i");
    expect(deriveMode({ kind: "image", conditioned: false })).toBe("t2i");
    expect(deriveMode({ kind: "image", conditioned: true })).toBe("i2i");
  });
  it("video: no source → t2v; source → i2v; source+tail → i2v-tail", () => {
    expect(deriveMode({ kind: "video" })).toBe("t2v");
    expect(deriveMode({ kind: "video", hasSourceImage: true })).toBe("i2v");
    expect(deriveMode({ kind: "video", hasSourceImage: true, hasTailImage: true })).toBe("i2v-tail");
  });
  it("tail without a source is t2v (an end frame is meaningless without a start)", () => {
    expect(deriveMode({ kind: "video", hasTailImage: true })).toBe("t2v");
  });
  it("every derived mode is in GEN_MODES", () => {
    const cases = [
      deriveMode({ kind: "image" }),
      deriveMode({ kind: "image", conditioned: true }),
      deriveMode({ kind: "video" }),
      deriveMode({ kind: "video", hasSourceImage: true }),
      deriveMode({ kind: "video", hasSourceImage: true, hasTailImage: true }),
    ];
    for (const m of cases) expect(GEN_MODES.includes(m)).toBe(true);
  });
});

describe("genRequest.variantSel", () => {
  const base = { projectId: "p1", prompt: "hi", entityIds: ["e1"], kind: "image", model: "seedream", count: 1 };
  it("defaults absent and accepts an { entityId: variantId } map", () => {
    expect(genRequest.parse(base).variantSel).toBeUndefined();
    expect(genRequest.parse({ ...base, variantSel: { e1: "v1" } }).variantSel).toEqual({ e1: "v1" });
  });
  it("rejects an over-long variant id (a bad id must never reach the worker)", () => {
    expect(() => genRequest.parse({ ...base, variantSel: { e1: "x".repeat(65) } })).toThrow();
  });
  it("rejects a variantSel key that isn't an @mentioned entity (inconsistent → no spend)", () => {
    expect(() => genRequest.parse({ ...base, variantSel: { e2: "v1" } })).toThrow();
    expect(() => genRequest.parse({ ...base, entityIds: [], variantSel: { e1: "v1" } })).toThrow();
  });
});
