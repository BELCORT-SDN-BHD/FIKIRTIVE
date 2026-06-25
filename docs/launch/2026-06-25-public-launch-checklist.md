# FIKIRTIVE — Public Launch Checklist & Config Audit

> Date: 2026-06-25. Source: code scan of every `process.env.*` read + the storage/auth/spend paths.
> Status going in: the prod-readiness audit's 1 blocker + 5 highs are **closed** (PR #4). What remains is
> deploy configuration, a real-money canary, and test-coverage backfill.

---

## 0. The big rocks (read first)

1. **R2 is effectively required for any real (multi-service) deploy.** `web` and `worker` are separate
   containers. With `STORAGE_DRIVER` unset they each use **local disk** — the worker writes generated
   images to *its* disk, the web `/files` route reads from *web's* disk → images 404. Set `STORAGE_DRIVER=r2`
   + the 4 R2 creds on **both** services, pointing at the **same bucket**. Images are served through the
   app's `/files/[...key]` route (R2 → presigned redirect), which sits **behind the login wall** (private).
2. **The login wall is now fail-closed in prod** (PR #4): a deploy that forgets `AUTH_ENABLED` is walled, not
   open. So prod **must** have `RESEND_API_KEY` (magic-link sign-in must work behind the wall) — or you must
   explicitly set `AUTH_ENABLED=false` to run open.
3. **Real fal has never run here.** Everything to date is the `mock` provider ($0). A founder canary on real
   fal is the gate before any non-founder user (§3).
4. **Migrations run on web boot** now (`prisma migrate deploy` in the Dockerfile) — make sure the migrate
   target is the *direct* (non-pooler) `DATABASE_URL`.

---

## 1. Environment variables (by category)

Legend: **[req]** required for public prod · **[req-fal]** required once real generation is on ·
**[rec]** recommended · **[opt]** optional/has a safe default.

### Database
- `DATABASE_URL` **[req]** — direct (non-pooler) URL; used by `migrate deploy` on boot.
- `DATABASE_URL_POOLED` **[req]** — pooled (PgBouncer/Neon) URL; runtime uses this.
- `DB_POOL_MAX` **[opt]** — pg pool size per process (default 10). Tune so `replicas × max` < DB budget.

### Auth / the login wall
- `AUTH_SECRET` **[req]** — `openssl rand -base64 32`.
- `AUTH_URL` **[req]** — canonical origin (magic-link callbacks + cookies bind to it). Must match the real domain.
- `RESEND_API_KEY` **[req]** — production magic-link sender. **Without it, prod sign-in throws** (and the wall is on).
- `AUTH_EMAIL_FROM` **[req]** — a verified Resend sender (e.g. `Fikirtive <auth@yourdomain>`).
- `AUTH_ALLOWED_EMAILS` **[req]** — comma-separated allowlist (deny-by-default). Keep founder-only for the canary.
- `FOUNDER_ADMIN_EMAILS` **[req]** — founder/super-admins.
- `AUTH_ENABLED` **[rec]** — leave unset in prod (now defaults ON); set `false` only to deliberately run open.

### Otto (LLM)
- `ANTHROPIC_API_KEY` **[req]** — Otto's reasoning/tool-calling. The loop can't run without it.
- `ANTHROPIC_BASE_URL` **[opt]** — gateway/proxy base URL.
- `OTTO_LLM_MARGIN` **[opt]** — markup factor on Otto's metered LLM cost.

### Generation (SPEND)
- `GENERATION_PROVIDER` — `mock` (default, $0) → set `fal` for real images/video.
- `FAL_KEY` **[req-fal]** — required when `GENERATION_PROVIDER=fal` (worker throws loudly otherwise — safe).
- `COWORK_PROVIDER` — legacy cowork-planner transport: `mock` | `fal` (needs `FAL_KEY`) | `modal`.
- `MODAL_LLM_ENDPOINT` / `MODAL_LLM_KEY` **[req if COWORK_PROVIDER=modal]**.
- `COWORK_PAID_PROVIDERS_ALLOWED` / `COWORK_VISION_ENABLED` (+ `COWORK_VISION_MAX_IMAGES`, `COWORK_VISION_MAX_BYTES`) **[opt]**.

### Storage (see §0.1)
- `STORAGE_DRIVER=r2` **[req]** for multi-service prod (else local disk, which doesn't share across containers).
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` **[req with r2]** (all 4 or it throws).
- `R2_FORCE_PATH_STYLE` **[opt]** — default true; set `false` for vhost-style.
- `ARTLIO_DATA_DIR` **[opt]** — local-disk root (dev only). *(nit: env name still says ARTLIO.)*

### Worker-only (captions)
- `WHISPER_MODEL_PATH` — set in the worker Dockerfile. `WHISPER_THREADS` / `WHISPER_MAX_SECONDS` **[opt]**.

### Observability
- `SENTRY_DSN` **[rec]** — error capture in both web (`instrumentation.ts`) + worker. No-op if unset.

---

## 2. Services & deploy topology
- **web** (Next, `apps/web/Dockerfile`): runs `prisma migrate deploy` then serves. Needs DB + auth + Otto + storage + Sentry env.
- **worker** (pg-boss, `apps/worker/Dockerfile`, `node dist/index.js`): the generation consumer + the stale-job **reaper**. Needs DB + generation (`GENERATION_PROVIDER`/`FAL_KEY`) + storage (same R2) + Sentry + whisper.
- Both point at the **same DB** and the **same R2 bucket**. Migrations run once (from web boot).

---

## 3. Real-fal founder canary (gate #1 — founder runs this, real money)
1. Founder-only env: `AUTH_ALLOWED_EMAILS` = founder only; `GENERATION_PROVIDER=fal` + `FAL_KEY`; `STORAGE_DRIVER=r2` + creds; `SENTRY_DSN` on.
2. Run **one image ad-pack (count≥2)** and **one video**. Verify on the real provider:
   - charge debits at the real fal price and **`reserve == settle`** (watch `CreditLedger`);
   - the product is **viewable + downloadable** via `/files` (R2 presigned);
   - **exactly-once** (one `GenJob` per card; a reload doesn't double-charge);
   - **refund on failure** — force one failure (e.g. a bad prompt/model) and confirm the hold is released + a `TURN_ERROR` appears (no permanent spinner).
3. Let a job hang/kill the worker mid-gen → confirm the **reaper** fails it closed + refunds within ~5–23 min.

## 4. Pre-launch verification
- [ ] `pnpm -r typecheck` + the suites green (currently **643**: core 399 / otto 96 / worker 15 / web 133).
- [ ] `next build` clean.
- [ ] Re-run the prod-readiness audit; confirm blocker + 5 highs stay closed.
- [ ] Smoke on staging-with-r2: allowlisted sign-in → Otto loop → ad pack → download; confirm images load behind the wall.

## 5. Known gaps (track, not all blockers)
- **Test coverage** on the new read paths (`getMyAds`, `listMyMemory`) + the React surface is thin — add before scaling.
- **Workshop** is an intentional stub.
- Cosmetic: `ARTLIO_DATA_DIR` env name + a couple of "Artlio" strings in `.env.example` survived the rename.
