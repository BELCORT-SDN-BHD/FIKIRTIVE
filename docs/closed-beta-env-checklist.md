# Closed-Beta Env Checklist (pre-invite)

Set in Railway BEFORE inviting any external user / before the first paid endpoint:

- `AUTH_ENABLED=true`        — turns the perimeter wall ON (`apps/web/proxy.ts`). Off today.
- `RESEND_API_KEY=...`       — required so magic-link email actually sends (prod throws without it).
- `AUTH_ALLOWED_EMAILS=...`  — comma-separated invite allowlist (deny-by-default).
- `FOUNDER_ADMIN_EMAILS=...` — your founder email(s); seeded to super-admin on sign-in.
- `AUTH_EMAIL_FROM="Artlio <you@yourdomain>"` — verified Resend sender.
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
