# Fikirtive

A SEA-native **marketing & customer-data OS** for SMB / DTC teams. The wedge: turn an
idea into a batch of on-brand ad images and short videos in the same day — driven mainly
through **Otto**, an AI marketing operator you talk to in plain language.

Otto proposes what to create, you approve the spend with one click, and a background worker
generates it. Media generation and real Otto LLM turns are metered against a per-org **credit
ledger**, so those implemented paid paths are capped and auditable. Any other paid outbound API
still requires its own verified metering and approval contract; this README does not imply one.

> Naming note: the product/brand is **Fikirtive**; the npm scope is `@fikirtive/*`
> (root package `fikirtive`). Local DB and CI test DB are `fikirtive` / `fikirtive_test`
> (renamed 2026-07-07). Last-observed historical evidence recorded a pre-pivot R2 bucket name;
> the live bucket is `Unknown` until queried. Changing it is a separate, explicitly approved
> data-migration operation; this README does not schedule or authorize it.

## Architecture

pnpm + TypeScript monorepo. Two long-lived services (web + worker) over one Postgres.

```
apps/web          Next.js 16 (App Router) — UI, server actions, auth gate, the Otto chat
apps/worker       pg-boss consumer — generation jobs (BytePlus/fal/mock), ffmpeg video
                  editing, and Otto's post-generation "verdict" auto-resume
packages/otto     Otto — an OpenAI Agents SDK agent with a generated skill catalog spanning generation
                  proposals (propose / proposePack / proposeStoryboard / generate),
                  brand memory, Meta ads (insights / expert / ad builds / actions),
                  web research, product ingestion and post scheduling (the full list
                  is packages/otto/src/skills/CATALOG.md), reserve→settle LLM metering,
                  RunState persisted to Postgres (imported by BOTH web and worker)
packages/core     shared logic — the genRequest spend gate, pricing/credit units,
                  model registry, cowork/otto helpers, timeline + NLE editor ops
packages/db       Prisma 7 schema + client — the credit ledger is the single balance writer
packages/generation  image/video providers — byteplus (Seedream image, Seedance video),
                  fal, and mock ($0 for local dev); picked by
                  GENERATION_PROVIDER (factory in src/index.ts)
packages/storage  Cloudflare R2 object storage
```

### How a generation flows (and how money is gated)

1. You chat with **Otto** (`apps/web` → `ottoTurn`). Otto replies and calls the `propose`
   tool, which persists a **display-only** generation card ($0 — no spend yet).
2. To create it, Otto calls the `generate` tool (`needsApproval`) or you click **Generate**
   on the card. Either path goes through the unchanged `startGen` and is **exactly-once**
   via a per-card idempotency key — a card generates at most once.
3. `startGen` validates the request (`genRequest` zod gate), **reserves** credits atomically
   (never-negative), inserts the job, and enqueues it. The `apps/worker` consumer calls the
   selected generation provider, stores the result to R2, then **settles** the
   actual cost.
4. The worker then runs one Otto follow-up turn that asks a plain verdict question
   ("does this meet your expectation / anything to change?").

**Credit model:** one user-facing credit represents $0.10 and equals 10 internal ledger units;
one internal ledger unit represents $0.01. Every paid LLM call uses **reserve → settle**
(reserve a worst-case budget before the call, settle the actual token cost after, refund the
remainder). Generation uses estimate → reserve → settle.

**Stack:** Next.js 16 · TypeScript · Prisma 7 + Postgres (Neon) · Cloudflare R2 · pg-boss ·
OpenAI Agents SDK (Anthropic via the AI SDK adapter) · BytePlus Ark (Seedream image /
Seedance video), fal, and mock ($0 local dev) · server-side
ffmpeg (worker) · Railway deployment manifests.

## Dev

```bash
pnpm install
docker compose up -d postgres                                   # local Postgres 16 (fikirtive:fikirtive@localhost:5432/fikirtive)
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm --filter @fikirtive/db exec prisma migrate deploy
pnpm db:generate

# Web + worker read env from a gitignored .env.local at the repo root.
# Local dev is money-safe by default: GENERATION_PROVIDER=mock (=$0 generation),
# COWORK_PROVIDER=mock. Otto's own turns use the real Anthropic model, so set
# ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL=https://api.anthropic.com/v1) to exercise Otto.
# That key is product-runtime configuration only; sanitation/review/recovery must not source
# or inject it. Any real provider/API spend still requires explicit Founder approval.
pnpm --filter @fikirtive/worker exec tsx watch src/index.ts     # the pg-boss consumer (else gen jobs sit QUEUED)
pnpm --filter @fikirtive/web exec next dev -p 3100              # http://localhost:3100

pnpm test && pnpm typecheck
```

To reproduce the current CI jobs locally (e.g. when GitHub Actions is unavailable), follow
`docs/runbooks/local-ci.md`; the workflow and fallback must use the same command source.

Local auth supports email/password, magic link, and Google when configured. In development,
the local magic-link sender writes the URL to `.data/last-magic-link.txt` instead of sending
email. An email in `FOUNDER_ADMIN_EMAILS` converges to the founder-admin role.

## Deploy (Railway — two services from this repo, Root Directory `/`)

Production deployment is Founder-only under current project law. Whether Railway currently has
any source trigger or automatic linkage is external state and must be live-queried; this README
makes no claim that it is present or absent. A merge/push does not prove a deploy occurred.
Both service manifests build from the repo root (workspace deps).

- **web** — runs `prisma migrate deploy` pre-deploy, then `next start`.
- **worker** — `apps/worker/Dockerfile` (ffmpeg included), no public domain.
- Set product runtime variables, including `ANTHROPIC_API_KEY`, on each service that reads them
  (leave `ANTHROPIC_BASE_URL` unset or set it with `/v1`). Other env per `.env.example`.
- Deployment order, target commit and rollback are established in the explicitly authorized
  release task; do not infer them from this README.

## Money-safety invariants

- `genRequest` is the sole validator before a `GenJob` is created; every request carries a
  required idempotency key. Otto LLM calls use their separate metered wrapper and the same ledger.
- The credit ledger is the single writer of balances; `balance == Σ balanceDelta`,
  `reserved == Σ reservedDelta`, never negative.
- A card generates at most once (all-status partial-unique index on the cowork idempotency key).
- The provider is never paid without a successful reserve; a failed call refunds the reservation.
