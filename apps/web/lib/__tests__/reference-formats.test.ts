import { describe, it, expect } from "vitest";
import { REFERENCE_FORMATS } from "../reference-formats";

const formatFor = (key: string) => REFERENCE_FORMATS.find((f) => f.key === key);

describe("REFERENCE_FORMATS", () => {
  it("has the 4 approved formats mapped to existing entity types", () => {
    expect(REFERENCE_FORMATS.map((f) => [f.key, f.entityType])).toEqual([
      ["avatar", "CHARACTER"],
      ["product-shot", "PRODUCT"],
      ["location", "LOCATION"],
      ["brandmark", "BRANDMARK"],
    ]);
  });
  it("buildPrompt interpolates the subject and keeps the fixed skeleton", () => {
    const p = formatFor("avatar")!.buildPrompt({ subject: "Rosa, 30s Malaysian founder" });
    expect(p).toContain("Rosa, 30s Malaysian founder");
    expect(p).toContain("Head-and-shoulders");
    expect(p).toContain("neutral expression");
  });
  it("appends notes only when present", () => {
    const f = formatFor("product-shot")!;
    expect(f.buildPrompt({ subject: "a bag of coffee beans" })).not.toContain("Additional details");
    expect(f.buildPrompt({ subject: "beans", notes: "kraft-paper bag" })).toContain("Additional details: kraft-paper bag");
  });
  it("every format's prompt stays under the refgen limit", () => {
    for (const f of REFERENCE_FORMATS) {
      expect(f.buildPrompt({ subject: "x".repeat(300), notes: "y".repeat(300) }).length).toBeLessThanOrEqual(2000);
    }
  });
});
