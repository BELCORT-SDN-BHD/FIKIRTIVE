# External Smoke Results - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Environment: production, `https://fikirtive.com`
Run window: 2026-07-04 06:30-06:56 UTC / 2026-07-04 14:30-14:56 +08
PR head observed during run: `6140e15fa2613d6e9e2150781793fce89c5be9f1`

## Approval

Founder explicitly approved production testing with the supplied admin and normal-user magic links, Gmail/Google OAuth testing, real generation spend up to USD 60, and admin destructive/grant-credit operations for the closed beta.

No magic-link tokens, session cookies, provider credentials, or raw OAuth secrets are recorded in this report.

## Executive Result

Overall result: partial pass.

- Production sign-in works with fresh Better Auth magic links for both normal and admin accounts.
- Normal production user surfaces loaded without console/runtime failures for the tested route set.
- Admin production surfaces loaded for the currently deployed admin console.
- One real production image generation completed successfully.
- Spend used: USD 0.16 of the approved USD 60 cap.
- Ledger behavior passed for the real generation: `RESERVE -4 +4 hold` followed by `SETTLE 0 -4 hold`.
- Google OAuth failed before consent with Google `redirect_uri_mismatch`.
- Production was not running PR #131 admin v2 at the time of this run: the PR-only admin routes returned 404, and GitHub reported PR #131 merge state `DIRTY`.

## CI And Deploy State

GitHub PR state observed after the run:

- Head: `6140e15fa2613d6e9e2150781793fce89c5be9f1`
- Checks: green
  - `typecheck + fences + frozen lockfile`: success
  - `next build (apps/web)`: success
  - `unit + integration tests`: success
- Merge state: `DIRTY`

Production canary caveat: production was not serving the new admin v2 route set from PR #131. The following PR routes exist in source but returned 404 on production during this run: `/admin/otto`, `/admin/staff`, `/admin/money`, and `/admin/cases`.

## Auth

Fresh normal-user magic link:

- Result: pass.
- Landed at `/otto`.
- Session cookie was set.
- Visible identity: `nicksgan@gmail.com`.
- Visible balance: `999.7 credits`.
- Screenshot: `.gstack/qa-reports/screenshots/prod-normal-otto-home.png`

Fresh admin magic link:

- Result: pass.
- Landed at `/otto`.
- Session cookie was set.
- Visible identity: `tools@belcort.com`.
- Visible balance before paid generation: `9,999,861.3 credits`.
- Screenshot: `.gstack/qa-reports/screenshots/prod-admin-otto-home.png`

Initial auth note: an earlier normal-user token produced a Cloudflare 502 from the Better Auth magic-link verify route and was then invalid on retry. Fresh replacement links succeeded, so this did not block the run, but it is worth watching as an auth-edge transient.

## Normal User Route Smoke

Account: `nicksgan@gmail.com`

Routes tested:

- `/otto`
- `/otto?view=canvas`
- `/otto?view=stuff`
- `/otto?view=memory`
- `/otto?view=schedule`
- `/otto?view=analytics`
- `/otto?view=account`
- `/billing`

Result: pass for route load and no-spend navigation.

Billing evidence:

- Visible balance: `999.7 credits`.
- Packs visible:
  - Starter: 50 credits, MYR 25
  - Standard: 220 credits, MYR 100
  - Pro: 600 credits, MYR 250
- Screenshot: `.gstack/qa-reports/screenshots/prod-normal-billing.png`

No Stripe checkout was run.

## Google OAuth

Route: `/login?from=%2Fotto`
Action: clicked `Continue with Google`.

Result: fail before Google consent.

Observed Google error:

- `Error 400: redirect_uri_mismatch`
- App shown by Google: `Potato App`
- Redirect URI shown by Google: `https://fikirtive.com/api/better-auth/callback/google`

Required fix: add `https://fikirtive.com/api/better-auth/callback/google` to the authorized redirect URIs for the Google OAuth client configured in production, then rerun the OAuth smoke.

No Google account consent or app callback state was reached.

## Admin Route Smoke

Account: `tools@belcort.com`

Routes tested and loaded:

