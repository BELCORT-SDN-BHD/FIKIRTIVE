import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), decryptToken: vi.fn(), metaGraphGet: vi.fn(), getAdInsights: vi.fn(), getAdCreative: vi.fn(),
}));
vi.mock("@fikirtive/db", () => ({ prisma: { metaConnection: { findUnique: h.findUnique, update: vi.fn() } } }));
vi.mock("./token-encryption", () => ({ decryptToken: h.decryptToken }));
vi.mock("./meta-graph", () => ({ metaGraphGet: h.metaGraphGet, getAdInsights: h.getAdInsights, getAdCreative: h.getAdCreative }));

import { fetchOwnerAdPerformance, MAX_ADS } from "./meta-performance";

beforeEach(() => { vi.clearAllMocks(); h.decryptToken.mockReturnValue("TOK"); });

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
    if ("needsReconnect" in r || "notConnected" in r) throw new Error("unexpected");
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
    if ("needsReconnect" in r || "notConnected" in r) throw new Error("unexpected");
    expect(r.ads).toHaveLength(MAX_ADS);
    expect(r.truncated).toBe(true);
    expect(r.ads[0]!.adId).toBe(`a${MAX_ADS + 4}`); // highest spend first
  });
});
