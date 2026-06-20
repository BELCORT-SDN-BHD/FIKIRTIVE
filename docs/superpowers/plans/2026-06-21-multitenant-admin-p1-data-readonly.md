# Multi-tenant Admin Console — P1 (Data + Read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a read-only `/admin/tenants` console (super-admin) that lists every merchant org and drills into one org's credits/usage/spend/audit — plus the `AllowedEmail` table that P2's invite flow will write. No auth/spend behavior change in P1.

**Architecture:** Mirror the existing admin pattern exactly: a `force-dynamic` server-component page gated by `requireRole("tenants", "read")` that fetches via a new server-only data module and renders a `@/components/admin/*` client component. Cross-tenant reads use the tenant (`Organization`/`Membership`/`CreditAccount`) tables + guard-exempt `count`/`aggregate`/`groupBy` pinned to `ownerId` — never an owner-scoped `findMany` without `ownerId`.

**Tech Stack:** Next.js (app router, RSC + server actions), Prisma 7 (driver-adapter), `@artlio/core` (roles), `@artlio/db` (prisma), vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-multitenant-admin-console-design.md`

## Global Constraints
- Single `main` branch; no feature branches. Do NOT commit/push unless the user asks (house rule).
- Additive migrations only; migrations are **hand-authored** (do NOT run `prisma migrate dev` — it is blocked + would touch the DB). Prod applies on push via pre-deploy `migrate deploy`.
- `tenants` section is **super-admin only** (empty matrix sets → super-admin via supersede), mirroring `team`.
- P1 is **read-only**: no change to `requireOwner`/`allowed`/`bootstrapPersonalOrg`/any spend path. Those are P2.
- Cross-tenant reads: per-org detail counts/spend use `count()`/`aggregate()`/`groupBy` (guard-exempt) pinned `where: { ownerId: orgId }`; the org list reads `Organization`/`Membership`/`CreditAccount` (not owner-scoped business tables).
- `AllowedEmail.email` stored + compared LOWERCASED.
- Phase ends with the standard double gate: Codex + workflow QA (Task 6).

---

### Task 1: Add the `tenants` RBAC section (super-admin only)

**Files:**
- Modify: `packages/core/src/roles.ts:21` (SECTIONS) + `:35-43` (SECTION_MATRIX)
- Test: `packages/core/src/__tests__/roles.test.ts` (or the existing roles test file — search for `roleAllows`)

**Interfaces:**
- Produces: `Section` now includes `"tenants"`; `roleAllows(role, "tenants", "read"|"mutate")` is `true` only for `super-admin`.

- [ ] **Step 1: Write the failing test**

In the roles test file, add:
```ts
import { roleAllows } from "../roles";

