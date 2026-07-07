# OPT-6 P1a — Foundation (in-handler auth + runtime-config + admin shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the OPT-6 foundation — in-handler auth on every server action + data-bearing route, a DB-backed runtime-config layer (vision caps + planner provider, no redeploy), and a `/admin` shell — without changing any user-visible generation behavior or weakening the typed media-spend gate.

**Architecture:** Generalize the existing `requireAdmin` (auth()+allowlist) into a shared `requireSession()` called at the top of all 8 `"use server"` lib files + the `/files` route + data-bearing page loaders. Keep `packages/core` PURE (no prisma): the env-only `coworkVisionConfig()` + a new pure `createTransportFromConfig()` stay in core; a new `apps/web/lib/runtime-config.ts` does the DB read-through (`resolveVisionConfig()`, `getTransport()`) so the DB layer lives only in web. A new additive `RuntimeConfig` table backs both.

**Tech Stack:** Next.js 16 (customized — read `node_modules/next/dist/docs/` before route/page code), Prisma 7 + Neon (additive migration, LOCAL dev DB only), next-auth v5, `packages/core` vitest, `scripts/*.mjs` Node checks.

**Scope:** P1a ONLY (the spec's first phase). NO 5-role RBAC (that's P1b — P1a keeps the existing allowlist-as-admin gate). NO `modal` provider option in the settings UI (P1b, super-admin-gated). NO model registry / composer / ledger (P2/P3a). Spec: `docs/superpowers/specs/2026-06-17-opt6-admin-dashboard-design.md`.

**House rules (every task):** money-safety #1 — P1a only touches the $0 planner transport + vision config (advisory, non-media); the typed media-spend gate (`genRequest.superRefine` + worker) is NOT edited. Additive migration applied to the LOCAL dev DB only (`DATABASE_URL=postgresql://fikirtive:fikirtive@localhost:5432/fikirtive`, never prod; prod via `migrate:deploy` later with explicit authz). TDD with `packages/core` vitest for pure logic. Gen/LLM-touching checks run `GENERATION_PROVIDER=mock` + `COWORK_PROVIDER` unset; kill stale fal workers first (`pkill -f 'apps/worker' || true`). Surgical, match existing style. NO auto-commit/push — leave each task's commit staged for the user to approve (the `git commit` steps below are written for the user to run/approve, not auto-run). Use codegraph to confirm any symbol before editing. After all tasks: STOP for the `/codex` money-safety gate before any deploy.

---

## File Structure

**Create:**
- `packages/core/src/runtime-config.ts` — pure helpers: `clampVisionInts()` (extracted from cowork.ts), `VISION_CONFIG_KEY`/key constants, `createTransportFromConfig(cfg)` (the env-free transport switch). No prisma.
- `apps/web/lib/runtime-config.ts` — `resolveConfig(key)`, `resolveVisionConfig()`, `getTransport()` (DB read-through + env fallback + fail-closed). Has prisma.
- `apps/web/lib/auth-guard.ts` — `requireSession()` (auth()+allowed()) shared by all actions.
- `apps/web/app/admin/layout.tsx` — the `/admin` left-nav shell.
- `apps/web/app/admin/settings/page.tsx` + `apps/web/components/admin/SettingsAdmin.tsx` — the runtime-config settings UI.
- `packages/db/prisma/migrations/2026061710XXXX_runtime_config/migration.sql` — additive `RuntimeConfig` table.
- `scripts/verify-auth-guards.mjs` — source-scan guard (no DB) asserting every exported action is guarded.
- `scripts/local-runtime-config-verify.mjs` — local DB check: a vision-caps row flips the resolved config; garbage clamps; empty table = env default.

**Modify:**
- `packages/db/prisma/schema.prisma` — add `RuntimeConfig` model.
- `packages/core/src/cowork.ts` — `coworkVisionConfig()` reuses the extracted `clampVisionInts`; re-export from index unchanged.
- `packages/core/src/index.ts` — export the new core runtime-config symbols.
- `packages/core/src/cowork-transport.ts` — `createTransport()` delegates to `createTransportFromConfig(envCfg())` (behavior identical; one source of truth).
- `apps/web/lib/admin-actions.ts` — add `saveRuntimeConfig` action (requireAdmin + zod + `config.edit` audit, transactional).
- `apps/web/lib/cowork-actions.ts` — replace module-const `transport` (line 28) with `await getTransport()` in all 3 consumers; replace `coworkVisionConfig()` calls (lines ~35, ~275) with `await resolveVisionConfig()`.
- The 8 `"use server"` lib files — add `requireSession()` at the top of every exported action (admin-actions keeps `requireAdmin`).
- `apps/web/app/files/[...key]/route.ts` — auth()+allowed() at top of GET → 302/login on fail.
- Data-bearing page loaders: `apps/web/app/studio/page.tsx`, `apps/web/app/editor/page.tsx`, `apps/web/app/library/page.tsx` — require auth+allowlist (redirect on fail).
- `packages/core/src/cowork-reply.test.ts` — no change needed (coworkVisionConfig stays sync/env — see Task 2 note).

