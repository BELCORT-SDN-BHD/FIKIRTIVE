# Multi-tenant Admin Console — P2 (Control + Auth-gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the `/admin/tenants` console actually control merchants — per-org credit grant, suspend/resume + immediate session cut, invite/revoke — and harden the auth gate so suspend STICKS and invites work without a redeploy.

**Architecture:** New `"use server"` actions gated `requireRole("tenants","mutate")` (super-admin). Three security-critical auth-gate changes in `apps/web/auth.ts` + `apps/web/lib/auth-guard.ts`, each found+confirmed by the design's Codex + workflow review. Control UI wired into the existing `/admin/tenants` pages.

**Tech Stack:** Next.js (server actions, RSC), Prisma 7, next-auth v5, `@fikirtive/core` (roles), vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-multitenant-admin-console-design.md`

## Global Constraints
- Authorized to commit + push when the phase gate passes (user granted autonomy 2026-06-21). Do NOT auto-approve the Railway deploy (founder's dashboard step).
- This phase TOUCHES the auth gate + a spend path → the phase gate is **Codex + independent workflow QA + money-safety review** (all three).
- Cross-tenant credit grant = **super-admin only** (`tenants/mutate`), NOT finance (locked decision). finance keeps founder-org self-service via the existing `/admin/credits`.
- Suspend = soft (deny next `requireOwner`; in-flight jobs finish + charge — documented) PLUS an immediate "cut sessions" action (locked decision).
- `allowed()` becomes async (env ∪ DB). EVERY caller must `await` it — a missed await opens the allowlist (`!Promise` === false). Founder env (`FOUNDER_ADMIN_EMAILS` ∪ `AUTH_ALLOWED_EMAILS`) is checked FIRST so the DB can never lock the founder out. The `session()` callback stays sync and never calls `allowed()`/DB.
- `AllowedEmail.email` lowercased at write + compare.
- TDD; surgical; match existing patterns.

---

### Task 1: `allowed()` → async (env ∪ DB) + convert every caller

**Files:**
- Modify: `apps/web/auth.ts:32-39` (allowed) + `:102-105` (signIn callback)
- Modify: `apps/web/lib/auth-guard.ts:12, 27, 52` (the three guards)
- Modify: `apps/web/app/admin/layout.tsx:27`, `apps/web/app/library/page.tsx:10`, `apps/web/app/files/[...key]/route.ts:17`
- Test: `apps/web/lib/__tests__/allowed.test.ts` (new)

**Interfaces:**
- Produces: `export async function allowed(email): Promise<boolean>` — true if email ∈ (`FOUNDER_ADMIN_EMAILS` ∪ `AUTH_ALLOWED_EMAILS`) OR an `AllowedEmail` row exists with `status !== "revoked"`. Founder env wins before any DB read.

- [ ] **Step 1: Write the failing test** (`apps/web/lib/__tests__/allowed.test.ts`)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const findUnique = vi.fn();
vi.mock("@fikirtive/db", () => ({ prisma: { allowedEmail: { findUnique } } }));
const { allowed } = await import("@/auth"); // NOTE: importing @/auth needs the vitest next/server + server-only stubs already configured in vitest.config
beforeEach(() => { findUnique.mockReset(); process.env.AUTH_ALLOWED_EMAILS = "founder@x"; process.env.FOUNDER_ADMIN_EMAILS = "founder@x"; });

it("env allowlist passes without a DB read", async () => {
  expect(await allowed("founder@x")).toBe(true);
  expect(findUnique).not.toHaveBeenCalled();
});
it("DB-invited email passes (status != revoked)", async () => {
  findUnique.mockResolvedValue({ email: "m@x", status: "invited" });
  expect(await allowed("m@x")).toBe(true);
});
it("revoked DB email is denied", async () => {
  findUnique.mockResolvedValue({ email: "m@x", status: "revoked" });
  expect(await allowed("m@x")).toBe(false);
});
it("unknown email denied; null denied", async () => {
  findUnique.mockResolvedValue(null);
  expect(await allowed("nobody@x")).toBe(false);
  expect(await allowed(null)).toBe(false);
});
it("founder passes even if absent from DB and AUTH_ALLOWED_EMAILS", async () => {
  process.env.AUTH_ALLOWED_EMAILS = ""; process.env.FOUNDER_ADMIN_EMAILS = "founder@x";
  expect(await allowed("founder@x")).toBe(true);
  expect(findUnique).not.toHaveBeenCalled();
});
```
NOTE: if importing `@/auth` under vitest is impractical (it pulls next-auth), EXTRACT the allow logic into a pure `apps/web/lib/allowlist.ts` (`async function isAllowedEmail(email, prisma)`), unit-test that, and have `auth.ts` `allowed()` delegate to it. Prefer extraction — it makes the gate testable without next-auth. Adjust the test import accordingly.

