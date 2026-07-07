# Cowork Phase 0B — model-knowledge base (table + read + admin + seed) Implementation Plan

> **For agentic workers:** execute task-by-task, TDD-first where the surface is pure. Steps use `- [ ]`.

**Goal:** Stand up the per-(family×mode) `ModelDirective` knowledge base the moat depends on — schema + history + a fresh DB read + a founder admin panel to curate directives live (no redeploy) + a thin research seed — plus the pure taxonomy spine (`modelFamily`/`deriveMode`). 0B does **not** yet change Enhance behavior; wiring the directive into the enhance skill is Phase 1.

**Architecture:** Pure taxonomy helpers in `@fikirtive/core` (TDD). `ModelDirective` + `ModelDirectiveRevision` Prisma models (R5 structured `rules Json`, R6 revision history). `getEnhanceDirective(family,mode)` = fresh DB read (R6: no TTL cache). `/admin/directives` server-component grid + `saveModelDirective` action, each `auth()`-gated with an allowlisted email **inside the handler** (R7), reusing the existing `AUTH_ALLOWED_EMAILS` allowlist. Seed = the ~5 cited (untested) research directives, insert-when-absent.

**Tech Stack:** Prisma 7.8.0 (`prisma-client` generator, adapter-pg, Neon), Next 16 App Router server actions, Auth.js v5, vitest (core).

## Key findings that shape this plan
- **No DB-test infra** in the repo (all tests pure). So unit tests cover the pure spine only; DB read/write/admin verify by typecheck + lint + the established action pattern (server actions aren't unit-tested here).
- **Research is thin**: only ~5 directive snippets concretely cited, all `confidence:"untested"`/`source:"research"` (Kling motion, Seedream natural-language, LTX face-merge, i2v motion-not-scene). ~18/25 cells unresearched. Seed reflects exactly that; the admin panel is the curation surface.
- **Auth**: `auth()` → `session.user.email`; `allowed(email)` + `AUTH_ALLOWED_EMAILS` already exist in `apps/web/auth.ts`. Middleware wall (`proxy.ts`) is opt-in (`AUTH_ENABLED`, currently off) → `/admin` must self-guard (R7).
- **Migration apply is a CHECKPOINT**: I author `schema.prisma` + the migration SQL + `prisma generate` (no DB needed), but **do not apply to prod Neon without explicit OK**. Local dev apply only if a local Postgres is up.

## File layout
- **Modify** `packages/core/src/gen.ts` — add `ModelFamily`/`GenMode` types + `modelFamily(id)` + `deriveMode(shape)` (pure, exhaustive, fallback-not-throw).
- **Create** `packages/core/src/gen.test.ts` — exhaustive tests for both helpers.
- **Modify** `packages/db/prisma/schema.prisma` — `ModelDirective` + `ModelDirectiveRevision` models.
- **Create** `packages/db/prisma/migrations/<ts>_model_directive/migration.sql` — hand-authored, defensive (`IF NOT EXISTS`), matching repo style.
- **Create** `apps/web/lib/cowork-knowledge.ts` — `getEnhanceDirective(family,mode)` fresh read + a `ModelDirective`-shape DTO.
- **Create** `apps/web/lib/admin-actions.ts` — `saveModelDirective(raw)` (`"use server"`, R7 auth-inside, zod-validate, upsert + revision row + audit + revalidate).
- **Create** `apps/web/app/admin/directives/page.tsx` — R7 auth-gated server-component grid (family×mode), per-cell directive textarea + confidence/enabled + structured-rules, `<form action={saveModelDirective}>`.
- **Create** `packages/core/src/cowork-directives.ts` — the typed seed list (the ~5 cited cells) + the closed `rules` shape + the family/mode enums shared with the admin zod.
- **Create** `packages/db/prisma/seed-directives.ts` (or `apps/web/lib/...`) — insert-when-absent upsert per seed cell.

## Schema (R5 structured rules + R6 history)
```prisma
model ModelDirective {
  id         String   @id
  ownerId    String   @default("founder")
  family     String   // "seedream" | "kling" | "veo" | "seedance" | "ltx"
  mode       String   // "t2i" | "i2i" | "t2v" | "i2v" | "i2v-tail"
  directive  String   @default("")   // injectable free-text snippet (empty → family-neutral base)
  rules      Json?                    // closed shape: { maxConcurrentMotions?, noTagCommas?, i2vMotionNotScene?, pitfalls?: string[] }
  notes      String   @default("")
  confidence String   @default("untested")  // "high" | "medium" | "low" | "untested"
  enabled    Boolean  @default(true)
  source     String   @default("research")  // "research" | "founder" | "vision-v2"
  updatedAt  DateTime @updatedAt
  createdAt  DateTime @default(now())
  revisions  ModelDirectiveRevision[]
  @@unique([ownerId, family, mode])
  @@index([ownerId, family])
}
model ModelDirectiveRevision {   // R6: edit history for rollback
  id          String   @id
  directiveId String
  ownerId     String   @default("founder")
  directive   String
  rules       Json?
  confidence  String
  enabled     Boolean
  source      String
  editedBy    String   @default("")   // the admin email at save time
  createdAt   DateTime @default(now())
  parent ModelDirective @relation(fields: [directiveId], references: [id], onDelete: Cascade)
  @@index([directiveId, createdAt])
}
```
- R5 per-version override deferred: `modelFamily` already collapses versions; a model-specific override row isn't needed until a version diverges. Documented, not built (YAGNI).

## Tasks
- [x] **T1 (pure spine, TDD):** `gen.test.ts` (10 tests) → `modelFamily`/`deriveMode` in `gen.ts`. Green.
- [x] **T2 (schema + migration):** two models added; client generated; migration SQL hand-authored + **validated byte-identical to Prisma's `--from-empty` output** (Codex: semantically drift-free; index order differs harmlessly). **Apply deferred** (checkpoint).
- [x] **T3 (seed data + read):** `cowork-directives.ts` (6 cited cells, all `untested`) + `cowork-directives.test.ts` (9 tests); `cowork-knowledge.ts` `getEnhanceDirective` (R6 fresh) + `listDirectives`.
- [x] **T4 (admin):** `saveModelDirective` (R7 + interactive tx: upsert→revision→audit) + `seedResearchDirectives` (insert-when-absent); `app/admin/directives/page.tsx` (R7 gate + full grid); `DirectivesAdmin.tsx` client grid. `auth.ts` exports `allowed`.
- [x] **T5 (verify):** core 84 green; core+db+web+worker typecheck; web lint. **Codex reviewed → VERDICT: SHIP** (no blocking findings). Not committed.

## Checkpoints (will NOT cross without your OK)
- Applying the migration to **prod Neon** (`migrate deploy`).
- The admin gate reuses `AUTH_ALLOWED_EMAILS` (single-tenant: any allowlisted authed session = founder). Flag if a separate `ADMIN_EMAILS` is wanted.
