# Operator Console on Better Auth `admin` Plugin — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the Better Auth `admin` plugin and use it to fix the cutover-broken force-logout and make tenant suspension enforce at the auth layer — reusing the operator actions that already exist.

**Architecture:** The operator actions already exist in `apps/web/lib/tenant-actions.ts`. Phase 1 (a) adds the admin-plugin schema fields, (b) installs `admin()` so `BetterAuthUser.banned` is enforced by its `session.create.before` hook, (c) fixes `cutTenantSessions` to delete from `BetterAuthSession` (the cutover left it deleting the dead legacy `Session` table), and (d) extends `setMembershipStatus` so suspending a tenant also bans + cuts their BA sessions. No new action file; action signatures are unchanged, so the existing `/admin` UI needs no edits.

**Tech Stack:** `better-auth@1.6.20` (`admin` from `better-auth/plugins`), Prisma/PostgreSQL, Next.js 16 App Router, Vitest.

**Design doc:** `docs/superpowers/specs/2026-06-26-operator-console-better-auth-admin-design.md` (see §6′ and the Revision note).

## Global Constraints

- **Do NOT modify the money/generation path:** `apps/web/lib/gen-actions.ts`, `apps/web/lib/cowork-actions.ts`, `packages/otto/src/meter.ts`, `apps/worker/*`, the `CreditAccount`/`CreditLedger` models, and `packages/db/src/credits.ts`. Phase 1 does not touch credits at all.
- **Pinned dependency:** `better-auth@1.6.20` (already installed). No version bump.
- **Do NOT change `apps/web/proxy.ts`** — its matcher already excludes `/api/better-auth`; the admin sub-routes ride under that exclusion and self-gate.
- **Do NOT change the RBAC `SECTION_MATRIX`** (`packages/core/src/roles.ts`). The existing `requireRole("tenants","mutate")` gate (super-admin) already fronts these actions.
- **Do NOT create `operator-actions.ts`** — extend the existing files in place (surgical; the actions already exist).
- **Phase 1 does NOT call the plugin's HTTP API** (`auth.api.banUser` etc.). Ban is a direct `prisma.betterAuthUser.update`; the installed plugin's session hook does the enforcement. Calling the API (and the `ba_user.role` mirror it needs) is Phase 2.
- **Schema field names must be exactly** `role`, `banned`, `banReason`, `banExpires` (on the user model) and `impersonatedBy` (on the session model) — these are the admin plugin's default field names; using them avoids a `schema` override in the plugin config.

**Base branch:** `main` (which has the Better Auth code; the current `claude/wonderful-keller-65c3e6` worktree predates it). Implementation should run in a fresh worktree off `main` (the executor creates it via `superpowers:using-git-worktrees`), and copy this plan + the spec into it.

**Run tests** from the web package (its `test` script is `vitest run`):
`pnpm --filter @fikirtive/web exec vitest run <relative/path>`

---

### Task 1: Schema — add admin-plugin fields to the BA tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (models `BetterAuthUser`, `BetterAuthSession`)
- Migration: created by `prisma migrate dev`

**Interfaces:**
- Produces: `BetterAuthUser.role`, `BetterAuthUser.banned`, `BetterAuthUser.banReason`, `BetterAuthUser.banExpires`, `BetterAuthSession.impersonatedBy` — consumed by Tasks 2–4 and (Phase 2) impersonation. Prisma client accessors: `prisma.betterAuthUser`, `prisma.betterAuthSession`.

> Schema/migration tasks are verified by **migrate + generate + validate + typecheck**, not a red→green unit test (there is no behavior to assert until a consumer uses the columns; Tasks 3–4 exercise them). This is the documented exception to TDD for scaffolding.

- [ ] **Step 1: Add the fields to `BetterAuthUser`**

In `packages/db/prisma/schema.prisma`, the model currently ends:

```prisma
model BetterAuthUser {
  id            String              @id
  name          String
  email         String              @unique
  emailVerified Boolean             @default(false)
  image         String?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  sessions      BetterAuthSession[]
  accounts      BetterAuthAccount[]
  @@map("ba_user")
}
```

