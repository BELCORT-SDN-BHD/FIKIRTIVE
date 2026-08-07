"use server";
import type { AccountMetrics } from "./meta-graph";
import { fetchOwnerInsights, fetchOwnerInsightsSeries } from "./meta-insights";
import { RANGES, type RangeKey, buildKpis, buildChart, buildInsightText, type Kpi, type ChartPoint } from "./analytics-view";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";

export type AnalyticsData =
  | { state: "notConnected" }
  | { state: "needsReconnect" }
  | { state: "transientError" } // F37: Meta unreachable (network/5xx/rate limit) — retry, NOT reconnect
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
  const principal = await resolveUserPrincipal(gate);

  return runAsUser(principal, async (): Promise<AnalyticsData> => {
    const [insightsResult, seriesResult] = await Promise.all([
      fetchOwnerInsights(gate.ownerId, preset),
      fetchOwnerInsightsSeries(gate.ownerId, preset),
    ]);

    // notConnected takes precedence over needsReconnect (a not-yet-connected owner should
    // see the connect prompt, never a "reconnect" one).
    if ("notConnected" in insightsResult || "notConnected" in seriesResult) return { state: "notConnected" };
    if ("needsReconnect" in insightsResult || "needsReconnect" in seriesResult) return { state: "needsReconnect" };
    // F37: a transient Graph failure (either shape) surfaces a retry, never a false reconnect.
    if ("transientError" in insightsResult || "transientError" in seriesResult) return { state: "transientError" };

    const series = seriesResult.series;
    // #692: pass the ACCOUNTS, not just their metrics. Mapping to `.map(a => a.metrics)` here
    // was where each account's currency got dropped, which is what let the KPI builder add a
    // MYR account's spend to an SGD account's and print the result as one bare number.
    const accounts = insightsResult.accounts;

    const kpis = buildKpis(series, accounts);
    const chart = series.length ? buildChart(series, CHART_W, CHART_H) : null;
    const insight = buildInsightText(series);
    const empty = series.length === 0 && accounts.every((a) => metricsAllNull(a.metrics));

    return { state: "ready", range, kpis, chart, insight, empty };
  });
}
