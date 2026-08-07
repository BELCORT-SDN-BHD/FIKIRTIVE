import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), decryptToken: vi.fn(), metaGraphGet: vi.fn(), getAdInsights: vi.fn(), getAdCreative: vi.fn(),
}));
vi.mock("@fikirtive/db", () => ({ prisma: { metaConnection: { findUnique: h.findUnique, update: h.update } } }));
vi.mock("./token-encryption", () => ({ decryptToken: h.decryptToken }));
vi.mock("./meta-graph", () => ({ metaGraphGet: h.metaGraphGet, getAdInsights: h.getAdInsights, getAdCreative: h.getAdCreative }));

import { fetchOwnerAdPerformance, MAX_ADS } from "./meta-performance";

beforeEach(() => { vi.clearAllMocks(); h.decryptToken.mockReturnValue("TOK"); h.update.mockResolvedValue({}); });

describe("fetchOwnerAdPerformance", () => {
  it("notConnected when no MetaConnection", async () => {
    h.findUnique.mockResolvedValue(null);
    expect(await fetchOwnerAdPerformance("o1", "last_30d")).toEqual({ notConnected: true });
  });

  it("needsReconnect when the token won't decrypt", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    h.decryptToken.mockImplementation(() => { throw new Error("bad"); });
    expect(await fetchOwnerAdPerformance("o1", "last_30d")).toEqual({ needsReconnect: true });
  });

  it("returns per-ad rows + creative, organic pending when scope absent", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read,ads_management" });
    h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1" }] });
    h.getAdInsights.mockResolvedValue([{ adId: "a1", adName: "One", spend: "10", ctr: "1.0",
      impressions: null, reach: null, frequency: null, clicks: null, cpc: null, cpm: null, purchaseRoas: null }]);
    h.getAdCreative.mockResolvedValue({ imageUrl: "http://i", body: "b", title: "t", videoId: null });
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    if ("needsReconnect" in r || "notConnected" in r || "transientError" in r) throw new Error("unexpected");
    expect(r.ads).toHaveLength(1);
    expect(r.ads[0]).toMatchObject({ adId: "a1", accountId: "act_1", creative: { imageUrl: "http://i" } });
    expect(r.ads[0]!.metrics.spend).toBe("10");
    expect(r.truncated).toBe(false);
    expect(r.organic).toEqual({ status: "pending_permission" });
    expect(r.datePreset).toBe("last_30d");
  });

  it("bounds to MAX_ADS by spend and flags truncated", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1" }] });
    const many = Array.from({ length: MAX_ADS + 5 }, (_, i) => ({ adId: `a${i}`, adName: null, spend: String(i),
      impressions: null, reach: null, frequency: null, clicks: null, ctr: null, cpc: null, cpm: null, purchaseRoas: null }));
    h.getAdInsights.mockResolvedValue(many);
    h.getAdCreative.mockResolvedValue(null);
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    if ("needsReconnect" in r || "notConnected" in r || "transientError" in r) throw new Error("unexpected");
    expect(r.ads).toHaveLength(MAX_ADS);
    expect(r.truncated).toBe(true);
    expect(r.ads[0]!.adId).toBe(`a${MAX_ADS + 4}`); // highest spend first
  });

  it("needsReconnect + marks connection expired when me/adaccounts throws code 190", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    const err = new Error("token expired");
    (err as { metaError?: { code?: number } }).metaError = { code: 190 };
    h.metaGraphGet.mockRejectedValue(err);
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    expect(r).toEqual({ needsReconnect: true });
    expect(h.update).toHaveBeenCalledWith({ where: { ownerId: "o1" }, data: { status: "expired" } });
  });

  it("transientError (F37) without marking expired when me/adaccounts throws a non-auth Graph error", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    const err = new Error("rate limited");
    (err as { metaError?: { code?: number } }).metaError = { code: 1 };
    h.metaGraphGet.mockRejectedValue(err);
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    expect(r).toEqual({ transientError: true });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("transientError (F37) without throwing when me/adaccounts throws a plain Error (no metaError)", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
    h.metaGraphGet.mockRejectedValue(new Error("network down"));
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    expect(r).toEqual({ transientError: true });
    expect(h.update).not.toHaveBeenCalled();
  });

  // #692 判官 r1 [P1]: the per-ad chain dropped currency exactly like the KPI chain did —
  // it asked me/adaccounts for `id,account_id` only, then ranked every ad across accounts by
  // raw `spend`. MYR 20 outranking SGD 30 (or vice versa) is not a fact about anything.
  describe("#692 r1: per-ad currency", () => {
    const adRow = (adId: string, spend: string) => ({
      adId, adName: adId, spend, impressions: null, reach: null, frequency: null,
      clicks: null, ctr: null, cpc: "0.12", cpm: null, purchaseRoas: null,
    });

    it("asks Meta for the ad accounts' currency", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", currency: "MYR" }] });
      h.getAdInsights.mockResolvedValue([]);
      await fetchOwnerAdPerformance("o1", "last_30d");
      expect(h.metaGraphGet.mock.calls[0]![2].fields).toContain("currency");
    });

    it("carries each ad's account currency onto the row (null when Meta reported none)", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", currency: "MYR" }, { id: "act_2" }] });
      h.getAdInsights.mockImplementation(async (_t: string, acct: string) =>
        acct === "act_1" ? [adRow("a1", "10")] : [adRow("b1", "5")]);
      h.getAdCreative.mockResolvedValue(null);
      const r = await fetchOwnerAdPerformance("o1", "last_30d");
      if (!("ads" in r)) throw new Error("unexpected");
      expect(r.ads.find((a) => a.adId === "a1")!.currency).toBe("MYR");
      expect(r.ads.find((a) => a.adId === "b1")!.currency).toBeNull();
    });

    it("never orders ads across currencies by raw spend — each currency is its own run", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", currency: "MYR" }, { id: "act_2", currency: "SGD" }] });
      // Raw-magnitude sorting would interleave these: SGD 30, MYR 20, SGD 9, MYR 8.
      h.getAdInsights.mockImplementation(async (_t: string, acct: string) =>
        acct === "act_1" ? [adRow("myr_hi", "20"), adRow("myr_lo", "8")]
                         : [adRow("sgd_hi", "30"), adRow("sgd_lo", "9")]);
      h.getAdCreative.mockResolvedValue(null);
      const r = await fetchOwnerAdPerformance("o1", "last_30d");
      if (!("ads" in r)) throw new Error("unexpected");
      expect(r.ads.map((a) => a.adId)).toEqual(["myr_hi", "myr_lo", "sgd_hi", "sgd_lo"]);
    });

    it("the MAX_ADS cap can't let one currency crowd another out entirely", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", currency: "MYR" }, { id: "act_2", currency: "SGD" }] });
      // MYR alone would fill the cap, and every MYR figure is numerically larger than every SGD one.
      const myr = Array.from({ length: MAX_ADS + 10 }, (_, i) => adRow(`myr_${i}`, String(1000 + i)));
      const sgd = [adRow("sgd_1", "3"), adRow("sgd_2", "2")];
      h.getAdInsights.mockImplementation(async (_t: string, acct: string) => (acct === "act_1" ? myr : sgd));
      h.getAdCreative.mockResolvedValue(null);
      const r = await fetchOwnerAdPerformance("o1", "last_30d");
      if (!("ads" in r)) throw new Error("unexpected");
      expect(r.ads).toHaveLength(MAX_ADS);
      expect(r.ads.some((a) => a.currency === "SGD")).toBe(true);
      expect(r.truncated).toBe(true);
    });
  });

  it("organic is { posts: [] } when organic scope is granted", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read,pages_read_engagement" });
    h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1" }] });
    h.getAdInsights.mockResolvedValue([]);
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    if ("needsReconnect" in r || "notConnected" in r || "transientError" in r) throw new Error("unexpected");
    expect(r.organic).toEqual({ posts: [] });
  });
});
