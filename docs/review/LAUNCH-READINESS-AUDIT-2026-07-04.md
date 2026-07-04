# Launch Readiness Audit - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Last code head audited before this follow-up: `3c655e0`
Merge state: `CLEAN`

This audit consolidates the local QA reports, tracked review docs, PR comments, and CI status for the public-launch readiness goal. It does not replace the per-surface reports; it maps them to the launch requirements and names the remaining gates.

## Scope Rules

- `docs/BLUEPRINT.md` remains the constitution. It was read and was not edited.
- `.claude/CLAUDE.md` merge and spend discipline still applies: all changes through PR, CI green before merge, no direct main push, no self-merge, and no real supplier spend without explicit founder approval per spend.
- Local browser QA in this audit used safe boundaries unless explicitly noted:
  - `GENERATION_PROVIDER=mock`
  - `COWORK_PROVIDER=mock`
- Production smoke explicitly used real generation once and real Google OAuth initiation; remaining paid/external gates are listed below.

## Requirement Status

| Requirement | Status | Evidence |
|---|---|---|
| Existing public product surfaces load and core safe controls work | Proven for local/no-spend state | QA reports and PR comments listed below |
| Buttons and controls are understood to spend boundary | Proven for safe controls; paid/external controls stopped at confirm/OAuth boundary | Canvas, My Stuff, Templates, Otto cards, Account, Admin, Connections reports |
| Mobile layout is launch-safe for tested surfaces | Proven for tested surfaces at 390px | Per-surface mobile checks and screenshots |
| Margin model is above constitutional floor | Proven from executable pricing and current official BytePlus evidence | `docs/review/MARGIN-PARITY-REPORT-2026-07-04.md` |
| All changes/reports are handled in PR | Proven for tracked reports and PR comments | PR #131, tracked docs, comments |
| CI is green | Proven for pushed head `ade0dcd`; pending recheck after `fd7f8e2` push | GitHub checks for `ade0dcd`: typecheck/fences/lockfile, next build, unit + integration all passed |
| Live paid supplier smoke | Partially proven in production | One real production image generation passed with USD 0.16 COGS; see `docs/review/EXTERNAL-SMOKE-RESULTS-2026-07-04.md`. Video, reference-video, and Otto LLM-only accounting were not run. |
| Real Stripe checkout/webhook | Not yet proven; checkout failure path hardened | Local QA intentionally avoided real checkout. Commit `fd7f8e2` makes Stripe Checkout Session creation failures return a user-visible retry error instead of an unhandled server action failure. |
| Real Meta/Google OAuth and connected Meta states | Partially proven for Google initiation; Meta not run | Follow-up Google OAuth reached Google's sign-in page with the Better Auth callback URI; consent/callback and connected OAuth state remain unproven. See `docs/review/EXTERNAL-SMOKE-RESULTS-2026-07-04.md`. |
| Production deploy/canary | Partially proven for current production only | Current production route smoke passed for tested normal/admin routes, but production was not serving PR #131 admin v2. PR #131 is now merge-clean and CI-green; post-merge deploy canary remains required. |
| Direct admin credit-action cap | Proven locally with tests and browser QA | Commit `3c655e0` enforces the 1,000 displayed-credit direct cap for founder and tenant actions; over-limit Apply buttons are disabled and server actions reject the same input. |

## Browser QA Coverage

### Login and Legal

Evidence:
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880583712
- Local report: `.gstack/qa-reports/qa-report-login-legal-2026-07-04.md`

Covered:
- `/login`, `/login?from=/otto`, `/terms`, `/privacy`.
- Empty magic-link validation, password show/hide, wrong-password 401 with visible alert, magic-link local sink, forgot flow, Terms/Privacy links, Google OAuth button presence.
- Desktop and mobile no-overflow checks.

Result: pass. No code change required.

### Otto First Run and Front Door

Evidence:
- Tracked report: `docs/review/QA-OTTO-FIRST-RUN-2026-07-04.md`
- PR comments:
  - https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880780284
  - https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880793261

Covered:
- First authenticated `/otto?view=canvas` visit.
- Onboarding actions to My Stuff and Brand memory.
- Dismiss persistence via `localStorage["otto:onboarded"]`.
- Composer disabled/enabled states, start path, zero-credit recovery, Top up link.
- Brief form expand/save.
- All four goal tiles: `Sell a product`, `Announce a sale`, `Get more followers`, `Make a video`.
- Desktop console/network and mobile 390x844 layout.

Fixes:
- `getOrCreateDefaultProject()` no longer calls `revalidatePath()` during server render.
- Mobile first-run layout reserves onboarding height so goal controls do not sit under the overlay.

Result: pass under mock providers and zero-credit state.

