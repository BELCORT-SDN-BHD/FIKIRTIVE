# Operator Console — Phase 2 (Impersonation + Role Mirror) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a founder impersonate a tenant to debug what they see, safely — they can browse as the customer but **cannot spend the customer's credits** — plus mirror our canonical role onto `ba_user.role` so the admin plugin's API recognizes the founder.

**Architecture:** Configure the already-installed `admin` plugin with our `super-admin` role (so `impersonateUser` recognizes the founder caller). `convergeIdentity` + `saveUserRole` mirror the canonical `User.role` onto `BetterAuthUser.role`. Impersonation uses the plugin's `impersonateUser`/`stopImpersonating` (founder-only server actions). A shared `isImpersonating()` helper (reading the raw BA session `impersonatedBy` that `compat.auth()` drops) gates **8 web spend entry points** with an additive early-return, and drives a visible banner.

**Tech Stack:** `better-auth@1.6.20` (`admin` plugin + `better-auth/plugins/access`), Next.js 16, Prisma. Builds on Phase 1 (merged: schema fields + bare `admin()` + the ban/cut work).

**Design doc:** `docs/superpowers/specs/2026-06-26-operator-console-better-auth-admin-design.md` (§5 role mirror, §9 impersonation — see the RESOLVED spend-block note and the Phase-2 carve-out in Global Constraints).

## Global Constraints

