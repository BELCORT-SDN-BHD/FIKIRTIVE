# Otto 34-PR Integration & Ship Plan (2026-06-27)

Status: **approved** (founder, 2026-06-27). Execution surface: a single `integration`
branch off `main@fa60c86`. **`main` / production are not touched** until the founder
signs off on the integration branch.

## Goal

Land all 34 open Otto PRs (#11–#46, minus merged #12/#14) onto `integration`, with the
must-fix bugs corrected and merge conflicts resolved, gated by real-env typecheck + tests,
then hand to the founder for review via a draft PR `integration → main`.

## Context that shaped the plan

- The whole fleet branched off an **older `main`** (before #10 NextAuth-retire, #12/#14
  operator console). All are textually mergeable but were authored without that context.
  → Merge onto current `main`; audit new spend paths for the `isImpersonating()` guard #14 added.
- Every PR was pushed with `--no-verify`; real-env `pnpm -r typecheck` never ran. → Gate per batch.
- One 14-PR stack on **#11**; sub-stacks #13→#40, #15→#27, #19→#42, #31→#41, #35→#43/#45.
- **#22 vs #25** are competing Stripe top-ups (same files). Decision: ship **#22**, adopt
  #25's `stripe:${session.id}` idempotency key, **exclude #25** (it omits the `proxy.ts`
  auth-wall exclusion → its webhook would 302 in prod and never grant). #22 stays **inert**
  until the founder configures Stripe keys + dashboard products (money-IN only; grantCredits).

## Must-fix (applied on `integration`)

| PR | Severity | Fix |
|---|---|---|
| #30 | blocker | `apps/web/lib/dto.ts` GEN_RESULT mapper must forward `costCredits` (+ dto test). Feature is dead-on-arrival without it. |
| #45 | high | Add `isImpersonating()` early-return to `researchBrandFromUrl` (new paid-LLM entry point, authored pre-#14). |
| #45 | high | `url-safety.ts`: resolve DNS + re-check every resolved IP against private ranges before fetch (close SSRF DNS-rebinding → cloud-metadata exfil) + test. |
| #24 | medium | Raise `GEN_QUEUED_REAP_MS` to 25 min (> 20-min queue expiry) + fix comment; or scope to attempts===0. |
| #38 | medium | Clamp persisted pick index on read (bounds-check) so corrupt localStorage can't crash the result card. |
| #35 | medium | Handle `needs_approval` in brand-chat `sendChat` (steer to main Otto chat; don't strand a parked paid card). |
| #46 | medium | Add `cancelGenJob` refund/race test (QUEUED→refund once; GENERATING/DONE→no-op; cross-tenant→no-op; double-call→no-op). |
| nits | — | #11 legacy-card credit fallback by `count`; stale comments. Opportunistic. |

Money invariants are otherwise intact across the batch (RESERVE==SETTLE preserved; refunds
at-most-once via the finalizer unique index; money-in is grantCredits-only).

## Merge order (onto `integration`)

1. **Batch 1 — infra (isolated):** #37 (GenJob index migration) → #24 (+timing fix) → #23 (cleanup script).
2. **Batch 2 — Stripe:** #22 (change idempotency key to `stripe:${session.id}`). #25 excluded.
3. **Batch 3 — lib/data:** #18 → #20 → #15 → #19 (serialize `data.ts`/`dto.ts` writers).
4. **Batch 4 — otto-core:** #13 → #16 → #28 (Skill Framework last; re-wire tools inside its new structure).
5. **Batch 5 — anchor:** #11.
6. **Batch 6 — #11 children (serialized by hot files):** #17, #26, #29, #31, #32, #34, #33, #36, #38, #39, #44, #46, #30, #35.
7. **Batch 7 — leaves:** #40, #27, #42, #41, #43, #45.

Hottest conflict files: `OttoChatStream.tsx` (9 PRs), `OttoApp.tsx` (7), `OttoPlanCard/Conversation/Stuff/Result`,
plus cross-pair conflicts `data.ts`/`dto.ts` (#18/#20/#27) and `instructions.ts`/`otto.ts` (#13/#16/#26/#28/#40).
Trickiest: **#28** moves `propose`/`generate` tools into `skills/`, conflicting semantically with #11/#16/#26.

## Per-batch gate

`pnpm install && pnpm --filter @fikirtive/db exec prisma generate && pnpm -r typecheck && pnpm -r test`
— fix breakage in place. Run `money-safety-review` on #22/#24/#30/#34/#45/#46.

## Deliverable & sign-off

Push `integration`; open draft PR `integration → main` summarizing what landed, every conflict
resolution, and gate results. Founder reviews (and/or `/qa`). On sign-off: merge `integration → main`
(auto-deploys prod; founder-canary preserved). **Real-fal canary (spends real money) is asked
separately** per the ask-before-spend rule.

## Out of scope (this round)

- PRs opened after this snapshot → follow-up pass.
- Stripe dashboard/keys setup (founder; code inert until then).
- Convert #37 index to `CREATE INDEX CONCURRENTLY` before customer volume (noted; safe at canary scale).
