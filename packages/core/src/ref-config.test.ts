import { describe, expect, it } from "vitest";
import { REF_TYPE_CONFIG, basePromptFor, slugify, type RefEntityType } from "./ref-config.js";

const TYPES: RefEntityType[] = ["CHARACTER", "LOCATION", "PRODUCT", "BRANDMARK"];

describe("slugify", () => {
  it("lowercases, dashes non-alnum, trims, and falls back", () => {
    expect(slugify("Red dress")).toBe("red-dress");
    expect(slugify("  Beach!!  ")).toBe("beach");
    expect(slugify("3/4 angle")).toBe("3-4-angle");
    expect(slugify("")).toBe("variant");
    expect(slugify("红裙")).toBe("variant"); // non-ascii → fallback (display name keeps it)
    expect(slugify("a".repeat(47) + " world")).toBe("a".repeat(47));
  });
});

describe("REF_TYPE_CONFIG", () => {
  it("covers every entity type with a base prompt, hint, and chips", () => {
    for (const t of TYPES) {
      const c = REF_TYPE_CONFIG[t];
      expect(c.baseHint.length).toBeGreaterThan(0);
      expect(c.baseShot("test subject")).toContain("test subject");
      expect(c.variantChips.length).toBeGreaterThanOrEqual(3);
      for (const chip of c.variantChips) expect(chip.scaffold.length).toBeGreaterThan(0);
    }
  });
});

describe("basePromptFor", () => {
  it("weaves name, notes and negative constraints into one shot", () => {
    const p = basePromptFor("CHARACTER", { name: "Mira", notes: "freckles", negativeConstraints: "no glasses" });
    expect(p).toContain("Mira");
    expect(p).toContain("freckles");
    expect(p).toContain("no glasses");
  });
  it("omits the notes/negative clauses when empty", () => {
    const p = basePromptFor("PRODUCT", { name: "Aura mug", notes: "", negativeConstraints: "" });
    expect(p).toContain("Aura mug");
    expect(p).not.toContain("Avoid:");
  });
});
