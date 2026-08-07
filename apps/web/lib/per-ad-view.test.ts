import { describe, it, expect } from "vitest";
import { buildPerAdView } from "./per-ad-view";
import type { OwnerAdPerformance } from "./meta-performance";

const base: OwnerAdPerformance = {
  ads: [
    { adId: "a1", adName: "Ad One", accountId: "act_1", accountName: "Kaia Cafe", currency: "MYR",
      metrics: { spend: "612", reach: "41200", ctr: "2.1", cpc: "0.28", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: "3.4" },
      creative: { imageUrl: "http://i", body: "b", title: "Raya Reel", videoId: null } },
    { adId: "a2", adName: "Ad Two", accountId: "act_1", accountName: "Kaia Cafe", currency: "MYR",
      metrics: { spend: "388", reach: "33100", ctr: "0.4", cpc: "1.12", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: null },
      creative: { imageUrl: null, body: null, title: null, videoId: "v9" } },
  ],
  truncated: true, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "2026-07-03T10:00:00.000Z",
};

describe("buildPerAdView", () => {
  it("formats metrics: money with its currency, reach thousands, ctr %, roas ×, null roas → —", () => {
    const v = buildPerAdView(base);
    const m = Object.fromEntries(v.rows[0]!.metrics.map((x) => [x.label, x.value]));
    // #692: money never renders bare — the ad account's currency code rides with it.
    expect(m.Spend).toBe("MYR 612");
    expect(m.Reach).toBe("41,200");
    expect(m.CTR).toBe("2.1%");
    expect(m.CPC).toBe("MYR 0.28");
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
        { adId: "a3", adName: "Ad Three", accountId: "act_1", accountName: "Kaia Cafe", currency: "MYR",
          metrics: { spend: "n/a", reach: "n/a", ctr: "n/a", cpc: "n/a", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: "n/a" },
          creative: { imageUrl: null, body: null, title: null, videoId: null } },
      ],
    };
    const v = buildPerAdView(garbage);
    const m = Object.fromEntries(v.rows[0]!.metrics.map((x) => [x.label, x.value]));
    // a missing figure stays "—" — a lone "MYR" with nothing behind it says less than nothing
    expect(m.Spend).toBe("—");
    expect(m.Reach).toBe("—");
    expect(m.CTR).toBe("—");
    expect(m.CPC).toBe("—");
    expect(m.ROAS).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// #692 判官 r1 [P1]: per-ad money rendered bare, and the whole list was ONE
// cross-account ranking by raw spend — MYR 20 placed above SGD 30 states nothing true.
describe("buildPerAdView — currency (#692 r1)", () => {
  const ad = (adId: string, currency: string | null, accountId = "act_1", accountName: string | null = "Kaia Cafe") => ({
    adId, adName: adId, accountId, accountName, currency,
    metrics: { spend: "10", reach: "500", ctr: "2.5", cpc: "0.12", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: "3.1" },
    creative: null,
  });
  const perf = (ads: ReturnType<typeof ad>[], truncated = false): OwnerAdPerformance => ({ ...base, ads, truncated });
  const metric = (row: { metrics: { label: string; value: string }[] }, label: string): string =>
    row.metrics.find((m) => m.label === label)!.value;

  it("a currency Meta didn't report stays a bare number — never a guessed code", () => {
    const view = buildPerAdView(perf([ad("a1", null)]));
    expect(metric(view.rows[0]!, "Spend")).toBe("10");
    expect(metric(view.rows[0]!, "CPC")).toBe("0.12");
  });

  it("one currency only: no run headings, no cross-currency note", () => {
    const view = buildPerAdView(perf([ad("a1", "MYR"), ad("a2", "MYR")]));
    expect(view.rows.map((r) => r.groupLabel)).toEqual([null, null]);
    expect(view.currencyNote).toBeNull();
  });

  it("several currencies: each run is headed by its code and the list says it is not one ranking", () => {
    const view = buildPerAdView(perf([ad("a1", "MYR"), ad("a2", "MYR"), ad("b1", "SGD")]));
    expect(view.rows.map((r) => r.groupLabel)).toEqual(["MYR", null, "SGD"]);
    expect(view.currencyNote).toBeTruthy();
    expect(view.currencyNote!.toLowerCase()).toContain("currency");
  });

  // #692 r3 [P2]: the multi-currency sentence and the "within each currency" truncation
  // qualifier were keyed off "more than one run" — two accounts with NO reported currency
  // are more than one run but say nothing about currencies. Three states, three answers.
  describe("only claim what is known (#692 r3)", () => {
    it("two DIFFERENT known currencies → currency claim, and truncation says within each currency", () => {
      const view = buildPerAdView(perf([ad("a1", "MYR"), ad("b1", "SGD")], true));
      expect(view.currencyNote).toContain("more than one currency");
      expect(view.unreportedNote).toBeNull();
      expect(view.truncatedNote).toContain("within each currency");
    });

    it("ONE unreported account → no currency claim; truncation must not say within each currency", () => {
      const view = buildPerAdView(perf([ad("a1", null, "act_1", "Kaia Cafe")], true));
      expect(view.currencyNote).toBeNull();
      expect(view.unreportedNote).toBeTruthy();
      expect(view.truncatedNote).not.toContain("within each currency");
    });

    it("TWO unreported accounts → still no currency claim anywhere", () => {
      const view = buildPerAdView(perf([
        ad("a1", null, "act_1", "Kaia Cafe"),
        ad("b1", null, "act_2", "Night Market"),
      ], true));
      expect(view.currencyNote).toBeNull();
      expect(view.unreportedNote).toBeTruthy();
      expect(view.truncatedNote).not.toContain("within each currency");
      expect(view.truncatedNote).toContain("within each ad account");
    });

    it("the same known currency twice is ONE currency: no notes, plain truncation", () => {
      const view = buildPerAdView(perf([ad("a1", "MYR"), ad("a2", "MYR")], true));
      expect(view.currencyNote).toBeNull();
      expect(view.unreportedNote).toBeNull();
      expect(view.truncatedNote).toBe("Showing your top 2 ads by spend.");
    });

    it("known currencies AND an unreported account → both notes", () => {
      const view = buildPerAdView(perf([
        ad("a1", "MYR"), ad("b1", "SGD"), ad("c1", null, "act_3", "Third"),
      ]));
      expect(view.currencyNote).toBeTruthy();
      expect(view.unreportedNote).toBeTruthy();
    });
  });

  it("an unlabelled run is always headed — and names its account — even when it is the only one", () => {
    const view = buildPerAdView(perf([ad("a1", null), ad("a2", null)]));
    expect(view.rows[0]!.groupLabel).toBe("Currency not reported — Kaia Cafe");
    expect(view.rows[1]!.groupLabel).toBeNull();
  });

  // #692 r2 [P1]: two accounts Meta reported no currency for are NOT in one currency.
  it("two unlabelled accounts are two runs, each headed with its own account", () => {
    const view = buildPerAdView(perf([
      ad("a1", null, "act_1", "Kaia Cafe"),
      ad("b1", null, "act_2", "Night Market"),
    ]));
    expect(view.rows.map((r) => r.groupLabel)).toEqual([
      "Currency not reported — Kaia Cafe",
      "Currency not reported — Night Market",
    ]);
    expect(view.currencyNote).toBeTruthy();
  });

  it("an unlabelled run with no account name falls back to the account id", () => {
    const view = buildPerAdView(perf([ad("a1", null, "act_77", null)]));
    expect(view.rows[0]!.groupLabel).toBe("Currency not reported — act_77");
  });

  it("truncation stops claiming one cross-currency ranking once currencies differ", () => {
    expect(buildPerAdView(perf([ad("a1", "MYR")], true)).truncatedNote)
      .toBe("Showing your top 1 ads by spend.");
    expect(buildPerAdView(perf([ad("a1", "MYR"), ad("b1", "SGD")], true)).truncatedNote)
      .toContain("within each currency");
  });
});
