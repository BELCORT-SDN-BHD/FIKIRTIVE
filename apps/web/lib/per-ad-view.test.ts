import { describe, it, expect } from "vitest";
import { buildPerAdView } from "./per-ad-view";
import type { OwnerAdPerformance } from "./meta-performance";

const base: OwnerAdPerformance = {
  ads: [
    { adId: "a1", adName: "Ad One", accountId: "act_1",
      metrics: { spend: "612", reach: "41200", ctr: "2.1", cpc: "0.28", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: "3.4" },
      creative: { imageUrl: "http://i", body: "b", title: "Raya Reel", videoId: null } },
    { adId: "a2", adName: "Ad Two", accountId: "act_1",
      metrics: { spend: "388", reach: "33100", ctr: "0.4", cpc: "1.12", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: null },
      creative: { imageUrl: null, body: null, title: null, videoId: "v9" } },
  ],
  truncated: true, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "2026-07-03T10:00:00.000Z",
};

describe("buildPerAdView", () => {
  it("formats metrics: spend thousands, ctr %, roas ×, null roas → —", () => {
    const v = buildPerAdView(base);
    const m = Object.fromEntries(v.rows[0]!.metrics.map((x) => [x.label, x.value]));
    expect(m.Spend).toBe("612");
    expect(m.Reach).toBe("41,200");
    expect(m.CTR).toBe("2.1%");
    expect(m.CPC).toBe("0.28");
    expect(m.ROAS).toBe("3.4×");
    const m2 = Object.fromEntries(v.rows[1]!.metrics.map((x) => [x.label, x.value]));
    expect(m2.ROAS).toBe("—"); // null ROAS honest
  });

  it("names from creative.title, falls back to adName then Untitled; flags video", () => {
    const v = buildPerAdView(base);
    expect(v.rows[0]!.name).toBe("Raya Reel");
    expect(v.rows[1]!.name).toBe("Ad Two");     // no title → adName
    expect(v.rows[1]!.creative.isVideo).toBe(true);
    expect(v.rows[0]!.creative.isVideo).toBe(false);
  });

  it("source stamp carries platform + range + fetched date; truncated note honest", () => {
    const v = buildPerAdView(base);
    expect(v.stamp).toMatch(/^Meta ·/);
    expect(v.stamp).toMatch(/30 days/);
    expect(v.stamp).toMatch(/fetched/);
    expect(v.truncatedNote).toBe("Showing your top 2 ads by spend.");
  });

  it("no truncated note when not truncated", () => {
    expect(buildPerAdView({ ...base, truncated: false }).truncatedNote).toBeNull();
  });

  it("garbage (non-numeric, non-empty) metric strings render — not NaN (anti-fabrication)", () => {
    const garbage: OwnerAdPerformance = {
      ...base,
      ads: [
        { adId: "a3", adName: "Ad Three", accountId: "act_1",
          metrics: { spend: "n/a", reach: "n/a", ctr: "n/a", cpc: "n/a", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: "n/a" },
          creative: { imageUrl: null, body: null, title: null, videoId: null } },
      ],
    };
    const v = buildPerAdView(garbage);
    const m = Object.fromEntries(v.rows[0]!.metrics.map((x) => [x.label, x.value]));
    expect(m.Spend).toBe("—");
    expect(m.Reach).toBe("—");
    expect(m.CTR).toBe("—");
    expect(m.CPC).toBe("—");
    expect(m.ROAS).toBe("—");
  });
});
