# QA money/auth/permissions — 2026-07-04

Scope: AUTH / BILLING / CREDITS / MONEY SAFETY / PERMISSIONS.
Branch: `codex/qa-money-auth-permissions-20260704`.
Base audited: `origin/main` `3b45d47` (`fix(safety): 审计安全带 — 漂移闸/毛利地板/调研卡修复/守卫测试 (#132)`).

No real Stripe charge/refund, provider spend, or Meta write/publish was executed.

## Matrix

| Area | Failure/abuse case | Evidence | Result |
|---|---|---|---|
| Auth allowlist | Non-allowlisted email denied before session/user creation | `better-auth-gate.test.ts` | Pass |
| Auth email | Magic-link/dev email rate limited after 5 sends/hour/address | `better-auth-sender.test.ts` | Pass |
| Auth config | Email verification + local verified account-linking stay enabled | `better-auth-server.test.ts` | Pass |
| Redirects | Callback URL sanitization blocks external/unsafe targets | `safe-redirect.test.ts` | Pass |
| Billing list/checkout | Missing Stripe config returns no packs; bad/disabled price rejected; checkout errors are friendly | `billing-actions.test.ts` | Pass |
| Stripe webhook fixture | Bad signature 400; malformed metadata ignored 200; duplicate session idempotent; async success grants | `stripe-webhook.test.ts` | Pass |
| Admin credit grant | requireRole gate; direct-action cap 1,000 displayed credits; bad idempotency rejected | `credit-actions.test.ts` | Pass |
| Tenant admin credits | Founder org rejected; unknown/deleted org rejected; direct-action cap; negative underfunded adjustment fails | `tenant-actions.test.ts` | Pass |
| Impersonation spend | startGen/storyboard/regenerateVariant blocked before reserve/meter | `impersonation-spend-block.test.ts` | Pass |
| Impersonation account writes | Meta connect/disconnect and ad-write controls blocked while impersonating | Fixed in this branch; `meta-actions.test.ts`, `meta-write-actions.test.ts` | Pass |
| Pricing parity | Margin floor rejects non-flat video models; spend tests pin >=45% margin floor | `spend.test.ts`, `model-config.test.ts` | Pass |
| Permissions matrix | SECTION_MATRIX deny-by-default + role gates | `roles.test.ts`, `tenant-actions.test.ts` | Pass |
| Async await traps | `allowed` / `isAllowedEmail` / `isImpersonating` grep for missing await | Static grep | Pass |
| DB ledger concurrency | reserve/settle/refund/idempotent grant tests | Blocked locally: no `DATABASE_URL` | Not run |
| DB tenant guard | raw Prisma tenant guard coverage | Blocked locally: no `DATABASE_URL` | Not run |
| Stripe DB integration | delayed-payment grant once across unpaid completed/async success/replay | Blocked locally: no `DATABASE_URL` | Not run |

## Finding fixed

### P1 — Staff impersonation could mutate a customer's Meta connection/settings

Before this branch, `completeMetaConnect()` and `disconnectMeta()` used `requireOwner()` but did not block Better Auth impersonation sessions. A founder/staff member who was impersonating a tenant could complete a Meta OAuth callback into the tenant org or disconnect the tenant's Meta row. `setAdsWritesPaused()` also allowed changing the tenant ad-write kill switch while impersonating.

Fix:
- `apps/web/lib/meta-actions.ts`: block `completeMetaConnect()` and `disconnectMeta()` when `isImpersonating()` is true, before token exchange/delete.
- `apps/web/lib/meta-write-actions.ts`: block `setAdsWritesPaused()` while impersonating.
- Tests assert no token exchange, no upsert/delete, and no updateMany happen under impersonation.

## Commands run

Passed:
- `pnpm --filter @fikirtive/db generate`
- `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build && pnpm --filter @fikirtive/otto build`
- `pnpm --filter @fikirtive/storage build`
- `pnpm --dir apps/web exec vitest run lib/__tests__/meta-actions.test.ts lib/__tests__/meta-write-actions.test.ts lib/__tests__/impersonation-spend-block.test.ts` — 58 passed
- `pnpm --dir apps/web exec vitest run lib/__tests__/better-auth-gate.test.ts lib/__tests__/better-auth-server.test.ts lib/__tests__/better-auth-sender.test.ts lib/__tests__/safe-redirect.test.ts lib/__tests__/billing-actions.test.ts lib/__tests__/stripe-webhook.test.ts lib/__tests__/credit-actions.test.ts lib/__tests__/tenant-actions.test.ts` — 97 passed
- `pnpm --dir packages/core exec vitest run src/spend.test.ts src/llm-prices.test.ts src/roles.test.ts src/model-config.test.ts` — 52 passed

Blocked by local env:
- `pnpm --filter @fikirtive/db test -- credits.test.ts tenant-guard-coverage.test.ts` — requires a `*_test` `DATABASE_URL`; none is configured in this worktree.
- DB-backed Web integration tests (`require-owner`, `tenant-guard`, Stripe webhook integration) also require `DATABASE_URL`.

## Remaining risk

The remaining unverified surface is DB-backed concurrency and tenant-guard behavior in this worktree, because no local test database URL is configured. The relevant tests exist in repo and should run in CI or a configured test DB environment before merge.
