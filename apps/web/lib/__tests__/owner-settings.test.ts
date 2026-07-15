import { describe, it, expect } from "vitest";
import { mergeSettings, DEFAULT_SETTINGS } from "../owner-settings";

describe("mergeSettings", () => {
  it("returns defaults for null/garbage", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });
  it("overlays known keys, ignores unknown, keeps defaults for missing", () => {
    const r = mergeSettings({
      autoPublish: true,
      spendCapCredits: 50,
      vipMinSpendMyr: 725,
      vipRecentOrderDays: 120,
      bogus: 1,
    });
    expect(r.autoPublish).toBe(true);
    expect(r.spendCapCredits).toBe(50);
    expect(r.vipMinSpendMyr).toBe(725);
    expect(r.vipRecentOrderDays).toBe(120);
    expect(r.notifyEmail).toBe(DEFAULT_SETTINGS.notifyEmail);
    expect("bogus" in r).toBe(false);
  });
  it("coerces wrong types back to default (fail-safe)", () => {
    const r = mergeSettings({
      autoPublish: "yes",
      spendCapCredits: "lots",
      vipMinSpendMyr: "500",
      vipRecentOrderDays: "90",
    });
    expect(r.autoPublish).toBe(DEFAULT_SETTINGS.autoPublish);
    expect(r.spendCapCredits).toBe(DEFAULT_SETTINGS.spendCapCredits);
    expect(r.vipMinSpendMyr).toBe(DEFAULT_SETTINGS.vipMinSpendMyr);
    expect(r.vipRecentOrderDays).toBe(DEFAULT_SETTINGS.vipRecentOrderDays);
  });

  it("keeps the owner-adjustable VIP defaults in the settings layer", () => {
    expect(DEFAULT_SETTINGS.vipMinSpendMyr).toBe(500);
    expect(DEFAULT_SETTINGS.vipRecentOrderDays).toBe(90);
    expect(mergeSettings(null)).toMatchObject({ vipMinSpendMyr: 500, vipRecentOrderDays: 90 });
  });
});
