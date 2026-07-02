import { describe, it, expect } from "vitest";
import {
  productRecordData, segmentRecordData, offerRecordData,
  recordSchemaFor, recordName, normalizeNameKey, offerPhase,
  categoryKey, distinctCategories,
} from "./brand-records.js";

describe("record schemas", () => {
  it("accepts a minimal product and rejects a nameless one", () => {
    expect(productRecordData.safeParse({ name: "Latte Blend" }).success).toBe(true);
    expect(productRecordData.safeParse({ description: "x" }).success).toBe(false);
  });
  it("accepts a full product", () => {
    expect(productRecordData.safeParse({
      name: "Latte Blend", description: "smooth everyday coffee", price: "RM 49",
      url: "https://x.com/latte", sellingAngle: "affordable daily ritual", tags: ["bestseller"],
    }).success).toBe(true);
  });
  it("segment requires name AND who", () => {
    expect(segmentRecordData.safeParse({ name: "Young working moms" }).success).toBe(false);
    expect(segmentRecordData.safeParse({ name: "Young working moms", who: "25-38, urban, time-poor" }).success).toBe(true);
  });
  it("offer requires title only; dates are NOT part of data", () => {
    expect(offerRecordData.safeParse({ title: "Raya sale — 20% off" }).success).toBe(true);
    expect(Object.keys(offerRecordData.shape)).not.toContain("endsAt");
  });
  it("recordSchemaFor / recordName dispatch by kind", () => {
    expect(recordSchemaFor("offer")).toBe(offerRecordData);
    expect(recordName("product", { name: "A" })).toBe("A");
    expect(recordName("offer", { title: "B" })).toBe("B");
    expect(recordName("offer", {})).toBe("");
  });
});

describe("normalizeNameKey", () => {
  it("trims, lowercases, collapses whitespace", () => {
    expect(normalizeNameKey("  Latte   Blend ")).toBe("latte blend");
  });
});

describe("offerPhase", () => {
  const now = new Date("2026-07-02T00:00:00Z");
  it("expired when endsAt passed", () =>
    expect(offerPhase({ endsAt: new Date("2026-07-01T00:00:00Z") }, now)).toBe("expired"));
  it("scheduled when startsAt in future", () =>
    expect(offerPhase({ startsAt: new Date("2026-07-10T00:00:00Z") }, now)).toBe("scheduled"));
  it("active in window / with no dates", () => {
    expect(offerPhase({ startsAt: new Date("2026-07-01T00:00:00Z"), endsAt: new Date("2026-07-15T00:00:00Z") }, now)).toBe("active");
    expect(offerPhase({}, now)).toBe("active");
  });
});

describe("product imageAssetId", () => {
  it("accepts an optional imageAssetId and keeps it out of required fields", () => {
    expect(productRecordData.safeParse({ name: "Latte", imageAssetId: "as_123" }).success).toBe(true);
    expect(productRecordData.safeParse({ name: "Latte" }).success).toBe(true);
    expect(productRecordData.safeParse({ name: "Latte", imageAssetId: 5 }).success).toBe(false);
  });
});

describe("product category", () => {
  it("accepts an optional category ≤40 chars", () => {
    expect(productRecordData.safeParse({ name: "Latte", category: "Coffee" }).success).toBe(true);
    expect(productRecordData.safeParse({ name: "Latte", category: "x".repeat(41) }).success).toBe(false);
    expect(productRecordData.safeParse({ name: "Latte" }).success).toBe(true);
  });
});

describe("distinctCategories", () => {
  const rec = (name: string, category?: string, status = "active", kind = "product") =>
    ({ kind, status, data: { name, ...(category ? { category } : {}) } });
  it("derives first-seen-casing distinct list from active products only", () => {
    const list = distinctCategories([
      rec("A", "Coffee"), rec("B", "coffee"), rec("C", "Merch"),
      rec("D", "Seasonal", "archived"), rec("E"), rec("F", "Tea", "active", "offer"),
    ]);
    expect(list).toEqual(["Coffee", "Merch"]);
  });
  it("empty input → empty list", () => expect(distinctCategories([])).toEqual([]));
});
