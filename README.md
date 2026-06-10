# Artlio

Model-neutral entity asset layer for AI video creators — manage characters,
locations, products and brand refs as `@mention`-able entities across prompts,
shots, and generation history.

**Stack** (all choices adjudicated in the design doc, see `~/.gstack/projects/artlio/`):
Next.js (App Router) · TypeScript · Prisma 7 + Postgres (Neon) · Cloudflare R2 +
Uppy multipart · pg-boss v12 · server-side ffmpeg 7 (worker container) ·
Tiptap v3 · pnpm workspaces.

## Layout

```
apps/web        Next.js UI + API routes (presign, callbacks, auth gate)
apps/worker     long-lived pg-boss consumer: ingest pipeline + ffmpeg + sweeper
packages/db     Prisma 7 schema + client (single source of truth)
packages/core   shared logic: ULIDs, content-hash storage keys, bundle format
docs/sop/       agent SOP: ComfyUI workflow → Artlio template / Modal endpoint
templates/      ComfyUI template bundles + registry.json (file registry until M0 imports it)
```

## Dev

```bash
pnpm install
docker compose up -d postgres     # local Postgres 17
cp .env.example packages/db/.env  # default local DATABASE_URL works as-is
pnpm db:migrate                   # prisma migrate dev
pnpm dev                          # web :3000 + worker (watch mode)
pnpm test && pnpm typecheck
```

## Deploy (Railway, two services from this repo)

Both services keep **Root Directory = `/`** (workspace deps need the repo root as
build context):

- **web** — build: `pnpm install --frozen-lockfile && pnpm --filter @artlio/web... build`,
  start: `pnpm --filter @artlio/web start`. Watch paths: `apps/web/**`, `packages/**`.
- **worker** — Dockerfile Path = `apps/worker/Dockerfile` (ffmpeg included),
  no public domain. Watch paths: `apps/worker/**`, `packages/**`, `pnpm-lock.yaml`.
- Deploy order (launch checklist rule 2): Prisma migrate → worker (pg-boss schema
  boots on start) → web.
- Env: see `.env.example`. Neon: `DATABASE_URL` (direct) + `DATABASE_URL_POOLED`
  (-pooler; web runtime uses pooled, worker prefers direct). R2 + Auth.js secrets
  per example file.

## Invariant tests (Phase-1 completion gate)

1. Entity-pack export → import → re-export is byte-identical
2. Soft delete never breaks generation-history links
3. History snapshots don't change when entities are renamed
4. Malicious zips (path traversal / oversized) are rejected loudly
5. Interrupted multipart uploads resume and complete with verified hash
