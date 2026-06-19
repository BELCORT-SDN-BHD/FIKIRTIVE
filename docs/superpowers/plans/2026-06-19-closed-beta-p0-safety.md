# Closed-Beta Phase 0 — Beta Safety Prerequisites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the no-schema safety prerequisites for closed beta — close the cross-tenant leaks that detonate at the P3 flip, lock cowork LLM spend to $0, freeze the R2 owner key, wire error monitoring, and stand up the raw-Prisma lint ban — all LOCAL, additive, TDD, no migration.

**Architecture:** Extract the security-critical decisions (storage-key owner check, cowork paid-provider lock, the founder-owner constant) into PURE helpers in `packages/core` (which already has vitest) and unit-test them there; apply surgical `ownerId` filters at the data call-sites (full DB-level isolation proof lands with the P2 test harness + P3 2-org test). Sentry is a thin `@sentry/node` init in both apps, no-op without a DSN.

**Tech Stack:** TypeScript, Next.js 16 (⚠️ breaking changes vs training data — read `node_modules/next/dist/docs/` before touching Next APIs, per `apps/web/AGENTS.md`), Prisma, vitest (core), `@sentry/node`, ESLint flat config.

**House rules (enforce in every task):** LOCAL only; NO prisma migration in P0; surgical (every changed line traces to a P0 item); match existing style; **NO auto-commit/push** — git steps are written but marked **"leave for user"**; use codegraph to ground any symbol you didn't see in this plan.

**Deferred out of P0 (transparent):** the shared/distributed magic-link rate-limit (the current in-memory `Map` in `apps/web/auth.ts:18` is acceptable for single-node beta; a shared store needs storage and is not a no-schema change) — revisit at multi-node. The full Postgres integration-test harness + the 2-org DB isolation test land in **P2/P3** where credit math forces them.

---

### Task 1: Freeze the founder owner id (R2-orphan guard)

The literal `"founder"` is baked into every R2 key (`storageKey() → u/${ownerId}/…`). If it ever changes, every stored blob orphans. Lock it with a test.

**Files:**
- Modify: `packages/core/src/storage-key.ts` (add a doc comment only)
- Test: `packages/core/src/storage-key.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/storage-key.test.ts
import { describe, it, expect } from "vitest";
import { FOUNDER_OWNER_ID, storageKey, parseStorageKey } from "./storage-key.js";

describe("FOUNDER_OWNER_ID (R2-orphan guard)", () => {
  // The founder org is seeded (P1) with id === this literal. R2 keys u/founder/<hash>
  // are derived from it; changing this value orphans every existing blob. DO NOT CHANGE.
  it("is exactly the literal 'founder'", () => {
    expect(FOUNDER_OWNER_ID).toBe("founder");
  });
  it("round-trips through storageKey/parseStorageKey", () => {
    const hash = "a".repeat(64);
    const key = storageKey(FOUNDER_OWNER_ID, hash, "png");
    expect(key).toBe(`u/${FOUNDER_OWNER_ID}/${hash}.png`);
    expect(parseStorageKey(key)).toEqual({ ownerId: "founder", contentHash: hash, ext: "png" });
  });
});
```

- [ ] **Step 2: Run it to verify it passes immediately** (the value is already "founder")

Run: `pnpm --filter @artlio/core test storage-key`
Expected: PASS (this is a regression lock, not a behavior change).

- [ ] **Step 3: Add the warning comment** at `packages/core/src/storage-key.ts:7`

```ts
// DO NOT CHANGE: the founder org is seeded with id === this literal, and it is baked
// into every R2 key (u/founder/<hash>). Changing it orphans every stored blob. A test
// in storage-key.test.ts fails if this value ever drifts.
export const FOUNDER_OWNER_ID = "founder";
```

- [ ] **Step 4: Re-run** `pnpm --filter @artlio/core test storage-key` → PASS.
- [ ] **Step 5: (leave for user) commit**

```bash
# leave for user
git add packages/core/src/storage-key.ts packages/core/src/storage-key.test.ts
git commit -m "test(core): lock FOUNDER_OWNER_ID literal (R2-orphan guard)"
```

---

### Task 2: Pure owned-key assertion + `/files` cross-tenant fix (Codex BLOCKER)

