# Closed-Beta P3 — Multi-Tenant Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip Fikirtive from single-tenant (`ownerId` hardcoded to the constant `FOUNDER_OWNER_ID = "founder"`) to true multi-tenant, where every spend/data/storage site resolves `ownerId` per-request from the session via a fail-closed `requireOwner()` resolver, with a 2-org isolation test proving no cross-tenant leak.

**Architecture:** One authoritative resolver `requireOwner()` (sibling to `requireSession`/`requireRole` in `apps/web/lib/auth-guard.ts`) maps `session → { email, ownerId }`, synchronously bootstrapping a personal Organization + Membership(owner) + CreditAccount(beta grant) for any non-founder, and **never** falling back to `"founder"`. `events.signIn` runs the same bootstrap best-effort. Every tenant-data read/write swaps the `FOUNDER_OWNER_ID` constant for the resolved `ownerId`; admin reads stay platform-wide (cross-tenant by design); the `/files` route and `ownedAssetFromSrc` verify the key's embedded owner against the resolved owner; the two `$executeRaw` aliases thread `ownerId` into their WHERE; the schema's `@default("founder")` is removed so a new row can never silently inherit the founder's owner; a Prisma client extension backstops unscoped reads.

**Tech Stack:** Next.js (vendored — read `node_modules/next/dist/docs/` before touching App Router code), next-auth v5 (DB sessions, PrismaAdapter), Prisma 7 (`@prisma/adapter-pg`, `packages/db`), Postgres (local `postgresql://fikirtive:fikirtive@localhost:5432/fikirtive`), Vitest 3 (`packages/core`; we add a runner to `apps/web` for the resolver + isolation tests), `@fikirtive/core` (`FOUNDER_OWNER_ID`, `ORG_ROLES`, `storageKey`/`parseStorageKey`/`keyOwnerMatches`, `spend.ts`), `@fikirtive/db` (`prisma`, credit service `grantCredits`/`reserveCredits`/`settleCredits`/`refundReservation`).

---

## Flip checklist (must ALL be covered)

This is the literal §4 + §7 leak-site list. Each line maps to a Task below; **a missed line is an open cross-tenant leak.**

- [ ] **The resolver itself** — `requireOwner()` is authoritative, fail-closed, never returns `"founder"` for a non-founder (Task 2).
- [ ] **`events.signIn` bootstrap** for all users (best-effort convergence) (Task 3).
- [ ] **`apps/web/lib/data.ts`** (13 sites) — `getGenerationThumbs`, `ensureDefaultProject`, `getProjects`, `getEntities`, `getShots`, `getCandidates`, `getProjectMedia`, `getCoworkThreads`, `getCoworkThread`, `resolveCoworkResultUrls` (reads `spentUsd` = cross-tenant cost visibility) (Task 5).
- [ ] **`apps/web/lib/refgen-actions.ts`** (21 sites) — `startRefGen`, `setBaseAsset`, `createVariant`, `regenerateVariant`, `renameVariant`, `deleteVariant`, `getRefGenJobs`, `dispatchVariantJob` (Task 6).
- [ ] **`apps/web/lib/gen-actions.ts`** (14 sites) — `startGen`, **second-hop reads** `getGenJob` + `getRecentGenResults` (Task 7).
- [ ] **`apps/web/lib/actions.ts`** (38 sites) — all CRUD actions + `getRenderJobs` + `ownedAssetFromSrc` (key-owner verification) + caption/transcript reads (`startCaption`, `getCaptionJob`, `getTranscript`) (Task 8).
- [ ] **The 2 `$executeRaw` alias sites** — `actions.ts:181` (`addEntityAlias`) and `actions.ts:192` (`removeEntityAlias`) thread resolved `ownerId` into `WHERE "ownerId" = …` (Task 8, called out explicitly — grep/ESLint can't catch raw SQL).
- [ ] **`apps/web/lib/upload-actions.ts`** (11 sites) — `authorizeUpload`, `signUploadPart`, `abortDirectUpload`, `finalizeCandidateUploads` (direct upload/finalize paths) (Task 9).
- [ ] **`apps/web/lib/cowork-actions.ts`** (23 sites) — `coworkDraftStoryboard`, `enhancePrompt`, `coworkTurn`, `coworkGenerate`, `coworkRenameThread`, `coworkDeleteThread`, `assetBytes` (Task 10).
- [ ] **`apps/web/lib/cowork-guardian.ts`** (4 sites) — `checkCast` takes `ownerId` (Task 10).
- [ ] **`apps/web/lib/studio-actions.ts`** (4 sites) (Task 11).
- [ ] **`apps/web/lib/entity-snapshot.ts`** (2 sites) (Task 11).
- [ ] **`apps/web/app/files/[...key]/route.ts`** (3 sites) — `/files` route calls `requireOwner()` and 404s when `keyOwnerMatches(joined, ownerId)` is false (Task 12).
- [ ] **Admin cross-tenant reads stay platform-wide** (excluded from tenant scoping, gated by `User.role`): `admin-actions.ts` (14 — platform-config writes, stay founder-stamped), `app/admin/system/page.tsx` (9), `app/admin/cost/page.tsx` (3), `app/admin/content/page.tsx` (3), `app/admin/models/page.tsx` (2), `app/admin/credits/page.tsx` (2), `app/admin/audit/page.tsx` (2), `credit-actions.ts` (3) (Task 13).
- [ ] **`@default("founder")` removed** from all 20 `ownerId` columns in `schema.prisma` via a migration (Task 4).
- [ ] **Prisma client-extension backstop** asserting tenant-table reads carry an `ownerId` filter (additive, non-breaking) (Task 14).
- [ ] **2-org isolation test green** — org B gets `[]`/`null`/throws for every one of org A's ids across projects/shots/assets/generations/gen+refgen jobs/credits balance/cost visibility/threads + the `/files` route (Task 15).
- [ ] **Cowork LLM confirmed `$0`** — re-assert (already a P0 deliverable) the effective planner provider is mock/self-hosted so credits fully cap fal spend (Task 16, verification only).
- [ ] **Worker confirmed unchanged** — `apps/worker/src/model-registry.ts`'s 2 `FOUNDER_OWNER_ID` uses are platform-config (`ModelRegistryOverlay`) reads, not tenant data; worker spend uses `job.ownerId` from the persisted row (Task 16, verification only).
- [ ] **Double gate** — Codex review + workflow code-QA + money-safety-review lens; fix all confirmed BLOCKER/STRONG (Task 17).
- [ ] **STOP for explicit user deploy confirmation** — the flip is the point of no return (Task 17 final step).

---

## Pre-flight (read before coding)

- [ ] **Read `apps/web/AGENTS.md`** — this is a vendored Next.js with breaking changes; read `node_modules/next/dist/docs/` before any App Router edit.
- [ ] **Confirm the local DB is current** — P1 (`20260619120000_org_tenant`) and P2 (`20260619130000_credits`) migrations must already be applied locally. Run:
  ```bash
  psql postgresql://fikirtive:fikirtive@localhost:5432/fikirtive -c '\d "Organization"' -c '\d "CreditAccount"'
  ```
  Expected: both tables exist; the `founder` org row exists (`SELECT id FROM "Organization" WHERE id='founder';`).
- [ ] **Kill stale fal workers** before any gen test; all tests use `GENERATION_PROVIDER=mock`.
- [ ] **Single `main` branch — no feature branch.** All commit steps are **"leave for user"** (do NOT auto-commit/push).

---

## File Structure

**Created:**
- `apps/web/vitest.config.ts` — Vitest runner for `apps/web` (resolver + bootstrap + isolation tests live here because they need the Prisma client + auth, which are outside `packages/core`).
- `apps/web/lib/__tests__/require-owner.test.ts` — fail-closed resolver + bootstrap unit/integration tests.
- `apps/web/lib/__tests__/isolation.test.ts` — the 2-org isolation test (the proof the flip is leak-free).
- `packages/db/src/tenant-guard.ts` — the Prisma client-extension backstop.
- `packages/db/prisma/migrations/20260619140000_drop_owner_default/migration.sql` — removes `@default("founder")` from all `ownerId` columns.

**Modified:**
- `apps/web/auth.ts` — export `isFounderAdmin`; `events.signIn` bootstraps a personal org for all users.
- `apps/web/lib/auth-guard.ts` — add `requireOwner()`.
- `apps/web/lib/data.ts` — all read functions take an `ownerId` parameter.
- `apps/web/lib/refgen-actions.ts`, `gen-actions.ts`, `actions.ts`, `upload-actions.ts`, `cowork-actions.ts`, `cowork-guardian.ts`, `studio-actions.ts`, `entity-snapshot.ts` — call `requireOwner()` at the top, build scope from the resolved `ownerId`.
- `apps/web/app/files/[...key]/route.ts` — `requireOwner()` + key-owner check against resolved owner.
- `apps/web/app/studio/page.tsx`, `app/editor/page.tsx` — call `requireOwner()` once, pass `ownerId` into `data.ts` reads.
- `apps/web/app/account/page.tsx` (if it reads balance) — resolve via `requireOwner()`.
- `packages/db/prisma/schema.prisma` — drop `@default("founder")` from 20 `ownerId` columns.
- `packages/db/src/index.ts` — re-export the tenant guard (if wired into the client).
- `packages/core/src/spend.ts` (or `org-roles.ts`) — add `BETA_INITIAL_GRANT_CREDITS = 1000` constant if not already present.

**Excluded from the flip (verified, do NOT touch for tenancy):**
- `apps/worker/src/model-registry.ts` — platform config (`ModelRegistryOverlay` overlay), not tenant data. Worker spend already uses `job.ownerId`.
- `apps/web/lib/admin-actions.ts` + all `app/admin/*/page.tsx` — cross-tenant/platform-config by design; stay founder-stamped or platform-wide (Task 13).
- `packages/core/src/storage-key.ts:10` (the `FOUNDER_OWNER_ID` definition) and `packages/core/src/index.ts` (the re-export) — STAY.

---

## Task 1: Wire a Vitest runner into `apps/web`

The resolver, bootstrap, and isolation tests need the Prisma client + the auth module — both live outside `packages/core` (which is the only package with a test runner today). Add a minimal runner so we can TDD the security-critical code. This task ships first because every later TDD task depends on it.

**Files:**
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json` (the `test` script)

- [ ] **Step 1: Create the Vitest config**

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

// apps/web tests are integration-flavored: the resolver + isolation tests hit the
// LOCAL Postgres through the real Prisma client. Single-thread so the 2-org isolation
// test's seed/teardown can't interleave with another file's writes.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 20000,
  },
});
```

- [ ] **Step 2: Add the test script + vitest dev dep**

In `apps/web/package.json`, replace the `"test": "echo 'no tests yet'"` line with:

```json
    "test": "vitest run",
```

And add to `devDependencies` (match the version `packages/core` uses):

```json
    "vitest": "^3.2.0"
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: vitest resolves in `apps/web`; no lockfile error.

- [ ] **Step 4: Smoke the runner with a trivial passing test**

Create a throwaway `apps/web/lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => { it("runs", () => { expect(1 + 1).toBe(2); }); });
```

Run: `pnpm --filter @fikirtive/web test`
Expected: PASS (1 test). Then delete `smoke.test.ts`.

- [ ] **Step 5: Commit (leave for user)**

```bash
git add apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): wire vitest runner for P3 resolver + isolation tests"
```

---

## Task 2 (TDD): The `requireOwner()` fail-closed resolver

The single most security-critical function in the foundation. Spec §6.3: `auth()` → email; `!email || !allowed(email)` → `{error}`; `isFounderAdmin(email)` → resolve to `"founder"` (the ONLY path that may return `"founder"`); otherwise look up the user's active Membership/org, else **synchronously bootstrap** a personal Organization + Membership(owner) + CreditAccount(beta grant via `grantCredits`, idempotent); if bootstrap can't complete → `{error}`, **never** a default owner. Returns `{ email, ownerId }`. Idempotent.

**Files:**
- Modify: `apps/web/auth.ts` (export `isFounderAdmin`)
- Modify: `apps/web/lib/auth-guard.ts` (add `requireOwner`)
- Modify: `packages/core/src/spend.ts` (add `BETA_INITIAL_GRANT_CREDITS`)
- Modify: `packages/core/src/index.ts` (re-export the constant if not via `spend.js`)
- Test: `apps/web/lib/__tests__/require-owner.test.ts`

- [ ] **Step 1: Add the beta-grant constant to core**

The bootstrap grants the beta allotment. Add to `packages/core/src/spend.ts` (after the existing `INTERNAL_PER_DISPLAY` block):

```ts
/** Beta: a new org's one-time CreditAccount seed (internal credits, 1 = $0.01).
 *  1000 DISPLAYED credits = 1000 × INTERNAL_PER_DISPLAY internal. Granted idempotently
 *  in the org-bootstrap path (requireOwner + events.signIn) under key "signup:<orgId>". */
