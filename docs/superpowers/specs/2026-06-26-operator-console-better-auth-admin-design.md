# Operator Console on Better Auth `admin` Plugin — Design

**Status:** Approved design (brainstorm complete 2026-06-26). Next step: implementation plan via `writing-plans`.

**Goal:** Give founder/staff an operator back-office inside the existing `/admin` that can manage users/roles, control accounts (suspend + force-logout), grant/adjust credits, and (later) impersonate a customer — using Better Auth's self-hosted `admin` plugin as the backend engine, gated by our existing RBAC, **without touching the money/generation path**.

**Architecture:** Better Auth `admin` plugin is wired into the existing `auth` config and provides the hard parts (session-layer ban, session revocation, impersonation). Every operator action is a server action that passes **our** `requireRole(section, action)` gate first, then calls `auth.api.*` (or our own Prisma write), then writes an `actionEvent` audit row. UI is our own `/admin` pages + design system + RBAC — no second/parallel admin surface. Money-in (credits) stays on the existing `grantCredits()` ledger entry point.

**Tech stack:** `better-auth@1.6.20` (`admin` plugin from `better-auth/plugins`, `adminClient` from `better-auth/client/plugins`), Prisma/PostgreSQL, Next.js 16 App Router (`apps/web`), existing `@fikirtive/core` RBAC.

---

## Global Constraints

- **Do NOT modify the money/generation path.** Off-limits files: `apps/web/lib/gen-actions.ts`, `apps/web/lib/cowork-actions.ts` (the `coworkGenerate`/`withLlmBudget` calls), `packages/otto/src/meter.ts`, `apps/worker/*`, and the credit models in `packages/db/prisma/schema.prisma` (`CreditAccount`, `CreditLedger`) and `packages/db/src/credits.ts`. The ONLY credit interaction is calling the existing `grantCredits({ source: "ADMIN", ... })`. The ONLY schema additions are the additive Better-Auth fields in §3.
- **Real money / API keys:** none entered or handled by the implementer. No Stripe build in this spec.
- **RBAC matrix (`packages/core/src/roles.ts` `SECTION_MATRIX`) is NOT changed.** Existing gates already cover every action (see §8).
- **Pinned dependency:** `better-auth@1.6.20`. Behaviors below were verified against this version's on-disk source; treat the version's source as authoritative over the public docs where they differ.
- **`apps/web/proxy.ts` matcher is NOT changed.** It already excludes `/api/better-auth`; the admin sub-routes ride under that exclusion and are self-gated by the plugin.

---

## 1. Scope & Phasing

**In scope (approach: admin plugin as engine behind our `/admin` + RBAC):**

- **Phase 1** — wire the `admin` plugin; user/role management; account control (suspend/reactivate + force-logout); credit grant/adjust UI.
- **Phase 2** — impersonation (founder-only, audited, spend-blocked, visible banner).

**Out of scope (non-goals):**

- ❌ Better Auth `organization` plugin (customer teams / invitations). Tenants stay single-owner personal orgs. Revisit when a customer-facing portal is built.
- ❌ Stripe itself. This spec only leaves a clean seam (§7). Stripe is its own later spec (Phase 3).
- ❌ Any change to the money/generation path (see Global Constraints).
- ❌ Any change to the RBAC `SECTION_MATRIX`.

**Audience:** operator console for founder/staff. Customers never see it. `/admin` remains founder-gated as it is today.

---

## 2. The two locked decisions (these shape everything below)

1. **Role source of truth — `User.role` authoritative, `BetterAuthUser.role` is a mirror.**
   The canonical role lives in the legacy `User.role` column (read by `roleForEmail()` → `customSession` → `compat.auth()` → `requireRole`/`requireOwner`; written by `convergeIdentity` and the team page). The `admin` plugin's `hasPermission` reads the *raw* `BetterAuthUser.role` column instead, which bypasses `customSession` entirely. We therefore **mirror** the canonical role into `BetterAuthUser.role` so the plugin recognizes our admins. We do **not** use the plugin's `setRole` as the role-of-record; our own action writes `User.role` and mirrors `BetterAuthUser.role`.

