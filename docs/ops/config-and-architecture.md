# Fikirtive — Config & Architecture Reference

> ⚠️ **已过时快照(TOMBSTONE 2026-07-07)。** 本文验证于 2026-06-22,多处与现实不符
> (npm scope 已改名 `@fikirtive/*`、Better Auth 已上线、BytePlus 已是
> 生产生成供应商)。**不要据此判断现状。** 现行地图 = 仓库根 `AGENTS.md` +
> `docs/review/CODEBASE-MAP-2026-07-02.md`。保留仅供历史考古。

The single source of truth for **how this system is wired**: every config switch, the deploy
flow, the money-safety model, and the naming legend. Read this first if you're a new
engineer or an AI agent. Verified against `main` on 2026-06-22.

See also: [`docs/architecture/codebase-audit-2026-06-22.md`](../architecture/codebase-audit-2026-06-22.md) (the audit that produced this).

---

## 1. System at a glance

- **Monorepo (pnpm):** `packages/{core,db,generation,storage}` + `apps/{web,worker}`.
  - dep graph: `web → {core, db}` · `worker → {core, db, generation, storage}`.
- **Infra:** Railway (hosts `web` = Next.js 16, and `worker` = pg-boss) · Neon Postgres · Cloudflare R2 (asset storage) · Resend (magic-link email) · Cloudflare DNS.
- **Prod URL:** `https://fikirtive.com` (Cloudflare → Railway) and `https://web-production-b13a4.up.railway.app` (Railway service domain).
- **Naming legend** (so the codebase reads consistently):
  | You see | It means |
  |---|---|
  | **Fikirtive** | the product (pre-pivot name retired 2026-07-07; only the prod R2 bucket still carries it — migration: `docs/MASTERPLAN.md` P0) |
  | **Otto** | the agent (the user-facing name) |
  | `cowork-*` | Otto's code symbols/files (internal name; predates the Otto rename) |
  | **Org = Tenant** | one customer workspace; UI says "Tenant", code/DB say `Organization`/`orgId` |
  | **Brandmark** | a brand entity (`EntityType.BRANDMARK`, was `BRAND`) |
  | `@fikirtive/*` | internal package scope — renamed from the legacy pre-pivot scope (see §5) |

---

## 2. Environment variables (grouped, with security + spend boundary)

Legend: **SPEND** = touches money · **P0/P1/P2** = closed-beta phase it matters · code ref in `()`.

### Auth
- `AUTH_ENABLED=true` — the privacy wall. When `true`, every route except `/login` + `/api/auth/*` requires login (`apps/web/proxy.ts`). Opt-in by design (founder waived it until the first paid endpoint). **Must be `true` in prod.**
- `AUTH_ALLOWED_EMAILS` — comma list; the outer allowlist (only these emails can sign in). Unioned with the DB `AllowedEmail` table (`apps/web/lib/allowlist.ts`).
- `FOUNDER_ADMIN_EMAILS` — founder email(s); seeded to `super-admin` on sign-in (`apps/web/auth.ts`). **Also gates `/admin`** (founder-only, `apps/web/app/admin/layout.tsx`). A super-admin must be in BOTH this and the allowlist. *(audit rec: rename → `SUPER_ADMIN_EMAILS` for clarity.)*
- `AUTH_URL` — canonical base URL for magic links. **= `https://fikirtive.com`** in prod (if it points elsewhere, login redirects off-domain).
- `AUTH_EMAIL_FROM` — magic-link sender, e.g. `Fikirtive <auth@send.belcort.com>` (the `send.belcort.com` domain is Resend-verified).
- `RESEND_API_KEY` — Resend sender key. **(Rotate — was exposed in a session log 2026-06-22.)** Without it, dev drops the magic link to `.data/last-magic-link.txt` instead of emailing.

