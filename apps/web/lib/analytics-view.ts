// Pure view builders for the Analytics page (Phase A). No I/O, no spend paths —
// every function here is a total function of its inputs so it can be unit-tested.
// Task 3/4 consume these to render server components + the SVG chart.

import type { DailyMetric, AccountMetrics } from "./meta-graph";
import { formatCalendarDay } from "./schedule-view";

export const RANGES = [
  { key: "7d", label: "Last 7 days", preset: "last_7d" },
  { key: "30d", label: "Last 30 days", preset: "last_30d" },
  { key: "90d", label: "Last 90 days", preset: "last_90d" },
  { key: "365d", label: "Last 12 months", preset: "last_year" },
  { key: "all", label: "All time", preset: "maximum" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

/** One display line on a KPI card. */
export type KpiValue = {
  /** The formatted figure — "MYR 1,234.56", a bare "1,234.56", or the "—" no-data placeholder. */
  text: string;
  /** The ISO code this figure is in. null for counts, for "—", and for money whose currency
   *  Meta never reported. */
  currency: string | null;
  /**
   * The ad account this line belongs to — set ONLY when the line is money we could not label,
   * because such a line is one single account's own figure and the reader has to know whose.
   * Non-null therefore means exactly "this figure has no currency on it, and here is where it
   * came from"; the UI keys its caveat off this. Never blank: an account with no name falls
   * back to its id.
   */
  accountName: string | null;
};

export type Kpi = {
  label: string;
  /**
   * The display lines for this card. Counts (Reach, Engagement) and money in a single currency
   * have exactly ONE line. Money spanning several ad-account currencies has one SUBTOTAL PER
   * CURRENCY and no grand total — see #692: an owner can hold a MYR and an SGD ad account, and
   * there is no honest rate here, so the shape itself refuses to produce a cross-currency
   * number. Accounts whose currency Meta never reported get ONE LINE EACH (#692 r2): "Meta
   * didn't say" is not a currency two accounts can be assumed to share.
   */
  values: KpiValue[];
  delta: { dir: "up" | "down" | "flat"; text: string } | null;
};

/**
 * What the KPI builder needs from one ad account: its identity, its insight totals, and the
 * currency those totals are denominated in. Declared structurally (not imported from
 * meta-insights) so this module stays pure. `currency` is the ad ACCOUNT's ISO code — Meta
 * reports currency on the account node only — or null when Meta reported none, in which case
 * the identity is what keeps this account's money apart from every other unlabelled account's.
 */
export type AccountTotals = {
  accountId: string;
  name: string;
  currency: string | null;
  metrics: AccountMetrics;
};

export type ChartPoint = { x: number; y: number; date: string; value: number; peak: boolean };

// --- formatting -------------------------------------------------------------

/** Compact count formatting: >=10000 → "48.2K" (1dp), 1000..9999 → "3,140", <1000 → raw. */
function compact(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** A usable ISO-4217 code is exactly 3 ASCII letters. Anything else (null, "") means the
 *  currency is unknown — we then show a bare number rather than invent a code. Exported so the
 *  per-ad view applies exactly the same test (one authority for "is this a usable code"). */
export function currencyCode(code: string | null): string {
  return typeof code === "string" && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : "";
}

const UNKNOWN_PREFIX = "unknown:";

/**
 * Which pot one account's money goes in. Accounts sharing a KNOWN currency share a pot — that
 * is what makes their subtotal true. An account whose currency Meta never reported gets a pot
 * of its OWN, keyed by account (#692 r2): "Meta didn't say" is not a currency, so two such
 * accounts may not be added together or ranked against each other — doing so would assert a
 * shared denomination that nothing here knows. Single authority for the whole Analytics family:
 * the KPI cards and the per-ad list both bucket through this.
 */
export function moneyBucketKey(account: { accountId: string; currency: string | null }): string {
  const code = currencyCode(account.currency);
  return code === "" ? `${UNKNOWN_PREFIX}${account.accountId}` : code;
}

/** True for a bucket key produced for an account with no usable currency. */
function isUnknownBucket(key: string): boolean {
  return key.startsWith(UNKNOWN_PREFIX);
}

/** A never-blank label for an account, so an unlabelled line can always say where it came from. */
function accountLabel(account: { accountId: string; name: string }): string {
  return account.name.trim() || account.accountId;
}

/** "MYR 1,234.56" — currency code, space, grouped number. Unknown currency drops the prefix. */
function money(n: number, code: string, digits: number): string {
  const num = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return code ? `${code} ${num}` : num;
}

/** Parse a Meta metric string → finite number, or null when absent/unparseable. */
function num(s: string | null): number | null {
  if (s == null) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

type Bucket = { key: string; total: number; label: string };

/**
 * Sum `pick` across accounts into money buckets (see moneyBucketKey). Accounts in different
 * currencies never land in the same bucket, and neither do two accounts whose currency Meta
 * never reported (#692 r2). Accounts contributing nothing (null/unparseable) are skipped and
 * never create an empty bucket. `label` is only meaningful for unknown buckets, where the
 * bucket IS one account.
 */
function sumIntoBuckets(
  accounts: readonly AccountTotals[],
  pick: (m: AccountMetrics) => number | null,
): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  for (const a of accounts) {
    const v = pick(a.metrics);
    if (v == null) continue;
    const key = moneyBucketKey(a);
    const found = out.get(key);
    if (found) found.total += v;
    else out.set(key, { key, total: v, label: accountLabel(a) });
  }
  return out;
}

/** One display line per bucket: the labelled currencies first (by code), then the lines we
 *  could not label (by account), each carrying its account so the UI can say whose it is. No
 *  contributing account at all → the "—" placeholder (no data, which is NOT an unknown
 *  currency). Order is total so the card never reshuffles between renders. */
function moneyValues(buckets: Map<string, Bucket>, digits: number): KpiValue[] {
  if (buckets.size === 0) return [{ text: "—", currency: null, accountName: null }];
  return [...buckets.values()]
    .sort((a, b) => {
      const au = isUnknownBucket(a.key);
      const bu = isUnknownBucket(b.key);
      if (au !== bu) return au ? 1 : -1;
      return a.key.localeCompare(b.key);
    })
    .map((b) =>
      isUnknownBucket(b.key)
        ? { text: money(b.total, "", digits), currency: null, accountName: b.label }
        : { text: money(b.total, b.key, digits), currency: b.key, accountName: null },
    );
}

// --- deltas -----------------------------------------------------------------

/**
 * Period-over-period delta by HALVING the fetched daily series (Phase A has no
 * "previous period" Meta preset, so we compare the recent half to the older half).
 * Needs >=14 points; midpoint floors so the recent half absorbs any odd extra day.
 * Returns null when there aren't enough points or the older half sums to 0.
 */
function seriesDelta(series: DailyMetric[], pick: (d: DailyMetric) => number): Kpi["delta"] {
  if (series.length < 14) return null;
  const mid = Math.floor(series.length / 2);
  const older = series.slice(0, mid).reduce((s, d) => s + pick(d), 0);
  const recent = series.slice(mid).reduce((s, d) => s + pick(d), 0);
  if (older === 0) return null;
  const pct = (recent - older) / older;
  const rounded = Math.round(Math.abs(pct) * 100);
  if (pct > 0.01) return { dir: "up", text: `▲ ${rounded}%` };
  if (pct < -0.01) return { dir: "down", text: `▼ ${rounded}%` };
  return { dir: "flat", text: "flat" };
}

// --- KPIs -------------------------------------------------------------------

/**
 * Exactly 4 KPI cards in order: Reach, Engagement, Spend, Sales (est.).
 * Reach/Engagement come from the daily `series` (with series-halving deltas);
 * Spend/Sales come from the per-account totals (deltas null in Phase A — the
 * account totals aren't a time series we can halve, so there's nothing to compare).
 *
 * Money carries its currency (#692): every money card is subtotalled PER MONEY BUCKET — one
 * bucket per known currency, plus a bucket of its own for each account whose currency Meta
 * never reported (#692 r2). So a merchant holding a MYR and an SGD ad account sees two honest
 * subtotals instead of one meaningless sum, and two unlabelled accounts see one line each
 * rather than a pooled figure asserting they share a denomination. Display only — no rate, no
 * conversion, no spend path.
 */
export function buildKpis(series: DailyMetric[], accounts: readonly AccountTotals[]): Kpi[] {
  const reach = series.reduce((s, d) => s + d.reach, 0);
  const clicks = series.reduce((s, d) => s + d.clicks, 0);

  const spend = moneyValues(sumIntoBuckets(accounts, (m) => num(m.spend)), 2);

  // Estimated purchase value = Σ over accounts of (spend × purchaseRoas), skipping an
  // account when either side is null/unparseable. Rounded integer with thousands
  // separators, prefixed with the account's currency code. "—" when no account has both.
  const salesRaw = sumIntoBuckets(accounts, (m) => {
    const accountSpend = num(m.spend);
    const roas = num(m.purchaseRoas);
    return accountSpend == null || roas == null ? null : accountSpend * roas;
  });
  for (const bucket of salesRaw.values()) bucket.total = Math.round(bucket.total);
  const sales = moneyValues(salesRaw, 0);

  const count = (n: number): KpiValue[] => [{ text: compact(n), currency: null, accountName: null }];

  return [
    { label: "Reach", values: count(reach), delta: seriesDelta(series, (d) => d.reach) },
    { label: "Engagement", values: count(clicks), delta: seriesDelta(series, (d) => d.clicks) },
    // Spend/Sales deltas null in Phase A: totals are a single aggregate per account,
    // not a series, so there's no older half to compare against.
    { label: "Spend", values: spend, delta: null },
    { label: "Sales (est.)", values: sales, delta: null },
  ];
}

/**
 * The two things the KPI grid may need to say about currency — and NOTHING it hasn't
 * established (#692 r3). Keying the multi-currency sentence off "more than one line" was a
 * lie waiting to happen: two accounts Meta reported NO currency for produce two lines and
 * say nothing whatever about currencies. So each sentence is earned separately:
 *  - `multipleCurrencies` needs at least two DIFFERENT known codes;
 *  - `unreportedCurrency` needs at least one line we could not label.
 * Both, either, or neither can apply.
 */
export function buildCurrencyNotes(kpis: readonly Kpi[]): {
  multipleCurrencies: string | null;
  unreportedCurrency: string | null;
} {
  const known = new Set<string>();
  let anyUnreported = false;
  for (const k of kpis) {
    for (const v of k.values) {
      if (v.currency) known.add(v.currency);
      else if (v.accountName !== null) anyUnreported = true;
    }
  }
  return {
    multipleCurrencies:
      known.size >= 2
        ? "Your ad accounts use more than one currency, so spend and sales are shown per currency — never added together or converted."
        : null,
    unreportedCurrency: anyUnreported
      ? "Meta didn’t report a currency for some of your ad accounts. Each of those is shown on its own line, never added to anything else."
      : null,
  };
}

// --- chart ------------------------------------------------------------------

/**
 * SVG geometry for the reach line chart. x evenly spaced 0..width; y inverted so
 * the max-reach day sits at the top (y=0) and 0 sits on the baseline (y=height).
 * Zero-max series flattens to the baseline (no divide-by-zero). Top-3 reach days
 * are flagged `peak`. Empty series → empty paths.
 */
export function buildChart(
  series: DailyMetric[],
  width: number,
  height: number,
): { linePath: string; areaPath: string; points: ChartPoint[] } {
  if (series.length === 0) return { linePath: "", areaPath: "", points: [] };

  const max = series.reduce((m, d) => Math.max(m, d.reach), 0);
  const step = series.length > 1 ? width / (series.length - 1) : 0;

  // Indices of the top-3 reach values (ties broken by original order, deterministic).
  const peakIdx = new Set(
    series
      .map((d, i) => ({ i, reach: d.reach }))
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 3)
      .map((e) => e.i),
  );

  const points: ChartPoint[] = series.map((d, i) => ({
    x: series.length > 1 ? step * i : 0,
    y: max === 0 ? height : height - (d.reach / max) * height,
    date: d.date,
    value: d.reach,
    peak: peakIdx.has(i),
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const areaPath = `${linePath} L ${last.x} ${height} L ${first.x} ${height} Z`;

  return { linePath, areaPath, points };
}

// --- OTTO insight -----------------------------------------------------------

/**
 * "Best day" insight for the OTTO prompt strip: finds the max-reach day and how
 * many times the average of the OTHER days it was. null when there's no signal
 * (empty series or every day at 0 reach). The rest-average is min-guarded at 1 so
 * a single-day series can't divide by zero.
 */
export function buildInsightText(series: DailyMetric[]): { text: string; prefill: string } | null {
  if (series.length === 0) return null;
  const maxReach = series.reduce((m, d) => Math.max(m, d.reach), 0);
  if (maxReach === 0) return null;

  const best = series.reduce((b, d) => (d.reach > b.reach ? d : b), series[0]!);
  const rest = series.filter((d) => d !== best);
  const restAvg = rest.length ? rest.reduce((s, d) => s + d.reach, 0) / rest.length : 0;
  const mult = best.reach / Math.max(restAvg, 1);

  const multStr = `${mult.toFixed(1)}×`;
  // #696: say the day the way the rest of the product says days ("Jun 30"), not the raw
  // "2026-06-30" Meta handed us. Same formatter as Schedule, Spend history and Canvas
  // lineage — one place decides how this product writes a date.
  const dayLabel = formatCalendarDay(best.date);
  // Copy tracks the math: `mult` divides by the average of the OTHER days (best
  // excluded), so we say "your typical post", not "your average" (which would read
  // as including the best day). See analytics-view.test.ts for the pinned wording.
  const text = `Your best day was ${dayLabel} — it reached ${multStr} more than your typical post. Want me to make more like it?`;
  const prefill = `Make more content like my ${dayLabel} post — it reached ${best.reach} people.`;
  return { text, prefill };
}
