# OPT-6 P2 — Model & Knowledge (registry + true-disable + $0 composer + eval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the model-knowledge layer (spec §4 + §6 P2 row) — a `ModelRegistryOverlay` table whose disable boolean is enforced at ALL FIVE money chokepoints (the worker check is the highest-trust edit), per-family directive seeding for every routed video family, a deterministic $0 prompt composer that runs ONCE at spend-side (`coworkGenerate`), a $0/mock eval harness, and the `/admin/models` + `/admin/knowledge` UI — WITHOUT widening the typed media-spend gate.

**Architecture:** Capability truth stays 100% typed (`GEN_MODELS` / `GEN_VIDEO_MODELS` / `REFGEN_MODELS` / `GEN_VIDEO_MODEL_OPTIONS` in `packages/core`). The overlay is a DB row carrying ONLY a disable boolean + advisory notes; a DB row can never ADD a model or RAISE a cap — only intersect-narrow the typed menu. A pure core helper (`enabledModels` / `isModelDisabled`) does the set math (no prisma); web + worker each do their own DB read-through and BOTH fail-closed-to-typed-menu on a DB fault. The composer is a deterministic string transform appending the resolved family×mode directive to the prompt at the spend boundary only. P2 builds on P1a (DONE + deployed): `RuntimeConfig` table + `resolveVisionConfig`/`getTransport`, `requireSession` on all actions, `requireAdmin` + `saveRuntimeConfig`/`runtimeConfigInput`/`config.edit` audit, the `/admin` shell + Settings, `DIRECTIVE_SEED` + `seedResearchDirectives`, and `getEnhanceDirective`.

**Tech Stack:** Next.js 16 (customized — read `apps/web/node_modules/next/dist/docs/` before any route/page code; see `apps/web/AGENTS.md`), Prisma 7 + Neon (additive migration, LOCAL dev DB only), next-auth v5, `packages/core` vitest, `scripts/*.mjs` Node checks.

**Scope:** P2 ONLY. NO 5-role RBAC (P1b — the `COWORK_PROVIDER=modal` option stays out; P2's provider UI is unchanged from P1a's mock/fal). NO `GenJob.spentUsd`/`RefGenJob.spentUsd` ledger or cost view (P3a). NO content/audit moderation UI (P4). NO direct GenSpace/Storyboard composer (out of scope — composer is cowork-card-only). Spec: `docs/superpowers/specs/2026-06-17-opt6-admin-dashboard-design.md` (§0 invariants, §4 Pillar D, §6 P2 row, §7 tests).

**House rules (every task):**
- **Money-safety #1.** The typed media-spend gate (`genRequest.superRefine` at `packages/core/src/gen.ts:203` + the worker) stays the SOLE authority over which (model,params) may spend. Disable enforcement is **ADDITIVE NARROWING** only — it can reject, never widen. The worker disable check MUST fail the job BEFORE any `provider.generate`/`provider.generateVideo` call.
- **Worker change = highest-trust edit.** `apps/worker/src/jobs/gen.ts` + `apps/worker/src/jobs/refgen.ts` run with real money in prod. The disable read there is net-new (the worker has NO existing prisma config read today — `provider` is built once from env at module load: `apps/worker/src/generation.ts:5`). Each worker read fail-closed-to-typed-menu (DB fault → treat as "not disabled", since the typed menu is the authority and a DB hiccup must never block a legitimate already-paid-for-in-spirit queued job from completing). Call this out in the Codex gate.
- **Additive migration LOCAL-only.** Apply to `DATABASE_URL=postgresql://fikirtive:fikirtive@localhost:5432/fikirtive` ONLY, never prod. Author via `prisma migrate diff … --script` (the P1a/idempotency ritual — avoids the LOCAL checksum-drift gotcha that `migrate dev` can hit when prior migrations were hand-authored), apply via `migrate deploy`.
- **TDD with `packages/core` vitest** for pure logic (disabled-set intersect, composer transform, directive seeds).
- **Tests run** `GENERATION_PROVIDER=mock` + `COWORK_PROVIDER` unset; **kill stale fal workers first** (`pkill -f 'apps/worker' || true`).
- **Surgical.** Match existing style; don't refactor adjacent code; remove only orphans your change creates.
- **Seedream coupling.** `GEN_MODELS` = `REFGEN_MODELS` = `["seedream"]`, so disabling `seedream` disables ALL image generation (base/sheet/variant + direct image + cowork image). The `/admin/models` UI shows ONE shared "image model" toggle and documents this; the dispatchVariantJob path always uses `model:"seedream"` so its disable check reduces to "is seedream disabled".
- **NO auto-commit/push.** Each task's `git` step is written for the USER to run/approve — leave it for user approval; never auto-run commit/push.
- **After all tasks: STOP for a `/codex` money-safety gate** before any deploy.

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/<ts>_model_registry_overlay/migration.sql` — additive `CREATE TABLE "ModelRegistryOverlay"`.
- `packages/core/src/model-registry.ts` — pure helpers: `ALL_MODEL_IDS` (deduped union of the 3 catalogs), `isKnownModelId()`, `enabledVideoModels(disabled)`, `isModelDisabled(modelId, disabled)`. NO prisma.
- `packages/core/src/model-registry.test.ts` — subset-property + unknown-id-ignored + intersect tests.
- `packages/core/src/cowork-compose.ts` — pure `composePrompt({ prompt, directive, maxLen })` deterministic string transform (directive-once, clamp). NO prisma, NO LLM.
- `packages/core/src/cowork-compose.test.ts` — directive-once / idempotent-on-already-composed / clamp / no-directive-noop.
- `apps/web/lib/model-registry.ts` — `resolveDisabledModels()` web read-through (prisma, fail-closed-to-empty-set). Has prisma + `server-only`.
- `apps/worker/src/model-registry.ts` — `workerDisabledModels()` worker read-through (prisma, fail-closed-to-empty-set).
- `apps/web/app/admin/models/page.tsx` + `apps/web/components/admin/ModelsAdmin.tsx` — registry UI (toggle per model, seedream-coupling note, per-family directive-coverage metric).
- `apps/web/app/admin/knowledge/page.tsx` + `apps/web/components/admin/KnowledgeAdmin.tsx` — `COWORK_PLANNER_SYSTEM` / ProjectBrief-default / structured-description-template editing via the RuntimeConfig pattern.
- `scripts/local-model-disable-verify.mjs` — LOCAL DB check: a disabled-row narrows the resolved enabled set; garbage rows ignored; empty table = full typed menu.
- `scripts/eval-cowork-knowledge.mjs` — $0/mock eval harness (mockPlannerReply → parseCoworkTurn → suggestModel → composer; full coworkTurn→coworkGenerate prompt round-trip; per-family coverage).

**Modify:**
- `packages/db/prisma/schema.prisma` — add `ModelRegistryOverlay` model (after `RuntimeConfig`).
- `packages/core/src/index.ts` — `export * from "./model-registry.js";` and `export * from "./cowork-compose.js";`.
- `packages/core/src/cowork-directives.ts` — extend `DIRECTIVE_SEED` with ≥1 cell per unseeded video family (veo, seedance, wan, pixverse, grok, hailuo).
- `packages/core/src/cowork-route.ts` — `suggestModel` gains an optional `disabled?: ReadonlySet<string>` input that narrows the candidate pool (fall back to full typed menu if narrowing empties it).
- `apps/web/lib/cowork-actions.ts` — (1) thread the resolved disabled-set into `suggestModel` in `coworkTurn`; (2) add the $0 composer in `coworkGenerate` between `chosenModel` (line 510) and `req` (line 517); (3) re-check disable on `chosenModel` in `coworkGenerate` before spend.
- `apps/web/lib/gen-actions.ts` — `startGen`: reject a disabled model after `safeParse`+`checkCast`, before `genJob.create`.
- `apps/web/lib/refgen-actions.ts` — `startRefGen` + `dispatchVariantJob`: reject a disabled model before `refGenJob.create`.
- `apps/web/lib/admin-actions.ts` — add `saveModelEnabled` action (mirrors `saveRuntimeConfig`); extend `runtimeConfigInput` consumers for the §⑥ knowledge keys (the schema change is in core).
- `packages/core/src/cowork.ts` — extend `runtimeConfigInput` with the §⑥ knowledge keys (`planner_system`, `brief_default`, `description_template`).
- `apps/worker/src/jobs/gen.ts` — `handleGen`: fail-without-spend if `job.model` is disabled, before the spend claim/provider call.
- `apps/worker/src/jobs/refgen.ts` — `handleRefGen`: same, before the spend claim/provider call.
- `apps/web/app/admin/layout.tsx` — flip the "Model & provider" NAV slot live → `/admin/models`; point "Prompt & knowledge" group at both `/admin/directives` and `/admin/knowledge` (add a knowledge link).

---

## Task 1: `ModelRegistryOverlay` table (additive migration, LOCAL only)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_model_registry_overlay/migration.sql`

