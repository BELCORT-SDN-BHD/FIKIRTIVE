# Closed-Beta Phase 1 — Tenant Tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Add the org-as-tenant root (`Organization` + `Membership` + reserved-now columns) and FK every business table's existing `ownerId` to `Organization.id`, seeding the founder org with the literal id `"founder"` so existing data + R2 keys are untouched. Additive, zero-data-movement, **local DB only**, dormant (the app still reads `FOUNDER_OWNER_ID`).

**Architecture:** Reuse the existing `ownerId String @default("founder")` scalar on all 20 business tables as the FK to `Organization.id` (no new column on business tables). Seed `Organization{id:"founder"}` in the migration so the FK validates against existing rows with zero backfill. Hot tables get `NOT VALID` + separate `VALIDATE` FKs (hand-edited migration) so Railway auto-migrate never long-locks. `Membership.role` is a code-side zod enum (`org-roles.ts`), not a PG enum.

**Tech Stack:** Prisma 7.8 (`prisma migrate dev`, datasource reads `DATABASE_URL`), Postgres (local `postgresql://artlio:artlio@localhost:5432/artlio`), vitest (core).

**House rules:** LOCAL only — **never** run against prod; the migration is additive + reversible; surgical; NO auto-commit/push (git steps "leave for user"). The 20 owner-scoped tables (confirmed via grep): Project, Entity, EntityVariant, ReferenceImage, Asset, Shot, **ShotEntityRef** (verify its ownerId), Generation, TemplateBundle, RenderJob, CaptionJob, Transcript, RefGenJob, GenJob, ActionEvent, ModelDirective, ModelRegistryOverlay, ModelDirectiveRevision, ChatThread, ChatMessage.

---

### Task 1: `org-roles.ts` (core) — per-org RBAC vocabulary

Separate from `roles.ts` (platform-staff RBAC). A code-side zod enum, not a PG enum (matches house style; adding a role later needs no migration).

**Files:** Create `packages/core/src/org-roles.ts`; Test `packages/core/src/org-roles.test.ts`; Modify `packages/core/src/index.ts` (export).