Add the admin-plugin fields (after `image`, before `createdAt`):

```prisma
model BetterAuthUser {
  id            String              @id
  name          String
  email         String              @unique
  emailVerified Boolean             @default(false)
  image         String?
  // Better Auth admin plugin fields (default field names — no `schema` override needed).
  role          String?             // BA gate role; MIRROR of canonical User.role (Phase 2). Unused in Phase 1.
  banned        Boolean?            @default(false) // session.create.before hook blocks login when true
  banReason     String?
  banExpires    DateTime?           // plugin auto-clears an expired ban in the session hook
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  sessions      BetterAuthSession[]
  accounts      BetterAuthAccount[]
  @@map("ba_user")
}
```

- [ ] **Step 2: Add `impersonatedBy` to `BetterAuthSession`**

The model currently ends with `userAgent String?` then `userId`. Add `impersonatedBy` after `userAgent`:

```prisma
model BetterAuthSession {
  id        String         @id
  expiresAt DateTime
  token     String         @unique
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  ipAddress String?
  userAgent String?
  impersonatedBy String?   // admin's BA user id on an impersonation session (Phase 2). Added now to keep one migration.
  userId    String
  user      BetterAuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("ba_session")
}
```

- [ ] **Step 3: Create + apply the migration**

Run: `pnpm --filter @fikirtive/db exec prisma migrate dev --name ba_admin_fields`
Expected: a new migration under `packages/db/prisma/migrations/<ts>_ba_admin_fields/` is created and applied; output ends `Your database is now in sync with your schema.`

- [ ] **Step 4: Regenerate the client + validate**

Run: `pnpm --filter @fikirtive/db exec prisma generate && pnpm --filter @fikirtive/db exec prisma validate`
Expected: `Prisma schema loaded` / `The schema at … is valid 🚀` and a regenerated client.