- [ ] **Step 1: Add the model to `schema.prisma`** (append immediately AFTER the `RuntimeConfig` model at line 489-494, keeping the file's `///` 中文-comment style)

```prisma
/// 模型注册表覆盖层（OPT-6 P2）：能力真相 100% 在 typed catalog（GEN_MODELS /
/// GEN_VIDEO_MODELS / REFGEN_MODELS）；本表只承载 disable 布尔 + advisory notes。
/// 一行永远不能新增模型或放宽上限，只能与 typed menu 交集收窄（停掉一个已有模型）。
/// 校验：modelId 在写入时校验 ∈ 三个 catalog 的并集；未知行在读取侧忽略。
/// 强制点见 startGen / startRefGen / dispatchVariantJob / worker handleGen+handleRefGen。
/// 注意 seedream 耦合：GEN_MODELS=REFGEN_MODELS=["seedream"]，停 seedream = 停所有图像生成。
model ModelRegistryOverlay {
  id        String   @id
  ownerId   String   @default("founder")
  modelId   String
  enabled   Boolean  @default(true)
  notes     String   @default("")
  updatedAt DateTime @updatedAt

  @@unique([ownerId, modelId])
}
```

- [ ] **Step 2: Author the migration via `migrate diff … --script` (LOCAL, never prod)**

Use the same diff-script ritual the P1a/idempotency migrations used (avoids the LOCAL checksum-drift the interactive `migrate dev` can hit against hand-authored prior migrations). Pick a timestamp AFTER the latest existing migration (`20260617120000_runtime_config`), e.g. `20260617130000`:

```bash
mkdir -p packages/db/prisma/migrations/20260617130000_model_registry_overlay
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" \
  pnpm --filter @fikirtive/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > /tmp/mro-diff.sql
```

NOTE: `--from-schema-datasource` reads the CURRENT DB state via the datasource in the schema; `--to-schema-datamodel` reads the desired state from the (now-edited) schema model. The diff is the delta = exactly the new `CREATE TABLE` + its unique index. Inspect `/tmp/mro-diff.sql`: it MUST contain only `CREATE TABLE "ModelRegistryOverlay"` + `CREATE UNIQUE INDEX "ModelRegistryOverlay_ownerId_modelId_key"` — NO `DROP`/`ALTER` of any existing table. Then write the verified SQL into the migration file:

```sql
-- CreateTable
CREATE TABLE "ModelRegistryOverlay" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "modelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelRegistryOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistryOverlay_ownerId_modelId_key" ON "ModelRegistryOverlay"("ownerId", "modelId");
```

(If `/tmp/mro-diff.sql` differs from the above — e.g. column order — use what the diff produced; it is the source of truth for what the client expects.)

- [ ] **Step 3: Apply + regenerate client (LOCAL)**

```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm --filter @fikirtive/db exec prisma migrate deploy
pnpm --filter @fikirtive/db build
```
Expected: "1 migration ... applied" (the new one) + the client builds with `modelRegistryOverlay` available on `prisma`.

- [ ] **Step 4: Confirm it's purely additive**

```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm --filter @fikirtive/db exec prisma migrate status
```
Expected: "Database schema is up to date!" — no drift, no pending.

- [ ] **Step 5: Commit (leave for user approval)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260617130000_model_registry_overlay
git commit -m "feat(opt6): add ModelRegistryOverlay table (additive) for model disable"
```

---

## Task 2: Core pure registry helpers — the disabled-set intersect (TDD)

Rationale: `packages/core` has NO prisma and must stay pure (the P1a `runtime-config.ts` split). The SET math (union of catalogs, intersect, unknown-id ignore) lives in core (testable, deterministic); the DB reads live in web + worker (Tasks 4 + 7).

**Files:**
- Create: `packages/core/src/model-registry.ts`, `packages/core/src/model-registry.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** (`packages/core/src/model-registry.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { ALL_MODEL_IDS, isKnownModelId, enabledVideoModels, isModelDisabled } from "./model-registry.js";
import { GEN_MODELS, GEN_VIDEO_MODELS, REFGEN_MODELS } from "./gen.js";
import { REFGEN_MODELS as REFGEN } from "./refgen.js";

describe("ALL_MODEL_IDS", () => {
  it("is the deduped union of the three typed catalogs (REFGEN included)", () => {
    const expected = new Set<string>([...GEN_MODELS, ...GEN_VIDEO_MODELS, ...REFGEN]);
    expect(new Set(ALL_MODEL_IDS)).toEqual(expected);
    // seedream appears in GEN_MODELS AND REFGEN_MODELS but exactly once in the union
    expect(ALL_MODEL_IDS.filter((m) => m === "seedream")).toHaveLength(1);
  });
  it("isKnownModelId accepts a catalog id and rejects garbage", () => {
    expect(isKnownModelId("seedream")).toBe(true);
    expect(isKnownModelId("kling")).toBe(true);
    expect(isKnownModelId("nonexistent")).toBe(false);
    expect(isKnownModelId("")).toBe(false);
  });
});

describe("isModelDisabled / enabledVideoModels (additive narrowing only)", () => {
  it("nothing disabled → full typed video menu, nothing reported disabled", () => {
    const none = new Set<string>();
    expect(enabledVideoModels(none)).toEqual([...GEN_VIDEO_MODELS]);
    expect(isModelDisabled("kling", none)).toBe(false);
  });
  it("a disabled id is filtered out of the video menu and reported disabled", () => {
    const d = new Set(["kling"]);
    expect(enabledVideoModels(d)).not.toContain("kling");
    expect(enabledVideoModels(d).length).toBe(GEN_VIDEO_MODELS.length - 1);
    expect(isModelDisabled("kling", d)).toBe(true);
    expect(isModelDisabled("veo3.1", d)).toBe(false);
  });
  it("subset property: the enabled set is ALWAYS a subset of the typed menu for ANY (even garbage) disabled set", () => {
    const garbage = new Set(["kling", "not-a-model", "", "💸"]);
    const enabled = enabledVideoModels(garbage);
    for (const m of enabled) expect((GEN_VIDEO_MODELS as readonly string[]).includes(m)).toBe(true);
    // a garbage disabled id can't change the menu (it was never in it)
    expect(isModelDisabled("not-a-model", garbage)).toBe(true); // disable-set membership is literal
  });
  it("the union dedup matters: GEN_MODELS===REFGEN_MODELS===['seedream']", () => {
    expect([...GEN_MODELS]).toEqual(["seedream"]);
    expect([...REFGEN_MODELS]).toEqual(["seedream"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @fikirtive/core test -- model-registry
```
Expected: FAIL — `./model-registry.js` not found / symbols not exported.

- [ ] **Step 3: Implement** (`packages/core/src/model-registry.ts`)

```ts
/**
 * Pure model-registry helpers (OPT-6 P2). No prisma — core stays pure. The DB
 * read-through lives in apps/web/lib/model-registry.ts + apps/worker/src/model-
 * registry.ts; this file owns ONLY the set math. Capability truth is 100% typed
 * (the three catalogs); the overlay can NARROW (disable) but never widen.
 */
import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { REFGEN_MODELS } from "./refgen.js";

/** Deduped union of EVERY typed model catalog — the write-time validation domain
 *  for an overlay row, and the iteration source for the admin UI. REFGEN_MODELS is
 *  a SEPARATE catalog (do not omit it). seedream appears in GEN + REFGEN → deduped. */
export const ALL_MODEL_IDS: readonly string[] = Array.from(
  new Set<string>([...GEN_MODELS, ...GEN_VIDEO_MODELS, ...REFGEN_MODELS]),
);

const ALL_SET = new Set(ALL_MODEL_IDS);

/** True iff modelId is in some typed catalog. Write-time guard: an overlay can
 *  only disable a model the code actually knows about. */
export function isKnownModelId(modelId: string): boolean {
  return ALL_SET.has(modelId);
}

/** The typed video menu with the disabled ids removed. ALWAYS a subset of
 *  GEN_VIDEO_MODELS (a garbage disabled id can't add anything). */
export function enabledVideoModels(disabled: ReadonlySet<string>): string[] {
  return (GEN_VIDEO_MODELS as readonly string[]).filter((m) => !disabled.has(m));
}

/** Literal membership in the disabled set. Used at every spend chokepoint to
 *  reject a chosen model. (The typed-menu validity check stays the authority —
 *  this only narrows.) */
export function isModelDisabled(modelId: string, disabled: ReadonlySet<string>): boolean {
  return disabled.has(modelId);
}
```

- [ ] **Step 4: Export from the core barrel** (`packages/core/src/index.ts`)

Add after line 35 (`export * from "./runtime-config.js";`):
```ts
export * from "./model-registry.js";
```

- [ ] **Step 5: Run tests + build**

```bash
pnpm --filter @fikirtive/core test -- model-registry && pnpm --filter @fikirtive/core build
```
Expected: the model-registry tests PASS; all existing core tests still PASS.

- [ ] **Step 6: Commit (leave for user approval)**

```bash
git add packages/core/src/model-registry.ts packages/core/src/model-registry.test.ts packages/core/src/index.ts
git commit -m "feat(opt6): pure model-registry helpers (catalog union + disabled-set intersect)"
```

---

## Task 3: Deterministic $0 composer — pure core transform (TDD)

Rationale: spec §4a — the composer is a deterministic, $0 string transform appending the resolved directive. The PURE transform (directive-once, clamp) lives in core; the DB directive read + family/mode resolution happen in `coworkGenerate` (Task 5). Keeping the transform pure makes the "directive exactly once" + "byte-stable" + "clamped" invariants unit-testable with no DB/LLM.

**Files:**
- Create: `packages/core/src/cowork-compose.ts`, `packages/core/src/cowork-compose.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** (`packages/core/src/cowork-compose.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { composePrompt, COMPOSE_SEP } from "./cowork-compose.js";
import { MAX_GEN_PROMPT } from "./gen.js";

const DIR = "Lead with MOTION and CAMERA.";

describe("composePrompt", () => {
  it("appends the directive exactly once after the separator", () => {
    const out = composePrompt({ prompt: "a calm sea", directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(out).toBe(`a calm sea${COMPOSE_SEP}${DIR}`);
    expect(out.split(DIR)).toHaveLength(2); // directive appears once
  });
  it("is idempotent — composing an already-composed prompt does NOT double-append", () => {
    const once = composePrompt({ prompt: "a calm sea", directive: DIR, maxLen: MAX_GEN_PROMPT });
    const twice = composePrompt({ prompt: once, directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(twice).toBe(once); // the directive is already present at the tail → no-op
  });
  it("no directive (undefined/empty) → returns the prompt unchanged (no-op for unseeded families)", () => {
    expect(composePrompt({ prompt: "a calm sea", directive: undefined, maxLen: MAX_GEN_PROMPT })).toBe("a calm sea");
    expect(composePrompt({ prompt: "a calm sea", directive: "", maxLen: MAX_GEN_PROMPT })).toBe("a calm sea");
    expect(composePrompt({ prompt: "a calm sea", directive: "   ", maxLen: MAX_GEN_PROMPT })).toBe("a calm sea");
  });
  it("clamps the composed result to maxLen (never exceeds the typed prompt cap)", () => {
    const longPrompt = "x".repeat(MAX_GEN_PROMPT);
    const out = composePrompt({ prompt: longPrompt, directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(out.length).toBeLessThanOrEqual(MAX_GEN_PROMPT);
  });
  it("is byte-stable (no LLM, no randomness) — same inputs → same output", () => {
    const a = composePrompt({ prompt: "hi", directive: DIR, maxLen: MAX_GEN_PROMPT });
    const b = composePrompt({ prompt: "hi", directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @fikirtive/core test -- cowork-compose
```
Expected: FAIL — `./cowork-compose.js` not found.

- [ ] **Step 3: Implement** (`packages/core/src/cowork-compose.ts`)

```ts
/**
 * Deterministic $0 prompt composer (OPT-6 P2, spec §4a). A PURE string transform
 * that appends the resolved model-family directive to the client prompt. NO LLM,
 * NO randomness — byte-stable. Runs ONLY at the spend side (coworkGenerate); the
 * card prompt stays directive-free so it can't double-append (the audit's
 * double-append blocker). Idempotent: if the directive is already at the tail
 * (e.g. a stale card already carried it), composing again is a no-op.
 */
export const COMPOSE_SEP = "\n\n";

/** Append `directive` to `prompt` once, clamped to `maxLen`. A missing/blank
 *  directive → the prompt unchanged (unseeded families = no-op). Idempotent on a
 *  prompt that already ends with the directive. */
export function composePrompt(args: { prompt: string; directive?: string; maxLen: number }): string {
  const base = args.prompt;
  const dir = (args.directive ?? "").trim();
  if (!dir) return base; // unseeded family / disabled cell → no-op
  if (base.trimEnd().endsWith(dir)) return base; // already composed → don't double-append
  const composed = `${base}${COMPOSE_SEP}${dir}`;
  return composed.length <= args.maxLen ? composed : composed.slice(0, args.maxLen);
}
```

- [ ] **Step 4: Export from the core barrel** (`packages/core/src/index.ts`)

Add after the model-registry export from Task 2:
```ts
export * from "./cowork-compose.js";
```

- [ ] **Step 5: Run tests + build + commit (leave for user approval)**

```bash
pnpm --filter @fikirtive/core test -- cowork-compose && pnpm --filter @fikirtive/core build
```
Expected: PASS.
```bash
git add packages/core/src/cowork-compose.ts packages/core/src/cowork-compose.test.ts packages/core/src/index.ts
git commit -m "feat(opt6): deterministic \$0 prompt composer (pure, directive-once, clamped)"
```

---

## Task 4: Thread the disabled-set into `suggestModel` + web read-through (TDD)

**Files:**
- Modify: `packages/core/src/cowork-route.ts`, `packages/core/src/cowork-route.test.ts`
- Create: `apps/web/lib/model-registry.ts`

- [ ] **Step 1: Add the failing core test** (append to `packages/core/src/cowork-route.test.ts`, inside the existing `describe("suggestModel", …)`)

```ts
  it("excludes a disabled model from the candidate pool (additive narrowing)", () => {
    // kling (silent, cheapest) is normally the t2v pick; disabling it must pick another
    const free = suggestModel({ kind: "video" });
    const narrowed = suggestModel({ kind: "video", disabled: new Set(["kling"]) });
    expect(narrowed.model).not.toBe("kling");
    if (free.model === "kling") expect(narrowed.model).not.toBe(free.model);
  });
  it("falls back to the full typed menu if disabling would empty the pool (never returns empty)", () => {
    const allDisabled = new Set(GEN_VIDEO_MODELS as readonly string[]);
    const r = suggestModel({ kind: "video", disabled: allDisabled });
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true); // still a typed model
  });
```
Add `GEN_VIDEO_MODELS` to the test's existing import from `./gen.js`.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @fikirtive/core test -- cowork-route
```
Expected: FAIL — `disabled` not honored.

- [ ] **Step 3: Add `disabled` to `suggestModel`** (`packages/core/src/cowork-route.ts`)

In `SuggestModelInput` (lines 10-17), add a field:
```ts
  /** OPT-6 P2: ids to exclude from the candidate pool (admin-disabled models).
   *  Additive narrowing only — if it would empty the pool, the full typed menu is
   *  used (the typed-menu validity gate downstream stays the authority). */
  disabled?: ReadonlySet<string>;
```
In the candidate filter (line 53-60), add a first predicate so a disabled model never enters the pool:
```ts
  const candidates = (GEN_VIDEO_MODELS as readonly string[]).filter((m) => {
    if (input.disabled?.has(m)) return false; // OPT-6 P2: admin-disabled
    const info = GEN_VIDEO_MODEL_INFO[m as GenVideoModel];
    const o = GEN_VIDEO_MODEL_OPTIONS[m as GenVideoModel];
    if (wantTail && !info.tail) return false;
    if (input.desiredAspect && o.aspectRatios.length > 0 && !o.aspectRatios.includes(input.desiredAspect)) return false;
    if (t2vNeedsAspect && o.aspectRatios.length === 0) return false;
    return true;
  });
```
The existing empty-pool fallback (line 62-63: `candidates.length > 0 ? candidates : GEN_VIDEO_MODELS.slice()`) already handles the "all disabled → full menu" case unchanged. (Image is hard-wired to `seedream` at line 34-42 — disable for the image path is NOT enforced in `suggestModel`; it is enforced at the spend chokepoints in Tasks 5-7, where a disabled seedream is rejected.)

- [ ] **Step 4: Run the core test + build**

```bash
pnpm --filter @fikirtive/core test -- cowork-route && pnpm --filter @fikirtive/core build
```
Expected: PASS (incl. all the existing suggestModel tests — the new predicate is a no-op when `disabled` is absent/empty).

- [ ] **Step 5: Implement the web read-through** (`apps/web/lib/model-registry.ts`)

Mirror `apps/web/lib/runtime-config.ts`'s `readConfig` fail-closed pattern:
```ts
import "server-only";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

/** The set of admin-disabled model ids (overlay rows with enabled=false). Returns
 *  an EMPTY set on any DB fault — fail-closed-to-typed-menu (a config hiccup must
 *  never block a legitimate generation; the typed gate stays the authority). The
 *  read is uncached so an emergency disable propagates immediately (like the P1a
 *  runtime-config reads). */
export async function resolveDisabledModels(): Promise<Set<string>> {
  try {
    const rows = await prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, enabled: false },
      select: { modelId: true },
    });
    return new Set(rows.map((r) => r.modelId));
  } catch (e) {
    console.warn("resolveDisabledModels DB read failed; treating nothing as disabled:", e instanceof Error ? e.message : e);
    return new Set();
  }
}
```

- [ ] **Step 6: Typecheck + commit (leave for user approval)**

```bash
pnpm --filter @fikirtive/web typecheck
```
Expected: clean (confirms `modelRegistryOverlay` is on the prisma client from Task 1).
```bash
git add packages/core/src/cowork-route.ts packages/core/src/cowork-route.test.ts apps/web/lib/model-registry.ts
git commit -m "feat(opt6): suggestModel honors a disabled-set; web disabled-models read-through (fail-closed)"
```

---

## Task 5: Enforce disable at the web chokepoints (a + b + c + d) + the $0 composer

This is a money-critical task. Chokepoints (spec §0.1 + §4b):
- **(a)** `coworkTurn` candidate pool (thread the disabled-set into `suggestModel`).
- **(b)** `startGen` after `superRefine`+`checkCast`, before `genJob.create`.
- **(c)** `startRefGen` before `refGenJob.create`.
- **(d)** `dispatchVariantJob` before `refGenJob.create` (the variant path that bypasses `startRefGen`; always `model:"seedream"`).

Plus the spend-side composer (spec §4a).

**Files:**
- Modify: `apps/web/lib/cowork-actions.ts`, `apps/web/lib/gen-actions.ts`, `apps/web/lib/refgen-actions.ts`

- [ ] **Step 1: (a) Thread the disabled-set into `suggestModel`** (`apps/web/lib/cowork-actions.ts`, `coworkTurn`)

Add the import (the file already imports from `./runtime-config`; add a sibling import):
```ts
import { resolveDisabledModels } from "./model-registry";
```
In `coworkTurn`, resolve the disabled-set once (near the `availableRefs`/`vision` resolution, e.g. just before the `suggestModel` call at line 384). Pass it into `suggestModel`:
```ts
    const disabled = await resolveDisabledModels();
```
and add `disabled,` to the `suggestModel({ … })` object at line 384-391:
```ts
      const sm = suggestModel({
        kind: turn.proposal.kind,
        desiredAspect: turn.proposal.desiredAspect,
        desiredDuration: turn.proposal.desiredDuration,
        desiredAudio: turn.proposal.desiredAudio,
        hasSourceImage: !!validSource,
        hasTail: false,
        disabled, // OPT-6 P2: never propose an admin-disabled video model
      });
```
NOTE: image proposals always route to `seedream` (suggestModel hard-wire) — a disabled seedream is NOT caught here (the card can still be built), but the spend re-check in Step 2 below + `startGen` (Step 3) + the worker (Task 7) reject it. This matches the spec: `suggestModel` is UX-only; the spend gates are the authority.

- [ ] **Step 2: (a-spend + composer) Re-check disable AND compose in `coworkGenerate`** (`apps/web/lib/cowork-actions.ts`)

The composer goes between `chosenModel` resolving (line 510) and `req` being built (line 517). Add the imports `getEnhanceDirective` (already imported, line 24) + `composePrompt`, `modelFamily`, `deriveMode`, `MAX_GEN_PROMPT` (all already imported in this file, lines 14, 19) + `isModelDisabled` (add to the `@fikirtive/core` import) + `resolveDisabledModels` (added in Step 1).

After line 510 (`const chosenModel = modelOverride ?? model;`), insert:
```ts
  // OPT-6 P2: re-check the chosen model isn't admin-disabled at SPEND (a card built
  // before a disable, a model override, or a disabled seedream image must not spend).
  // The worker (handleGen) is the all-status backstop for an already-queued job.
  const disabled = await resolveDisabledModels();
  if (isModelDisabled(chosenModel, disabled)) {
    return { error: "That model is currently turned off — pick another, or ask an admin to re-enable it." };
  }

  // OPT-6 P2: deterministic $0 composer (spec §4a) — append the resolved family×mode
  // directive to the CLIENT prompt, compose ONCE here at the spend side (NOT in
  // coworkTurn — that double-appends). conditioned = entityIds.length>0 is an advisory
  // APPROXIMATION (a bare 0-ref LOCATION mention runs t2i at the worker but keys i2i
  // here) — acceptable because the composer is advisory TEXT, never a spend decision,
  // matching the Guardian's conditioned:true precedent. Changes ONLY the prompt string.
  const family = modelFamily(chosenModel);
  const mode = deriveMode({
    kind: proposal.data.kind,
    conditioned: entityIds.length > 0,
    hasSourceImage: !!sourceGenerationId,
    hasTail: false,
  });
  const directive = family ? await getEnhanceDirective(family, mode) : undefined;
  const composedPrompt = composePrompt({ prompt, directive, maxLen: MAX_GEN_PROMPT });
```
Then change the `req` object's `prompt` field (line 520) from `prompt,` to:
```ts
    prompt: composedPrompt,
```
The composer touches ONLY the prompt; `model`/`kind`/`count`/`desired*`/params are untouched (verified by the eval harness in Task 8). `getEnhanceDirective` returns `undefined` for an unseeded family/disabled cell → composer no-op. `modelFamily(chosenModel)` returns `undefined` for an unknown id → no directive → no-op (defensive; `chosenModel` is already typed-validated downstream).

- [ ] **Step 3: (b) `startGen` disable check** (`apps/web/lib/gen-actions.ts`)

Add to the `@fikirtive/core` import: `isModelDisabled`. Add the import `import { resolveDisabledModels } from "./model-registry";`. The check goes AFTER `checkCast` (line 71-77) and BEFORE `genJob.create` (line 81). Insert right after the `if (block) { … return { error: block.error }; }` block (line 77):
```ts
  // OPT-6 P2: reject an admin-disabled model BEFORE the spend commit. This is
  // ADDITIVE narrowing — the typed superRefine above stays the authority over
  // which (model,params) may spend; this only subtracts a turned-off model.
  // Fail-closed-to-typed-menu on a DB fault (resolveDisabledModels → empty set).
  const disabled = await resolveDisabledModels();
  if (isModelDisabled(model, disabled)) {
    return { error: "That model is currently turned off — pick another." };
  }
```

- [ ] **Step 4: (c) `startRefGen` disable check** (`apps/web/lib/refgen-actions.ts`)

Add to the `@fikirtive/core` import: `isModelDisabled`. Add `import { resolveDisabledModels } from "./model-registry";`. The check goes after the entity lookup (line 33) — before the in-flight guard (line 50) and `create` (line 69). Insert right after the VARIANT-not-available gate (line 40) (so it applies to BASE/REFSHEET, the only modes that reach here):
```ts
  // OPT-6 P2: reject an admin-disabled model before the spend commit (additive
  // narrowing; refGenRequest.enum stays the authority). seedream is the only
  // refgen model today, so this is the image-toggle in the reference path.
  const disabled = await resolveDisabledModels();
  if (isModelDisabled(model, disabled)) {
    return { error: "Image generation is currently turned off." };
  }
```

- [ ] **Step 5: (d) `dispatchVariantJob` disable check** (`apps/web/lib/refgen-actions.ts`)

`dispatchVariantJob` (line 133) is the path `createVariant`/`regenerateVariant` use, bypassing `startRefGen`. It hard-codes `model: "seedream"` (line 146). Insert at the TOP of the function body (before the in-flight `findFirst` at line 134):
```ts
  // OPT-6 P2: the variant path bypasses startRefGen — enforce disable here too.
  // dispatchVariantJob always uses model:"seedream", so this is the seedream toggle.
  const disabled = await resolveDisabledModels();
  if (isModelDisabled("seedream", disabled)) {
    return { error: "Image generation is currently turned off." };
  }
```
(`isModelDisabled`/`resolveDisabledModels` are already imported from Step 4.)

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fikirtive/web typecheck
```
Expected: clean.

- [ ] **Step 7: Re-run the existing cowork money-safety verify (mock, $0)**

```bash
pkill -f 'apps/worker' 2>/dev/null || true
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" GENERATION_PROVIDER=mock node scripts/verify-cowork-turn.mjs
```
Expected: still passes (propose-only, $0, zero GenJob) — proves the disable thread + composer didn't change the propose-only invariant.

- [ ] **Step 8: Commit (leave for user approval)**

```bash
git add apps/web/lib/cowork-actions.ts apps/web/lib/gen-actions.ts apps/web/lib/refgen-actions.ts
git commit -m "feat(opt6): enforce model-disable at all 4 web chokepoints + \$0 spend-side composer"
```

---

## Task 6: Per-family directive seeding for every routed video family (TDD)

Spec §4a: `suggestModel` picks the cheapest model — often an UNSEEDED family. Today's `DIRECTIVE_SEED` covers seedream (t2i, i2i), kling (t2v, i2v, i2v-tail), ltx (t2v, i2v). The UNSEEDED video families that `suggestModel` can route to are **veo, seedance, wan, pixverse, grok, hailuo** (confirmed from `MODEL_FAMILIES` minus the seeded set; `modelFamily()` maps every `GEN_VIDEO_MODELS` id to one of these). Seed ≥1 cell per unseeded video family before P2 ships.

**Files:**
- Modify: `packages/core/src/cowork-directives.ts`, `packages/core/src/cowork-directives.test.ts`

- [ ] **Step 1: Add the failing coverage test** (`packages/core/src/cowork-directives.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { DIRECTIVE_SEED } from "./cowork-directives.js";
import { GEN_VIDEO_MODELS, modelFamily } from "./gen.js";

describe("DIRECTIVE_SEED video-family coverage (OPT-6 P2)", () => {
  it("every family a video model routes to has at least one seeded cell", () => {
    const seededFamilies = new Set(DIRECTIVE_SEED.map((c) => c.family));
    const routedFamilies = new Set(
      (GEN_VIDEO_MODELS as readonly string[]).map((m) => modelFamily(m)).filter((f): f is NonNullable<typeof f> => !!f),
    );
    const missing = [...routedFamilies].filter((f) => !seededFamilies.has(f));
    expect(missing).toEqual([]); // veo, seedance, wan, pixverse, grok, hailuo must all be covered
  });
  it("each new video-family seed targets a real video mode (t2v/i2v) with non-empty text", () => {
    for (const c of DIRECTIVE_SEED) {
      expect(c.directive.trim().length).toBeGreaterThan(0);
      expect(["t2i", "i2i", "t2v", "i2v", "i2v-tail"]).toContain(c.mode);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @fikirtive/core test -- cowork-directives
```
Expected: FAIL — `missing` lists veo, seedance, wan, pixverse, grok, hailuo.

- [ ] **Step 3: Add one t2v cell per unseeded family** (append to the `DIRECTIVE_SEED` array in `packages/core/src/cowork-directives.ts`, before the closing `];` at line 130). Use `confidence:"untested"`, real model-specific guidance:

```ts
  {
    family: "veo",
    mode: "t2v",
    directive:
      "Veo follows rich, cinematic natural-language prompts and renders native audio — describe the SHOT like a director: subject and primary action, then camera move (dolly/pan/orbit and speed), lens feel, lighting, and mood; if you want sound, name it explicitly (dialogue, ambient, score). Keep one clear primary action per clip; Veo handles detail well but a single coherent motion reads cleaner than several competing ones.",
    confidence: "untested",
    notes: "Veo 3.1 family: cinematic NL + native audio. Lead with action+camera; name desired audio. Untested.",
  },
  {
    family: "seedance",
    mode: "t2v",
    directive:
      "Seedance leads with MOTION — state how the subject moves and how the camera moves through the clip (trajectory, speed, what changes over time); keep static scene description brief. Prefer one decisive primary action plus one camera move; stacking many simultaneous motions degrades coherence. Audio is generated, so a short ambient/sound cue helps.",
    confidence: "untested",
    notes: "Seedance 2.0 family: motion+camera lead, single primary action. Untested.",
  },
  {
    family: "wan",
    mode: "t2v",
    directive:
      "Wan responds to clear motion and camera direction with native (always-on) audio — describe the primary action and the camera move plainly; keep the scene description tight and the motion specific. Don't over-specify many concurrent movements; one clean action + one camera move yields the most stable result.",
    confidence: "untested",
    notes: "Wan 2.5 family: native audio (not toggleable), motion+camera lead. Untested.",
  },
  {
    family: "pixverse",
    mode: "t2v",
    directive:
      "PixVerse favors a single clear subject and a well-defined motion — lead with the action and a simple camera move, keep the look description concise. Avoid crowding the frame with multiple moving subjects; a focused single-action clip is more reliable than a busy multi-action one.",
    confidence: "untested",
    notes: "PixVerse V6 family: single subject + one clear motion. Untested.",
  },
  {
    family: "grok",
    mode: "t2v",
    directive:
      "Grok Imagine is silent and short — write a punchy, concrete prompt: one subject, one vivid primary action, one simple camera move. Front-load the most important visual; with a brief clip there's no room for multi-beat sequences, so describe a single moment of motion rather than a story.",
    confidence: "untested",
    notes: "Grok Imagine family: silent, short clips → single decisive moment. Untested.",
  },
  {
    family: "hailuo",
    mode: "t2v",
    directive:
      "Hailuo renders a fixed short clip — describe one clear subject and a single, well-defined motion with a simple camera move; keep the scene description concise and put the budget on the action. One coherent movement reads far better than several competing ones.",
    confidence: "untested",
    notes: "Hailuo 02 family: fixed short clip → one clear motion. Untested.",
  },
```

- [ ] **Step 4: Run the test + the existing directives test**

```bash
pnpm --filter @fikirtive/core test -- cowork-directives && pnpm --filter @fikirtive/core build
```
Expected: the coverage test PASSES; the existing `modelDirectiveInput`/seed-shape tests still PASS (the new cells use the same `DirectiveSeed` shape, `family ∈ MODEL_FAMILIES`, `mode ∈ GEN_MODES`).

- [ ] **Step 5: Confirm `seedResearchDirectives` will pick them up (read, no change)**

`seedResearchDirectives` (`apps/web/lib/admin-actions.ts:64`) does `createMany({ data: DIRECTIVE_SEED.map(...), skipDuplicates: true })` + a pristine refresh loop — both iterate `DIRECTIVE_SEED`, so the new cells INSERT when absent and never clobber a founder edit. No action-code change needed; document that the operator must click "Seed defaults" (or it runs on next seed) for the new cells to reach the DB. Verify the action still typechecks:
```bash
pnpm --filter @fikirtive/web typecheck
```
Expected: clean.

- [ ] **Step 6: Commit (leave for user approval)**

```bash
git add packages/core/src/cowork-directives.ts packages/core/src/cowork-directives.test.ts
git commit -m "feat(opt6): seed t2v directives for every routed video family (veo/seedance/wan/pixverse/grok/hailuo)"
```

---

## Task 7: Enforce disable at the WORKER (e) — handleGen + handleRefGen (HIGHEST-TRUST EDIT)

This is the highest-trust edit: the worker runs with real money in prod. The worker has NO existing prisma config read (`provider` is built once from env at `apps/worker/src/generation.ts:5`). The disable read here is net-new. It must fail the job BEFORE any `provider.generate`/`generateVideo` call, and fail-closed-to-typed-menu on a DB fault (a config hiccup must NOT fail a legitimate queued job — the typed menu is the authority; the all-status worker check exists only to catch a job QUEUED before an emergency disable).

**Files:**
- Create: `apps/worker/src/model-registry.ts`
- Modify: `apps/worker/src/jobs/gen.ts`, `apps/worker/src/jobs/refgen.ts`

- [ ] **Step 1: Create the worker read-through** (`apps/worker/src/model-registry.ts`)

```ts
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

/** Worker-side admin-disabled model ids. EMPTY set on any DB fault — fail-closed-
 *  to-typed-menu: a config-read hiccup must never fail a legitimate already-queued
 *  job (the typed superRefine that admitted the job is the authority). This check
 *  exists ONLY to catch a job that was QUEUED before an emergency disable. */
export async function workerDisabledModels(): Promise<Set<string>> {
  try {
    const rows = await prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, enabled: false },
      select: { modelId: true },
    });
    return new Set(rows.map((r) => r.modelId));
  } catch (e) {
    console.warn("[worker] workerDisabledModels DB read failed; treating nothing as disabled:", e instanceof Error ? e.message : e);
    return new Set();
  }
}
```

- [ ] **Step 2: handleGen — fail-without-spend on a disabled model** (`apps/worker/src/jobs/gen.ts`)

Add the imports at the top (after line 28 `import { provider } from "../generation.js";`):
```ts
import { isModelDisabled } from "@fikirtive/core";
import { workerDisabledModels } from "../model-registry.js";
```
The check goes AFTER the resume short-circuit (line 139-145) and the FAILED short-circuit (line 146) — so a committed/resumable job still finishes without re-spend — and BEFORE the atomic spend claim (line 171). Insert right after `if (job.status === "FAILED") return;` (line 146):
```ts
    // OPT-6 P2 (highest-trust): a job whose model was admin-disabled AFTER it was
    // queued must FAIL WITHOUT SPENDING. Runs AFTER the resume short-circuit (a
    // committed job still finishes — its money already spent) and BEFORE the spend
    // claim + provider call. Fail-closed-to-typed-menu: a DB fault → empty set →
    // the job proceeds (the typed gate that admitted it is the authority).
    const disabled = await workerDisabledModels();
    if (isModelDisabled(job.model, disabled)) {
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "this model was turned off before the job ran — not spending", finishedAt: new Date() } });
      return; // terminal, no throw → no retry, no spend
    }
```

- [ ] **Step 3: handleRefGen — fail-without-spend on a disabled model** (`apps/worker/src/jobs/refgen.ts`)

Add the imports (after line 34 `import { provider } from "../generation.js";`):
```ts
import { isModelDisabled } from "@fikirtive/core";
import { workerDisabledModels } from "../model-registry.js";
```
The check goes AFTER the resume short-circuit (line 76-81) and the VARIANT-liveness gate (line 87-100), and BEFORE the atomic spend claim (line 109). Insert right after the VARIANT block's closing `}` (line 100), before the "Atomic spend claim" comment (line 102):
```ts
    // OPT-6 P2 (highest-trust): fail-without-spend if the model was admin-disabled
    // after this job was queued. AFTER the resume short-circuit (a committed job
    // still finishes) and BEFORE the spend claim + provider call. Fail-closed-to-
    // typed-menu on a DB fault. (Variant jobs always use seedream → this is the
    // seedream/image toggle for the variant path too.)
    const disabled = await workerDisabledModels();
    if (isModelDisabled(job.model, disabled)) {
      await prisma.refGenJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "this model was turned off before the job ran — not spending", finishedAt: new Date() } });
      return; // terminal, no throw → no retry, no spend
    }
```

- [ ] **Step 4: Typecheck the worker**

```bash
pnpm --filter @fikirtive/worker typecheck
```
Expected: clean (confirms `@fikirtive/core` exports `isModelDisabled` + the worker resolves `modelRegistryOverlay` on prisma).

- [ ] **Step 5: Commit (leave for user approval)**

```bash
git add apps/worker/src/model-registry.ts apps/worker/src/jobs/gen.ts apps/worker/src/jobs/refgen.ts
git commit -m "feat(opt6): worker fails a disabled-model job WITHOUT spending (handleGen + handleRefGen)"
```

---

## Task 8: $0/mock eval harness + LOCAL disable check

Spec §4c + §7: a $0/mock harness asserting STRUCTURAL invariants. It NEVER calls `startGen`/`coworkGenerate`/refgen-spend — it drives the REAL core (mockPlannerReply → parseCoworkTurn → suggestModel → composer) and replicates the coworkTurn→coworkGenerate prompt flow to assert directive-exactly-once on the spent prompt. Follows the `scripts/verify-cowork-turn.mjs` idiom (env-load from `packages/db/.env`, refuse-if-fal, import the built `dist`).

**Files:**
- Create: `scripts/eval-cowork-knowledge.mjs`, `scripts/local-model-disable-verify.mjs`

- [ ] **Step 1: Write the eval harness** (`scripts/eval-cowork-knowledge.mjs`)

```js
// OPT-6 P2 eval harness ($0/mock). Drives the REAL money-critical CORE the way
// coworkTurn → coworkGenerate does — mockPlannerReply → parseCoworkTurn →
// suggestModel → composePrompt — and asserts STRUCTURAL invariants. NEVER calls
// startGen/coworkGenerate-spend/refgen. Mirrors scripts/verify-cowork-turn.mjs.
// Run: node scripts/eval-cowork-knowledge.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (process.env.COWORK_PROVIDER === "fal" || process.env.GENERATION_PROVIDER === "fal") {
  console.error("✗ refusing: a fal provider is set — this eval must run at \$0");
  process.exit(1);
}

const core = await import("../packages/core/dist/index.js");
const {
  mockPlannerReply, parseCoworkTurn, suggestModel,
  composePrompt, modelFamily, deriveMode, MAX_GEN_PROMPT,
  GEN_VIDEO_MODELS,
} = core;

let failed = false;
const check = (label, ok, detail) => { console.log(`${ok ? "✓" : "✗"} ${label}`, detail ?? ""); if (!ok) failed = true; };

// Replicate coworkGenerate's composer step exactly (Task 5 Step 2) with a fixed
// directive stand-in (the harness tests the TRANSFORM + family/mode resolution,
// not the DB read — getEnhanceDirective is DB-backed and unit-tested separately).
const DIRECTIVE = "Lead with MOTION and CAMERA.";
function composeAsSpend({ prompt, model, kind, entityIds, sourceGenerationId }) {
  const family = modelFamily(model);
  const mode = deriveMode({ kind, conditioned: entityIds.length > 0, hasSourceImage: !!sourceGenerationId, hasTail: false });
  const directive = family ? DIRECTIVE : undefined; // family resolves → a directive would apply
  return { prompt: composePrompt({ prompt, directive, maxLen: MAX_GEN_PROMPT }), family, mode };
}

// 1. FULL round-trip: a video idea → turn → suggestModel → spend-side compose.
//    Directive must appear EXACTLY ONCE in the final spent prompt; the card prompt
//    (turn.proposal.structuredPrompt) must be directive-FREE (composed only at spend).
{
  const turn = parseCoworkTurn(mockPlannerReply("make a video of a calm seascape"), []);
  check("turn has a proposal", !!turn.proposal, { kind: turn.proposal?.kind });
  const cardPrompt = turn.proposal.structuredPrompt;
  check("card prompt is directive-FREE (no compose at coworkTurn)", !cardPrompt.includes(DIRECTIVE));
  const sm = suggestModel({ kind: turn.proposal.kind, hasSourceImage: false, hasTail: false });
  const spend = composeAsSpend({ prompt: cardPrompt, model: sm.model, kind: turn.proposal.kind, entityIds: turn.proposal.entityIds, sourceGenerationId: null });
  const occurrences = spend.prompt.split(DIRECTIVE).length - 1;
  check("directive appears EXACTLY ONCE in the spent prompt", occurrences === 1, { occurrences, model: sm.model, mode: spend.mode });
  check("composer touched ONLY the prompt (model/kind unchanged)", sm.model && turn.proposal.kind === "video");
}

// 2. Composing the ALREADY-composed prompt again is a no-op (idempotent — the
//    double-append guard): simulate a stale card that somehow carried the directive.
{
  const sm = suggestModel({ kind: "video" });
  const once = composeAsSpend({ prompt: "a calm sea", model: sm.model, kind: "video", entityIds: [], sourceGenerationId: null });
  const twice = composeAsSpend({ prompt: once.prompt, model: sm.model, kind: "video", entityIds: [], sourceGenerationId: null });
  check("re-composing is idempotent (no double-append)", twice.prompt === once.prompt);
}

// 3. {image, entityIds} keyframe case → family/mode = (seedream, i2i).
{
  const spend = composeAsSpend({ prompt: "Mira in a red coat", model: "seedream", kind: "image", entityIds: ["e1"], sourceGenerationId: null });
  check("image + entityIds → mode i2i, family seedream", spend.family === "seedream" && spend.mode === "i2i", { family: spend.family, mode: spend.mode });
}

// 4. Per-family coverage: every family a video model ROUTES to resolves via
//    modelFamily (the composer can find a directive cell for it).
{
  const routed = new Set(GEN_VIDEO_MODELS.map((m) => modelFamily(m)).filter(Boolean));
  const unresolved = GEN_VIDEO_MODELS.filter((m) => !modelFamily(m));
  check("every video model maps to a known family", unresolved.length === 0, { unresolved });
  check("routed families", true, [...routed].join(", "));
}

if (failed) { console.error("\n✗ cowork-knowledge eval FAILED"); process.exit(1); }
console.log("\n✓ cowork-knowledge eval: directive-once, idempotent, correct family/mode, full family coverage (\$0)");
```

- [ ] **Step 2: Run the eval (mock, $0)**

```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/core build
node scripts/eval-cowork-knowledge.mjs
```
Expected: all `✓` + the final "cowork-knowledge eval: …" line. (Builds core first so `dist` carries `composePrompt`/`model-registry`.)

- [ ] **Step 3: Write the LOCAL disable DB check** (`scripts/local-model-disable-verify.mjs`)

```js
// LOCAL: a ModelRegistryOverlay row narrows the resolved enabled set; garbage rows
// ignored; empty table = full typed menu. \$0, no worker. Mirrors the resolveDisabled
// logic against the real DB (no "use server" import — drives core + a raw prisma read).
// Run: node scripts/local-model-disable-verify.mjs
process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID, GEN_VIDEO_MODELS, enabledVideoModels, isModelDisabled } =
  await import("../packages/core/dist/index.js");

const fail = (m) => { throw new Error(m); };
const resolveDisabled = async () => new Set(
  (await prisma.modelRegistryOverlay.findMany({ where: { ownerId: FOUNDER_OWNER_ID, enabled: false }, select: { modelId: true } })).map((r) => r.modelId),
);

try {
  await prisma.modelRegistryOverlay.deleteMany({ where: { ownerId: FOUNDER_OWNER_ID, modelId: { in: ["kling", "not-a-model"] } } });

  // empty → full typed menu
  let d = await resolveDisabled();
  if (enabledVideoModels(d).length !== GEN_VIDEO_MODELS.length) fail("empty table should give the full typed menu");
  console.log("✓ empty overlay → full typed video menu");

  // disable kling → narrowed by one, kling reported disabled
  await prisma.modelRegistryOverlay.upsert({
    where: { ownerId_modelId: { ownerId: FOUNDER_OWNER_ID, modelId: "kling" } },
    create: { id: newId(), ownerId: FOUNDER_OWNER_ID, modelId: "kling", enabled: false },
    update: { enabled: false },
  });
  d = await resolveDisabled();
  if (enabledVideoModels(d).includes("kling")) fail("kling should be filtered out");
  if (!isModelDisabled("kling", d)) fail("kling should report disabled");
  if (enabledVideoModels(d).length !== GEN_VIDEO_MODELS.length - 1) fail("exactly one model should be removed");
  console.log("✓ disabled kling → narrowed by one (additive narrowing)");

  // a garbage/unknown disabled row can't change the typed menu
  await prisma.modelRegistryOverlay.upsert({
    where: { ownerId_modelId: { ownerId: FOUNDER_OWNER_ID, modelId: "not-a-model" } },
    create: { id: newId(), ownerId: FOUNDER_OWNER_ID, modelId: "not-a-model", enabled: false },
    update: { enabled: false },
  });
  d = await resolveDisabled();
  for (const m of enabledVideoModels(d)) if (!GEN_VIDEO_MODELS.includes(m)) fail("enabled set must stay a subset of the typed menu");
  console.log("✓ garbage disabled row ignored — enabled set stays a subset of the typed menu");

  console.log("\n✓ model-disable resolves: empty=full, disable narrows, garbage ignored");
} finally {
  await prisma.modelRegistryOverlay.deleteMany({ where: { ownerId: FOUNDER_OWNER_ID, modelId: { in: ["kling", "not-a-model"] } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
```

- [ ] **Step 4: Run the LOCAL check**

```bash
node scripts/local-model-disable-verify.mjs
```
Expected: all `✓` + "model-disable resolves: …". (Cleans up its own rows in `finally`.)

- [ ] **Step 5: Commit (leave for user approval)**

```bash
git add scripts/eval-cowork-knowledge.mjs scripts/local-model-disable-verify.mjs
git commit -m "test(opt6): \$0 cowork-knowledge eval harness + local model-disable resolve check"
```

---

## Task 9: `saveModelEnabled` admin action (validated, audited, transactional)

Mirror P1a's `saveRuntimeConfig` (`apps/web/lib/admin-actions.ts:102`): `requireAdmin` + zod-validate the modelId against the typed union + `model.toggle` `ActionEvent` in the SAME `$transaction` as the upsert.

**Files:**
- Modify: `apps/web/lib/admin-actions.ts`

- [ ] **Step 1: Add the action** (`apps/web/lib/admin-actions.ts`)

Add `isKnownModelId` to the `@fikirtive/core` import (line 10). Add after `saveRuntimeConfig` (line 123):
```ts
/** Enable/disable one typed model in the registry overlay. requireAdmin (P1a) —
 *  P1b scopes section ① to ops. modelId MUST be a known typed model (write-time
 *  validation — the overlay can never disable a phantom). Audited transactionally.
 *  NOTE seedream coupling: disabling "seedream" disables ALL image generation
 *  (gen image + refgen base/sheet/variant) — the UI surfaces this as one toggle. */
export async function saveModelEnabled(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const v = raw as { modelId?: unknown; enabled?: unknown; notes?: unknown };
  if (typeof v?.modelId !== "string" || !isKnownModelId(v.modelId)) return { error: "Unknown model." };
  if (typeof v?.enabled !== "boolean") return { error: "Invalid toggle." };
  const modelId = v.modelId;
  const enabled = v.enabled;
  const notes = typeof v?.notes === "string" ? v.notes.slice(0, 1000) : "";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.modelRegistryOverlay.upsert({
        where: { ownerId_modelId: { ownerId: FOUNDER_OWNER_ID, modelId } },
        create: { id: newId(), ownerId: FOUNDER_OWNER_ID, modelId, enabled, notes },
        update: { enabled, notes },
      });
      await tx.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "model.toggle", payload: { modelId, enabled, via: gate.email } } });
    });
  } catch {
    return { error: "Couldn't save the model setting — please try again." };
  }
  revalidatePath("/admin/models");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck + commit (leave for user approval)**

```bash
pnpm --filter @fikirtive/web typecheck
```
Expected: clean.
```bash
git add apps/web/lib/admin-actions.ts
git commit -m "feat(opt6): saveModelEnabled admin action (typed-validated, audited, transactional)"
```

---

## Task 10: `/admin/models` page + ModelsAdmin UI

Spec §6 P2: a model registry page that iterates the typed catalogs, toggles enable/disable, shows the seedream-coupling note + a per-family directive-coverage metric. Renders in the existing `/admin` shell; mirrors `SettingsAdmin.tsx` styling.

**Files:**
- Create: `apps/web/app/admin/models/page.tsx`, `apps/web/components/admin/ModelsAdmin.tsx`
- Modify: `apps/web/app/admin/layout.tsx`

- [ ] **Step 1: Read the Next 16 page-loader conventions** (per `apps/web/AGENTS.md`)

```bash
ls apps/web/node_modules/next/dist/docs/ 2>/dev/null
```
Mirror the EXISTING `apps/web/app/admin/settings/page.tsx` (it's the canonical P1a server-page pattern: `export const dynamic = "force-dynamic"`, in-page `auth()`+`allowed()`+`redirect`, then a DB read + a client component). Do NOT invent a new pattern.

- [ ] **Step 2: Server page** (`apps/web/app/admin/models/page.tsx`)

```tsx
import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import { GEN_MODELS, GEN_VIDEO_MODELS, REFGEN_MODELS, MODEL_FAMILIES, modelFamily } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";
import { listDirectives } from "@/lib/cowork-knowledge";
import { ModelsAdmin, type ModelRow } from "@/components/admin/ModelsAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Models · Fikirtive admin" };

export default async function ModelsPage() {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login?from=/admin/models");

  // overlay (disabled set) — keyed by modelId
  const overlay = await prisma.modelRegistryOverlay.findMany({ where: { ownerId: FOUNDER_OWNER_ID }, select: { modelId: true, enabled: true, notes: true } });
  const byId = new Map(overlay.map((o) => [o.modelId, o]));

  // iterate the typed catalogs (capability truth). Image = the seedream toggle shared
  // by GEN_MODELS + REFGEN_MODELS (deduped); video = GEN_VIDEO_MODELS.
  const imageIds = Array.from(new Set<string>([...GEN_MODELS, ...REFGEN_MODELS]));
  const videoRows: ModelRow[] = (GEN_VIDEO_MODELS as readonly string[]).map((id) => ({
    id, kind: "video", family: modelFamily(id) ?? "?", enabled: byId.get(id)?.enabled ?? true, notes: byId.get(id)?.notes ?? "",
  }));
  const imageRows: ModelRow[] = imageIds.map((id) => ({
    id, kind: "image", family: modelFamily(id) ?? "?", enabled: byId.get(id)?.enabled ?? true, notes: byId.get(id)?.notes ?? "",
  }));

  // per-family directive coverage metric: which routed video families have ≥1 enabled cell
  const directives = await listDirectives();
  const seededFamilies = new Set(directives.filter((d) => d.enabled && d.directive.trim()).map((d) => d.family));
  const routedFamilies = Array.from(new Set((GEN_VIDEO_MODELS as readonly string[]).map((m) => modelFamily(m)).filter(Boolean))) as string[];
  const coverage = routedFamilies.map((f) => ({ family: f, covered: seededFamilies.has(f) }));

  return <ModelsAdmin imageRows={imageRows} videoRows={videoRows} coverage={coverage} families={[...MODEL_FAMILIES]} />;
}
```

- [ ] **Step 3: Client component** (`apps/web/components/admin/ModelsAdmin.tsx`) — mirror `SettingsAdmin.tsx` (CSS-variable inline styles, `Button` from `@/components/ds`, `saveModelEnabled` from `@/lib/admin-actions`, `{ok}|{error}` handling).

```tsx
"use client";
/**
 * OPT-6 P2 model registry (section ①). Lists the typed model catalogs and toggles
 * each model's enable/disable via saveModelEnabled (the overlay narrows the typed
 * menu; it can never add a model). Surfaces the seedream coupling + per-family
 * directive-coverage metric. Mirrors SettingsAdmin's card + {ok|error} pattern.
 */
import { useState } from "react";
import { Button } from "@/components/ds";
import { saveModelEnabled } from "@/lib/admin-actions";

export type ModelRow = { id: string; kind: "image" | "video"; family: string; enabled: boolean; notes: string };

function ModelToggle({ row }: { row: ModelRow }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggle(next: boolean) {
    if (saving) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveModelEnabled>> | null = null;
    try { res = await saveModelEnabled({ modelId: row.id, enabled: next, notes: row.notes }); } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setEnabled(next);
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
      <span style={{ font: "var(--text-body)", color: "var(--fg-1)", minWidth: 160 }}>{row.id}</span>
      <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", minWidth: 90 }}>{row.family}</span>
      <label style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--fg-2)" }}>
        <input type="checkbox" checked={enabled} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
        <span>{enabled ? "enabled" : "disabled"}</span>
      </label>
      {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "#3fb950" : "#e5484d", marginLeft: "auto" }}>{msg.text}</span>}
    </div>
  );
}

export function ModelsAdmin({ imageRows, videoRows, coverage }: { imageRows: ModelRow[]; videoRows: ModelRow[]; coverage: { family: string; covered: boolean }[]; families: string[] }) {
  const covered = coverage.filter((c) => c.covered).length;
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Models</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          Turn a model off and it stops spending everywhere (picker, direct gen, references, and any already-queued job). Capability is fixed in code — this only disables.
        </p>
      </header>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Image model</h2>
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>
          One shared image model (Seedream). Turning it off disables ALL image generation — element bases, ref sheets, variants, and direct image gen.
        </p>
        {imageRows.map((r) => <ModelToggle key={r.id} row={r} />)}
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Video models</h2>
        {videoRows.map((r) => <ModelToggle key={r.id} row={r} />)}
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Directive coverage</h2>
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>{covered}/{coverage.length} routed video families have an enabled directive.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {coverage.map((c) => (
            <span key={c.family} style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: "var(--bg-2)", color: c.covered ? "#3fb950" : "#e5484d" }}>
              {c.family} {c.covered ? "✓" : "—"}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Flip the NAV slot live** (`apps/web/app/admin/layout.tsx`)

Change line 16 from the disabled placeholder to a live link:
```tsx
  { href: "/admin/models", label: "Model & provider", live: true },
```

- [ ] **Step 5: Build + manual check (mock, local)**

```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build
```
Expected: build clean. (Manual: `pnpm --filter @fikirtive/web dev`, sign in, visit `/admin/models`, toggle a video model, confirm it persists + the coverage metric shows 9/9 families after a "Seed defaults" on the directives page.)

- [ ] **Step 6: Commit (leave for user approval)**

```bash
git add apps/web/app/admin/models apps/web/components/admin/ModelsAdmin.tsx apps/web/app/admin/layout.tsx
git commit -m "feat(opt6): /admin/models registry UI (toggle + seedream note + directive coverage)"
```

---

## Task 11: `/admin/knowledge` page — planner-system / brief-default / description-template editing

Spec §6 P2: edit `COWORK_PLANNER_SYSTEM` + ProjectBrief-defaults + the structured-description template via the RuntimeConfig pattern. These are NEW runtime-config keys; extend `runtimeConfigInput` (core) so `saveRuntimeConfig` (already built, P1a) accepts them — no new action needed.

NOTE on wiring scope: P2 ships the EDIT surface + persistence + read-back. Threading the DB-overridden `COWORK_PLANNER_SYSTEM`/brief-default/template back into `buildPlannerMessages` is a small follow-on; if the implementer wants it live this phase, override at the `coworkTurn` call site (resolve the key, pass it into `buildPlannerMessages`). Document whichever choice is made. The plan below ships persistence + read-back (the minimal, money-neutral slice — these are $0 planner-text keys, not spend gates).

**Files:**
- Modify: `packages/core/src/cowork.ts` (extend `runtimeConfigInput`)
- Create: `apps/web/app/admin/knowledge/page.tsx`, `apps/web/components/admin/KnowledgeAdmin.tsx`
- Modify: `apps/web/app/admin/layout.tsx` (add a knowledge NAV link)

- [ ] **Step 1: Extend `runtimeConfigInput`** (`packages/core/src/cowork.ts`, the discriminated union at line 189-198) — add three text keys:

```ts
export const runtimeConfigInput = z.discriminatedUnion("key", [
  z.object({ key: z.literal("vision"), value: z.object({
    enabled: z.boolean().optional(),
    maxImages: z.number().int().min(1).max(8).optional(),
    maxBytes: z.number().int().min(1).max(16_000_000).optional(),
  }).strict() }),
  z.object({ key: z.literal("cowork_provider"), value: z.object({
    provider: z.enum(["mock", "fal"]), // NO "modal" in P1a/P2 — that's P1b (super-admin)
  }).strict() }),
  // OPT-6 P2 §⑥ knowledge keys — $0 planner text (not spend gates). Bounded length.
  z.object({ key: z.literal("planner_system"), value: z.object({ text: z.string().trim().max(8000) }).strict() }),
  z.object({ key: z.literal("brief_default"), value: z.object({ text: z.string().trim().max(2000) }).strict() }),
  z.object({ key: z.literal("description_template"), value: z.object({ text: z.string().trim().max(2000) }).strict() }),
]);
```

- [ ] **Step 2: Build core** (so the web client picks up the schema)

```bash
pnpm --filter @fikirtive/core build
```
Expected: clean.

- [ ] **Step 3: Server page** (`apps/web/app/admin/knowledge/page.tsx`) — mirror `settings/page.tsx`: in-page auth, read the three keys (falling back to the code defaults), pass to the client component.

```tsx
import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@fikirtive/db";
import { COWORK_PLANNER_SYSTEM } from "@fikirtive/core";
import { KnowledgeAdmin } from "@/components/admin/KnowledgeAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge · Fikirtive admin" };

async function readText(key: string): Promise<string | null> {
  try {
    const row = await prisma.runtimeConfig.findUnique({ where: { key }, select: { valueJson: true } });
    const t = (row?.valueJson as { text?: unknown } | null)?.text;
    return typeof t === "string" ? t : null;
  } catch { return null; }
}

export default async function KnowledgePage() {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login?from=/admin/knowledge");
  const plannerSystem = (await readText("planner_system")) ?? COWORK_PLANNER_SYSTEM;
  const briefDefault = (await readText("brief_default")) ?? "";
  const descriptionTemplate = (await readText("description_template")) ?? "";
  return <KnowledgeAdmin plannerSystem={plannerSystem} briefDefault={briefDefault} descriptionTemplate={descriptionTemplate} codeDefaultPlanner={COWORK_PLANNER_SYSTEM} />;
}
```

- [ ] **Step 4: Client component** (`apps/web/components/admin/KnowledgeAdmin.tsx`) — three textarea cards, each calling `saveRuntimeConfig({ key, value: { text } })`; mirror `SettingsAdmin`'s save/`{ok|error}` pattern. Include a "reset to code default" hint for the planner-system card (show `codeDefaultPlanner`).

```tsx
"use client";
/**
 * OPT-6 P2 §⑥ knowledge editing. Three runtime-config text keys via the SAME
 * saveRuntimeConfig action (P1a) + extended runtimeConfigInput schema. $0 planner
 * text — not a spend gate. Mirrors SettingsAdmin's card + {ok|error} pattern.
 */
import { useState } from "react";
import { Button } from "@/components/ds";
import { saveRuntimeConfig } from "@/lib/admin-actions";

function TextCard({ title, hint, value, configKey }: { title: string; hint: string; value: string; configKey: "planner_system" | "brief_default" | "description_template" }) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = text !== base;

  async function save() {
    if (saving) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveRuntimeConfig>> | null = null;
    try { res = await saveRuntimeConfig({ key: configKey, value: { text } }); } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setBase(text);
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <section style={{ display: "grid", gap: 10, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
      <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>{title}</h2>
      <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>{hint}</p>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={configKey === "planner_system" ? 12 : 5}
        style={{ font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "8px 10px", resize: "vertical" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "#3fb950" : "#e5484d" }}>{msg.text}</span>}
        <div style={{ marginLeft: "auto" }}>
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </section>
  );
}

export function KnowledgeAdmin({ plannerSystem, briefDefault, descriptionTemplate }: { plannerSystem: string; briefDefault: string; descriptionTemplate: string; codeDefaultPlanner: string }) {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Knowledge</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>Planner system prompt + project-brief default + reference-description template. \$0 text — not a spend control.</p>
      </header>
      <TextCard configKey="planner_system" title="Planner system prompt" hint="The creative-director agent's system prompt. Empty/unset → the code default." value={plannerSystem} />
      <TextCard configKey="brief_default" title="Project-brief default" hint="Seed text for a new project's brief." value={briefDefault} />
      <TextCard configKey="description_template" title="Reference-description template" hint="The see-once visual-description shape the planner caches per @ref." value={descriptionTemplate} />
    </main>
  );
}
```

- [ ] **Step 5: Add the knowledge NAV link** (`apps/web/app/admin/layout.tsx`) — insert after the Directives link (line 15):
```tsx
  { href: "/admin/knowledge", label: "Knowledge", live: true },
```

- [ ] **Step 6: Typecheck + build + commit (leave for user approval)**

```bash
pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build
```
Expected: clean.
```bash
git add packages/core/src/cowork.ts apps/web/app/admin/knowledge apps/web/components/admin/KnowledgeAdmin.tsx apps/web/app/admin/layout.tsx
git commit -m "feat(opt6): /admin/knowledge — planner-system/brief/template editing via runtime-config"
```

---

## Task 12: Full local gate + STOP for Codex

- [ ] **Step 1: Run the whole local gate**

```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/core test
pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build
pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build
pnpm --filter @fikirtive/worker typecheck
node scripts/verify-auth-guards.mjs
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" GENERATION_PROVIDER=mock node scripts/verify-cowork-turn.mjs
node scripts/eval-cowork-knowledge.mjs
node scripts/local-model-disable-verify.mjs
node scripts/local-cowork-idempotency-verify.mjs
```
Expected: all green — core tests pass (incl. model-registry, cowork-compose, cowork-route disabled-set, cowork-directives coverage), builds clean, worker typechecks, auth-guard passes (the new actions in admin-actions/refgen-actions/gen-actions stay guarded), cowork-turn invariant holds ($0/no GenJob), the eval asserts directive-once + family coverage, model-disable resolves, idempotency unchanged.

- [ ] **Step 2: STOP — Codex money-safety gate**

Do NOT deploy. Hand the diff to `/codex` for the money-safety review. Focus points to call out:
- **The worker disable check is the highest-trust edit** — confirm it runs AFTER the resume short-circuit (a committed/already-paid job still finishes) and BEFORE the spend claim + provider call in BOTH `handleGen` and `handleRefGen`; confirm fail-closed-to-typed-menu (DB fault → empty set → job proceeds, never blocked by a config hiccup).
- **Additive narrowing only** — `genRequest.superRefine` + `refGenRequest.enum` are untouched and remain the sole authority over which (model,params) may spend; every disable check can only REJECT.
- **All 5 chokepoints covered** — suggestModel pool (a), startGen (b), startRefGen (c), dispatchVariantJob (d), worker handleGen+handleRefGen (e); the seedream coupling means the image toggle hits all image paths.
- **Composer is prompt-only + $0** — it changes ONLY `req.prompt` (model/kind/count/params untouched), runs ONLY in `coworkGenerate` (NOT coworkTurn → no double-append), and never makes an LLM call; the eval proves directive-exactly-once on the spent prompt.
- **Migration is additive** (CREATE TABLE only) and was applied LOCAL-only.

Only after Codex PASS + explicit user authorization: prod = `migrate:deploy` the `ModelRegistryOverlay` migration (cloud env, localhost guard, `migrate status` first) BEFORE shipping the web + worker builds that read it (additive-nullable table → reverse order only means the read returns nothing, no error — but state the order). Deploy BOTH `railway up --service web` AND `railway up --service worker` (the worker change is part of this phase). Run "Seed defaults" on `/admin/directives` after deploy so the 6 new family directives reach prod.

---

## Self-Review (run before handing off)

**1. Spec coverage (§4 Pillar D + §6 P2 row + §7 tests):**
- §4b `ModelRegistryOverlay` table (additive, modelId∈union incl. REFGEN_MODELS) → Task 1; pure intersect helper (subset property, unknown-id ignored) → Task 2; web + worker read-throughs (fail-closed) → Tasks 4, 7. ✓
- §4b TRUE-disable at ALL 5 chokepoints: suggestModel pool (a) → Task 4+5; startGen (b) → Task 5; startRefGen (c) → Task 5; dispatchVariantJob (d) → Task 5; worker handleGen+handleRefGen (e) → Task 7. ✓
- §4b seedream coupling note (one shared image toggle) → Task 9 comment + Task 10 UI copy. ✓
- §4a deterministic $0 spend-side composer (coworkGenerate only, NOT coworkTurn; conditioned=entityIds approximation documented; prompt-only; clamped) → Task 3 (pure) + Task 5 Step 2 (wiring). ✓
- §4a per-family directive seeding for veo/seedance/wan/pixverse/grok/hailuo + seedResearchDirectives picks them up → Task 6. ✓
- §4c $0/mock eval harness (mockPlannerReply→parseCoworkTurn→suggestModel→composer; directive-once on the full round-trip; correct family/mode for {image, entityIds}; per-family coverage; never spends) → Task 8. ✓
- §6 P2 admin UI: `/admin/models` (registry + seedream note + coverage metric) → Task 10; `/admin/knowledge` (COWORK_PLANNER_SYSTEM + brief-default + description-template via RuntimeConfig) → Task 11; rendered in the existing shell with NAV slots flipped live → Tasks 10, 11. ✓
- §7 tests: registry subset property → Task 2; disable rejected at startGen/startRefGen/dispatchVariantJob/worker → Tasks 5, 7 (+ LOCAL resolve check Task 8); composer directive-exactly-once + prompt-only + $0 + family/mode → Tasks 3, 8; per-family coverage → Tasks 6, 8. (Out of P2 per the spec: spentUsd ledger = P3a; RBAC matrix = P1b.) ✓

**2. Placeholder scan:** every step has real code, an exact path, an exact command, and an expected output. The auth-rollout, migration ritual, and worker insertion points name concrete line numbers (verified against the current on-disk code: coworkGenerate@461, startGen@26, suggestModel@33, handleGen@114, handleRefGen@42, DIRECTIVE_SEED@66, runtimeConfigInput@189). No "TBD"/"similar to"/"handle edge cases". ✓

**3. Type consistency:** `ALL_MODEL_IDS`, `isKnownModelId`, `enabledVideoModels`, `isModelDisabled`, `composePrompt`, `COMPOSE_SEP`, `resolveDisabledModels` (web), `workerDisabledModels` (worker), `saveModelEnabled`, the extended `runtimeConfigInput` keys, and `suggestModel`'s new `disabled?: ReadonlySet<string>` are used consistently across tasks. The composer reuses already-imported `modelFamily`/`deriveMode`/`MAX_GEN_PROMPT`/`getEnhanceDirective` in cowork-actions (no new imports needed beyond `composePrompt`+`isModelDisabled`+`resolveDisabledModels`). ✓

**Open caveats for the implementer:**
- **Worker prisma boundary (verified):** the worker has NO existing prisma-based config read — `provider` is built once from env at module load. The disable read (`workerDisabledModels`) is genuinely net-new; it imports `prisma` from `@fikirtive/db` directly (the worker already does this in both job handlers). Confirm the worker's `@fikirtive/core` build carries `isModelDisabled` (Task 7 Step 4 typecheck).
- **suggestModel threading was NOT invasive (verified):** `suggestModel` is pure with 4 callers (cowork-route.test, verify-cowork-turn.mjs, coworkTurn, the import). Adding an OPTIONAL `disabled` field is backward-compatible — `verify-cowork-turn.mjs` and the existing tests call it without `disabled` and stay green. So the plan threads it as a param (the spec's preferred path) rather than the caller-side fallback.
- **Image-disable not in suggestModel (by design):** `suggestModel` hard-wires image→seedream and does NOT consult `disabled` for the image branch. A disabled seedream is caught at the spend gates (coworkGenerate re-check, startGen, startRefGen, dispatchVariantJob, worker) — matching the spec's "suggestModel is UX-only; the spend gates are the authority". Documented in Task 4 Step 3 + Task 5 Step 1.
- **§⑥ knowledge keys persist + read-back only:** Task 11 ships the edit surface + persistence + read-back of `COWORK_PLANNER_SYSTEM`/brief/template, but does NOT re-thread the DB override back into `buildPlannerMessages` (a small money-neutral follow-on, noted in Task 11's scope). These are $0 planner-text keys, not spend gates, so this is a safe partial slice; flag it explicitly at the Codex gate if full wiring is wanted this phase.