`apps/web/app/files/[...key]/route.ts` serves/presigns any key after only an allowlist check — it never compares the key's embedded owner to the caller. `ownedAssetFromSrc` (`apps/web/lib/actions.ts:756`) filters the Asset row by owner but ignores the owner inside the key. Both need the same check; extract it pure and test it.

**Files:**
- Modify: `packages/core/src/storage-key.ts` (add `keyOwnerMatches`)
- Test: `packages/core/src/storage-key.test.ts` (extend)
- Modify: `apps/web/app/files/[...key]/route.ts`
- Modify: `apps/web/lib/actions.ts` (`ownedAssetFromSrc`)

- [ ] **Step 1: Write the failing test** (extend `storage-key.test.ts`)

```ts
import { keyOwnerMatches } from "./storage-key.js";

describe("keyOwnerMatches (cross-tenant /files guard)", () => {
  const hash = "b".repeat(64);
  it("true when the key's owner equals the caller", () => {
    expect(keyOwnerMatches(`u/founder/${hash}.png`, "founder")).toBe(true);
  });
  it("false when the key belongs to another owner", () => {
    expect(keyOwnerMatches(`u/other/${hash}.png`, "founder")).toBe(false);
  });
  it("false for a malformed / traversal key", () => {
    expect(keyOwnerMatches("../../etc/passwd", "founder")).toBe(false);
    expect(keyOwnerMatches("u/founder/notahash.png", "founder")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @artlio/core test storage-key`
Expected: FAIL — `keyOwnerMatches is not a function`.

- [ ] **Step 3: Implement `keyOwnerMatches`** in `packages/core/src/storage-key.ts` (after `parseStorageKey`)