- [ ] **Step 5: Typecheck the web package compiles against the new fields**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: exit 0 (no errors). This proves the generated client exposes `betterAuthUser.banned` / `betterAuthSession.impersonatedBy` for later tasks.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Better Auth admin-plugin fields to ba_user/ba_session"
```

---

### Task 2: Install the `admin` plugin (minimal) in the auth config

**Files:**
- Modify: `apps/web/lib/better-auth/server.ts` (the `plugins` array)
- Test: `apps/web/lib/__tests__/better-auth-server.test.ts`

**Interfaces:**
- Consumes: Task 1's `BetterAuthUser.banned`/`banReason`/`banExpires` (the plugin's `session.create.before` hook reads `banned`).
- Produces: the plugin's `session.create.before` ban-enforcement hook (active app-wide) and the `auth.api.banUser`/`listUsers`/`impersonateUser` surface (not called in Phase 1). `admin()` is added **after `customSession`, before `nextCookies()`**.

> Bare `admin()` uses default `adminRoles: ["admin"]` over the built-in `{admin,user}` roles, so init does not throw, and — because no `BetterAuthUser.role` is `"admin"` — every admin endpoint denies (403) by default. That is the intended safe state for Phase 1: the plugin is installed for its ban hook, its API is inert until Phase 2 grants a caller an admin role.

- [ ] **Step 1: Write the failing boot test**

Add to `apps/web/lib/__tests__/better-auth-server.test.ts` inside the existing `describe("better-auth server instance", …)`:

```ts
  it("registers the admin plugin API and keeps getSession", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(typeof auth.api.getSession).toBe("function");
    expect(typeof auth.api.banUser).toBe("function");
    expect(typeof auth.api.listUsers).toBe("function");
    expect(typeof auth.api.impersonateUser).toBe("function");
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-server.test.ts`
Expected: FAIL — `auth.api.banUser` is `undefined` (`expected "undefined" to be "function"`).

- [ ] **Step 3: Add the plugin import + registration**

In `apps/web/lib/better-auth/server.ts`, change the magic-link import line:

```ts
import { magicLink, customSession } from "better-auth/plugins";
```
to:
```ts
import { magicLink, customSession, admin } from "better-auth/plugins";
```

Then in the `plugins: [ … ]` array, insert `admin()` between the `customSession(...)` block and `nextCookies()`:

```ts
    // Surface the canonical role on the session so compat.ts matches NextAuth byte-for-byte.
    customSession(async ({ user, session }) => {
      return { user: { ...user, role: await roleForEmail(user.email) }, session };
    }),
    // Operator-console engine. Phase 1: installed for the session.create.before ban hook
    // (BetterAuthUser.banned ⇒ login blocked). Its API stays inert (no BA user has an admin
    // role yet); roles/adminRoles + impersonation arrive in Phase 2.
    admin(),
    nextCookies(), // MUST be last.
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-server.test.ts`
Expected: PASS (both the existing test and the new one).

- [ ] **Step 5: Confirm the allowlist gate still loads (no hook regression)**

The plugin's `init()` adds its own `databaseHooks.user.create.before`; ours (`assertAllowedEmail`) must still be present. Run the existing gate test:
Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-gate.test.ts lib/__tests__/better-auth-server.test.ts`
Expected: PASS (all). (The gate test exercises `assertAllowedEmail`/`assertAllowedForUserId` directly; this confirms they still import and behave.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/better-auth/server.ts apps/web/lib/__tests__/better-auth-server.test.ts
git commit -m "feat(auth): install Better Auth admin plugin (ban-enforcement hook)"
```

---

### Task 3: Fix `cutTenantSessions` to target `BetterAuthSession`

**Files:**
- Modify: `apps/web/lib/tenant-actions.ts` (`cutTenantSessions` + a new local helper)
- Test: `apps/web/lib/__tests__/tenant-actions.test.ts` (the `cutTenantSessions` describe block + the `@fikirtive/db` mock)

**Interfaces:**
- Consumes: Task 1 schema (`prisma.betterAuthSession`, `prisma.betterAuthUser`).
- Produces: `async function orgMemberBaUserIds(orgId: string): Promise<string[]>` (module-local in `tenant-actions.ts`) — reused by Task 4. Maps an org's active members (`Membership.userId` → `User.email` → `BetterAuthUser.id`). `cutTenantSessions(orgId)` keeps its signature `(orgId: string) => Promise<{ ok: true; cut: number } | { error: string }>`.

> Why a 3-hop map: `BetterAuthSession.userId` references `BetterAuthUser.id`, a different id space from our `User.id`. The two user tables join by `email`. The old code deleted `Session` rows keyed by `User.id` — wrong table AND wrong id space.

- [ ] **Step 1: Update the test's `@fikirtive/db` mock to the new call surface**

In `apps/web/lib/__tests__/tenant-actions.test.ts`, the mock declares per-method `vi.fn()`s and a `vi.mock("@fikirtive/db", …)`. Replace the `sessionDeleteMany` wiring with the new accessors. Change the declarations block:

```ts
const membershipUpdateMany = vi.fn();
const membershipFindMany = vi.fn();
const sessionDeleteMany = vi.fn();
const allowedEmailUpsert = vi.fn();
const allowedEmailUpdateMany = vi.fn();
const actionEventCreate = vi.fn();
const organizationFindFirst = vi.fn();
```
to:
```ts
const membershipUpdateMany = vi.fn();
const membershipFindMany = vi.fn();
const userFindMany = vi.fn();
const baUserFindMany = vi.fn();
const baUserUpdateMany = vi.fn();
const baSessionDeleteMany = vi.fn();
const allowedEmailUpsert = vi.fn();
const allowedEmailUpdateMany = vi.fn();
const actionEventCreate = vi.fn();
const organizationFindFirst = vi.fn();
```

Change the `vi.mock("@fikirtive/db", …)` `prisma` object:

```ts
vi.mock("@fikirtive/db", () => ({
  prisma: {
    membership: { updateMany: membershipUpdateMany, findMany: membershipFindMany },
    user: { findMany: userFindMany },
    betterAuthUser: { findMany: baUserFindMany, updateMany: baUserUpdateMany },
    betterAuthSession: { deleteMany: baSessionDeleteMany },
    allowedEmail: { upsert: allowedEmailUpsert, updateMany: allowedEmailUpdateMany },
    actionEvent: { create: actionEventCreate },
    organization: { findFirst: organizationFindFirst },
  },
  grantCredits: mockGrantCredits,
  InsufficientCredits: MockInsufficientCredits,
}));
```

Update the `beforeEach` resets — replace `sessionDeleteMany.mockReset();` with:
```ts
  userFindMany.mockReset();
  baUserFindMany.mockReset();
  baUserUpdateMany.mockReset();
  baSessionDeleteMany.mockReset();
```

- [ ] **Step 2: Replace the `cutTenantSessions` test cases**

Replace the entire `describe("cutTenantSessions", …)` block with:

```ts
describe("cutTenantSessions", () => {
  // helper: wire the 3-hop member→email→ba-user resolution
  function wireMembers(baUserIds: string[]) {
    membershipFindMany.mockResolvedValue(baUserIds.map((_, i) => ({ userId: `user_${i}` })));
    userFindMany.mockResolvedValue(baUserIds.map((_, i) => ({ email: `u${i}@t.test` })));
    baUserFindMany.mockResolvedValue(baUserIds.map((id) => ({ id })));
  }

  it("returns the gate error when requireRole denies", async () => {
    mockRequireRole.mockResolvedValue(GATE_ERROR);
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual(GATE_ERROR);
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("rejects the FOUNDER_OWNER_ID org", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    const res = await cutTenantSessions(FOUNDER_OWNER_ID);
    expect(res).toEqual({ error: "Invalid org." });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("returns { ok: true, cut: 0 } when the org has no members", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipFindMany.mockResolvedValue([]);
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual({ ok: true, cut: 0 });
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes BetterAuthSession rows scoped to the org's BA user ids", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    wireMembers(["ba_1", "ba_2"]);
    baSessionDeleteMany.mockResolvedValue({ count: 3 });
    const res = await cutTenantSessions("orgX");
    expect(res).toEqual({ ok: true, cut: 3 });
    expect(baSessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["ba_1", "ba_2"] } },
    });
  });

  it("does NOT touch the legacy Session table (cutover bug fix)", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    wireMembers(["ba_1"]);
    baSessionDeleteMany.mockResolvedValue({ count: 1 });
    await cutTenantSessions("orgX");
    // legacy prisma.session is no longer in the mock; if cut still referenced it the call would throw.
    expect(baSessionDeleteMany).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/tenant-actions.test.ts`
Expected: FAIL — `cutTenantSessions` still calls `prisma.session.deleteMany`, which is no longer in the mock (`prisma.session` is `undefined` → TypeError), and `baSessionDeleteMany` is never called.

- [ ] **Step 4: Add the helper + rewrite `cutTenantSessions`**

In `apps/web/lib/tenant-actions.ts`, add the helper just below the imports (above `setMembershipStatus`):

```ts
/** Resolve an org's active members to their Better Auth user ids.
 *  Membership.userId → User.email → BetterAuthUser.id (the two user tables join by email;
 *  BetterAuthSession/ban operate on BetterAuthUser.id, a different id space from User.id). */
async function orgMemberBaUserIds(orgId: string): Promise<string[]> {
  const members = await prisma.membership.findMany({ where: { orgId, deletedAt: null }, select: { userId: true } });
  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
  const emails = users.map((u) => u.email.toLowerCase());
  if (emails.length === 0) return [];
  const baUsers = await prisma.betterAuthUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
  return baUsers.map((u) => u.id);
}
```

Replace the body of `cutTenantSessions` (the current version uses `prisma.session.deleteMany`):

```ts
export async function cutTenantSessions(orgId: string): Promise<{ ok: true; cut: number } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  const baUserIds = await orgMemberBaUserIds(orgId);
  if (baUserIds.length === 0) return { ok: true, cut: 0 };
  const { count } = await prisma.betterAuthSession.deleteMany({ where: { userId: { in: baUserIds } } });
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.cut", payload: { orgId, cut: count, via: gate.email } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "tenant.cut", payload: { cut: count, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, cut: count };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/tenant-actions.test.ts`
Expected: PASS (the whole file — the unchanged `setMembershipStatus`/`inviteTenant`/`revokeTenantInvite`/`grantTenantCredits` cases still pass; the rewritten `cutTenantSessions` cases pass).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/tenant-actions.ts apps/web/lib/__tests__/tenant-actions.test.ts
git commit -m "fix(admin): cutTenantSessions deletes BetterAuthSession (cutover left it on the dead legacy table)"
```

---

### Task 4: Suspend bans + cuts at the auth layer

**Files:**
- Modify: `apps/web/lib/tenant-actions.ts` (`setMembershipStatus`)
- Test: `apps/web/lib/__tests__/tenant-actions.test.ts` (the `setMembershipStatus` describe block)

**Interfaces:**
- Consumes: `orgMemberBaUserIds` (Task 3), `prisma.betterAuthUser.updateMany`, `prisma.betterAuthSession.deleteMany`, Task 2's installed ban hook.
- Produces: `setMembershipStatus(orgId, status)` unchanged signature; suspending now also sets `BetterAuthUser.banned=true` + cuts BA sessions, reactivating clears the ban.

- [ ] **Step 1: Add the ban/unban test cases**

In `apps/web/lib/__tests__/tenant-actions.test.ts`, add these cases inside the existing `describe("setMembershipStatus", …)` block (keep the existing cases — they still hold). The `wireMembers` helper here mirrors Task 3's:

```ts
  it("on suspend: bans the org's BA users and cuts their BA sessions", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([{ userId: "user_0" }]);
    userFindMany.mockResolvedValue([{ email: "u0@t.test" }]);
    baUserFindMany.mockResolvedValue([{ id: "ba_0" }]);
    baSessionDeleteMany.mockResolvedValue({ count: 2 });
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual({ ok: true });
    expect(baUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["ba_0"] } }, data: expect.objectContaining({ banned: true }) })
    );
    expect(baSessionDeleteMany).toHaveBeenCalledWith({ where: { userId: { in: ["ba_0"] } } });
  });

  it("on reactivate: lifts the ban and does NOT cut sessions", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([{ userId: "user_0" }]);
    userFindMany.mockResolvedValue([{ email: "u0@t.test" }]);
    baUserFindMany.mockResolvedValue([{ id: "ba_0" }]);
    const res = await setMembershipStatus("orgX", "active");
    expect(res).toEqual({ ok: true });
    expect(baUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["ba_0"] } }, data: expect.objectContaining({ banned: false }) })
    );
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });

  it("skips the auth-layer writes when the org has no BA users", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    membershipUpdateMany.mockResolvedValue({ count: 1 });
    membershipFindMany.mockResolvedValue([]);
    const res = await setMembershipStatus("orgX", "suspended");
    expect(res).toEqual({ ok: true });
    expect(baUserUpdateMany).not.toHaveBeenCalled();
    expect(baSessionDeleteMany).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to confirm the new ones fail**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/tenant-actions.test.ts`
Expected: FAIL — `baUserUpdateMany` is never called (current `setMembershipStatus` only flips `Membership.status`).

- [ ] **Step 3: Extend `setMembershipStatus`**

In `apps/web/lib/tenant-actions.ts`, replace the body of `setMembershipStatus` (insert the auth-layer block after the membership-count check, before the audit writes):

```ts
export async function setMembershipStatus(orgId: string, status: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  if (!ORG_STATUS.has(status)) return { error: "Invalid status." };
  const { count } = await prisma.membership.updateMany({ where: { orgId }, data: { status } });
  if (count === 0) return { error: "No memberships for that org." };
  // Mirror to the Better Auth layer so suspension is immediate + global: ban the members'
  // BA users (the installed admin plugin's session.create.before hook then blocks re-login)
  // and cut their live BA sessions. Reactivation lifts the ban. Membership.status stays the
  // authoritative per-tenant gate (requireOwner consumes it); this is defense-in-depth.
  const baUserIds = await orgMemberBaUserIds(orgId);
  if (baUserIds.length > 0) {
    if (status === "suspended") {
      await prisma.betterAuthUser.updateMany({ where: { id: { in: baUserIds } }, data: { banned: true, banReason: `suspended by ${gate.email}` } });
      await prisma.betterAuthSession.deleteMany({ where: { userId: { in: baUserIds } } });
    } else {
      await prisma.betterAuthUser.updateMany({ where: { id: { in: baUserIds } }, data: { banned: false, banReason: null, banExpires: null } });
    }
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.status", payload: { orgId, status, via: gate.email } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "tenant.status", payload: { status, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`); revalidatePath("/admin/tenants");
  return { ok: true };
}
```

- [ ] **Step 4: Run the full file to confirm all pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/tenant-actions.test.ts`
Expected: PASS (existing + new `setMembershipStatus` cases, and Task 3's `cutTenantSessions` cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/tenant-actions.ts apps/web/lib/__tests__/tenant-actions.test.ts
git commit -m "feat(admin): suspending a tenant bans + cuts their Better Auth sessions"
```

---

### Task 5: Full-suite green + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the web test suite**

Run: `pnpm --filter @fikirtive/web test`
Expected: all pass. (Money-path tests untouched. Note the DB-backed integration suites — `require-owner.test.ts`, `isolation.test.ts` — need the local Postgres up, same as before.)

- [ ] **Step 2: Manual smoke (founder, against a dev/staging instance)**

Document the result (no code):
1. Suspend a non-founder tenant from `/admin/tenants/[orgId]` → that user's open session stops working (they get redirected to `/login`) and a fresh magic-link login is **rejected** (banned hook). `actionEvent` `tenant.status` recorded.
2. Reactivate the tenant → they can sign in again.
3. "Cut sessions" on a tenant → their active BA session is invalidated (previously a no-op).
4. Founder + an existing allowlisted user can still sign in normally (ban hook only blocks `banned=true` users).

- [ ] **Step 3: Confirm non-goals held**

`git diff main --stat` must show **no** changes under `gen-actions.ts`, `cowork-actions.ts`, `packages/otto/`, `apps/worker/`, `packages/db/src/credits.ts`, `proxy.ts`, or `packages/core/src/roles.ts`. Only: `schema.prisma` (+migration), `better-auth/server.ts`, `tenant-actions.ts`, and the two test files.

---

## Out of scope (Phase 2 — separate plan)

- `ba_user.role` mirror (`convergeIdentity` + `saveUserRole`) so the plugin's API recognizes our roles.
- Configure `admin({ roles, adminRoles: ["super-admin"], impersonationSessionDuration })`.
- Impersonation: `impersonateUser`/`stopImpersonating`, founder-only gate, banner, and the spend-block in `auth-guard` (needs a code-verified answer on where to block spend without touching off-limits files — `impersonatedBy` is invisible through `compat.auth()` today).
- Stripe (Phase 3, its own spec).

## Self-Review (done)

- **Spec coverage:** Phase-1 scope from spec §1/§6′ — schema fields (Task 1), plugin install + ban hook (Task 2), `cutTenantSessions` bug fix (Task 3), ban-on-suspend (Task 4), full-suite + non-goals (Task 5). Role-mirror/impersonation explicitly deferred to Phase 2 per spec.
- **Placeholders:** none — every code/test step shows complete code and exact commands with expected output.
- **Type consistency:** `orgMemberBaUserIds` defined in Task 3, consumed in Task 4; `prisma.betterAuthUser`/`betterAuthSession` accessors match the Task 1 model names; action signatures unchanged so no caller drift; field names match the plugin defaults (`banned`/`banReason`/`banExpires`/`role`/`impersonatedBy`).
