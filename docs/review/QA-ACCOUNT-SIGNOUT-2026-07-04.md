# QA Account Sign-Out - 2026-07-04

## Scope

Follow up on the production smoke note where Account `Sign out` cleared the session but did not visibly navigate to `/login` until a later protected-route load.

This is code-level regression coverage only. It does not prove the deployed production UI behavior until PR #131 is merged and deployed.

## Coverage Added

- `apps/web/lib/__tests__/account-actions.test.ts`
  - Stubs Better Auth `auth.api.signOut()`.
  - Stubs Next `headers()` with a session-cookie-bearing header object.
  - Stubs Next `redirect()` and verifies the action redirects to `/login`.
  - Verifies `signOut` is called before `redirect`.

## Verification

Passed:

```bash
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/account-actions.test.ts
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/account-actions.test.ts lib/__tests__/better-auth-server.test.ts lib/__tests__/better-auth-client.test.ts
pnpm --filter @fikirtive/web typecheck
git diff --check
```

Expected local limitation:

```bash
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/account-actions.test.ts lib/__tests__/better-auth-oauth-session-gate.test.ts lib/__tests__/better-auth-server.test.ts lib/__tests__/better-auth-client.test.ts
```

The non-DB tests passed, but `better-auth-oauth-session-gate.test.ts` requires `DATABASE_URL` and failed in this shell before running its integration assertions. GitHub CI supplies Postgres and `DATABASE_URL=postgres://postgres:postgres@localhost:5432/artlio_test`.

## Result

The server action now has a regression test for the intended behavior: call Better Auth sign-out with request headers, then redirect to `/login`.

The production sign-out observation remains a post-deploy canary item because the current production build is not PR #131.
