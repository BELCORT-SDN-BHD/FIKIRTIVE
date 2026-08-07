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

    // #692 r2 [P2]: pin the EXACT round-robin quota, not just "SGD shows up at all".
    // MYR has 30 ads (all numerically larger), SGD has 2, cap is 25. Taking turns:
    // depth 0 → myr_29, sgd_0 (2 taken); depth 1 → myr_28, sgd_1 (4 taken); SGD is then
    // exhausted, so depths 2..22 add one MYR each (21 more) → 25 taken, MYR 23 / SGD 2.
    // Output is emitted run by run: the 23 MYR ads spend-desc, then the 2 SGD ads spend-desc.
    it("the MAX_ADS cap is filled by exact round-robin quota, in run order", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", currency: "MYR" }, { id: "act_2", currency: "SGD" }] });
      const myr = Array.from({ length: 30 }, (_, i) => adRow(`myr_${i}`, String(1000 + i)));
      const sgd = [adRow("sgd_0", "3"), adRow("sgd_1", "2")];
      h.getAdInsights.mockImplementation(async (_t: string, acct: string) => (acct === "act_1" ? myr : sgd));
      h.getAdCreative.mockResolvedValue(null);
      const r = await fetchOwnerAdPerformance("o1", "last_30d");
      if (!("ads" in r)) throw new Error("unexpected");

      expect(MAX_ADS).toBe(25); // the arithmetic above is pinned to this cap
      const expected = [
        ...Array.from({ length: 23 }, (_, i) => `myr_${29 - i}`), // 1029 down to 1007
        "sgd_0",
        "sgd_1",
      ];
      expect(r.ads.map((a) => a.adId)).toEqual(expected);
      expect(r.ads.filter((a) => a.currency === "MYR")).toHaveLength(23);
      expect(r.ads.filter((a) => a.currency === "SGD")).toHaveLength(2);
      expect(r.truncated).toBe(true);
    });

    // #692 r2 [P1]: "Meta didn't say" is not a currency two accounts can share.
    it("two accounts with NO currency are never ranked against each other", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", name: "Kaia Cafe" }, { id: "act_2", name: "Night Market" }] });
      // A raw ranking would interleave: b_hi(30), a_hi(20), b_lo(9), a_lo(8).
      h.getAdInsights.mockImplementation(async (_t: string, acct: string) =>
        acct === "act_1" ? [adRow("a_hi", "20"), adRow("a_lo", "8")]
                         : [adRow("b_hi", "30"), adRow("b_lo", "9")]);
      h.getAdCreative.mockResolvedValue(null);
      const r = await fetchOwnerAdPerformance("o1", "last_30d");
      if (!("ads" in r)) throw new Error("unexpected");
      expect(r.ads.map((a) => a.adId)).toEqual(["a_hi", "a_lo", "b_hi", "b_lo"]);
      expect(r.ads.map((a) => a.accountName)).toEqual(["Kaia Cafe", "Kaia Cafe", "Night Market", "Night Market"]);
    });

    it("carries the ad account NAME so an unlabelled run can say which account it is", async () => {
      h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read" });
      h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1", currency: "MYR", name: "Kaia Cafe" }] });
      h.getAdInsights.mockResolvedValue([adRow("a1", "10")]);
      h.getAdCreative.mockResolvedValue(null);
      const r = await fetchOwnerAdPerformance("o1", "last_30d");
      if (!("ads" in r)) throw new Error("unexpected");
      expect(r.ads[0]!.accountName).toBe("Kaia Cafe");
      expect(h.metaGraphGet.mock.calls[0]![2].fields).toContain("name");
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
