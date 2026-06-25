# Better Auth foundation — design spec

**Date:** 2026-06-25
**Status:** approved (direction), pre-implementation
**Owner (this work):** auth-module engineer (this branch `claude/great-jackson-f366d2`)
**Hands off to:** main engineer ("钟司令") for the cutover merge — a **separate** later task

---

## 1. Goal & framing

Migrate authentication from NextAuth v5 (Auth.js) to **Better Auth**, and upgrade sign-in
from magic-link-only to a **mainstream-SaaS sign-in experience**: email+password, "Continue
with Google", and email magic-link.

This branch delivers the **foundation only**: a fully-built, tested Better Auth stack that runs
**alongside** the live NextAuth install, **dormant** (wired into nothing), so the merge engineer
can flip it on in a small, well-documented cutover. The risky cutover itself — flipping the live
`auth()`/proxy/login, the real-money end-to-end dry-run, deleting NextAuth — is **out of scope**
(see §10), per the [SaaS-foundation spec §6.2](2026-06-19-closed-beta-saas-foundation-design.md)
("never mid-beta", lockout preconditions mandatory).

**Three properties this work must hold:** additive (no edits to live auth paths), dormant (zero
behavioral change), reversible (pure add — drop the new files/tables to undo). **Cost: $0** — no
fal calls, no real Google credentials needed for the dormant build.

## 2. Access model (product decision — confirmed)

Closed beta is **preserved**. The existing deny-by-default allowlist (`isAllowedEmail`, env ∪ DB)
stays the **outer wall across every sign-in method** — Google/password/magic-link all pass through
it. A non-allowlisted email never gets a session. Founder protections + the per-org beta-credit
bootstrap are unchanged.

## 3. Invariants that MUST be preserved byte-for-byte

The current foundation was deliberately built auth-agnostic; the migration stays contained only if
these hold. (Sources: live mapping of `apps/web/auth.ts`, `lib/auth-guard.ts`, `proxy.ts`,
`types/next-auth.d.ts`, `packages/db/prisma/schema.prisma`.)

- **`@/auth` export surface** consumed across 11 files: `handlers` (`{GET,POST}`), `auth`,
  `signIn`, `signOut`, plus `allowed(email): Promise<boolean>` and `isFounderAdmin(email): boolean`.
- **`auth-guard.ts` 4-function surface** (42 consumers route through these — they DO NOT change):
  - `requireSession(): Promise<{email}|{error}>`
  - `requireRole(section, action): Promise<{email, role:Role}|{error}>`
  - `requireOwner(): Promise<{email, ownerId}|{error}>`
  - `bootstrapPersonalOrg(userId, email): Promise<string|null>` (reused unchanged)
- **`session.user` shape:** `{ email?: string|null; name?: string|null; image?: string|null;
  role?: Role }` where `Role = "super-admin"|"ops"|"finance"|"moderator"|"viewer"`. `role` defaults
  to `"viewer"` on missing/garbage and a session read must never throw.
- **Identity anchor:** `User.id` stays **cuid**. The three cascade FKs on it
  (`Account.userId`, `Session.userId`, `Membership.userId`) and the `Organization`-rooted business
  FK graph (~21 ownerId FKs) are **not touched**. `User.email` is `@unique` and is the join key.
- **Dev magic-link fallback:** when `RESEND_API_KEY` is unset in dev, the sign-in link is written
  to `.data/last-magic-link.txt` — the smoke suite reads this exact path. Must be preserved.

## 4. Architecture — identity bridge (approach A)

**Email is the join key; the existing `User` table stays the canonical tenant identity.**

Better Auth gets its **own** tables (`ba_user/ba_session/ba_account/ba_verification`) for auth
bookkeeping only. On every Better Auth sign-in, after the allowlist passes, an after-hook
**get-or-creates the canonical `User` row by email** (mirroring name/image), then runs the same
convergence as today's `events.signIn`: founder super-admin self-heal, founder membership seed,
non-founder `bootstrapPersonalOrg`, and the `auth.signin` `ActionEvent`. Because `requireOwner`/
`requireRole`/credits all resolve via `email → User → Membership`, **the guard and its 42 consumers
are unchanged**, and `Membership`/credit FKs **never re-migrate** (matches SaaS-foundation spec §6.2).

Rejected alternatives: **(B)** converge onto one user table at cutover — pushes a dedup-by-email
data migration into the risky cutover; **(C)** share NextAuth's existing tables — impossible
additively (`emailVerified` Boolean-vs-DateTime?, incompatible Account/Session PKs force destructive
ALTERs).

## 5. Components (all NEW files unless noted)

