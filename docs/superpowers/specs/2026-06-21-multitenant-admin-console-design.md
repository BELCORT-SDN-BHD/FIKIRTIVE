# Multi-tenant Admin Console — Design (2026-06-21)

**Status:** design, reviewed (Codex + 36-agent workflow, both rounds), decisions locked. Ready for user review → writing-plans.

## Problem / goal
P3 gave the app real multi-tenant isolation (org-as-tenant, `requireOwner()` fail-closed resolver, per-org data/credits). But the admin dashboard (OPT-6) is still **founder-org-centric + operator-RBAC over platform config** — it cannot manage individual merchants. To run the closed beta with real merchants, the founder needs to: see who signed up, give a specific merchant credits, suspend/cut off a merchant, and invite merchants without a redeploy. Build the **complete** per-tenant admin console now (future-proof).

## Scope
**In (user-chosen "完整运营台"):** new `/admin/tenants` section (additive); merchant/org list; per-org credit grant/adjust; suspend/resume (+ immediate session cut); usage/spend/audit drill-down; invite via a DB allowlist (+ revoke).
**Out:** Stripe/billing UI (no backend); support impersonate (privacy surface, deferred); reworking the existing 11 platform-admin pages.

## Locked decisions
- **Suspend strength:** soft-suspend default (deny next `requireOwner`; in-flight jobs finish + charge) **PLUS an "immediate cut" action** that revokes the merchant's active `Session` rows (for abuse). Session table already exists.
- **Cross-tenant credit grant RBAC:** granting/adjusting a **non-founder** org = **super-admin only** (the `tenants` section). `finance` keeps founder-org self-service only.

## Architecture
- New RBAC section **`tenants`**, **super-admin only** (mirrors `team`). Added to `SECTIONS` + `SECTION_MATRIX` in `packages/core/src/roles.ts`.
- New `/admin/tenants` (list) + `/admin/tenants/[orgId]` (detail), reusing the admin shell + `requireRole` + `"use server"` action pattern (mirrors `/admin/credits`, `/admin/team`).
- Admin reads/writes are **cross-tenant by design** — gated by `User.role` via `requireRole("tenants",…)`, excluded from `requireOwner()` tenant scoping. Audit (`ActionEvent`) stamped to founder org for the platform trail **AND** a second event stamped to the target merchant org for cross-tenant grants (so the per-merchant drill-down shows who topped them up).

## ⚠️ Auth-gate changes (security-critical — Codex + money-safety + workflow gate)
The only places this feature touches the spend/data foundation. Both review rounds confirmed the suspend hole + the async-`allowed()` footgun as blockers.

### A. Suspend must not be auto-reversed on login (THE critical fix — lives in `bootstrapPersonalOrg`, not `requireOwner`)
`events.signIn` (auth.ts:143) calls `bootstrapPersonalOrg` on **every** non-founder login, and its membership upsert currently does `update: { deletedAt: null, status: "active" }` (auth-guard.ts:92) — reviving a suspended row to active *before* `requireOwner` runs. So a suspended merchant un-suspends themselves on next magic-link login.
**Fix:**
- `bootstrapPersonalOrg`'s membership upsert MUST NOT revive a suspended/revoked row. Use `updateMany(where: { userId, orgId, status: { notIn: ["suspended","revoked"] } }, data: { deletedAt: null })` for the revive (or read-then-write), so a suspended/revoked membership is left untouched. Keep the legitimate `deletedAt`-revive for normal re-login of a non-suspended user.
- The beta grant inside bootstrap must still be idempotent (already is) and must not re-run for a suspended user.

### A2. `requireOwner()` denies suspended/revoked
- Keep the `isFounderAdmin(email) → FOUNDER_OWNER_ID` early return FIRST (auth-guard.ts:55), before any membership lookup (founder anti-lockout).
- Then look up the user's non-founder membership **status-agnostic**: `findFirst({ where: { userId, deletedAt: null, orgId: { not: FOUNDER_OWNER_ID } }, orderBy: { createdAt: "asc" } })`. If found and `status ∈ {suspended, revoked}` → return `{ error: "Your access is suspended." }` (never bootstrap). If `active` → return its org. If none → bootstrap.

### B. `allowed()` becomes env ∪ DB — ENUMERATE EVERY CALLER (async footgun)
Making `allowed()` async without converting every caller silently no-ops the guard (`!Promise` === false → allowlist opens). Confirmed callers that MUST be converted to `await allowed(...)`:
- `apps/web/lib/auth-guard.ts:12, 27, 52` (requireSession, requireRole, requireOwner)
- `apps/web/app/admin/layout.tsx:27`, `apps/web/app/library/page.tsx:10`, `apps/web/app/files/[...key]/route.ts:17` (direct sync callers)
- **`apps/web/auth.ts` signIn callback (~:102)** — this is the actual login gate; it MUST become `await allowed()` (env∪DB) or the invite feature does nothing. Confirm next-auth v5 allows an async `signIn` callback (it does).
Rules:
- **Founder env wins FIRST:** `allowed()` returns true for `FOUNDER_ADMIN_EMAILS ∪ AUTH_ALLOWED_EMAILS` before any DB read (anti-lockout; the DB can never lock the founder out).
- Then check the `AllowedEmail` DB table (status ≠ `revoked`).
- **`session()` callback stays sync** and never calls `allowed()`/DB (authorization lives in the per-action guards + signIn, not in session hydration).
- **Middleware (`proxy.ts`) stays as-is** — it only checks `req.auth` (session presence), NOT the env allowlist. Correct the design language: it is a session-presence perimeter wall (defense-in-depth); the authoritative allowlist check is in-handler.
- **PR checklist:** grep for any bare `allowed(` without `await`.

