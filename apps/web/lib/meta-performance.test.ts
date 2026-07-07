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

  it("organic is { posts: [] } when organic scope is granted", async () => {
    h.findUnique.mockResolvedValue({ ownerId: "o1", accessTokenEnc: "x", scope: "ads_read,pages_read_engagement" });
    h.metaGraphGet.mockResolvedValue({ data: [{ id: "act_1" }] });
    h.getAdInsights.mockResolvedValue([]);
    const r = await fetchOwnerAdPerformance("o1", "last_30d");
    if ("needsReconnect" in r || "notConnected" in r || "transientError" in r) throw new Error("unexpected");
    expect(r.organic).toEqual({ posts: [] });
  });
});
