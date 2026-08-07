import { describe, it, expect } from "vitest";
import { metaAdPerformanceSkill, executeMetaAdPerformance } from "./meta-ad-performance.js";

describe("metaAdPerformanceSkill gate", () => {
  it("is a free external read → no approval", () => {
    expect(metaAdPerformanceSkill.cost).toBe("free");
    expect(metaAdPerformanceSkill.effect).toBe("read");
    expect(metaAdPerformanceSkill.reach).toBe("external");
    expect(metaAdPerformanceSkill.needsApproval).toBe(false);
  });
});

// #692 r3: the port hands over FINISHED money text, never a bare amount. These fixtures
// mirror that shape — the web-side boundary (lib/otto-money-view.ts) builds it.
const adRow = (
  adId: string,
  accountId: string,
  accountName: string,
  currency: string | null,
  spend: string,
  moneyBucket: string,
) => ({
  adId, adName: adId, accountId, accountName, currency, moneyBucket,
  money: { spend, cpc: "—", cpm: "—" },
  hasSpend: true,
  metrics: { impressions: null, reach: null, frequency: null, clicks: null, ctr: "1.0", purchaseRoas: null },
  creative: null,
});

const withAds = (ads: ReturnType<typeof adRow>[], truncated = false, organic: unknown = { posts: [] }) => ({
  metaPerformance: {
    getAds: async () => ({ ads, truncated, organic, datePreset: "last_30d", fetchedAt: "t" }),
  },
});

describe("executeMetaAdPerformance", () => {
  it("messages when the port is absent (not connected)", async () => {
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: {} as never });
    expect(JSON.stringify(r)).toMatch(/connect/i);
  });

  it("passes through ads + truncated + organic honestly", async () => {
    const ctx = withAds([adRow("a1", "act_1", "Kaia Cafe", "MYR", "MYR 10", "MYR")], true, { status: "pending_permission" });
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never }) as Record<string, unknown>;
    expect(r.truncated).toBe(true);
    expect(r.organic).toEqual({ status: "pending_permission" });
    expect((r.ads as unknown[]).length).toBe(1);
  });

  // #692 判官 r1: Otto retells these numbers in chat, so the currency has to reach it too —
  // and it must be told never to rank MYR spend against SGD spend.
  it("passes each ad's currency through to chat", async () => {
    const ctx = withAds([
      adRow("a1", "act_1", "Kaia Cafe", "MYR", "MYR 10", "MYR"),
      adRow("b1", "act_2", "Night Market", "SGD", "SGD 30", "SGD"),
    ]);
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never });
    expect(JSON.stringify(r)).toContain("MYR");
    expect(JSON.stringify(r)).toContain("SGD");
  });

  // #692 r3 pin ① — the load-bearing one. Three rounds of telling the model "don't add these"
  // failed; what it receives must not BE addable.
  it("#692 r3: hands the model no bare per-ad amount it could add across accounts", async () => {
    const ctx = withAds([
      adRow("a1", "act_1", "Kaia Cafe", "MYR", "MYR 10", "MYR"),
      adRow("b1", "act_2", "Night Market", "SGD", "SGD 30", "SGD"),
    ]);
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never }) as Record<string, unknown>;
    const first = (r.ads as Record<string, unknown>[])[0]!;
    expect(String((first.money as Record<string, string>).spend)).not.toMatch(/^-?[\d,]+(\.\d+)?$/);
    expect((first.metrics as Record<string, unknown>).spend).toBeUndefined();
    expect((first.metrics as Record<string, unknown>).cpc).toBeUndefined();
    expect((first.metrics as Record<string, unknown>).cpm).toBeUndefined();
  });

  // #692 r3 pin ② — two ad accounts Meta reported no currency for.
  it("#692 r3: two unlabelled ad accounts stay separate, and the rule rides along", async () => {
    const ctx = withAds([
      adRow("a1", "act_1", "Kaia Cafe", null, "20 (currency not reported — Kaia Cafe)", "unknown:act_1"),
      adRow("b1", "act_2", "Night Market", null, "30 (currency not reported — Night Market)", "unknown:act_2"),
    ]);
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never }) as Record<string, unknown>;
    const rule = String(r.moneyRule);
    expect(rule).toContain("moneyBucket");
    expect(rule).toContain("never add, rank or compare");
    expect(rule).toContain("no currency");
    const ads = r.ads as Record<string, unknown>[];
    expect(ads[0]!.moneyBucket).not.toBe(ads[1]!.moneyBucket);
  });

  // #692 r2 [P2]: pin the PROMISE, not the word. A description that merely says "currency"
  // somewhere would pass while telling the model nothing about what it may not do.
  it("the tool description forbids ranking/adding/comparing money across buckets", () => {
    const d = metaAdPerformanceSkill.description;
    expect(d).toContain("never add, rank or compare money across different moneyBucket values");
    expect(d).toContain("no currency");
  });

  it("the tool description still allows ratio metrics to be compared across currencies", () => {
    const d = metaAdPerformanceSkill.description;
    expect(d).toContain("Ratio metrics (CTR, ROAS) and counts");
    expect(d).toContain("ARE comparable across accounts");
  });
});