---

## Task 1: `RuntimeConfig` table (additive migration, LOCAL only)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_runtime_config/migration.sql`

- [ ] **Step 1: Add the model to schema.prisma**

Append after the `ModelDirective` model (keep the file's `// 中文` comment style):

```prisma
/// 运行时配置（OPT-6 P1a）：把散在 env 的开关变成 DB 旋钮（vision caps / COWORK_PROVIDER）。
/// key 是代码侧固定枚举；valueJson 由 per-key zod 在读/写两侧校验。读取走 read-through，
/// DB 无值回退 env（见 apps/web/lib/runtime-config.ts）。免重新部署即生效（不缓存）。
model RuntimeConfig {
  key       String   @id
  valueJson Json
  updatedAt DateTime @updatedAt
  updatedBy String   @default("")
}
```

- [ ] **Step 2: Generate the migration against the LOCAL dev DB (never prod)**

Run:
```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" \
  pnpm --filter @fikirtive/db exec prisma migrate dev --name runtime_config --create-only
```
Expected: a new `migrations/<ts>_runtime_config/migration.sql` containing `CREATE TABLE "RuntimeConfig"`. Open it and confirm it is purely additive (CREATE TABLE only, no DROP/ALTER of existing tables).

- [ ] **Step 3: Apply + regenerate client (LOCAL)**

Run:
```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm --filter @fikirtive/db exec prisma migrate deploy
pnpm --filter @fikirtive/db build
```
Expected: "All migrations have been successfully applied." + the client builds with `RuntimeConfig` available.

- [ ] **Step 4: Commit (leave for user approval)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(opt6): add RuntimeConfig table (additive) for the runtime-config layer"
```

---

## Task 2: Core pure helpers — extract clamp, add `createTransportFromConfig` (TDD)

Rationale: `packages/core` has NO prisma dependency and must stay pure. So the CLAMP logic and the transport SWITCH live in core (testable, env-free); the DB read-through lives in web (Task 3). `coworkVisionConfig()` stays SYNC + env-only (its existing tests in `cowork-reply.test.ts` keep passing — no async churn).

**Files:**
- Create: `packages/core/src/runtime-config.ts`
- Create/Test: `packages/core/src/runtime-config.test.ts`
- Modify: `packages/core/src/cowork.ts`, `packages/core/src/cowork-transport.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** (`packages/core/src/runtime-config.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { clampVisionInts, createTransportFromConfig } from "./runtime-config.js";

describe("clampVisionInts", () => {
  it("clamps finite ints to [1,max], else default", () => {
    expect(clampVisionInts({ maxImages: 5, maxBytes: 1_000_000 })).toEqual({ maxImages: 5, maxBytes: 1_000_000 });
    expect(clampVisionInts({ maxImages: 99, maxBytes: 99_000_000 })).toEqual({ maxImages: 8, maxBytes: 16_000_000 }); // ceilings
    expect(clampVisionInts({ maxImages: 0, maxBytes: -1 })).toEqual({ maxImages: 3, maxBytes: 4_000_000 }); // defaults
    expect(clampVisionInts({ maxImages: Infinity, maxBytes: NaN })).toEqual({ maxImages: 3, maxBytes: 4_000_000 });
  });
});

describe("createTransportFromConfig", () => {
  it("defaults to mock for unset/unknown provider", () => {
    expect(createTransportFromConfig({ provider: undefined }).name).toBe("mock");
    expect(createTransportFromConfig({ provider: "weird" }).name).toBe("mock");
  });
  it("builds fal transport when provider=fal + key present", () => {
    expect(createTransportFromConfig({ provider: "fal", falKey: "k" }).name).toBe("fal:llm");
  });
  it("THROWS for a set provider with a missing credential (loud, never silent-mock)", () => {
    expect(() => createTransportFromConfig({ provider: "fal" })).toThrow(/FAL_KEY/);
    expect(() => createTransportFromConfig({ provider: "modal", modalEndpoint: "x" })).toThrow(/MODAL_LLM/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- runtime-config`
Expected: FAIL — `clampVisionInts`/`createTransportFromConfig` not exported.

- [ ] **Step 3: Implement `packages/core/src/runtime-config.ts`**

```ts
/**
 * Pure runtime-config helpers (OPT-6 P1a). No prisma — core stays pure. The DB
 * read-through lives in apps/web/lib/runtime-config.ts; this file owns ONLY the
 * clamp (the safety primitive) and the env-free transport switch (one source of
 * truth for createTransport's behavior). Keep the loud-throw on a set provider
 * with a missing credential — a stray key must never silently spend.
 */
import { MockTransport, FalTransport, ModalTransport } from "./cowork-transport.js";
import type { CoworkTransport } from "./cowork.js";

export const VISION_DEFAULTS = { maxImages: 3, maxBytes: 4_000_000 } as const;
export const VISION_CEILINGS = { maxImages: 8, maxBytes: 16_000_000 } as const;

/** finite positive int clamped to a hard ceiling, else the default — Infinity/0/
 *  garbage must never UN-bound the caps (esp. once dashboard-tunable). */
export function clampVisionInts(raw: { maxImages?: unknown; maxBytes?: unknown }): { maxImages: number; maxBytes: number } {
  const clamp = (v: unknown, def: number, max: number): number => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
  };
  return {
    maxImages: clamp(raw.maxImages, VISION_DEFAULTS.maxImages, VISION_CEILINGS.maxImages),
    maxBytes: clamp(raw.maxBytes, VISION_DEFAULTS.maxBytes, VISION_CEILINGS.maxBytes),
  };
}

export interface TransportConfig {
  provider?: string;
  falKey?: string;
  modalEndpoint?: string;
  modalKey?: string;
}

/** The env-FREE transport switch. Same contract as createTransport: explicit
 *  fal/modal opt-in (throws on a missing credential), else mock. */
export function createTransportFromConfig(cfg: TransportConfig): CoworkTransport {
  if (cfg.provider === "fal") {
    if (!cfg.falKey) throw new Error("COWORK_PROVIDER=fal but FAL_KEY is not set");
    return new FalTransport(cfg.falKey);
  }
  if (cfg.provider === "modal") {
    if (!cfg.modalEndpoint || !cfg.modalKey) throw new Error("COWORK_PROVIDER=modal but MODAL_LLM_ENDPOINT or MODAL_LLM_KEY is not set");
    return new ModalTransport(cfg.modalEndpoint, cfg.modalKey);
  }
  return new MockTransport();
}
```

- [ ] **Step 4: Re-point `createTransport()` at the new switch** (`packages/core/src/cowork-transport.ts`)

Replace the body of `createTransport()` (lines 85-98) with a delegation so there is ONE switch:

```ts
export function createTransport(): CoworkTransport {
  // env wrapper around the pure switch (one source of truth, see runtime-config.ts)
  return createTransportFromConfig({
    provider: process.env.COWORK_PROVIDER,
    falKey: process.env.FAL_KEY,
    modalEndpoint: process.env.MODAL_LLM_ENDPOINT,
    modalKey: process.env.MODAL_LLM_KEY,
  });
}
```
Add at the top of the file: `import { createTransportFromConfig } from "./runtime-config.js";`
(NOTE: runtime-config.ts imports the transport classes from cowork-transport.ts, and cowork-transport.ts imports the function from runtime-config.ts — this is a function-level cycle that resolves fine in ESM since the import is used at call time, not module-init. Confirm `pnpm --filter @fikirtive/core build` succeeds; if the bundler complains, move the three transport classes' construction into runtime-config via re-export instead.)

- [ ] **Step 5: Make `coworkVisionConfig()` reuse the clamp** (`packages/core/src/cowork.ts`, the function at ~118-134)

Replace its inline `clampInt` closure with the shared helper (keep it SYNC + env-only — its tests stay green):

```ts
import { clampVisionInts } from "./runtime-config.js";
// ...
export function coworkVisionConfig(): { enabled: boolean; policy: "C"; maxImages: number; maxBytes: number } {
  const enabled = process.env.COWORK_VISION_ENABLED !== "false" && process.env.COWORK_VISION_ENABLED !== "0";
  const { maxImages, maxBytes } = clampVisionInts({
    maxImages: process.env.COWORK_VISION_MAX_IMAGES,
    maxBytes: process.env.COWORK_VISION_MAX_BYTES,
  });
  return { enabled, policy: "C", maxImages, maxBytes };
}
```

- [ ] **Step 6: Export from core barrel** (`packages/core/src/index.ts`)

Add: `export * from "./runtime-config.js";`

- [ ] **Step 7: Run tests + build**

Run: `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/core build`
Expected: the new runtime-config tests PASS; all existing tests (incl. cowork-reply.test.ts vision assertions + cowork-transport.test.ts) still PASS (behavior is byte-identical).

- [ ] **Step 8: Commit (leave for user approval)**

```bash
git add packages/core/src/runtime-config.ts packages/core/src/runtime-config.test.ts packages/core/src/cowork.ts packages/core/src/cowork-transport.ts packages/core/src/index.ts
git commit -m "feat(opt6): extract pure clamp + env-free transport switch (core stays pure)"
```

---

## Task 3: Web DB read-through — `resolveConfig` / `resolveVisionConfig` / `getTransport`

**Files:**
- Create: `apps/web/lib/runtime-config.ts`

- [ ] **Step 1: Implement the web resolver** (`apps/web/lib/runtime-config.ts`)

```ts
import "server-only";
import { prisma } from "@fikirtive/db";
import {
  coworkVisionConfig, clampVisionInts, createTransportFromConfig,
  MockTransport, type CoworkTransport,
} from "@fikirtive/core";

/** Config keys = a fixed code-side enum (the only writable keys). */
export const CONFIG_KEYS = { vision: "vision", coworkProvider: "cowork_provider" } as const;

/** Raw read of one config row; null on absent OR any DB fault (fail-closed,
 *  never throws — callers fall back to env/code defaults). */
async function readConfig(key: string): Promise<Record<string, unknown> | null> {
  try {
    const row = await prisma.runtimeConfig.findUnique({ where: { key }, select: { valueJson: true } });
    return (row?.valueJson as Record<string, unknown>) ?? null;
  } catch (e) {
    console.warn(`resolveConfig(${key}) DB read failed; using env/default:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Vision config: env emergency off-switch ALWAYS wins; otherwise DB caps over
 *  env, both clamped. Empty table → exact env default (DEFAULT-ON preserved). */
export async function resolveVisionConfig(): Promise<{ enabled: boolean; policy: "C"; maxImages: number; maxBytes: number }> {
  const env = coworkVisionConfig(); // env-only baseline (also the fallback)
  const db = await readConfig(CONFIG_KEYS.vision);
  if (!db) return env;
  // HARD env kill-switch: the DB can never flip vision back on.
  const enabled = env.enabled && db.enabled !== false;
  const caps = clampVisionInts({ maxImages: db.maxImages ?? env.maxImages, maxBytes: db.maxBytes ?? env.maxBytes });
  return { enabled, policy: "C", ...caps };
}

/** Per-request transport: DB provider over env, built via the pure switch, with a
 *  fail-closed catch → Mock (covers a DB provider whose web credential is absent /
 *  later env drift). Resolve ONCE per action and reuse the instance. */
export async function getTransport(): Promise<CoworkTransport> {
  const db = await readConfig(CONFIG_KEYS.coworkProvider);
  const provider = (typeof db?.provider === "string" ? db.provider : undefined) ?? process.env.COWORK_PROVIDER;
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

- [ ] **Step 2: Verify it builds + typechecks**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: clean (confirms `runtimeConfig` is on the prisma client from Task 1, and the core exports resolve).

- [ ] **Step 3: Commit (leave for user approval)**

```bash
git add apps/web/lib/runtime-config.ts
git commit -m "feat(opt6): web runtime-config read-through (vision + provider, fail-closed)"
```

---

## Task 4: Wire cowork-actions to the runtime resolver (per-request transport + vision)

**Files:**
- Modify: `apps/web/lib/cowork-actions.ts`

- [ ] **Step 1: Remove the module-load transport singleton**

Delete line 28 `const transport = createTransport();` and drop `createTransport` from the `@fikirtive/core` import (line 13). Add `import { getTransport, resolveVisionConfig } from "./runtime-config";`.

- [ ] **Step 2: Resolve the transport once per action, in all 3 consumers**

At the TOP of each of `coworkDraftStoryboard` (after its arg validation), `enhancePrompt`, and `coworkTurn`, add:
```ts
const transport = await getTransport();
```
The existing `transport.chat(...)` (line 316) and `transport.name` reads (lines 116, 120, 160, 163, 417) now reference this per-request local — confirm each read is BELOW its function's `await getTransport()`.

- [ ] **Step 3: Use the DB-aware vision config**

Replace `coworkVisionConfig()` at line ~35 (inside `refImageDataUrl` — already async) and line ~275 (inside `coworkTurn` — already async) with `await resolveVisionConfig()`. (Both call sites are inside async functions, so adding `await` is mechanical.)

- [ ] **Step 4: Verify no other `coworkVisionConfig`/`createTransport` references remain in web**

Run: `grep -rn "coworkVisionConfig\|createTransport\b" apps/web/lib apps/web/app || echo OK`
Expected: no hits in web app code (core keeps them; web now uses the resolver).

- [ ] **Step 5: Typecheck + the existing cowork verify (mock, $0)**

Run:
```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/web typecheck
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" GENERATION_PROVIDER=mock node scripts/verify-cowork-turn.mjs
```
Expected: typecheck clean; the cowork-turn invariant verify still passes (propose-only, $0, no GenJob) — proves the transport refactor didn't change planner behavior.

- [ ] **Step 6: Commit (leave for user approval)**

```bash
git add apps/web/lib/cowork-actions.ts
git commit -m "feat(opt6): per-request getTransport + DB-aware vision config in cowork-actions"
```

---

## Task 5: `requireSession()` + roll it onto every server action

**Files:**
- Create: `apps/web/lib/auth-guard.ts`
- Modify: all 8 `"use server"` lib files (admin-actions keeps `requireAdmin`).

- [ ] **Step 1: Create the shared guard** (`apps/web/lib/auth-guard.ts`)

```ts
import "server-only";
import { auth, allowed } from "@/auth";

/** In-handler auth (R7): re-assert auth()+allowlist INSIDE every action, not just
 *  at the opt-in proxy wall. Returns the email or an {error} the caller returns
 *  verbatim. P1a = allowlist-as-admin; P1b swaps this for requireRole(section). */
export async function requireSession(): Promise<{ email: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !allowed(email)) return { error: "Not authorized." };
  return { email };
}
```

- [ ] **Step 2: Guard each exported action**

For every exported `async function` in these files, add as the FIRST statement (before any `prisma`/`storage`/`getBoss` call):
```ts
const gate = await requireSession();
if ("error" in gate) return gate;
```
and `import { requireSession } from "./auth-guard";` at the top. Exact targets (admin-actions.ts is already guarded by `requireAdmin` — leave it):

- `actions.ts`: createProject, deleteProject, createEntity, updateEntity, addEntityAlias, removeEntityAlias, softDeleteReferenceImage, addReferenceImages, softDeleteEntity, createShot, saveShotPrompt, updateShotTitle, updateShotStatus, softDeleteShot, uploadCandidates, uploadReference, attachGeneration, detachGeneration, deleteGeneration, saveProjectEdit, addSegmentToCut, startRender, getRenderJobs, softDeleteGeneration, getEditorMedia.
- `gen-actions.ts`: startGen, getGenJob, getRecentGenResults.
- `refgen-actions.ts`: startRefGen, setBaseAsset, createVariant, regenerateVariant, renameVariant, deleteVariant, getRefGenJobs.
- `studio-actions.ts`: addShot, deleteShot, moveShot, addScene, setShotPromptText, setShotFrame, setShotTransition.
- `cowork-actions.ts`: coworkDraftStoryboard, enhancePrompt, coworkTurn, coworkGenerate, coworkRenameThread, coworkDeleteThread, coworkVaryCard, setCoworkBrief.
- `cowork-fetch.ts`: getCoworkThreadClient.
- `upload-actions.ts`: authorizeUpload, signUploadPart, abortDirectUpload, finalizeCandidateUploads.

For actions whose return type is not already a `{error}`-union (e.g. `createProject` returns a project; `getRenderJobs` returns an array), widen the return to `| { error: string }` and have callers tolerate it — OR, where widening ripples too far into client components, `throw new Error("Not authorized.")` instead of returning. Decide per-function by its current signature; the guard MUST run before any DB access either way. (The guard test in Task 6 checks presence, not the return shape.)

NOTE: these run inside the proxy wall today (AUTH_ENABLED=true in prod, verified), so this is defense-in-depth + the prerequisite for P1b RBAC — it does not change behavior for an allowlisted user.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: clean (fix any return-type widening fallout surfaced here).

- [ ] **Step 4: Commit (leave for user approval)**

```bash
git add apps/web/lib/auth-guard.ts apps/web/lib/*.ts
git commit -m "feat(opt6): in-handler requireSession on every server action (defense-in-depth + RBAC prereq)"
```

---

## Task 6: Guard data-bearing routes/pages + the source-scan guard test

**Files:**
- Modify: `apps/web/app/files/[...key]/route.ts`, `apps/web/app/studio/page.tsx`, `apps/web/app/editor/page.tsx`, `apps/web/app/library/page.tsx`
- Create: `scripts/verify-auth-guards.mjs`

- [ ] **Step 1: Guard the `/files` GET (302 → /login, NOT {error})**

At the very top of `GET` (before `parseStorageKey`/`presignedGet`/`get`), add:
```ts
import { auth, allowed } from "@/auth";
// ...inside GET, first lines:
const session = await auth();
if (!allowed(session?.user?.email)) {
  return NextResponse.redirect(new URL("/login", req.url), { status: 302 });
}
```
This gates BOTH the presigned-redirect and the byte-serving branches. (Delete the now-false comment "the proxy wall has already run by this point".)

- [ ] **Step 2: Guard the data-bearing page loaders**

In each of `app/studio/page.tsx`, `app/editor/page.tsx`, `app/library/page.tsx`, at the top of the default async server component, add (mirroring whichever `redirect` import the file/Next 16 uses — check `node_modules/next/dist/docs/` if unsure):
```ts
import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
// ...first lines of the component:
const session = await auth();
if (!allowed(session?.user?.email)) redirect("/login");
```
(`/studio` already calls `auth()` for the avatar — reuse that session, just add the `allowed()` gate + redirect before reading project data.)

- [ ] **Step 3: Write the source-scan guard** (`scripts/verify-auth-guards.mjs`)

```js
// Source-scan guard (no DB): every exported server action in a file-level
// "use server" lib file must call requireSession/requireRole/requireAdmin before
// any prisma access. Dynamically enumerates files so a NEW use-server file can't
// silently bypass the wall. Run: node scripts/verify-auth-guards.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LIB = "apps/web/lib";
const GUARDS = /\b(requireSession|requireRole|requireAdmin)\s*\(/;
const files = readdirSync(LIB).filter((f) => f.endsWith(".ts"))
  .filter((f) => readFileSync(join(LIB, f), "utf8").startsWith('"use server"'));

let bad = [];
for (const f of files) {
  const src = readFileSync(join(LIB, f), "utf8");
  // crude but effective: split into exported async fn bodies by the export marker
  const parts = src.split(/export async function /).slice(1);
  for (const part of parts) {
    const name = part.match(/^([a-zA-Z0-9_]+)/)?.[1] ?? "?";
    const body = part.slice(0, part.search(/\nexport /) === -1 ? part.length : part.search(/\nexport /));
    const guardAt = body.search(GUARDS);
    const prismaAt = body.search(/\bprisma\./);
    if (prismaAt !== -1 && (guardAt === -1 || guardAt > prismaAt)) bad.push(`${f}:${name}`);
  }
}
if (bad.length) { console.error("✗ UNGUARDED actions (prisma before/without a guard):\n  " + bad.join("\n  ")); process.exit(1); }
console.log(`✓ all exported actions in ${files.length} use-server files are guarded`);
```

- [ ] **Step 4: Run the guard (must pass after Task 5)**

Run: `node scripts/verify-auth-guards.mjs`
Expected: `✓ all exported actions in 8 use-server files are guarded`. (If it lists any, fix that action in Task 5 and re-run.)

- [ ] **Step 5: Typecheck + commit (leave for user approval)**

Run: `pnpm --filter @fikirtive/web typecheck`
```bash
git add "apps/web/app/files/[...key]/route.ts" apps/web/app/studio/page.tsx apps/web/app/editor/page.tsx apps/web/app/library/page.tsx scripts/verify-auth-guards.mjs
git commit -m "feat(opt6): guard /files + data-bearing pages; add source-scan auth-guard check"
```

---

## Task 7: `saveRuntimeConfig` admin action (audited, transactional)

**Files:**
- Modify: `apps/web/lib/admin-actions.ts`
- Modify: `packages/core/src/cowork.ts` (add the zod input schema next to the other cowork schemas) + export it.

- [ ] **Step 1: Add the input schema in core** (`packages/core/src/cowork.ts`)

```ts
export const runtimeConfigInput = z.discriminatedUnion("key", [
  z.object({ key: z.literal("vision"), value: z.object({
    enabled: z.boolean().optional(),
    maxImages: z.number().int().min(1).max(8).optional(),
    maxBytes: z.number().int().min(1).max(16_000_000).optional(),
  }).strict() }),
  z.object({ key: z.literal("cowork_provider"), value: z.object({
    provider: z.enum(["mock", "fal"]), // NO "modal" in P1a — that's P1b (super-admin)
  }).strict() }),
]);
export type RuntimeConfigInput = z.infer<typeof runtimeConfigInput>;
```
Export it from `packages/core/src/index.ts` (already `export *`-ing cowork — confirm).

- [ ] **Step 2: Add the action** (`apps/web/lib/admin-actions.ts`)

```ts
import { runtimeConfigInput } from "@fikirtive/core";

/** Write one runtime-config key. requireAdmin (P1a) — P1b will scope provider to
 *  super-admin. Validates credential presence for a paid provider BEFORE persisting
 *  so getTransport never builds a throwing transport at request time. Audited. */
export async function saveRuntimeConfig(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = runtimeConfigInput.safeParse(raw);
  if (!parsed.success) return { error: "That setting is out of bounds." };
  const { key, value } = parsed.data;
  // write-time credential check: never persist a provider the web env can't build
  if (key === "cowork_provider" && value.provider === "fal" && !process.env.FAL_KEY) {
    return { error: "FAL_KEY is not set in this environment — can't switch to fal." };
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.runtimeConfig.upsert({
        where: { key }, create: { key, valueJson: value, updatedBy: gate.email }, update: { valueJson: value, updatedBy: gate.email },
      });
      await tx.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "config.edit", payload: { key, via: gate.email } } });
    });
  } catch {
    return { error: "Couldn't save the setting — please try again." };
  }
  revalidatePath("/admin/settings");
  return { ok: true };
}
```

- [ ] **Step 3: Typecheck + commit (leave for user approval)**

Run: `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/web typecheck`
```bash
git add packages/core/src/cowork.ts packages/core/src/index.ts apps/web/lib/admin-actions.ts
git commit -m "feat(opt6): saveRuntimeConfig admin action (validated, audited, transactional)"
```

---

## Task 8: `/admin` shell + Settings page

**Files:**
- Create: `apps/web/app/admin/layout.tsx`, `apps/web/app/admin/settings/page.tsx`, `apps/web/components/admin/SettingsAdmin.tsx`

- [ ] **Step 1: Admin shell layout** (`apps/web/app/admin/layout.tsx`)

A server component that gates (auth+allowlist → redirect) and renders a left-nav with one slot per OPT-6 section (Directives + Settings are live; the rest render as disabled "Coming soon" links). Match the existing app's CSS-variable styling (reuse classes from `globals.css`; do NOT invent a new design system). Children render in the content pane.

```tsx
import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV = [
  { href: "/admin/settings", label: "Settings", live: true },
  { href: "/admin/directives", label: "Prompt & knowledge", live: true },
  { href: "#", label: "Model & provider", live: false },
  { href: "#", label: "Cost & usage", live: false },
  { href: "#", label: "Content & audit", live: false },
  { href: "#", label: "Team & access", live: false },
  { href: "#", label: "System & queue", live: false },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login");
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        {NAV.map((n) => n.live
          ? <Link key={n.label} href={n.href} className="admin-nav-link">{n.label}</Link>
          : <span key={n.label} className="admin-nav-link is-disabled" title="Coming soon">{n.label}</span>)}
      </nav>
      <main className="admin-content">{children}</main>
    </div>
  );
}
```
Add minimal `.admin-shell/.admin-nav/.admin-nav-link/.admin-content/.is-disabled` rules to `apps/web/app/globals.css` using existing CSS variables (`--fg-1`, etc.). (The existing `/admin/directives/page.tsx` now renders inside this layout — verify it still looks right; remove any duplicated page-level auth redirect it has if the layout now covers it, but KEEP the in-handler `requireAdmin` on the actions.)

- [ ] **Step 2: Settings page + client form**

`apps/web/app/admin/settings/page.tsx` (server component) reads the current resolved config (`resolveVisionConfig()` + the provider row) and passes it to `SettingsAdmin.tsx` (client component) which renders: a vision enabled toggle + maxImages/maxBytes inputs, and a provider select (`mock` / `fal` only). On save, call `saveRuntimeConfig`. Show the env-vs-DB source + the "worker keys are restart-required" note. Mirror `DirectivesAdmin.tsx` structure/styling.

```tsx
// apps/web/app/admin/settings/page.tsx
import { resolveVisionConfig } from "@/lib/runtime-config";
import { prisma } from "@fikirtive/db";
import { SettingsAdmin } from "@/components/admin/SettingsAdmin";

export default async function SettingsPage() {
  const vision = await resolveVisionConfig();
  const providerRow = await prisma.runtimeConfig.findUnique({ where: { key: "cowork_provider" } });
  const provider = (providerRow?.valueJson as { provider?: string } | null)?.provider ?? (process.env.COWORK_PROVIDER ?? "mock");
  return <SettingsAdmin vision={vision} provider={provider} />;
}
```
`SettingsAdmin.tsx`: a `"use client"` form calling `saveRuntimeConfig({ key: "vision", value: {...} })` / `{ key: "cowork_provider", value: { provider } }`, with optimistic disable + the `{error}` surface (copy the pattern from `DirectivesAdmin.tsx`).

- [ ] **Step 3: Build + manual check (mock, local)**

Run:
```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build
```
Expected: build clean. (Manual: `pnpm --filter @fikirtive/web dev`, sign in, visit `/admin/settings`, flip vision maxImages, confirm it persists + the directives page still renders in the shell.)

- [ ] **Step 4: Commit (leave for user approval)**

```bash
git add apps/web/app/admin apps/web/components/admin/SettingsAdmin.tsx apps/web/app/globals.css
git commit -m "feat(opt6): /admin shell + runtime-config Settings page"
```

---

## Task 9: Local end-to-end runtime-config check

**Files:**
- Create: `scripts/local-runtime-config-verify.mjs`

- [ ] **Step 1: Write the check**

```js
// LOCAL: a RuntimeConfig row changes the resolved config; garbage clamps; empty
// table = env default. $0, no worker. Run: node scripts/local-runtime-config-verify.mjs
process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../packages/db/dist/src/index.js");
const { resolveVisionConfig } = await import("../apps/web/lib/runtime-config.ts"); // run via tsx, or import the built JS
const fail = (m) => { throw new Error(m); };
try {
  await prisma.runtimeConfig.deleteMany({ where: { key: "vision" } });
  const def = await resolveVisionConfig();
  if (def.maxImages !== 3) fail(`empty table should give env default 3, got ${def.maxImages}`);
  await prisma.runtimeConfig.upsert({ where: { key: "vision" }, create: { key: "vision", valueJson: { maxImages: 6 } }, update: { valueJson: { maxImages: 6 } } });
  if ((await resolveVisionConfig()).maxImages !== 6) fail("DB row should set maxImages=6");
  await prisma.runtimeConfig.update({ where: { key: "vision" }, data: { valueJson: { maxImages: 9999 } } });
  if ((await resolveVisionConfig()).maxImages !== 8) fail("garbage should clamp to ceiling 8");
  console.log("✓ runtime-config resolves: empty=env-default, DB overrides, garbage clamps");
} finally {
  await prisma.runtimeConfig.deleteMany({ where: { key: "vision" } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
```
NOTE: importing a `.ts` from a node script needs `tsx` (the repo already uses it for some scripts — confirm with `grep tsx package.json`); if not available, import the built `apps/web/.next`/dist path, or move `resolveVisionConfig`'s pure-merge core into `packages/core` and test it there instead. Pick whichever matches the repo's existing script-running convention.

- [ ] **Step 2: Run it**

Run: `node scripts/local-runtime-config-verify.mjs` (or `pnpm exec tsx scripts/local-runtime-config-verify.mjs`)
Expected: `✓ runtime-config resolves: ...`.

- [ ] **Step 3: Commit (leave for user approval)**

```bash
git add scripts/local-runtime-config-verify.mjs
git commit -m "test(opt6): local runtime-config resolve check"
```

---

## Task 10: Full local gate + STOP for Codex

- [ ] **Step 1: Run the whole local gate**

```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/core test
pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build
pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build
node scripts/verify-auth-guards.mjs
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" GENERATION_PROVIDER=mock node scripts/verify-cowork-turn.mjs
node scripts/local-runtime-config-verify.mjs
```
Expected: all green — core tests pass, builds clean, auth-guard passes, cowork-turn invariant holds ($0/no GenJob), runtime-config resolves.

- [ ] **Step 2: STOP — Codex money-safety gate**

Do NOT deploy. Hand the diff to `/codex` for the money-safety + auth review (focus: the transport refactor preserves default-mock/fail-closed; every action is guarded; the typed media-spend gate is untouched; the vision env kill-switch still hard-overrides DB). Only after Codex PASS + explicit user authorization: prod = `migrate:deploy` the RuntimeConfig migration (cloud.env, localhost guard, `migrate status` first) then `railway up --service web`. Worker is unchanged (no worker deploy).

---

## Self-Review (run before handing off)

**1. Spec coverage (P1a section of the spec):**
- Pillar A in-handler auth on all 8 use-server files → Task 5; data-bearing pages + /files → Task 6; dynamic guard test → Task 6. ✓
- Pillar B RuntimeConfig table → Task 1; resolveConfig/resolveVisionConfig fail-closed + clamp + env kill-switch + empty-table=default → Task 3; getTransport per-request across all 3 consumers + throw-catch→mock + write-time credential validation → Tasks 3,4,7; web/worker boundary (worker = restart required) → documented in Task 8 settings note; no-cache → Task 3 (uncached read); config.edit audit transactional → Task 7. ✓
- Admin shell + Settings (vision caps + provider mock/fal only, NO modal) → Task 8. ✓
- NO 5-role RBAC, NO model registry/composer/ledger → correctly absent (P1b/P2/P3a). ✓

**2. Placeholder scan:** no "TBD/handle edge cases/similar to Task N" — the auth rollout lists every target function by name; the cycle-risk + tsx-import caveats name a concrete fallback. ✓

**3. Type consistency:** `clampVisionInts`, `createTransportFromConfig`, `TransportConfig`, `resolveVisionConfig`, `getTransport`, `requireSession`, `saveRuntimeConfig`, `runtimeConfigInput`, `CONFIG_KEYS` used consistently across tasks. `coworkVisionConfig` stays sync/env-only in core (no async churn — the audit's worry is sidestepped by putting the DB read in web). ✓

**Open caveat for the implementer:** the core import cycle (cowork-transport ↔ runtime-config) and the `.ts`-from-node-script import are the two spots most likely to need the named fallback — verify the build at Task 2 Step 7 and the script runner at Task 9 Step 1 before proceeding.
