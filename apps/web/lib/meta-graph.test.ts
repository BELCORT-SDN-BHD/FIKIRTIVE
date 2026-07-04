import { describe, it, expect, vi, afterEach } from "vitest";
import { getAdInsights, getAdCreative, readMetricFields } from "./meta-graph";

function mockFetchOnce(json: unknown, ok = true) {
  return vi.spyOn(global, "fetch" as never).mockResolvedValueOnce({ ok, json: async () => json } as never);
}
afterEach(() => vi.restoreAllMocks());

describe("readMetricFields", () => {
  it("extracts metric strings and unwraps array purchase_roas", () => {
    const m = readMetricFields({ spend: "12.5", ctr: "1.2", purchase_roas: [{ value: "3.1" }], clicks: 4 });
    expect(m.spend).toBe("12.5");
    expect(m.ctr).toBe("1.2");
    expect(m.purchaseRoas).toBe("3.1");
    expect(m.clicks).toBe("4");
    expect(m.reach).toBeNull();
  });
});

describe("getAdInsights (level=ad)", () => {
  it("requests level=ad + ad_id/ad_name and maps rows", async () => {
    const fetchSpy = mockFetchOnce({ data: [{ ad_id: "a1", ad_name: "Ad One", spend: "10", ctr: "0.9" }] });
    const rows = await getAdInsights("TOK", "act_1", "last_30d");
    expect(rows).toEqual([{ adId: "a1", adName: "Ad One", spend: "10", ctr: "0.9",
      impressions: null, reach: null, frequency: null, clicks: null, cpc: null, cpm: null, purchaseRoas: null }]);
    const url = (fetchSpy.mock.calls[0]![0] as string);
    expect(url).toContain("level=ad");
    expect(url).toContain("ad_id");
  });
});

describe("getAdCreative", () => {
  it("returns creative fields, falling back thumbnail→image", async () => {
    mockFetchOnce({ creative: { thumbnail_url: "http://t", body: "buy now", title: "T", video_id: "v1" } });
    expect(await getAdCreative("TOK", "a1")).toEqual({ imageUrl: "http://t", body: "buy now", title: "T", videoId: "v1" });
  });
  it("returns null when the ad has no creative", async () => {
    mockFetchOnce({ id: "a1" });
    expect(await getAdCreative("TOK", "a1")).toBeNull();
  });
});
