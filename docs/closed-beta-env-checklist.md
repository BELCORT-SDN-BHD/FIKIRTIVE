# Closed-Beta Env Checklist (pre-invite)

Set in Railway BEFORE inviting any external user / before the first paid endpoint:

- `AUTH_ENABLED=true`        — turns the perimeter wall ON (`apps/web/proxy.ts`). Off today.
- `RESEND_API_KEY=...`       — required so magic-link email actually sends (prod throws without it).
- `AUTH_ALLOWED_EMAILS=...`  — comma-separated invite allowlist (deny-by-default).
- `FOUNDER_ADMIN_EMAILS=...` — your founder email(s); seeded to super-admin on sign-in.
- `AUTH_EMAIL_FROM="Fikirtive <you@yourdomain>"` — verified Resend sender.
- `SENTRY_DSN=...`           — error monitoring (optional but recommended for beta; no-op if unset).
- COWORK planner stays $0: do NOT set `COWORK_PAID_PROVIDERS_ALLOWED=true`; ensure the DB
  `runtimeConfig.cowork_provider` row is unset or `mock`. (Money-safety: the paid planner is
  locked by default — closed-beta P0, `effectiveCoworkProvider`.)
- `GENERATION_PROVIDER=fal` + `FAL_KEY=...` for real generation; `STORAGE_DRIVER=r2` + R2 creds.

Smoke after flipping `AUTH_ENABLED` on (staging or a fresh prod session):
1. Visit `/studio` while logged out → must 302 to `/login`.
2. While logged in, request `/files/u/<otherOwner>/<hash>.png` (an owner that isn't yours) → 404
   (the P0 cross-tenant guard, `keyOwnerMatches`); your own `u/founder/<hash>` still serves.
3. Request a magic link with an allowlisted email → email arrives; non-allowlisted → denied.

## Invite a beta merchant (e.g. the first design-partner)

1. **Allowlist the email** — `inviteTenant(<merchant-email>)` (`apps/web/lib/tenant-actions.ts:40`, super-admin only;
   writes a DB `AllowedEmail` row, LOWERCASED, revocable via `revokeTenantInvite`). The DB allowlist is the
   union with `AUTH_ALLOWED_EMAILS` env, so either works; prefer `inviteTenant` so it's revocable per-merchant.
2. **She signs in** with that email → `requireOwner()` auto-bootstraps her own org (`org_<userId>`) +
   grants **1000 displayed beta credits** (`BETA_INITIAL_GRANT_CREDITS`, `auth-guard.ts:87` / `spend.ts:93`).
   Her data is isolated from the founder org (owner-scoped).
3. **Point her at `/m`** — the Simple Mode surface: chat with Otto, upload a product photo, "make a video",
   get a cheap-model clip, then tap **I posted this / Didn't post** to log the performance signal.
4. **Watch the loop** — outcomes land as `ActionEvent(type='generation.outcome')`; read via `getRecentOutcomes()`
   (`apps/web/lib/data.ts`). This is the moat-from-day-1 capture (see `docs/superpowers/plans/2026-06-22-chingxuan-wedge.md`).
