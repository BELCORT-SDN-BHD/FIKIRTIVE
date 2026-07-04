/**
 * meta-expert.helpers — PURE payload factory for PERFORMANCE_CARD.
 * Packages P2a's diagnosePerformance() output (verdicts/metricUsed/basis/note) + display
 * metadata (date range, fetch stamp, truncation, ad creatives) into the chat message payload.
 * No re-derivation: the diagnosis engine already computed verdicts/reasons/citations — this
 * factory must not alter/re-derive any of it (mirrors buildResearchCardPayload / buildPerAdView).
 */
import type { AdVerdict, PerformanceDiagnosis } from "../diagnosis/diagnose-performance.js";

export type PerfCardAd = { adId: string; imageUrl: string | null; isVideo: boolean };

export type PerformanceCardPayload = {
  datePreset: string;
  fetchedAt: string;
  truncated: boolean;
  metricUsed: string;
  basis: string;
  note: string | null;
  verdicts: AdVerdict[];
  ads: PerfCardAd[];
};

/** 纯:diagnosis 输出 + 展示元数据 → payload。不改写/不重算任何 verdict/metric/reason/citation。 */
export function buildPerformanceCardPayload(input: {
  diagnosis: PerformanceDiagnosis;
  datePreset: string;
  fetchedAt: string;
  truncated: boolean;
  ads: PerfCardAd[];
}): PerformanceCardPayload {
  return {
    datePreset: input.datePreset,
    fetchedAt: input.fetchedAt,
    truncated: input.truncated,
    metricUsed: input.diagnosis.metricUsed,
    basis: input.diagnosis.basis,
    note: input.diagnosis.note,
    verdicts: input.diagnosis.verdicts,
    ads: input.ads,
  };
}
