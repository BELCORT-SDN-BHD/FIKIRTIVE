import { RANGES, currencyCode, moneyBucketKey } from "./analytics-view";
import type { OwnerAdPerformance } from "./meta-performance";

/** Heading prefix for a run of ads whose currency Meta never reported. It always names the
 *  account, because such runs are PER ACCOUNT (#692 r2) and there can be several. */
const UNKNOWN_CURRENCY_LABEL = "Currency not reported";

export type PerAdMetric = { label: string; value: string };
export type PerAdDisplayRow = {
  adId: string; name: string;
  /** ISO code this row's money is in, or null when Meta reported none. */
  currency: string | null;
  /** Set on the FIRST row of each currency run, so the list reads as separate runs rather than
   *  one ranking (#692). null on the rest, and on every row when there is a single known
   *  currency — one currency needs no heading, but an unknown run always gets named. */
  groupLabel: string | null;
  creative: { imageUrl: string | null; isVideo: boolean };
  metrics: PerAdMetric[];
};
export type PerAdView = {
  rows: PerAdDisplayRow[];
  stamp: string;
  truncatedNote: string | null;
  /** Says out loud that the runs are not one ranking, when more than one currency is present. */
  currencyNote: string | null;
};

// Parses a Meta numeric string; null for null/""/non-numeric — never a stray "NaN" on screen
// (a garbage string must render "—", not "NaN"/"NaN×"/"NaN%": anti-fabrication rule).
function parse(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

const num = (s: string | null): string => { const n = parse(s); return n == null ? "—" : n.toLocaleString("en-US"); };
const dec = (s: string | null): string => { const n = parse(s); return n == null ? "—" : String(n); }; // trims trailing zeros
const pct = (s: string | null): string => { const n = parse(s); return n == null ? "—" : `${n}%`; };
const roas = (s: string | null): string => { const n = parse(s); return n == null ? "—" : `${n}×`; };
// Money carries the ad account's currency code (#692). A missing value stays "—" — a lone
// currency code with no figure behind it would be worse than saying nothing.
const money = (s: string | null, currency: string | null): string => {
  const text = dec(s);
  const code = currencyCode(currency);
  return text === "—" || !code ? text : `${code} ${text}`;
};

function rangeLabel(preset: string): string {
  // getAdPerformance's datePreset is the Meta preset form ("last_30d"); RANGES.preset matches it
  // (RANGES.key is the short "30d" form — do NOT match on key here).
  return RANGES.find((r) => r.preset === preset)?.label ?? preset;
}
function fmtDate(iso: string): string {
  // iso date only — avoid locale/timezone surprises: "2026-07-03" → "Jul 3"
  const [, m, d] = iso.slice(0, 10).split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)];
  return `${mon} ${Number(d)}`;
}

/** Shape the owner's per-ad performance into a display model. Pure — no fetch, no I/O.
 *  Every number stays as Meta returned it (no invented values); null → "—". */
export function buildPerAdView(perf: OwnerAdPerformance): PerAdView {
  // fetchOwnerAdPerformance already emits the ads grouped into money-bucket runs (same
  // moneyBucketKey authority the KPI cards use); here we only mark where each run starts. A
  // known currency gets a heading once there is more than one run; a run we could not label is
  // headed ALWAYS — even as the only run — and names its account, because two such runs are two
  // different accounts and must not read as one pool (#692 r2).
  const runKeys = perf.ads.map((a) => moneyBucketKey({ accountId: a.accountId, currency: a.currency ?? null }));
  const runCount = new Set(runKeys).size;

  const rows: PerAdDisplayRow[] = perf.ads.map((a, i) => {
    const key = runKeys[i]!;
    const startsRun = i === 0 || runKeys[i - 1] !== key;
    const code = currencyCode(a.currency ?? null);
    const unlabelled = code === "";
    const heading = unlabelled
      ? `${UNKNOWN_CURRENCY_LABEL} — ${a.accountName?.trim() || a.accountId}`
      : code;
    return {
      adId: a.adId,
      name: a.creative?.title || a.adName || "Untitled ad",
      currency: a.currency ?? null,
      groupLabel: startsRun && (runCount > 1 || unlabelled) ? heading : null,
      creative: { imageUrl: a.creative?.imageUrl ?? null, isVideo: !!a.creative?.videoId },
      metrics: [
        { label: "Spend", value: money(a.metrics.spend ?? null, a.currency ?? null) },
        { label: "Reach", value: num(a.metrics.reach ?? null) },
        { label: "CTR", value: pct(a.metrics.ctr ?? null) },
        { label: "CPC", value: money(a.metrics.cpc ?? null, a.currency ?? null) },
        { label: "ROAS", value: roas(a.metrics.purchaseRoas ?? null) },
      ],
    };
  });

  return {
    rows,
    stamp: `Meta · ${rangeLabel(perf.datePreset)} · fetched ${fmtDate(perf.fetchedAt)}`,
    // With several currencies "top N by spend" is only true inside each run — say so rather
    // than letting the note imply one league table.
    truncatedNote: perf.truncated
      ? `Showing your top ${perf.ads.length} ads by spend${runCount > 1 ? " within each currency" : ""}.`
      : null,
    currencyNote:
      runCount > 1
        ? "Your ad accounts use more than one currency, so ads are grouped by currency and never ranked against each other."
        : null,
  };
}