- **Money-path carve-out (user-approved 2026-06-26):** the ONLY allowed money-path edits are **additive early-return guards** `if (await isImpersonating()) return <refuse>;` at the 8 web spend entry points (Task 4). No change to charge/reserve/settle/pricing logic, to `packages/otto/src/meter.ts`, `packages/db/src/credits.ts`, `apps/worker/*`, or the credit models. The guard goes immediately **after** each function's existing `requireOwner()` gate.
- **Do NOT change** `apps/web/proxy.ts` or the RBAC matrix (`packages/core/src/roles.ts`).
- **Pinned:** `better-auth@1.6.20`. No version bump.
- **`adminRoles` must be a subset of `roles` keys** or the plugin throws at init.
- **Impersonation is founder-only:** every impersonation action requires `requireRole("tenants","mutate")` AND `isFounderAdmin(gate.email)`.
- **Role is single-valued:** mirror writes one role string to `ba_user.role` (never the plugin's CSV multi-role).

**Base branch:** `main` (Phase 1 merged as `1d04ec5`). Implement in this worktree (`.claude/worktrees/operator-console-phase2`, branch `claude/operator-console-phase2`, off merged `main`).

**Run tests:** `pnpm --filter @fikirtive/web exec vitest run <relative/path>` (cwd = `apps/web`). Local Postgres is reachable; `@fikirtive/db` is built + generated.

---

### Task 1: Configure the admin plugin (AC + super-admin role + impersonation duration)

**Files:**
- Create: `apps/web/lib/better-auth/access.ts`
- Modify: `apps/web/lib/better-auth/server.ts` (the `admin()` call)
- Test: `apps/web/lib/__tests__/better-auth-access.test.ts`, and the existing `better-auth-server.test.ts`

**Interfaces:**
- Produces: `ac` (AccessControl) and `superAdminRole` (a Role with full `user`+`session` grants) from `access.ts`. The configured plugin recognizes a caller whose `ba_user.role === "super-admin"` as an admin (consumed by Task 5's `impersonateUser`).

> The admin plugin's access API (verified in `better-auth@1.6.20` `dist/plugins/access/access.mjs`): `createAccessControl(statements)` returns `{ newRole(grants), statements }`; `newRole(...).authorize(request)` is a pure function. Default admin statements: `user: [create,list,set-role,ban,impersonate,impersonate-admins,delete,set-password,set-email,get,update]`, `session: [list,revoke,delete]`.

- [ ] **Step 1: Write the failing access test**

Create `apps/web/lib/__tests__/better-auth-access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { superAdminRole } from "@/lib/better-auth/access";

describe("super-admin access role", () => {
  it("authorizes impersonate + ban + session revoke", () => {
    expect(superAdminRole.authorize({ user: ["impersonate"] }).success).toBe(true);
    expect(superAdminRole.authorize({ user: ["ban"] }).success).toBe(true);
    expect(superAdminRole.authorize({ session: ["revoke"] }).success).toBe(true);
  });
  it("denies a resource it does not grant", () => {
    // a made-up resource is not in the statement space → not authorized
    expect(superAdminRole.authorize({ billing: ["charge"] } as never).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — fails (module missing)**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-access.test.ts`
Expected: FAIL — `Cannot find module '@/lib/better-auth/access'`.

- [ ] **Step 3: Create `access.ts`**

```ts
import "server-only";
import { createAccessControl } from "better-auth/plugins/access";

/** Statement space = the admin plugin's default statements (1.6.20). Kept explicit so our
 *  super-admin role grants exactly what the plugin's endpoints check. */
const statements = {
  user: ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
} as const;

export const ac = createAccessControl(statements);

/** Our canonical top role. `adminRoles: ["super-admin"]` in server.ts points here; the founder's
 *  mirrored ba_user.role === "super-admin" then passes hasPermission for impersonate/ban/etc. */
export const superAdminRole = ac.newRole({
  user: ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
});
```

- [ ] **Step 4: Run the access test — passes**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-access.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the config into `server.ts`**

In `apps/web/lib/better-auth/server.ts`, add the import near the other plugin imports:

```ts
import { ac, superAdminRole } from "./access";
```

Replace the bare `admin(),` in the `plugins` array with:

```ts
    admin({
      ac,
      roles: { "super-admin": superAdminRole },
      adminRoles: ["super-admin"],            // MUST be a key in `roles` or init throws
      impersonationSessionDuration: 60 * 30,  // 30 min
    }),
```

- [ ] **Step 6: Confirm boot still green (no init throw with the new config)**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-server.test.ts`
Expected: PASS — the `auth` instance constructs (if `adminRoles` weren't a `roles` key, import would throw "Invalid admin roles").

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/lib/better-auth/access.ts apps/web/lib/better-auth/server.ts apps/web/lib/__tests__/better-auth-access.test.ts
git commit -m "feat(auth): configure admin plugin super-admin role + 30m impersonation duration"
```

---

### Task 2: Mirror the canonical role onto `ba_user.role`

**Files:**
- Modify: `apps/web/lib/better-auth/converge.ts` (founder branch)
- Modify: `apps/web/lib/admin-actions.ts` (`saveUserRole`)
- Test: `apps/web/lib/__tests__/better-auth-converge.test.ts`, plus a new/extended test for `saveUserRole`

**Interfaces:**
- Consumes: `prisma.betterAuthUser.updateMany`. Produces: on every founder sign-in, `ba_user.role === "super-admin"`; when an operator sets a user's role, `ba_user.role` mirrors `User.role`. This is what makes Task 1's gate recognize the founder.

> `hasPermission` reads the raw `ba_user.role`, NOT `roleForEmail`/`customSession`. Without this mirror, `impersonateUser` 403s the founder.

- [ ] **Step 1: Add the mirror assertion to the converge test**

In `apps/web/lib/__tests__/better-auth-converge.test.ts`, the mock `db` object needs `betterAuthUser: { updateMany: vi.fn() }`. Add it to the `db` declaration:

```ts
const db = {
  user: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  membership: { upsert: vi.fn() },
  betterAuthUser: { updateMany: vi.fn() },
  actionEvent: { create: vi.fn() },
};
```

Then in the founder test case ("self-heals founder super-admin …"), add an assertion that the BA mirror was written:

```ts
    expect(db.betterAuthUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "founder@x.test" }, data: { role: "super-admin" } })
    );
```

- [ ] **Step 2: Run it — fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-converge.test.ts`
Expected: FAIL — `db.betterAuthUser.updateMany` never called.

- [ ] **Step 3: Add the mirror in `converge.ts`**

In `apps/web/lib/better-auth/converge.ts`, inside the `if (isFounderAdmin(email)) { … }` block (right after the existing `prisma.user.updateMany(... role: "super-admin" ...)` line), add the BA mirror:

```ts
      // Mirror the canonical role onto ba_user.role so the admin plugin's hasPermission
      // recognizes the founder (it reads the raw ba_user.role, not roleForEmail).
      await Promise.resolve(prisma.betterAuthUser.updateMany({ where: { email }, data: { role: "super-admin" } })).catch(() => {});
```

- [ ] **Step 4: Run the converge test — passes**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-converge.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror in `saveUserRole` (test first)**

`saveUserRole` (`apps/web/lib/admin-actions.ts`) writes `User.role` inside a `$transaction`. Find its test (`grep -rn "saveUserRole" apps/web/lib/__tests__`); if a test file exists, add a case asserting the BA mirror; if none exists, create `apps/web/lib/__tests__/save-user-role.test.ts` mocking `@/lib/auth-guard` (`requireRole`), `next/cache`, and `@fikirtive/db` (with `user.findUnique`, a `$transaction` that invokes its callback against `{ user: { update }, betterAuthUser: { updateMany }, actionEvent: { create } }`, mirroring the Phase-1 tenant-actions test pattern). Assert that on success `betterAuthUser.updateMany` is called with `{ where: { email: <target email lowercased> }, data: { role: <new role> } }`.

- [ ] **Step 6: Add the mirror inside the `saveUserRole` transaction**

In `apps/web/lib/admin-actions.ts`, inside `saveUserRole`'s `prisma.$transaction(async (tx) => { … })`, right after `await tx.user.update({ where: { id: target.id }, data: { role } });`, add:

```ts
      // mirror onto ba_user.role (the admin plugin's gate reads this column, by email join)
      if (target.email) await tx.betterAuthUser.updateMany({ where: { email: target.email.toLowerCase() }, data: { role } });
```

- [ ] **Step 7: Run the saveUserRole test — passes; then typecheck + commit**

Run the test file from Step 5 → PASS. Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/lib/better-auth/converge.ts apps/web/lib/admin-actions.ts apps/web/lib/__tests__/better-auth-converge.test.ts apps/web/lib/__tests__/save-user-role.test.ts
git commit -m "feat(auth): mirror canonical role onto ba_user.role (converge + saveUserRole) so the admin plugin recognizes operators"
```

---

### Task 3: `isImpersonating()` helper

**Files:**
- Modify: `apps/web/lib/better-auth/compat.ts`
- Test: `apps/web/lib/__tests__/better-auth-compat.test.ts`

**Interfaces:**
- Produces: `export async function isImpersonating(): Promise<boolean>` — reads the raw BA session that `auth()` drops. Consumed by Task 4 (spend guards) and Task 6 (banner).

> `compat.auth()` returns only `{ user }`; `auth.api.getSession()` returns `{ user, session }` where `session` is the session row carrying `impersonatedBy`.

- [ ] **Step 1: Write the failing test**

In `apps/web/lib/__tests__/better-auth-compat.test.ts` (it already mocks `./server` and `next/headers` — match the existing pattern; if the mock returns a fixed session, extend it to be settable per-test). Add:

```ts
describe("isImpersonating", () => {
  it("true when the raw session has impersonatedBy", async () => {
    mockGetSession.mockResolvedValue({ user: { email: "x@t.test" }, session: { impersonatedBy: "admin_1" } });
    const { isImpersonating } = await import("@/lib/better-auth/compat");
    expect(await isImpersonating()).toBe(true);
  });
  it("false when not impersonating / no session", async () => {
    mockGetSession.mockResolvedValue({ user: { email: "x@t.test" }, session: { impersonatedBy: null } });
    const { isImpersonating } = await import("@/lib/better-auth/compat");
    expect(await isImpersonating()).toBe(false);
    mockGetSession.mockResolvedValue(null);
    expect(await isImpersonating()).toBe(false);
  });
});
```
(Use whatever the file already names its `getSession` mock; if it mocks `./server`'s `auth.api.getSession`, reuse that handle — declare `mockGetSession` if needed and wire it into the existing `vi.mock("./server", …)`.)

- [ ] **Step 2: Run it — fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/better-auth-compat.test.ts`
Expected: FAIL — `isImpersonating` is not exported.

- [ ] **Step 3: Add the helper to `compat.ts`**

Append to `apps/web/lib/better-auth/compat.ts`:

```ts
/** True when the current request runs under an admin impersonation session. Reads the RAW BA
 *  session (`auth()` above drops the session object). Used to block spend + show the banner. */
export async function isImpersonating(): Promise<boolean> {
  const session = await baAuth.api.getSession({ headers: await headers() });
  return !!session?.session?.impersonatedBy;
}
```

- [ ] **Step 4: Run the test — passes; typecheck; commit**

Run the test → PASS. `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/lib/better-auth/compat.ts apps/web/lib/__tests__/better-auth-compat.test.ts
git commit -m "feat(auth): isImpersonating() — surface the raw BA session impersonatedBy"
```

---

### Task 4: Block spend at the 8 web entry points while impersonating

**Files (additive guard only — money-path carve-out):**
- Modify: `apps/web/lib/gen-actions.ts` (`startGen`), `apps/web/lib/refgen-actions.ts` (`startRefGen`, `setBaseAsset`), `apps/web/lib/cowork-actions.ts` (`coworkDraftStoryboard`, `enhancePrompt`), `apps/web/lib/otto-actions.ts` (`ottoTurn`, `ottoApprove`), `apps/web/app/api/otto/stream/route.ts` (`POST`)
- Test: `apps/web/lib/__tests__/impersonation-spend-block.test.ts` (new)

**Interfaces:**
- Consumes: `isImpersonating()` (Task 3). Each guard is an additive early-return placed **immediately after** the function's existing `requireOwner()` gate. `coworkGenerate` needs no guard — it delegates to `startGen` (`cowork-actions.ts:591`), which is guarded.

**The uniform refuse message:** `"Paused while impersonating a customer — exit impersonation to do this."`

- [ ] **Step 1: Write the failing test (representative coverage)**

Create `apps/web/lib/__tests__/impersonation-spend-block.test.ts`. It mocks `requireOwner` (success), `isImpersonating` (true), and the spend primitive, then asserts the guarded action refuses without spending. Cover one `reserveCredits` action and one `withLlmBudget` action as representatives:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner, requireRole: vi.fn(), requireSession: vi.fn() }));
const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating, auth: vi.fn() }));

const reserveCredits = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: { $transaction: vi.fn(), genJob: { create: vi.fn() } },
  reserveCredits, refundReservation: vi.fn(), InsufficientCredits: class extends Error {},
}));
const withLlmBudget = vi.fn();
vi.mock("@fikirtive/otto", () => ({ withLlmBudget }));

beforeEach(() => { vi.clearAllMocks(); mockRequireOwner.mockResolvedValue({ email: "founder@t.test", ownerId: "founder" }); });

describe("spend is blocked while impersonating", () => {
  it("startGen refuses + never reserves", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const { startGen } = await import("@/lib/gen-actions");
    const res = await startGen({});
    expect(res).toHaveProperty("error");
    expect(reserveCredits).not.toHaveBeenCalled();
  });
  it("coworkDraftStoryboard refuses + never meters", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const mod = await import("@/lib/cowork-actions");
    // call with minimal args; the guard runs right after requireOwner, before any spend
    const res = await (mod.coworkDraftStoryboard as (...a: unknown[]) => Promise<unknown>)({});
    expect(res).toHaveProperty("error");
    expect(withLlmBudget).not.toHaveBeenCalled();
  });
});
```
(If a target module imports things these mocks don't provide and the import throws, extend the mock minimally — the contract under test is "guard returns before spend." Keep the mocks shaped to let the function reach its guard line.)

- [ ] **Step 2: Run it — fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/impersonation-spend-block.test.ts`
Expected: FAIL — the guard doesn't exist yet, so the functions proceed past `requireOwner` (and either reserve/meter or hit a later mock gap), not returning the impersonation `{ error }`.

- [ ] **Step 3: Add the import + guard to each of the 7 server actions**

In each of these files, add (if not already importing) `import { isImpersonating } from "@/lib/better-auth/compat";`, then insert this line **immediately after** the function's `const gate = await requireOwner(); if ("error" in gate) return gate;`:

```ts
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
```

Apply at:
- `gen-actions.ts` → `startGen` (after the gate at L27)
- `refgen-actions.ts` → `startRefGen` (after L28) AND `setBaseAsset` (after L150)
- `cowork-actions.ts` → `coworkDraftStoryboard` (after L78) AND `enhancePrompt` (after L155)
- `otto-actions.ts` → `ottoTurn` (after its `requireOwner` at L300) AND `ottoApprove` (after L498)

Each of these returns a union that includes `{ error: string }`, so the uniform return typechecks. (Verify by reading each function's signature; all are `Promise<… | { error: string }>`.)

- [ ] **Step 4: Add the guard to the streaming route (Response shape)**

In `apps/web/app/api/otto/stream/route.ts`, after the `const gate = await requireOwner();` block (L77) returns/handles its error, insert:

```ts
  if (await isImpersonating()) {
    return new Response("Paused while impersonating a customer.", { status: 403 });
  }
```
Add `import { isImpersonating } from "@/lib/better-auth/compat";` at the top.

- [ ] **Step 5: Run the spend-block test — passes**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/impersonation-spend-block.test.ts`
Expected: PASS (both representative cases refuse before spending).

- [ ] **Step 6: Regression — money-path tests stay green; typecheck**

Run the existing gen/cowork/otto/refgen test files (whichever exist):
`pnpm --filter @fikirtive/web exec vitest run lib/__tests__/gen-actions.test.ts lib/__tests__/cowork-actions.test.ts lib/__tests__/otto-actions.test.ts lib/__tests__/refgen-actions.test.ts` (skip any that don't exist).
Expected: PASS (the guard is additive; with `isImpersonating()` false in those tests' mocks — or unmocked → the helper would call getSession; if a test lacks the mock, add `vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: () => Promise.resolve(false), auth: vi.fn() }))` to it). Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.

> Note for the controller: existing money-path tests that call these actions but don't mock `@/lib/better-auth/compat` will now invoke `isImpersonating()` → `getSession` → `headers()`, which throws outside a request scope. Each such test must mock `isImpersonating` to `false`. The implementer must report which test files needed that one-line mock added.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/gen-actions.ts apps/web/lib/refgen-actions.ts apps/web/lib/cowork-actions.ts apps/web/lib/otto-actions.ts apps/web/app/api/otto/stream/route.ts apps/web/lib/__tests__/impersonation-spend-block.test.ts
# plus any existing test files that needed the isImpersonating:false mock
git commit -m "feat(admin): block spend at the 8 web entry points while impersonating (additive guard, no charge-logic change)"
```

---

### Task 5: Impersonation server actions (founder-only)

**Files:**
- Modify: `apps/web/lib/tenant-actions.ts` (add `impersonateTenant` + `stopImpersonatingTenant`)
- Test: `apps/web/lib/__tests__/tenant-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `auth.api.impersonateUser`/`stopImpersonating` (from `@/lib/better-auth/server`), `isFounderAdmin` (`@/lib/allowlist`), the org→owner→ba-user-id resolution (the same email join as Phase 1's `orgMemberBaUserIds`). Produces: `impersonateTenant(orgId)` and `stopImpersonatingTenant()`.

- [ ] **Step 1: Write failing tests**

In `apps/web/lib/__tests__/tenant-actions.test.ts`, mock `@/lib/allowlist` (`isFounderAdmin`) and `@/lib/better-auth/server` (`auth.api.impersonateUser`/`stopImpersonating`). Add cases:

```ts
// at top-level mocks
vi.mock("@/lib/allowlist", () => ({ isFounderAdmin: vi.fn() }));
vi.mock("@/lib/better-auth/server", () => ({ auth: { api: { impersonateUser: vi.fn(), stopImpersonating: vi.fn() } } }));
// import the mocks' handles via await import or top consts as the file does for others

describe("impersonateTenant", () => {
  it("denies a non-founder even if the role gate passes", async () => {
    mockRequireRole.mockResolvedValue(GATE);          // tenants/mutate ok
    (isFounderAdmin as Mock).mockReturnValue(false);  // but not founder
    const res = await impersonateTenant("orgX");
    expect(res).toHaveProperty("error");
    expect(authApi.impersonateUser).not.toHaveBeenCalled();
  });
  it("founder impersonates the org owner's BA user", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    membershipFindMany.mockResolvedValue([{ userId: "user_1" }]);   // owner
    userFindMany.mockResolvedValue([{ email: "owner@t.test" }]);
    baUserFindMany.mockResolvedValue([{ id: "ba_owner" }]);
    authApi.impersonateUser.mockResolvedValue({ ok: true });
    const res = await impersonateTenant("orgX");
    expect(res).toEqual({ ok: true });
    expect(authApi.impersonateUser).toHaveBeenCalledWith(expect.objectContaining({ body: { userId: "ba_owner" } }));
  });
});

describe("stopImpersonatingTenant", () => {
  it("calls stopImpersonating", async () => {
    mockRequireRole.mockResolvedValue(GATE);
    (isFounderAdmin as Mock).mockReturnValue(true);
    authApi.stopImpersonating.mockResolvedValue({ ok: true });
    const res = await stopImpersonatingTenant();
    expect(res).toEqual({ ok: true });
    expect(authApi.stopImpersonating).toHaveBeenCalled();
  });
});
```
(Add `impersonateTenant, stopImpersonatingTenant` to the `await import("@/lib/tenant-actions")` destructure, and the new mock handles to the appropriate spots. The `@fikirtive/db` mock already has `membership.findMany`/`user.findMany`/`betterAuthUser.findMany` from Phase 1.)

- [ ] **Step 2: Run — fails (functions don't exist)**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/tenant-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the actions in `tenant-actions.ts`**

Add imports at the top: `import { auth } from "@/lib/better-auth/server";` and `import { isFounderAdmin } from "@/lib/allowlist";` and `import { headers } from "next/headers";`. Then:

```ts
/** Resolve an org's owner to their Better Auth user id (email join, same id-space rule as
 *  orgMemberBaUserIds). Returns null if there is no resolvable BA owner. */
async function ownerBaUserId(orgId: string): Promise<string | null> {
  const owner = await prisma.membership.findFirst({ where: { orgId, role: "owner", deletedAt: null }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  if (!owner) return null;
  const user = await prisma.user.findUnique({ where: { id: owner.userId }, select: { email: true } });
  if (!user?.email) return null;
  const ba = await prisma.betterAuthUser.findUnique({ where: { email: user.email.toLowerCase() }, select: { id: true } });
  return ba?.id ?? null;
}

/** Founder-only: become the org owner to debug what they see. Spend is blocked while
 *  impersonating (the 8 web entry-point guards). Audited. */
export async function impersonateTenant(orgId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (!isFounderAdmin(gate.email)) return { error: "Only a founder may impersonate." };
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  const baUserId = await ownerBaUserId(orgId);
  if (!baUserId) return { error: "That tenant has no signed-in owner to impersonate yet." };
  try {
    await auth.api.impersonateUser({ body: { userId: baUserId }, headers: await headers() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start impersonation." };
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "impersonate.start", payload: { orgId, baUserId, via: gate.email } } }).catch(() => {});
  return { ok: true };
}

/** End impersonation and restore the founder's own session. */
export async function stopImpersonatingTenant(): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (!isFounderAdmin(gate.email)) return { error: "Only a founder may do this." };
  try {
    await auth.api.stopImpersonating({ headers: await headers() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not stop impersonation." };
  }
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "impersonate.stop", payload: { via: gate.email } } }).catch(() => {});
  return { ok: true };
}
```

- [ ] **Step 4: Run the tenant-actions tests — pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/tenant-actions.test.ts`
Expected: PASS (existing + new impersonation cases).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
```bash
git add apps/web/lib/tenant-actions.ts apps/web/lib/__tests__/tenant-actions.test.ts
git commit -m "feat(admin): founder-only impersonateTenant / stopImpersonatingTenant actions"
```

---

### Task 6: UI — impersonation banner + Impersonate button

**Files:**
- Modify: `apps/web/app/layout.tsx` (root layout — banner)
- Create: `apps/web/components/admin/ImpersonationBanner.tsx` (client — Stop button)
- Modify: `apps/web/components/admin/TenantDetail.tsx` (Impersonate button)
- Test: none required beyond typecheck (UI wiring; the actions are tested in Task 5). The implementer must run `pnpm --filter @fikirtive/web typecheck` and `pnpm --filter @fikirtive/web build` (or `next build` dry) to confirm the RSC/client boundary compiles.

**Interfaces:** Consumes `isImpersonating()` (server, in the layout) and `stopImpersonatingTenant`/`impersonateTenant` (Task 5). Read `apps/web/app/layout.tsx` and `apps/web/components/admin/TenantDetail.tsx` first to match their existing structure + styling conventions.

- [ ] **Step 1: Banner component (client)**

Create `apps/web/components/admin/ImpersonationBanner.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { stopImpersonatingTenant } from "@/lib/tenant-actions";

export function ImpersonationBanner() {
  const [pending, start] = useTransition();
  return (
    <div role="alert" style={{ background: "#7c2d12", color: "#fff", padding: "8px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}>
      <span>You are impersonating a customer — spend is disabled.</span>
      <button
        disabled={pending}
        onClick={() => start(async () => { await stopImpersonatingTenant(); window.location.href = "/admin/tenants"; })}
        style={{ background: "#fff", color: "#7c2d12", border: 0, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
      >{pending ? "Stopping…" : "Stop impersonating"}</button>
    </div>
  );
}
```
(Match the project's actual styling approach — if it uses Tailwind classes elsewhere, use those instead of inline styles. Read a sibling component first.)

- [ ] **Step 2: Render the banner in the root layout when impersonating**

In `apps/web/app/layout.tsx` (a server component), import `isImpersonating` and the banner, and render it at the very top of `<body>`:

```tsx
import { isImpersonating } from "@/lib/better-auth/compat";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
// inside the component, before the existing children:
const impersonating = await isImpersonating();
// ...
// <body ...>
//   {impersonating && <ImpersonationBanner />}
//   {children}
// </body>
```
(If the root layout is not `async`, make it `async`. Read the file first to integrate cleanly.)

- [ ] **Step 3: Impersonate button on the tenant detail page**

In `apps/web/components/admin/TenantDetail.tsx`, next to the existing suspend/cut/grant controls, add an "Impersonate" button wired to `impersonateTenant(detail.orgId)` (via `useTransition`), redirecting to the app root (`/`) on success so the founder lands in the customer's view. Match the existing button pattern in that file. On `{ error }`, surface it the same way the file surfaces the other actions' errors.

- [ ] **Step 4: Typecheck + build the RSC/client boundary**

Run: `pnpm --filter @fikirtive/web typecheck` → exit 0.
Run: `pnpm --filter @fikirtive/web build` → completes (confirms the async root layout + client banner compile; if build is too slow/heavy in this env, at minimum `next build` the affected routes or report that build was not run).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/components/admin/ImpersonationBanner.tsx apps/web/components/admin/TenantDetail.tsx
git commit -m "feat(admin): impersonation banner + Impersonate button on tenant detail"
```

---

### Task 7: Verify — suite, non-goals, final review, manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full web suite, compared to the pre-existing baseline**

Run: `pnpm --filter @fikirtive/web test`. The 15 pre-existing failures (`files/route`, `isolation`, `require-owner`, `tenant-guard`) are known baseline (identical on `main`). Confirm **no NEW failures** beyond those, and that all Phase-2 test files pass. If a money-path test regressed because it now hits `isImpersonating()`, that's the Task-4 mock gap — fix per Task 4 Step 6 and note it.

- [ ] **Step 2: Non-goal check**

Run: `git diff main..HEAD --stat`. Confirm: no changes to `packages/otto/src/meter.ts`, `packages/db/src/credits.ts`, `apps/worker/*`, the credit models, `proxy.ts`, or `packages/core/src/roles.ts`. The money-path files (`gen-actions`/`refgen-actions`/`cowork-actions`/`otto-actions`/stream route) must show **only** the additive `isImpersonating()` guard lines (+ the import) — diff each to confirm no charge-logic change.

- [ ] **Step 3: Final whole-branch review** (controller dispatches per subagent-driven-development — opus, with the review package + these constraints).

- [ ] **Step 4: Manual smoke (founder, against a deploy)** — document results:
  1. After deploy, the founder signs in **fresh** once (so `convergeIdentity` stamps `ba_user.role="super-admin"` — an older session predates the mirror).
  2. `/admin/tenants/[orgId]` → **Impersonate** → lands in the customer's view; the red banner shows.
  3. Try to generate / chat with Otto / refgen → each is **refused** ("Paused while impersonating…"), no credits move.
  4. **Stop impersonating** → back to the founder's own session; generation works again.
  5. `impersonate.start` / `impersonate.stop` appear in the audit.

> **Runtime risk to verify here:** the cookie-swap. `auth.api.impersonateUser`/`stopImpersonating` set cookies via the `nextCookies` plugin inside a server action. If the session doesn't actually swap (banner never appears), the fix is ensuring the action returns and the client navigates so Next flushes the Set-Cookie (the redirect in Task 6 Step 3 / banner Stop handles this). Capture the observed behavior.

---

## Out of scope (Phase 3, separate spec)

Stripe billing (`@better-auth/stripe`) → `grantCredits`. Documented in the design spec §10.

## Self-Review (done)

- **Spec coverage:** §5 role mirror → Task 2; §1/§9 impersonation (config Task 1, helper Task 3, spend-block Task 4, actions Task 5, banner+button Task 6); verification Task 7. Spend-block sites are the provably-complete set (all `reserveCredits`/`withLlmBudget` web call sites; `coworkGenerate` delegates to `startGen`).
- **Placeholders:** none — every code step shows the code; the few "read the file first" notes are for UI/style matching, with the exact insertion described.
- **Type consistency:** `isImpersonating` defined in Task 3, consumed in Tasks 4 & 6; `superAdminRole` defined in Task 1, consumed by server.ts; the 7 guarded actions all return `… | { error: string }` (verified) so the uniform guard typechecks; the stream route returns a `Response`.