```ts
/** True iff `key` is a well-formed storage key whose owner namespace === `ownerId`.
 *  The single cross-tenant guard for serving/resolving content-addressed blobs:
 *  a forged or guessed key for another owner returns false. Never throws. */
export function keyOwnerMatches(key: string, ownerId: string): boolean {
  try {
    return parseStorageKey(key).ownerId === ownerId;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run** `pnpm --filter @artlio/core test storage-key` → PASS.

- [ ] **Step 5: Apply the `/files` owner check.** In `apps/web/app/files/[...key]/route.ts`, import the guard and the founder owner, and reject before serving. (P0 = single tenant → the owner is `FOUNDER_OWNER_ID`; P3 swaps this one line for `requireOwner()` and inherits the check.)

```ts
import { parseStorageKey, keyOwnerMatches } from "@artlio/core";
import { FOUNDER_OWNER_ID } from "@/lib/storage";
// ...
  const { key } = await ctx.params;
  const joined = key.join("/");
  // Cross-tenant guard: the key's owner namespace must match the caller's owner.
  // P0 single-tenant owner = FOUNDER_OWNER_ID; P3 replaces with requireOwner().
  if (!keyOwnerMatches(joined, FOUNDER_OWNER_ID)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const { ext } = parseStorageKey(joined);
```

- [ ] **Step 6: Apply the `ownedAssetFromSrc` key-owner check.** In `apps/web/lib/actions.ts`, after deriving `contentHash`, also verify the key's owner.

```ts
async function ownedAssetFromSrc(src: string): Promise<{ id: string; contentHash: string } | null> {
  let contentHash: string;
  try {
    const key = srcToStorageKey(src);
    if (!keyOwnerMatches(key, FOUNDER_OWNER_ID)) return null; // forged/other-owner src
    contentHash = parseStorageKey(key).contentHash;
  } catch {
    return null;
  }
  const asset = await prisma.asset.findFirst({
    where: { ownerId: FOUNDER_OWNER_ID, contentHash, deletedAt: null },
    select: { id: true, contentHash: true },
  });
  return asset;
}
```
(Add `keyOwnerMatches` to the existing `@artlio/core` import in `actions.ts`.)

- [ ] **Step 7: Verify** `pnpm --filter web typecheck` → no errors.
- [ ] **Step 8: (leave for user) commit**

```bash
# leave for user
git add packages/core/src/storage-key.ts packages/core/src/storage-key.test.ts apps/web/app/files/ apps/web/lib/actions.ts
git commit -m "fix(security): reject cross-owner storage keys in /files + ownedAssetFromSrc"
```

---

### Task 3: Scope the latent-IDOR queries by owner (surgical)

Add the missing `ownerId` filter to the unscoped reads. Under single-tenant every row is `"founder"`, so this is functionally a no-op TODAY but removes the landmine that detonates when P3 swaps the constant for the per-org resolver. (Full DB-level isolation proof = the P3 2-org harness; here the change is surgical + reviewed.)

**Files:**
- Modify: `apps/web/lib/data.ts` (`getShots`, `resolveCoworkResultUrls`)
- Modify: `apps/web/lib/gen-actions.ts` (`getGenJob`, `getRecentGenResults` second-hop reads)
- Modify: `apps/web/lib/actions.ts` (`getRenderJobs` asset read)

- [ ] **Step 1: `getShots`** — add `ownerId` to the shot query (`apps/web/lib/data.ts:65`)

```ts
export async function getShots(projectId: string) {
  return prisma.shot.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, projectId, ...notDeleted },
    // ...rest unchanged...
```

- [ ] **Step 2: `resolveCoworkResultUrls`** — add `ownerId` to BOTH second-hop reads (`apps/web/lib/data.ts:134,137`). This one is prioritized: it surfaces `spentUsd` (cross-tenant cost visibility).

```ts
  const jobs = await prisma.genJob.findMany({ where: { id: { in: jobIds }, ownerId: FOUNDER_OWNER_ID }, select: { id: true, generationIds: true, spentUsd: true } });
  const allGenIds = jobs.flatMap((j) => j.generationIds);
  const gens = allGenIds.length
    ? await prisma.generation.findMany({ where: { id: { in: allGenIds }, ownerId: FOUNDER_OWNER_ID }, include: { asset: true } })
    : [];
```

- [ ] **Step 3: `getGenJob` second-hop** (`apps/web/lib/gen-actions.ts:158`) — add `ownerId`

```ts
    const gens = await prisma.generation.findMany({
      where: { id: { in: job.generationIds }, ownerId: FOUNDER_OWNER_ID },
      include: { asset: true },
    });
```

- [ ] **Step 4: `getRecentGenResults` second-hop** (`apps/web/lib/gen-actions.ts:187`) — add `ownerId`

```ts
  const gens = ids.length ? await prisma.generation.findMany({ where: { id: { in: ids }, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, include: { asset: true } }) : [];
```

- [ ] **Step 5: `getRenderJobs` asset read** (`apps/web/lib/actions.ts:737`) — add `ownerId`

```ts
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds }, ownerId: FOUNDER_OWNER_ID } });
```

- [ ] **Step 6: Verify** `pnpm --filter web typecheck` → no errors. Grep to confirm no unscoped second-hop reads remain in these files:

Run: `grep -nE "prisma\.(generation|genJob|asset|shot)\.find" apps/web/lib/data.ts apps/web/lib/gen-actions.ts apps/web/lib/actions.ts`
Expected: every hit's `where` includes `ownerId`.

- [ ] **Step 7: (leave for user) commit**

```bash
# leave for user
git add apps/web/lib/data.ts apps/web/lib/gen-actions.ts apps/web/lib/actions.ts
git commit -m "fix(security): owner-scope latent-IDOR reads (getShots, cowork results, render/gen second-hops)"
```

---

### Task 4: Lock cowork LLM spend to $0 for beta (effective provider, Codex BLOCKER)

`getTransport()` (`apps/web/lib/runtime-config.ts:33`) resolves the planner provider as `db.provider ?? env`, so a DB `cowork_provider=fal` row OR `COWORK_PROVIDER=fal` env activates paid fal LLM spend outside the credits cap. Add a beta lock on the EFFECTIVE provider: default-locked (paid disallowed) — mirrors the existing "default-mock is a money-safety invariant" philosophy.

**Files:**
- Modify: `packages/core/src/runtime-config.ts` (add a pure `effectiveCoworkProvider`)
- Test: `packages/core/src/runtime-config.test.ts` (create or extend)
- Modify: `apps/web/lib/runtime-config.ts` (`getTransport` uses it)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/runtime-config.test.ts
import { describe, it, expect } from "vitest";
import { effectiveCoworkProvider } from "./runtime-config.js";

describe("effectiveCoworkProvider (beta $0 lock)", () => {
  it("DB provider wins over env when paid is allowed", () => {
    expect(effectiveCoworkProvider({ dbProvider: "fal", envProvider: "modal", paidAllowed: true })).toBe("fal");
  });
  it("falls back to env when no DB provider", () => {
    expect(effectiveCoworkProvider({ dbProvider: undefined, envProvider: "fal", paidAllowed: true })).toBe("fal");
  });
  it("FORCES mock (undefined) when paid is NOT allowed — even if db/env say fal", () => {
    expect(effectiveCoworkProvider({ dbProvider: "fal", envProvider: "fal", paidAllowed: false })).toBeUndefined();
  });
  it("defaults to locked: undefined paidAllowed === not allowed", () => {
    expect(effectiveCoworkProvider({ dbProvider: "fal", envProvider: undefined })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @artlio/core test runtime-config`
