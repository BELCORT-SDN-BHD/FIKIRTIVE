# Analytics (Phase A) Implementation Plan

> ⚠️ **STALE STYLING (2026-07-02): do NOT follow this plan's CSS instructions verbatim.** It was written pre-#80. The S4 shadcn teardown (#80, main `313eb27`) DELETED the `.fk` system and `apps/web/app/otto/otto-theme.css` — the file this plan appends `.fk.gb-skin .cv-an*` rules to no longer exists. Per `2026-06-30-full-shadcn-migration-strategy.md`, Analytics resumes built natively on **`.gb` + shadcn** (components/ui + a shadcn/recharts chart). Restyle this plan onto `.gb` (or regenerate it from the Analytics design spec against current main) before building.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the missing Analytics view with a real, read-only performance page wired to live Meta **ad-account** data — KPI cards, a daily reach/spend chart, an OTTO insight, and a designed "organic past-posts pending Meta approval" section — landing only when the view opens.

**Architecture:** A new server action `getAnalyticsData(range)` (owner-scoped, mirrors the existing `meta-insights.ts` token pattern) fetches per-account period metrics (`getAccountInsights`, exists) plus a new daily series (`getAccountInsightsSeries`), aggregates them with pure, unit-tested builders, and returns `{ state, kpis, series }`. A client `OttoAnalytics` self-fetches on mount + on range change (like `OttoConnections`), rendering KPI cards, a hand-built SVG area chart, an OTTO insight banner, and the past-posts pending state. No charting library, no new Prisma model, no new Meta permission, no spend.

**Tech Stack:** Next.js 16.2.9 (custom fork — read `apps/web/node_modules/next/dist/docs` before any Next-specific code), React 19, server actions (`"use server"` + `requireOwner()`), Vitest. Styling via the otto shell's `.fk` / `.fk.gb-skin` CSS tokens in `apps/web/app/otto/otto-theme.css`.

## Global Constraints

