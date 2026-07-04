import { describe, it, expect } from "vitest";
import { buildPerformanceCardPayload } from "./meta-expert.helpers.js";
import type { AdVerdict, PerformanceDiagnosis } from "../diagnosis/diagnose-performance.js";

describe("buildPerformanceCardPayload", () => {
  it("透传 diagnosis 输出零篡改(verdicts/metricUsed/basis/note 原样)", () => {
    const verdicts: AdVerdict[] = [
      {
        adId: "ad_1",
        name: "Summer sale",
        verdict: "winner",
        metric: "CTR",
        value: "3.2%",
        suggestRecreate: true,
        reasons: [
          {
            kind: "creative",
            grounded: true,
            citations: [{ url: "https://business.meta.com/x", title: "Meta best practice", retrievedAt: "2026-06-01" }],
            text: "Top performer — CTR 3.2% is well above your account average (1.5%).",
          },
        ],
      },
      {
        adId: "ad_2",
        name: "Clearance",
        verdict: "loser",
        metric: "CTR",
        value: "0.4%",
        suggestRecreate: false,
        reasons: [
          { kind: "creative", grounded: true, citations: [], text: "Below average." },
          { kind: "data-gap", grounded: false, citations: [], text: "Also worth checking learning phase." },
        ],
      },
    ];
    const diagnosis: PerformanceDiagnosis = {
      verdicts,
      metricUsed: "CTR",
      basis: "compared to your own account average this period",
      note: null,
    };

    const payload = buildPerformanceCardPayload({
      diagnosis,
      datePreset: "last_30d",
      fetchedAt: "2026-07-03T10:00:00.000Z",
      truncated: true,
      ads: [
        { adId: "ad_1", imageUrl: "https://img/1.jpg", isVideo: false },
        { adId: "ad_2", imageUrl: null, isVideo: true },
      ],
    });

    // verdicts pass through verbatim — same reference-equal content, not re-derived.
    expect(payload.verdicts).toEqual(verdicts);
    expect(payload.verdicts).toBe(diagnosis.verdicts);
    expect(payload.metricUsed).toBe("CTR");
    expect(payload.basis).toBe("compared to your own account average this period");
    expect(payload.note).toBeNull();

    // display metadata packaged as given
    expect(payload.datePreset).toBe("last_30d");
    expect(payload.fetchedAt).toBe("2026-07-03T10:00:00.000Z");
    expect(payload.truncated).toBe(true);
    expect(payload.ads).toEqual([
      { adId: "ad_1", imageUrl: "https://img/1.jpg", isVideo: false },
      { adId: "ad_2", imageUrl: null, isVideo: true },
    ]);
  });

  it("a verdict/reason/citation in → identical out (single-ad, verbatim spot check)", () => {
    const verdict: AdVerdict = {
      adId: "ad_9",
      name: "Untitled ad",
      verdict: "neutral",
      metric: "ROAS",
      value: "—",
      suggestRecreate: false,
      reasons: [],
    };
    const diagnosis: PerformanceDiagnosis = {
      verdicts: [verdict],
      metricUsed: "ROAS",
      basis: "compared to your own account average this period",
      note: "Not enough ROAS signal to compare yet.",
    };

    const payload = buildPerformanceCardPayload({
      diagnosis,
      datePreset: "last_7d",
      fetchedAt: "2026-07-03T00:00:00.000Z",
      truncated: false,
      ads: [],
    });

    expect(payload.verdicts[0]).toEqual(verdict);
    expect(payload.note).toBe("Not enough ROAS signal to compare yet.");
    expect(payload.ads).toEqual([]);
    expect(payload.truncated).toBe(false);
  });
});
