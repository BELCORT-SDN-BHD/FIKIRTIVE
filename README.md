# Fikirtive

A SEA-native **marketing & customer-data OS** for SMB / DTC teams. The wedge: turn an
idea into a batch of on-brand ad images and short videos in the same day — driven mainly
through **Otto**, an AI marketing operator you talk to in plain language.

Otto proposes what to create, you approve the spend with one click, and a background worker
generates it. Everything that costs an API call (generation *and* Otto's own LLM turns) is
metered against a per-org **credit ledger**, so spend is capped and auditable.

> Naming note: the product/brand is **Fikirtive**; the internal npm scope is still
> `@artlio/*` (a rename is a separate mechanical task, deliberately not bundled into feature work).

## Architecture

pnpm + TypeScript monorepo. Two long-lived services (web + worker) over one Postgres.

```
apps/web          Next.js 16 (App Router) — UI, server actions, auth gate, the Otto chat
apps/worker       pg-boss consumer — generation jobs (fal), ffmpeg video editing,
                  and Otto's post-generation "verdict" auto-resume
packages/otto     Otto — an OpenAI Agents SDK agent: tools (propose / generate /
                  updateBrief / describeRefs / setTitle), reserve→settle LLM metering,
                  RunState persisted to Postgres (imported by BOTH web and worker)
packages/core     shared logic — the genRequest spend gate, pricing/credit units,
                  model registry, cowork/otto helpers, timeline + NLE editor ops
packages/db       Prisma 7 schema + client — the credit ledger is the single spend authority
packages/generation  fal image/video providers (mock provider = $0 for local dev)
packages/storage  Cloudflare R2 object storage
```

### How a generation flows (and how money is gated)

1. You chat with **Otto** (`apps/web` → `ottoTurn`). Otto replies and calls the `propose`
   tool, which persists a **display-only** generation card ($0 — no spend yet).
2. To create it, Otto calls the `generate` tool (`needsApproval`) or you click **Generate**
   on the card. Either path goes through the unchanged `startGen` and is **exactly-once**
   via a per-card idempotency key — a card generates at most once.
3. `startGen` validates the request (`genRequest` zod gate), **reserves** credits atomically
   (never-negative), inserts the job, and enqueues it. The `apps/worker` consumer calls fal,
   stores the result to R2, then **settles** the actual cost.
4. The worker then runs one Otto follow-up turn that asks a plain verdict question
   ("does this meet your expectation / anything to change?").

**Credit model:** display `1 USD = 10 credits`; internally `1 credit = $0.01`. Every paid LLM
call uses **reserve → settle** (reserve a worst-case budget before the call, settle the actual
token cost after, refund the remainder). Generation uses estimate → reserve → settle.

**Stack:** Next.js 16 · TypeScript · Prisma 7 + Postgres (Neon) · Cloudflare R2 · pg-boss ·
OpenAI Agents SDK (Anthropic via the AI SDK adapter) · fal · server-side ffmpeg (worker) ·
deployed on Railway.

## Dev

```bash
pnpm install
docker compose up -d postgres                                   # local Postgres 16 (artlio:artlio@localhost:5432/artlio)
DATABASE_URL="postgresql://artlio:artlio@localhost:5432/artlio" pnpm --filter @artlio/db exec prisma migrate deploy
pnpm db:generate

# Web + worker read env from a gitignored .env.local at the repo root.
# Local dev is money-safe by default: GENERATION_PROVIDER=mock (=$0 generation),
# COWORK_PROVIDER=mock. Otto's own turns use the real Anthropic model, so set
# ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL=https://api.anthropic.com/v1) to exercise Otto.
pnpm --filter @artlio/worker exec tsx watch src/index.ts        # the pg-boss consumer (else gen jobs sit QUEUED)
pnpm --filter @artlio/web exec next dev -p 3100                 # http://localhost:3100

pnpm test && pnpm typecheck
```

Local auth is passwordless: the magic-link URL is written to `.data/last-magic-link.txt`
(no email sent). An email in `FOUNDER_ADMIN_EMAILS` signs in as a super-admin.

## Deploy (Railway — two services from this repo, Root Directory `/`)

Pushing to `main` auto-deploys. Both services build from the repo root (workspace deps).

- **web** — runs `prisma migrate deploy` pre-deploy, then `next start`.
- **worker** — `apps/worker/Dockerfile` (ffmpeg included), no public domain.
- Approve **web → worker** in order. Set `ANTHROPIC_API_KEY` on **both** services
  (leave `ANTHROPIC_BASE_URL` unset or set it with `/v1`). Other env per `.env.example`.
- Rollback is `git revert` + redeploy.

## Money-safety invariants

- `genRequest` is the sole spend authority; every request carries a required idempotency key.
- The credit ledger is the single writer of balances; `balance == Σ balanceDelta`,
  `reserved == Σ reservedDelta`, never negative.
- A card generates at most once (all-status partial-unique index on the cowork idempotency key).
- The provider is never paid without a successful reserve; a failed call refunds the reservation.
