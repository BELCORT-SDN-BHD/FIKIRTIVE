# Analytics — design spec (FULL: ads + organic posts + full history)

Date: 2026-06-30 · Builds second · Read-only, no spend
Updated: scope is **everything** — full historical data and every past post's
performance, not just the last 30 days or ad metrics (founder: "还要能看过往的数据都,
过往的 post 那些。全部").

## Goal
Replace the Analytics stub with a full performance view, wired to **real Meta data**:
- **KPI cards** — reach, engagement, spend, sales/results.
- **Reach/engagement over time** — chart over any range, incl. long history.
- **Past posts** — every organic post you've published (IG + FB), with per-post
  performance (reach, likes, comments, saves/shares), searchable/sortable, full
  history — not a "top 3" teaser.
- **OTTO insight** — "your best performer is X — make more like it."
gb skin; coral = OTTO/insight only.

## Data sources (and the honest dependency)
Two distinct Meta data families:

1. **Ad-account metrics — available now.** `fetchOwnerInsights(ownerId, datePreset)`
   (meta-insights.ts → Marketing API `getAccountInsights`) gives spend / reach /
   results at the ad-account level, with `notConnected` / `needsReconnect` states.
   Backs the spend/sales/reach KPIs + the ad side of the chart. Add `time_increment: 1`
   for the daily series.

2. **Organic post performance — needs a new fetch + likely a new permission.**
   Per-post reach/engagement for the posts on the connected IG business account +
   FB page is **not** in ad-account insights. It comes from:
   - IG: `GET /{ig-user}/media` (paginate for full history) → per-media
     `insights` (reach, likes, comments, saved, shares).
   - FB: `GET /{page}/published_posts` → per-post `insights`.
   These need `instagram_manage_insights` + `pages_read_engagement` /
   `read_insights` — **additional scope beyond the current read connector, very
   likely an App Review item** (same nature as Schedule's publish permission).
   **Synergy**: posts published *through Schedule* store `metaPostId`, so their
   insights are directly queryable by id — Analytics gets richer as Schedule is used.

3. **Full history** — paginate the media/posts endpoints (cursor) and cache; date
   range selector incl. 7/30/90/365/All-time + custom. Cache fetched insights
   (a small `PostInsightSnapshot` cache keyed by metaPostId + day) so the history
   view is fast and we don't re-hit rate limits on every load.

## Components
- **Page** (`OttoAnalytics`, replaces the `ComingSoon` branch): header
  ("Analytics · via Meta · read-only") + date-range select (7/30/90/365/All/custom).
- **KPI cards** — ad metrics (spend/sales/reach) + organic engagement, period-over-period delta.
- **Chart** — reach/engagement over time (mono area, coral peak dots).
- **OTTO insight** — coral banner derived from the best post; CTA prefills an OTTO
  request (no spend until the owner generates).
- **Past posts** — full, paginated, searchable/sortable table/grid of every published
  post with thumbnail, channel, date, and metrics; click → per-post detail (the
  numbers + the asset). "Best" badge on the top performer.
- **States** — not connected / needs-reconnect / insights-permission-pending
  (show ad metrics + a "connect deeper insights" prompt) / empty.

## Money / safety
- Read-only. No spend. OTTO-insight CTA only prefills; generation still goes through
  the existing approval gate.

## Phasing (so it ships even before the organic-insights permission clears)
- **A (now)**: ad-account KPIs + chart + OTTO insight, with full date ranges +
  history on the ad data. Past-posts section present with a clear
  "deeper insights coming once Meta approves access" state.
- **B (after the insights permission/review)**: full organic past-posts performance
  + organic engagement KPIs + per-post detail. Lights up automatically once the
  permission is granted — same parallel-review pattern as Schedule.

(So "全部" is fully designed in; the only gate is Meta granting the organic-insights
permission, which you submit alongside the publish permission.)

## Testing
- `fetchOwnerInsights` states render correctly.
- Period-delta + chart-series builders (pure, unit-tested).
- Organic fetch: pagination over full history, snapshot cache hit/miss, rate-limit-safe.
- Per-post insight mapping (pure, unit-tested).

## Open questions for the plan
- Confirm `AccountMetrics` exact fields → finalize KPI cards.
- Confirm which organic-insight permissions our Meta app can get + whether they need
  review (bundle with the Schedule publish-permission submission).
- `PostInsightSnapshot` cache shape + refresh cadence.