export const BETA_INITIAL_GRANT_CREDITS = 1000 * INTERNAL_PER_DISPLAY;
```

`packages/core/src/index.ts` already does `export * from "./spend.js";` (line 75), so the constant is re-exported automatically. Verify with: `grep -n "export \* from \"./spend" packages/core/src/index.ts`.

- [ ] **Step 2: Build core so the constant is importable**

Run: `pnpm --filter @fikirtive/core build`
Expected: clean build.

- [ ] **Step 3: Export `isFounderAdmin` from auth.ts**

In `apps/web/auth.ts`, change the declaration on line 46 from `function isFounderAdmin(` to:

```ts
export function isFounderAdmin(email: string | null | undefined): boolean {
```

(The body is unchanged — it reads `FOUNDER_ADMIN_EMAILS`. The internal callers on lines 119/131 keep working.)

- [ ] **Step 4: Write the failing test**

Create `apps/web/lib/__tests__/require-owner.test.ts`. This is an integration test against the LOCAL DB — it needs `AUTH_ALLOWED_EMAILS` + `FOUNDER_ADMIN_EMAILS` set and `auth()` mocked. We mock `@/auth`'s `auth()` per case but use the real `allowed`/`isFounderAdmin` + real Prisma.

```ts
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Mock only auth() (the session). allowed()/isFounderAdmin() read env, set below.
const mockAuth = vi.fn();
vi.mock("@/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth")>();
  return { ...actual, auth: mockAuth };
});

const FOUNDER_EMAIL = "founder@fikirtive.test";
const NEW_EMAIL = "merchant-a@fikirtive.test";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${FOUNDER_EMAIL},${NEW_EMAIL},offlist-but-allowed@fikirtive.test`;
  process.env.FOUNDER_ADMIN_EMAILS = FOUNDER_EMAIL;
});

afterEach(() => { mockAuth.mockReset(); });

// import AFTER the mock + env are in place
const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { FOUNDER_OWNER_ID } = await import("@fikirtive/core");

async function ensureUser(email: string): Promise<string> {
  const id = `usr_${randomUUID()}`;
  const u = await prisma.user.upsert({ where: { email }, update: {}, create: { id, email } });
  return u.id;
}

describe("requireOwner — fail-closed", () => {
  it("rejects an unauthenticated session", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await requireOwner();
    expect("error" in r).toBe(true);
  });

  it("rejects an off-allowlist email even if a session exists", async () => {
    mockAuth.mockResolvedValue({ user: { email: "stranger@evil.test" } });
    const r = await requireOwner();
    expect("error" in r).toBe(true);
  });

  it("resolves a founder-admin email to the founder org and ONLY the founder", async () => {
    await ensureUser(FOUNDER_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: FOUNDER_EMAIL } });
    const r = await requireOwner();
    expect(r).toEqual({ email: FOUNDER_EMAIL, ownerId: FOUNDER_OWNER_ID });
  });

  it("bootstraps a NEW personal org (never 'founder') for a non-founder allowlisted user", async () => {
    const userId = await ensureUser(NEW_EMAIL);
    // clean slate: no membership yet
    await prisma.membership.deleteMany({ where: { userId } });
    mockAuth.mockResolvedValue({ user: { email: NEW_EMAIL } });

    const r = await requireOwner();
    expect("error" in r).toBe(false);
    if ("error" in r) throw new Error(r.error);
    expect(r.ownerId).not.toBe(FOUNDER_OWNER_ID);     // CRITICAL: never the founder's org
    expect(r.email).toBe(NEW_EMAIL);

    // org + membership(owner) + creditAccount(beta grant) all exist
    const org = await prisma.organization.findUnique({ where: { id: r.ownerId } });
    expect(org).not.toBeNull();
    const mem = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId: r.ownerId } } });
    expect(mem?.role).toBe("owner");
    const acct = await prisma.creditAccount.findUnique({ where: { orgId: r.ownerId } });
    expect(acct?.balance).toBe(1000 * 10); // BETA_INITIAL_GRANT_CREDITS
  });

  it("is idempotent — a second call returns the same org and does not re-grant", async () => {
    const userId = await ensureUser(NEW_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: NEW_EMAIL } });
    const first = await requireOwner();
    if ("error" in first) throw new Error(first.error);
    const second = await requireOwner();
    if ("error" in second) throw new Error(second.error);
    expect(second.ownerId).toBe(first.ownerId);
    const acct = await prisma.creditAccount.findUnique({ where: { orgId: first.ownerId } });
    expect(acct?.balance).toBe(1000 * 10); // unchanged — grant idempotency held
    // exactly one signup grant ledger row
    const grants = await prisma.creditLedger.count({ where: { orgId: first.ownerId, idempotencyKey: `signup:${first.ownerId}` } });
    expect(grants).toBe(1);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @fikirtive/web test -- require-owner`
Expected: FAIL — `requireOwner is not a function` / import error (not yet implemented).

- [ ] **Step 6: Implement `requireOwner()`**

In `apps/web/lib/auth-guard.ts`, update the imports and append the resolver. The full new file head:

```ts
import "server-only";
import { auth, allowed, isFounderAdmin } from "@/auth";
import { prisma, grantCredits } from "@fikirtive/db";
import {
  newId,
  FOUNDER_OWNER_ID,
  BETA_INITIAL_GRANT_CREDITS,
  roleAllows,
  isRole,
  type Section,
  type Action,
  type Role,
} from "@fikirtive/core";
```

Then add at the end of the file:

```ts
/** P3 — the authoritative, FAIL-CLOSED session→ownerId resolver. EVERY tenant-data and
 *  spend site uses this instead of the FOUNDER_OWNER_ID constant. Contract (spec §6.3):
 *   - no session / off-allowlist  → { error } (the allowlist stays the outer invite gate)
 *   - founder-admin email         → "founder" (the ONLY path that may EVER return "founder")
 *   - any other allowlisted user  → their active org; if none, SYNCHRONOUSLY bootstrap a
 *     personal Organization + Membership(owner) + CreditAccount(beta grant), idempotently,
 *     and return the new org id
 *   - if bootstrap can't complete → { error } (NEVER fall back to "founder" or any default —
 *     that would silently hand a new user the founder's data + credits)
 *  Idempotent. Identical under next-auth and Better Auth (P4 doesn't touch it). */
export async function requireOwner(): Promise<{ email: string; ownerId: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !allowed(email)) return { error: "Not authorized." };

  // Only a founder-admin session may ever resolve to the founder org.
  if (isFounderAdmin(email)) return { email, ownerId: FOUNDER_OWNER_ID };

  // The user row exists (DB-session strategy created it at sign-in). Find their active org.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { error: "Not authorized." }; // no user row → cannot scope; fail closed

  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, deletedAt: null, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { orgId: true },
  });
  if (existing) return { email, ownerId: existing.orgId };

  // No membership yet → bootstrap a personal org synchronously.
  const ownerId = await bootstrapPersonalOrg(user.id, email);
  if (!ownerId) return { error: "Could not set up your workspace — please retry." };
  return { email, ownerId };
}

/** Create (idempotently) a personal Organization + Membership(owner) + CreditAccount with the
 *  one-time beta grant. Returns the org id, or null if it can't complete (NEVER "founder").
 *  Idempotent: re-entry reuses the existing membership/org and the grant dedupes on
 *  "signup:<orgId>". Shared by requireOwner (authoritative) and events.signIn (convergence). */
export async function bootstrapPersonalOrg(userId: string, email: string): Promise<string | null> {
  try {
    // Re-check inside (a concurrent requireOwner/signIn may have just created it).
    const already = await prisma.membership.findFirst({
      where: { userId, deletedAt: null, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { orgId: true },
    });
    if (already) return already.orgId;

    const orgId = newId(); // ULID — passes storageKey's /[^0-9A-Za-z_-]/ charset
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: orgId, name: email } });
      await tx.membership.create({ data: { id: newId(), userId, orgId, role: "owner" } });
      // carry the active org so a future multi-org switcher needs no auth-table migration
      await tx.user.update({ where: { id: userId }, data: { activeOrgId: orgId } });
    });

    // Beta grant: idempotent on "signup:<orgId>" (grantCredits opens its own tx + dedupes).
    await grantCredits({
      orgId,
      amount: BETA_INITIAL_GRANT_CREDITS,
      source: "BETA",
      reason: "beta signup grant",
      idempotencyKey: `signup:${orgId}`,
    });
    return orgId;
  } catch (e) {
    // A concurrent creator may have won the Membership @@unique([userId,orgId]) or org pk.
    // Re-read; if a membership now exists, use it. Otherwise fail closed (return null).
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const m = await prisma.membership.findFirst({
        where: { userId, deletedAt: null, status: "active" },
        orderBy: { createdAt: "asc" },
        select: { orgId: true },
      }).catch(() => null);
      if (m) return m.orgId;
    }
    console.error("bootstrapPersonalOrg failed:", e instanceof Error ? e.message : e);
    return null; // NEVER return "founder" or a default
  }
}
```

- [ ] **Step 7: Build core (the constant) + run the test**

Run: `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/web test -- require-owner`
Expected: PASS (all 6 cases), including the CRITICAL `not.toBe(FOUNDER_OWNER_ID)` and the idempotency assertions.

- [ ] **Step 8: Commit (leave for user)**

```bash
git add apps/web/auth.ts apps/web/lib/auth-guard.ts packages/core/src/spend.ts apps/web/lib/__tests__/require-owner.test.ts
git commit -m "feat(auth): fail-closed requireOwner() resolver + synchronous personal-org bootstrap (P3 §6.3)"
```

