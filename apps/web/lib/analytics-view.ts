// Pure view builders for the Analytics page (Phase A). No I/O, no spend paths —
// every function here is a total function of its inputs so it can be unit-tested.
// Task 3/4 consume these to render server components + the SVG chart.

import type { DailyMetric, AccountMetrics } from "./meta-graph";

export const RANGES = [
  { key: "7d", label: "Last 7 days", preset: "last_7d" },
  { key: "30d", label: "Last 30 days", preset: "last_30d" },
  { key: "90d", label: "Last 90 days", preset: "last_90d" },
  { key: "365d", label: "Last 12 months", preset: "last_year" },
  { key: "all", label: "All time", preset: "maximum" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

export type Kpi = {
  label: string;
  value: string;
  delta: { dir: "up" | "down" | "flat"; text: string } | null;
};

export type ChartPoint = { x: number; y: number; date: string; value: number; peak: boolean };

// --- formatting -------------------------------------------------------------

/** Compact count formatting: >=10000 → "48.2K" (1dp), 1000..9999 → "3,140", <1000 → raw. */
function compact(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
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
 * Spend/Sales come from the per-account `totals` (deltas null in Phase A — the
 * account totals aren't a time series we can halve, so there's nothing to compare).
 */
export function buildKpis(series: DailyMetric[], totals: AccountMetrics[]): Kpi[] {
  const reach = series.reduce((s, d) => s + d.reach, 0);
  const clicks = series.reduce((s, d) => s + d.clicks, 0);

  const spendVals = totals
    .map((t) => (t.spend == null ? null : Number.parseFloat(t.spend)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const spendStr = spendVals.length ? spendVals.reduce((s, v) => s + v, 0).toFixed(2) : "—";

  // Estimated purchase value = Σ over accounts of (spend × purchaseRoas), skipping an
  // account when either side is null/non-finite. Plain rounded integer with thousands
  // separators — NO currency symbol (no-hardcode-currency rule; a currency prefix is a
  // separate future item). "—" when no account has both spend & roas.
  let salesTotal = 0;
  let salesHasAny = false;
  for (const t of totals) {
    const spend = t.spend == null ? NaN : Number.parseFloat(t.spend);
    const roas = t.purchaseRoas == null ? NaN : Number.parseFloat(t.purchaseRoas);
    if (Number.isFinite(spend) && Number.isFinite(roas)) {
      salesTotal += spend * roas;
      salesHasAny = true;
    }
  }
  const salesStr = salesHasAny ? Math.round(salesTotal).toLocaleString("en-US") : "—";

  return [
    { label: "Reach", value: compact(reach), delta: seriesDelta(series, (d) => d.reach) },
    { label: "Engagement", value: compact(clicks), delta: seriesDelta(series, (d) => d.clicks) },
    // Spend/Sales deltas null in Phase A: totals are a single aggregate per account,
    // not a series, so there's no older half to compare against.
    { label: "Spend", value: spendStr, delta: null },
    { label: "Sales (est.)", value: salesStr, delta: null },
  ];
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
  // Copy tracks the math: `mult` divides by the average of the OTHER days (best
  // excluded), so we say "your typical post", not "your average" (which would read
  // as including the best day). See analytics-view.test.ts for the pinned wording.
  const text = `Your best day was ${best.date} — it reached ${multStr} more than your typical post. Want me to make more like it?`;
  const prefill = `Make more content like my ${best.date} post — it reached ${best.reach} people.`;
  return { text, prefill };
}