- `/admin` -> `/admin/settings`
- `/admin/settings`
- `/admin/knowledge`
- `/admin/models`
- `/admin/cost`
- `/admin/credits`
- `/admin/tenants`
- `/admin/system`
- `/admin/conversations`
- `/admin/team`
- `/admin/audit`
- `/admin/directives`
- `/admin/content`

Result: pass for currently deployed admin route load, with one production issue below.

Production issue: `/admin/content` loaded but emitted multiple `/files/u/...` 404s for media previews. The current PR redirects `/admin/content` to `/admin/cases`, so the 404s were observed on the older deployed admin content page, not on the PR #131 admin v2 route. If the old content page remains reachable after deploy, it should avoid direct cross-tenant `/files` previews or serve them through an explicit admin-gated preview path.

Admin screenshots:

- `.gstack/qa-reports/screenshots/prod-admin-settings.png`
- `.gstack/qa-reports/screenshots/prod-admin-cost.png`
- `.gstack/qa-reports/screenshots/prod-admin-credits.png`
- `.gstack/qa-reports/screenshots/prod-admin-tenants.png`
- `.gstack/qa-reports/screenshots/prod-admin-system.png`
- `.gstack/qa-reports/screenshots/prod-admin-content.png`

## Real Image Generation

Account: `tools@belcort.com`
Route: `/otto?view=canvas`
Project created during run: `01KWNY7W50MF26W468CF9H1QEK`
Prompt: a simple red apple product-smoke prompt on white background.

Result: pass.

Observed flow:

- Created a new campaign/project.
- Opened the image generation composer.
- Submitted an image prompt.
- Confirmed the product spend dialog: `Generate 4 variations?`
- Canvas showed billed-only-on-finish progress state.
- Four image result nodes appeared on completion.
- Final visible output included the expected red apple image.

Evidence:

- Before generation: `.gstack/qa-reports/screenshots/prod-admin-before-generation.png`
- Confirmation dialog: `.gstack/qa-reports/screenshots/prod-admin-image-dialog.png`
- Generating state: `.gstack/qa-reports/screenshots/prod-admin-image-generating.png`
- Completed result: `.gstack/qa-reports/screenshots/prod-admin-image-final.png`

Cost and ledger after-state:

- Admin cost total moved from USD 10.45 to USD 10.61.
- New cost row: `image`, `seedream`, `DONE`, USD 0.16, `2026-07-04 06:51`.
- Daily cost row: `2026-07-04`, USD 0.16, 1 job.
- Admin credit balance moved from `9,999,861.3` to `9,999,857.3`.
- Held credits after completion: `0`.
- Recent ledger:
  - `RESERVE -4 +4 hold SYSTEM 2026-07-04 06:51`
  - `SETTLE 0 -4 hold SYSTEM 2026-07-04 06:51`

Margin check:

- Displayed charge: 4 credits.
- Actual COGS: USD 0.16.
- Existing pricing model treats 1 credit as approximately USD 0.10 of user-facing value.
- Implied revenue value: USD 0.40.
- Gross margin: 60%.
- Result: above the 45% constitutional floor.

## Not Run

- Stripe checkout/webhook.
- Meta OAuth.
- Real Seedance video.
- Real reference-video generation.
- Real Otto LLM-only spend accounting.
- Production verification of PR #131 admin v2 after deploy.

## Cleanup

- No ledger rows were edited.
- No admin destructive/grant-credit operation was needed.
- Local browser state files containing production session cookies were removed after evidence capture.
- Screenshots were retained under `.gstack/qa-reports/screenshots/`.

## Required Follow-Ups

1. Rebase or update PR #131 until GitHub merge state is `CLEAN`, rerun CI, then have an authorized human merge/deploy.
2. After deploy, rerun production canary specifically against the PR #131 admin v2 routes.
3. Fix Google OAuth authorized redirect URI in Google Cloud Console:
   `https://fikirtive.com/api/better-auth/callback/google`
4. Decide whether the old `/admin/content` route should remain reachable. If yes, remove direct cross-tenant `/files` media previews or replace them with an explicit admin-gated preview route.
5. Run the remaining approved-but-not-executed gates only if still needed: Stripe test-mode checkout/webhook, Meta OAuth, real video, reference-video, and Otto LLM accounting.
