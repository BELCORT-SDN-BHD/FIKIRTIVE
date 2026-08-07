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

describe("executeMetaAdPerformance", () => {
  it("messages when the port is absent (not connected)", async () => {
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: {} as never });
    expect(JSON.stringify(r)).toMatch(/connect/i);
  });
  it("passes through ads + truncated + organic honestly", async () => {
    const ctx = { metaPerformance: { getAds: async () => ({ ads: [{ adId: "a1", adName: "One", accountId: "act_1", metrics: { ctr: "1.0" }, creative: null }], truncated: true, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "t" }) } };
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never }) as Record<string, unknown>;
    expect(r.truncated).toBe(true);
    expect(r.organic).toEqual({ status: "pending_permission" });
    expect((r.ads as unknown[]).length).toBe(1);
  });

  // #692 判官 r1: Otto retells these numbers in chat, so the currency has to reach it too —
  // and it must be told never to rank MYR spend against SGD spend.
  it("passes each ad's currency through to chat", async () => {
    const ctx = { metaPerformance: { getAds: async () => ({ ads: [
      { adId: "a1", adName: "One", accountId: "act_1", currency: "MYR", metrics: { spend: "10" }, creative: null },
      { adId: "b1", adName: "Two", accountId: "act_2", currency: "SGD", metrics: { spend: "30" }, creative: null },
    ], truncated: false, organic: { posts: [] }, datePreset: "last_30d", fetchedAt: "t" }) } };
    const r = await executeMetaAdPerformance({ datePreset: "last_30d" }, { context: ctx as never });
    expect(JSON.stringify(r)).toContain("MYR");
    expect(JSON.stringify(r)).toContain("SGD");
  });

  it("the tool description forbids comparing money across currencies", () => {
    expect(metaAdPerformanceSkill.description.toLowerCase()).toContain("currency");
  });
});