describe("tenants section (super-admin only)", () => {
  it("only super-admin may read/mutate tenants", () => {
    expect(roleAllows("super-admin", "tenants", "read")).toBe(true);
    expect(roleAllows("super-admin", "tenants", "mutate")).toBe(true);
    for (const r of ["ops", "finance", "moderator", "viewer"] as const) {
      expect(roleAllows(r, "tenants", "read")).toBe(false);
      expect(roleAllows(r, "tenants", "mutate")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @artlio/core test -- roles`
Expected: FAIL (`"tenants"` not a valid Section / matrix key undefined).

- [ ] **Step 3: Add the section + matrix row**

In `packages/core/src/roles.ts`, add `"tenants"` to `SECTIONS`:
```ts
export const SECTIONS = ["model", "cost", "content", "team", "system", "knowledge", "credits", "tenants"] as const;
```
Add the matrix row (super-admin only, via supersede — empty sets, mirrors `team`):
```ts
  tenants:   { read: new Set(),                  mutate: new Set() },               // ⑧ Tenant management — super-admin only (cross-tenant merchant ops)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @artlio/core test -- roles`
Expected: PASS. Also run the full core suite (`pnpm --filter @artlio/core test`) — fix any test that asserts a fixed section count (was 7 → now 8).

- [ ] **Step 5: Rebuild core so web sees the new Section type**

Run: `pnpm --filter @artlio/core build`
(Existing quirk: web type-checks against the built `@artlio/core` dist.)

- [ ] **Step 6: Commit** (only if the user has authorized committing this phase)

```bash
git add packages/core/src/roles.ts packages/core/src/__tests__/roles.test.ts
git commit -m "feat(tenants): add tenants RBAC section (super-admin only)"
```

---

### Task 2: `AllowedEmail` table + `Organization` list index (hand-authored migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add `AllowedEmail` model; add `@@index` to `Organization`)
- Create: `packages/db/prisma/migrations/20260621120000_tenant_admin/migration.sql`

**Interfaces:**
- Produces: `prisma.allowedEmail` model (`email` PK, `status`, `invitedBy`, `createdAt`, `updatedAt`); `Organization` gains a `createdAt`-leading list index.

- [ ] **Step 1: Add the model + index to schema.prisma**

Add near the other tenancy models:
```prisma
model AllowedEmail {
  email     String   @id // LOWERCASED at write + compare (mirrors env allowlist normalization)
  status    String   @default("invited") // invited | active | revoked
  invitedBy String // operator email (audit)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```
In `model Organization`, add (for the merchant-list sort, scoped to live orgs):
```prisma
  @@index([deletedAt, createdAt], map: "Organization_list_idx")
```

- [ ] **Step 2: Validate the schema (read-only, no DB)**

Run: `cd packages/db && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 3: Hand-author the migration SQL**

Create `packages/db/prisma/migrations/20260621120000_tenant_admin/migration.sql`:
```sql
-- Tenant admin (P1): DB-backed invite allowlist + Organization list index. Additive only.

-- CreateTable
CREATE TABLE "AllowedEmail" (
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AllowedEmail_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "Organization_list_idx" ON "Organization"("deletedAt", "createdAt");
```

- [ ] **Step 4: Regenerate the Prisma client + typecheck db**

Run: `pnpm --filter @artlio/db build`
Expected: client regenerates (so `prisma.allowedEmail` exists); `tsc` clean.

- [ ] **Step 5: Commit** (if authorized)

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260621120000_tenant_admin
git commit -m "feat(tenants): AllowedEmail table + Organization list index (additive migration)"
```

---

### Task 3: Tenant-admin read data layer

**Files:**
- Create: `apps/web/lib/tenant-admin.ts` (server-only)
- Test: `apps/web/lib/__tests__/tenant-admin.test.ts`

**Interfaces:**
- Produces:
  - `type TenantRow = { orgId: string; name: string; ownerEmail: string; status: string; balance: number; genCount: number; lastActiveAt: string | null }`
  - `type InvitedRow = { email: string; status: string; invitedBy: string; createdAt: string }`
  - `type TenantDetail = { orgId: string; name: string; ownerEmail: string; status: string; balance: number; reserved: number; spentUsd: number; projectCount: number; genCount: number; ledger: { id: string; kind: string; displayedDelta: number; reason: string; createdAt: string }[]; audit: { id: string; type: string; createdAt: string }[] }`
  - `async function listTenants(): Promise<{ tenants: TenantRow[]; invited: InvitedRow[] }>`
  - `async function getTenantDetail(orgId: string): Promise<TenantDetail | null>`
- Consumes: `prisma` (`@artlio/db`), `displayCredits`, `FOUNDER_OWNER_ID`, `genSpentUsd`-style cost (use stored `GenJob.spentUsd`/`RefGenJob.spentUsd` sums — record-only true cost), `displayCredits` from `@artlio/core`.

- [ ] **Step 1: Write the failing test** (unit, mocked prisma — pins tenant-scoping + mapping)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const groupBy = vi.fn();
const orgFindMany = vi.fn();
const membershipFindMany = vi.fn();
const creditAccountFindMany = vi.fn();
const allowedFindMany = vi.fn();
vi.mock("@artlio/db", () => ({
  prisma: {
    organization: { findMany: orgFindMany },
    membership: { findMany: membershipFindMany },
    creditAccount: { findMany: creditAccountFindMany },
    allowedEmail: { findMany: allowedFindMany },
    generation: { groupBy },
  },
}));
const { listTenants } = await import("@/lib/tenant-admin");

beforeEach(() => { [groupBy, orgFindMany, membershipFindMany, creditAccountFindMany, allowedFindMany].forEach((m) => m.mockReset()); });

it("listTenants joins org + owner + balance + gen aggregate, newest-first", async () => {
  orgFindMany.mockResolvedValue([{ id: "orgA", name: "merchant-a@x", createdAt: new Date("2026-06-20T00:00:00Z"), deletedAt: null }]);
  membershipFindMany.mockResolvedValue([{ orgId: "orgA", status: "active", user: { email: "merchant-a@x" } }]);
  creditAccountFindMany.mockResolvedValue([{ orgId: "orgA", balance: 9990 }]);
  groupBy.mockResolvedValue([{ ownerId: "orgA", _count: { _all: 12 }, _max: { createdAt: new Date("2026-06-20T05:00:00Z") } }]);
  allowedFindMany.mockResolvedValue([]);

  const { tenants } = await listTenants();
  expect(tenants[0]).toMatchObject({ orgId: "orgA", ownerEmail: "merchant-a@x", status: "active", balance: 999, genCount: 12 });
  expect(tenants[0].lastActiveAt).toBe("2026-06-20T05:00:00.000Z");
  // the gen aggregate is guard-exempt groupBy pinned to live rows
  expect(groupBy.mock.calls[0][0]).toMatchObject({ by: ["ownerId"], where: { deletedAt: null } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/tenant-admin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the data layer**

Create `apps/web/lib/tenant-admin.ts`:
```ts
import "server-only";
import { prisma } from "@artlio/db";
import { displayCredits, FOUNDER_OWNER_ID } from "@artlio/core";

export type TenantRow = { orgId: string; name: string; ownerEmail: string; status: string; balance: number; genCount: number; lastActiveAt: string | null };
export type InvitedRow = { email: string; status: string; invitedBy: string; createdAt: string };
export type TenantDetail = {
  orgId: string; name: string; ownerEmail: string; status: string;
  balance: number; reserved: number; spentUsd: number; projectCount: number; genCount: number;
  ledger: { id: string; kind: string; displayedDelta: number; reason: string; createdAt: string }[];
  audit: { id: string; type: string; createdAt: string }[];
};

/** Cross-tenant LIST: reads tenant tables (Organization/Membership/CreditAccount) + a
 *  guard-exempt groupBy over live Generations for count + last-active. Excludes the
 *  founder platform org. */
export async function listTenants(): Promise<{ tenants: TenantRow[]; invited: InvitedRow[] }> {
  const [orgs, memberships, accounts, genAgg, invitedRows] = await Promise.all([
    prisma.organization.findMany({ where: { id: { not: FOUNDER_OWNER_ID }, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, createdAt: true } }),
    prisma.membership.findMany({ where: { orgId: { not: FOUNDER_OWNER_ID }, deletedAt: null }, select: { orgId: true, status: true, user: { select: { email: true } } } }),
    prisma.creditAccount.findMany({ select: { orgId: true, balance: true } }),
    prisma.generation.groupBy({ by: ["ownerId"], where: { deletedAt: null }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.allowedEmail.findMany({ orderBy: { createdAt: "desc" }, select: { email: true, status: true, invitedBy: true, createdAt: true } }),
  ]);
  const ownerByOrg = new Map(memberships.map((m) => [m.orgId, m]));
  const balByOrg = new Map(accounts.map((a) => [a.orgId, a.balance]));
  const genByOrg = new Map(genAgg.map((g) => [g.ownerId, g]));
  const tenants: TenantRow[] = orgs.map((o) => {
    const m = ownerByOrg.get(o.id);
    const g = genByOrg.get(o.id);
    return {
      orgId: o.id,
      name: o.name,
      ownerEmail: m?.user?.email ?? "",
      status: m?.status ?? "unknown",
      balance: displayCredits(balByOrg.get(o.id) ?? 0),
      genCount: g?._count?._all ?? 0,
      lastActiveAt: g?._max?.createdAt ? g._max.createdAt.toISOString() : null,
    };
  });
  const invited: InvitedRow[] = invitedRows.map((r) => ({ email: r.email, status: r.status, invitedBy: r.invitedBy, createdAt: r.createdAt.toISOString() }));
  return { tenants, invited };
}

/** Per-merchant DETAIL: every owner-scoped read is pinned where:{ ownerId: orgId };
 *  counts/spend use count()/aggregate() (guard-exempt) pinned to the org. */
export async function getTenantDetail(orgId: string): Promise<TenantDetail | null> {
  if (orgId === FOUNDER_OWNER_ID) return null; // founder is the platform org, not a managed tenant
  const org = await prisma.organization.findFirst({ where: { id: orgId, deletedAt: null }, select: { id: true, name: true } });
  if (!org) return null;
  const [membership, account, ledgerRows, spend, projectCount, genCount, auditRows] = await Promise.all([
    prisma.membership.findFirst({ where: { orgId, deletedAt: null }, select: { status: true, user: { select: { email: true } } } }),
    prisma.creditAccount.findUnique({ where: { orgId }, select: { balance: true, reserved: true } }),
    prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, kind: true, balanceDelta: true, reason: true, createdAt: true } }),
    prisma.genJob.aggregate({ where: { ownerId: orgId }, _sum: { spentUsd: true } }),
    prisma.project.count({ where: { ownerId: orgId, deletedAt: null } }),
    prisma.generation.count({ where: { ownerId: orgId, deletedAt: null } }),
    prisma.actionEvent.findMany({ where: { ownerId: orgId }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, type: true, createdAt: true } }),
  ]);
  return {
    orgId: org.id,
    name: org.name,
    ownerEmail: membership?.user?.email ?? "",
    status: membership?.status ?? "unknown",
    balance: displayCredits(account?.balance ?? 0),
    reserved: displayCredits(account?.reserved ?? 0),
    spentUsd: spend._sum.spentUsd ?? 0,
    projectCount,
    genCount,
    ledger: ledgerRows.map((l) => ({ id: l.id, kind: l.kind, displayedDelta: displayCredits(l.balanceDelta), reason: l.reason, createdAt: l.createdAt.toISOString() })),
    audit: auditRows.map((a) => ({ id: a.id, type: a.type, createdAt: a.createdAt.toISOString() })),
  };
}
```
NOTE: confirm `GenJob.spentUsd` is a non-BigInt numeric column (the cost ledger uses it). If it is `Decimal`/BigInt, coerce to `Number(...)` before returning (client-safe). Verify against `packages/db/prisma/schema.prisma` while implementing; adjust the `_sum` handling accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/tenant-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a cross-tenant isolation assertion**

Append to `apps/web/lib/__tests__/isolation.test.ts` (integration, real DB) a check that `getTenantDetail(orgB)` returns only orgB's data (ownerEmail/balance match B, not A). Run with `DATABASE_URL` set (see existing isolation test runner).

- [ ] **Step 6: Commit** (if authorized)

```bash
git add apps/web/lib/tenant-admin.ts apps/web/lib/__tests__/tenant-admin.test.ts apps/web/lib/__tests__/isolation.test.ts
git commit -m "feat(tenants): read data layer (listTenants + getTenantDetail), ownerId-pinned"
```

---

### Task 4: `/admin/tenants` list page + nav entry

**Files:**
- Create: `apps/web/app/admin/tenants/page.tsx`
- Create: `apps/web/components/admin/TenantsAdmin.tsx`
- Modify: `apps/web/app/admin/layout.tsx:13-23` (add nav entry)

**Interfaces:**
- Consumes: `requireRole` (`@/lib/auth-guard`), `listTenants` + `TenantRow`/`InvitedRow` (`@/lib/tenant-admin`).

- [ ] **Step 1: Add the nav entry**

In `apps/web/app/admin/layout.tsx` NAV array, add (after Team):
```ts
  { href: "/admin/tenants", label: "Tenants", live: true },
```

- [ ] **Step 2: Write the list page (super-admin gate, mirrors team/page.tsx)**

Create `apps/web/app/admin/tenants/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-guard";
import { listTenants } from "@/lib/tenant-admin";
import { TenantsAdmin } from "@/components/admin/TenantsAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenants · Artlio admin" };

export default async function TenantsPage() {
  // §⑧ Tenants — super-admin only (matrix). requireRole audits a denied read.
  const gate = await requireRole("tenants", "read");
  if ("error" in gate) redirect("/login?from=/admin/tenants");
  const { tenants, invited } = await listTenants();
  return <TenantsAdmin tenants={tenants} invited={invited} />;
}
```

- [ ] **Step 3: Write the client component (read-only tables)**

Create `apps/web/components/admin/TenantsAdmin.tsx`:
```tsx
"use client";
import Link from "next/link";
import type { TenantRow, InvitedRow } from "@/lib/tenant-admin";

export function TenantsAdmin({ tenants, invited }: { tenants: TenantRow[]; invited: InvitedRow[] }) {
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: "0 0 12px" }}>Tenants</h1>
        {tenants.length === 0 ? (
          <p style={{ font: "var(--text-body)", color: "var(--fg-3)" }}>No merchant orgs yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", font: "var(--text-small)" }}>
            <thead><tr style={{ textAlign: "left", color: "var(--fg-3)" }}>
              <th>Merchant</th><th>Status</th><th>Credits</th><th>Gens</th><th>Last active</th>
            </tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.orgId} style={{ borderTop: "1px solid var(--line-2)" }}>
                  <td><Link href={`/admin/tenants/${t.orgId}`} style={{ color: "var(--fg-1)" }}>{t.ownerEmail || t.name || t.orgId}</Link></td>
                  <td style={{ color: t.status === "suspended" || t.status === "revoked" ? "var(--danger)" : "var(--fg-2)" }}>{t.status}</td>
                  <td>{t.balance.toLocaleString()}</td>
                  <td>{t.genCount}</td>
                  <td style={{ color: "var(--fg-3)" }}>{t.lastActiveAt ? new Date(t.lastActiveAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "0 0 8px" }}>Invited (not yet signed in)</h2>
        {invited.filter((i) => i.status !== "active").length === 0 ? (
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>None.</p>
        ) : (
          <ul style={{ font: "var(--text-small)", color: "var(--fg-2)" }}>
            {invited.filter((i) => i.status !== "active").map((i) => (
              <li key={i.email}>{i.email} — {i.status} (by {i.invitedBy})</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd apps/web && npx tsc --noEmit` then `npm run build`
Expected: clean compile; `/admin/tenants` appears in the route table.

- [ ] **Step 5: Commit** (if authorized)

```bash
git add apps/web/app/admin/tenants/page.tsx apps/web/components/admin/TenantsAdmin.tsx apps/web/app/admin/layout.tsx
git commit -m "feat(tenants): /admin/tenants list page + nav"
```

---

### Task 5: `/admin/tenants/[orgId]` read-only detail page

**Files:**
- Create: `apps/web/app/admin/tenants/[orgId]/page.tsx`
- Create: `apps/web/components/admin/TenantDetail.tsx`

**Interfaces:**
- Consumes: `requireRole`, `getTenantDetail` + `TenantDetail` (`@/lib/tenant-admin`).

- [ ] **Step 1: Write the detail page (super-admin gate, async params)**

Create `apps/web/app/admin/tenants/[orgId]/page.tsx`:
```tsx
import { redirect, notFound } from "next/navigation";
import { requireRole } from "@/lib/auth-guard";
import { getTenantDetail } from "@/lib/tenant-admin";
import { TenantDetail } from "@/components/admin/TenantDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenant · Artlio admin" };

export default async function TenantDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireRole("tenants", "read");
  if ("error" in gate) redirect("/login?from=/admin/tenants");
  const { orgId } = await params;
  const detail = await getTenantDetail(orgId);
  if (!detail) notFound();
  return <TenantDetail detail={detail} />;
}
```
(Confirm the app's Next.js version takes `params` as a Promise — `apps/web/AGENTS.md` warns this Next.js differs; the studio page already uses `searchParams: Promise<…>`, so async params is the established shape.)

- [ ] **Step 2: Write the client component (read-only)**

Create `apps/web/components/admin/TenantDetail.tsx`:
```tsx
"use client";
import Link from "next/link";
import type { TenantDetail as Detail } from "@/lib/tenant-admin";

export function TenantDetail({ detail }: { detail: Detail }) {
  const usd = detail.spentUsd.toLocaleString(undefined, { style: "currency", currency: "USD" });
  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 760 }}>
      <Link href="/admin/tenants" style={{ font: "var(--text-small)", color: "var(--fg-3)" }}>← Tenants</Link>
      <header>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>{detail.ownerEmail || detail.name}</h1>
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: "4px 0 0" }}>{detail.orgId} · {detail.status}</p>
      </header>
      <section style={{ display: "flex", gap: 24, font: "var(--text-body)", color: "var(--fg-2)" }}>
        <div><b style={{ color: "var(--fg-1)" }}>{detail.balance.toLocaleString()}</b> credits {detail.reserved > 0 ? `(${detail.reserved} held)` : ""}</div>
        <div>true cost: {usd}</div>
        <div>{detail.projectCount} projects · {detail.genCount} gens</div>
      </section>
      <section>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)" }}>Credit activity</h2>
        {detail.ledger.length === 0 ? <p style={{ color: "var(--fg-3)" }}>None.</p> : (
          <ul style={{ font: "var(--text-small)", color: "var(--fg-2)" }}>
            {detail.ledger.map((l) => <li key={l.id}>{new Date(l.createdAt).toLocaleDateString()} · {l.reason || l.kind} · {l.displayedDelta > 0 ? "+" : ""}{l.displayedDelta}</li>)}
          </ul>
        )}
      </section>
      <section>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)" }}>Recent audit</h2>
        <ul style={{ font: "var(--text-small)", color: "var(--fg-3)" }}>
          {detail.audit.map((a) => <li key={a.id}>{new Date(a.createdAt).toLocaleDateString()} · {a.type}</li>)}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd apps/web && npx tsc --noEmit` then `npm run build`
Expected: clean; `/admin/tenants/[orgId]` (dynamic) in route table.

- [ ] **Step 4: Commit** (if authorized)

```bash
git add "apps/web/app/admin/tenants/[orgId]/page.tsx" apps/web/components/admin/TenantDetail.tsx
git commit -m "feat(tenants): read-only tenant detail page"
```

---

### Task 6: P1 double gate (Codex + workflow QA)

**Files:** none (review only).

- [ ] **Step 1: Self-verify**

Run, expecting all green:
- `pnpm -r typecheck`
- `cd apps/web && DATABASE_URL=<local> npx vitest run lib/__tests__/` (incl. the new tenant-admin + isolation assertions)
- `cd apps/web && npm run build`
- `pnpm --filter @artlio/core test`

- [ ] **Step 2: Codex review** the P1 diff (read-only), tenancy + correctness lens. Resolve every [P1].

- [ ] **Step 3: Workflow QA** — multi-agent review (tenant-isolation: confirm no owner-scoped `findMany` without `ownerId` slipped in; correctness; the groupBy/aggregate exemption is scoped). Resolve confirmed BLOCKER/STRONG.

- [ ] **Step 4: CEO-style report** to the user (simple language, key risk + example, next step) and STOP for the deploy/commit decision. No spend path touched in P1 → no money-safety gate (that is P2).

---

## Self-Review (against the spec)
- **Spec coverage:** P1 covers — `tenants` RBAC (T1), `AllowedEmail` table + Organization index (T2), list with balance/gens/last-active + invited surface (T3/T4), read-only detail with ledger/spend/usage/audit ownerId-pinned (T3/T5). Deferred to P2/P3 per spec: all control actions (grant/suspend/invite/revoke), the auth-gate changes (bootstrap suspend fix, requireOwner deny, allowed env∪DB, async signIn), per-merchant content deep-link.
- **Isolation contract honored:** list uses Organization/Membership/CreditAccount; detail counts/spend use count/aggregate pinned to ownerId; ledger/audit read by orgId. No owner-scoped `findMany` without `ownerId`.
- **No auth/spend behavior change in P1** — `requireOwner`/`allowed`/bootstrap/spend untouched (verified by Task 6 isolation run staying green).
- **Open implementation checks flagged inline:** `GenJob.spentUsd` numeric type (Task 3 note); Next.js async `params` shape (Task 5 note); fixed section-count tests (Task 1 step 4).

## Next phases (write each plan when its predecessor ships — per the project's per-phase pattern)
- **P2 (security gate):** bootstrap suspend fix + requireOwner deny + `allowed()` env∪DB (full caller conversion + async signIn) + suspend/resume + immediate session cut + per-org grant (super-admin, org validation, dual audit) + invite/revoke. Codex + money-safety + workflow.
- **P3:** drill-down polish + per-merchant content deep-link + invite-lifecycle list.
