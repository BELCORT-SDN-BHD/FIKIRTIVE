# QA Meta OAuth Route - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Commit: `17a10f2`

## Purpose

Close one autonomous part of the real Meta OAuth launch gate: the app-owned authorize and callback route boundaries.

This does not call Meta or complete a real consent flow. It proves that FIKIRTIVE's route layer gates auth, builds the correct OAuth URL, verifies signed state against the current owner, calls the connection finalizer with the exact callback URI, and redirects users back to Connections with explicit status.

## Boundary

- No real Meta API call was made.
- No real OAuth consent screen was opened.
- `completeMetaConnect()` was mocked so the route boundary could be tested without token exchange.
- The real `signState()`, `verifyState()`, and `buildAuthorizeUrl()` behavior remained in use.

## Covered

`GET /api/meta/authorize`:

- Unauthenticated request redirects to `/login`.
- Missing `META_APP_ID` redirects to `/otto?view=connections&error=not_configured`.
- Configured request redirects to `https://www.facebook.com/v21.0/dialog/oauth`.
- The authorize URL includes:
  - production callback path `/api/meta/callback`
  - `ads_management`
  - `pages_show_list`
  - signed state that verifies to the resolved owner id

`GET /api/meta/callback`:

- Unauthenticated request redirects to `/login` before invoking connection completion.
- Missing `code` or `state` redirects to `/otto?view=connections&error=missing`.
- Valid signed state for a different owner redirects to `/otto?view=connections&error=state`.
- Valid callback calls `completeMetaConnect(code, "https://app.test/api/meta/callback")`.
- Successful completion redirects to `/otto?view=connections&connected=meta`.
- Completion errors are returned to Connections as `error=<code>`.

## Verification

Command:

```bash
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/meta-oauth-route.test.ts lib/__tests__/meta-oauth.test.ts lib/__tests__/meta-actions.test.ts
```

Result:

- 3 test files passed.
- 31 tests passed.

Additional check:

```bash
pnpm --filter @fikirtive/web typecheck
```

Result: pass.

## Remaining Meta Gate

This does not prove a real Meta consent screen, real token exchange, real token persistence from Meta, App Review scope grants, reconnect after expiry with live Meta, or real write/publish behavior. Those remain in `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md` Gate 6.
