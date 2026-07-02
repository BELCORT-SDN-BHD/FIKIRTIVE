# Analytics Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Analytics `ComingSoon` stub with the real Phase-A page — ad-account KPIs, daily reach chart, OTTO insight banner, full date ranges, connection states — per spec `docs/superpowers/specs/2026-06-30-analytics-design.md` (Phase A only; organic post insights = Phase B, gated on Meta App Review).

**Architecture:** Additive read-only layers: a new daily-series fetch beside the existing `getAccountInsights` (`time_increment: 1`), pure builders (KPIs + deltas + series + insight pick), one session-scoped read action, and an `OttoAnalytics` component that must match the vendored gold-standard `docs/design-refs/analytics-ui-kit.html` pixel-for-pixel (the founder's baseline screen).

**Tech Stack:** Meta Marketing API (read), zod-free plain TS, vitest, SVG chart (no chart lib).

## Global Constraints

- **MONEY-GUARD (BINDING):** never modify `packages/db/src/credits.ts`, `packages/core/src/spend.ts`, `apps/worker/src/jobs/*`, `apps/web/**/gen-actions.ts`, `refgen-actions.ts`, `cowork-actions.ts`, `**/useCanvasGen.ts`, `packages/generation/*`, `pnpm-lock.yaml`. Feature is 100% read-only; the OTTO-insight CTA only PREFILLS text (no auto-send, no spend).
- Branch `claude/analytics-page` (off main `38b61a2`) in worktree `/Users/winnin/Desktop/artlio/.claude/worktrees/brand-memory`. Env bootstrapped.
- `apps/web/lib/meta-graph.ts` + `meta-insights.ts`: ADDITIVE ONLY — new exports; existing functions byte-unchanged (live prod read connector).
- Design: match `docs/design-refs/analytics-ui-kit.html` EXACTLY (kpi card radius 14/padding 15, `kl` 12px #86867F 500, `kv` 26px/700/-0.02em, delta 12px/600 green #15803D / flat #86867F, panel radius 16/padding 18, insight banner bg #FFF6F2 border #FBD9C9 text #9A3A1A 14px/1.45 + coral #EC5828 CTA h38 radius 11, range control h34 radius 10 13px/600, chart mono #0A0A0A stroke 2.2 + gradient fill + coral r4 peak dots, top-list rows 13.5/600 name + 11.5 muted meta + right-aligned 14/700 value with 10.5 label, "Best" pill #E7F6EC/#15803D). Use `.gb` tokens where they equal these values; arbitrary values otherwise (house idiom).
- No new npm deps. Chart = hand-built SVG path (like the ui_kit).
- Currency displays whatever Meta returns (spend string) prefixed per account currency if available — do NOT hardcode RM/$ conversions (display-only strings).

---

### Task 1: Daily-series fetch (additive, TDD on the parser)

**Files:**
- Modify: `apps/web/lib/meta-graph.ts` (append only)
- Modify: `apps/web/lib/meta-insights.ts` (append only)
- Test: `apps/web/lib/__tests__/meta-graph-series.test.ts` (new)

**Interfaces (Produces):**
```ts
// meta-graph.ts (append)
export type DailyMetric = { date: string /* YYYY-MM-DD */; spend: number; reach: number; impressions: number; clicks: number };
export function parseDailyRows(data: unknown[]): DailyMetric[];  // pure — exported for tests
export async function getAccountInsightsSeries(token: string, adAccountId: string, datePreset: string): Promise<DailyMetric[]>;
// meta-insights.ts (append)
export async function fetchOwnerInsightsSeries(ownerId: string, datePreset: string):
  Promise<{ series: DailyMetric[] } | { needsReconnect: true } | { notConnected: true }>;
```

- [ ] **Step 1: Failing parser test** — `meta-graph-series.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDailyRows } from "../meta-graph";

describe("parseDailyRows", () => {
  it("maps Meta daily rows to numbers with date_start as the day", () => {
    const rows = [
      { date_start: "2026-06-01", date_stop: "2026-06-01", spend: "12.5", reach: "800", impressions: "1200", clicks: "30" },
      { date_start: "2026-06-02", date_stop: "2026-06-02", spend: null, reach: undefined, impressions: "0", clicks: "0" },
    ];
    expect(parseDailyRows(rows)).toEqual([
      { date: "2026-06-01", spend: 12.5, reach: 800, impressions: 1200, clicks: 30 },
      { date: "2026-06-02", spend: 0, reach: 0, impressions: 0, clicks: 0 },
    ]);
  });
  it("drops rows without date_start and non-objects", () => {
    expect(parseDailyRows([{ spend: "1" }, null, "x"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure** (`pnpm --filter web exec vitest run lib/__tests__/meta-graph-series.test.ts`).
- [ ] **Step 3: Implement** (append to meta-graph.ts):

```ts
/** One day of ad-account metrics (Analytics Phase A). Numbers coerced; missing → 0. */
export type DailyMetric = { date: string; spend: number; reach: number; impressions: number; clicks: number };

export function parseDailyRows(data: unknown[]): DailyMetric[] {
  const out: DailyMetric[] = [];
  const n = (v: unknown): number => { const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0; return Number.isFinite(x) ? x : 0; };
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const d = raw as Record<string, unknown>;
    if (typeof d.date_start !== "string") continue;
    out.push({ date: d.date_start, spend: n(d.spend), reach: n(d.reach), impressions: n(d.impressions), clicks: n(d.clicks) });
  }
  return out;
}

/** Read-only daily series for one ad account — same insights edge with time_increment=1. */
export async function getAccountInsightsSeries(token: string, adAccountId: string, datePreset: string): Promise<DailyMetric[]> {
  const j = await metaGraphGet(token, `${adAccountId}/insights`, {
    fields: "spend,reach,impressions,clicks", date_preset: datePreset, time_increment: "1", limit: "500",
  });
  return parseDailyRows((j.data ?? []) as unknown[]);
}
```

Append to meta-insights.ts a `fetchOwnerInsightsSeries` mirroring `fetchOwnerInsights` exactly (same conn lookup / token decrypt / needsReconnect handling — copy its structure verbatim, call `getAccountInsightsSeries` per account and merge by date summing metrics; return `{ series }` sorted by date asc). GREP the existing function body first and mirror its error-handling branch-for-branch.

- [ ] **Step 4:** targeted test green + `pnpm --filter web typecheck` + confirm existing exports byte-unchanged (`git diff` shows only appends).
- [ ] **Step 5: Commit** `git add apps/web/lib && git commit -m "feat(web): daily ad-insights series fetch (additive, read-only)"`

---

### Task 2: Pure analytics builders (TDD)

**Files:**
- Create: `apps/web/lib/analytics-view.ts`
- Test: `apps/web/lib/__tests__/analytics-view.test.ts`

**Interfaces (Produces — Task 3/4 consume):**
```ts
export const RANGES = [
  { key: "7d", label: "Last 7 days", preset: "last_7d" },
  { key: "30d", label: "Last 30 days", preset: "last_30d" },
  { key: "90d", label: "Last 90 days", preset: "last_90d" },
  { key: "365d", label: "Last 12 months", preset: "last_year" },
  { key: "all", label: "All time", preset: "maximum" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
export function prevPreset(key: RangeKey): string | null;    // 7d→last_7d shifted? Meta has no "previous period" preset for all — see Step 3 note
export type Kpi = { label: string; value: string; delta: { dir: "up" | "down" | "flat"; text: string } | null };
export function buildKpis(current: AccountMetrics[], previous: AccountMetrics[] | null): Kpi[]; // Reach, Clicks, Spend, ROAS
export type ChartPoint = { x: number; y: number; date: string; value: number; peak: boolean };
export function buildChart(series: DailyMetric[], width: number, height: number): { linePath: string; areaPath: string; points: ChartPoint[] }; // top-3 values marked peak
export function buildInsightText(series: DailyMetric[]): { text: string; prefill: string } | null; // best day vs average reach
```

- [ ] **Step 1: Failing tests** (write real assertions for: summing metrics across accounts; delta up/down/flat vs previous incl. null-previous → delta null; number formatting 48200→"48.2K", 3140→"3,140", spend "RM"-less raw with 2dp; chart normalization — y inverted, flat series doesn't divide by zero; top-3 peaks; insight null on empty/all-zero series, text contains best date + multiplier vs average).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Notes: Meta has no generic previous-period preset — implement `prevPreset` returning null for "all" and for others the SAME preset (caller fetches previous via `time_range` alternative is Phase B; Phase A: compute delta by splitting the DAILY SERIES in half — `buildKpis(current, previous)` stays but Task 3 derives `previous` from the first half of a double-length series ONLY for 7d/30d/90d using presets last_14d? — SIMPLIFY: drop prevPreset; `buildKpisFromSeries(series, metrics)` computes period-over-period by halving the fetched series when ≥14 points, else delta null. Keep AccountMetrics totals for Spend/ROAS from `fetchOwnerInsights` and reach/clicks from series sums. Document the halving in a comment.)
- [ ] **Step 4:** green + typecheck. **Step 5: Commit** `feat(web): analytics view builders (KPIs, deltas, SVG chart, OTTO insight) — pure + tested`

---

### Task 3: Read action `analytics-actions.ts`

**Files:**
- Create: `apps/web/lib/analytics-actions.ts` ("use server")
- Test: `apps/web/lib/__tests__/analytics-actions.test.ts` (mock prisma/fetchers via vi.hoisted like memory-actions.test.ts)

**Interfaces:**
```ts
export type AnalyticsData =
  | { state: "notConnected" } | { state: "needsReconnect" }
  | { state: "ready"; kpis: Kpi[]; chart: { linePath: string; areaPath: string; points: ChartPoint[] } | null; insight: { text: string; prefill: string } | null; empty: boolean };
export async function getAnalytics(raw: unknown /* { range?: RangeKey } */): Promise<AnalyticsData>;
```
Session-scoped (`requireOwner`, ignore caller ids — SECURITY comment, memory-actions idiom). Calls `fetchOwnerInsights(ownerId, preset)` + `fetchOwnerInsightsSeries(ownerId, preset)`; maps states; `empty: true` when connected but zero rows. Range validated against RANGES (bad input → "30d"). Chart built at 820×180 (ui_kit viewBox).

- [ ] Steps: failing tests (state mapping ×3, range fallback, empty detection) → implement → green + typecheck → commit `feat(web): getAnalytics read action (session-scoped, state-mapped)`.

---

### Task 4: `OttoAnalytics` UI (replaces ComingSoon)

**Files:**
- Create: `apps/web/components/otto/OttoAnalytics.tsx`
- Modify: `apps/web/components/otto/OttoView.tsx` (analytics branch only: `return <OttoAnalytics initial={analytics} />;` — prop threaded in Task 5)
- Modify: `apps/web/app/skin-preview/page.tsx` (mock `analytics` prop: ready-state with a plausible 30-point series, one insight, 4 KPIs incl. one down-delta; plus a second query-flag `?state=notConnected` optional — skip if page structure makes it awkward)

**Structure (match `docs/design-refs/analytics-ui-kit.html` — read it first):**
- Header row: `Analytics` h1 (text-[1.5rem] font-bold tracking-[-0.02em]) + `via Meta · read-only` 12px muted + spacer + range `<select>` styled as the ui_kit pill (h-[34px] rounded-[10px] border text-[13px] font-semibold) with the 5 RANGES; on change → `startTransition(() => getAnalytics({range}))` and swap state client-side.
- KPI grid: `grid grid-cols-2 xl:grid-cols-4 gap-3`; card `rounded-[14px] border border-border bg-card p-[15px]`; label 12px `text-[#86867F]` font-medium; value 26px/700/-0.02em mt-1; delta 12px/600 (up `text-[#15803D]` ▲, down `text-[#B42318]` ▼, flat muted) + `vs previous period` muted 500.
- OTTO insight banner (only when insight non-null): coral cloud SVG (reuse OttoAvatar's cloud at ~30px) + text 14px/1.45 `text-[#9A3A1A]` on `bg-[#FFF6F2] border border-[#FBD9C9] rounded-[16px] px-[17px] py-[15px]` + CTA `h-[38px] rounded-[11px] bg-brand text-white text-[13.5px] font-semibold px-4` labeled `Make more like it`. CTA = PREFILL ONLY: navigate to the home/chat view with the prefill (GREP how a view-switch + input prefill can be done — OttoMemory chips set local input; simplest correct: `router.push("/otto?prompt=" + encodeURIComponent(prefill))` IF the home view reads a `?prompt=` param — GREP for `searchParams.get("prompt")` first; if no such mechanism exists, copy prefill to the chat box is NOT wired — then render the CTA as a `<button>` that stores the prefill in `sessionStorage("otto-prefill")` AND navigate, plus a one-line TODO comment referencing Phase B; report the choice).
- Chart panel: `rounded-[16px] border border-border bg-card p-[18px]`; title 14px/600 `Reach over time` + sub 12px muted with the active range label; SVG `viewBox="0 0 820 180"` height 170: 3 hairline gridlines (#EFEFED/#F4F4F2), area path with the mono gradient (opacity .10→0), line stroke #0A0A0A 2.2, coral r4 circles on peak points. Render from `chart.linePath/areaPath/points`.
- Top posts panel (Phase-A pending state): panel with title `Top posts` + body: 13px muted `Per-post performance needs one more Meta permission — it lights up automatically once approved.` + a quiet secondary button `Learn more` linking nowhere yet (disabled ghost) — copy exactly this.
- States: `notConnected` → centered panel: title `Connect Meta to see your numbers`, sub, black button `Connect Meta` → `router.push("/otto?view=connections")` (GREP the connections view key in OttoNav first — use the real one); `needsReconnect` → same panel with `Reconnect` copy; `ready && empty` → KPI cards render `—` values + sub note `No activity in this period yet.`; loading (transition) → subtle opacity.
- All client ("use client"); initial data from prop (no fetch on mount).

- [ ] Steps: read the design-ref file → grep prefill + connections-view key → implement → `pnpm --filter web typecheck` → commit `feat(web): OttoAnalytics Phase A — KPIs, reach chart, OTTO insight, states (gold-standard match)`.

---

### Task 5: Threading + verify + PR

**Files:**
- Modify: `apps/web/app/otto/page.tsx` (add `getAnalyticsInitial` — call the same internals server-side for "30d"; simplest: export a plain server fn `loadAnalytics(ownerId)` from analytics-actions (NOT "use server"-exported? it IS a "use server" file so every export is an action — instead call `getAnalytics({range:"30d"})` from the page — it re-resolves the session itself, fine) → pass `analytics` through OttoApp → OttoView.
- Modify: `apps/web/components/otto/OttoApp.tsx` (prop pass-through, mirror `records`).

**Steps:**
- [ ] Thread prop; typecheck; run `pnpm --filter web exec vitest run lib/__tests__` (only known pre-existing env failures).
- [ ] MONEY-GUARD audit `git diff main...HEAD --stat -- <frozen list>` → EMPTY; confirm meta-graph/meta-insights diffs are append-only (`git diff main...HEAD -- apps/web/lib/meta-graph.ts` starts with context lines of the old tail).
- [ ] Live render `/skin-preview?view=analytics` (dev server, mock data): compare against `docs/design-refs/analytics-ui-kit.html` side-by-side; screenshot → `~/Desktop/analytics-built.png`; 0 console errors.
- [ ] Commit; push; `gh pr create` (title `feat: Analytics Phase A — real ad-account KPIs + reach chart + OTTO insight`, body: spec §Phasing, money-guard output, screenshot, Phase-B note). Wait CI both green. NO merge — founder gates.

## Self-Review Notes

- Spec coverage: Phase A fully (KPIs/chart/insight/ranges/states/pending organic panel); Phase B explicitly out.
- The delta-by-halving simplification (Task 2 Step 3) deviates from "period-over-period vs previous preset" — honest tradeoff (Meta lacks prev-period presets; halving the series is self-consistent) — flag in PR.
- Prefill mechanism is grep-first with a reported fallback (sessionStorage) — implementer must report which path was taken.
