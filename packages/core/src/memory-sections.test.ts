import { describe, it, expect } from "vitest";
import { SECTIONS, FACT_SECTION_KEYS, sectionForCategory, diffRows, sectionsTouched } from "./memory-sections.js";

describe("SECTIONS", () => {
  it("has the 6 approved sections in page order", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(["about", "look", "customers", "products", "offers", "rules"]);
  });
  it("fact sections are the 3 static ones", () => {
    expect([...FACT_SECTION_KEYS]).toEqual(["about", "look", "rules"]);
  });
});

describe("sectionForCategory — legacy mapping", () => {
  it.each([
    ["Brand", "about"], ["Voice", "about"], ["Audience", "customers"],
    ["Products", "products"], ["Rules", "rules"],
    ["about", "about"], ["look", "look"], ["rules", "rules"],
    ["totally-unknown", "about"], ["  RULES ", "rules"],
  ])("%s → %s", (cat, want) => expect(sectionForCategory(cat)).toBe(want));
});

describe("diffRows", () => {
  const t1 = new Date("2026-07-01T00:00:00Z"), t2 = new Date("2026-07-02T00:00:00Z");
  const a = { id: "a", updatedAt: t1, content: "old" };
  it("detects added, changed (by updatedAt), removed; ignores unchanged", () => {
    const before = [a, { id: "b", updatedAt: t1 }, { id: "c", updatedAt: t1 }];
    const after = [{ ...a, updatedAt: t2, content: "new" }, { id: "b", updatedAt: t1 }, { id: "d", updatedAt: t2 }];
    const d = diffRows(before, after);
    expect(d.added.map((r) => r.id)).toEqual(["d"]);
    expect(d.changed).toEqual([{ before: a, after: { ...a, updatedAt: t2, content: "new" } }]);
    expect(d.removed.map((r) => r.id)).toEqual(["c"]);
  });
  it("empty diff for identical lists", () => {
    const d = diffRows([a], [a]);
    expect(d.added.length + d.changed.length + d.removed.length).toBe(0);
  });
  it("compares Date vs ISO-string updatedAt equal", () => {
    const d = diffRows([{ id: "a", updatedAt: t1 }], [{ id: "a", updatedAt: t1.toISOString() }]);
    expect(d.changed.length).toBe(0);
  });
});

describe("sectionsTouched", () => {
  const t = new Date("2026-07-02T00:00:00Z");
  const empty = { added: [], changed: [], removed: [] };
  it("maps fact categories and record kinds to their sections", () => {
    const facts = { added: [{ id: "f1", updatedAt: t, category: "look" }], changed: [], removed: [{ id: "f2", updatedAt: t, category: "Rules" }] };
    const recs = { added: [{ id: "r1", updatedAt: t, kind: "product" }], changed: [{ before: { id: "r2", updatedAt: t, kind: "segment" }, after: { id: "r2", updatedAt: t, kind: "segment" } }], removed: [] };
    expect([...sectionsTouched(facts, recs)].sort()).toEqual(["customers", "look", "products", "rules"]);
  });
  it("empty diffs → empty set", () => {
    expect(sectionsTouched(empty, empty).size).toBe(0);
  });
  it("offer kind → offers", () => {
    const recs = { added: [{ id: "r1", updatedAt: t, kind: "offer" }], changed: [], removed: [] };
    expect([...sectionsTouched(empty, recs)]).toEqual(["offers"]);
  });
});