### Otto Chat, Cards, API Boundary, Redirects, Files

Evidence:
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880699939
- Local report: `.gstack/qa-reports/qa-report-otto-chat-cards-api-redirects-2026-07-04.md`

Covered:
- Chat/card render fixture for `GEN_CARD`, pack group, `STORYBOARD_CARD`, `GEN_RESULT`, `TURN_ERROR`, `RESEARCH_CARD`, and `RESEARCH_REPORT`.
- Safe no-spend controls: expand/collapse, copy, composer prefill, result nudge dismiss/focus, research confirm cancel.
- `/api/otto/stream` validation for malformed JSON, empty JSON, bogus project.
- Redirects `/`, `/m`, `/library` -> `/otto`.
- Authenticated `/files` full GET `200` and range GET `206`.
- Dev route guard for `/kitchensink`; `/skin-preview/*` classification checked.

Fixes:
- Mobile canvas gutter now hides React Flow descendants while preserving the collapse handle.
- `/kitchensink` now production-guards with `notFound()`.

Result: pass for local no-spend chat/card and API boundary coverage.

### Canvas and Project Shell

Evidence:
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880555468
- Local report: `.gstack/qa-reports/qa-report-canvas-shell-2026-07-04.md`

Covered:
- Project creation, rename, delete.
- QuickBrief save and DB persistence.
- Sidebar collapse/show and OTTO panel collapse/show.
- React Flow zoom, fit, interactivity toggle, hand/select.
- Canvas toolbar add text, edit persistence, delete confirmation.
- Image-generation and text-to-video dialogs opened and canceled before spend.
- Mobile handle and overflow checks.

Fix:
- Mobile OTTO collapse handle remains fully tappable at 390px.

Result: pass. Temporary project, nodes, and jobs cleaned up. `GenJob` count for the temp project stayed `0`.

### My Stuff

Evidence:
- Local report: `.gstack/qa-reports/qa-report-stuff-2026-07-04.md`

Covered:
- `/otto?view=stuff`.
- Filters, search, upload dialog, temporary PNG upload, tile delete, product-image dialog, generated-reference tab up to spend boundary, mobile.

Fix:
- `AddAssetDialog.reset()` clears `saving`, preventing stale `Generating...` state on reopen.

Result: pass. Temporary QA entities soft-deleted; recent `RefGenJob` count stayed `0`.

### Library, Templates, Discover, Connections

Evidence:
- `.gstack/qa-reports/qa-report-library-url-only-2026-07-04.md`
- `.gstack/qa-reports/qa-report-templates-url-only-2026-07-04.md`
- `.gstack/qa-reports/qa-report-discover-url-only-2026-07-04.md`
- `.gstack/qa-reports/qa-report-connections-url-only-2026-07-04.md`

Covered:
- URL-only reachable views accepted by `/otto`.
- Library desktop/mobile toolbar and route state.
- Templates cards, modal validation, local mock generation result, detail panel controls, mobile.
- Discover category filters, prompt modal, copy fallback, Use in Otto composer prefill, mobile.
- Connections disconnected state and `/api/meta/authorize` handoff link without starting OAuth.

Fixes:
- Library mobile toolbar wrapping.
- Template StrictMode polling cleanup and Open in detail dialog unmount.
- Discover copy fallback and feedback.

Result: pass for local/url-only and disconnected states. Connected OAuth states remain external-gated.

### Brand Memory

Evidence:
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880512574
- Local report: `.gstack/qa-reports/qa-report-brand-memory-2026-07-04.md`

Covered:
- `/otto?view=memory`.
- Facts, customer groups, products, active offers, past offers, prompt chips, product image picker, mobile tabs.
- Add/edit/delete/archive/unarchive flows where UI supports them.

Boundary:
- Brand memory chat Send was intentionally not clicked because it can invoke Otto/LLM.

Result: pass. Temporary QA memory and brand records cleaned up.

### Account, Billing, Settings

Evidence:
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880577648
- Local reports:
  - `.gstack/qa-reports/qa-report-account-billing-2026-07-04.md`
  - `.gstack/qa-reports/qa-report-account-settings-2026-07-04.md`

Covered:
- `/otto?view=account`, `/billing`, `/billing?status=success`, `/billing?status=cancel`.
- Balance, ledger, channel links, owner settings, schedule defaults, danger-zone confirm, sign out.
- Reversible settings changes and DB restore.
- Billing empty-pack state when local Stripe is unconfigured.

Fixes:
- Disconnected Meta autonomy writes now fail closed instead of pretending to save.
- Mobile account settings stack correctly instead of squeezing into a narrow strip.

Result: pass for local no-Stripe state. Real checkout remains external-gated.