2. **Ban model — `Membership.status` authoritative, `BetterAuthUser.banned` is the global kick.**
   `Membership.status` (`suspended`/`revoked`) stays authoritative for per-tenant access — `requireOwner` already consumes it (defense-in-depth). The plugin's `banUser` is used as an immediate **global** kill switch: it sets `BetterAuthUser.banned=true`, deletes all the user's sessions, and blocks new sessions at `session.create.before`. The suspend action flips `Membership.status` **and** calls `banUser`; for single-owner tenants the two coincide.

---

## 3. Schema changes (one Prisma migration)

The `admin` plugin operates on the tables Better Auth maps to (`user → BetterAuthUser`, `session → BetterAuthSession`), **not** the legacy `User`/`Session` models. Add:

```prisma
model BetterAuthUser {
  // ...existing fields...
  role        String?                       // plugin gate role (MIRROR of canonical User.role; see §2.1)
  banned      Boolean?  @default(false)     // session-layer kill switch (banUser sets this)
  banReason   String?
  banExpires  DateTime?                     // plugin auto-clears an expired ban in the session hook
}

model BetterAuthSession {
  // ...existing fields...
  impersonatedBy String?                    // admin's user id on an impersonation session (Phase 2 marker)
}
```

No other schema changes. Credit models untouched.

---

## 4. Better Auth config (`apps/web/lib/better-auth/server.ts`)

Add the `admin` plugin to the `plugins` array, **after `customSession`, before `nextCookies()`** (`nextCookies` must remain last):

