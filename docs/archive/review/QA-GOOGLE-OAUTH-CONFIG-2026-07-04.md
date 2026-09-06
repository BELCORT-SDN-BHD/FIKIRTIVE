# QA Google OAuth Config - 2026-07-04

## Scope

Follow up on the production Google OAuth gate.

Production smoke now reaches Google's sign-in page and no longer shows `redirect_uri_mismatch`, but full consent/callback still needs a controlled Google account. This local test pins the app-owned Better Auth configuration that determines the Google `redirect_uri`.

## Coverage Added

- `apps/web/lib/__tests__/better-auth-server.test.ts`
  - Constructs the real Better Auth server instance with test auth env.
  - Reads `auth.$context.baseURL`.
  - Finds the configured Google social provider.
  - Calls the provider's pure `createAuthorizationURL()` with the callback URI that Better Auth's `/sign-in/social` route uses.
  - Verifies the generated Google URL points at `https://accounts.google.com`.
  - Verifies `client_id=test-client-id`.
  - Verifies `redirect_uri=http://localhost:3100/api/better-auth/callback/google`.

## Verification

Passed:

```bash
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-server.test.ts
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-server.test.ts lib/__tests__/better-auth-client.test.ts lib/__tests__/better-auth-route.test.ts lib/__tests__/better-auth-gate.test.ts
pnpm --filter @fikirtive/web typecheck
git diff --check
```

## Result

The local Better Auth server config now has a regression test for the callback route shape that production Google OAuth depends on: `{BETTER_AUTH_URL}/api/better-auth/callback/google`.

This does not complete Google consent, callback session issuance, or account-linking with a real Google account. Those remain external smoke gates.
