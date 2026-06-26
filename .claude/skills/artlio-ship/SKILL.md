---
name: artlio-ship
description: Artlio deploy ritual — proportional-rigor review, verify, migration check, then commit + push to main on explicit request. (Artlio-specific; distinct from the generic gstack /ship.)
disable-model-invocation: true
---

Get a change onto Railway prod safely. Push to `main` auto-deploys both the web and worker services on GitHub push; **only committed code deploys**. The cost of a wrong push is tiered, so the review effort is tiered with it — that is the whole discipline.

Run the steps in order. Do not commit or push until the user explicitly asks (step 6).

## 1. Branch — already on `main`

Work on `main` directly. NEVER create a feature branch or worktree. Confirm: `git branch --show-current` prints `main`. If it doesn't, stop and ask — do not branch.

## 2. Classify the diff (proportional rigor)

Run `git status` + `git diff` and place the change in exactly one tier. The tier sets every later step's depth.

- **Spend path** — touches any of the 4 paid code-paths or the spend gate itself: `genRequest` / `idempotencyKey` (`packages/core/src/gen.ts`), `coworkGenerate`→`startGen`, direct `startGen`, `startRefGen`, `dispatchVariantJob`/`createVariant`/`regenerateVariant`, or the fal provider call in `apps/worker/src/jobs/gen.ts`. → **MAX rigor: invoke the adversarial money-safety gate** (`/money-safety-review`, or run the Codex money-safety review the user uses). Do not proceed past a finding.
- **Data-loss / security / multi-user** — DB writes, auth/RBAC, tenancy, anything that could corrupt or leak another user's data. → Rigor **proportional to blast radius**: targeted review of the failure modes; reach for `/codex` when the radius is wide.
- **Pure UI / cosmetic / docs / non-spend** → **Light review, ship fast.** No money-safety theater — these cannot reach the 4 spend paths.

Completion criterion: the diff is in one tier and that tier's review has run with no open findings.

## 3. Verify — only what changed

Run the checks for the packages your diff touched, proportional to the change. Each must pass (exit 0):

- `packages/core` changed → `pnpm --filter @artlio/core test` (the spend gate's tests live here — always run on a spend-path change) **and** `pnpm --filter @artlio/core typecheck`
- `apps/web` changed → `pnpm --filter @artlio/web typecheck` **and** `pnpm --filter @artlio/web build` (web is a heavily-customized Next build; typecheck alone is not enough)
- `apps/worker` changed → `pnpm --filter @artlio/worker test` **and** `pnpm --filter @artlio/worker build`
- `packages/db` changed → `pnpm --filter @artlio/db typecheck`

A spend-path change runs core tests no matter which file moved. Completion criterion: every check for a touched package has run and passed.

## 4. Migration check — additive only

If the diff adds a dir under `packages/db/prisma/migrations/`, open its `migration.sql` and confirm it is **purely additive**: `CREATE TABLE`, `ADD COLUMN`, new index. NO `DROP`, no `ALTER ... DROP`, no destructive type change, no `NOT NULL` on an existing populated column without a default.

This migration auto-runs **pre-deploy** on Railway via the web service Pre-deploy Command (`pnpm --filter @artlio/db exec prisma migrate deploy`) — a destructive one breaks prod on the next push before the new code is even live. Completion criterion: every new migration SQL read and confirmed additive. No new migration → skip.

## 5. Stage surgically — leave local tooling out

Stage only the files that trace to the request. Do NOT commit local-only tooling: `.claude/`, `.mcp.json`, `*ignore`-file tweaks (`.gitignore`/`.dockerignore`/`.railwayignore`). These stay uncommitted on purpose.

## 6. Commit + push — ONLY when the user asks

Gate: do not run this step until the user explicitly says to commit/push/ship. Then:

- `git add` the surgical fileset, `git commit` (message ends with the required `Co-Authored-By` trailer), `git push origin main`.
- Push = auto-deploy web + worker on Railway. Fallback if GitHub auto-deploy is wedged: `railway up` (manual).

Completion criterion: push succeeded and Railway shows a deploy started.

## 7. Smoke-check prod

After the deploy goes green, hit prod and confirm the shipped change behaves. For a spend-path change, confirm one real generation still charges exactly once (the idempotency invariant). Completion criterion: the change is observed working on prod, no error spike.
