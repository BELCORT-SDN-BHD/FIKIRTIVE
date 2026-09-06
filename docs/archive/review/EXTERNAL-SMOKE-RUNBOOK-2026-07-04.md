# External Smoke Runbook - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131

This runbook covers the remaining launch gates that local mock QA cannot prove: paid supplier calls, Stripe checkout/webhook, real OAuth connected states, and production canary. It is intentionally executable only after founder approval for the specific external action being run.

## Hard Gates

- Do not run any real BytePlus, fal, Anthropic, Stripe live-mode, Meta OAuth, Google OAuth, or production deploy action without explicit founder approval for that action group.
- Approval must name the action group, environment, maximum displayed credits or USD cap where money can move, and stop condition.
- Use a test owner, test org, and test project only. Do not use customer data.
- Do not paste secrets, tokens, raw webhook payload secrets, or provider credentials into reports or PR comments.
- Stop immediately if a balance goes negative, a refund is missing after failure, a job double-settles, COGS is absent, or calculated gross margin falls below 45%.

## Approval Text To Collect

Use one approval line per group. The founder can approve one group or several, but each group must be explicit.

| Group | Required approval shape |
|---|---|
| Otto LLM | "Approved: one real Otto LLM smoke for test org, cap N displayed credits or USD N, stop on first unexpected debit." |
| Image generation | "Approved: one real image generation smoke for test org, cap N displayed credits or USD N, stop on first provider or ledger mismatch." |
| Seedance video | "Approved: one real Seedance 5s 720p smoke for test org, cap N displayed credits or USD N, stop on first provider or ledger mismatch." |
| Reference video | "Approved: one real reference-video smoke with 2-6s input and fixed 5s output, cap N displayed credits or USD N, stop on first provider or ledger mismatch." |
| Stripe | "Approved: one Stripe test-mode checkout/webhook smoke for test org, expected credit pack N, stop before live-mode money." |
| OAuth | "Approved: one Meta or Google OAuth smoke using test account, no production customer account, stop before external write/publish." |
| Production canary | "Approved: deploy PR #131 after green CI and run production canary on test account only." |

## Preflight

- Confirm PR merge state is `CLEAN` and current head CI is green.
- Confirm `docs/BLUEPRINT.md` has not been edited.
- Record the exact commit SHA being tested.
- Record provider mode for each group, for example `GENERATION_PROVIDER=byteplus` or `COWORK_PROVIDER=anthropic`.
- Confirm test org has enough credits for the approved smoke and no unrelated jobs are running.
- Capture before-state for the test org: credit balance, recent ledger entries, recent `GenJob` or LLM request records, and relevant admin cost totals.
- Confirm app logs are accessible for the run window.

## Evidence File

Create a result file after the run:

`docs/review/EXTERNAL-SMOKE-RESULTS-YYYY-MM-DD.md`

Record:

- Founder approval text and timestamp.
- Commit SHA, environment, and provider modes.
- Test owner/org/project identifiers that are safe to disclose.
- Browser route used and screenshots for each completed gate.
- Ledger before/after rows, with internal IDs allowed but secrets redacted.
- Provider job IDs only if they are not credentials.
- COGS, displayed credit charge, and gross margin calculation.
- Console/network summary.
- Cleanup performed.
- Final pass/fail decision per gate.

## Gate 1 - Otto LLM

Route: `/otto?view=canvas`

Steps:

1. Sign in as the test owner.
2. Capture credit balance and recent LLM ledger rows.
3. Send one short low-risk prompt to Otto.
4. Wait for a visible assistant response.
5. Refresh and confirm the conversation persists.
6. Capture balance and ledger after-state.

Pass criteria:

- Exactly one LLM spend path is recorded for the turn.
- Reserve and settle are paired, or a failed turn is refunded.
- The visible assistant response is not empty.
- No negative balance, duplicate debit, unhandled console error, or missing cost record.
- Gross margin is at least 45%; Otto target remains 2.0x or better where the configured pricing model applies.

## Gate 2 - Image Generation

Route: `/otto?view=canvas`

Steps:

1. Create or open the test project.
2. Capture balance, recent ledger rows, recent generation jobs, and admin cost before-state.
3. Open the image generation dialog.
4. Submit one small approved image job.
5. Wait for completion.
6. Open the resulting asset from the canvas or My Stuff.
7. Confirm the served file route loads.
8. Capture balance, ledger, job, generation, storage, and admin cost after-state.

Pass criteria:

