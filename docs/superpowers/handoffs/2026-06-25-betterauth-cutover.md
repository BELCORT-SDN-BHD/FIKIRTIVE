# Better Auth Cutover Handoff

**Date:** 2026-06-25
**Author:** BELCORT / SDD Task 11
**For:** merge engineer performing the live cutover

Related files:
- Spec: `docs/superpowers/specs/2026-06-25-betterauth-foundation-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-betterauth-foundation.md`

---

## 1. What's Built & Dormant

The Better Auth stack is fully implemented and sitting dormant. Nothing in the live app imports it except the API route mount. Every file listed below was added additively — zero changes to the existing NextAuth path.

### Library files (`apps/web/lib/better-auth/`)

| File | Purpose |
|------|---------|
| `server.ts` | `betterAuth()` instance — email+password, Google OAuth, magic-link; basePath `/api/better-auth`; wires gate + session-role + convergeIdentity |
| `gate.ts` | `assertAllowedEmail` / `assertAllowedForUserId` — fail-closed allowlist; fires on `user.create.before` + `session.create.before` (covers new signups AND repeat OAuth logins) |
| `sender.ts` | Resend email send + dev fallback to `.data/last-magic-link.txt` + 5/hr rate-limit; ported from `auth.ts` — **delete the auth.ts copy at cutover** |
| `session-role.ts` | `roleForEmail` — canonical role mapping, defaults to `viewer` |
| `converge.ts` | `convergeIdentity` — get-or-create canonical `User`, founder-heal, `bootstrapPersonalOrg`, `auth.signin` audit; keyed off email |
| `client.ts` | Browser `authClient` — `signIn.email` / `signIn.social("google")` / `signIn.magicLink` / `signOut` |
| `compat.ts` | `auth()` returning NextAuth-shaped `{user:{email,name,image,role}}|null` — the drop-in for `auth-guard.ts` |

### Route

`apps/web/app/api/better-auth/[...all]/route.ts` — `toNextJsHandler(auth)`. This is the **only** file in the live app that currently imports from `lib/better-auth/`.

### Database

`packages/db/prisma/schema.prisma` + migration `*_better_auth` — additive tables: `ba_user`, `ba_session`, `ba_account`, `ba_verification`. No existing tables touched.

### Proof command

Run this — it should output **only the route** line:

```bash
grep -rn "lib/better-auth" apps/web --include='*.ts' --include='*.tsx' \
  | grep -v __tests__ \
  | grep -v "lib/better-auth/"
```

Expected output (nothing else):

```
apps/web/app/api/better-auth/[...all]/route.ts:1:import { auth } from "@/lib/better-auth/server";
```

---

## 2. Flip Checklist (ordered)

Work through these in sequence. Do **not** skip preconditions in §4.

### Step 1 — Environment variables

Register a Google OAuth app (Credentials → Web application; authorized redirect URI: `<BETTER_AUTH_URL>/api/better-auth/callback/google`).

Set in your deployment environment:

```
BETTER_AUTH_SECRET=<output of: openssl rand -base64 32>
BETTER_AUTH_URL=https://<your-domain>          # no trailing slash
NEXT_PUBLIC_BETTER_AUTH_URL=https://<your-domain>
GOOGLE_CLIENT_ID=<from Google Console>
GOOGLE_CLIENT_SECRET=<from Google Console>
```

Reference: `.env.example` in repo root for all keys.

### Step 2 — Flip `auth-guard.ts` to compat

In `apps/web/lib/auth-guard.ts`, change the `auth()` import from NextAuth to the compat shim:

```diff
- import { auth } from "@/auth";
+ import { auth } from "@/lib/better-auth/compat";
```

That is the **only change** needed for auth-guard. The four exported guard functions (`requireSession`, `requireRole`, `requireOwner`, `bootstrapPersonalOrg`) keep their exact signatures, and all 42 files that consume them are untouched.

### Step 3 — Rewrite `proxy.ts`

NextAuth's `auth((req) => …)` middleware-wrapper form has no equivalent in Better Auth. Replace the wall logic:

```ts
import { auth } from "@/lib/better-auth/server";

// inside proxy(req) — replace the auth((req)=>{...}) call with:
const session = await auth.api.getSession({ headers: req.headers });
if (!session) {
  const from = encodeURIComponent(req.nextUrl.pathname);
  return NextResponse.redirect(new URL(`/login?from=${from}`, req.url));
}
```

Preserve all other proxy logic (R2 forwarding, org-slug resolution, etc.) exactly as today.

### Step 4 — Repoint login page + signOut

**`apps/web/app/login/page.tsx`** — replace all `signIn("resend", …)` / NextAuth `signIn` calls with `authClient`:

```ts
import { authClient } from "@/lib/better-auth/client";

// Email/magic-link:
await authClient.signIn.magicLink({ email });
// Or email+password:
await authClient.signIn.email({ email, password });
// Google:
await authClient.signIn.social({ provider: "google" });
```

