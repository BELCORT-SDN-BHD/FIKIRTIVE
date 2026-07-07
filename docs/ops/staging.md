# Staging Environment (Railway) — Ops Guide

> For any future agent handling staging. Set up 2026-07-06. **No secrets in this file** —
> all keys live on Railway; DB/login passwords are held by the founder.

## TL;DR
- **URL:** https://web-staging-7901.up.railway.app
- **Railway:** project `FIKIRTIVE` (`b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`), environment **`staging`** (separate from `production`).
- **Services:** `web` + `worker` (deploy feature branches via `railway up`), `Postgres` (staging-only DB).
- **Isolation:** staging has its **own** Railway Postgres; prod's Neon DB (`neondb`) is **never** referenced by staging.
- **Login:** email/password (Google NOT required). Founder account `tools@belcort.com` (founder-admin; email pre-verified directly in the staging DB).
- **Generation provider:** `byteplus` → **REAL money** on every image/video. **Storage:** `r2` (same bucket as prod).

## How it was built (and how it's isolated)
- Created via `railway environment new staging --duplicate production` → copies prod's service config + **all** secrets (secrets stay on Railway; the agent never sees values).
- Staging DB = a dedicated Railway `Postgres` service, provisioned **only** in staging. Staging `web`+`worker` have `DATABASE_URL` and `DATABASE_URL_POOLED` = `${{Postgres.DATABASE_URL}}` (resolves to `postgres.railway.internal`). Prod's `DATABASE_URL` (Neon) is untouched.
- Domain/login vars overridden for staging: `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, `AUTH_URL` = the staging URL above.

## ⚠️ Known gotcha / incident (2026-07-06) — READ THIS
`railway environment new --duplicate` **auto-deploys the copied services immediately**, using the **copied prod `DATABASE_URL` (Neon)**. During setup this caused a throwaway staging deploy to run `prisma migrate deploy` against the **PROD Neon DB**.
- **Impact: none** — the branch added zero new migrations, so it was a no-op (prod schema/data unchanged). Verified via `git diff main..HEAD -- packages/db/prisma/migrations` (empty).
- **Correct procedure** (avoids the window entirely):
  1. `railway environment new staging --duplicate production`.
  2. **Immediately** provision/point the staging DB and override `DATABASE_URL` + `DATABASE_URL_POOLED` on staging `web`+`worker` — **without** `--skip-deploys`, so it redeploys and evicts any auto-deploy still on the prod DB.
  3. Only then continue.
- **Lesson:** after duplicating, assume services auto-deploy on the copied (prod) DB URL. Isolate the DB before anything else.

## Guardrails for future agents (non-negotiable)
- **Before every `railway up` / migration / var change:** run `railway status` and confirm `Environment: staging`. **Never** operate on `production`.
- **Never** `railway up` while linked to `production` (that deploys to prod).
- **Never** run migrations against prod. Staging migrations target the staging Postgres only.
- Staging generations spend **real money** (`byteplus`); staging writes assets to the **same R2 bucket as prod** (content-addressed, low-impact, but be aware).

## Deploy a branch to staging
```bash
PROJ=b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d
railway link -p $PROJ -e staging -s web
railway status | grep -i Environment        # MUST print: Environment: staging
railway up --ci --detach                     # deploy current dir to staging web
railway link -p $PROJ -e staging -s worker && railway up --ci --detach   # worker
```

## Run migrations on the staging DB (from local)
```bash
# get the public proxy URL (has a password — do not commit):
railway variables -e staging -s Postgres --kv | grep DATABASE_PUBLIC_URL
DATABASE_URL='<that url>' pnpm --filter @fikirtive/db exec prisma migrate deploy
```

## Create / fix a login on staging (no mailbox exists)
better-auth mounts at **`/api/better-auth`**; email/password enabled with `requireEmailVerification: true`.
The email must be in `AUTH_ALLOWED_EMAILS` / `FOUNDER_ADMIN_EMAILS` (founder-admin ⇒ owner via `isFounderAdmin`).
```bash
# 1. sign up
curl -X POST "https://web-staging-7901.up.railway.app/api/better-auth/sign-up/email" \
  -H "Content-Type: application/json" -d '{"email":"<email>","password":"<pw>","name":"<name>"}'
# 2. mark verified in the staging DB (BetterAuthUser → table ba_user)
psql "<staging DB url>" -c "UPDATE ba_user SET \"emailVerified\"=true WHERE email='<email>';"
# 3. sign-in now works: POST /api/better-auth/sign-in/email
```

## Watching / debugging staging
```bash
railway logs -e staging -s web       # or -s worker
railway variables -e staging -s web --kv | grep <KEY>
```
