import { RANGES } from "./analytics-view";
import type { OwnerAdPerformance } from "./meta-performance";

export type PerAdMetric = { label: string; value: string };
export type PerAdDisplayRow = {
  adId: string; name: string;
  creative: { imageUrl: string | null; isVideo: boolean };
  metrics: PerAdMetric[];
};
export type PerAdView = { rows: PerAdDisplayRow[]; stamp: string; truncatedNote: string | null };

// Parses a Meta numeric string; null for null/""/non-numeric — never a stray "NaN" on screen
// (a garbage string must render "—", not "NaN"/"NaN×"/"NaN%": anti-fabrication rule).
function parse(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

const num = (s: string | null): string => { const n = parse(s); return n == null ? "—" : n.toLocaleString("en-US"); };
const dec = (s: string | null): string => { const n = parse(s); return n == null ? "—" : String(n); }; // trims trailing zeros, no currency symbol
const pct = (s: string | null): string => { const n = parse(s); return n == null ? "—" : `${n}%`; };
const roas = (s: string | null): string => { const n = parse(s); return n == null ? "—" : `${n}×`; };

function rangeLabel(preset: string): string {
  // getAdPerformance's datePreset is the Meta preset form ("last_30d"); RANGES.preset matches it
  // (RANGES.key is the short "30d" form — do NOT match on key here).
  return RANGES.find((r) => r.preset === preset)?.label ?? preset;
}
function fmtDate(iso: string): string {
  // iso date only — avoid locale/timezone surprises: "2026-07-03" → "Jul 3"
  const [y, m, d] = iso.slice(0, 10).split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)];
  return `${mon} ${Number(d)}`;
}

/** Shape the owner's per-ad performance into a display model. Pure — no fetch, no I/O.
 *  Every number stays as Meta returned it (no invented values); null → "—". */
export function buildPerAdView(perf: OwnerAdPerformance): PerAdView {
  const rows: PerAdDisplayRow[] = perf.ads.map((a) => ({
    adId: a.adId,
    name: a.creative?.title || a.adName || "Untitled ad",
    creative: { imageUrl: a.creative?.imageUrl ?? null, isVideo: !!a.creative?.videoId },
    metrics: [
      { label: "Spend", value: dec(a.metrics.spend ?? null) },
      { label: "Reach", value: num(a.metrics.reach ?? null) },
      { label: "CTR", value: pct(a.metrics.ctr ?? null) },
      { label: "CPC", value: dec(a.metrics.cpc ?? null) },
      { label: "ROAS", value: roas(a.metrics.purchaseRoas ?? null) },
    ],
  }));
  return {
    rows,
    stamp: `Meta · ${rangeLabel(perf.datePreset)} · fetched ${fmtDate(perf.fetchedAt)}`,
    truncatedNote: perf.truncated ? `Showing your top ${perf.ads.length} ads by spend.` : null,
  };
}
