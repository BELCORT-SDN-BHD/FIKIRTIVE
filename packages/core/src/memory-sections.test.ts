import { describe, it, expect } from "vitest";
import {
  SECTIONS, FACT_SECTION_KEYS, sectionForCategory, diffRows, sectionsTouched,
  BRAND_SECTIONS, brandSectionForCategory, brandSectionForRecordKind,
  brandSectionLabel, brandSectionAction, isBrandSectionKey, brandOriginLabel,
  brandOriginLabelForSource,
  LEGACY_SECTION_TO_BRAND_SECTION, BRAND_SECTION_TO_LEGACY_SECTION,
} from "./memory-sections.js";

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

// FRONT-A8 —— 六 → 五节映射(规格 docs/specs/frontend-baseline.md §7.3④;
// Founder 2026-09-03 裁决三点名产品/优惠,裁决十一定死其余四条)。
describe("FRONT-A8 六→五节映射(裁决三＋裁决十一,全表已裁)", () => {
  it("FRONT-A8 五节的 key 与 label 逐字等于设计权威", () => {
    expect(BRAND_SECTIONS.map((s) => s.key)).toEqual([
      "brand-voice", "audiences", "knowledge-base", "style-guide", "visual-guidelines",
    ]);
    expect(BRAND_SECTIONS.map((s) => s.label)).toEqual([
      "Brand voice", "Audiences", "Knowledge base", "Style guide", "Visual guidelines",
    ]);
  });

  it("FRONT-A8 六节逐条落到裁决指定的那一节,产品与优惠都进 Knowledge base", () => {
    expect(LEGACY_SECTION_TO_BRAND_SECTION).toEqual({
      about: "brand-voice",
      customers: "audiences",
      products: "knowledge-base",
      offers: "knowledge-base",
      look: "visual-guidelines",
      rules: "style-guide",
    });
  });

  it("FRONT-A8 旧 category 字符串(含 legacy 别名)照样解析得出新节", () => {
    expect(brandSectionForCategory("about")).toBe("brand-voice");
    expect(brandSectionForCategory("voice")).toBe("brand-voice");   // legacy 别名
    expect(brandSectionForCategory("brand")).toBe("brand-voice");   // legacy 别名
    expect(brandSectionForCategory("audience")).toBe("audiences");  // legacy 别名
    expect(brandSectionForCategory("customers")).toBe("audiences");
    expect(brandSectionForCategory("products")).toBe("knowledge-base");
    expect(brandSectionForCategory("offers")).toBe("knowledge-base");
    expect(brandSectionForCategory("look")).toBe("visual-guidelines");
    expect(brandSectionForCategory("rules")).toBe("style-guide");
  });

  it("FRONT-A8 结构化记录按 kind 归节:产品/优惠 → Knowledge base,客群 → Audiences", () => {
    expect(brandSectionForRecordKind("product")).toBe("knowledge-base");
    expect(brandSectionForRecordKind("offer")).toBe("knowledge-base");
    expect(brandSectionForRecordKind("segment")).toBe("audiences");
  });

  // 这一条是 FRONT-A9「Otto 读到的与迁移前逐字相同」的地基:新界面写入的五节 key
  // 必须解析得回老六节,`getBrandContextText` 才能一个字不改地继续按老六节分段。
  it("FRONT-A9 新写入的五节 key 解析得回老六节(Otto 分段口径不变)", () => {
    expect(sectionForCategory("brand-voice")).toBe("about");
    expect(sectionForCategory("audiences")).toBe("customers");
    expect(sectionForCategory("knowledge-base")).toBe("products");
    expect(sectionForCategory("style-guide")).toBe("rules");
    expect(sectionForCategory("visual-guidelines")).toBe("look");
    expect(BRAND_SECTION_TO_LEGACY_SECTION["knowledge-base"]).toBe("products");
  });

  it("FRONT-A8 未知 category 仍落在 Brand voice,而不是抛错或丢行", () => {
    expect(brandSectionForCategory("whatever-this-is")).toBe("brand-voice");
  });

  it("FRONT-A8 Otto 记下的一行,来路不说「Written here」", () => {
    // 判官 P1-3:`origin` 是本轮才加的列,默认 manual,而 Otto 的写路径不写它,只写
    // source='otto'。光看 origin 会把 Otto 记下的每一条都标成「商家在这一面写的」。
    expect(brandOriginLabelForSource("manual", "otto")).toBe("Saved by Otto");
    // 列没写值(存量行)也一样成立 —— 拿不到 origin 不等于商家写过它。
    expect(brandOriginLabelForSource("", "otto")).toBe("Saved by Otto");
    // 商家自己写的照旧;Otto 从一份粘贴材料学到的,来路仍是那份材料。
    expect(brandOriginLabelForSource("manual", "user")).toBe("Written here");
    expect(brandOriginLabelForSource("text", "otto")).toBe("Pasted text");
    expect(brandOriginLabelForSource("url", "user")).toBe("Web page");
  });

  it("FRONT-A8 分区标签、主动作与来源标签都有,且不认不存在的 key", () => {
    expect(brandSectionLabel("knowledge-base")).toBe("Knowledge base");
    expect(brandSectionAction("audiences")).toBe("Add audience");
    expect(isBrandSectionKey("style-guide")).toBe(true);
    expect(isBrandSectionKey("offers")).toBe(false);
    expect(brandOriginLabel("text")).toBe("Pasted text");
    expect(brandOriginLabel("nonsense")).toBe("Written here");
  });
});