- [ ] **Step 2: Run → fails.** `cd apps/web && npx vitest run lib/__tests__/allowed.test.ts`

- [ ] **Step 3: Implement.** Make `allowed` async, env-first then DB:
```ts
export async function allowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  const envList = (s?: string) => (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  // founder + env allowlist win first — the DB can never lock these out (anti-lockout)
  if (envList(process.env.FOUNDER_ADMIN_EMAILS).includes(e)) return true;
  if (envList(process.env.AUTH_ALLOWED_EMAILS).includes(e)) return true;
  // DB-backed invite allowlist (added via the admin invite action); revoked = denied
  const row = await prisma.allowedEmail.findUnique({ where: { email: e }, select: { status: true } });
  return !!row && row.status !== "revoked";
}
```
Add `import { prisma } from "@fikirtive/db";` if not present (it is). Then convert EVERY caller to `await allowed(...)`:
- `auth.ts` signIn callback: `async signIn({ user }) { return await allowed(user?.email); }`
- `auth-guard.ts` lines 12, 27, 52: `if (!email || !(await allowed(email)))`
- `admin/layout.tsx:27`: `if (!(await allowed(session?.user?.email))) redirect("/login");`
- `library/page.tsx:10`: same `await`
- `files/[...key]/route.ts:17`: same `await`
(All these call sites are already inside `async` functions.)

- [ ] **Step 4: Run → passes.** Then grep-guard: `grep -rn "allowed(" apps/web --include=*.ts --include=*.tsx | grep -v "await allowed(" | grep -v "function allowed" | grep -v "isAllowedEmail"` — every hit must be a definition/comment, never a bare call.

- [ ] **Step 5: Verify full gate stays green.** `cd apps/web && npx tsc --noEmit` + run the existing auth/isolation suite with `DATABASE_URL`. Commit deferred to the phase gate.

---

### Task 2: `bootstrapPersonalOrg` must not auto-revive suspended/revoked

**Files:** Modify `apps/web/lib/auth-guard.ts:92-96` (the membership upsert). Test: `apps/web/lib/__tests__/require-owner.test.ts` (extend — it already exercises bootstrap with a real DB).

**Interfaces:** Produces: bootstrap leaves an existing `suspended`/`revoked` membership's `status` untouched (only revives `deletedAt`).

- [ ] **Step 1: Write the failing test** (in require-owner.test.ts, real DB): suspend a user's membership (`status:"suspended"`), call `bootstrapPersonalOrg(userId, email)`, assert the membership status is STILL `"suspended"` (not flipped to active).

- [ ] **Step 2: Run → fails** (current upsert sets `status:"active"`).

- [ ] **Step 3: Implement.** In the membership upsert, drop `status: "active"` from the `update` (keep the soft-delete revive):
```ts
await tx.membership.upsert({
  where: { userId_orgId: { userId, orgId } },
  create: { id: newId(), userId, orgId, role: "owner" },
  update: { deletedAt: null }, // revive a soft-deleted membership, but NEVER auto-reactivate a suspended/revoked one
});
```

- [ ] **Step 4: Run → passes.** Confirm normal (active) re-login still works (the create path + the deletedAt-revive path unchanged).

---

