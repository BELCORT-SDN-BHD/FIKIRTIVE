# QA - Meta Connected Fixture - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Environment: local app + local Postgres, production code paths with `META_GRAPH_MOCK=fixture`

## Boundary

This proves the product behavior after an owner has a valid Meta connection row and decryptable token. It does not prove real Meta OAuth consent/callback or real Meta Graph data. Fixture mode is disabled when `NODE_ENV=production`.

No Meta write/publish action was run. No production data was changed.

## Setup

- Local database: `fikirtive_meta_fixture_qa`
- Authenticated owner: `founder.qa@example.test`
- Seeded founder `MetaConnection`:
  - `status=active`
  - `canWrite=true`
  - `adsWritesPaused=true`
  - `adsAutonomy=ASK`
  - `scope=ads_read,ads_management,pages_show_list`
  - encrypted QA token in the same AES-256-GCM envelope as the app decrypt path
- App env:
  - `AUTH_ENABLED=true`
  - `TOKEN_ENCRYPTION_KEY` set to a local QA key
  - `META_GRAPH_MOCK=fixture`
  - generation/cowork providers kept on mock

## Covered

- `/otto?view=connections`
  - connected state renders `Connected · 2 ad accounts`
  - account rows and last-30-day metrics render
  - Ask/Auto autonomy toggle persists to the local DB
  - ad write kill-switch resumes and pauses again, persisting to the local DB
  - no console errors
- `/otto?view=analytics`
  - ready state renders KPIs and per-ad rows from both fixture ad accounts
  - fixture creative data avoids external image URLs, so the page does not depend on test DNS
  - `Make more like it` pre-fills the Otto composer without auto-sending and without spend
  - mobile 390x844 renders without horizontal overflow

## Findings And Fixes

1. Fixture ad IDs were duplicated across accounts, causing React key warnings in Analytics.
   - Fixed by returning unique fixture ad IDs per account.
2. Fixture creative thumbnails used an external `example.test` URL, causing browser DNS failures.
   - Fixed by omitting external thumbnail/image URLs in fixture creative data.
3. Analytics `Make more like it` wrote a TODO `sessionStorage` key that Otto did not consume.
   - Fixed by passing Analytics CTA text through the existing `onUseInOtto` seed-text path.

## Verification

- `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/meta-graph.test.ts lib/meta-graph.test.ts lib/__tests__/meta-actions.test.ts lib/__tests__/meta-insights.test.ts lib/__tests__/analytics-actions.test.ts lib/meta-performance-actions.test.ts`
  - pass, 53 tests
- `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/meta-graph.test.ts lib/meta-performance-actions.test.ts`
  - pass, 16 tests
- `pnpm --filter @fikirtive/web typecheck`
  - pass
- `git diff --check`
  - pass

Browser evidence:

- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/connections-connected.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/connections-auto.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/connections-unpaused.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/connections-repaused.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/analytics-ready-fixed.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/analytics-make-more-prefill-fixed.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/connections-mobile.png`
- `.gstack/qa-reports/screenshots/local-meta-fixture-2026-07-04/analytics-mobile.png`

## Remaining Gate

Real Meta OAuth remains unproven: consent, callback, token exchange, real encrypted token persistence, reconnect after expiry, and disconnect against a real Meta test account still need an approved external OAuth run.
