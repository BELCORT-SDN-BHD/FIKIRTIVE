import type { MetaExpertiseKB, MetaCitation } from "../knowledge/meta-expertise.types.js";
import { queryMetaKnowledge } from "../knowledge/meta-expertise.js";

export type DiagAdInput = { adId: string; adName: string | null; metrics: Record<string, string | null> };
export type DiagReasonKind = "creative" | "runtime" | "budget" | "targeting" | "data-gap";
export type DiagReason = { kind: DiagReasonKind; text: string; grounded: boolean; citations: MetaCitation[] };
export type AdVerdict = {
  adId: string; name: string; verdict: "winner" | "loser" | "neutral";
  metric: string; value: string; reasons: DiagReason[]; suggestRecreate: boolean;
};
export type PerformanceDiagnosis = { verdicts: AdVerdict[]; metricUsed: string; basis: string; note: string | null };

const finite = (s: string | null): number | null => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const dedupeCitations = (cs: MetaCitation[]): MetaCitation[] => {
  const seen = new Set<string>(); const out: MetaCitation[] = [];
  for (const c of cs) if (!seen.has(c.url)) { seen.add(c.url); out.push(c); }
  return out;
};

/** Deterministic, KB-grounded performance diagnosis. Winners/losers are defined RELATIVE TO the
 *  user's OWN account average (no external benchmark — nothing to fabricate). Creative reasons
 *  carry real KB citations; non-creative causes (runtime/budget/targeting) that this data can't
 *  see are emitted as honest data-gap hypotheses (grounded:false), never asserted. */
export function diagnosePerformance(
  ads: DiagAdInput[], kb: MetaExpertiseKB, opts?: { objective?: string },
): PerformanceDiagnosis {
  const wantRoas = /conversion|sales|purchase/i.test(opts?.objective ?? "");
  const anyRoas = ads.some((a) => finite(a.metrics.purchaseRoas ?? null) != null);
  const useRoas = wantRoas && anyRoas;
  const metricKey = useRoas ? "purchaseRoas" : "ctr";
  const metricUsed = useRoas ? "ROAS" : "CTR";
  const disp = (n: number): string => (useRoas ? `${n}×` : `${n}%`);

  const comparable = ads.map((a) => finite(a.metrics[metricKey] ?? null)).filter((n): n is number => n != null);
  const basis = "compared to your own account average this period";
  if (comparable.length < 2) {
    return {
      verdicts: ads.map((a) => ({ adId: a.adId, name: a.adName || "Untitled ad", verdict: "neutral" as const, metric: metricUsed, value: "—", reasons: [], suggestRecreate: false })),
      metricUsed, basis, note: `Not enough ads with ${metricUsed} data to compare yet.`,
    };
  }
  const mean = comparable.reduce((s, n) => s + n, 0) / comparable.length;
  const meanDisplay = disp(Math.round(mean * 100) / 100);

  // KB grounding (deterministic pick: creative best-practice + a diagnosis principle)
  const creativeCites = dedupeCitations([
    ...queryMetaKnowledge(kb, { domain: "creative" }).flatMap((e) => e.citations),
    ...queryMetaKnowledge(kb, { domain: "diagnosis" }).flatMap((e) => e.citations),
  ]).slice(0, 2);
  const learningCites = dedupeCitations(
    queryMetaKnowledge(kb, { domain: "diagnosis" }).filter((e) => /learning/i.test(e.claim)).flatMap((e) => e.citations),
  ).slice(0, 1);

  const verdicts: AdVerdict[] = ads.map((a) => {
    const n = finite(a.metrics[metricKey] ?? null);
    const spend = finite(a.metrics.spend ?? null) ?? 0;
    const name = a.adName || "Untitled ad";
    if (n == null) return { adId: a.adId, name, verdict: "neutral", metric: metricUsed, value: "—", reasons: [], suggestRecreate: false };
    const value = disp(n);
    if (n >= mean * 1.25) {
      return {
        adId: a.adId, name, verdict: "winner", metric: metricUsed, value, suggestRecreate: true,
        reasons: [{ kind: "creative", grounded: true, citations: [],
          text: `Top performer — ${metricUsed} ${value} is well above your account average (${meanDisplay}).` }],
      };
    }
    if (n <= mean * 0.6 && spend > 0) {
      return {
        adId: a.adId, name, verdict: "loser", metric: metricUsed, value, suggestRecreate: false,
        reasons: [
          { kind: "creative", grounded: true, citations: creativeCites,
            text: `${metricUsed} ${value} is well below your account average (${meanDisplay}) — the creative is the most controllable lever here.` },
          { kind: "data-gap", grounded: false, citations: learningCites,
            text: "Also worth checking what I can't see from here yet: whether it's had time to exit Meta's learning phase, the audience, and the budget." },
        ],
      };
    }
    return { adId: a.adId, name, verdict: "neutral", metric: metricUsed, value, reasons: [], suggestRecreate: false };
  });

  return { verdicts, metricUsed, basis, note: null };
}