| Path | Responsibility |
|---|---|
| `apps/web/lib/better-auth/server.ts` | `betterAuth({...})` instance: `prismaAdapter(prisma,{provider:"postgresql"})` reusing the `@fikirtive/db` singleton; `emailAndPassword` (verification + reset); `socialProviders.google`; `plugins:[magicLink({sendMagicLink}), nextCookies()]`; `basePath:"/api/better-auth"`. Allowlist `before` hook + convergence `after` hook + custom session enrichment. Ported Resend sender + dev `.data/last-magic-link.txt` fallback + 5/hr in-memory rate-limit. |
| `apps/web/lib/better-auth/client.ts` | `createAuthClient({ baseURL, plugins:[magicLinkClient()] })` for the browser. |
| `apps/web/lib/better-auth/compat.ts` | The cutover drop-in: a NextAuth-shaped `auth()` returning `{ user:{ email, name, role } } | null` via `auth.api.getSession({ headers: await headers() })` + canonical-role lookup. **Dormant** — imported only by its own tests. |
| `apps/web/app/api/better-auth/[...all]/route.ts` | `export const { GET, POST } = toNextJsHandler(auth)` — own prefix, no collision with `/api/auth/[...nextauth]`. |
| `packages/db/prisma/schema.prisma` (edit) | Add 4 BA models with distinct model + `@@map` names (`ba_user`…). No change to existing models. |
| `packages/db/prisma/migrations/<new>/migration.sql` | One **additive** migration: `CREATE TABLE/INDEX` + `ADD FOREIGN KEY` for the 4 `ba_*` tables only. No `ALTER`/`DROP`. |
| `apps/web/lib/allowlist.ts` (edit) | Move `isFounderAdmin` here (next-auth-free), keep a re-export in `auth.ts` for back-compat. **Only touch to an existing app file** — safe, both stacks share one copy. |
| `.env.example` (edit) | Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (origin `:3100`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` placeholders. Reuse `RESEND_API_KEY`/`AUTH_EMAIL_FROM`/`FOUNDER_ADMIN_EMAILS`/`AUTH_ALLOWED_EMAILS`. |
| `docs/.../HANDOFF-betterauth-cutover.md` | The flip checklist for the cutover (see §10), incl. the pre-written-but-unwired `proxy.ts` rewrite. |

## 6. Sign-in methods

- **Email + password** — Better Auth `emailAndPassword`; email verification + password reset
  emails go through the same Resend sender. Allowlist gates registration and sign-in.
- **Google** — `socialProviders.google`; allowlist re-checked on the OAuth callback before a
  session is issued. Code + env placeholders wired now; a real Google OAuth app is registered by
  ops before cutover (§10).
- **Magic-link** — `magicLink` plugin (reuses the `verification` table); `sendMagicLink` ports the
  Resend POST + dev file fallback + rate-limit verbatim.

All three converge on the same allowlist + canonical-`User` + session-shape path (§4).

## 7. Library specifics (verified live 2026-06-25)

- `better-auth@^1.6` (1.6.20); built-in `better-auth/adapters/prisma` (no separate adapter pkg).
  Peer ranges cover this repo (Next 16, Prisma 7, React 19).
- Prisma-7 caveat handled: reuse the `@fikirtive/db` singleton (already imports from the custom
  `../generated/prisma` output); never `new PrismaClient()` / `@prisma/client`.
- Schema generated with `npx @better-auth/cli@latest generate` (writes Prisma models), then the
  SQL is created/applied with the repo's own `@fikirtive/db` `migrate:dev`. The BA CLI `migrate`
  command is **Kysely-only and does not support Prisma** — do not use it.
- `nextCookies()` must be the **last** plugin. Server session reads use
  `auth.api.getSession({ headers })`, not the client.
- Distinct `basePath:"/api/better-auth"` — two catch-alls cannot share `/api/auth` in Next.js.

## 8. What stays untouched / dormant

`apps/web/auth.ts` (config — except the `isFounderAdmin` re-export), `proxy.ts`,
`app/login/page.tsx`, `lib/auth-guard.ts`, `app/api/auth/[...nextauth]`, `lib/account-actions.ts`.
NextAuth remains 100% live. Nothing imports the BA stack except its tests. `proxy.ts` uses
NextAuth's `auth((req)=>…)` middleware-wrapper form (Better Auth has no equivalent); the rewrite to
`auth.api.getSession` is **pre-written in the handoff doc, not wired**.

## 9. Verification (TDD, all $0)

Tests must prove:
1. Allowlist denies a non-allowlisted email across **all three** methods; allows an allowlisted one.
2. After sign-in: canonical `User` get-or-created by email; founder self-heal + org/credit bootstrap
   fire **once** (idempotent on repeat sign-in); `auth.signin` `ActionEvent` written.
3. `compat.ts` `auth()` returns the exact `{ email, name, role }` shape; `role` defaults to
   `"viewer"`; never throws.
4. Magic-link dev path writes `.data/last-magic-link.txt`; rate-limit trips at >5/hr.
5. Google flow with a **mocked** provider (no live credentials).
6. `prisma validate` passes; `ba_*` tables don't collide; typecheck + web build green.

## 10. Out of scope → handoff to the cutover (钟司令 / later agent)

Captured in `HANDOFF-betterauth-cutover.md`:
- Flip the guard's internal `auth()` to `compat.ts`; rewrite `proxy.ts` to the BA session read
  (snippet provided); repoint `app/login/page.tsx` to `authClient`; remove the dead `auth()` call
  in `app/editor/page.tsx`; retire the NextAuth route + adapter.
- Register the real Google OAuth app; set `GOOGLE_CLIENT_ID/SECRET`, `BETTER_AUTH_SECRET/URL`.
- The SaaS-foundation §6.2 lockout preconditions: stage on a DB clone, dry-run a login **and one
  end-to-end generation** (this spends real fal money — confirm before running), keep `User.id`
  cuid, additive+reversible, never touch the founder seed.

## 11. Assumptions

1. The [2026-06-19 SaaS-foundation spec](2026-06-19-closed-beta-saas-foundation-design.md) remains
   the source of truth for the identity/tenant invariants.
2. Google OAuth app registration is an ops task done before cutover, not part of this build.
