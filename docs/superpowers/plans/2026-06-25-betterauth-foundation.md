# Better Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Better Auth stack (email+password, Google, magic-link) that runs alongside the live NextAuth install, dormant and additive, with a tested cutover seam — so the merge engineer can flip it on later in a small, documented step.

**Architecture:** Better Auth gets its own `ba_*` Prisma tables (auth bookkeeping). On sign-in, after the existing allowlist passes, an after-hook get-or-creates the canonical `User` row by email and reuses the existing `bootstrapPersonalOrg` convergence — so the 42 `auth-guard` consumers and the `User.id`(cuid)/`Membership` FK graph are untouched. Session shape is reproduced byte-for-byte so the cutover is a swap of the guard's internal `auth()`.

**Tech Stack:** Next.js 16, Better Auth ^1.6 (1.6.20), Prisma 7 (`prisma-client` generator → `../generated/prisma`), Postgres (Neon), Resend, vitest ^3.2, pnpm workspace (`@fikirtive/web`, `@fikirtive/db`, `@fikirtive/core`).

**Spec:** [docs/superpowers/specs/2026-06-25-betterauth-foundation-design.md](../specs/2026-06-25-betterauth-foundation-design.md)

## Global Constraints

Every task implicitly includes these (verbatim from the spec / live mapping):