- **gb is the default skin.** Coral (`--accent` = `#EC5828`) = **OTTO/insight only** (the insight banner + the chart's peak dot). All other UI = ink (`--brand` = `#0A0A0A`) + neutrals. UI copy: **sentence case, no em-dashes**.
- **READ-ONLY. NO SPEND. MONEY PATH UNTOUCHED.** Do NOT modify `packages/db/src/credits.ts`, `packages/core/src/spend.ts`, `packages/core/src/gen.ts`, `apps/web/lib/gen-actions.ts`, `refgen-actions.ts`, `cowork-actions.ts`, `apps/web/components/canvas/useCanvasGen.ts`, the worker gen/refgen jobs, `packages/generation/*`, or any idempotency index. The OTTO-insight CTA only **prefills** an OTTO request (it does not generate); spend still goes through the existing gate.
- **Owner = `Organization`** (`ownerId` → `Organization.id`). The server action starts `const gate = await requireOwner(); if ("error" in gate) return gate; const { ownerId } = gate;`.
- **Tokens stay server-side.** The decrypted Meta token is a local variable inside server-only functions; never returned to the client. `getAnalyticsData` returns only numbers/strings.
- **Verification per task:** `npx tsc --noEmit` (in `apps/web`) + the named unit test. UI tasks also: `npx next build` (exit 0) + a `/browse` screenshot of a `skin-preview/analytics` harness on the dev server (`PORT=3007 pnpm --filter @fikirtive/web dev`, then the gstack browse binary at `$HOME/.claude/skills/gstack/browse/dist/browse`).

---

## Existing code this plan builds on (verified)

- `apps/web/lib/meta-graph.ts`: `metaGraphGet(token, path, params: Record<string,string>): Promise<any>` (read GET, throws on Meta error); `getAccountInsights(token, adAccountId, datePreset): Promise<AccountMetrics | null>` (single aggregated row, `INSIGHTS_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,purchase_roas"`, `META_GRAPH_VERSION`); `AccountMetrics = { spend, impressions, reach, frequency, clicks, ctr, cpc, cpm, purchaseRoas }` (all `string | null`); `listPages(token)`.
- `apps/web/lib/meta-insights.ts`: `fetchOwnerInsights(ownerId, datePreset): Promise<{ accounts: AccountInsights[] } | { needsReconnect: true } | { notConnected: true }>`; `AccountInsights = { accountId, name, metrics: AccountMetrics }`. **Plain server fn** (not `"use server"`), owner-scoped, decrypts the token inline. This is the canonical pattern to mirror.
- `apps/web/lib/token-encryption.ts`: `decryptToken(enc: string): string` (node:crypto, server-only).
- `apps/web/lib/meta-actions.ts`: `"use server"`; `getMyAdAccounts` is private. Ad-account enumeration = `metaGraphGet(token, "me/adaccounts", { fields: "name,account_status,currency,account_id" })`.
- `prisma.metaConnection.findUnique({ where: { ownerId } })` → `{ accessTokenEnc, status, ... }`. Current OAuth scope: `ads_read,ads_management,pages_show_list,business_management` (organic post insights need `pages_read_engagement`/`instagram_manage_insights` — NOT granted → Phase B).
- UI: `apps/web/components/otto/OttoConnections.tsx` = the self-fetch-on-mount example. `OttoViewKey` in `apps/web/components/otto/OttoApp.tsx`. Every OttoView branch wraps in `<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>`. `app/otto/page.tsx`'s `VALID_VIEWS` already includes `"analytics"`. No charting library — hand-build SVG.

---

## File Structure

**Data layer (new):**
- `apps/web/lib/meta-graph.ts` (modify) — add `getAccountInsightsSeries` + the pure `parseSeriesRows`.
- `apps/web/lib/analytics-format.ts` (new) — pure builders: `rangeToDatePreset`, `mergeDailyByDate`, `aggregateKpis`, `buildChartPoints`, `chartPaths`, `pickInsight`.
- `apps/web/lib/__tests__/analytics-format.test.ts` (new) — pure-builder tests.
- `apps/web/lib/analytics-actions.ts` (new) — `"use server"` `getAnalyticsData(range)`.

**UI (new):**
- `apps/web/components/otto/analytics/AreaChart.tsx` (new) — SVG area chart.
- `apps/web/components/otto/OttoAnalytics.tsx` (new) — the page (self-fetch + KPIs + chart + insight + past-posts pending + states).
- `apps/web/app/otto/otto-theme.css` (modify) — append `.cv-an*`.

**Wiring (modify):**
- `apps/web/components/otto/OttoApp.tsx` — ensure `"analytics"` ∈ `OttoViewKey`.
- `apps/web/components/otto/OttoView.tsx` — add the `view === "analytics"` branch.
- `apps/web/app/skin-preview/analytics/page.tsx` (new) — dev screenshot harness.

---

## Task 1: Daily insights series fetch + pure parser

**Files:**
- Modify: `apps/web/lib/meta-graph.ts`
- Test: `apps/web/lib/__tests__/meta-graph-series.test.ts`

**Interfaces:**
- Produces: `type DailyMetricRow = { date: string; spend: number; reach: number; impressions: number; clicks: number }`; `parseSeriesRows(data: unknown): DailyMetricRow[]` (pure, exported); `getAccountInsightsSeries(token: string, adAccountId: string, datePreset: string): Promise<DailyMetricRow[]>`.

- [ ] **Step 1: Write the failing test** for the pure parser.

Create `apps/web/lib/__tests__/meta-graph-series.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSeriesRows } from "../meta-graph";

describe("parseSeriesRows", () => {
  it("maps Meta daily rows to typed numbers (date_start → date)", () => {
    const rows = parseSeriesRows([
      { date_start: "2026-06-01", spend: "12.50", reach: "300", impressions: "900", clicks: "40" },
      { date_start: "2026-06-02", spend: "8", reach: "150", impressions: "500", clicks: "10" },
    ]);
    expect(rows).toEqual([
      { date: "2026-06-01", spend: 12.5, reach: 300, impressions: 900, clicks: 40 },
      { date: "2026-06-02", spend: 8, reach: 150, impressions: 500, clicks: 10 },
    ]);
  });
  it("coerces missing/garbage fields to 0 and skips rows with no date", () => {
    const rows = parseSeriesRows([{ spend: "x" }, { date_start: "2026-06-03" }]);
    expect(rows).toEqual([{ date: "2026-06-03", spend: 0, reach: 0, impressions: 0, clicks: 0 }]);
  });
  it("returns [] for non-array input", () => {
    expect(parseSeriesRows(null)).toEqual([]);
    expect(parseSeriesRows({ data: 1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd apps/web && npx vitest run lib/__tests__/meta-graph-series.test.ts` → FAIL (`parseSeriesRows` undefined).

- [ ] **Step 3: Implement** in `apps/web/lib/meta-graph.ts` (append near `getAccountInsights`; reuse the existing `INSIGHTS_FIELDS`, `META_GRAPH_VERSION`, `metaGraphGet`).

```typescript
export type DailyMetricRow = { date: string; spend: number; reach: number; impressions: number; clicks: number };

const num = (v: unknown): number => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Pure: map Meta `/insights?time_increment=1` rows to typed daily points. Rows with no date_start are dropped. */
export function parseSeriesRows(data: unknown): DailyMetricRow[] {
  if (!Array.isArray(data)) return [];
  const out: DailyMetricRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    const date = typeof r?.date_start === "string" ? r.date_start : "";
    if (!date) continue;
    out.push({ date, spend: num(r.spend), reach: num(r.reach), impressions: num(r.impressions), clicks: num(r.clicks) });
  }
  return out;
}

/** Daily time series for one ad account over a date preset (adds time_increment=1). Read-only. */
export async function getAccountInsightsSeries(token: string, adAccountId: string, datePreset: string): Promise<DailyMetricRow[]> {
  const j = await metaGraphGet(token, `${adAccountId}/insights`, {
    fields: "spend,reach,impressions,clicks",
    date_preset: datePreset,
    time_increment: "1",
  });
  return parseSeriesRows(j?.data);
}
```

- [ ] **Step 4: Run the test, verify it passes** — `cd apps/web && npx vitest run lib/__tests__/meta-graph-series.test.ts` → PASS (3).

- [ ] **Step 5: Typecheck + commit** — `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/lib/meta-graph.ts apps/web/lib/__tests__/meta-graph-series.test.ts
git commit -m "feat(analytics): daily ad-insights series fetch + pure row parser"
```

---

## Task 2: Analytics pure builders

**Files:**
- Create: `apps/web/lib/analytics-format.ts`
- Test: `apps/web/lib/__tests__/analytics-format.test.ts`

**Interfaces:**
- Consumes: `DailyMetricRow` (Task 1), `AccountMetrics` (`./meta-graph`).
- Produces:
  - `type AnalyticsRange = "7d" | "30d" | "90d" | "365d" | "all"`; `rangeToDatePreset(r: AnalyticsRange): string`.
  - `type Kpis = { spend: number; reach: number; impressions: number; clicks: number; ctr: number; cpc: number }`.
  - `mergeDailyByDate(perAccount: DailyMetricRow[][]): DailyMetricRow[]` (sum across accounts by date, ascending).
  - `aggregateKpis(metrics: AccountMetrics[]): Kpis` (sum period metrics across accounts; derive ctr/cpc).
  - `type ChartPoint = { date: string; value: number; x: number; y: number }`; `buildChartPoints(rows: DailyMetricRow[], metric: "reach" | "spend", w: number, h: number): { points: ChartPoint[]; peakIndex: number }`.
  - `chartPaths(points: ChartPoint[], w: number, h: number): { area: string; line: string; peak: { x: number; y: number } | null }`.
  - `pickInsight(rows: DailyMetricRow[]): { peakDate: string; peakReach: number } | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/analytics-format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { rangeToDatePreset, mergeDailyByDate, aggregateKpis, buildChartPoints, chartPaths, pickInsight } from "../analytics-format";

const day = (date: string, reach: number, spend = 0) => ({ date, spend, reach, impressions: reach * 2, clicks: 0 });

describe("rangeToDatePreset", () => {
  it("maps ranges to Meta date presets", () => {
    expect(rangeToDatePreset("7d")).toBe("last_7d");
    expect(rangeToDatePreset("30d")).toBe("last_30d");
    expect(rangeToDatePreset("90d")).toBe("last_90d");
    expect(rangeToDatePreset("365d")).toBe("last_year");
    expect(rangeToDatePreset("all")).toBe("maximum");
  });
});

describe("mergeDailyByDate", () => {
  it("sums across accounts by date, sorted ascending", () => {
    const a = [day("2026-06-02", 10), day("2026-06-01", 5)];
    const b = [day("2026-06-01", 7)];
    expect(mergeDailyByDate([a, b])).toEqual([
      { date: "2026-06-01", spend: 0, reach: 12, impressions: 24, clicks: 0 },
      { date: "2026-06-02", spend: 0, reach: 10, impressions: 20, clicks: 0 },
    ]);
  });
});

describe("aggregateKpis", () => {
  it("sums additive metrics and derives ctr/cpc", () => {
    const k = aggregateKpis([
      { spend: "100", impressions: "1000", reach: "800", frequency: null, clicks: "50", ctr: null, cpc: null, cpm: null, purchaseRoas: null },
      { spend: "50", impressions: "1000", reach: "400", frequency: null, clicks: "50", ctr: null, cpc: null, cpm: null, purchaseRoas: null },
    ]);
    expect(k.spend).toBe(150);
    expect(k.impressions).toBe(2000);
    expect(k.reach).toBe(1200);
    expect(k.clicks).toBe(100);
    expect(k.ctr).toBeCloseTo(5); // 100/2000 * 100
    expect(k.cpc).toBeCloseTo(1.5); // 150/100
  });
  it("never divides by zero", () => {
    const k = aggregateKpis([]);
    expect(k).toEqual({ spend: 0, reach: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0 });
  });
});

describe("buildChartPoints + chartPaths", () => {
  it("scales values into the box and finds the peak", () => {
    const rows = [day("d1", 0), day("d2", 100), day("d3", 50)];
    const { points, peakIndex } = buildChartPoints(rows, "reach", 300, 100);
    expect(points).toHaveLength(3);
    expect(points[0].x).toBe(0);
    expect(points[2].x).toBe(300);
    expect(points[1].y).toBe(0); // max value → top (y=0)
    expect(points[0].y).toBe(100); // min value → bottom (y=h)
    expect(peakIndex).toBe(1);
    const paths = chartPaths(points, 300, 100);
    expect(paths.line.startsWith("M")).toBe(true);
    expect(paths.area.endsWith("Z")).toBe(true);
    expect(paths.peak).toEqual({ x: 150, y: 0 });
  });
  it("handles empty + single-point series without NaN", () => {
    expect(buildChartPoints([], "reach", 300, 100).points).toEqual([]);
    expect(chartPaths([], 300, 100)).toEqual({ area: "", line: "", peak: null });
    const one = buildChartPoints([day("d1", 7)], "reach", 300, 100);
    expect(Number.isNaN(one.points[0].y)).toBe(false);
  });
});

describe("pickInsight", () => {
  it("returns the highest-reach day", () => {
    expect(pickInsight([day("d1", 5), day("d2", 99), day("d3", 12)])).toEqual({ peakDate: "d2", peakReach: 99 });
  });
  it("returns null for empty", () => {
    expect(pickInsight([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd apps/web && npx vitest run lib/__tests__/analytics-format.test.ts` → FAIL.

- [ ] **Step 3: Implement** `apps/web/lib/analytics-format.ts`:

```typescript
import type { DailyMetricRow } from "./meta-graph";
import type { AccountMetrics } from "./meta-graph";

export type AnalyticsRange = "7d" | "30d" | "90d" | "365d" | "all";
export type Kpis = { spend: number; reach: number; impressions: number; clicks: number; ctr: number; cpc: number };
export type ChartPoint = { date: string; value: number; x: number; y: number };

export function rangeToDatePreset(r: AnalyticsRange): string {
  switch (r) {
    case "7d": return "last_7d";
    case "30d": return "last_30d";
    case "90d": return "last_90d";
    case "365d": return "last_year";
    case "all": return "maximum";
  }
}

const n = (v: string | null): number => {
  const x = v == null ? NaN : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function mergeDailyByDate(perAccount: DailyMetricRow[][]): DailyMetricRow[] {
  const by = new Map<string, DailyMetricRow>();
  for (const rows of perAccount) {
    for (const r of rows) {
      const cur = by.get(r.date) ?? { date: r.date, spend: 0, reach: 0, impressions: 0, clicks: 0 };
      cur.spend += r.spend; cur.reach += r.reach; cur.impressions += r.impressions; cur.clicks += r.clicks;
      by.set(r.date, cur);
    }
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function aggregateKpis(metrics: AccountMetrics[]): Kpis {
  let spend = 0, reach = 0, impressions = 0, clicks = 0;
  for (const m of metrics) { spend += n(m.spend); reach += n(m.reach); impressions += n(m.impressions); clicks += n(m.clicks); }
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  return { spend, reach, impressions, clicks, ctr, cpc };
}

export function buildChartPoints(rows: DailyMetricRow[], metric: "reach" | "spend", w: number, h: number): { points: ChartPoint[]; peakIndex: number } {
  if (rows.length === 0) return { points: [], peakIndex: -1 };
  const vals = rows.map((r) => r[metric]);
  const max = Math.max(...vals, 0);
  const stepX = rows.length > 1 ? w / (rows.length - 1) : 0;
  let peakIndex = 0;
  const points = rows.map((r, i) => {
    if (vals[i] > vals[peakIndex]) peakIndex = i;
    const x = rows.length > 1 ? i * stepX : w / 2;
    const y = max > 0 ? h - (r[metric] / max) * h : h;
    return { date: r.date, value: r[metric], x, y };
  });
  return { points, peakIndex };
}

export function chartPaths(points: ChartPoint[], w: number, h: number): { area: string; line: string; peak: { x: number; y: number } | null } {
  if (points.length === 0) return { area: "", line: "", peak: null };
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const first = points[0], last = points[points.length - 1];
  const area = `${line} L${last.x.toFixed(1)},${h} L${first.x.toFixed(1)},${h} Z`;
  let pk = points[0];
  for (const p of points) if (p.value > pk.value) pk = p;
  return { area, line, peak: { x: pk.x, y: pk.y } };
}

export function pickInsight(rows: DailyMetricRow[]): { peakDate: string; peakReach: number } | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const r of rows) if (r.reach > best.reach) best = r;
  return { peakDate: best.date, peakReach: best.reach };
}
```

- [ ] **Step 4: Run the test, verify it passes** — `cd apps/web && npx vitest run lib/__tests__/analytics-format.test.ts` → PASS.

- [ ] **Step 5: Typecheck + commit** — `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/lib/analytics-format.ts apps/web/lib/__tests__/analytics-format.test.ts
git commit -m "feat(analytics): pure builders (range map, daily merge, kpi aggregate, chart paths, insight)"
```

---

## Task 3: `getAnalyticsData` server action

**Files:**
- Create: `apps/web/lib/analytics-actions.ts`

**Interfaces:**
- Consumes: `requireOwner` (`./auth-guard`), `prisma` (`@fikirtive/db`), `decryptToken` (`./token-encryption`), `metaGraphGet` / `getAccountInsights` / `getAccountInsightsSeries` (`./meta-graph`), the Task-2 builders, `AccountMetrics`.
- Produces: `type AnalyticsData = { state: "ok"; range: AnalyticsRange; accountsCount: number; kpis: Kpis; series: DailyMetricRow[]; insight: { peakDate: string; peakReach: number } | null }`; `type AnalyticsResult = AnalyticsData | { state: "not_connected" } | { state: "needs_reconnect" } | { state: "error" }`; `getAnalyticsData(range: AnalyticsRange): Promise<AnalyticsResult>`.

This mirrors `meta-insights.ts` exactly: one connection lookup, one token decrypt, enumerate ad accounts once, then per account fetch the period metrics + the daily series, aggregate via the pure builders. No unit test (needs live Meta + DB — same as `fetchOwnerInsights`); verified by `tsc`, `next build`, and the harness screenshot.

- [ ] **Step 1: Implement** `apps/web/lib/analytics-actions.ts`:

```typescript
"use server";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, getAccountInsights, getAccountInsightsSeries, type DailyMetricRow, type AccountMetrics } from "./meta-graph";
import { rangeToDatePreset, mergeDailyByDate, aggregateKpis, pickInsight, type AnalyticsRange, type Kpis } from "./analytics-format";

export type AnalyticsData = {
  state: "ok";
  range: AnalyticsRange;
  accountsCount: number;
  kpis: Kpis;
  series: DailyMetricRow[];
  insight: { peakDate: string; peakReach: number } | null;
};
export type AnalyticsResult = AnalyticsData | { state: "not_connected" } | { state: "needs_reconnect" } | { state: "error" };

export async function getAnalyticsData(range: AnalyticsRange): Promise<AnalyticsResult> {
  const gate = await requireOwner();
  if ("error" in gate) return { state: "error" };
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId: gate.ownerId } });
  if (!conn) return { state: "not_connected" };
  let token: string;
  try { token = decryptToken(conn.accessTokenEnc); } catch { return { state: "needs_reconnect" }; }

  const datePreset = rangeToDatePreset(range);
  try {
    // Match the existing meta-insights.ts convention: Graph returns the act_-prefixed node `id`; fall back to act_<account_id>.
    const acctRes = await metaGraphGet(token, "me/adaccounts", { fields: "name,account_id" });
    const ids: string[] = (acctRes?.data ?? [])
      .map((a: Record<string, unknown>) => String(a.id ?? (a.account_id ? `act_${a.account_id}` : "")))
      .filter(Boolean);
    if (ids.length === 0) return { state: "ok", range, accountsCount: 0, kpis: aggregateKpis([]), series: [], insight: null };

    const metrics: AccountMetrics[] = [];
    const perAccountSeries: DailyMetricRow[][] = [];
    for (const id of ids) {
      const [m, s] = await Promise.all([
        getAccountInsights(token, id, datePreset).catch(() => null),
        getAccountInsightsSeries(token, id, datePreset).catch(() => [] as DailyMetricRow[]),
      ]);
      if (m) metrics.push(m);
      perAccountSeries.push(s);
    }
    const series = mergeDailyByDate(perAccountSeries);
    return { state: "ok", range, accountsCount: ids.length, kpis: aggregateKpis(metrics), series, insight: pickInsight(series) };
  } catch (e) {
    if ((e as { metaError?: { code?: number } })?.metaError?.code === 190) {
      await prisma.metaConnection.update({ where: { ownerId: gate.ownerId }, data: { status: "expired" } }).catch(() => {});
      return { state: "needs_reconnect" };
    }
    return { state: "error" };
  }
}
```

- [ ] **Step 2: Typecheck + commit** — `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/lib/analytics-actions.ts
git commit -m "feat(analytics): getAnalyticsData server action (owner-scoped ad KPIs + daily series)"
```

---

## Task 4: SVG area chart component

**Files:**
- Create: `apps/web/components/otto/analytics/AreaChart.tsx`

**Interfaces:**
- Consumes: `buildChartPoints`, `chartPaths`, `DailyMetricRow` (Tasks 1-2).
- Produces: `<AreaChart rows={DailyMetricRow[]} metric="reach" | "spend" />`.

Pure presentational; the math lives in the tested Task-2 builders. Uses a fixed viewBox and `preserveAspectRatio="none"` so it scales to the container. Ink line/area; **coral** peak dot (the only OTTO/insight accent on the chart).

- [ ] **Step 1: Write** `apps/web/components/otto/analytics/AreaChart.tsx`:

```tsx
"use client";
import { buildChartPoints, chartPaths } from "@/lib/analytics-format";
import type { DailyMetricRow } from "@/lib/meta-graph";

const W = 600, H = 180;

export function AreaChart({ rows, metric }: { rows: DailyMetricRow[]; metric: "reach" | "spend" }) {
  const { points } = buildChartPoints(rows, metric, W, H);
  if (points.length === 0) return <div className="cv-an-chart-empty">No data for this range yet.</div>;
  const { area, line, peak } = chartPaths(points, W, H);
  return (
    <svg className="cv-an-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${metric} over time`}>
      <defs>
        <linearGradient id="cv-an-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cv-an-fill)" />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {peak && <circle cx={peak.x} cy={peak.y} r="4" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck + commit** — `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/components/otto/analytics/AreaChart.tsx
git commit -m "feat(analytics): hand-built SVG area chart (ink line, coral peak dot)"
```

---

## Task 5: `OttoAnalytics` page

**Files:**
- Create: `apps/web/components/otto/OttoAnalytics.tsx`

**Interfaces:**
- Consumes: `getAnalyticsData` + `AnalyticsData`/`AnalyticsResult` (Task 3), `AnalyticsRange` (Task 2), `AreaChart` (Task 4).
- Produces: `<OttoAnalytics previewData?={AnalyticsResult} onAskOtto?={(text: string) => void} />` — self-fetches `getAnalyticsData(range)` on mount + on range change (like `OttoConnections`); `previewData` short-circuits the fetch for the dev harness.

KPI cards: spend, reach, impressions, CTR, CPC (formatted). Chart: reach over time. OTTO insight: coral banner from `insight` with a CTA calling `onAskOtto`. Past-posts: a designed "pending Meta approval" section. States: loading / not_connected / needs_reconnect / error / empty.

- [ ] **Step 1: Write** `apps/web/components/otto/OttoAnalytics.tsx`:

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { getAnalyticsData, type AnalyticsResult } from "@/lib/analytics-actions";
import type { AnalyticsRange } from "@/lib/analytics-format";
import { AreaChart } from "./analytics/AreaChart";

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "90d", label: "90 days" },
  { id: "365d", label: "1 year" }, { id: "all", label: "All time" },
];
const fmt = (n: number) => Math.round(n).toLocaleString();
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function OttoAnalytics({ previewData, onAskOtto }: { previewData?: AnalyticsResult; onAskOtto?: (text: string) => void }) {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [data, setData] = useState<AnalyticsResult | null>(previewData ?? null);
  const [loading, setLoading] = useState(!previewData);

  const load = useCallback((r: AnalyticsRange) => {
    if (previewData) return;
    setLoading(true);
    getAnalyticsData(r).then((res) => { setData(res); setLoading(false); }).catch(() => { setData({ state: "error" }); setLoading(false); });
  }, [previewData]);

  useEffect(() => { load(range); }, [range, load]);

  const kpiRow = (d: Extract<AnalyticsResult, { state: "ok" }>) => (
    <div className="cv-an-kpis">
      {[
        { k: "Spend", v: fmt1(d.kpis.spend) }, { k: "Reach", v: fmt(d.kpis.reach) }, { k: "Impressions", v: fmt(d.kpis.impressions) },
        { k: "CTR", v: `${fmt1(d.kpis.ctr)}%` }, { k: "CPC", v: fmt1(d.kpis.cpc) },
      ].map((c) => (
        <div key={c.k} className="cv-an-kpi"><div className="cv-an-kpi-k">{c.k}</div><div className="cv-an-kpi-v">{c.v}</div></div>
      ))}
    </div>
  );

  return (
    <div className="cv-an">
      <div className="cv-an-top">
        <div><h1 className="cv-an-h1">Analytics</h1><span className="cv-an-sub">via Meta · read-only</span></div>
        <div className="cv-an-ranges">
          {RANGES.map((r) => (
            <button key={r.id} className={r.id === range ? "cv-an-range on" : "cv-an-range"} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>
      </div>

      {loading && <div className="cv-an-state">Loading your performance…</div>}
      {!loading && data?.state === "not_connected" && <div className="cv-an-state">Connect Meta in Connections to see your performance.</div>}
      {!loading && data?.state === "needs_reconnect" && <div className="cv-an-state">Your Meta connection expired. Reconnect in Connections.</div>}
      {!loading && data?.state === "error" && <div className="cv-an-state">Could not load analytics right now. Please refresh.</div>}

      {!loading && data?.state === "ok" && (
        <>
          {data.insight && (
            <div className="cv-an-insight">
              <span>Your best day reached <b>{fmt(data.insight.peakReach)}</b> people on {data.insight.peakDate}.</span>
              {onAskOtto && (
                <button className="cv-an-insight-cta" onClick={() => onAskOtto(`Make more posts like my best day (${data.insight!.peakDate}).`)}>Ask OTTO to do more of this</button>
              )}
            </div>
          )}
          {kpiRow(data)}
          <div className="cv-an-card"><div className="cv-an-card-h">Reach over time</div><AreaChart rows={data.series} metric="reach" /></div>
          <div className="cv-an-card cv-an-pending">
            <div className="cv-an-card-h">Past posts</div>
            <p className="cv-an-pending-p">Per-post performance for your published Instagram and Facebook posts lights up here once Meta approves deeper insights access. Your ad metrics above are live now.</p>
          </div>
        </>
      )}
    </div>
  );
}
export default OttoAnalytics;
```

- [ ] **Step 2: Typecheck + commit** — `cd apps/web && npx tsc --noEmit` → clean.

```bash
git add apps/web/components/otto/OttoAnalytics.tsx
git commit -m "feat(analytics): OttoAnalytics page (self-fetch, KPIs, chart, OTTO insight, past-posts pending, states)"
```

---

## Task 6: Analytics CSS

**Files:**
- Modify: `apps/web/app/otto/otto-theme.css` (append at the END; do not edit existing rules)

**Interfaces:** consumes the gb tokens already defined under `.fk.gb-skin` (`--surface-card`, `--border-default`, `--border-subtle`, `--text-strong/body/muted/faint`, `--brand`, `--brand-tint`, `--accent`, `--accent-soft`).

- [ ] **Step 1: Append** to `apps/web/app/otto/otto-theme.css`:

```css
/* ── Analytics page. */
.fk.gb-skin .cv-an { flex: 1; overflow: auto; padding: 30px 40px; max-width: 920px; }
.fk.gb-skin .cv-an-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.fk.gb-skin .cv-an-h1 { font-size: 21px; font-weight: 700; margin: 0; }
.fk.gb-skin .cv-an-sub { font-size: 12.5px; color: var(--text-muted); }
.fk.gb-skin .cv-an-ranges { display: flex; border: 1px solid var(--border-default); border-radius: 9px; overflow: hidden; }
.fk.gb-skin .cv-an-range { padding: 6px 12px; font-size: 12.5px; font-weight: 600; color: var(--text-muted); background: var(--surface-card); border: none; cursor: pointer; }
.fk.gb-skin .cv-an-range.on { background: var(--brand); color: var(--text-on-brand); }
.fk.gb-skin .cv-an-state { padding: 40px 0; color: var(--text-muted); font-size: 14px; }
.fk.gb-skin .cv-an-insight { display: flex; align-items: center; justify-content: space-between; gap: 14px; background: var(--accent-soft); border-radius: 13px; padding: 12px 16px; font-size: 13.5px; color: #9A3A1A; margin-bottom: 16px; }
.fk.gb-skin .cv-an-insight b { color: #7A2E12; }
.fk.gb-skin .cv-an-insight-cta { flex: none; background: var(--accent); color: #fff; border: none; border-radius: 9px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.fk.gb-skin .cv-an-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 18px; }
.fk.gb-skin .cv-an-kpi { background: var(--surface-card); border: 1px solid var(--border-default); border-radius: 12px; padding: 13px 14px; }
.fk.gb-skin .cv-an-kpi-k { font-size: 11.5px; font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.fk.gb-skin .cv-an-kpi-v { font-size: 22px; font-weight: 800; color: var(--text-strong); margin-top: 4px; }
.fk.gb-skin .cv-an-card { background: var(--surface-card); border: 1px solid var(--border-default); border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
.fk.gb-skin .cv-an-card-h { font-size: 13px; font-weight: 700; color: var(--text-strong); margin-bottom: 12px; }
.fk.gb-skin .cv-an-chart { width: 100%; height: 180px; display: block; }
.fk.gb-skin .cv-an-chart-empty { color: var(--text-faint); font-size: 13px; padding: 50px 0; text-align: center; }
.fk.gb-skin .cv-an-pending { border-style: dashed; }
.fk.gb-skin .cv-an-pending-p { font-size: 13px; color: var(--text-muted); margin: 0; line-height: 1.5; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/otto/otto-theme.css
git commit -m "feat(analytics): gb styles for the analytics page"
```

---

## Task 7: Wire into OttoView + nav

**Files:**
- Modify: `apps/web/components/otto/OttoApp.tsx` (ensure `"analytics"` ∈ `OttoViewKey`; pass a seed callback)
- Modify: `apps/web/components/otto/OttoView.tsx` (add the `view === "analytics"` branch)

**Interfaces:** consumes `OttoAnalytics` (Task 5).

> **Verified:** `OttoViewKey` (`OttoApp.tsx:65`) ALREADY includes `"analytics"`, and `OttoNav.tsx:110` ALREADY has the Analytics nav item. The nav already routes `?view=analytics`; it currently falls through to the default view because `OttoView` has no analytics branch. So this task only adds that branch. `OttoView` ALREADY receives `onUseInOtto: (prompt: string) => void` (prop at `OttoView.tsx:44`, threaded from `OttoApp.handleUseInOtto`, used by `OttoDiscover`) — wire it straight through as `onAskOtto`, so the insight CTA works.

- [ ] **Step 1: No OttoApp change needed** — confirm `OttoViewKey` already contains `"analytics"` (it does). Skip if present.

- [ ] **Step 2: Add the OttoView branch.** In `apps/web/components/otto/OttoView.tsx`, add the import `import { OttoAnalytics } from "./OttoAnalytics";` and, alongside the other view branches (mirror the `connections`/`discover` wrapper), add:

```tsx
  if (view === "analytics") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoAnalytics onAskOtto={onUseInOtto} />
      </div>
    );
  }
```

(`onUseInOtto` is already destructured in `OttoView` — reuse it; do NOT add a new seeding path.)

- [ ] **Step 3: Typecheck + build** — `cd apps/web && npx tsc --noEmit` → clean. `cd /Users/winnin/Desktop/artlio/.claude/worktrees/gracious-chandrasekhar-72f8c9 && pnpm --filter @fikirtive/web build` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/otto/OttoApp.tsx apps/web/components/otto/OttoView.tsx
git commit -m "feat(analytics): wire the analytics view into OttoView"
```

---

## Task 8: Harness + visual verify

**Files:**
- Create: `apps/web/app/skin-preview/analytics/page.tsx`

- [ ] **Step 1: Write the harness** (mirror `app/skin-preview/account/page.tsx`: `notFound()` in production, `fk gb-skin` wrapper, the otto-theme css import, inject mock via `previewData`):

```tsx
import { notFound } from "next/navigation";
import { OttoAnalytics } from "@/components/otto/OttoAnalytics";
import type { AnalyticsResult } from "@/lib/analytics-actions";
import "../../otto/otto-theme.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics preview (dev)" };

export default function AnalyticsPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const series = Array.from({ length: 30 }, (_, i) => {
    const d = String(i + 1).padStart(2, "0");
    const reach = 200 + Math.round(180 * Math.sin(i / 3) + i * 12) + (i === 18 ? 400 : 0);
    return { date: `2026-06-${d}`, spend: 5 + (i % 5), reach, impressions: reach * 3, clicks: Math.round(reach / 12) };
  });
  const preview: AnalyticsResult = {
    state: "ok", range: "30d", accountsCount: 2,
    kpis: { spend: 642, reach: 18420, impressions: 55260, clicks: 1530, ctr: 2.77, cpc: 0.42 },
    series, insight: { peakDate: "2026-06-19", peakReach: 980 },
  };
  return (
    <div className="fk gb-skin" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoAnalytics previewData={preview} onAskOtto={() => {}} />
      </div>
    </div>
  );
}
```

> Note: the harness mock uses `Math.sin` (deterministic) — do NOT use `Math.random()` (non-deterministic screenshots).

- [ ] **Step 2: Money guard** (must be empty): `git status --porcelain -- packages/db/src/credits.ts packages/core/src/spend.ts apps/web/lib/gen-actions.ts apps/web/components/canvas/useCanvasGen.ts`

- [ ] **Step 3: Screenshot.** Run the dev server + browse:

```bash
cd /Users/winnin/Desktop/artlio/.claude/worktrees/gracious-chandrasekhar-72f8c9
PORT=3007 pnpm --filter @fikirtive/web dev   # background; wait for ready
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B viewport 1440x1600; $B goto "http://localhost:3007/skin-preview/analytics"; $B wait --networkidle
$B screenshot "/private/tmp/analytics-check.png"; $B console --errors
```

Expected: header + range segmented control, coral OTTO-insight banner, 5 KPI cards, the area chart with a coral peak dot, the dashed "past posts pending" card; no console errors. Copy to `~/Desktop/fikirtive-analytics-built.png` for founder review.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/skin-preview/analytics/page.tsx
git commit -m "feat(analytics): dev preview harness for the analytics page"
```

---

## Self-Review

**Spec coverage** (analytics-design spec):
- KPI cards (reach/engagement/spend) → Task 5 (spend/reach/impressions/CTR/CPC from `aggregateKpis`) ✓. (Meta `AccountMetrics` has no discrete "results" count beyond `purchaseRoas`/ROAS; ROAS/sales surfacing is a fast-follow once `actions` is added to the fetch — noted, not silently dropped.)
- Reach/engagement over time chart, full ranges incl. long history → Tasks 1-4 (daily series + SVG chart; ranges 7/30/90/365/All via `date_preset`) ✓. **Custom date range = deferred** (the 5 presets cover the spec's history need; custom picker is a fast-follow).
- OTTO insight ("best performer → make more") → Task 5 coral banner + CTA prefilling an OTTO request (no spend) ✓.
- Past posts (organic, full history) → **Phase B** (needs `pages_read_engagement`/`instagram_manage_insights` = App Review; the channel `fetchAccountInsights`/`listPublishedPosts`/`fetchPostInsights` stubs + a `PostInsightSnapshot` cache + the IG-business-account resolution land in the Phase-B plan). Phase A renders the designed pending state ✓.
- States (not connected / needs reconnect / pending-permission / empty) → Task 5 ✓.
- Read-only, no spend; money path untouched ✓.

**Placeholder scan:** none. The one earlier uncertainty (the `onAskOtto` seed wiring) is resolved: `OttoView` already receives `onUseInOtto` (threaded from `OttoApp.handleUseInOtto`, used by `OttoDiscover`) — Task 7 wires it straight through, so the insight CTA works. No invented paths, no TODOs.

**Type consistency:** `DailyMetricRow` (Task 1) is consumed unchanged by Tasks 2-5. `Kpis`/`AnalyticsRange`/`ChartPoint` (Task 2) flow into Tasks 3-5. `AnalyticsResult` (Task 3) is the single source for the page + harness states. `getAccountInsightsSeries`/`getAccountInsights` signatures match `meta-graph.ts`. The `me/adaccounts` field + `act_` prefixing in Task 3 matches the existing `getMyAdAccounts` convention.

**Open item for the implementer:** none blocking. `getAnalyticsData` (Task 3) has no unit test by design (live Meta + DB, same as `fetchOwnerInsights`) — its correctness rides on the Task-2 pure builders' tests + `next build` + the harness screenshot; keep the per-account `.catch` fallbacks so one bad account can't blank the whole view.