**`apps/web/lib/account-actions.ts`** — replace NextAuth `signOut()` with:

```ts
import { authClient } from "@/lib/better-auth/client";
await authClient.signOut();
```

### Step 5 — Delete dead auth() call in editor

In `apps/web/app/editor/page.tsx`, line 19, remove:

```ts
const session = await auth();  // DELETE — result is never used
```

### Step 6 — Retire NextAuth (after parallel-run verified)

Only after you've confirmed logins and generations work end-to-end:

1. Delete `apps/web/app/api/auth/[...nextauth]/route.ts`
2. Remove `@auth/prisma-adapter` from `package.json`
3. Delete `apps/web/auth.ts` (the NextAuth config + the duplicated sender logic)
4. Clean up any orphaned NextAuth imports

---

## 3. Proxy Rewrite — Full Snippet

```ts
// apps/web/proxy.ts  (replaces the NextAuth auth((req)=>{...}) wall)

import { auth } from "@/lib/better-auth/server";
import { NextResponse } from "next/server";

export async function proxy(req: NextRequest) {
  // Better Auth session check — replaces NextAuth's auth((req)=>{...}) wrapper
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    const from = encodeURIComponent(req.nextUrl.pathname);
    return NextResponse.redirect(new URL(`/login?from=${from}`, req.url));
  }

  // ... rest of proxy logic unchanged (R2 forwarding, etc.)
}
```

---

## 4. Lockout Preconditions (Mandatory — SaaS-foundation spec §6.2)

Do not cut over on the production database until all of these are satisfied:

1. **Stage on a DB clone** — run the migration (`*_better_auth`) on a copy of production data first; verify the ba_* tables exist and the NextAuth tables are untouched.

2. **Dry-run a full login flow** — sign in with email+magic-link AND with Google OAuth on the staging clone; confirm `User` row is created/resolved correctly via `convergeIdentity`, and that the `auth.signin` audit event is written.

3. **Dry-run one end-to-end generation** — ⚠️ **this spends real fal.ai money. Confirm with the human before running.** Verify the full path: auth → org → generation → R2 result.

4. **Keep `User.id` as cuid** — `convergeIdentity` is keyed off email and resolves to the existing `User` record. Do not change the id strategy.

5. **Additive + reversible** — the ba_* tables are append-only; the NextAuth tables are untouched. This must remain true throughout. No destructive schema ops.

6. **Never touch**: the founder seed (`User` row for the founder email), `ownerId` on any Org/Asset, or R2 bucket keys/policies.

---

## 5. Rollback

The cutover is fully reversible as long as you have not yet completed Step 6 (NextAuth retirement).

To roll back:

```bash
# 1. Revert the auth-guard.ts import
#    change: import { auth } from "@/lib/better-auth/compat";
#    back to: import { auth } from "@/auth";

# 2. Revert proxy.ts to the original auth((req)=>{...}) form

# 3. Revert login/page.tsx and account-actions.ts to NextAuth signIn/signOut

# 4. Drop the ba_* tables (schema will be clean once migration is rolled back):
npx prisma migrate resolve --rolled-back <migration-name>
# or manually: DROP TABLE ba_user, ba_session, ba_account, ba_verification;

# 5. Delete the Better Auth library directory:
rm -rf apps/web/lib/better-auth/
rm -f apps/web/app/api/better-auth/[...all]/route.ts
```

Result: zero data loss on the live NextAuth path. The NextAuth `Account`, `Session`, `User` tables are completely untouched throughout.

---

## 6. Notes from the final review (for cutover)

The whole-branch review verified the allowlist is fail-closed across all methods (it traced better-auth's internals: every session-issuing path hits `internalAdapter.createSession` → `databaseHooks.session.create.before` → `assertAllowedForUserId`, which throws before any row/cookie is written). Three items to handle **at cutover**, not now:

1. **Proxy runtime compatibility.** Step 3 swaps the proxy wall to `auth.api.getSession({ headers: req.headers })`, which pulls the Better Auth + Prisma (Node) stack into `proxy.ts`. The current proxy runs on the Node runtime, so this should be fine — but confirm there's no `export const runtime = "edge"` on the proxy before flipping, or the Prisma import will fail at the edge.
2. **Add an OAuth-callback integration test.** The unit tests prove the gate *function* (`assertAllowedForUserId`) is fail-closed; the library wiring that *invokes* it on the OAuth callback was verified by code-trace, not by an automated test. At cutover, add a test that drives a real OAuth-callback session creation against a test DB so the gate behavior is locked in CI.
3. **Drop the redundant role lookup (optional).** Both `server.ts`'s `customSession` and `compat.ts` call `roleForEmail` → one extra `User`-by-email query per guarded request once live. Since `compat.ts` is the consumer post-cutover, you can drop the `customSession` role enrichment to save the query. Harmless either way.
