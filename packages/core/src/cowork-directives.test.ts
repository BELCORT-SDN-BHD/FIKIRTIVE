import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_SEED,
  MAX_DIRECTIVE_LEN,
  modelDirectiveInput,
  modelDirectiveRules,
} from "./cowork-directives.js";
import { MODEL_FAMILIES, GEN_MODES, GEN_VIDEO_MODELS, modelFamily } from "./gen.js";

describe("DIRECTIVE_SEED", () => {
  it("every cell has a valid family/mode and an in-bounds directive", () => {
    for (const c of DIRECTIVE_SEED) {
      expect(MODEL_FAMILIES).toContain(c.family);
      expect(GEN_MODES).toContain(c.mode);
      expect(c.directive.length).toBeLessThanOrEqual(MAX_DIRECTIVE_LEN);
      expect(c.directive.length).toBeGreaterThan(0);
    }
  });

  it("every cell's rules pass the closed rules schema", () => {
    for (const c of DIRECTIVE_SEED) {
      if (c.rules) expect(() => modelDirectiveRules.parse(c.rules)).not.toThrow();
    }
  });

  it("the seed is honest about its provenance: all research + untested", () => {
    for (const c of DIRECTIVE_SEED) {
      expect(c.confidence).toBe("untested");
    }
  });

  it("no duplicate (family, mode) cells", () => {
    const keys = DIRECTIVE_SEED.map((c) => `${c.family}:${c.mode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each cell as a full admin input round-trips through the zod", () => {
    for (const c of DIRECTIVE_SEED) {
      const parsed = modelDirectiveInput.parse({
        family: c.family,
        mode: c.mode,
        directive: c.directive,
        rules: c.rules,
        notes: c.notes,
        confidence: c.confidence,
        enabled: true,
        source: "research",
      });
      expect(parsed.family).toBe(c.family);
    }
  });
});

describe("DIRECTIVE_SEED video-family coverage (OPT-6 P2)", () => {
  it("every family a video model routes to has at least one seeded cell", () => {
    const seededFamilies = new Set(DIRECTIVE_SEED.map((c) => c.family));
    const routedFamilies = new Set(
      (GEN_VIDEO_MODELS as readonly string[]).map((m) => modelFamily(m)).filter((f): f is NonNullable<typeof f> => !!f),
    );
    const missing = [...routedFamilies].filter((f) => !seededFamilies.has(f));
    expect(missing).toEqual([]); // veo, seedance, wan, pixverse, grok, hailuo must all be covered
  });
  it("each new video-family seed targets a real video mode (t2v/i2v) with non-empty text", () => {
    for (const c of DIRECTIVE_SEED) {
      expect(c.directive.trim().length).toBeGreaterThan(0);
      expect(["t2i", "i2i", "t2v", "i2v", "i2v-tail"]).toContain(c.mode);
    }
  });
});

describe("modelDirectiveInput", () => {
  it("applies defaults (untested / enabled / founder)", () => {
    const p = modelDirectiveInput.parse({ family: "veo", mode: "t2v" });
    expect(p).toMatchObject({ directive: "", notes: "", confidence: "untested", enabled: true, source: "founder" });
  });

  it("rejects an unknown family, mode, or extra key", () => {
    expect(() => modelDirectiveInput.parse({ family: "midjourney", mode: "t2v" })).toThrow();
    expect(() => modelDirectiveInput.parse({ family: "veo", mode: "t9v" })).toThrow();
    expect(() => modelDirectiveInput.parse({ family: "veo", mode: "t2v", bogus: 1 })).toThrow();
  });
});

describe("modelDirectiveRules", () => {
  it("rejects an unknown rule key (closed shape, R5)", () => {
    expect(() => modelDirectiveRules.parse({ notAThing: true })).toThrow();
  });
  it("accepts the known closed fields", () => {
    expect(() =>
      modelDirectiveRules.parse({ maxConcurrentMotions: 2, noTagCommas: true, i2vMotionNotScene: true, castSeverity: "warn", pitfalls: ["x"] }),
    ).not.toThrow();
  });
});