### Task 3: `requireOwner()` denies suspended/revoked

**Files:** Modify `apps/web/lib/auth-guard.ts:61-73`. Test: `require-owner.test.ts`.

**Interfaces:** Produces: a suspended/revoked member resolves to `{ error: "Your access is suspended." }`; active → their org; none → bootstrap; founder-admin → "founder" (unchanged, still first).

- [ ] **Step 1: Write the failing test:** an allowlisted non-founder whose membership is `status:"suspended"` → `requireOwner()` returns `{ error }` (NOT a bootstrapped org id). And a `status:"active"` member → returns their org. And a brand-new user (no membership) → bootstraps.

- [ ] **Step 2: Run → fails** (current code filters `status:"active"` then bootstraps → a suspended user gets a fresh org).

- [ ] **Step 3: Implement.** Replace the membership lookup (keep the `isFounderAdmin` early-return ABOVE it untouched):
```ts
  // status-agnostic: find the user's non-founder membership regardless of status, so a
  // suspended/revoked member is denied here instead of being handed a fresh bootstrapped org.
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, deletedAt: null, orgId: { not: FOUNDER_OWNER_ID } },
    orderBy: { createdAt: "asc" },
    select: { orgId: true, status: true },
  });
  if (existing) {
    if (existing.status === "suspended" || existing.status === "revoked") return { error: "Your access is suspended." };
    return { email, ownerId: existing.orgId };
  }
  // No membership yet → bootstrap a personal org synchronously.
  const ownerId = await bootstrapPersonalOrg(user.id, email);
  if (!ownerId) return { error: "Could not set up your workspace — please retry." };
  return { email, ownerId };
```

- [ ] **Step 4: Run → passes.** Re-run the full isolation suite (2-org test must stay green).

---

### Task 4: Tenant control actions — suspend/resume, cut sessions, invite/revoke

**Files:** Create `apps/web/lib/tenant-actions.ts` (`"use server"`). Test: `apps/web/lib/__tests__/tenant-actions.test.ts`.

**Interfaces:** Produces (all `requireRole("tenants","mutate")` = super-admin; all audited; all return `{ ok: true } | { error }`):
- `setMembershipStatus(orgId, status: "active"|"suspended")` — updateMany Membership where orgId.
- `cutTenantSessions(orgId)` — delete `Session` rows for the org's member users (immediate logout).
- `inviteTenant(emailRaw)` — upsert `AllowedEmail` (lowercased, status "invited", invitedBy operator).
- `revokeTenantInvite(emailRaw)` — set `AllowedEmail.status = "revoked"`.

- [ ] **Step 1: Write failing tests** (mock requireRole + prisma): each action denies non-super-admin (requireRole error passes through); setMembershipStatus rejects an invalid status; inviteTenant lowercases the email; revoke sets status revoked; cutTenantSessions deletes sessions for the org's users only. (Model on `apps/web/lib/__tests__/account-actions.test.ts` mock style.)

- [ ] **Step 2: Run → fails** (module missing).

- [ ] **Step 3: Implement** `apps/web/lib/tenant-actions.ts`:
```ts
"use server";
import { prisma } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { revalidatePath } from "next/cache";

const ORG_STATUS = new Set(["active", "suspended"]);

export async function setMembershipStatus(orgId: string, status: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  if (!ORG_STATUS.has(status)) return { error: "Invalid status." };
  const { count } = await prisma.membership.updateMany({ where: { orgId }, data: { status } });
  if (count === 0) return { error: "No memberships for that org." };
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.status", payload: { orgId, status, via: gate.email } } }).catch(() => {});
  // mirror to the target org so the per-merchant audit shows it too
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "tenant.status", payload: { status, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`); revalidatePath("/admin/tenants");
  return { ok: true };
}

export async function cutTenantSessions(orgId: string): Promise<{ ok: true; cut: number } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  if (typeof orgId !== "string" || !orgId || orgId === FOUNDER_OWNER_ID) return { error: "Invalid org." };
  const members = await prisma.membership.findMany({ where: { orgId }, select: { userId: true } });
  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return { ok: true, cut: 0 };
  const { count } = await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.cut", payload: { orgId, cut: count, via: gate.email } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, cut: count };
}

function normEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null;
}

export async function inviteTenant(emailRaw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  const email = normEmail(emailRaw); if (!email) return { error: "Enter a valid email." };
  await prisma.allowedEmail.upsert({ where: { email }, create: { email, status: "invited", invitedBy: gate.email }, update: { status: "invited" } });
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.invite", payload: { email, via: gate.email } } }).catch(() => {});
  revalidatePath("/admin/tenants");
  return { ok: true };
}

export async function revokeTenantInvite(emailRaw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate;
  const email = normEmail(emailRaw); if (!email) return { error: "Invalid email." };
  const { count } = await prisma.allowedEmail.updateMany({ where: { email }, data: { status: "revoked" } });
  if (count === 0) return { error: "No such invite." };
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.revoke", payload: { email, via: gate.email } } }).catch(() => {});
  revalidatePath("/admin/tenants");
  return { ok: true };
}
```
VERIFY while implementing: the next-auth `Session` model name + `userId` field in `schema.prisma` (PrismaAdapter standard: `model Session { sessionToken, userId, expires }`). Adjust `prisma.session` if the model differs.

- [ ] **Step 4: Run → passes.** `tsc --noEmit` clean.

---

### Task 5: Per-org credit grant (super-admin + org validation + dual audit)

**Files:** Add `grantTenantCredits` to `apps/web/lib/tenant-actions.ts`. Test: `tenant-actions.test.ts`.

**Interfaces:** Produces `grantTenantCredits(raw: { orgId, displayedAmount, reason, idempotencyKey })` — `requireRole("tenants","mutate")` (super-admin, NOT finance); validates the target Organization exists AND `deletedAt == null` (else `{ error: "Unknown or closed org." }`, never founder fallback); calls `grantCredits({ orgId, amount: displayedAmount*INTERNAL_PER_DISPLAY, ... })`; writes a founder-org audit + a target-org audit.

- [ ] **Step 1: Write failing tests** (mock requireRole + prisma + grantCredits): denies non-super-admin; rejects a missing/`deletedAt`-set org (no grant called); rejects orgId === FOUNDER_OWNER_ID (founder top-up stays on /admin/credits); converts displayed→internal (×10); idempotencyKey validated; on success calls grantCredits with the target orgId + writes two audit events (ownerId founder + ownerId target).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** (mirror `credit-actions.ts` validation; gate on tenants/mutate; add org check):
```ts
import { grantCredits, InsufficientCredits } from "@fikirtive/db";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