Expected: FAIL — `effectiveCoworkProvider is not a function`.

- [ ] **Step 3: Implement** in `packages/core/src/runtime-config.ts`

```ts
/** Resolve the EFFECTIVE cowork planner provider, with a beta money-safety lock.
 *  DB provider overrides env, BUT when paid providers are not allowed (the beta
 *  default), any paid provider (fal/modal) is forced to undefined → MockTransport
 *  ($0). This caps cowork LLM spend that the credits ledger does not cover. */
export function effectiveCoworkProvider(args: {
  dbProvider?: string;
  envProvider?: string;
  paidAllowed?: boolean;
}): string | undefined {
  const resolved = args.dbProvider ?? args.envProvider;
  if (!args.paidAllowed) return undefined; // locked → mock
  return resolved;
}
```

- [ ] **Step 4: Run** `pnpm --filter @artlio/core test runtime-config` → PASS.

- [ ] **Step 5: Wire it into `getTransport`** (`apps/web/lib/runtime-config.ts`)

```ts
import {
  coworkVisionConfig, mergeVisionConfig, createTransportFromConfig,
  effectiveCoworkProvider, MockTransport, type CoworkTransport,
} from "@artlio/core";
// ...
export async function getTransport(): Promise<CoworkTransport> {
  const db = await readConfig(CONFIG_KEYS.coworkProvider);
  const provider = effectiveCoworkProvider({
    dbProvider: typeof db?.provider === "string" ? db.provider : undefined,
    envProvider: process.env.COWORK_PROVIDER,
    // beta: paid planner disallowed unless explicitly opted in (default-locked)
    paidAllowed: process.env.COWORK_PAID_PROVIDERS_ALLOWED === "true",
  });
  try {
    return createTransportFromConfig({
      provider,
      falKey: process.env.FAL_KEY,
      modalEndpoint: process.env.MODAL_LLM_ENDPOINT,
      modalKey: process.env.MODAL_LLM_KEY,
    });
  } catch (e) {
    console.warn(`getTransport: provider=${provider} unbuildable; falling back to mock:`, e instanceof Error ? e.message : e);
    return new MockTransport();
  }
}
```

- [ ] **Step 6: Verify** `pnpm --filter web typecheck` + `pnpm --filter @artlio/core test` → green.
- [ ] **Step 7: (leave for user) commit**

```bash
# leave for user
git add packages/core/src/runtime-config.ts packages/core/src/runtime-config.test.ts apps/web/lib/runtime-config.ts
git commit -m "feat(money-safety): default-lock cowork to \$0 planner for beta (effective provider)"
```

---

### Task 5: Raw-Prisma-client import ban (ESLint skeleton)