### Database
- `DATABASE_URL_POOLED` — **runtime** connection (Neon PgBouncer pooler); used by web+worker.
- `DATABASE_URL` — **direct** connection; used by Prisma migrations. (`packages/db/src/index.ts:20` prefers POOLED, falls back to direct.) *Naming looks inverted — document, don't rename (Railway/Neon convention).*
- `DB_POOL_MAX` — max connections per process (default 10). Tune so `replicas × max ≤ Neon pooler limit`.

### Generation (SPEND — image/video models)
- `GENERATION_PROVIDER=fal|mock` — `fal` → real FalProvider (needs `FAL_KEY`, throws without it); anything else → MockProvider (`packages/generation/src/index.ts:360`). **NOT dead code.**
- `FAL_KEY` — fal.ai key (real image/video generation + the Otto planner when `COWORK_PROVIDER=fal`).

### Otto planner (SPEND — LLM calls, NOT covered by the credits ledger)
- `COWORK_PROVIDER=mock|fal|modal` — which planner backend. `mock` = canned offline replies; `fal` = real Claude (via fal); `modal` = self-hosted (super-admin only). DB `runtimeConfig.cowork_provider` overrides this; unknown value → mock (safe).
- `COWORK_PAID_PROVIDERS_ALLOWED=true` — **⚠️ TECH DEBT (see §5).** A redundant second lock that forces mock unless `true`. Currently `true` in prod (so Otto is real). Slated for removal — `COWORK_PROVIDER` + the credential check already gate this.
- `MODAL_LLM_ENDPOINT` / `MODAL_LLM_KEY` — for `COWORK_PROVIDER=modal`.

### Vision (Otto Phase C — planner sees reference images)
- `COWORK_VISION_ENABLED` — hard kill-switch. The caps (`COWORK_VISION_MAX_IMAGES`, `COWORK_VISION_MAX_BYTES`) also exist as env but the DB `runtimeConfig.vision` row is the live control (admin Settings writes it). *(audit rec: keep the kill-switch in env, caps in DB only.)*

### Storage
- `STORAGE_DRIVER=r2` + `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` (+ optional `R2_FORCE_PATH_STYLE`). Anything other than `r2` → local disk at `FIKIRTIVE_DATA_DIR` (default `.data/storage`). (`packages/storage/src/index.ts`)

### Worker / caption
- `WHISPER_MODEL_PATH` / `WHISPER_THREADS` / `WHISPER_MAX_SECONDS` — whisper.cpp captioning bounds (`apps/worker/src/jobs/caption.ts`).

### Monitoring
- `SENTRY_DSN` (optional) · `BETA_INITIAL_GRANT_CREDITS` (credits granted on first sign-in, = 1000).

---

## 3. Money-safety model (the spend map)

- **Only these paths spend:** `coworkGenerate` / `startGen` / `startRefGen` / variant generation. Everything else (incl. **every Otto chat turn**) is **$0**.
- **Otto turn = $0 by design.** `coworkTurn` is PROPOSE-ONLY (`apps/web/lib/cowork-actions.ts`); the card's price is display-only; money is spent only when the user clicks **Generate** → `coworkGenerate` → `startGen`.
- **Two independent cost caps:**
  1. **GEN spend** (image/video) — capped by the **credits ledger** (`packages/db/src/credits.ts`): `reserve` (conditional decrement, never negative) → `settle`/`refund`, idempotency-keyed.
  2. **Otto planner LLM spend** — **NOT covered by the credits ledger** (founder absorbs it; uncapped). This is the original reason the `COWORK_PAID_PROVIDERS_ALLOWED` lock existed.
- **Authority vs record:** `pricedGenCredits` = the charge (authority). `spentUsd` columns = record-only (worker writes them; never read as truth). `estimatedPriceUsd` on a card = display only.
- **`genRequest`** typed gate (zod superRefine) is the spend authority; `checkCast`/the Guardian (`cowork-guardian.ts`) is **fail-OPEN advisory** — never trust it as the gate.
- **Spend gate is highest-rigor**: any change here gets the `money-safety-review` skill + Codex.

---

## 4. Deploy & approval flow (Railway)

