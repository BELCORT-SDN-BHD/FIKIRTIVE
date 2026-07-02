import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountMetrics, DailyMetric } from "../meta-graph";

const { mockRequireOwner, mockFetchInsights, mockFetchSeries } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockFetchInsights: vi.fn(),
  mockFetchSeries: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("../meta-insights", () => ({
  fetchOwnerInsights: mockFetchInsights,
  fetchOwnerInsightsSeries: mockFetchSeries,
}));

import { getAnalytics } from "../analytics-actions";

// --- fixtures ---------------------------------------------------------------

const zeroMetrics: AccountMetrics = {
  spend: null, impressions: null, reach: null, frequency: null,
  clicks: null, ctr: null, cpc: null, cpm: null, purchaseRoas: null,
};

const day = (date: string, reach: number): DailyMetric => ({ date, spend: 0, reach, impressions: 0, clicks: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "o1", email: "a@b.co" });
  mockFetchInsights.mockResolvedValue({ accounts: [] });
  mockFetchSeries.mockResolvedValue({ series: [] });
});

describe("getAnalytics — auth gate", () => {
  it("unauthenticated → notConnected (shows the connect prompt), no fetch", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await getAnalytics({ range: "30d" });
    expect(res).toEqual({ state: "notConnected" });
    expect(mockFetchInsights).not.toHaveBeenCalled();
    expect(mockFetchSeries).not.toHaveBeenCalled();
  });
});

describe("getAnalytics — state mapping", () => {
  it("either fetcher notConnected → notConnected", async () => {
    mockFetchInsights.mockResolvedValue({ notConnected: true });
    mockFetchSeries.mockResolvedValue({ series: [] });
    expect(await getAnalytics({ range: "30d" })).toEqual({ state: "notConnected" });
  });

  it("series fetcher notConnected → notConnected", async () => {
    mockFetchInsights.mockResolvedValue({ accounts: [] });
    mockFetchSeries.mockResolvedValue({ notConnected: true });
    expect(await getAnalytics({ range: "30d" })).toEqual({ state: "notConnected" });
  });

  it("notConnected takes precedence over needsReconnect", async () => {
    mockFetchInsights.mockResolvedValue({ needsReconnect: true });
    mockFetchSeries.mockResolvedValue({ notConnected: true });
    expect(await getAnalytics({ range: "30d" })).toEqual({ state: "notConnected" });
  });

  it("either fetcher needsReconnect (and neither notConnected) → needsReconnect", async () => {
    mockFetchInsights.mockResolvedValue({ needsReconnect: true });
    mockFetchSeries.mockResolvedValue({ series: [] });
    expect(await getAnalytics({ range: "30d" })).toEqual({ state: "needsReconnect" });
  });

  it("series needsReconnect → needsReconnect", async () => {
    mockFetchInsights.mockResolvedValue({ accounts: [] });
    mockFetchSeries.mockResolvedValue({ needsReconnect: true });
    expect(await getAnalytics({ range: "30d" })).toEqual({ state: "needsReconnect" });
  });
});

describe("getAnalytics — ready payload", () => {
  it("builds kpis, chart, insight and returns the resolved range", async () => {
    const series = [day("2026-06-01", 100), day("2026-06-02", 500), day("2026-06-03", 200)];
    mockFetchSeries.mockResolvedValue({ series });
    mockFetchInsights.mockResolvedValue({
      accounts: [{ accountId: "act_1", name: "A", metrics: { ...zeroMetrics, spend: "12.00", purchaseRoas: "2.5" } }],
    });
    const res = await getAnalytics({ range: "7d" });
    expect(res.state).toBe("ready");
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.range).toBe("7d");
    expect(res.kpis).toHaveLength(4);
    expect(res.kpis[0]!.label).toBe("Reach");
    expect(res.chart).not.toBeNull();
    expect(res.chart!.points).toHaveLength(3);
    expect(res.insight).not.toBeNull();
    expect(res.empty).toBe(false);
  });

  it("passes the resolved preset to BOTH fetchers, scoped to the session owner", async () => {
    await getAnalytics({ range: "90d" });
    expect(mockFetchInsights).toHaveBeenCalledWith("o1", "last_90d");
    expect(mockFetchSeries).toHaveBeenCalledWith("o1", "last_90d");
  });
});

describe("getAnalytics — range fallback", () => {
  it("missing range → defaults to 30d (preset last_30d)", async () => {
    const res = await getAnalytics({});
    expect(res.state).toBe("ready");
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.range).toBe("30d");
    expect(mockFetchSeries).toHaveBeenCalledWith("o1", "last_30d");
  });

  it("invalid range → defaults to 30d", async () => {
    const res = await getAnalytics({ range: "bogus" });
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.range).toBe("30d");
    expect(mockFetchSeries).toHaveBeenCalledWith("o1", "last_30d");
  });

  it("non-object raw → defaults to 30d, still ready", async () => {
    const res = await getAnalytics(null);
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.range).toBe("30d");
  });
});

describe("getAnalytics — empty detection", () => {
  it("connected but zero series and all-null totals → empty:true, chart null, insight null", async () => {
    mockFetchSeries.mockResolvedValue({ series: [] });
    mockFetchInsights.mockResolvedValue({
      accounts: [{ accountId: "act_1", name: "A", metrics: { ...zeroMetrics } }],
    });
    const res = await getAnalytics({ range: "30d" });
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.empty).toBe(true);
    expect(res.chart).toBeNull();
    expect(res.insight).toBeNull();
    expect(res.kpis).toHaveLength(4);
  });

  it("no accounts at all and zero series → empty:true", async () => {
    mockFetchSeries.mockResolvedValue({ series: [] });
    mockFetchInsights.mockResolvedValue({ accounts: [] });
    const res = await getAnalytics({ range: "30d" });
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.empty).toBe(true);
  });

  it("zero series but a total carries a metric → empty:false", async () => {
    mockFetchSeries.mockResolvedValue({ series: [] });
    mockFetchInsights.mockResolvedValue({
      accounts: [{ accountId: "act_1", name: "A", metrics: { ...zeroMetrics, spend: "5.00" } }],
    });
    const res = await getAnalytics({ range: "30d" });
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.empty).toBe(false);
  });

  it("has series rows → empty:false even if totals are all null", async () => {
    mockFetchSeries.mockResolvedValue({ series: [day("2026-06-01", 10)] });
    mockFetchInsights.mockResolvedValue({
      accounts: [{ accountId: "act_1", name: "A", metrics: { ...zeroMetrics } }],
    });
    const res = await getAnalytics({ range: "30d" });
    if (res.state !== "ready") throw new Error("unreachable");
    expect(res.empty).toBe(false);
  });
});