- [ ] **Step 1: Failing test** (`org-roles.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { ORG_ROLES, isOrgRole } from "./org-roles.js";

describe("ORG_ROLES (per-org membership RBAC — distinct from platform User.role)", () => {
  it("is exactly owner|admin|member", () => {
    expect([...ORG_ROLES]).toEqual(["owner", "admin", "member"]);
  });
  it("isOrgRole accepts valid, rejects others", () => {
    expect(isOrgRole("owner")).toBe(true);
    expect(isOrgRole("super-admin")).toBe(false); // that's a platform role, not an org role
    expect(isOrgRole(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** `pnpm --filter @artlio/core test org-roles`
- [ ] **Step 3: Implement** `packages/core/src/org-roles.ts`

```ts
/** Per-ORG membership RBAC (the tenant axis) — DISTINCT from packages/core/src/roles.ts,
 *  which is platform-STAFF RBAC for the internal /admin console. Never merge the two.
 *  A code-side enum (not a PG enum) so adding a role later needs no migration. */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export function isOrgRole(x: unknown): x is OrgRole {
  return typeof x === "string" && (ORG_ROLES as readonly string[]).includes(x);
}
```

- [ ] **Step 4: Export** — add to `packages/core/src/index.ts`: `export { ORG_ROLES, isOrgRole, type OrgRole } from "./org-roles.js";`
- [ ] **Step 5: Run → PASS** `pnpm --filter @artlio/core test org-roles` then `pnpm --filter @artlio/core build` (so web/worker see the new export).
- [ ] **Step 6: (leave for user) commit** `git add packages/core/src/org-roles.ts packages/core/src/org-roles.test.ts packages/core/src/index.ts`

---

### Task 2: Schema — Organization + Membership + reserved columns + business-table relations

**Files:** Modify `packages/db/prisma/schema.prisma`.

- [ ] **Step 1: Add the two new models** (after the `VerificationToken` model, in the auth section is fine):

```prisma
// ── Org-as-tenant root (closed-beta foundation P1) ─────────────────────────────
// An Organization IS the tenant. Every business table's existing `ownerId` is an FK
// to Organization.id. The founder org is SEEDED (in the migration) with the literal
// id "founder" so all existing ownerId="founder" rows + R2 keys (u/founder/<hash>)
// are valid with ZERO backfill. New orgs get ULID ids. DORMANT until P3 (the app
// still resolves ownerId via the FOUNDER_OWNER_ID constant).
model Organization {
  id        String    @id            // ULID for new orgs; literal "founder" for the seed (== FOUNDER_OWNER_ID). NEVER change.
  name      String    @default("")
  slug      String?   @unique         // future tenant routing; nullable now
  deletedAt DateTime?                 // RESERVED NOW (account closure / GDPR erasure)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  memberships Membership[]
  // business back-relations (one per owner-scoped table; required by Prisma):
  projects               Project[]
  entities               Entity[]
  entityVariants         EntityVariant[]
  referenceImages        ReferenceImage[]
  assets                 Asset[]
  shots                  Shot[]
  shotEntityRefs         ShotEntityRef[]
  generations            Generation[]
  templateBundles        TemplateBundle[]
  renderJobs             RenderJob[]
  captionJobs            CaptionJob[]
  transcripts            Transcript[]
  refGenJobs             RefGenJob[]
  genJobs                GenJob[]
  actionEvents           ActionEvent[]
  modelDirectives        ModelDirective[]
  modelRegistryOverlays  ModelRegistryOverlay[]
  modelDirectiveRevisions ModelDirectiveRevision[]
  chatThreads            ChatThread[]
  chatMessages           ChatMessage[]
}

// User <-> Organization join, carrying the per-org role. role/status are code-validated
// Strings (ORG_ROLES / "active"|"suspended"|"revoked"), not PG enums. RESERVED columns
// (status/deletedAt/invitedBy) are unused in beta but free to add now.
model Membership {
  id        String    @id            // ULID
  userId    String
  orgId     String
  role      String    @default("owner")   // ORG_ROLES: owner|admin|member (NOT User.role)
  status    String    @default("active")  // RESERVED: active|suspended|revoked
  invitedBy String?                       // RESERVED (future invites)
  deletedAt DateTime?                     // RESERVED (revocation audit)
  createdAt DateTime  @default(now())

  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org  Organization @relation(fields: [orgId],  references: [id], onDelete: Cascade)

  @@unique([userId, orgId])
  @@index([orgId, role])
  @@index([userId])
}
```

- [ ] **Step 2: Extend `User`** — add the reserved active-org carrier + the back-relation (leave `role` UNCHANGED):

```prisma
model User {
  id            String       @id @default(cuid())
  name          String?
  email         String       @unique
  emailVerified DateTime?
  image         String?
  role          String       @default("viewer")  // PLATFORM-STAFF RBAC — unchanged
  activeOrgId   String?                            // RESERVED NOW (future multi-org switcher; avoids an auth-table migration later)
  accounts      Account[]
  sessions      Session[]
  memberships   Membership[]                       // NEW
}
```

- [ ] **Step 3: Add `deletedAt` reserved column to `Organization`** — already in Step 1. (No business-table column changes.)

- [ ] **Step 4: Add the `organization` relation to EACH of the 20 business tables.** For every owner-scoped model, add ONE line (reusing the existing `ownerId` scalar as the FK — no new column). First CONFIRM `ShotEntityRef` has an `ownerId` field (grep `model ShotEntityRef` block); if it lacks `ownerId @default("founder")`, OMIT it from the relations + the Organization back-relation. Example on Project:

```prisma
model Project {
  id        String    @id
  ownerId   String    @default("founder")
  // ...all existing fields & indexes unchanged...
  organization Organization @relation(fields: [ownerId], references: [id])  // NEW — reuses ownerId; no new column
}
```

Repeat the single `organization Organization @relation(fields: [ownerId], references: [id])` line in: Project, Entity, EntityVariant, ReferenceImage, Asset, Shot, ShotEntityRef (if it has ownerId), Generation, TemplateBundle, RenderJob, CaptionJob, Transcript, RefGenJob, GenJob, ActionEvent, ModelDirective, ModelRegistryOverlay, ModelDirectiveRevision, ChatThread, ChatMessage. Keep the Organization back-relation list (Step 1) in sync with whichever tables actually get the relation.

- [ ] **Step 5: Validate the schema parses** — `pnpm --filter @artlio/db exec prisma validate` → "The schema is valid". Fix any "missing opposite relation field" errors (every business `organization` field needs its array on Organization, and vice-versa).

---

### Task 3: Generate + hand-edit the migration (seed + lock-safe FKs)

**Files:** Create `packages/db/prisma/migrations/<ts>_org_tenant/migration.sql` (via Prisma, then hand-edit).

- [ ] **Step 1: Generate WITHOUT applying** (so we can hand-edit before it runs):

Run (from repo root, local DB url explicit): `DATABASE_URL="postgresql://artlio:artlio@localhost:5432/artlio" pnpm --filter @artlio/db exec prisma migrate dev --create-only --name org_tenant`
Expected: a new `migrations/<ts>_org_tenant/migration.sql` is written, NOT applied.

- [ ] **Step 2: Read the generated SQL.** It will contain: `CREATE TABLE "Organization"`, `CREATE TABLE "Membership"`, the unique/index creations, `ALTER TABLE "User" ADD COLUMN "activeOrgId"`, and ~20 `ALTER TABLE "<biz>" ADD CONSTRAINT "<biz>_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ...` lines (all validating by default).

- [ ] **Step 3: Hand-edit the migration.sql** in this order:
  1. Keep the `CREATE TABLE "Organization"` / `"Membership"` + indexes + the `User.activeOrgId` column.
  2. **Immediately after** the Organization table is created, INSERT the founder org (idempotent), BEFORE any FK:
     ```sql
     INSERT INTO "Organization" ("id","name","createdAt","updatedAt")
     VALUES ('founder','Founder',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("id") DO NOTHING;
     ```
  3. For the HOT/large tables — **Generation, Asset, GenJob, RefGenJob, RenderJob, ActionEvent** — replace the generated validating FK with `NOT VALID`, then a separate `VALIDATE`:
     ```sql
     ALTER TABLE "Generation" ADD CONSTRAINT "Generation_ownerId_fkey"
       FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
     ALTER TABLE "Generation" VALIDATE CONSTRAINT "Generation_ownerId_fkey";
     -- (repeat the NOT VALID + VALIDATE pair for Asset, GenJob, RefGenJob, RenderJob, ActionEvent)
     ```
     (Small tables can keep the single generated validating FK — trivial scan.)
  4. Ensure **no** `ON DELETE CASCADE` from Organization to business tables — keep `ON DELETE RESTRICT` (deleting an org must be deliberate, never an FK side-effect). Prisma's default for a required relation is RESTRICT — confirm it didn't emit CASCADE.

- [ ] **Step 4: Apply to LOCAL only** — `DATABASE_URL="postgresql://artlio:artlio@localhost:5432/artlio" pnpm --filter @artlio/db exec prisma migrate dev` (applies the edited migration; regenerates the client). Expected: migration applies clean, `prisma generate` runs.

---

### Task 4: Verify the migration (data intact, FKs present, founder org seeded)

- [ ] **Step 1: Founder org exists**
`psql "postgresql://artlio:artlio@localhost:5432/artlio" -c "SELECT id,name FROM \"Organization\";"` → row `founder | Founder`.

- [ ] **Step 2: Existing rows still valid (FK holds, zero backfill)**
`psql ... -c "SELECT COUNT(*) FROM \"Project\" WHERE \"ownerId\"='founder';"` and the same for `Generation`, `Asset`, `GenJob` → counts unchanged from before; no FK violation occurred (the migration applied = proof).

- [ ] **Step 3: FKs present**
`psql ... -c "SELECT conname FROM pg_constraint WHERE conname LIKE '%_ownerId_fkey' ORDER BY conname;"` → 20 (or however many tables got the relation) `_ownerId_fkey` rows.

- [ ] **Step 4: Distinct ownerId is only 'founder'** (the pre-flight invariant)
`psql ... -c "SELECT DISTINCT \"ownerId\" FROM \"Generation\";"` → only `founder`.

- [ ] **Step 5: Client regenerated** — `pnpm -r typecheck` clean (the new Organization/Membership models exist; existing code unaffected since it doesn't reference them yet).

---

### Task 5: Lazy founder Membership bootstrap (auth.ts, dormant)

Per spec: the founder `Membership` is created lazily on sign-in (the founder User row may not exist at migration time). Dormant — nothing reads Membership until P3 — but it makes the founder's membership exist early, idempotently.

**Files:** Modify `apps/web/auth.ts` (`events.signIn`).

- [ ] **Step 1: Add the membership upsert** next to the existing founder self-heal, same best-effort/never-block contract. Use `newId()` (already imported) + `FOUNDER_OWNER_ID` (import from `@artlio/core`):

```ts
// (in events.signIn, after the existing isFounderAdmin self-heal block)
// P1 dormant prep: ensure the founder's Membership in the seeded "founder" org exists.
// Idempotent (@@unique([userId, orgId])), best-effort, NEVER blocks sign-in. Only the
// founder maps to the "founder" org; everyone else gets their own org in P3.
if (isFounderAdmin(user.email) && user.id) {
  await prisma.membership
    .upsert({
      where: { userId_orgId: { userId: user.id, orgId: FOUNDER_OWNER_ID } },
      create: { id: newId(), userId: user.id, orgId: FOUNDER_OWNER_ID, role: "owner" },
      update: {},
    })
    .catch(() => {}); // best-effort — never block sign-in on a membership write
}
```
(Add `FOUNDER_OWNER_ID` to the `@artlio/core` import in auth.ts.)

- [ ] **Step 2: Verify** `pnpm --filter web typecheck` → clean. (Runtime path is dormant; no behavior change for existing flows.)
- [ ] **Step 3: (leave for user) commit** the schema + migration + auth.ts together.

---

### Task 6: Phase verify + dual gate

- [ ] **Step 1:** `pnpm -r typecheck` clean; `pnpm --filter @artlio/core test` green (org-roles + all prior).
- [ ] **Step 2:** Migration smoke (Task 4) green.
- [ ] **Step 3: DUAL GATE (per the every-round rule):** capture the P1 diff (`git diff HEAD` on schema.prisma, the new migration.sql, org-roles.ts/index.ts/test, auth.ts) → run **Codex** (read-only, focus: is the migration additive + lock-safe + zero-data-loss; FK ordering seed-before-FK; no CASCADE-from-org; relations complete; `Membership` shape) AND the **workflow code-QA** (dimensions: migration-safety, schema-correctness, dormancy/no-regression). Fix all confirmed BLOCKER/STRONG, re-verify. Then STOP for the user before P2.

---

## Self-Review

**Spec coverage (§3, §7 P1):** Organization + Membership → Task 2. Reserved columns (User.activeOrgId, Org.deletedAt, Membership status/deletedAt/invitedBy) → Task 2. org-roles.ts → Task 1. Seed founder org id="founder" → Task 3. ownerId-as-FK on all business tables → Task 2/3. NOT VALID/VALIDATE on hot tables → Task 3. No CASCADE-from-org → Task 3 step 4. Lazy founder Membership → Task 5. ✅

**Placeholder scan:** none — exact SQL + schema blocks given.

**Type consistency:** `Membership.role` String validated by `ORG_ROLES` (Task 1). `FOUNDER_OWNER_ID` literal "founder" === the seeded `Organization.id` (Task 3 seed) — already guarded by the P0 test. `userId_orgId` compound-unique name (Task 5 upsert) matches `@@unique([userId, orgId])` (Task 2).

**Migration safety:** `--create-only` → hand-edit → apply (so the seed precedes the FK and hot tables get NOT VALID/VALIDATE). LOCAL DB only. Additive + reversible (rollback = drop the two tables + the FKs + the activeOrgId column).