export async function grantTenantCredits(raw: unknown): Promise<{ ok: true; duplicate?: boolean } | { error: string }> {
  const gate = await requireRole("tenants", "mutate"); if ("error" in gate) return gate; // super-admin only (cross-tenant minting)
  const v = raw as { orgId?: unknown; displayedAmount?: unknown; reason?: unknown; idempotencyKey?: unknown };
  const orgId = typeof v?.orgId === "string" ? v.orgId : "";
  if (!orgId || orgId === FOUNDER_OWNER_ID) return { error: "Pick a merchant org (founder top-up uses /admin/credits)." };
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null }, select: { id: true } });
  if (!org) return { error: "Unknown or closed org." }; // NEVER fall back to founder
  const displayedAmount = typeof v?.displayedAmount === "number" ? v.displayedAmount : NaN;
  if (!Number.isInteger(displayedAmount) || displayedAmount === 0 || Math.abs(displayedAmount) > 1_000_000) return { error: "Enter a non-zero whole number of credits (max ±1,000,000)." };
  const reason = typeof v?.reason === "string" ? v.reason.slice(0, 500) : "";
  const idempotencyKey = typeof v?.idempotencyKey === "string" ? v.idempotencyKey : "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) return { error: "Invalid request." };
  const amount = displayedAmount * INTERNAL_PER_DISPLAY;
  let res: Awaited<ReturnType<typeof grantCredits>>;
  try {
    res = await grantCredits({ orgId, amount, reason, source: "ADMIN", createdBy: gate.email, idempotencyKey });
  } catch (e) {
    if (e instanceof InsufficientCredits) return { error: "That adjustment would drive the balance negative (or the account doesn't exist)." };
    throw e;
  }
  const dup = "duplicate" in res;
  // dual audit: platform trail (founder) + per-merchant trail (so the tenant drill-down shows who topped them up)
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.grant", payload: { orgId, displayedAmount, amount, reason, via: gate.email, duplicate: dup } } }).catch(() => {});
  await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "credits.grant", payload: { displayedAmount, amount, reason, via: gate.email, duplicate: dup } } }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, duplicate: dup };
}
```

- [ ] **Step 4: Run → passes.** `tsc --noEmit` clean.

---

### Task 6: Wire control UI into the tenant pages

**Files:** Modify `apps/web/components/admin/TenantDetail.tsx` (grant form + suspend/resume + cut buttons), `apps/web/components/admin/TenantsAdmin.tsx` (invite form + revoke button). The pages already pass the data; add client-side action calls (mirror `CreditsAdmin.tsx` form pattern: `useState` busy/error, call the action, `router.refresh()` on success, client-generated `idempotencyKey` for grant via `crypto.randomUUID()`).

- [ ] **Step 1:** In `TenantDetail.tsx`: add a Grant form (displayed-credits number + reason + submit → `grantTenantCredits({ orgId, displayedAmount, reason, idempotencyKey: crypto.randomUUID() })`), a Suspend/Resume button (`setMembershipStatus(orgId, status==="suspended"?"active":"suspended")`), a "Cut sessions" button (`cutTenantSessions(orgId)` with a confirm). Busy/error states; `router.refresh()` on success.
- [ ] **Step 2:** In `TenantsAdmin.tsx`: add an Invite form (email → `inviteTenant`) and a Revoke button on each invited row (`revokeTenantInvite(email)`).
- [ ] **Step 3:** `tsc --noEmit` + `npm run build` clean; `/admin/tenants` + `[orgId]` still render.

---

### Task 7: P2 triple gate (Codex + workflow QA + money-safety) → fix → commit/push

- [ ] **Step 1: Self-verify:** `pnpm -r typecheck`; `cd apps/web && DATABASE_URL=<local> npx vitest run lib/__tests__/`; `pnpm --filter @fikirtive/core test`; `cd apps/web && npm run build`. All green.
- [ ] **Step 2: Codex** review the P2 diff — auth-gate + money-safety lens. Resolve every [P1].
- [ ] **Step 3: Independent workflow QA** — dimensions: auth-gate safety (suspend sticks across signIn; allowed() every caller awaited; founder anti-lockout), money-safety (per-org grant: org validation, super-admin gate, idempotency, no founder fallback, negative-adjust), tenant-isolation, completeness vs spec. Verify each finding. Resolve confirmed BLOCKER/STRONG.
- [ ] **Step 4: money-safety-review** standard on the grant path.
- [ ] **Step 5:** Fix all confirmed findings (one combined fix wave). Re-verify.
- [ ] **Step 6:** Commit (surgical — P2 files only) + push. Then CEO-style report; proceed to P3.

## Self-Review (against spec)
- Covers spec P2: bootstrap suspend fix (T2) + requireOwner deny (T3) + allowed env∪DB all-callers + async signIn (T1) + suspend/resume + immediate cut (T4) + per-org grant super-admin/validation/dual-audit (T5) + invite/revoke (T4) + UI (T6). Gate T7 = Codex + workflow + money-safety.
- Anti-lockout: founder env checked first in allowed() (T1); isFounderAdmin early-return kept first in requireOwner (T3).
- The async-allowed footgun is handled by the grep-guard (T1 step 4) + tests.
- Implementation checks flagged: extract allowlist logic if @/auth won't import under vitest (T1); confirm next-auth Session model shape (T4).