```ts
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
// ...
// Only "super-admin" MUST be a key in `roles` (adminRoles ⊆ roles keys, else init throws).
// It is granted EVERY statement the plugin defines — user:[create,list,set-role,ban,
// impersonate,delete,set-password,set-email,get,update] and session:[list,revoke,delete] —
// so the founder passes hasPermission for ban / revoke-sessions / impersonate.
// Other RBAC roles (ops/finance/moderator/viewer) are NOT listed: a user whose mirrored
// ba_user.role isn't a key simply gets no admin grants → denied at the BA layer (correct;
// no crash — only adminRoles is validated at init, not per-request roles).
const ac = createAccessControl({
  user: ["create","list","set-role","ban","impersonate","delete","set-password","set-email","get","update"],
  session: ["list","revoke","delete"],
});
admin({
  ac,
  roles: { "super-admin": ac.newRole({ user: ["create","list","set-role","ban","impersonate","delete","set-password","set-email","get","update"], session: ["list","revoke","delete"] }) },
  adminRoles: ["super-admin"],
  impersonationSessionDuration: 60 * 30, // 30 min (default is 1h)
}),
```
(The exact `createAccessControl`/`newRole` call shape is verified against `better-auth@1.6.20` during implementation — the statement list above is the plugin's default statement space.)

**Caller-admin recognition (critical):** `hasPermission` reads `ctx.context.session.user.role` = the raw `BetterAuthUser.role`. Our `customSession`/`roleForEmail` value is invisible to it. So the founder's `BetterAuthUser.role` must equal `"super-admin"`. Achieved by §5 (converge mirrors it on every sign-in).

**Endpoint exposure:** the plugin registers `/api/better-auth/admin/*` (set-role, list-users, ban-user, revoke-user-sessions, impersonate-user, stop-impersonating, …), served by the existing catch-all `apps/web/app/api/better-auth/[...all]/route.ts`. Each endpoint self-gates with `adminMiddleware` (401 if no session) + `hasPermission` (403 if not admin). The `proxy.ts` matcher already excludes `/api/better-auth`, so these are outside the redirect wall and correctly self-gated. **Do not change the matcher.** Our server actions add a second gate (`requireRole`) on top — defense-in-depth, and so the UI uses our own role semantics.

**Hook stacking (verify during impl):** `admin`'s `init()` adds its own `databaseHooks.user.create.before` that injects `role: defaultRole`. This stacks with our existing `databaseHooks.user.create.before` (allowlist `assertAllowedEmail`) and `.after` (`convergeIdentity`). Confirm in a boot test that the allowlist gate AND the role default both run after adding the plugin.

---

## 5. Role unification (`convergeIdentity` + the set-role action)

- **`apps/web/lib/better-auth/converge.ts`:** in addition to promoting the founder's canonical `User.role` to `"super-admin"` (existing behavior), also stamp `BetterAuthUser.role` for the signing-in user to match the canonical role (founder → `"super-admin"`). This runs on every session create, so the mirror self-heals. Keep it best-effort / never-throw like the rest of converge.
- **Set-role operator action** (see §6): writes the canonical `User.role` and mirrors `BetterAuthUser.role` in the same action, so a role change takes effect immediately for both our RBAC (next request) and the plugin gate — without waiting for the next sign-in.
- **Single-role only:** the plugin's `setRole` comma-joins multiple roles into a CSV string; our `isRole()`/zod validator in `@fikirtive/core` accepts only a single role. Our mirror always writes one role string. We never store CSV roles.

---

## 6. Server actions — `apps/web/lib/operator-actions.ts` (new)

Uniform shape: `requireRole(section, "mutate")` → call `auth.api.*` / Prisma → write `actionEvent` audit. All are `"use server"`.

| Action | Gate (existing `SECTION_MATRIX`) | Behavior | Audit type |
|---|---|---|---|
| `setOperatorRole(userId, role)` | `team` / mutate (super-admin) | Validate `isRole(role)`; write `User.role` + mirror `BetterAuthUser.role`. | `operator.role.set` |
| `suspendTenant(orgId)` | `tenants` / mutate (super-admin) | Set `Membership.status="suspended"` for the org owner; call `auth.api.banUser({ body:{ userId } })`. | `tenant.suspend` |
| `reactivateTenant(orgId)` | `tenants` / mutate (super-admin) | Set `Membership.status="active"`; call `auth.api.unbanUser`. | `tenant.reactivate` |
| `revokeTenantSessions(userId)` | `tenants` / mutate (super-admin) | Call `auth.api.revokeUserSessions({ body:{ userId } })`. | `session.revoke` |
| `grantTenantCredits(orgId, amount, reason)` | `credits` / mutate (finance) | Call existing `grantCredits({ orgId, amount, source:"ADMIN", reason, createdBy, idempotencyKey })`. | `credits.grant` |

Notes:
- `userId` here is our canonical `User.id`; map to the `BetterAuthUser` id where the BA api needs it (the BA user is keyed by the same email — resolve via lookup; document the exact mapping during impl).
- `grantTenantCredits` must pass a stable `idempotencyKey` (e.g. `admin-grant:<orgId>:<ulid>`) so a double-submit can't double-grant (ledger-first idempotency).
- Each action returns `{ error }` verbatim from the gate on denial (same convention as `requireOwner`).

---

## 7. UI changes (extend existing `/admin` pages)

- **`/admin/team`** (`apps/web/app/admin/team/page.tsx`, already lists users + roles): add a role-edit control wired to `setOperatorRole`. This is operator/staff management.
- **`/admin/tenants/[orgId]`** (`apps/web/app/admin/tenants/[orgId]/page.tsx`, already shows org + owner + balance + ledger): add
  - `Suspend` / `Reactivate` button → `suspendTenant` / `reactivateTenant`
  - `Force logout` button → `revokeTenantSessions`
  - `Grant / adjust credits` form → `grantTenantCredits` (lives here, next to the balance)
  - (Phase 2) `Impersonate` button → §9
- Clean split: `/admin/team` = manage our own people (roles); `/admin/tenants/[orgId]` = manage a customer (suspend / logout / credits / impersonate).

---

## 8. RBAC mapping (no matrix changes)

Existing `SECTION_MATRIX` already covers every action:
- `team` mutate → super-admin only ✓ (role management)
- `tenants` mutate → super-admin only ✓ (suspend / reactivate / revoke sessions / impersonate)
- `credits` mutate → finance (super-admin supersedes) ✓ (grant credits)

Founder = super-admin passes all. No new sections/roles. If staff (ops/finance) are later given `/admin` access, the matrix already routes them correctly; only the founder-gate in `app/admin/layout.tsx` would relax — out of scope here.

---

## 9. Impersonation (Phase 2)

- **Gate:** `requireRole("tenants","mutate")` **and** an explicit `isFounderAdmin(email)` check — founder-only, stricter than the rest. Audit `impersonate.start` / `impersonate.stop`.
- **Mechanism:** `auth.api.impersonateUser({ body:{ userId } })` creates a target session with `BetterAuthSession.impersonatedBy = <founder id>`, swaps the session cookie, and stashes the founder's original session token in a signed `admin_session` cookie. `auth.api.stopImpersonating()` reverses it. Duration 30 min.
- **Visible banner:** detect `impersonatedBy` on the current session in the app layout; render "Impersonating <email> — [Stop]".
- **🔒 Spend block (money-path-safe):** decided restriction = **block spend only** (generation/credit-burning), everything else proceeds; data mutations are auditable/reversible, spend is not.
  - Problem: `compat.auth()` returns only `{ user }` and drops the session, so `impersonatedBy` is invisible to `auth-guard`.
  - Fix: surface `impersonatedBy` — add an `isImpersonating()` / `impersonatedBy` helper that reads the raw `auth.api.getSession()` session (not the compat shape). Then in `requireSession()` / `requireOwner()` (`apps/web/lib/auth-guard.ts`), when impersonating, return `{ error }` for spend callers.
  - **Money path untouched:** `gen-actions.ts` and the cowork generate action already funnel through `requireSession`/`requireOwner`; blocking there covers spend without editing any off-limits file.
- **Note:** the plugin strips impersonation sessions from `list-user-sessions` output; `banUser` cannot target self; impersonating an admin-role target would additionally require the `impersonate-admins` permission (not granted — we only impersonate customers).

---

## 10. Stripe seam (future — Phase 3, separate spec)

Not built here. The foundation is already correct:
- Money-in = `grantCredits`. The `CreditLedger` already has `stripePaymentIntentId` and a `PURCHASE` source value.
- Both chosen models reduce to ledger grants: subscription renewal webhook → grant N credits; top-up → `grantCredits({ source:"PURCHASE", stripePaymentIntentId })`.
- BA `@better-auth/stripe` plugin would own subscription lifecycle/webhooks; its renewal handler calls `grantCredits`. (A `SUBSCRIPTION` source enum value may be added then — the future spec's concern.)
- The tenant detail page is structured so a "subscription status + purchase history" panel can be added later over the existing ledger rows.

---

## 11. Testing strategy

Follow the existing pattern (`apps/web/lib/__tests__/require-owner.test.ts`, `isolation.test.ts`): mock `@/lib/better-auth/compat` (`auth()`) and `@/lib/allowlist`; for BA api calls, mock `auth.api.*`.

- **operator-actions:** each action (a) denies a non-super-admin / non-finance caller via the gate, (b) performs the correct BA call / Prisma write on success, (c) writes the expected `actionEvent`. `grantTenantCredits` is idempotent on its key.
- **Ban:** `suspendTenant` flips `Membership.status` and calls `banUser`; a suspended membership makes `requireOwner` return `{ error }` (already covered by isolation tests for `status`).
- **Role mirror:** `setOperatorRole` writes both `User.role` and `BetterAuthUser.role`; `convergeIdentity` stamps `BetterAuthUser.role` for the founder.
- **Impersonation (Phase 2):** when the raw session has `impersonatedBy` set, `requireSession`/`requireOwner` deny spend callers; non-spend reads still pass.
- **Boot:** the plugin initializes without throwing (`adminRoles` ⊆ `roles` keys), and the allowlist `user.create.before` gate still runs.
- **Money path:** the existing gen/cowork/meter tests stay green (no changes there).

---

## 12. Risks / things to verify during implementation (from version 1.6.20 source)

- `adminRoles` is validated at init against `roles` keys → a missing `"super-admin"` key crashes boot. Define `roles` first.
- `hasPermission` reads raw `BetterAuthUser.role`, **not** `roleForEmail`/`customSession` — the mirror in §5 is mandatory, not optional.
- `adminUserIds` JSDoc ("if set, adminRole ignored") is imprecise; the code treats it as an additive allow short-circuit. We rely on `roles`+mirror, not `adminUserIds`.
- `banUser` immediately deletes all the target's sessions (logs them out everywhere); expired bans auto-clear lazily in the session hook.
- `customSession` masks `BetterAuthUser.role` from `getSession` consumers — don't assume the UI role and the plugin gate role are the same object; they're kept equal only by the mirror.
- `compat.auth()` drops the session object — Phase 2 must read the raw `getSession()` for `impersonatedBy`.
- Map our `User.id` ↔ `BetterAuthUser.id` correctly wherever a BA api needs the BA user id (same email is the join key).