- **Package:** `better-auth@^1.6` (pin 1.6.20). Use the **built-in** `better-auth/adapters/prisma` — do NOT add the separate `@better-auth/prisma-adapter`.
- **Prisma client:** reuse the existing `prisma` singleton from `@fikirtive/db` (it already imports the custom `../generated/prisma` output — satisfies the Prisma-7 caveat). **Never** `new PrismaClient()` or import `@prisma/client`.
- **Next.js 16 is NOT the Next.js you know** (`apps/web/AGENTS.md`). Before writing the route handler, read `apps/web/node_modules/next/dist/docs/` for route-handler conventions.
- **`nextCookies()` MUST be the LAST plugin** in the array.
- **Better Auth base path = `/api/better-auth`** (two catch-alls can't share `/api/auth`).
- **Server-side session reads:** `auth.api.getSession({ headers: await headers() })` — never the client.
- **Schema:** `npx @better-auth/cli@latest generate` writes the Prisma models; apply SQL with `pnpm --filter @fikirtive/db migrate:dev`. The BA CLI `migrate` command is **Kysely-only — do not use it**.
- **BA tables use distinct model + `@@map` names** (`ba_user/ba_session/ba_account/ba_verification`). Migration must be **additive only** — no `ALTER`/`DROP` on existing tables.
- **Session shape (byte-identical target):** `session.user = { email?, name?, image?, role?: Role }`, `Role = "super-admin"|"ops"|"finance"|"moderator"|"viewer"`, `role` defaults to `"viewer"` on missing/garbage, a session read NEVER throws.
- **`User.id` stays cuid.** Do not touch `Account.userId`/`Session.userId`/`Membership.userId` FKs or the `Organization`-rooted business FKs.
- **Dormant:** no edits to `auth.ts` (except the `isFounderAdmin` re-export), `proxy.ts`, `app/login`, `auth-guard.ts`, `app/api/auth/[...nextauth]`, `account-actions.ts`. Nothing imports the BA stack except its tests.
- **$0:** no fal, no real Google credentials; Google tested with a mocked provider.
- **Verify against installed types:** Better Auth 1.6 option names (hooks, `customSession`, `emailAndPassword`, `magicLink`) must be checked against `apps/web/node_modules/better-auth/dist/**/*.d.ts` during implementation — adjust the code below to the actual installed signatures.

**Test command (single file):** `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/<file>` (run from repo root).
**Typecheck:** `pnpm --filter @fikirtive/web typecheck`. **Build:** `pnpm --filter @fikirtive/web build`.

---

### Task 1: Install Better Auth + env placeholders

**Files:**
- Modify: `apps/web/package.json` (via pnpm)
- Modify: `.env.example`

- [ ] **Step 1: Install the package**

Run (from repo root): `pnpm --filter @fikirtive/web add better-auth@^1.6`

- [ ] **Step 2: Verify the installed version + types exist**

Run: `node -e "console.log(require('./apps/web/node_modules/better-auth/package.json').version)"`
Expected: `1.6.20` (or another `1.6.x`).
Run: `ls apps/web/node_modules/better-auth/dist/adapters/prisma` — confirm the built-in adapter path resolves.

- [ ] **Step 3: Add env placeholders** to `.env.example` under a new `# --- Better Auth (dormant; cutover only) ---` section:

```bash
# --- Better Auth (dormant foundation; not wired until cutover) ---
BETTER_AUTH_SECRET=""                  # openssl rand -base64 32 (distinct from AUTH_SECRET)
BETTER_AUTH_URL="http://localhost:3100" # canonical origin — match AUTH_URL
GOOGLE_CLIENT_ID=""                    # Google OAuth app (registered by ops before cutover)
GOOGLE_CLIENT_SECRET=""
# Reuses existing RESEND_API_KEY / AUTH_EMAIL_FROM / FOUNDER_ADMIN_EMAILS / AUTH_ALLOWED_EMAILS
```

- [ ] **Step 4: Typecheck (nothing should break)**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: PASS (no new code yet).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml .env.example
git commit -m "chore(auth): install better-auth@^1.6 + env placeholders (dormant foundation)"
```

---

### Task 2: Extract `isFounderAdmin` into `lib/allowlist.ts` (next-auth-free), re-export from `auth.ts`

**Files:**
- Modify: `apps/web/lib/allowlist.ts`
- Modify: `apps/web/auth.ts:43-50` (remove the body, add a re-export)
- Test: `apps/web/lib/__tests__/allowlist.test.ts`

**Interfaces:**
- Produces: `isFounderAdmin(email: string | null | undefined): boolean` exported from `@/lib/allowlist` (and still re-exported from `@/auth` for the 2 existing importers).

- [ ] **Step 1: Add the failing test** to `allowlist.test.ts`:

```ts
describe("isFounderAdmin", () => {
  it("is true for a founder email (case-insensitive), false otherwise", async () => {
    const { isFounderAdmin } = await import("@/lib/allowlist");
    expect(isFounderAdmin("FOUNDER@artlio.test")).toBe(true); // FOUNDER_ADMIN_EMAILS set in beforeEach
    expect(isFounderAdmin("merchant@artlio.test")).toBe(false);
    expect(isFounderAdmin(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/allowlist.test.ts`
Expected: FAIL — `isFounderAdmin is not a function`.

- [ ] **Step 3: Move the function into `lib/allowlist.ts`** (append after `isAllowedEmail`):

```ts
/** Dedicated founder list (OPT-6 P1b) — distinct from AUTH_ALLOWED_EMAILS. Founders
 *  are seeded to super-admin on sign-in. next-auth-free so both auth stacks share it. */
export function isFounderAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
```

- [ ] **Step 4: Replace the body in `auth.ts`** — delete lines 43-50's function and add at the top (with the other imports) `isFounderAdmin` to the allowlist import, then re-export it:

In `auth.ts`, change `import { isAllowedEmail } from "@/lib/allowlist";` to:
```ts
import { isAllowedEmail, isFounderAdmin } from "@/lib/allowlist";
```
Replace the old `export function isFounderAdmin(...) {...}` block (lines 43-50) with:
```ts
/** Re-exported from @/lib/allowlist for back-compat (admin/layout + auth-guard import it from @/auth). */
export { isFounderAdmin };
```

- [ ] **Step 5: Run allowlist test + typecheck**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/allowlist.test.ts`
Expected: PASS.
Run: `pnpm --filter @fikirtive/web typecheck`
Expected: PASS (the 2 importers `app/admin/layout.tsx`, `lib/auth-guard.ts` still resolve `isFounderAdmin` from `@/auth`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/allowlist.ts apps/web/auth.ts apps/web/lib/__tests__/allowlist.test.ts
git commit -m "refactor(auth): move isFounderAdmin to lib/allowlist (next-auth-free), re-export from auth.ts"
```

---

### Task 3: Better Auth Prisma models (`ba_*`) + additive migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append 4 models)
- Create: `packages/db/prisma/migrations/<timestamp>_better_auth/migration.sql` (generated)

- [ ] **Step 1: Append the 4 BA models** to `schema.prisma` (distinct model + `@@map` names; FKs target `ba_user`, NOT the existing `User`):

```prisma
// --- Better Auth (dormant foundation) — own tables, no collision with NextAuth's User/Account/Session/VerificationToken ---
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
model BetterAuthSession {
  id        String         @id
  expiresAt DateTime
  token     String         @unique
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      BetterAuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("ba_session")
}
model BetterAuthAccount {
  id                    String         @id
  accountId             String
  providerId            String
  userId                String
  user                  BetterAuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime       @default(now())
  updatedAt             DateTime       @updatedAt
  @@index([userId])
  @@map("ba_account")
}
model BetterAuthVerification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([identifier])
  @@map("ba_verification")
}
```

> Note: this matches Better Auth's canonical schema; the `modelName` mapping in `server.ts` (Task 7) points BA at these models. If `npx @better-auth/cli@latest generate` is preferred, run it and reconcile to the above (distinct model names + `@@map`).

- [ ] **Step 2: Validate the schema**

Run: `pnpm --filter @fikirtive/db exec prisma validate`
Expected: "The schema at ... is valid 🚀".

- [ ] **Step 3: Create the migration**

Run: `pnpm --filter @fikirtive/db migrate:dev -- --name better_auth`
Expected: a new folder `packages/db/prisma/migrations/<ts>_better_auth/migration.sql` created and applied.

- [ ] **Step 4: Assert the migration is purely additive**

Run: `grep -iE 'ALTER TABLE \"(User|Account|Session|VerificationToken|Membership|Organization|CreditAccount)\"|DROP ' packages/db/prisma/migrations/*_better_auth/migration.sql`
Expected: NO output (only `CREATE TABLE "ba_*"`, `CREATE INDEX`, `ADD CONSTRAINT ... FOREIGN KEY` referencing `ba_user`).

- [ ] **Step 5: Regenerate the client + typecheck db**

Run: `pnpm --filter @fikirtive/db generate && pnpm --filter @fikirtive/db typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): additive Better Auth tables (ba_user/session/account/verification)"
```

---

### Task 4: Auth email sender (`sender.ts`) — ported Resend + dev fallback + rate-limit

**Files:**
- Create: `apps/web/lib/better-auth/sender.ts`
- Test: `apps/web/lib/__tests__/better-auth-sender.test.ts`

**Interfaces:**
- Produces: `sendAuthEmail(opts: { to: string; subject: string; url: string; intro: string }): Promise<void>` — rate-limits per `to` (5/hr), writes `.data/last-magic-link.txt` in dev when `RESEND_API_KEY` unset, else POSTs to Resend.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const DEV_FILE = path.join(process.cwd(), "..", "..", ".data", "last-magic-link.txt");

describe("sendAuthEmail", () => {
  beforeEach(() => { delete process.env.RESEND_API_KEY; process.env.NODE_ENV = "test"; });
  afterEach(async () => { await rm(DEV_FILE, { force: true }); vi.restoreAllMocks(); });

  it("writes the link to the dev file when RESEND_API_KEY is unset", async () => {
    const { sendAuthEmail } = await import("@/lib/better-auth/sender");
    await sendAuthEmail({ to: "a@x.test", subject: "S", url: "https://x.test/verify?t=1", intro: "Sign in" });
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/verify?t=1");
  });

  it("rate-limits after 5 sends per address per hour", async () => {
    const { sendAuthEmail } = await import("@/lib/better-auth/sender");
    const call = () => sendAuthEmail({ to: "rl@x.test", subject: "S", url: "u", intro: "i" });
    for (let i = 0; i < 5; i++) await call();
    await expect(call()).rejects.toThrow(/Too many/);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-sender.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sender.ts`** (ports the logic from `auth.ts:17-89`):

```ts
import "server-only";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

function rateLimit(key: string) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    throw new Error("Too many sign-in links requested — try again in an hour.");
  }
  recent.push(now);
  attempts.set(key, recent);
}

export async function sendAuthEmail(opts: { to: string; subject: string; url: string; intro: string }): Promise<void> {
  const { to, subject, url, intro } = opts;
  rateLimit(to);
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not configured.");
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "..", "..", ".data");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "last-magic-link.txt"), url, "utf8");
    console.log(`[better-auth] ${subject} for ${to}: ${url}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM ?? "Fikirtive <onboarding@resend.dev>",
      to,
      subject,
      text: `${intro}:\n${url}\n\nIf you didn't request this, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Auth email failed (${res.status}).`);
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-sender.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/better-auth/sender.ts apps/web/lib/__tests__/better-auth-sender.test.ts
git commit -m "feat(auth): better-auth email sender (Resend + dev fallback + rate-limit)"
```

---

### Task 5: `roleForEmail` (`session-role.ts`) — surface canonical role on the BA session

**Files:**
- Create: `apps/web/lib/better-auth/session-role.ts`
- Test: `apps/web/lib/__tests__/better-auth-session-role.test.ts`

**Interfaces:**
- Produces: `roleForEmail(email: string | null | undefined): Promise<Role>` — reads the canonical `User.role` by email, returns `"viewer"` on missing/garbage/no-email, never throws.

- [ ] **Step 1: Write the failing test** (mock `@fikirtive/db` per `allowlist.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const mockFindUnique = vi.fn();
vi.mock("@fikirtive/db", () => ({ prisma: { user: { findUnique: mockFindUnique } } }));
const { roleForEmail } = await import("@/lib/better-auth/session-role");

beforeEach(() => mockFindUnique.mockReset());

describe("roleForEmail", () => {
  it("returns the user's role when valid", async () => {
    mockFindUnique.mockResolvedValue({ role: "ops" });
    expect(await roleForEmail("a@x.test")).toBe("ops");
  });
  it("defaults to viewer on missing user, garbage role, no email, or DB error", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await roleForEmail("a@x.test")).toBe("viewer");
    mockFindUnique.mockResolvedValue({ role: "wat" });
    expect(await roleForEmail("a@x.test")).toBe("viewer");
    expect(await roleForEmail(null)).toBe("viewer");
    mockFindUnique.mockRejectedValue(new Error("db down"));
    expect(await roleForEmail("a@x.test")).toBe("viewer");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-session-role.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `session-role.ts`:**

```ts
import "server-only";
import { prisma } from "@fikirtive/db";
import { isRole, type Role } from "@fikirtive/core";

/** Canonical role for an email (the BA session enrichment seam). Mirrors auth.ts's
 *  session callback: missing/garbage/no-email/DB-error → "viewer", never throws. */
export async function roleForEmail(email: string | null | undefined): Promise<Role> {
  if (!email) return "viewer";
  try {
    const row = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { role: true } });
    return isRole(row?.role) ? row.role : "viewer";
  } catch {
    return "viewer";
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-session-role.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/better-auth/session-role.ts apps/web/lib/__tests__/better-auth-session-role.test.ts
git commit -m "feat(auth): roleForEmail — canonical role on the Better Auth session"
```

---

### Task 6: `convergeIdentity` (`converge.ts`) — canonical User + founder self-heal + org bootstrap + audit

**Files:**
- Create: `apps/web/lib/better-auth/converge.ts`
- Test: `apps/web/lib/__tests__/better-auth-converge.test.ts`

**Interfaces:**
- Consumes: `bootstrapPersonalOrg(userId, email)` from `@/lib/auth-guard`; `isFounderAdmin` from `@/lib/allowlist`; `newId`, `FOUNDER_OWNER_ID` from `@fikirtive/core`.
- Produces: `convergeIdentity(input: { email: string; name?: string | null; image?: string | null }): Promise<void>` — idempotent; mirrors `auth.ts:112-156` `events.signIn`. Looks up/creates the canonical `User` by email, founder self-heal (promote-only), founder membership seed OR non-founder `bootstrapPersonalOrg`, writes `auth.signin` ActionEvent. Best-effort throughout — never throws.

- [ ] **Step 1: Write the failing test** (mock db + auth-guard):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const db = {
  user: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  membership: { upsert: vi.fn() },
  actionEvent: { create: vi.fn() },
};
vi.mock("@fikirtive/db", () => ({ prisma: db }));
const mockBootstrap = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ bootstrapPersonalOrg: mockBootstrap }));

beforeEach(() => {
  Object.values(db).forEach((m) => Object.values(m).forEach((f: any) => f.mockReset()));
  mockBootstrap.mockReset();
  process.env.FOUNDER_ADMIN_EMAILS = "founder@x.test";
});

describe("convergeIdentity", () => {
  it("creates the canonical user if absent and bootstraps a non-founder org + audit", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "usr_1", email: "merchant@x.test" });
    await convergeIdentity({ email: "merchant@x.test", name: "M" });
    expect(db.user.create).toHaveBeenCalled();
    expect(mockBootstrap).toHaveBeenCalledWith("usr_1", "merchant@x.test");
    expect(db.actionEvent.create).toHaveBeenCalled();
  });
  it("self-heals founder super-admin + seeds founder membership, no personal bootstrap", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockResolvedValue({ id: "usr_f", email: "founder@x.test" });
    await convergeIdentity({ email: "founder@x.test" });
    expect(db.user.updateMany).toHaveBeenCalled();   // promote-only self-heal
    expect(db.membership.upsert).toHaveBeenCalled();  // founder membership seed
    expect(mockBootstrap).not.toHaveBeenCalled();
  });
  it("never throws when a write fails", async () => {
    const { convergeIdentity } = await import("@/lib/better-auth/converge");
    db.user.findUnique.mockRejectedValue(new Error("db"));
    await expect(convergeIdentity({ email: "x@x.test" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-converge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `converge.ts`** (mirrors `auth.ts` `events.signIn`; key off email; create the User if BA made a new identity):

```ts
import "server-only";
import { prisma } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { isFounderAdmin } from "@/lib/allowlist";

/** Convergence on BA sign-in. Mirrors auth.ts events.signIn but keyed off email
 *  (the canonical join key). Idempotent, best-effort, NEVER throws — requireOwner()
 *  remains the authoritative fail-closed resolver. */
export async function convergeIdentity(input: { email: string; name?: string | null; image?: string | null }): Promise<void> {
  const email = input.email.toLowerCase();
  try {
    // 1. Ensure the canonical User row exists (BA identities reconnect to the tenant graph by email).
    let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, name: input.name ?? null, image: input.image ?? null },
        select: { id: true },
      });
    }
    // 2. Founder super-admin self-heal (promote-only, idempotent).
    if (isFounderAdmin(email)) {
      await prisma.user.updateMany({ where: { email, role: { not: "super-admin" } }, data: { role: "super-admin" } }).catch(() => {});
      await prisma.membership.upsert({
        where: { userId_orgId: { userId: user.id, orgId: FOUNDER_OWNER_ID } },
        create: { id: newId(), userId: user.id, orgId: FOUNDER_OWNER_ID, role: "owner" },
        update: {},
      }).catch(() => {});
    } else {
      // 3. Non-founder personal-org convergence (best-effort; requireOwner re-bootstraps on demand).
      try {
        const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
        await bootstrapPersonalOrg(user.id, email);
      } catch (e) {
        console.warn("[better-auth] converge bootstrap failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    }
    // 4. Audit.
    await prisma.actionEvent.create({ data: { id: newId(), ownerId: "founder", type: "auth.signin", payload: { email } } }).catch(() => {});
  } catch (e) {
    console.warn("[better-auth] convergeIdentity failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-converge.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/better-auth/converge.ts apps/web/lib/__tests__/better-auth-converge.test.ts
git commit -m "feat(auth): convergeIdentity — canonical User + founder heal + org bootstrap + audit"
```

---

### Task 7: Better Auth server instance (`server.ts`)

**Files:**
- Create: `apps/web/lib/better-auth/server.ts`
- Test: `apps/web/lib/__tests__/better-auth-server.test.ts`

**Interfaces:**
- Consumes: `sendAuthEmail` (Task 4), `roleForEmail` (Task 5), `convergeIdentity` (Task 6), `isAllowedEmail` from `@/lib/allowlist`.
- Produces: `export const auth` — the Better Auth instance (`auth.handler`, `auth.api.getSession`, etc.).

- [ ] **Step 1: Read the installed types FIRST** (not optional):

Run: `sed -n '1,80p' apps/web/node_modules/better-auth/dist/index.d.ts | grep -nE 'betterAuth|hooks|customSession|emailAndPassword|magicLink'`
Then open `apps/web/node_modules/better-auth/dist/types/*.d.ts` for `BetterAuthOptions` (the exact `hooks.before` / `databaseHooks` / `emailVerification` / `account.modelName` / `customSession` shapes). Adjust the code in Step 3 to match the installed 1.6 signatures.

- [ ] **Step 2: Write the failing test** (construction + surface; the behavioral pieces are unit-tested in Tasks 4-6):

```ts
import { describe, it, expect, beforeAll } from "vitest";
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
});
describe("better-auth server instance", () => {
  it("constructs and exposes the server API", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(typeof auth.handler).toBe("function");
    expect(typeof auth.api.getSession).toBe("function");
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `server.ts`** (adjust option names to the installed types from Step 1):

```ts
import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
import { customSession } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { isAllowedEmail } from "@/lib/allowlist";
import { sendAuthEmail } from "./sender";
import { roleForEmail } from "./session-role";
import { convergeIdentity } from "./converge";

async function assertAllowed(email: string | null | undefined) {
  if (!(await isAllowedEmail(email))) {
    throw new APIError("FORBIDDEN", { message: "This email isn't on the allowlist." });
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/better-auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Map BA's four models to the dormant ba_* tables (Task 3).
  user: { modelName: "BetterAuthUser" },
  session: { modelName: "BetterAuthSession" },
  account: { modelName: "BetterAuthAccount" },
  verification: { modelName: "BetterAuthVerification" },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({ to: user.email, subject: "Reset your Fikirtive password", url, intro: "Reset your password" });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({ to: user.email, subject: "Verify your Fikirtive email", url, intro: "Verify your email" });
    },
  },
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" },
  },
  // Deny-by-default allowlist across EVERY method (before any session is issued).
  hooks: {
    before: async (ctx) => {
      const email: string | undefined = ctx.body?.email;
      if (email && (ctx.path?.startsWith("/sign-in") || ctx.path?.startsWith("/sign-up"))) {
        await assertAllowed(email);
      }
    },
  },
  // Convergence after a user row exists (BA's own ba_user); reconnect to the tenant graph by email.
  databaseHooks: {
    user: {
      create: { after: async (u: { email: string; name?: string | null; image?: string | null }) => { await convergeIdentity(u); } },
    },
    session: {
      create: { after: async (s: { userId: string }) => {
        const u = await prisma.betterAuthUser.findUnique({ where: { id: s.userId }, select: { email: true, name: true, image: true } });
        if (u) await convergeIdentity(u);
      } },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        await assertAllowed(email);
        await sendAuthEmail({ to: email, subject: "Sign in to Fikirtive", url, intro: "Sign in to Fikirtive" });
      },
    }),
    // Surface the canonical role on the session so compat.ts matches NextAuth byte-for-byte.
    customSession(async ({ user, session }) => {
      return { user: { ...user, role: await roleForEmail(user.email) }, session };
    }),
    nextCookies(), // MUST be last.
  ],
});
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-server.test.ts`
Expected: PASS.
Run: `pnpm --filter @fikirtive/web typecheck`
Expected: PASS (fix any option-name mismatches against the installed types from Step 1).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/better-auth/server.ts apps/web/lib/__tests__/better-auth-server.test.ts
git commit -m "feat(auth): better-auth server instance (email+password, google, magic-link, allowlist gate, role session)"
```

---

### Task 8: Next.js route handler (`/api/better-auth/[...all]`)

**Files:**
- Create: `apps/web/app/api/better-auth/[...all]/route.ts`
- Test: `apps/web/lib/__tests__/better-auth-route.test.ts`

- [ ] **Step 1: Read the Next 16 route-handler doc**

Run: `ls apps/web/node_modules/next/dist/docs/ && grep -rl "route" apps/web/node_modules/next/dist/docs/ | head`
Read the route-handler guide; confirm the `GET`/`POST` export convention for this Next version.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
beforeAll(() => { process.env.BETTER_AUTH_SECRET = "x".repeat(40); process.env.BETTER_AUTH_URL = "http://localhost:3100"; });
describe("better-auth route handler", () => {
  it("exports GET and POST", async () => {
    const mod = await import("@/app/api/better-auth/[...all]/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the route**

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth/server";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 5: Run the test + build**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-route.test.ts`
Expected: PASS.
Run: `pnpm --filter @fikirtive/web build`
Expected: PASS — the new route compiles; no conflict with `/api/auth/[...nextauth]`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/api/better-auth/[...all]/route.ts" apps/web/lib/__tests__/better-auth-route.test.ts
git commit -m "feat(auth): better-auth Next.js route handler at /api/better-auth"
```

---

### Task 9: Browser client (`client.ts`)

**Files:**
- Create: `apps/web/lib/better-auth/client.ts`
- Test: `apps/web/lib/__tests__/better-auth-client.test.ts`

**Interfaces:**
- Produces: `export const authClient` — with `signIn.magicLink`, `signIn.email`, `signIn.social`, `signUp.email`, `signOut`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
describe("better-auth client", () => {
  it("exposes magic-link + social + email sign-in", async () => {
    const { authClient } = await import("@/lib/better-auth/client");
    expect(typeof authClient.signIn.magicLink).toBe("function");
    expect(typeof authClient.signIn.social).toBe("function");
    expect(typeof authClient.signOut).toBe("function");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client.ts`** (verify `magicLinkClient` import path against installed types):

```ts
"use client";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  basePath: "/api/better-auth",
  plugins: [magicLinkClient()],
});
```

> Add `NEXT_PUBLIC_BETTER_AUTH_URL` to the `.env.example` BA block (browser needs the public origin). If the app derives origin from `window`, this can be omitted — confirm against the client docs.

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/better-auth/client.ts apps/web/lib/__tests__/better-auth-client.test.ts .env.example
git commit -m "feat(auth): better-auth browser client (magic-link + social + email)"
```

---

### Task 10: Cutover seam (`compat.ts`) — NextAuth-shaped `auth()` drop-in

**Files:**
- Create: `apps/web/lib/better-auth/compat.ts`
- Test: `apps/web/lib/__tests__/better-auth-compat.test.ts`

**Interfaces:**
- Consumes: `auth.api.getSession` (Task 7), `roleForEmail` (Task 5).
- Produces: `auth(): Promise<{ user: { email: string | null; name: string | null; image: string | null; role: Role } } | null>` — byte-identical to the NextAuth `auth()` session that `auth-guard.ts` consumes. **Dormant** — imported only by this test until cutover.

- [ ] **Step 1: Write the failing test** (mock the BA server + headers):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const mockGetSession = vi.fn();
vi.mock("@/lib/better-auth/server", () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const mockRoleForEmail = vi.fn();
vi.mock("@/lib/better-auth/session-role", () => ({ roleForEmail: mockRoleForEmail }));
const { auth } = await import("@/lib/better-auth/compat");

beforeEach(() => { mockGetSession.mockReset(); mockRoleForEmail.mockReset(); });

describe("compat auth()", () => {
  it("returns null when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await auth()).toBeNull();
  });
  it("returns the NextAuth-shaped session with role", async () => {
    mockGetSession.mockResolvedValue({ user: { email: "a@x.test", name: "A", image: null } });
    mockRoleForEmail.mockResolvedValue("ops");
    expect(await auth()).toEqual({ user: { email: "a@x.test", name: "A", image: null, role: "ops" } });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-compat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `compat.ts`:**

```ts
import "server-only";
import { headers } from "next/headers";
import type { Role } from "@fikirtive/core";
import { auth as baAuth } from "./server";
import { roleForEmail } from "./session-role";

type NextAuthShapedSession = { user: { email: string | null; name: string | null; image: string | null; role: Role } } | null;

/** Cutover drop-in for the NextAuth `auth()` consumed by auth-guard.ts. Returns the
 *  exact session.user shape (email/name/image/role, role defaulting to "viewer"). DORMANT. */
export async function auth(): Promise<NextAuthShapedSession> {
  const session = await baAuth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const email = session.user.email ?? null;
  return {
    user: {
      email,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
      role: await roleForEmail(email),
    },
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @fikirtive/web test apps/web/lib/__tests__/better-auth-compat.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/better-auth/compat.ts apps/web/lib/__tests__/better-auth-compat.test.ts
git commit -m "feat(auth): compat auth() — NextAuth-shaped session drop-in (dormant cutover seam)"
```

---

### Task 11: Handoff doc for the cutover (钟司令)

**Files:**
- Create: `docs/superpowers/handoffs/2026-06-25-betterauth-cutover.md`

- [ ] **Step 1: Write the handoff doc** with these sections (real content, not placeholders):

  - **What's built & dormant:** the file list (server/client/compat/route/sender/converge/session-role + ba_* tables), and proof nothing live imports it.
  - **Flip checklist (in order):**
    1. Register the Google OAuth app; set `GOOGLE_CLIENT_ID/SECRET`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`.
    2. Point `auth-guard.ts`'s internal `auth()` at `@/lib/better-auth/compat` (one import swap; the 4 guard signatures + 42 consumers don't change).
    3. Rewrite `proxy.ts` (NextAuth's `auth((req)=>…)` has no BA equivalent) — **snippet below**.
    4. Repoint `app/login/page.tsx` to `authClient` (`signIn.email` / `signIn.social("google")` / `signIn.magicLink`); update `account-actions.ts` `signOut` to `authClient.signOut`.
    5. Delete the dead `const session = await auth()` in `app/editor/page.tsx:19`.
    6. Retire `app/api/auth/[...nextauth]` + the NextAuth adapter + `auth.ts` provider, once parallel-run is verified.
  - **Proxy rewrite snippet** (pre-written, unwired):
    ```ts
    import { auth } from "@/lib/better-auth/server";
    // inside proxy(req): 
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) { /* redirect to /login?from=<pathname> as today */ }
    ```
  - **Lockout preconditions (SaaS-foundation §6.2 — mandatory):** stage on a DB clone; dry-run a login AND one end-to-end generation (**spends real fal money — confirm first**); keep `User.id` cuid; additive+reversible; never touch the founder seed.
  - **Rollback:** drop the `ba_*` tables + delete `apps/web/lib/better-auth/` + the route; revert the guard import. Pure additive — no data loss for the live NextAuth path.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/handoffs/2026-06-25-betterauth-cutover.md
git commit -m "docs(auth): Better Auth cutover handoff (flip checklist + proxy snippet + rollback)"
```

---

### Task 12: Full verification + dormancy proof

**Files:** none (verification only)

- [ ] **Step 1: Full web test suite**

Run: `pnpm --filter @fikirtive/web test`
Expected: PASS — all existing tests + the 7 new BA test files green.

- [ ] **Step 2: Typecheck + build + db**

Run: `pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build && pnpm --filter @fikirtive/db typecheck && pnpm --filter @fikirtive/db exec prisma validate`
Expected: all PASS.

- [ ] **Step 3: Prove dormancy** — no LIVE file imports the BA stack (only tests + compat self-reference):

Run: `grep -rn "lib/better-auth" apps/web --include='*.ts' --include='*.tsx' | grep -v "__tests__" | grep -v "lib/better-auth/"`
Expected: ONLY `apps/web/app/api/better-auth/[...all]/route.ts` (the dormant route). NOTHING in `proxy.ts`, `auth-guard.ts`, `app/login`, `account-actions.ts`.

- [ ] **Step 4: Prove the migration was additive**

Run: `git log --oneline -- packages/db/prisma/migrations | head` and re-confirm Task 3 Step 4 (no ALTER/DROP on existing tables).

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A && git commit -m "test(auth): full verification — better-auth foundation green + dormant" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:** §2 access model → Tasks 5/6/7 (allowlist gate + canonical role + convergence). §3 invariants → Tasks 2/5/6/10 (export surface, session shape, User.id untouched). §4 identity bridge → Task 6. §5 components → Tasks 1-11 (every file mapped). §6 methods → Task 7 (email+password, google, magicLink). §7 library specifics → Tasks 1/3/7/8. §8 dormant → Task 12 Step 3. §9 verification → Tasks 4-10 tests + Task 12. §10 handoff → Task 11. No gaps.

**Placeholder scan:** no "TBD/TODO/handle edge cases"; every code step shows real code; "verify against installed types" steps are concrete verification actions, not deferred work.

**Type consistency:** `sendAuthEmail({to,subject,url,intro})` used identically in Tasks 4/7. `roleForEmail(email)→Role` used in Tasks 5/7/10. `convergeIdentity({email,name?,image?})` defined Task 6, called Task 7. `auth()` NextAuth-shape defined Task 10 matches the spec §3 session shape. BA model names (`BetterAuthUser` etc.) consistent Tasks 3/7.
