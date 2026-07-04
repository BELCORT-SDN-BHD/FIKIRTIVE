# External Smoke Results - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Environment: production, `https://fikirtive.com`
Run window: 2026-07-04 06:30-06:56 UTC / 2026-07-04 14:30-14:56 +08
Follow-up window: 2026-07-04 07:27-07:30 UTC / 2026-07-04 15:27-15:30 +08
Second follow-up window: 2026-07-04 07:41-07:44 UTC / 2026-07-04 15:41-15:44 +08
Third follow-up window: 2026-07-04 08:06 UTC / 2026-07-04 16:06 +08
PR head observed during first run: `6140e15fa2613d6e9e2150781793fce89c5be9f1`
PR head observed during follow-up: `f6461fc55fc16f7365d6c0241041204f2ecac2ab`
PR head observed before the second follow-up: `cdad10936a2ba4da826a7a704359d7df26c62207`
PR head observed before the third follow-up: `550e605de30addf27dd907360f38bf4496e8697f`

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
- Google OAuth failed before consent during the first run with Google `redirect_uri_mismatch`; all three follow-ups passed the OAuth initiation boundary and reached Google's sign-in page with the expected Better Auth callback URI.
- Google consent/callback was not completed because no Google account credentials were available to the browser.
- Replacement magic links supplied for the follow-ups were already invalid, expired, or consumed; they did not create new sessions.
- Production was not running PR #131 admin v2 at the time of the first run: the PR-only admin routes returned 404. PR #131 is now merge-clean and CI-green, but production canary still requires a human merge/deploy.

## CI And Deploy State

GitHub PR state observed after the first run:

- Head: `6140e15fa2613d6e9e2150781793fce89c5be9f1`
- Checks: green
  - `typecheck + fences + frozen lockfile`: success
  - `next build (apps/web)`: success
  - `unit + integration tests`: success
- Merge state: `DIRTY`

GitHub PR state observed after the follow-up:

- Head: `f6461fc55fc16f7365d6c0241041204f2ecac2ab`
- Checks: green
  - `typecheck + fences + frozen lockfile`: success
  - `next build (apps/web)`: success
  - `unit + integration tests`: success
- Merge state: `CLEAN`

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

Follow-up auth note: replacement admin/normal magic-link pairs redirected through `/otto?error=INVALID_TOKEN` and landed on `/login`. The third follow-up repeated the same result for both `tools@belcort.com` and `nicksgan@gmail.com`. They were therefore expired, already consumed, or otherwise invalid at test time. No raw token values are recorded.

Second follow-up evidence:

- `.gstack/qa-reports/screenshots/prod-smoke-2026-07-04/admin-link-invalid.png`
- `.gstack/qa-reports/screenshots/prod-smoke-2026-07-04/user-link-invalid.png`

Third follow-up evidence:

- `.gstack/qa-reports/screenshots/prod-smoke-2026-07-04/admin-link-invalid-third-followup.png`
- `.gstack/qa-reports/screenshots/prod-smoke-2026-07-04/user-link-invalid-third-followup.png`

Follow-up sign-out note: clicking the production Account `Sign out` control cleared the session, but the visible page did not immediately navigate to `/login`; a subsequent protected `/otto` navigation redirected to `/login?from=%2Fotto`. This should be rechecked after deploy because local QA for the PR had sign-out passing.

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

Initial result: fail before Google consent.

Observed Google error:

- `Error 400: redirect_uri_mismatch`
- App shown by Google: `Potato App`
- Redirect URI shown by Google: `https://fikirtive.com/api/better-auth/callback/google`

Required fix from the initial run: add `https://fikirtive.com/api/better-auth/callback/google` to the authorized redirect URIs for the Google OAuth client configured in production, then rerun the OAuth smoke.

No Google account consent or app callback state was reached.

Follow-up result: pass for OAuth initiation, still unproven for consent/callback.

Observed follow-up behavior, repeated in the second and third follow-ups:

- `POST /api/better-auth/sign-in/social` returned `200`.
- Google OAuth auth URL returned `302`.
- Browser reached the Google sign-in page for `fikirtive.com`.
- Redirect URI in the Google URL was `https://fikirtive.com/api/better-auth/callback/google`.
- No console errors were observed.

Follow-up evidence:

- `.gstack/qa-reports/screenshots/prod-2026-07-04/google-oauth-google-login.png`
- `.gstack/qa-reports/screenshots/prod-smoke-2026-07-04/google-oauth-entry.png`
- `.gstack/qa-reports/screenshots/prod-smoke-2026-07-04/google-oauth-third-followup.png`

The earlier `redirect_uri_mismatch` appears fixed in Google Cloud configuration. Full OAuth completion still needs a controlled Google account consent flow.

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

1. Have an authorized human merge/deploy PR #131 now that it is `CLEAN` and CI-green.
2. After deploy, rerun production canary specifically against the PR #131 admin v2 routes.
3. Complete Google OAuth through consent/callback with a controlled Google account; initiation now reaches Google and no longer shows `redirect_uri_mismatch`.
4. Recheck Account `Sign out` on the deployed PR build; current production cleared the session but did not visibly navigate until the next protected route load.
5. Decide whether the old `/admin/content` route should remain reachable. If yes, remove direct cross-tenant `/files` media previews or replace them with an explicit admin-gated preview route.
6. Run the remaining approved-but-not-executed gates only if still needed: Stripe test-mode checkout/webhook, Meta OAuth, real video, reference-video, and Otto LLM accounting.
