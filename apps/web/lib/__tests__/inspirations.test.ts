import { describe, it, expect } from "vitest";
import { INSPIRATIONS, inspirationCategories, type Inspiration } from "../inspirations";

describe("INSPIRATIONS catalog", () => {
  it("is non-empty with unique ids and non-empty fields", () => {
    expect(INSPIRATIONS.length).toBeGreaterThan(0);
    expect(new Set(INSPIRATIONS.map((i) => i.id)).size).toBe(INSPIRATIONS.length);
    for (const i of INSPIRATIONS) {
      expect(i.category.length).toBeGreaterThan(0);
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.description.length).toBeGreaterThan(0);
      expect(i.prompt.length).toBeGreaterThan(0);
    }
  });
});

describe("inspirationCategories", () => {
  it("returns unique categories in first-seen order", () => {
    const list: Inspiration[] = [
      { id: "a", category: "X", title: "t", description: "d", prompt: "p" },
      { id: "b", category: "Y", title: "t", description: "d", prompt: "p" },
      { id: "c", category: "X", title: "t", description: "d", prompt: "p" },
    ];
    expect(inspirationCategories(list)).toEqual(["X", "Y"]);
  });
  it("covers the real catalog with unique categories", () => {
    const cats = inspirationCategories(INSPIRATIONS);
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