**`git push` does NOT auto-deploy.** A push builds a deployment that lands in Railway status **`NEEDS_APPROVAL`** — the old version keeps serving until someone clicks **Approve** in the Railway dashboard. The CLI has **no approve command** (`railway deployment` = only `list`/`up`/`redeploy`).

- **To ship:** Railway → `web` service → Deployments → approve the `NEEDS_APPROVAL` row → then approve `worker`. **Approve `web` first** (its pre-deploy runs `prisma migrate deploy`), then `worker`, to minimize the migrated-DB / old-worker-code window.
- **Approving deploys the whole batch:** approving builds from the latest commit, so all commits up to it go live together (natural batching — no feature branches needed).
- **Env-var changes AUTO-deploy** (no approval) and build from latest `main` — so changing any var also ships pending commits.
- **Migrations:** must stay additive (the web pre-deploy auto-runs `migrate deploy`). Verify status with `railway deployment list --service web`.
- **Rollback:** `railway down` removes the most recent deployment.
- **Branching:** single `main` branch; work directly on it. The approval gate is the safety net + batch control.
- **Verify a deploy actually went live** before claiming "deployed": check branding/`railway deployment list` status = `SUCCESS`, not just that the push succeeded.

---

## 5. Known tech debt (with fix plan)

| Item | Where | Plan |
|---|---|---|
| **R1 — `COWORK_PAID_PROVIDERS_ALLOWED` redundant double-lock** | `packages/core/src/runtime-config.ts` `effectiveCoworkProvider`; `apps/web/lib/runtime-config.ts` `getTransport` | Remove the boolean; `COWORK_PROVIDER` + the credential-throw already gate it. **Deferred to the Otto→EVE migration** (EVE replaces the transport layer — don't churn it twice). |
| **Otto → Vercel EVE migration** | the whole `cowork-*` planner/transport pipeline | Planned next session — replace the hand-rolled planner with [EVE](https://eve.dev). Defer all Otto-internal cleanup until then. |
| `cowork-*` symbols vs user-facing "Otto" | `packages/core/src/cowork*.ts`, `apps/web/lib/cowork-*.ts` | Decided convention: **external = Otto, internal = cowork**. Don't rename piecemeal (EVE may replace it). |
| ~~legacy package scope + `FikirtiveEdit`/`FikirtiveClip` type rename~~ | pkg names + `apps/web/components/Editor*.tsx` | **DONE** — scope and types renamed; the last in-code legacy strings (test fixtures, comments, local DB/CI names) purged 2026-07-07. |
| `VARIANT` refgen mode | `packages/core/src/refgen.ts` (in contract, rejected at `refgen-actions.ts`) | Phase A fail-closed (no spend leak). Finish Phase B worker path or remove from contract. |
| `BRAND`→`BRANDMARK` read-normalizer | `apps/web/components/MentionInput.tsx` | Correct as-is (legacy data). Remove after a cutoff date. |

**Already fixed (2026-06-22):** `/admin` founder-only gate (was merchant-readable); tenants "invited" list de-dupe; `dto.ts` GEN_RESULT `kind` now observable instead of silently coercing.

---

## 6. Provider selection — the three-tier pattern (applies to planner + vision)

`env (SCREAMING_CASE) → DB runtimeConfig key (snake_case) → resolved const (camelCase)`.
**DB overrides env; an unknown/unset value falls back to the safe default (mock / disabled).**
Same shape for `COWORK_PROVIDER`/`cowork_provider` and the vision config.

---

## 7. Docs still to write (handoff set)

- `docs/architecture/money-safety-model.md` — expand §3.
- `docs/architecture/tenancy-model.md` — Org→Brand→Project, `ownerId` on ~20 tables, `requireOwner`, `/files` cross-tenant guard, admin = platform-wide.
- `docs/architecture/worker-pipeline.md` — pg-boss job types (Gen/RefGen/Render/Caption), lifecycle.
- `docs/architecture/otto-pipeline.md` — **after the EVE decision** (the pipeline may change).
- `docs/AGENT_QUICKSTART.md` — "read these in order" + task→code map for AI agents.
