import { describe, it, expect } from "vitest";
import {
  productRecordData, segmentRecordData, offerRecordData,
  recordSchemaFor, recordName, normalizeNameKey, offerPhase,
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