---

## Task 3: `events.signIn` bootstraps a personal org for all users (convergence path)

Spec §6.2/§7: `events.signIn` does the SAME bootstrap for ALL users, best-effort, never blocks sign-in. Correctness does NOT depend on it (Task 2's `requireOwner` is authoritative), but it converges the org early so the first request is fast. The founder branch already creates a Membership in the `"founder"` org (lines 131-139) — keep that; ADD a non-founder branch that calls `bootstrapPersonalOrg`.

**Files:**
- Modify: `apps/web/auth.ts` (`events.signIn`)

- [ ] **Step 1: Import the bootstrap helper**

Static-import from `auth-guard` would create an import cycle (`auth-guard` imports from `@/auth`). Use a dynamic import inside the event handler instead. Add nothing to the top imports.

- [ ] **Step 2: Add the non-founder bootstrap branch**

In `apps/web/auth.ts`, inside `events.signIn({ user })`, AFTER the existing founder Membership upsert block (after line 139, before the `actionEvent.create`), add:

```ts
      // closed-beta P3: converge a NON-founder's personal org early (best-effort). This is
      // ONLY a convergence path — requireOwner() is the authoritative, fail-closed resolver
      // and re-bootstraps on demand if this never ran. NEVER blocks sign-in.
      if (!isFounderAdmin(user.email) && user.id && user.email) {
        try {
          const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
          await bootstrapPersonalOrg(user.id, user.email);
        } catch (e) {
          console.warn("[auth] signIn personal-org bootstrap failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      }
```

- [ ] **Step 3: Verify there is no eager import cycle**

Run: `pnpm --filter @fikirtive/web exec tsc --noEmit -p tsconfig.json` (or the repo's typecheck script)
Expected: no circular-import / type error. The dynamic `import("@/lib/auth-guard")` defers resolution to call time, breaking the cycle.

- [ ] **Step 4: Add a signIn bootstrap test**

Append to `apps/web/lib/__tests__/require-owner.test.ts`:

```ts
describe("events.signIn convergence", () => {
  it("bootstrapPersonalOrg called directly converges the same org requireOwner would build", async () => {
    const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
    const email = `merchant-b-${randomUUID()}@fikirtive.test`;
    process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${email}`;
    const u = await prisma.user.create({ data: { id: `usr_${randomUUID()}`, email } });
    const orgId = await bootstrapPersonalOrg(u.id, email);
    expect(orgId).not.toBeNull();
    expect(orgId).not.toBe(FOUNDER_OWNER_ID);
    mockAuth.mockResolvedValue({ user: { email } });
    const r = await requireOwner();
    if ("error" in r) throw new Error(r.error);
    expect(r.ownerId).toBe(orgId); // requireOwner reuses the converged org
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @fikirtive/web test -- require-owner`
Expected: PASS (all cases incl. the new convergence one).

- [ ] **Step 6: Commit (leave for user)**

```bash
git add apps/web/auth.ts apps/web/lib/__tests__/require-owner.test.ts
git commit -m "feat(auth): events.signIn converges a personal org for non-founder users (best-effort)"
```

---

## Task 4 (Migration): Remove `@default("founder")` from all `ownerId` columns

Spec §7 + decision #8: a new business row must NEVER silently inherit the founder's owner. This is part of the irreversible flip. Drop the `@default("founder")` from all 20 `ownerId` columns in the schema, and a migration that drops the DB-level column defaults. **Local DB only — never prod.**

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (20 lines)
- Create: `packages/db/prisma/migrations/20260619140000_drop_owner_default/migration.sql`

- [ ] **Step 1: Edit the schema — drop the default on all 20 `ownerId` columns**

In `packages/db/prisma/schema.prisma`, on each of these lines remove ` @default("founder")` so the column becomes a bare `ownerId String` (keeping the `organization` relation line directly below it unchanged):

Lines: `56, 77, 108, 129, 156, 181, 214, 229, 265, 297, 321, 346, 368, 410, 628, 645, 682, 696, 728, 747`.

For example, line 56 changes from:
```prisma
  ownerId   String    @default("founder")
```
to:
```prisma
  ownerId   String
```

Verify zero remain afterward: `grep -c '@default("founder")' packages/db/prisma/schema.prisma` → expect `0`.

- [ ] **Step 2: Generate the migration SQL with `migrate diff` (matches the repo pattern)**

The repo can't `prisma migrate dev` (checksum drift forces a reset). Generate the diff against the live schema, then hand-apply. Run from `packages/db`:

```bash
pnpm --filter @fikirtive/db exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

This will not produce the drop because both sides are the new schema. Instead, hand-write the migration (the column defaults are known) — that is the authoritative source. Create `packages/db/prisma/migrations/20260619140000_drop_owner_default/migration.sql`:

```sql
-- P3: drop the ownerId column DEFAULT 'founder' on every business table so a new row
-- can never silently inherit the founder's org. The resolver (requireOwner) now supplies
-- ownerId on every insert. Irreversible behavior change (part of the multi-tenant flip).
-- Existing rows are untouched (their stored ownerId stays 'founder').
ALTER TABLE "Project"                ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Entity"                 ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "EntityVariant"          ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ReferenceImage"         ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Asset"                  ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Shot"                   ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ShotEntityRef"          ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Generation"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "TemplateBundle"         ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "RenderJob"              ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "GenJob"                 ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "RefGenJob"              ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ActionEvent"            ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "CaptionJob"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Transcript"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ModelDirective"         ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ModelRegistryOverlay"   ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ModelDirectiveRevision" ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ChatThread"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ChatMessage"            ALTER COLUMN "ownerId" DROP DEFAULT;
```

> NOTE: confirm each table↔line mapping by inspecting the model name above each of the 20 lines in `schema.prisma` before applying. The list above is the model set from those 20 lines; if a model name differs in your tree, use the actual table name (Prisma maps model → table 1:1 here, no `@@map`).

- [ ] **Step 3: Apply to the LOCAL DB**

Run from `packages/db`:

```bash
psql -v ON_ERROR_STOP=1 "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" \
  -f prisma/migrations/20260619140000_drop_owner_default/migration.sql
```

Expected: 20 `ALTER TABLE` lines, no error.

- [ ] **Step 4: Mark the migration applied + regenerate the client**

```bash
pnpm --filter @fikirtive/db exec prisma migrate resolve --applied 20260619140000_drop_owner_default
pnpm --filter @fikirtive/db exec prisma generate
pnpm --filter @fikirtive/db build
```

Expected: resolve succeeds; client regenerates; build clean.

- [ ] **Step 5: Verify the defaults are gone in the DB**

```bash
psql "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" -c \
  "SELECT table_name, column_default FROM information_schema.columns WHERE column_name='ownerId' AND column_default IS NOT NULL;"
```

Expected: **0 rows** (no `ownerId` column has a default).

- [ ] **Step 6: Commit (leave for user)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260619140000_drop_owner_default/
git commit -m "feat(db): drop ownerId @default('founder') on all business tables (P3 irreversible flip)"
```

---

## Task 5: Flip `data.ts` reads to a per-request `ownerId` parameter

This is the read path. The 10 functions in `data.ts` take `ownerId` from the module constant `FOUNDER_OWNER_ID` (imported from `./storage`). They are NOT gated themselves — their server-component callers (`studio/page.tsx`, `editor/page.tsx`) call `auth()`+`allowed()`. The cleanest per-request flip: **thread an `ownerId` parameter into every read function** and have the page call `requireOwner()` once and pass it down. (We cannot resolve inside `data.ts` per call without an `auth()` round-trip per function; one resolve-per-request in the page is correct and cheap.)

**Files:**
- Modify: `apps/web/lib/data.ts` (all 10 functions; drop the `FOUNDER_OWNER_ID` import)
- Modify: `apps/web/app/studio/page.tsx` (resolve owner, pass down)
- Modify: `apps/web/app/editor/page.tsx` (resolve owner, pass down)

- [ ] **Step 1: Convert `data.ts` — add `ownerId` params, remove the constant**

Edit `apps/web/lib/data.ts`. Remove the import on line 4 (`import { FOUNDER_OWNER_ID } from "./storage";`). Then convert each function to accept `ownerId: string` and use it. The full converted function bodies (signatures + WHERE clauses change; everything else unchanged):

```ts
export async function getGenerationThumbs(ownerId: string, ids: string[]): Promise<Record<string, { src: string; kind: "image" | "video" }>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const gens = await prisma.generation.findMany({ where: { id: { in: clean }, ownerId, deletedAt: null }, include: { asset: true } });
  const out: Record<string, { src: string; kind: "image" | "video" }> = {};
  for (const g of gens) {
    const ext = g.asset.ext.toLowerCase();
    out[g.id] = { src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)), kind: THUMB_VIDEO_EXTS.has(ext) ? "video" : "image" };
  }
  return out;
}
```

```ts
export async function ensureDefaultProject(ownerId: string) {
  const existing = await prisma.project.findFirst({
    where: { ownerId, ...notDeleted },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.project.create({
    data: { id: newId(), ownerId, name: "My First Project" },
  });
}

export async function getProjects(ownerId: string) {
  return prisma.project.findMany({
    where: { ownerId, ...notDeleted },
    orderBy: { createdAt: "asc" },
  });
}

export async function getEntities(ownerId: string) {
  return prisma.entity.findMany({
    where: { ownerId, ...notDeleted },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      referenceImages: {
        where: { ...notDeleted, variantId: null },
        orderBy: { position: "asc" },
        include: { asset: true },
      },
      variants: {
        where: notDeleted,
        orderBy: { createdAt: "asc" },
        include: {
          referenceImages: { where: notDeleted, orderBy: { position: "asc" }, include: { asset: true } },
        },
      },
      _count: { select: { shotRefs: true } },
    },
  });
}

export async function getShots(ownerId: string, projectId: string) {
  return prisma.shot.findMany({
    where: { ownerId, projectId, ...notDeleted },
    orderBy: [{ scene: "asc" }, { number: "asc" }],
    include: {
      entityRefs: { include: { entity: true } },
      generations: {
        where: notDeleted,
        orderBy: { version: "desc" },
        include: { asset: true },
      },
    },
  });
}

export async function getCandidates(ownerId: string, projectId: string) {
  return prisma.generation.findMany({
    where: { ownerId, projectId, shotId: null, threadId: null, ...notDeleted },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
}

export async function getProjectMedia(ownerId: string, projectId: string) {
  return prisma.generation.findMany({
    where: { ownerId, projectId, threadId: null, ...notDeleted },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
}

export async function getCoworkThreads(ownerId: string, projectId: string) {
  return prisma.chatThread.findMany({
    where: { projectId, ownerId, ...notDeleted },
    orderBy: { updatedAt: "desc" },
    include: { messages: { where: notDeleted, orderBy: { seq: "asc" } } },
  });
}

export async function getCoworkThread(ownerId: string, threadId: string) {
  return prisma.chatThread.findFirst({
    where: { id: threadId, ownerId, ...notDeleted },
    include: { messages: { where: notDeleted, orderBy: { seq: "asc" } } },
  });
}
```

And `resolveCoworkResultUrls` — add `ownerId` as the FIRST parameter and use it in both `findMany` WHEREs (this reads `spentUsd`, the cross-tenant cost-visibility leak the spec prioritizes):

```ts
export async function resolveCoworkResultUrls(
  ownerId: string,
  threads: { messages: { genJobId: string | null; kind: string }[] }[],
) {
  const jobIds = threads.flatMap((t) =>
    t.messages.filter((m) => m.kind === "GEN_RESULT" && m.genJobId).map((m) => m.genJobId as string),
  );
  const map = new Map<string, { urls: string[]; generationIds: string[]; spentUsd: number | null }>();
  if (!jobIds.length) return map;
  const jobs = await prisma.genJob.findMany({ where: { id: { in: jobIds }, ownerId }, select: { id: true, generationIds: true, spentUsd: true } });
  const allGenIds = jobs.flatMap((j) => j.generationIds);
  const gens = allGenIds.length
    ? await prisma.generation.findMany({ where: { id: { in: allGenIds }, ownerId }, include: { asset: true } })
    : [];
  const genById = new Map(gens.map((g) => [g.id, g]));
  for (const j of jobs) {
    const live = j.generationIds.map((gid) => genById.get(gid)).filter((g) => !!g);
    map.set(j.id, {
      urls: live.map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext))),
      generationIds: live.map((g) => g.id),
      spentUsd: j.spentUsd ?? null,
    });
  }
  return map;
}
```

Verify zero remain: `grep -c FOUNDER_OWNER_ID apps/web/lib/data.ts` → expect `0`.

- [ ] **Step 2: Update `studio/page.tsx` to resolve once and pass `ownerId` down**

In `apps/web/app/studio/page.tsx`, replace the gate + data calls. Change the import line 7 to also import `requireOwner`:

```ts
import { requireOwner } from "@/lib/auth-guard";
```

Replace lines 35-39 (the `auth()`/`allowed()` gate + first data calls) with:

```ts
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;
  const user = userBadge(session?.user?.name, session?.user?.email);
  const defaultProject = await ensureDefaultProject(ownerId);
  const [projects, entities] = await Promise.all([getProjects(ownerId), getEntities(ownerId)]);
```

> NOTE: `userBadge` needs `session`. Keep the existing `const session = await auth();` line above the gate (line 35) — `requireOwner` re-asserts independently; the page still needs `session` for the badge. So the block becomes: `const session = await auth();` (kept) then the `requireOwner` block above.

Then update every remaining `data.ts` call in the file to pass `ownerId` first:
- line 44: `getCoworkThreads(ownerId, project.id)`
- line 45: `resolveCoworkResultUrls(ownerId, threadRows)`
- line 47: `getShots(ownerId, project.id)`
- line 49: `getGenerationThumbs(ownerId, …)`
- the `getProjectMedia` / `getCandidates` calls further down: `getProjectMedia(ownerId, project.id)`, `getCandidates(ownerId, project.id)` (grep the file for each call site).

Verify: `grep -n "getProjects\|getEntities\|getShots\|getCandidates\|getProjectMedia\|getCoworkThreads\|getGenerationThumbs\|resolveCoworkResultUrls\|ensureDefaultProject" apps/web/app/studio/page.tsx` — every call passes `ownerId` as the first arg.

- [ ] **Step 3: Update `editor/page.tsx` the same way**

In `apps/web/app/editor/page.tsx`, add `import { requireOwner } from "@/lib/auth-guard";`. Replace the gate (lines 18-19) with:

```ts
  const session = await auth();
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;
```

Then update the data calls:
- line 21: `getProjects(ownerId)`
- line 25: `Promise.all([getShots(ownerId, project.id), getCandidates(ownerId, project.id)])`
- `ensureDefaultProject(ownerId)` wherever it appears.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @fikirtive/web exec tsc --noEmit`
Expected: no errors (every `data.ts` caller now passes `ownerId`; a missed call site is a TS error — that's the safety net).

- [ ] **Step 5: Commit (leave for user)**

```bash
git add apps/web/lib/data.ts apps/web/app/studio/page.tsx apps/web/app/editor/page.tsx
git commit -m "feat(web): thread per-request ownerId through data.ts reads (P3 flip)"
```

---

## Task 6: Flip `refgen-actions.ts` to the resolved owner

The representative conversion pattern for the spend/action files: each action calls `requireSession()` today; we **swap it for `requireOwner()`**, take `ownerId` from the result, and build a per-request `OWNED` from it (the module-constant `OWNED` trick can't be per-request, so each action constructs its own). Worker `reserveCredits`/`refundReservation` calls thread the resolved `ownerId` as `orgId`.

**Files:**
- Modify: `apps/web/lib/refgen-actions.ts` (21 sites)

- [ ] **Step 1: Remove the module constant + the `FOUNDER_OWNER_ID` import**

In `apps/web/lib/refgen-actions.ts`:
- Drop `FOUNDER_OWNER_ID` from the `@fikirtive/core` import (line 15).
- Delete the module constant on line 24: `const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;`
- Change the `requireSession` import (line 21) to `requireOwner`:
  ```ts
  import { requireOwner } from "./auth-guard";
  ```

- [ ] **Step 2: Convert `startRefGen` (the representative)**

Replace the gate + every `FOUNDER_OWNER_ID` / `OWNED` use in `startRefGen` with the resolved owner. The gate line becomes:

```ts
export async function startRefGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
```

Then, inside the function, every `FOUNDER_OWNER_ID` literal becomes `ownerId` and every `...OWNED` stays (now the per-request constant). Concretely:
- `const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });` — unchanged (uses the new local `OWNED`).
- the active-job `findFirst` WHERE: `ownerId,` (was `ownerId: FOUNDER_OWNER_ID,`).
- `tx.refGenJob.create({ data: { id: newId(), ownerId, entityId, … } })`.
- `await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });`
- the P2002 dupe lookup WHERE: `{ ownerId, entityId, variantId: null, status: … }`.
- the dispatch-fail refund: `await refundReservation(tx, { orgId: ownerId, refId: job.id });`
- `prisma.actionEvent.create({ data: { id: newId(), ownerId, type: "refgen.start", … } })`.

- [ ] **Step 3: Convert `setBaseAsset`**

```ts
export async function setBaseAsset(entityId: string, assetId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
```
Then the `referenceImage.findFirst` and `entity.updateMany` use `...OWNED`; the `actionEvent.create` uses `ownerId`.

- [ ] **Step 4: Convert `dispatchVariantJob` — it has no session; thread `ownerId` in as a parameter**

`dispatchVariantJob` is an internal helper called by `createVariant`/`regenerateVariant` (which DO have sessions). Add `ownerId` as the first parameter:

```ts
async function dispatchVariantJob(ownerId: string, entityId: string, variantId: string, prompt: string): Promise<{ jobId: string } | { error: string }> {
```
Inside, replace every `FOUNDER_OWNER_ID` with `ownerId` and every `reserveCredits`/`refundReservation` `orgId: FOUNDER_OWNER_ID` with `orgId: ownerId`.

- [ ] **Step 5: Convert `createVariant`, `regenerateVariant`, `renameVariant`, `deleteVariant`, `getRefGenJobs`**

Each: swap `requireSession` → `requireOwner`, add `const { ownerId } = gate;` and a local `const OWNED = { ownerId, deletedAt: null } as const;`, replace `FOUNDER_OWNER_ID` literals with `ownerId`, and pass `ownerId` as the new first arg to `dispatchVariantJob`. Examples:

```ts
export async function createVariant(entityId: string, name: string, prompt: string): Promise<{ variantId: string; jobId: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  // … (unchanged body, but: prisma.asset.findFirst({ where: { id: entity.baseAssetId, ownerId, deletedAt: null } }),
  //     entityVariant.create({ data: { … ownerId, … } }),
  //     dispatchVariantJob(ownerId, entityId, variantId, cleanPrompt),
  //     actionEvent.create({ data: { … ownerId, … } }) )
}

export async function regenerateVariant(variantId: string): Promise<{ jobId: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
  // … variant lookup uses ...OWNED; dispatchVariantJob(ownerId, variant.entityId, variantId, variant.prompt)
}

export async function getRefGenJobs(entityId: string, variantId?: string | null) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const jobs = await prisma.refGenJob.findMany({
    where: { entityId, ownerId, ...(variantId !== undefined ? { variantId } : {}) },
    orderBy: { createdAt: "desc" }, take: 3,
  });
  // … unchanged mapping
}
```

`deleteVariant`: the `$transaction` updateMany calls — `referenceImage.updateMany({ where: { variantId, ownerId, deletedAt: null }, … })`, `entityVariant.updateMany({ where: { id: variantId, ...OWNED }, … })`, and the `actionEvent.create` use `ownerId`.

- [ ] **Step 6: Verify zero `FOUNDER_OWNER_ID` remain + typecheck**

Run: `grep -c FOUNDER_OWNER_ID apps/web/lib/refgen-actions.ts` → expect `0`.
Run: `pnpm --filter @fikirtive/web exec tsc --noEmit` → no errors.

- [ ] **Step 7: Commit (leave for user)**

```bash
git add apps/web/lib/refgen-actions.ts
git commit -m "feat(web): flip refgen-actions to per-request resolved ownerId (P3)"
```

---

## Task 7: Flip `gen-actions.ts` (incl. the second-hop reads)

Spec §4 explicitly names the second-hop reads `getGenJob` / `getRecentGenResults` (they re-read `generation` by id — must be owner-scoped to the resolved owner, not the constant).

**Files:**
- Modify: `apps/web/lib/gen-actions.ts` (14 sites)

- [ ] **Step 1: Remove the module constant + import; swap the gate import**

In `apps/web/lib/gen-actions.ts`: drop `FOUNDER_OWNER_ID` from the `@fikirtive/core` import (line 14), delete the module `OWNED` (line 27), change `import { requireSession } from "./auth-guard";` → `import { requireOwner } from "./auth-guard";`.

- [ ] **Step 2: Convert `startGen`**

```ts
export async function startGen(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId, deletedAt: null } as const;
```
Then:
- `prisma.project.findFirst({ where: { id: projectId, ...OWNED } })` — uses the local `OWNED`.
- idempotency fast-path `findFirst`: `{ ownerId, projectId, idempotencyKey, status: … }`.
- `checkCast(...)` — pass `ownerId` (see Task 10 for the guardian signature change): `await checkCast({ ownerId, projectId, entityIds, … })`.
- the guardian-block `actionEvent.create`: `ownerId`.
- `tx.genJob.create({ data: { id: newId(), ownerId, projectId, … } })`.
- `await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });`
- the P2002 dupe lookup WHERE: `{ ownerId, projectId, idempotencyKey, … }`.
- the dispatch-fail refund: `await refundReservation(tx, { orgId: ownerId, refId: job.id });`
- the `queueJobId` + `gen.start` audit writes: `ownerId`.

- [ ] **Step 3: Convert `getGenJob` (second-hop read)**

```ts
export async function getGenJob(jobId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const job = await prisma.genJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) return null;
  let urls: string[] = [];
  if (job.generationIds.length) {
    const gens = await prisma.generation.findMany({
      where: { id: { in: job.generationIds }, ownerId },
      include: { asset: true },
    });
    const byId = new Map(gens.map((g) => [g.id, g]));
    urls = job.generationIds
      .map((gid) => byId.get(gid))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext)));
  }
  return { id: job.id, status: job.status, progress: job.progress, error: job.error, urls, generationIds: job.generationIds, spent: job.spent };
}
```

- [ ] **Step 4: Convert `getRecentGenResults` (second-hop read)**

```ts
export async function getRecentGenResults(projectId: string, limit = 12) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) return [];
  const jobs = await prisma.genJob.findMany({
    where: { projectId, ownerId, threadId: null },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, status: true, prompt: true, model: true, kind: true, error: true, generationIds: true },
  });
  const ids = jobs.flatMap((j) => j.generationIds);
  const gens = ids.length ? await prisma.generation.findMany({ where: { id: { in: ids }, ownerId, deletedAt: null }, include: { asset: true } }) : [];
  const byId = new Map(gens.map((g) => [g.id, g]));
  return jobs.map((j) => ({
    jobId: j.id, status: j.status, prompt: j.prompt, model: j.model,
    kind: j.kind === "VIDEO" ? ("video" as const) : ("image" as const),
    error: j.error,
    urls: j.generationIds.map((gid) => byId.get(gid)).filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext))),
  }));
}
```

- [ ] **Step 5: Verify + typecheck**

Run: `grep -c FOUNDER_OWNER_ID apps/web/lib/gen-actions.ts` → `0`.
Run: `pnpm --filter @fikirtive/web exec tsc --noEmit` → no errors (note: `cowork-actions.ts` calls `startGen` — its conversion is Task 10; until then tsc may flag the `checkCast` signature, resolved in Task 10. If running tasks in order, defer the full typecheck to after Task 10, or temporarily keep `checkCast` accepting an optional `ownerId`).

- [ ] **Step 6: Commit (leave for user)**

```bash
git add apps/web/lib/gen-actions.ts
git commit -m "feat(web): flip gen-actions + second-hop reads (getGenJob/getRecentGenResults) to resolved ownerId (P3 §4)"
```

---

## Task 8: Flip `actions.ts` — CRUD, getRenderJobs, ownedAssetFromSrc, the 2 `$executeRaw` aliases, captions

The largest file (38 sites). Same mechanical transform. Two items need EXTRA care and are called out explicitly: (a) the two `$executeRaw` aliases (grep/ESLint can't catch raw SQL — they must thread the resolved owner into the WHERE), (b) `ownedAssetFromSrc` must VERIFY the key's embedded owner against the resolved owner (not just filter the row).

**Files:**
- Modify: `apps/web/lib/actions.ts` (38 sites)

- [ ] **Step 1: Remove the module constant + the `FOUNDER_OWNER_ID` import; swap the gate import**

In `apps/web/lib/actions.ts`:
- Drop `FOUNDER_OWNER_ID` from the `./storage` import (line 24): `import { storage, extFromFilename, mimeOf } from "./storage";`
- Delete the module `OWNED` (line 43).
- Change `import { requireSession } from "./auth-guard";` → `import { requireOwner } from "./auth-guard";`
- The `logAction`, `ingestFile`, `assetUpsert` helpers currently use `FOUNDER_OWNER_ID` — thread `ownerId` into each:

```ts
async function logAction(ownerId: string, type: string, projectId: string | null, payload?: object) {
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId, projectId, type, payload: payload ?? {} },
  });
}

async function ingestFile(ownerId: string, file: File) {
  const ext = extFromFilename(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { contentHash } = await storage.put(ownerId, bytes, ext);
  return {
    contentHash,
    create: {
      id: newId(), ownerId, contentHash, ext,
      mime: file.type || mimeOf(ext),
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: file.name, source: "UPLOAD" as const,
    },
  };
}

function assetUpsert(ownerId: string, ingested: Awaited<ReturnType<typeof ingestFile>>) {
  return prisma.asset.upsert({
    where: { ownerId_contentHash: { ownerId, contentHash: ingested.contentHash } },
    update: { deletedAt: null },
    create: ingested.create,
  });
}
```

- [ ] **Step 2: Convert every exported action — the uniform transform**

For each of the ~20 exported actions (`createProject`, `deleteProject`, `createEntity`, `updateEntity`, `addEntityAlias`, `removeEntityAlias`, `softDeleteReferenceImage`, `addReferenceImages`, `softDeleteEntity`, `createShot`, `saveShotPrompt`, `updateShotTitle`, `updateShotStatus`, `softDeleteShot`, `uploadCandidates`, `uploadReference`, `attachGeneration`, `detachGeneration`, `deleteGeneration`, `saveProjectEdit`, `addSegmentToCut`, `startRender`, `getRenderJobs`, `startCaption`, `getCaptionJob`, `getTranscript`, `softDeleteGeneration`, `getEditorMedia`):

1. `const gate = await requireOwner(); if ("error" in gate) return gate;` (or `throw new Error(gate.error)` for the read-only `get*` ones that throw).
2. `const { ownerId } = gate;`
3. `const OWNED = { ownerId, deletedAt: null } as const;` (where the function used `...OWNED`).
4. Replace `FOUNDER_OWNER_ID` literals with `ownerId`.
5. `logAction(...)` calls → `logAction(ownerId, ...)`; `ingestFile(file)` → `ingestFile(ownerId, file)`; `assetUpsert(x)` → `assetUpsert(ownerId, x)`.

Example (`createProject`):
```ts
export async function createProject(name: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.create({
    data: { id: newId(), ownerId, name: name.trim() || "Untitled Project" },
  });
  await logAction(ownerId, "project.create", project.id, { name: project.name });
  revalidatePath("/", "layout");
  return { id: project.id };
}
```

- [ ] **Step 3: The 2 `$executeRaw` aliases (EXPLICIT — grep/ESLint can't catch raw SQL)**

`addEntityAlias` (was line 181) and `removeEntityAlias` (was line 192): thread the resolved `ownerId` into the WHERE. After `const { ownerId } = gate;`:

```ts
// addEntityAlias
await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${clean}) WHERE "id" = ${entityId} AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL AND NOT (${clean} = ANY("aliases"))`;
```

```ts
// removeEntityAlias
await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_remove("aliases", ${alias}) WHERE "id" = ${entityId} AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL`;
```

(The `entity.findFirst({ where: { id: entityId, ...OWNED } })` guard above each already re-checks ownership; the raw WHERE is the atomic write's own owner clause — both must carry the resolved `ownerId`.)

- [ ] **Step 4: `ownedAssetFromSrc` — VERIFY the key's owner against the resolved owner**

This helper currently takes no owner and uses the constant. Make it take `ownerId` and verify the key's embedded owner matches (spec §4: "must verify the key's `ownerId` matches the caller's — not just filter the row"):

```ts
async function ownedAssetFromSrc(ownerId: string, src: string): Promise<{ id: string; contentHash: string } | null> {
  let contentHash: string;
  try {
    const key = srcToStorageKey(src);
    if (!keyOwnerMatches(key, ownerId)) return null; // forged/other-owner src
    contentHash = parseStorageKey(key).contentHash;
  } catch {
    return null;
  }
  const asset = await prisma.asset.findFirst({
    where: { ownerId, contentHash, deletedAt: null },
    select: { id: true, contentHash: true },
  });
  return asset;
}
```

Update its 2 callers: `startCaption` → `ownedAssetFromSrc(ownerId, src)`, `getTranscript` → `ownedAssetFromSrc(ownerId, src)`. In `getTranscript`, the `transcript.findUnique` stays global-content-addressed-but-gated (the spec accepts P0's decision to leave the Transcript cache global + owner-gated via `ownedAssetFromSrc`; no schema change in P3).

- [ ] **Step 5: `getRenderJobs`**

```ts
export async function getRenderJobs(projectId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const jobs = await prisma.renderJob.findMany({
    where: { projectId, ownerId },
    orderBy: { createdAt: "desc" }, take: 5,
  });
  const assetIds = jobs.map((j) => j.outputAssetId).filter((x): x is string => !!x);
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds }, ownerId } });
  // … unchanged mapping
}
```

- [ ] **Step 6: Verify + typecheck**

Run: `grep -c FOUNDER_OWNER_ID apps/web/lib/actions.ts` → `0`.
Run: `pnpm --filter @fikirtive/web exec tsc --noEmit` → no errors.

- [ ] **Step 7: Commit (leave for user)**

```bash
git add apps/web/lib/actions.ts
git commit -m "feat(web): flip actions.ts (CRUD + 2 \$executeRaw aliases + ownedAssetFromSrc key-owner check + captions) to resolved ownerId (P3 §4)"
```

---

## Task 9: Flip `upload-actions.ts` (direct upload/finalize paths)

Direct R2 multipart upload + finalize. `storageKey(FOUNDER_OWNER_ID, …)` becomes `storageKey(ownerId, …)` — critical: a presigned PUT URL must be namespaced to the caller's org so two orgs with the same content hash can't collide or cross-write.

**Files:**
- Modify: `apps/web/lib/upload-actions.ts` (11 sites)

- [ ] **Step 1: Remove the constant + swap the gate import**

In `apps/web/lib/upload-actions.ts`: drop `FOUNDER_OWNER_ID` from the `@/lib/storage` import (line 33), delete the module `OWNED` (line 38), change `requireSession` → `requireOwner`.

- [ ] **Step 2: Convert each action**

```ts
export async function authorizeUpload(raw: unknown): Promise<AuthorizeUploadResult | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  // … parse sha256/ext …
  const key = storageKey(ownerId, sha256, ext);
  // … unchanged
}

export async function signUploadPart(raw: unknown): Promise<{ url: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const key = storageKey(ownerId, sha256, ext);
  // … unchanged
}

export async function abortDirectUpload(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  await storage.abortMultipart(storageKey(ownerId, sha256, ext), uploadId);
  // … unchanged
}

export async function finalizeCandidateUploads(/* … */) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const OWNED = { ownerId };
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  // … then every storageKey(FOUNDER_OWNER_ID, …) → storageKey(ownerId, …);
  //     asset.count({ where: { ownerId, contentHash: file.sha256, deletedAt: null } });
  //     asset upsert where: { ownerId_contentHash: { ownerId, contentHash: file.sha256 } };
  //     generation/referenceImage creates: ownerId
}
```

- [ ] **Step 3: Verify + typecheck**

Run: `grep -c FOUNDER_OWNER_ID apps/web/lib/upload-actions.ts` → `0`; `pnpm --filter @fikirtive/web exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit (leave for user)**

```bash
git add apps/web/lib/upload-actions.ts
git commit -m "feat(web): flip upload-actions (direct upload/finalize) to resolved ownerId (P3)"
```

---

## Task 10: Flip `cowork-actions.ts` + `cowork-guardian.ts`

Cowork is the largest behavioral surface (23 + 4 sites). `coworkGenerate` funnels through `startGen` (already flipped in Task 7) — but its own pre-reads (`assetBytes`, card lookup, thread lookup) must resolve the owner. `checkCast` (guardian) takes `ownerId` as a parameter (it has no session — `startGen` and `coworkTurn` pass theirs).

**Files:**
- Modify: `apps/web/lib/cowork-actions.ts` (23 sites)
- Modify: `apps/web/lib/cowork-guardian.ts` (4 sites)

- [ ] **Step 1: Convert `cowork-guardian.ts` — `checkCast` takes `ownerId`**

In `apps/web/lib/cowork-guardian.ts`: drop `FOUNDER_OWNER_ID` from the `@fikirtive/core` import (line 13). Change the signature to accept `ownerId`:

```ts
export async function checkCast(req: {
  ownerId: string;
  projectId: string;
  entityIds: string[];
  variantSel?: Record<string, string> | undefined;
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  model: string;
  kind: string;
}): Promise<…> {
  // … inside, every `ownerId: FOUNDER_OWNER_ID` → `ownerId: req.ownerId`:
  //   entityVariant.findFirst({ where: { id: variantId, entityId, ownerId: req.ownerId, deletedAt: null } })
  //   entity.findMany({ where: { id: { in: req.entityIds }, ownerId: req.ownerId, deletedAt: null } })
  //   generation.findFirst({ where: { id, ownerId: req.ownerId, projectId: req.projectId, deletedAt: null, asset: { ext: { in: IMG_EXTS } } } })
}
```

(Task 7 already updated `startGen`'s call to `checkCast({ ownerId, projectId, … })`.)

- [ ] **Step 2: Convert `cowork-actions.ts` — remove the constant, swap the gate**

Drop `FOUNDER_OWNER_ID` from the `@fikirtive/core` import (line 12), delete the module `OWNED` (line 30), change `requireSession` → `requireOwner`.

- [ ] **Step 3: `assetBytes` (helper, no session) — take `ownerId`**

```ts
async function assetBytes(ownerId: string, assetId: string): Promise<…> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId, deletedAt: null },
    select: { ownerId: true, contentHash: true, ext: true, sizeBytes: true },
  });
  // … unchanged
}
```
Update its caller(s) inside `coworkTurn` to `assetBytes(ownerId, …)`.

- [ ] **Step 4: Convert each exported cowork action**

`coworkDraftStoryboard`, `enhancePrompt`, `coworkTurn`, `coworkGenerate`, `coworkRenameThread`, `coworkDeleteThread`: each gets `const gate = await requireOwner(); if ("error" in gate) return gate; const { ownerId } = gate; const OWNED = { ownerId, deletedAt: null } as const;` and every `FOUNDER_OWNER_ID` literal → `ownerId`. Specifically for `coworkGenerate` (lines ~464-476):

```ts
export async function coworkGenerate(raw: unknown): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  // … card lookup:
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "GEN_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, genJobId: true, thread: { select: { projectId: true, deletedAt: true, ownerId: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return { error: "Card not found." };
  // … the friendly fast-path dedupe read:
  //   prisma.genJob.findFirst({ where: { ownerId, idempotencyKey: `cowork:${cardId}` }, … })
  // … startGen(req) is unchanged (it resolves its OWN owner via requireOwner — same session,
  //   so the same ownerId; the cowork:<cardId> idempotency key keeps it exactly-once).
}
```

`coworkTurn`: every `...OWNED`, every `ownerId: FOUNDER_OWNER_ID` in the chatThread/chatMessage/entity/generation reads + the message-batch `create` array (the `ChatMessage` rows on lines ~413-422) + the `actionEvent.create` + the `project.updateMany` brief write + the entity `descriptionJson` see-once update → `ownerId`. The `checkCast`-style propose-gate generation lookups also use `ownerId`.

- [ ] **Step 5: Verify + typecheck**

Run: `grep -c FOUNDER_OWNER_ID apps/web/lib/cowork-actions.ts apps/web/lib/cowork-guardian.ts` → both `0`.
Run: `pnpm --filter @fikirtive/web exec tsc --noEmit` → clean (this is the run where the Task 7 `checkCast` call type-resolves against the new signature).

- [ ] **Step 6: Commit (leave for user)**

```bash
git add apps/web/lib/cowork-actions.ts apps/web/lib/cowork-guardian.ts
git commit -m "feat(web): flip cowork-actions + guardian checkCast to resolved ownerId (P3)"
```

---

## Task 11: Flip `studio-actions.ts` + `entity-snapshot.ts`

The remaining two tenant-data files (4 + 2 sites).

**Files:**
- Modify: `apps/web/lib/studio-actions.ts` (4 sites)
- Modify: `apps/web/lib/entity-snapshot.ts` (2 sites)

- [ ] **Step 1: Inspect both files first**

Run: `grep -n "FOUNDER_OWNER_ID\|requireSession\|requireOwner\|export\|ownerId\|OWNED" apps/web/lib/studio-actions.ts apps/web/lib/entity-snapshot.ts`
Confirm whether each is a session-gated action (→ `requireOwner` + local `ownerId`) or an internal helper called by an already-gated action (→ add an `ownerId` parameter). `entity-snapshot.ts`'s `buildEntitySnapshot` is a helper called from `actions.ts`/`refgen` — give it an `ownerId` parameter.

- [ ] **Step 2: Convert `studio-actions.ts`**

For each exported action: `const gate = await requireOwner(); if ("error" in gate) return gate; const { ownerId } = gate;` and replace `FOUNDER_OWNER_ID` with `ownerId` (and pass `ownerId` to `buildEntitySnapshot` if it calls it).

- [ ] **Step 3: Convert `entity-snapshot.ts` — add `ownerId` param to `buildEntitySnapshot`**

```ts
export async function buildEntitySnapshot(ownerId: string, /* …existing params… */) {
  // … every FOUNDER_OWNER_ID → ownerId in the entity/referenceImage/asset reads
}
```
Then update its callers (in `actions.ts`, `refgen-actions.ts`, `studio-actions.ts`) to pass `ownerId` first. Grep callers: `grep -rn "buildEntitySnapshot" apps/web/lib/`.

- [ ] **Step 4: Verify + typecheck**

Run: `grep -c FOUNDER_OWNER_ID apps/web/lib/studio-actions.ts apps/web/lib/entity-snapshot.ts` → both `0`.
Run: `pnpm --filter @fikirtive/web exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit (leave for user)**

```bash
git add apps/web/lib/studio-actions.ts apps/web/lib/entity-snapshot.ts
git commit -m "feat(web): flip studio-actions + entity-snapshot to resolved ownerId (P3)"
```

---

## Task 12 (TDD): The `/files` route owner check (storage-layer IDOR fix)

Spec §4 Codex BLOCKER: `/files/[...key]` only checks `allowed(email)` and serves the requested key without comparing the key's embedded owner to the session org. P0 added a constant comparison; P3 swaps it for the resolved owner.

**Files:**
- Modify: `apps/web/app/files/[...key]/route.ts` (3 sites)
- Test: `apps/web/lib/__tests__/isolation.test.ts` (the `/files` assertions land in Task 15; here we add a focused route test)

- [ ] **Step 1: Write a failing route test**

Add `apps/web/app/files/__tests__/route.test.ts` (mock `auth`, `allowed`, `requireOwner`, and `storage`):

```ts
import { describe, it, expect, vi } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { email: "a@test" } }), allowed: () => true }));
vi.mock("@/lib/storage", () => ({
  storage: { presignedGet: vi.fn().mockResolvedValue(null), get: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) },
  mimeOf: () => "image/png", kindOf: () => "image",
}));

const { GET } = await import("@/app/files/[...key]/route");
const HASH = "a".repeat(64);

function reqFor(): any { return { headers: { get: () => null }, url: "http://x/files" }; }

describe("/files route — cross-tenant guard", () => {
  it("404s when the key's owner != the resolved owner", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    const res = await GET(reqFor(), { params: Promise.resolve({ key: ["u", "orgB", `${HASH}.png`] }) });
    expect(res.status).toBe(404);
  });
  it("serves when the key's owner == the resolved owner", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    const res = await GET(reqFor(), { params: Promise.resolve({ key: ["u", "orgA", `${HASH}.png`] }) });
    expect(res.status).toBe(200);
  });
  it("redirects to /login when requireOwner returns an error", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await GET(reqFor(), { params: Promise.resolve({ key: ["u", "orgA", `${HASH}.png`] }) });
    expect([302, 404]).toContain(res.status); // either redirect or 404 is acceptable fail-closed
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @fikirtive/web test -- files`
Expected: FAIL (route still uses `FOUNDER_OWNER_ID`, doesn't call `requireOwner`).

- [ ] **Step 3: Implement the route change**

In `apps/web/app/files/[...key]/route.ts`, change the imports (line 2 drops `FOUNDER_OWNER_ID` from `@/lib/storage`; add `requireOwner`):

```ts
import { storage, mimeOf, kindOf } from "@/lib/storage";
import { parseStorageKey, keyOwnerMatches } from "@fikirtive/core";
import { auth, allowed } from "@/auth";
import { requireOwner } from "@/lib/auth-guard";
```

Replace the gate + owner check (lines 15-25) with:

```ts
  const session = await auth();
  if (!allowed(session?.user?.email)) {
    return NextResponse.redirect(new URL("/login", req.url), { status: 302 });
  }
  // P3: resolve the caller's org and reject any key not in their namespace.
  const owner = await requireOwner();
  if ("error" in owner) {
    return NextResponse.redirect(new URL("/login", req.url), { status: 302 });
  }
  const { key } = await ctx.params; // Next 16: params are async
  const joined = key.join("/");
  // Cross-tenant guard: the key's owner namespace must match the resolved owner.
  if (!keyOwnerMatches(joined, owner.ownerId)) {
    return new NextResponse("Not found", { status: 404 });
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @fikirtive/web test -- files`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit (leave for user)**

```bash
git add "apps/web/app/files/[...key]/route.ts" apps/web/app/files/__tests__/route.test.ts
git commit -m "fix(web): /files route rejects cross-tenant keys via requireOwner (P3 §4 IDOR)"
```

---

## Task 13: Admin reads stay platform-wide / founder-stamped (excluded from tenant scoping)

Spec §4 + decision #4: `/admin/*` aggregate across the WHOLE platform, gated by `User.role` (requireRole). They must NOT be silently rewritten to session-org scope. Two sub-cases, decided per site below:
- **Platform-config writes** (`admin-actions.ts`, `app/admin/models`, `app/admin/credits`, `app/admin/audit`): these write/read founder-org-stamped CONFIG/audit rows (`ModelDirective`, `ModelRegistryOverlay`, `RuntimeConfig`, `ActionEvent`, founder `CreditAccount`). **Keep them founder-stamped** — the audit log stays stamped to the acting context (the founder org for platform-admin actions), per the spec's recommendation. NO change.
- **Operational dashboards that today filter by `ownerId: FOUNDER_OWNER_ID`** (`app/admin/system`, `app/admin/cost`, `app/admin/content`): post-flip these should aggregate **platform-wide** (drop the owner filter) so an admin sees ALL orgs' jobs/spend/content, not just the founder's.

**Files:**
- Modify: `apps/web/app/admin/system/page.tsx` (9 sites → drop owner filter)
- Modify: `apps/web/app/admin/cost/page.tsx` (3 sites → drop owner filter)
- Modify: `apps/web/app/admin/content/page.tsx` (3 sites → drop owner filter)
- NO change: `apps/web/lib/admin-actions.ts`, `lib/credit-actions.ts`, `app/admin/models/page.tsx`, `app/admin/credits/page.tsx`, `app/admin/audit/page.tsx` (founder-stamped config/audit by design)

- [ ] **Step 1: `app/admin/system/page.tsx` — drop the owner filter (platform-wide)**

Confirm the page is `requireRole`-gated (it reads platform health). Remove `ownerId: FOUNDER_OWNER_ID,` from each of the 6 query WHEREs (the 3 `groupBy`, the 3 FAILED `findMany`, the 2 `aggregate`) and drop the `FOUNDER_OWNER_ID` import. Each becomes, e.g.:

```ts
prisma.genJob.groupBy({ by: ["status"], _count: { _all: true } }),
prisma.genJob.findMany({ where: { status: "FAILED" }, /* …unchanged select/orderBy/take… */ }),
prisma.genJob.aggregate({ where: { spentUsd: { not: null }, finishedAt: { gte: todayStart } }, _sum: { spentUsd: true } }),
```

> Verify the page IS gated by `requireRole` (super-admin/ops) before dropping the filter — platform-wide reads MUST be staff-gated. If the page currently gates only with `allowed()`, ADD a `requireRole("model","read")` (or the appropriate section) gate in the same edit. Inspect the top of the file: `grep -n "requireRole\|allowed\|auth()" apps/web/app/admin/system/page.tsx`.

- [ ] **Step 2: `app/admin/cost/page.tsx` — platform-wide**

Drop `ownerId: FOUNDER_OWNER_ID,` from both `findMany` WHEREs (genJob + refGenJob) and the `FOUNDER_OWNER_ID` import. Confirm/keep the `requireRole("cost","read")` gate.

- [ ] **Step 3: `app/admin/content/page.tsx` — platform-wide**

Drop `ownerId: FOUNDER_OWNER_ID,` from the `generation.findMany` and the `actionEvent.findMany` WHEREs and the import. Confirm/keep the staff gate.

- [ ] **Step 4: Confirm the no-change sites stay founder-stamped (documentation step)**

No edits. Add a one-line code comment at the top of `admin-actions.ts` (it already says "Single-tenant…"; update to):

```ts
 * P3: admin actions write PLATFORM CONFIG + audit stamped to the FOUNDER org (the acting
 * context for platform staff). They are cross-tenant by design and EXCLUDED from the
 * requireOwner() tenant scoping — gated by User.role (requireRole), never Membership.role.
```

(Editing only the comment header; the FOUNDER_OWNER_ID config stamps STAY.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @fikirtive/web exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit (leave for user)**

```bash
git add apps/web/app/admin/system/page.tsx apps/web/app/admin/cost/page.tsx apps/web/app/admin/content/page.tsx apps/web/lib/admin-actions.ts
git commit -m "feat(web): admin dashboards go platform-wide; config/audit stay founder-stamped (P3 §4)"
```

---

## Task 14 (TDD): Prisma client-extension backstop

Spec §4: a cheap query extension asserting tenant-table reads carry an `ownerId` filter. Best-effort with documented blind spots (raw SQL, nested writes, `findUnique`-by-unique-key) owned by the explicit filters + the isolation test. **Additive and non-breaking** — it must not change query results, only warn/throw on a clearly-unscoped tenant read in development/test.

**Files:**
- Create: `packages/db/src/tenant-guard.ts`
- Modify: `packages/db/src/index.ts` (apply the extension to the client)
- Test: `packages/core` has no Prisma; test the extension via `apps/web` Vitest against the local DB.

- [ ] **Step 1: Write the guard module**

Create `packages/db/src/tenant-guard.ts`:

```ts
import { Prisma } from "../generated/prisma/client.js";

/** The owner-scoped models. findMany/findFirst/updateMany/deleteMany on these MUST carry an
 *  ownerId filter (the repository convention). This extension is a BACKSTOP, not the sole
 *  guarantee — documented blind spots (raw SQL, nested writes, findUnique-by-unique-key,
 *  aggregate/groupBy) are owned by the explicit filters + the 2-org isolation test. */
const TENANT_MODELS = new Set([
  "Project", "Entity", "EntityVariant", "ReferenceImage", "Asset", "Shot", "ShotEntityRef",
  "Generation", "RenderJob", "GenJob", "RefGenJob", "ChatThread", "ChatMessage",
]);

// Operations we check (those that take a `where`). findUnique is exempt (unique-key access),
// aggregate/groupBy/count are exempt (admin platform-wide reads use them intentionally).
const CHECKED_OPS = new Set(["findMany", "findFirst", "updateMany", "deleteMany"]);

function whereHasOwnerId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  if ("ownerId" in (where as Record<string, unknown>)) return true;
  // allow ownerId nested under a top-level AND
  const and = (where as { AND?: unknown }).AND;
  if (Array.isArray(and)) return and.some((c) => whereHasOwnerId(c));
  return false;
}

/** Apply to the PrismaClient. In production it WARNS (never throws — a false positive must
 *  not 500 a live request); under test it THROWS so the isolation suite catches an unscoped
 *  query. Result shape is never modified. */
export function withTenantGuard<T extends object>(client: T): T {
  const strict = process.env.NODE_ENV === "test";
  return (client as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (TENANT_MODELS.has(model) && CHECKED_OPS.has(operation) && !whereHasOwnerId(args?.where)) {
            const msg = `[tenant-guard] ${model}.${operation} has no ownerId filter — possible cross-tenant leak`;
            if (strict) throw new Error(msg);
            console.warn(msg);
          }
          return query(args);
        },
      },
    },
  }) as T;
}
```

- [ ] **Step 2: Wire it into the client (non-breaking)**

In `packages/db/src/index.ts`, wrap the built client. Change `buildClient()` to return the guarded client:

```ts
import { withTenantGuard } from "./tenant-guard.js";
// … inside buildClient(), after `return new PrismaClient({ adapter });` becomes:
  return withTenantGuard(new PrismaClient({ adapter }));
```

> Verify `$extends` returns a type assignable to `PrismaClient` for the existing `prisma: PrismaClient` proxy. If TS complains, type `buildClient(): PrismaClient` is preserved by the `as T` cast in `withTenantGuard`. Run a build to confirm.

- [ ] **Step 3: Write a guard test (apps/web Vitest, local DB)**

Add `apps/web/lib/__tests__/tenant-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
const { prisma } = await import("@fikirtive/db");

describe("tenant-guard backstop (NODE_ENV=test → throws)", () => {
  it("throws on a tenant findMany with no ownerId filter", async () => {
    await expect(prisma.project.findMany({ where: { name: "x" } })).rejects.toThrow(/tenant-guard/);
  });
  it("allows a tenant findMany WITH an ownerId filter", async () => {
    await expect(prisma.project.findMany({ where: { ownerId: "founder" } })).resolves.toBeDefined();
  });
  it("exempts findUnique / aggregate (admin + unique-key access)", async () => {
    await expect(prisma.genJob.aggregate({ _count: { _all: true } })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fikirtive/db build && pnpm --filter @fikirtive/web test -- tenant-guard`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit (leave for user)**

```bash
git add packages/db/src/tenant-guard.ts packages/db/src/index.ts apps/web/lib/__tests__/tenant-guard.test.ts
git commit -m "feat(db): Prisma client-extension backstop asserting tenant reads carry ownerId (P3 §4)"
```

---

## Task 15 (TDD): The 2-org isolation test (the proof the flip is leak-free)

Spec §4 + §8: seed org A + org B with their own projects/assets/generations/credits/threads; assert org B's session gets `[]`/`null`/throws for every one of A's ids across the repo/action surface (projects, shots, assets, generations, gen/refgen jobs, credits balance, cost visibility, threads, AND the `/files` route). This ships WITH the flip — it is the gate's proof.

**Files:**
- Test: `apps/web/lib/__tests__/isolation.test.ts`

- [ ] **Step 1: Write the isolation test (seed two orgs, assert B can't read A)**

Create `apps/web/lib/__tests__/isolation.test.ts`. It mocks `auth()` to switch between org A's and org B's sessions and drives the REAL server actions + `data.ts` reads:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth")>();
  return { ...actual, auth: mockAuth };
});

const A_EMAIL = `orgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `orgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test"; // neither A nor B is founder
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma, grantCredits } = await import("@fikirtive/db");
const data = await import("@/lib/data");
const gen = await import("@/lib/gen-actions");
const refgen = await import("@/lib/refgen-actions");
const { GET: filesGET } = await import("@/app/files/[...key]/route");
const { storageKey } = await import("@fikirtive/core");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA: string, orgB: string;
let aProjectId: string, aGenJobId: string, aGenerationId: string, aAssetHash: string, aThreadId: string, aRefGenJobId: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  // seed org A's data directly (bypass actions for setup speed; the assertions use the real read path)
  aProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: "A project" } });
  aAssetHash = "a".repeat(64);
  const asset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  aGenJobId = `gj_${randomUUID()}`;
  const generation = await prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgA, projectId: aProjectId, assetId: asset.id, prompt: "x", model: "seedream", version: 1 } });
  aGenerationId = generation.id;
  await prisma.genJob.create({ data: { id: aGenJobId, ownerId: orgA, projectId: aProjectId, prompt: "x", model: "seedream", kind: "IMAGE", count: 1, status: "DONE", generationIds: [aGenerationId], spentUsd: 0.04, finishedAt: new Date() } });
  const thread = await prisma.chatThread.create({ data: { id: `ct_${randomUUID()}`, ownerId: orgA, projectId: aProjectId, title: "A thread" } });
  aThreadId = thread.id;
  aRefGenJobId = `rg_${randomUUID()}`;
  const entity = await prisma.entity.create({ data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "A", type: "CHARACTER" } });
  await prisma.refGenJob.create({ data: { id: aRefGenJobId, ownerId: orgA, entityId: entity.id, prompt: "x", model: "seedream", mode: "BASE", count: 1, status: "DONE" } });
});