## Data model
**Reuse P1-reserved fields:** `Membership.status` (active|suspended|revoked), `Membership.invitedBy`, `Organization.deletedAt`, `Organization.name`. (Confirmed present + usable; status/role are TEXT with app-side validation.)

**New table `AllowedEmail`** (additive migration):
```
model AllowedEmail {
  email     String   @id            // store + compare LOWERCASED (mirror env normalization)
  status    String   @default("invited") // invited | active | revoked
  invitedBy String                  // operator email (audit)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```
(`orgId` dropped — bootstrap always creates `org_<userId>` and would ignore it; YAGNI.)

**Index for the list:** add `@@index([deletedAt, createdAt])` (or `createdAt`) on `Organization` for the merchant-list sort. Per-org **gen count + last-active** derive from `Generation` via `groupBy`/`aggregate` (`MAX(createdAt)`, `count`) pinned to `ownerId` — `Generation` is already indexed by ownerId-leading composites (P4), so no GenJob/RefGenJob ownerId index is needed. "Last active" = `MAX(Generation.createdAt)` per org (real activity).

## Control-plane capabilities
- **List** `/admin/tenants`: per org — name, owner email, created, status, credit balance, gen count, last active. Also surface **invited-but-not-yet-logged-in** `AllowedEmail` rows so invites aren't invisible.
- **Detail** `/admin/tenants/[orgId]`:
  - 💰 **Credit grant/adjust** (super-admin) — reuse `grantCreditsAction` but: validate the target `Organization` exists AND `deletedAt == null` → else `{ error: "Unknown or closed org." }` (no founder fallback); write the founder-org audit + a target-org audit event.
  - ⛔ **Suspend / resume** (`Membership.status`) + **Immediate cut** (delete the merchant's active `Session` rows).
  - 📊 **Usage/spend drill-down**: credit ledger (where ownerId=orgId), real `spentUsd` (aggregate, ownerId-pinned), project/gen counts, recent audit events. Per-merchant **"View content"** deep-links `/admin/content?orgId=…` for moderation (data is ownerId-scoped).
- **Invite / revoke**: add an email to `AllowedEmail` (status `invited`); **revoke** flips status to `revoked` (works before or after first login — the env∪DB `allowed()` then denies). Org bootstraps on first login via `requireOwner`.

## Tenant-isolation contract (how reads avoid the guard backstop)
- Per-merchant DETAIL reads on guarded models (Project/Generation/GenJob/RefGenJob) are NOT exempt — they MUST be `findMany/findFirst` scoped `where: { ownerId: merchantOrgId }`.
- Counts/`spentUsd` use `count()`/`aggregate()`/`groupBy` (guard-exempt) but still pinned `where: { ownerId: merchantOrgId }` so they're scoped to X, never platform-wide.
- The cross-tenant org LIST reads `Organization`/`Membership`/`CreditAccount` (not owner-scoped business tables), so it sits outside `forTenant` cleanly like the existing admin pages.

## Phases (each ends with the standard double gate: Codex + workflow QA; P2 adds money-safety)
- **P1 — data + read-only console:** `AllowedEmail` table + `Organization` list index (additive migration); `tenants` RBAC section (super-admin); `/admin/tenants` list + read-only detail (balance/usage/spend/audit, all ownerId-pinned); invited-list surface. No auth/spend behavior change.
- **P2 — control + auth-gate changes (SECURITY GATE):** the bootstrap suspend fix (A) + requireOwner deny (A2) + `allowed()` env∪DB with full caller conversion + async signIn (B); suspend/resume + immediate session cut; per-org grant (super-admin, org validation, dual audit); invite/revoke. **Codex + money-safety + workflow gate mandatory.**
- **P3 — drill-down polish:** richer per-merchant usage/spend/audit, content deep-link, invite-lifecycle list.

## Testing
- 2-org isolation still green.
- **Suspend sticks across login:** suspend a membership, simulate `events.signIn` (bootstrap), then `requireOwner` STILL returns `{error}` (the bootstrap-revive fix). + immediate-cut deletes Session rows.
- `allowed()` env∪DB: invited email allowed; revoked denied; **founder always allowed even if absent from DB**; every caller awaited (grep guard).
- Per-org grant lands in the targeted org's ledger; unknown/deleted org rejected (no founder fallback); cross-tenant grant requires super-admin (finance denied + audited).
- `tenants` section super-admin only.
- In-flight job after suspend completes + charges (documented behavior, asserted).

## Known/accepted (confirmed by review, no change)
- Normal spend/data paths all go through `requireOwner` — no bypass except the login bootstrap (fixed in A).
- Negative ADJUST + in-flight reserve/settle on a live merchant are race-safe (single-row serialization) — do not add extra locking.
- Reserved fields present + usable; the `AllowedEmail` migration is the only schema change and is additive (the risky parts are the runtime auth-gate changes).
