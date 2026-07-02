"use server";
import type { AccountMetrics } from "./meta-graph";
import { fetchOwnerInsights, fetchOwnerInsightsSeries } from "./meta-insights";
import { RANGES, type RangeKey, buildKpis, buildChart, buildInsightText, type Kpi, type ChartPoint } from "./analytics-view";
import { requireOwner } from "./auth-guard";

export type AnalyticsData =
  | { state: "notConnected" }
  | { state: "needsReconnect" }
  | {
      state: "ready";
      range: RangeKey;
      kpis: Kpi[];
      chart: { linePath: string; areaPath: string; points: ChartPoint[] } | null;
      insight: { text: string; prefill: string } | null;
      empty: boolean;
    };

// Chart geometry matches the ui_kit viewBox (Task 4 renders into an 820×180 <svg>).
const CHART_W = 820;
const CHART_H = 180;

/** An account carries no signal when every numeric-ish metric field is null. */
function metricsAllNull(m: AccountMetrics): boolean {
  return (Object.values(m) as (string | null)[]).every((v) => v == null);
}

/**
 * Session-scoped read for the Analytics screen. Parses the requested range, resolves
 * the owner from the SESSION (see auth-guard), fetches both Meta insight shapes in
 * parallel, and maps the connection state → a ready view payload (KPIs + SVG chart +
 * OTTO insight) or a connect/reconnect prompt. Read-only; no spend paths.
 */
export async function getAnalytics(raw: unknown): Promise<AnalyticsData> {
  // Validate the requested range against RANGES; invalid/missing → "30d".
  const requested = (raw as { range?: unknown } | null | undefined)?.range;
  const range: RangeKey = RANGES.some((r) => r.key === requested)
    ? (requested as RangeKey)
    : "30d";
  const preset = RANGES.find((r) => r.key === range)!.preset;

  // SECURITY: this module is "use server", so getAnalytics is a client-invocable Server
  // Action. Resolve the owner from the SESSION and IGNORE any caller-supplied id — a forged
  // ownerId must never read another org's ad insights. An unauthed caller sees the connect
  // prompt (notConnected), not an error.
  const gate = await requireOwner();
  if ("error" in gate) return { state: "notConnected" };

  const [insightsResult, seriesResult] = await Promise.all([
    fetchOwnerInsights(gate.ownerId, preset),
    fetchOwnerInsightsSeries(gate.ownerId, preset),
  ]);

  // notConnected takes precedence over needsReconnect (a not-yet-connected owner should
  // see the connect prompt, never a "reconnect" one).
  if ("notConnected" in insightsResult || "notConnected" in seriesResult) return { state: "notConnected" };
  if ("needsReconnect" in insightsResult || "needsReconnect" in seriesResult) return { state: "needsReconnect" };

  const series = seriesResult.series;
  const totals = insightsResult.accounts.map((a) => a.metrics);

  const kpis = buildKpis(series, totals);
  const chart = series.length ? buildChart(series, CHART_W, CHART_H) : null;
  const insight = buildInsightText(series);
  const empty = series.length === 0 && totals.every(metricsAllNull);

  return { state: "ready", range, kpis, chart, insight, empty };
}