Stand up the enforcement skeleton so the P3 tenant-scoped repository can be the only place that touches owner-scoped models. For P0 this is a no-restricted-imports rule + a grep tripwire that currently PASS (nothing violates them yet — they're the guard rails the later phases lean on).

**Files:**
- Modify/Create: `apps/web/eslint.config.mjs` (flat config — verify the actual filename first; `apps/web/package.json` `lint` script is `eslint`)
- Create: `scripts/check-no-raw-prisma.sh`
- Modify: `package.json` (root) — add a `lint:tenancy` script

- [ ] **Step 1: Find the existing ESLint config.** Run `ls -a apps/web/eslint.config.* apps/web/.eslintrc* eslint.config.* 2>/dev/null` and read it. If none exists in `apps/web`, the `eslint` command uses a root/shared config — locate it before editing. Do not invent a second config.

- [ ] **Step 2: Add a `no-restricted-imports` rule** scoped to `apps/web/**` that bans importing the raw client `prisma` from `@artlio/db`, with an allow-comment for the future repo. (Exact syntax depends on the flat-config shape you found; the rule:)

```js
// in the apps/web override block of the flat config:
rules: {
  "no-restricted-imports": ["warn", {
    paths: [{
      name: "@artlio/db",
      importNames: ["prisma"],
      message: "Owner-scoped models must go through the tenant-scoped data layer (packages/db scoped client, P3). Direct `prisma` use in apps/web is being phased out — see the closed-beta foundation spec.",
    }],
  }],
},
```
Note: severity is **warn** in P0 (the codebase still imports `prisma` directly everywhere); it becomes `error` after the P3 repository extraction. The point is the rail exists and new code sees the warning.

- [ ] **Step 3: Create the grep tripwire** `scripts/check-no-raw-prisma.sh`

```bash
#!/usr/bin/env bash
# Tripwire (P0 skeleton): flag NEW direct prisma.<ownerScopedModel> reads/writes in apps/web.
# In P0 this is informational (the codebase predates the repo); P3 makes it fail CI.
set -uo pipefail
MODELS='project|entity|entityVariant|referenceImage|asset|shot|shotEntityRef|generation|genJob|refGenJob|renderJob|captionJob|transcript|chatThread|chatMessage'
hits=$(grep -rnE "prisma\.($MODELS)\." apps/web/ --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
echo "raw prisma owner-scoped call-sites in apps/web: $hits (P0 baseline; P3 routes these through the scoped repo)"
exit 0  # P0: never fail — baseline only
```

- [ ] **Step 4: Add the root script.** In `package.json` add to `scripts`: `"lint:tenancy": "bash scripts/check-no-raw-prisma.sh"`. Run `chmod +x scripts/check-no-raw-prisma.sh`.

- [ ] **Step 5: Verify** `pnpm --filter web lint` runs (warnings OK, no new errors) and `pnpm lint:tenancy` prints the baseline count.
- [ ] **Step 6: (leave for user) commit**

```bash
# leave for user
git add apps/web/eslint.config.* package.json scripts/check-no-raw-prisma.sh
git commit -m "chore(tenancy): raw-prisma import ban skeleton (warn) + grep baseline"
```

---

### Task 6: Error monitoring (Sentry, minimal, no-op without DSN)

No monitoring exists today. Add `@sentry/node` to web + worker; init only when `SENTRY_DSN` is set (so local/dev is unaffected). Capture unhandled errors + give the worker job-failure paths a capture hook.

**Files:**
- Modify: `apps/web/package.json`, `apps/worker/package.json` (add `@sentry/node`)
- Create: `apps/web/instrumentation.ts` (Next 16 server bootstrap — **read `node_modules/next/dist/docs/` for the Next 16 instrumentation contract first**)
- Modify: `apps/worker/src/index.ts` (init at boot; capture in the job-error path)

- [ ] **Step 1: Add the dependency.** `pnpm --filter web add @sentry/node` and `pnpm --filter worker add @sentry/node`. (Use `@sentry/node`, not `@sentry/nextjs`, to avoid Next-16 SDK-compat risk.)

- [ ] **Step 2: Web bootstrap.** Confirm the Next 16 instrumentation hook name/contract in the docs, then create `apps/web/instrumentation.ts`:

```ts
// Next 16 server instrumentation. No-op unless SENTRY_DSN is set.
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, environment: process.env.NODE_ENV });
}
```
(If Next 16 requires enabling the instrumentation hook in `next.config`, do so per the docs.)

- [ ] **Step 3: Worker bootstrap + capture.** At the top of `apps/worker/src/index.ts`:

```ts
import * as Sentry from "@sentry/node";
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, environment: process.env.NODE_ENV });
}
```
In the worker's job-failure handling (where a job is marked FAILED / an error is logged), add `if (process.env.SENTRY_DSN) Sentry.captureException(err);` alongside the existing `console.error`. Find the catch sites with codegraph; do not restructure the error flow — just add the capture next to the existing log.

- [ ] **Step 4: Verify** `pnpm --filter web typecheck` + `pnpm --filter worker typecheck` → green; with no `SENTRY_DSN`, boot is unchanged (init is skipped).
- [ ] **Step 5: (leave for user) commit**

```bash
# leave for user
git add apps/web/package.json apps/worker/package.json apps/web/instrumentation.ts apps/worker/src/index.ts pnpm-lock.yaml
git commit -m "feat(ops): minimal @sentry/node error capture for web + worker (no-op without DSN)"
```

---

### Task 7: Pin auth deps + AUTH_ENABLED wall + env checklist

`next-auth` is already exact-pinned (`5.0.0-beta.31`); `@auth/prisma-adapter` has a caret. Pin it, and document the pre-beta env flips (the AUTH_ENABLED wall + RESEND key are env/deploy actions the user performs — no code change).

**Files:**
- Modify: `apps/web/package.json`
- Create: `docs/closed-beta-env-checklist.md`

- [ ] **Step 1: Pin the adapter.** In `apps/web/package.json` change `"@auth/prisma-adapter": "^2.11.2"` → `"@auth/prisma-adapter": "2.11.2"`. Run `pnpm install` to refresh the lockfile. Confirm `next-auth` stays `5.0.0-beta.31` (already exact).

- [ ] **Step 2: Write the env checklist** `docs/closed-beta-env-checklist.md`:

```markdown
# Closed-Beta Env Checklist (pre-invite)

Set in Railway BEFORE inviting any external user / before the first paid endpoint:

- `AUTH_ENABLED=true`        — turns the perimeter wall ON (apps/web/proxy.ts). Off today.
- `RESEND_API_KEY=...`       — required so magic-link email actually sends (prod throws without it).
- `AUTH_ALLOWED_EMAILS=...`  — comma-separated invite allowlist (deny-by-default).
- `FOUNDER_ADMIN_EMAILS=...` — your founder email(s); seeded to super-admin on sign-in.
- `AUTH_EMAIL_FROM="Artlio <you@yourdomain>"` — verified Resend sender.
- `SENTRY_DSN=...`           — error monitoring (optional but recommended for beta).
- COWORK planner stays $0: do NOT set `COWORK_PAID_PROVIDERS_ALLOWED=true`; ensure the
  DB `runtimeConfig.cowork_provider` row is unset or `mock`. (Money-safety: paid planner
  is locked by default — Task 4.)
- `GENERATION_PROVIDER=fal` + `FAL_KEY=...` for real generation; `STORAGE_DRIVER=r2` + R2 creds.

Smoke after flipping AUTH_ENABLED on (staging or a fresh prod session):
1. Visit `/studio` while logged out → must 302 to `/login`.
2. Visit `/files/u/founder/<known-hash>.png` while logged out → must redirect to /login (wall) ;
   while logged in as a non-owner-key path → 404 (Task 2 guard).
3. Request a magic link with an allowlisted email → email arrives; non-allowlisted → denied.
```

- [ ] **Step 3: Verify** `pnpm --filter web typecheck` (deps unchanged at type level) → green; the checklist renders.
- [ ] **Step 4: (leave for user) commit**

```bash
# leave for user
git add apps/web/package.json pnpm-lock.yaml docs/closed-beta-env-checklist.md
git commit -m "chore(auth): pin @auth/prisma-adapter + closed-beta env checklist"
```

---

## Self-Review

**Spec coverage (§7 Phase 0):** AUTH_ENABLED flip + RESEND + smoke → Task 7 (env checklist + smoke steps; the flip is a deploy action, correctly not code). Effective cowork $0 gate incl. DB override → Task 4. next-auth pin → Task 7. Shared rate-limit → **explicitly deferred** (documented at top; needs storage, not no-schema). Sentry → Task 6. Full latent-IDOR list → Task 3 (+ `ownedAssetFromSrc` key-owner in Task 2). `/files` owner check → Task 2. FOUNDER_OWNER_ID guard → Task 1. ESLint + grep ban → Task 5. ✅ All covered (rate-limit deferred with rationale).

**Placeholder scan:** none — every code step shows real code grounded in files read this session.

**Type consistency:** `keyOwnerMatches(key, ownerId)` (Task 2) and `effectiveCoworkProvider({dbProvider, envProvider, paidAllowed})` (Task 4) are used with the same signatures at their call-sites. `FOUNDER_OWNER_ID` is imported from `@/lib/storage` in web files (matching existing imports in `data.ts`/`actions.ts`) and from `./storage-key.js` in core.

**Verify gate before P1:** `pnpm -r typecheck` clean + `pnpm --filter @artlio/core test` green (Tasks 1,2,4 tests) + `pnpm --filter web lint` no new errors. No migration ran. Then STOP for the user before P1.