- One job is submitted and reaches a terminal success state.
- One visible generation result is attached to the project and file route loads.
- Reserve and settle are paired once.
- COGS is present and margin is at least 45%.
- Failure, if any, refunds automatically and leaves a visible failed card.

## Gate 3 - Seedance Video

Route: `/otto?view=canvas`

Steps:

1. Capture balance, ledger, job, generation, and cost before-state.
2. Start one normal 5s 720p Seedance video generation using the approved prompt.
3. Wait for provider completion and stored output.
4. Open the generated video result.
5. Capture balance, ledger, job, generation, storage, and cost after-state.

Pass criteria:

- Job payload uses the intended public launch model and does not enable Fast 1080p.
- One 5s 720p output is stored and playable.
- Reserve and settle are paired once.
- COGS is present and margin is at least 45%.
- Provider failure refunds automatically.

## Gate 4 - Reference Video

Route: `/otto?view=stuff` or `/otto?view=canvas`

Steps:

1. Use an approved 2-6s reference input video owned by the test org.
2. Capture balance, ledger, reference generation jobs, generation records, and cost before-state.
3. Start one reference-video generation with fixed 5s output.
4. Wait for completion and stored output.
5. Open the generated result and confirm linkage to the source reference.
6. Capture balance, ledger, job, generation, storage, and cost after-state.

Pass criteria:

- Input duration gate enforces 2-6s.
- Output duration stays fixed at 5s.
- Payload uses `reference_video` semantics, not private virtual portrait or private asset library APIs.
- Displayed charge matches current product pricing.
- COGS is present and margin is at least 45%.
- Failure refunds automatically.

## Gate 5 - Stripe Checkout And Webhook

Route: `/billing`

Default mode: Stripe test mode. Live mode needs separate explicit approval.

Steps:

1. Capture credit balance, ledger, Stripe config mode, and recent checkout/webhook records.
2. Start one approved credit-pack checkout.
3. Complete checkout with a Stripe test card.
4. Wait for webhook processing.
5. Return to `/billing?status=success`.
6. Refresh account billing and admin money views.
7. Replay or re-deliver the same webhook once if Stripe tooling allows it safely in test mode.

Pass criteria:

- Checkout creates exactly one expected credit grant.
- Webhook is idempotent; replay does not double-grant.
- Balance and ledger match the purchased pack.
- Cancel path remains non-granting if tested.
- No supplier spend path is triggered by money-in.

## Gate 6 - Meta Or Google OAuth Connected State

Routes: `/otto?view=connections`, `/otto?view=analytics`, `/otto?view=account`

Steps:

1. Use only an approved test Meta or Google account.
2. Capture disconnected state screenshots.
3. Start OAuth from the product UI.
4. Complete provider consent for the test account.
5. Return to the app and confirm connected state.
6. Visit Analytics and Account surfaces that depend on the connection.
7. Test disconnect or reconnect only if included in approval.

Pass criteria:

- OAuth callback stores encrypted token state for the test org only.
- Connected UI state appears in Connections, Account, and Analytics.
- Disconnected UI can be restored if disconnect is approved.
- No external write, publish, pause, budget change, or customer account action occurs unless separately approved.
- Console and network show no unhandled callback errors.

## Gate 7 - Production Canary

Run only after PR #131 is merged by an authorized human after green current-head CI.

Steps:

1. Confirm production deploy completed and migrations finished.
2. Sign in with the approved production test account.
3. Visit `/login`, `/otto?view=canvas`, `/otto?view=stuff`, `/otto?view=memory`, `/otto?view=account`, `/billing`, `/otto?view=connections`, `/otto?view=analytics`, and `/admin` if the account is authorized.
4. Click the same no-spend controls proven in local QA.
5. Check browser console, failed network requests, app logs, and worker logs.
6. Do not run paid or external-write actions unless a matching approval line was collected.

Pass criteria:

- Core routes load for the production test account.
- No 5xx, migration error, auth loop, asset load failure, or client runtime exception appears.
- No accidental real spend or external write occurs.
- Admin is available only to authorized staff.
- If paid/external gates are also approved in production, their pass criteria above still apply.

## Cleanup

- Delete temporary test projects, threads, and uploaded/generated assets when product flows support deletion.
- Leave ledger rows intact; do not manually edit money history.
- Disconnect OAuth test accounts if approved and expected.
- Save all screenshots and report files before cleanup when cleanup changes visible state.
- Post a PR comment summarizing pass/fail and linking the tracked result file.