### Schedule and Analytics

Evidence:
- `.gstack/qa-reports/qa-report-schedule-stub-2026-07-04.md`
- `.gstack/qa-reports/qa-report-analytics-2026-07-04.md`

Covered:
- Schedule coming-soon stub.
- Analytics not-connected Meta state, Connect Meta handoff to Connections, TikTok coming-soon platform panel, desktop/mobile.

Result: pass for documented stub/disconnected states. Real connected insights remain external-gated.

### Admin Console

Evidence:
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880619372
- Local report: `.gstack/qa-reports/qa-report-admin-console-2026-07-04.md`

Covered:
- Live admin routes: `/admin`, `/admin/money`, `/admin/tenants`, `/admin/staff`, `/admin/cases`, `/admin/otto`, `/admin/audit`, `/admin/system`.
- Legacy redirects for old admin routes.
- Desktop nav/refresh, money validation, ledger row/filter, staff disabled states, Otto Ops disabled-at-rest controls, audit filter, tenant detail validation, impersonation cancel boundary, case sealed-content boundary, mobile select nav.

Boundary:
- No tenant suspension, session cutting, real impersonation, real money grant, Stripe checkout, OAuth, or paid supplier calls.

Result: pass. Monitored dev diagnostic remains: intentional admin aggregate reads trigger tenant-guard warning noise.

### Local Prod-Scale Seeded Admin QA

Evidence:
- Screenshots:
  - `.gstack/qa-reports/screenshots/local-prod-scale-2026-07-04/admin-home.png`
  - `.gstack/qa-reports/screenshots/local-prod-scale-2026-07-04/admin-money.png`
  - `.gstack/qa-reports/screenshots/local-prod-scale-2026-07-04/admin-money-overlimit.png`
  - `.gstack/qa-reports/screenshots/local-prod-scale-2026-07-04/admin-money-overlimit-fixed.png`
  - `.gstack/qa-reports/screenshots/local-prod-scale-2026-07-04/tenant-overlimit-fixed.png`

Covered:
- Seeded QA database with production-scale admin samples: 2 orgs, 10 projects, 24 entities, 282 assets, 632 generations, 50 threads, 60 messages, 40 nodes, and 10 ledger rows.
- Founder local magic-link sign-in, `/otto`, `/admin`, `/admin/money`, and `/admin/tenants/org_qa_merchant`.
- Admin money overview, BytePlus pack telemetry, ledger/risk queue, tenant detail credit activity, and direct credit-action cap states.

Finding and fix:
- Before `3c655e0`, `/admin/money` let a super-admin apply `+1,500` displayed credits despite the "Over finance limit" state. The local ledger mutated, proving the server action was the weak point.
- `3c655e0` removed the super-admin bypass in `grantCreditsAction`, added the same 1,000 displayed-credit cap to `grantTenantCredits`, and disabled/prevented over-limit form submits in both admin UIs.
- Retest: founder money form and tenant detail form both show `Over finance limit` with Apply disabled for `1501`; no new `QA over-limit after fix` ledger/audit row appeared.

Result: pass after fix.

## Margin and Spend Safety

Evidence:
- Tracked report: `docs/review/MARGIN-PARITY-REPORT-2026-07-04.md`
- PR comment: https://github.com/toolsbbb/FIKIRTIVE/pull/131#issuecomment-4880733865

Proven:
- Image margin: 60%-65%.
- Seedance Fast 720p 5s margin: 51.9%.
- Seedance Fast 720p 10s margin: 45.0%.
- Reference video 2-6s input + 5s output margin: 46.9%.
- Otto LLM margin: 50.0%.
- Advanced Creation Rights and private virtual portrait/real-human docs are treated as KYC/private-asset-library paths, not current public launch spend paths.

Load-bearing constraints:
- Seedance 10s is exactly at the 45% constitutional floor.
- Reference-video input cap is 2-6s and output is fixed 5s.
- Fast 1080p is not enabled.
- Losing the resource-pack rate or changing supplier prices must trigger pricing review.

## Fix Commits In This PR Slice

- `52b0067` - Library mobile toolbar wrapping.
- `7d9835a` - Template generated result detail path.
- `6dd63d9` - Discover copy prompt feedback/fallback.
- `49888ea` - My Stuff Add dialog saving reset.
- `c86046e` - Mobile OTTO/canvas handle visibility.
- `3564bec` - Mobile canvas gutter content hiding and `/kitchensink` production guard.
- `05fdc3d` - BytePlus pricing and margin evidence.
- `7ffcd91` - First-run front door blocker and mobile onboarding spacing.
- `f0adbc3` - All four front-door goal tiles recorded in QA report.
- `0985a94` - Launch readiness audit added.
- `3c655e0` - Direct admin credit-action cap enforced for founder and tenant credit actions.
- `fd7f8e2` - Billing checkout session failures return a friendly retry error.

