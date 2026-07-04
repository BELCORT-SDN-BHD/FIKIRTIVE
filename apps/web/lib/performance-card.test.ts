import { describe, it, expect } from "vitest";
import { parsePerformanceCardPayload } from "./performance-card";

describe("parsePerformanceCardPayload", () => {
  it("合法 payload → 建 stamp(按 preset 查 RANGES.label + tz-safe fmtDate)", () => {
    const view = parsePerformanceCardPayload({
      datePreset: "last_30d",
      fetchedAt: "2026-07-03T10:00:00.000Z",
      truncated: false,
      metricUsed: "CTR",
      basis: "compared to your own account average this period",
      note: null,
      verdicts: [],
      ads: [],
    });
    expect(view.stamp).toBe("Meta · Last 30 days · fetched Jul 3");
    expect(view.basis).toBe("compared to your own account average this period");
    expect(view.metricUsed).toBe("CTR");
    expect(view.note).toBeNull();
    expect(view.truncatedNote).toBeNull();
  });

  it("truncated=true → truncatedNote 用 ads.length 措辞", () => {
    const view = parsePerformanceCardPayload({
      datePreset: "last_7d",
      fetchedAt: "2026-07-03T00:00:00.000Z",
      truncated: true,
      metricUsed: "CTR",
      basis: "b",
      note: null,
      verdicts: [],
      ads: [
        { adId: "a1", imageUrl: null, isVideo: false },
        { adId: "a2", imageUrl: null, isVideo: false },
      ],
    });
    expect(view.truncatedNote).toBe("Based on your top 2 ads by spend.");
  });

  it("按 verdict 分 winners/losers/neutral,并按 adId join creative(imageUrl/isVideo)", () => {
    const view = parsePerformanceCardPayload({
      datePreset: "last_30d",
      fetchedAt: "2026-07-03T10:00:00.000Z",
      truncated: false,
      metricUsed: "CTR",
      basis: "b",
      note: null,
      verdicts: [
        {
          adId: "ad_1", name: "Winner ad", verdict: "winner", metric: "CTR", value: "3.2%",
          suggestRecreate: true,
          reasons: [{ kind: "creative", grounded: true, citations: [{ url: "https://x", title: "X" }], text: "great" }],
        },
        {
          adId: "ad_2", name: "Loser ad", verdict: "loser", metric: "CTR", value: "0.4%",
          suggestRecreate: false,
          reasons: [{ kind: "data-gap", grounded: false, citations: [], text: "maybe learning phase" }],
        },
        {
          adId: "ad_3", name: "Neutral ad", verdict: "neutral", metric: "CTR", value: "1.1%",
          suggestRecreate: false, reasons: [],
        },
      ],
      ads: [
        { adId: "ad_1", imageUrl: "https://img/1.jpg", isVideo: false },
        { adId: "ad_2", imageUrl: null, isVideo: true },
        // ad_3 has no matching creative entry — should default to null/false
      ],
    });

    expect(view.winners).toHaveLength(1);
    expect(view.losers).toHaveLength(1);
    expect(view.neutral).toHaveLength(1);

    expect(view.winners[0]).toEqual({
      adId: "ad_1", name: "Winner ad", verdict: "winner", metric: "CTR", value: "3.2%",
      reasons: [{ kind: "creative", text: "great", grounded: true, citations: [{ url: "https://x", title: "X" }] }],
      suggestRecreate: true,
      imageUrl: "https://img/1.jpg", isVideo: false,
    });
    expect(view.losers[0].imageUrl).toBeNull();
    expect(view.losers[0].isVideo).toBe(true);
    expect(view.neutral[0].imageUrl).toBeNull();
    expect(view.neutral[0].isVideo).toBe(false);
  });

  it("ROAS 为 null 的 verdict value(\"—\")原样保留,不被当成缺失字段兜底掉", () => {
    const view = parsePerformanceCardPayload({
      datePreset: "last_30d",
      fetchedAt: "2026-07-03T10:00:00.000Z",
      truncated: false,
      metricUsed: "ROAS",
      basis: "b",
      note: "Not enough ROAS signal to compare yet.",
      verdicts: [
        { adId: "ad_1", name: "Ad", verdict: "neutral", metric: "ROAS", value: "—", suggestRecreate: false, reasons: [] },
      ],
      ads: [],
    });
    expect(view.note).toBe("Not enough ROAS signal to compare yet.");
    expect(view.neutral[0].value).toBe("—");
    expect(view.neutral[0].metric).toBe("ROAS");
  });

  it("垃圾 payload(undefined/null/{}/乱字段)→ 空但合法视图,不抛异常", () => {
    for (const bad of [undefined, null, {}, "nope", 42, { verdicts: "nope", ads: 5 }]) {
      expect(() => parsePerformanceCardPayload(bad)).not.toThrow();
      const view = parsePerformanceCardPayload(bad);
      expect(view.winners).toEqual([]);
      expect(view.losers).toEqual([]);
      expect(view.neutral).toEqual([]);
      expect(view.truncatedNote).toBeNull();
      expect(view.note).toBeNull();
      expect(typeof view.stamp).toBe("string");
      expect(typeof view.basis).toBe("string");
      expect(typeof view.metricUsed).toBe("string");
    }
  });

  it("verdicts 数组里混入非法条目(缺 adId/verdict 非法值)→ 过滤而非崩溃", () => {
    const view = parsePerformanceCardPayload({
      datePreset: "last_30d",
      fetchedAt: "2026-07-03T10:00:00.000Z",
      truncated: false,
      metricUsed: "CTR",
      basis: "b",
      note: null,
      verdicts: [
        null,
        { adId: "ad_1", name: "OK ad", verdict: "winner", metric: "CTR", value: "3%", suggestRecreate: true, reasons: [] },
        { adId: "ad_2", name: "Bad verdict", verdict: "weird", metric: "CTR", value: "1%", suggestRecreate: false, reasons: [] },
      ],
      ads: [],
    });
    expect(view.winners).toHaveLength(1);
    expect(view.winners[0].adId).toBe("ad_1");
    // unknown verdict value falls back to neutral rather than being dropped or throwing
    expect(view.neutral.some((r) => r.adId === "ad_2")).toBe(true);
  });

  it("未知 datePreset → rangeLabel 兜底原始 preset 字符串", () => {
    const view = parsePerformanceCardPayload({
      datePreset: "weird_range",
      fetchedAt: "2026-07-03T10:00:00.000Z",
      truncated: false,
      metricUsed: "CTR",
      basis: "b",
      note: null,
      verdicts: [],
      ads: [],
    });
    expect(view.stamp).toBe("Meta · weird_range · fetched Jul 3");
  });
});