describe("2-org isolation — org B can never read org A", () => {
  it("projects: B's getProjects excludes A's project", async () => {
    const projects = await data.getProjects(orgB);
    expect(projects.some((p) => p.id === aProjectId)).toBe(false);
  });
  it("shots: B's getShots on A's project id returns []", async () => {
    expect(await data.getShots(orgB, aProjectId)).toEqual([]);
  });
  it("candidates/media: B's reads on A's project return []", async () => {
    expect(await data.getCandidates(orgB, aProjectId)).toEqual([]);
    expect(await data.getProjectMedia(orgB, aProjectId)).toEqual([]);
  });
  it("threads: B's getCoworkThread on A's thread id is null", async () => {
    expect(await data.getCoworkThread(orgB, aThreadId)).toBeNull();
  });
  it("cost visibility: B's resolveCoworkResultUrls cannot read A's spentUsd", async () => {
    const fakeThreads = [{ messages: [{ kind: "GEN_RESULT", genJobId: aGenJobId }] }];
    const map = await data.resolveCoworkResultUrls(orgB, fakeThreads);
    expect(map.has(aGenJobId)).toBe(false); // A's job (with its spentUsd) is invisible to B
  });
  it("gen second-hop: B's getGenJob on A's job id is null", async () => {
    await asUser(B_EMAIL);
    expect(await gen.getGenJob(aGenJobId)).toBeNull();
  });
  it("gen second-hop: B's getRecentGenResults on A's project is []", async () => {
    await asUser(B_EMAIL);
    expect(await gen.getRecentGenResults(aProjectId)).toEqual([]);
  });
  it("refgen: B's getRefGenJobs cannot see A's refgen job", async () => {
    await asUser(B_EMAIL);
    const entityOfA = (await prisma.refGenJob.findUnique({ where: { id: aRefGenJobId }, select: { entityId: true } }))!.entityId;
    const jobs = await refgen.getRefGenJobs(entityOfA);
    expect(jobs.some((j) => j.id === aRefGenJobId)).toBe(false);
  });
  it("credits: B's balance is its own beta grant, not A's", async () => {
    const acctA = await prisma.creditAccount.findUnique({ where: { orgId: orgA } });
    const acctB = await prisma.creditAccount.findUnique({ where: { orgId: orgB } });
    expect(acctA?.orgId).toBe(orgA);
    expect(acctB?.orgId).toBe(orgB);
    expect(acctA?.orgId).not.toBe(acctB?.orgId);
  });
  it("/files: B cannot fetch A's blob by key (404)", async () => {
    await asUser(B_EMAIL);
    const key = storageKey(orgA, aAssetHash, "png").split("/"); // ["u", orgA, "<hash>.png"]
    const res = await filesGET({ headers: { get: () => null }, url: "http://x/files" } as any, { params: Promise.resolve({ key }) });
    expect(res.status).toBe(404);
  });
  it("/files: A CAN fetch A's blob (control — proves the test isn't vacuously 404ing)", async () => {
    await asUser(A_EMAIL);
    const key = storageKey(orgA, aAssetHash, "png").split("/");
    // storage.get will throw (no real blob on disk) → route returns 404 via its catch, NOT the
    // owner guard. Assert the owner guard PASSED by checking keyOwnerMatches directly instead:
    const { keyOwnerMatches } = await import("@fikirtive/core");
    expect(keyOwnerMatches(key.join("/"), orgA)).toBe(true);
  });
});