## Current Verification State

External production follow-up:

- Result file: `docs/review/EXTERNAL-SMOKE-RESULTS-2026-07-04.md`
- One real production image generation completed successfully with USD 0.16 COGS and paired reserve/settle ledger rows.
- Production Google OAuth initially failed before consent with `redirect_uri_mismatch`; two follow-ups reached Google's sign-in page with `https://fikirtive.com/api/better-auth/callback/google`.
- Production did not yet validate PR #131 admin v2 because the PR-only admin routes returned 404 before merge/deploy.
- Follow-up replacement admin and normal magic links were invalid at test time across two attempts; earlier fresh magic links had already proven both roles.
- Current production Account sign-out cleared the session but did not visibly navigate until the next protected route load; recheck after deploy.

Local verification for `3c655e0`:

- `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/credit-actions.test.ts lib/__tests__/tenant-actions.test.ts`: pass, 55 tests.
- `pnpm --filter @fikirtive/web typecheck`: pass.
- Browser retest on `http://localhost:3110/admin/money`: over-limit Apply disabled and no new ledger row.
- Browser retest on `http://localhost:3110/admin/tenants/org_qa_merchant`: over-limit Apply disabled.

Local verification for `fd7f8e2`:

- `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/billing-actions.test.ts lib/__tests__/stripe-webhook.test.ts`: pass, 19 tests.
- `pnpm --filter @fikirtive/web typecheck`: pass.
- Browser checkout was not run because this worktree has no Stripe secret configured; the remaining real checkout/webhook gate still requires an approved Stripe test/live-mode run.

GitHub CI for pushed code head `ade0dcd`:

- `typecheck + fences + frozen lockfile`: pass
- `next build (apps/web)`: pass
- `unit + integration tests`: pass

GitHub CI for `fd7f8e2` must be rechecked after push.

Recent local verification recorded in the tracked reports includes:

- `git diff --check`
- focused Vitest regression for default project creation
- web typecheck
- web build with local auth env
- core spend/gen/LLM pricing tests
- generation BytePlus provider tests
- touched-file lint/typecheck checks for fixed UI slices

## Remaining Launch Gates

These are the only material items not proven by current evidence:

1. Live paid supplier smoke.
   - One real production image generation has passed.
   - Still needed to prove real Anthropic/Otto LLM, real Seedance video, and real reference-video generation with production-like credentials.
   - Remaining paid calls must stay inside the founder-approved spend cap.
   - Execution checklist: `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md`.

2. Real Stripe checkout and webhook.
   - Local Billing was tested in the unconfigured-pack state.
   - Real checkout must be tested only with an approved Stripe test/live-mode plan and expected ledger assertion.
   - Execution checklist: `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md`.

3. Real Meta/Google OAuth and connected Meta states.
   - Local QA verified links and disconnected states.
   - Google OAuth initiation now reaches Google sign-in; callback/consent still needs a controlled Google account.
   - Connected account, insights, publish-draft, reconnect, outage, pause, and disconnect states need OAuth credentials or seeded connection fixtures.
   - Execution checklist: `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md`.

4. Production deploy/canary.
   - PR is clean and CI green.
   - No merge, deploy, or production canary has been run from this worktree.
   - Execution checklist: `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md`.

## Recommended Paid/External Smoke Matrix

Run only after explicit founder approval for each spend group:

| Gate | Suggested scope | Why |
|---|---|---|
| Otto LLM | 1 short chat turn with a small prompt | Proves real LLM transport, metering, and zero-refund path |
| Image generation | 1 image job or one template mock-to-real equivalent | Proves provider auth, storage, generation result attach, and COGS record |
| Seedance video | 1 5s 720p normal video | Proves task submit/poll/store path |
| Reference video | 1 allowed 2-6s input -> fixed 5s output | Proves `reference_video` payload and margin-critical gate |
| Stripe | 1 test-mode checkout/webhook credit grant | Proves money-in path without touching supplier spend |
| Meta OAuth | 1 test/dev Meta account connect and disconnect | Proves connected account state and Analytics/Connections transitions |

## Readiness Conclusion

Software-local launch readiness is strong for the tested no-spend and disconnected states: routes load, safe buttons work, known defects found during QA were fixed, margin math is documented against current official BytePlus evidence, and PR #131 is green.

Full public launch remains gated on remaining paid supplier smoke beyond the proven image path, real Stripe checkout/webhook verification, real OAuth consent/connected-state verification, and post-deploy canary after a human merge/deploy. Without those, completion of the original goal is not proven.
