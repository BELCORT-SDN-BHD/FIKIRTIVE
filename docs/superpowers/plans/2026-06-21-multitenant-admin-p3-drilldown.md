# Multi-tenant Admin Console — P3 (Drill-down polish) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Close the two concrete drill-down gaps the design review flagged: (1) per-merchant content moderation (pivot from a flagged merchant to that merchant's content), (2) full invite lifecycle visibility (show revoked invites, not just pending).

**Architecture:** Read-only / UI only. `/admin/content` gains an optional `?orgId=` filter (ownerId-pinned); the tenant detail links to it. The tenant list surfaces revoked invites too. No new actions, no auth/spend changes.

**Tech Stack:** Next.js RSC, Prisma, vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-multitenant-admin-console-design.md` (P3 scope).

## Global Constraints
- Commit + push when the phase gate passes (autonomy granted). Do NOT auto-approve the Railway deploy.
- Read-only / UI only — no new mutations, no auth/spend changes. YAGNI: skip vague "richer drill-down" gold-plating; do only the two items above.
- Content filter must be ownerId-pinned (no cross-tenant leak when an orgId is given).
- Phase gate: Codex + independent workflow QA.

---

### Task 1: `/admin/content` optional per-merchant filter + tenant-detail deep-link

**Files:**
- Modify: `apps/web/app/admin/content/page.tsx` (accept `searchParams: Promise<{ orgId?: string }>`; when present, filter gens + blocks by `ownerId: orgId`)
- Modify: `apps/web/components/admin/ContentAdmin.tsx` (show a "Filtered to <orgId> · clear" banner when filtered — small)
- Modify: `apps/web/components/admin/TenantDetail.tsx` (add a "View content →" link to `/admin/content?orgId=${detail.orgId}`)

**Interfaces:**
- Consumes: existing `ContentAdmin` (gens/blocks props). Adds an optional `filterOrgId?: string` prop for the banner.

- [ ] **Step 1: Page filter.** In `content/page.tsx`, change the signature to `export default async function ContentPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> })`, `const { orgId } = await searchParams;`. Build a reusable `const ownerFilter = orgId ? { ownerId: orgId } : {};` and spread it into BOTH queries:
  - gens: `where: { deletedAt: null, ...ownerFilter }`
  - blocks: `where: { type: "gen.guardian-block", ...ownerFilter }` (ActionEvent has `ownerId`).
  Pass `filterOrgId={orgId}` to `<ContentAdmin>`.
  (Gate stays `requireRole("content","read")` — a super-admin reaching this via the tenant deep-link passes via supersede.)

- [ ] **Step 2: Banner.** In `ContentAdmin.tsx`, accept `filterOrgId?: string`; when set, render a small banner at top: `Filtered to merchant {filterOrgId} · [Show all]` where "Show all" links to `/admin/content` (no query). Plain text + a next/link. No other behavior change.

- [ ] **Step 3: Deep-link.** In `TenantDetail.tsx`, add a `next/link` `View content →` to `/admin/content?orgId=${detail.orgId}` in the header or controls area.

- [ ] **Step 4: Test (isolation of the filter).** Add to `apps/web/lib/__tests__/isolation.test.ts` is overkill (the page isn't a lib fn). Instead, add a focused unit assertion is not practical for a page. Verify by: `cd apps/web && npx tsc --noEmit` + `npm run build` (route compiles). The ownerId-pin is a one-line spread; the workflow gate will adversarially verify no leak. (If a lib helper is extracted, unit-test it; otherwise rely on the gate + build.)

- [ ] **Step 5: Commit** deferred to the phase gate.

---

### Task 2: Surface revoked invites (full invite lifecycle) in the tenant list

**Files:**
- Modify: `apps/web/components/admin/TenantsAdmin.tsx` (the "Invited" section currently shows only `status === "invited"`; add the revoked ones in a muted sub-list or a status label).

**Interfaces:** `listTenants()` already returns ALL `AllowedEmail` rows in `invited` (incl. revoked) — no data-layer change needed.

- [ ] **Step 1:** In `TenantsAdmin.tsx`, split the `invited` prop into pending (`status === "invited"`) and revoked (`status === "revoked"`). Keep the existing "Invited (not yet signed in)" list for pending (with its Revoke button from P2). Add a small muted "Revoked" sub-list below it (email + by invitedBy) when any exist. `active` rows stay hidden (those merchants appear in the main tenants table once they sign in). No new actions.

- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` + `npm run build` clean.

- [ ] **Step 3: Commit** deferred to phase gate.

---

### Task 3: P3 gate (Codex + workflow QA) → fix → commit/push

- [ ] **Step 1: Self-verify:** `pnpm -r typecheck`; `cd apps/web && DATABASE_URL=<local> npx vitest run lib/__tests__/`; `cd apps/web && npm run build`. All green.
- [ ] **Step 2: Codex** review the P3 diff — focus: the content filter is ownerId-pinned (no cross-tenant leak when orgId given; and when NOT given it stays the existing platform-wide view), the deep-link, the revoked list. Resolve [P1].
- [ ] **Step 3: Workflow QA** — tenant-isolation (content filter can't leak across orgs; the no-orgId path unchanged) + correctness + completeness. Resolve confirmed BLOCKER/STRONG.
- [ ] **Step 4:** Fix (one wave). Re-verify. Commit (surgical, P3 files) + push. CEO report — the full multi-tenant admin console (P1+P2+P3) is shipped.

## Self-Review (against spec)
- Covers spec P3: per-merchant content deep-link (T1) + invite-lifecycle list (T2). Skips vague "richer drill-down" (YAGNI). No auth/spend change (P2 owned those).
- Isolation: the content filter is ownerId-pinned; the gate verifies no leak.