afterAll(async () => {
  // best-effort cleanup of the seeded org-A rows (ON DELETE RESTRICT means order matters)
  await prisma.genJob.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.refGenJob.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.generation.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.chatThread.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.referenceImage.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.entity.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.asset.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.project.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
});
```

> NOTE: confirm the exact required scalar columns for `Generation`/`GenJob`/`RefGenJob`/`Asset` creates against the current schema before running (e.g. whether `version`, `mime`, `source` are required) — adjust the seed `data` to satisfy NOT NULLs. Run `psql … -c '\d "Generation"'` etc. if a create throws a missing-column error.

- [ ] **Step 2: Run the isolation test**

Run: `pnpm --filter @fikirtive/web test -- isolation`
Expected: PASS — every "B can't read A" assertion holds, plus the `/files` 404 and the A-control. A FAIL here is a real cross-tenant leak — STOP and fix the offending flip site before proceeding.

- [ ] **Step 3: Run the full apps/web suite + the typecheck**

Run: `pnpm --filter @fikirtive/web test && pnpm --filter @fikirtive/web exec tsc --noEmit`
Expected: all green; no `FOUNDER_OWNER_ID` leaks in tenant-data files (`grep -rn FOUNDER_OWNER_ID apps/web/lib/{data,actions,gen-actions,refgen-actions,upload-actions,cowork-actions,cowork-guardian,studio-actions,entity-snapshot}.ts` → no matches).

- [ ] **Step 4: Commit (leave for user)**

```bash
git add apps/web/lib/__tests__/isolation.test.ts
git commit -m "test(web): 2-org isolation test — org B cannot read A across data/spend/cost/files (P3 §4,§8)"
```

---

## Task 16 (Verification only): Confirm worker + cowork-LLM are already correct

No code change — two confirmations the flip checklist requires.

**Files:** none modified (read-only verification).

- [ ] **Step 1: Confirm the worker uses `job.ownerId`, never a constant for tenant data**

Run: `grep -rn "FOUNDER_OWNER_ID\|ownerId" apps/worker/src/jobs/*.ts apps/worker/src/model-registry.ts | grep -v "job.ownerId"`
Expected: the only `FOUNDER_OWNER_ID` uses are in `model-registry.ts` (the `ModelRegistryOverlay` config read — platform config, scoped to the founder org by design, NOT tenant data). All spend/settle/refund/store paths read `job.ownerId` from the persisted row. Confirm `settleCredits`/`refundReservation` in `gen.ts`/`refgen.ts` pass `orgId: job.ownerId`:
```bash
grep -n "orgId:" apps/worker/src/jobs/gen.ts apps/worker/src/jobs/refgen.ts
```
Expected: every credit call uses `job.ownerId`. **No worker change needed.**

- [ ] **Step 2: Confirm the effective cowork planner is `$0` (credits fully cap fal spend)**

This was a P0 deliverable; re-assert it survived. Check the effective provider (DB `runtimeConfig.cowork_provider` OVERRIDES the `COWORK_PROVIDER` env):
```bash
psql "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" -c \
  "SELECT key, \"valueJson\" FROM \"RuntimeConfig\" WHERE key='cowork_provider';"
echo "COWORK_PROVIDER env = $COWORK_PROVIDER"
```
Expected: the effective provider is `mock` (or a self-hosted/free planner). If it is `fal`, STOP — re-close the un-capped cowork-LLM hole (spec §5.7) before the flip ships. Document the finding in the gate notes.

- [ ] **Step 3: No commit (verification only).**

---

## Task 17 (Gate): Double gate + STOP for deploy confirmation

P3 is the highest-radius change (security/tenancy + spend sites touched). Run the full gate, fix all confirmed BLOCKER/STRONG, then STOP. **The flip is the point of no return — do NOT deploy.**

**Files:** any follow-up fixes land in their owning file from Tasks 2-15.

- [ ] **Step 1: Full local verification sweep**

```bash
pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build
pnpm --filter @fikirtive/web exec tsc --noEmit
pnpm -r test
```
Expected: builds clean; typecheck clean; all tests (core + the new apps/web suite) green, including `require-owner`, `isolation`, `tenant-guard`, and the `/files` route test.

- [ ] **Step 2: Grep the flip-checklist invariants one final time**

```bash
# no tenant-data file still uses the constant:
grep -rn FOUNDER_OWNER_ID apps/web/lib/{data,actions,gen-actions,refgen-actions,upload-actions,cowork-actions,cowork-guardian,studio-actions,entity-snapshot}.ts && echo "LEAK — fix" || echo "clean"
# the constant + re-export STILL exist (must not be deleted):
grep -n "FOUNDER_OWNER_ID" packages/core/src/storage-key.ts packages/core/src/index.ts
# no @default('founder') remains:
grep -c "@default(\"founder\")" packages/db/prisma/schema.prisma   # expect 0
# both $executeRaw aliases carry ${ownerId}:
grep -n "executeRaw" apps/web/lib/actions.ts
```
Expected: "clean"; the definition + re-export present; `0` defaults; both raw SQL WHEREs use `${ownerId}`.

- [ ] **Step 3: Codex review (security/tenancy lens)**

Run the repo's Codex review on the full P3 diff. Focus prompts: (a) any tenant read/write that still resolves owner from a constant or a default; (b) any place `requireOwner` could return `"founder"` for a non-founder; (c) bootstrap idempotency under concurrency; (d) the `/files` owner check; (e) the 2 raw-SQL aliases. Triage findings; fix all confirmed BLOCKER/STRONG inline in the owning file, re-run Step 1.

- [ ] **Step 4: Money-safety-review lens (spend sites touched)**

Invoke the money-safety-review skill on the diff (it touches `startGen`/`startRefGen`/`dispatchVariantJob`/`coworkGenerate` reserve sites and the bootstrap grant). Confirm: reserve still uses the resolved `ownerId` as `orgId`; the bootstrap `signup:<orgId>` grant is idempotent; no double-grant; no reservation leak; the founder seed grant path is untouched. Fix all confirmed BLOCKER/STRONG.

- [ ] **Step 5: Workflow code-QA**

Run the project's `/qa` (or `review`) pass against a locally-running beta build: sign in as a fresh (non-founder) allowlisted email, confirm a personal org + 1000-credit balance is bootstrapped, run one mock generation end-to-end, confirm the founder's data is invisible. Confirm sign-in as the founder still sees the founder org.

- [ ] **Step 6: Final commit of any gate fixes (leave for user)**

```bash
git add -A
git commit -m "fix(p3): address Codex + money-safety + QA findings on the multi-tenant flip"
```

- [ ] **Step 7: STOP — request explicit deploy confirmation**

The flip is the point of no return. Do NOT push/deploy. Report to the user: "P3 multi-tenant flip is built, gated (Codex + money-safety + QA), and green locally with the 2-org isolation test passing. The migration is applied to the LOCAL DB only. Deploy is the point of no return — confirm explicitly before I push to `main` (which auto-deploys + auto-migrates prod)." **Wait for explicit user confirmation before any deploy.**

---

## Self-Review

**1. Spec coverage** — every §4 flip-checklist item + §6.3 resolver requirement maps to a task:
- §6.3 fail-closed resolver (never "founder" for non-founder; synchronous bootstrap; `{error}` on failure) → Task 2. `events.signIn` same bootstrap best-effort → Task 3.
- §4 latent-IDOR sites already filtered in P0; flip swaps constant→resolved owner: `getShots`/`resolveCoworkResultUrls` (cost visibility) → Task 5; `getRenderJobs` → Task 8; `getGenJob`/`getRecentGenResults` second-hop → Task 7; `ownedAssetFromSrc` key-owner verification → Task 8.
- §4 `/files` route IDOR → Task 12.
- §4 the 2 `$executeRaw` aliases → Task 8 Step 3 (explicit).
- §4 admin cross-tenant reads excluded from scoping → Task 13.
- §4 Prisma client-extension backstop → Task 14.
- §4/§8 2-org isolation test (incl. `/files` + cost) → Task 15.
- §7 `@default("founder")` removal → Task 4.
- §7 worker unchanged + cowork-LLM `$0` confirmation → Task 16.
- 193-site file groups → Tasks 5-11 (data, refgen, gen, actions, upload, cowork, studio/snapshot).
- House rules: TDD for resolver/bootstrap/`/files`/isolation/guard (Tasks 2,3,12,14,15); double gate + STOP (Task 17); LOCAL migration only (Task 4); no auto-commit (every commit "leave for user"); single `main` branch.

**2. Placeholder scan** — no "TBD/TODO/handle edge cases"; every code step has complete code. The few NOTE callouts ("confirm the exact required scalar columns", "verify the page is requireRole-gated") are verification instructions with the exact command to run, not unfinished code.

**3. Type/name consistency** — `requireOwner()` returns `{ email: string; ownerId: string } | { error: string }` everywhere (Task 2 definition, used identically in Tasks 5-13). `bootstrapPersonalOrg(userId, email): Promise<string | null>` consistent (Tasks 2, 3). `checkCast({ ownerId, ... })` signature (Task 10) matches its caller in `startGen` (Task 7). `data.ts` reads all take `ownerId` as the first param; all callers updated (Task 5). `BETA_INITIAL_GRANT_CREDITS = 1000 * INTERNAL_PER_DISPLAY` used in Task 2 impl and asserted in the test.

---

**Execution handoff:** This plan is ready for `superpowers:subagent-driven-development` (recommended — fresh subagent per task, review between) or `superpowers:executing-plans` (inline with checkpoints).
