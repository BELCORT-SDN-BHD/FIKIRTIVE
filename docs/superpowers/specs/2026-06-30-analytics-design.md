# Analytics — design spec

Date: 2026-06-30 · Builds second · Read-only (G6), no spend

## Goal
Replace the Analytics "coming soon" stub with the locked mockup, wired to **real
Meta data**: KPI cards, a reach-over-time chart, an OTTO insight, and top posts.
gb skin; coral = OTTO/insight only.

## What data we already have vs what needs a small extension
- **Have now**: `fetchOwnerInsights(ownerId, datePreset)` (meta-insights.ts) →
  **ad-account** metrics via the Marketing API (`getAccountInsights`): the spend /
  reach / results family at the account level, with `notConnected` /
  `needsReconnect` / `accounts[]` states. This backs the **KPI cards** (Reach,
  Spend, Sales-est/purchases) directly.
- **Needs a small extension** (plan work, still read-only):
  - **Reach over time chart** — add `time_increment: 1` (daily series) to the
    insights query, or aggregate, to get the line.
  - **Engagement** KPI and **Top posts** (per-post reach) — these are *organic*
    post metrics, not ad-account metrics. They need page/post insights
    (`/{page}/published_posts` + per-post `insights`) which is a separate Graph
    call + the page-read permission we already use for the connector. If that data
    or permission isn't readily available, **Top posts + Engagement move to a fast
    follow** and v1 ships KPI cards (reach/spend/sales) + chart + OTTO insight.

## Components
- **Page** (`OttoAnalytics`, replaces the `ComingSoon` branch in OttoView):
  header ("Analytics · via Meta · read-only") + a date-range select (Last 7/30/90).
- **KPI cards** — from `fetchOwnerInsights` for the selected range, with up/down
  vs previous period when available.
- **Reach-over-time chart** — mono area line with coral peak dots (matches mockup);
  from the daily series.
- **OTTO insight** — a coral banner derived from the data ("your best performer is
  X — make 3 more like it"), with a button that hands the idea to OTTO (reuses the
  existing "use in OTTO" / coworkVary path — no new spend until the owner generates).
- **Top posts** — list by reach (organic; see extension note).
- **States** — not connected → a connect card (shared with Account/Schedule
  Connections); needs-reconnect → reconnect prompt; empty → friendly empty state.

## Money / safety
- Read-only. No spend. The OTTO-insight CTA only *prefills* an OTTO request; the
  owner still approves any generation through the existing gate.

## Testing
- `fetchOwnerInsights` states (notConnected / needsReconnect / accounts) render
  the right UI.
- KPI mapping + the period-delta math (pure helper, unit-tested).
- Chart series builder (pure, unit-tested).

## Open questions for the plan
- Is the page-level organic insight data available with our current Meta
  permissions? If not → Top posts/Engagement = Phase B; KPIs+chart+insight ship now.
- Confirm `AccountMetrics` exact fields (reach/impressions/spend/purchases/ROAS) to
  finalize the 4 KPI cards.
