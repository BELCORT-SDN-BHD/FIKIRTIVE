# OPT-6 P3a — Spend observability (spentUsd ledger + cost view + money-gate audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the spend ledger (spec §5 + §6 P3a row) — `GenJob.spentUsd` + `RefGenJob.spentUsd`, written by the worker in the SAME transaction as the existing spend marker (the highest-trust, money-critical edit), a `refgen.start` audit on the under-audited variant path, a read-only `/admin/cost` view summing spend per day + per job, and a read-only `/admin/audit` viewer over the ActionEvent money-gate taxonomy — WITHOUT ever gating, widening, duplicating, or skipping a spend. `spentUsd` is RECORD-ONLY.

**Architecture:** The price is already pure typed truth in `packages/core` (`videoPriceUsd`, `GEN_PRICE_USD_PER_IMAGE`, `REFGEN_PRICE_USD_PER_IMAGE`, `videoDefaults`). P3a extracts two thin pure helpers — `genSpentUsd(job)` / `refgenSpentUsd(job)` — into `packages/core` so the money-critical worker write is one byte-stable call (TDD-covered, no prisma). The worker writes `spentUsd` ALONGSIDE the existing `spent`/`outputAssetIds` markers it already writes (same tx, never a new branch). The two `/admin` pages are server components that READ-aggregate `GenJob`/`RefGenJob`/`ActionEvent` and render in the existing `/admin` shell (flip two NAV slots). P3a builds on P1a + P2 (BUILT in the working tree): `RuntimeConfig`/`ModelRegistryOverlay`, `requireSession` on all actions, `requireAdmin` + audited admin actions, `/admin` shell + Settings/Models/Knowledge/Directives, the disable chokepoints in startGen/startRefGen/dispatchVariantJob + worker handleGen/handleRefGen, and the full ActionEvent taxonomy already emitting `via`.

**Tech Stack:** Next.js 16 (customized — read `apps/web/node_modules/next/dist/docs/` before any route/page code; see `apps/web/AGENTS.md`), Prisma 7 + Neon (additive migration, LOCAL dev DB only), next-auth v5, `packages/core` vitest, `scripts/*.mjs` Node checks (import built `dist`, no `tsx`).

**Scope:** P3a ONLY. NO 5-role RBAC (P1b — the cost page is allowlist-gated like every other `/admin` page; `requireRole(finance/moderator,…)` arrives in P1b). NO planner-token (text-LLM) USD estimation — **explicitly DEFERRED** (see Task 5; the `via` hook already exists). NO content-moderation UI (P4 — P3a pulls forward only the read-only money-gate audit slice). NO change to the typed media-spend gate or any spend decision. Spec: `docs/superpowers/specs/2026-06-17-opt6-admin-dashboard-design.md` (§0.1 money-safety, §0.2 text-LLM spend, §5 ledger, §6 P3a row, §7 ledger tests).

**House rules (every task):**
- **Money-safety #1 — `spentUsd` is RECORD-ONLY.** It never gates, narrows, widens, or influences any spend. No code path may read `spentUsd` before a `provider.generate*` call. The typed media-spend gate (`genRequest.superRefine` at `packages/core/src/gen.ts` + the worker claim/commit logic) is UNCHANGED.
- **Worker change = highest-trust edit.** `apps/worker/src/jobs/gen.ts` + `apps/worker/src/jobs/refgen.ts` run with real money in prod. `spentUsd` MUST ride the SAME `prisma` update/`$transaction` as the EXISTING spend marker (`spent: true` for gen / `outputAssetIds` for refgen) — never add a new write, branch, or `await` that could split the commit, skip the marker, or run twice. Every existing exactly-once / resume / fail-closed invariant must be byte-for-byte preserved; the ONLY delta per write site is adding `spentUsd: <pure helper>` to a `data: {}` object that already updates that row. Call this out explicitly at the Codex gate.
- **Additive migration LOCAL-only.** Both columns are nullable (`Float?`) → additive. Apply to `DATABASE_URL=postgresql://fikirtive:fikirtive@localhost:5432/fikirtive` ONLY, never prod. Author via the `prisma migrate diff … --script` ritual (the P1a/P2/idempotency convention — avoids the LOCAL checksum-drift that interactive `migrate dev` hits against hand-authored prior migrations), apply via `migrate deploy`.
- **Migration ordering (state it).** `prisma migrate deploy` (add the nullable columns) runs BEFORE the worker build that writes them. The columns are additive-nullable, so the reverse order only ERRORS the worker write (`column "spentUsd" does not exist`) — it never loses data and never affects spend — but ship the migration first regardless.
- **TDD with `packages/core` vitest** for the pure price-snapshot helpers (`genSpentUsd`/`refgenSpentUsd`). Write the failing test first.
- **Tests run** `GENERATION_PROVIDER=mock` + `COWORK_PROVIDER` unset; **kill stale fal workers first** (`pkill -f 'apps/worker' || true`) — a leftover worker from a prior session can claim a job and burn real money.
- **Surgical.** Match existing style (inline-style admin pages with `var(--*)` CSS variables, server-page-gates-then-client-component, `dynamic = "force-dynamic"`); don't refactor adjacent code; remove only orphans your change creates.
- **NO auto-commit/push.** Each task's `git` step is written for the USER to run/approve — leave it for user approval; never auto-run commit/push.
- **After all tasks: STOP for a `/codex` money-safety gate** before any deploy. Flag the deferred planner-token decision (Task 5) and the worker `spentUsd`-rides-the-same-tx claim for the user at that gate.

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/20260617140000_spend_ledger/migration.sql` — additive `ALTER TABLE … ADD COLUMN "spentUsd"` for `GenJob` + `RefGenJob` (both nullable).
- `packages/core/src/spend.ts` — pure helpers: `genSpentUsd(job)` (video → `videoPriceUsd`, image → `GEN_PRICE_USD_PER_IMAGE * count`) and `refgenSpentUsd(job)` (`REFGEN_PRICE_USD_PER_IMAGE * count`). NO prisma.
- `packages/core/src/spend.test.ts` — TDD: video math, image math, refgen math, count handling, missing `videoOptions` fallback.
- `apps/web/app/admin/cost/page.tsx` + `apps/web/components/admin/CostAdmin.tsx` — read-only per-day + recent-job spend view (§②).
- `apps/web/app/admin/audit/page.tsx` + `apps/web/components/admin/AuditAdmin.tsx` — read-only ActionEvent money-gate viewer, type-filterable (§③ slice).
- `scripts/local-spend-snapshot-verify.mjs` — LOCAL $0 check: a fake DONE GenJob/RefGenJob row gets the correct `spentUsd` via the pure helper + write path; no provider, no spend.

**Modify:**
- `packages/db/prisma/schema.prisma` — add `spentUsd Float?` to `GenJob` (after `spent`, line ~389) and `RefGenJob` (after `outputAssetIds`, line ~332).
- `packages/core/src/index.ts` — `export * from "./spend.js";`.
- `apps/worker/src/jobs/gen.ts` — write `spentUsd` in the 3 existing spent-marker writes (resume ~line 144, commit tx ~line 388, FAILED catch ~line 415).
- `apps/worker/src/jobs/refgen.ts` — write `spentUsd` at the 3 existing money points (resume ~line 78-83, post-paid record ~line 207, FAILED catch ~line 223-228). NET-NEW: refgen has no spend marker today.
- `apps/web/lib/refgen-actions.ts` — emit a `refgen.start` ActionEvent in `dispatchVariantJob` (covers `createVariant` + `regenerateVariant` — the M-c under-audited paid variant path).
- `apps/web/app/admin/layout.tsx` — flip the "Cost & usage" and "Content & audit" NAV slots live (→ `/admin/cost`, `/admin/audit`).

---

## Task 0: Confirm the ground truth (no edits — read before touching money code)

- [ ] **Step 1: Confirm the schema columns do NOT exist yet**

```bash
grep -n "spentUsd" packages/db/prisma/schema.prisma || echo "OK: spentUsd absent (additive)"
grep -n "spent " packages/db/prisma/schema.prisma
```
Expected: `spentUsd` absent. `GenJob.spent Boolean @default(false)` present (line ~389); `RefGenJob` has NO `spent` (it is NET-NEW for refgen). This matches the spec: GenJob already has the `spent` boolean marker; RefGenJob has none and its FAILED catch persists no spend marker.

- [ ] **Step 2: Re-confirm the worker spent-marker write sites (the highest-trust edits)**

```bash
grep -n "spent: true\|spent: spent\|outputAssetIds }\|finalizeDone\|status: \"DONE\"" apps/worker/src/jobs/gen.ts apps/worker/src/jobs/refgen.ts
```
Expected (gen.ts): resume DONE update writes `spent: true` (~144); the commit `$transaction` writes `generationIds: ids, spent: true` (~388); the catch writes `spent: spent || charged` on the FAILED branch (~415). Expected (refgen.ts): resume calls `attachOutputs` + `finalizeDone` (~78-81); the post-paid record writes `{ outputAssetIds }` (~207) then `finalizeDone` (~211); the catch writes FAILED (~223-228, currently NO spend marker).

- [ ] **Step 3: Confirm the price helpers + job fields the snapshot needs are present**

```bash
grep -n "export function videoPriceUsd\|GEN_PRICE_USD_PER_IMAGE\|REFGEN_PRICE_USD_PER_IMAGE\|export function videoDefaults" packages/core/src/gen.ts packages/core/src/refgen.ts
```
Expected: `videoPriceUsd(model, { seconds, resolution, audio, count })` (gen.ts:161), `GEN_PRICE_USD_PER_IMAGE = 0.04` (gen.ts:81), `videoDefaults(model)` (gen.ts:131), `REFGEN_PRICE_USD_PER_IMAGE = 0.04` (refgen.ts:39). The worker `GenJob` row carries `kind`, `model`, `count`, `videoOptions` (Json: `{seconds,resolution,aspectRatio,fps,audio}`); the `RefGenJob` row carries `count`, `model`. All present (schema lines 378-382, 325). No edits here — this is the read-before-write confirmation the money-critical tasks depend on.

---

## Task 1: `spentUsd` columns (additive migration, LOCAL only)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260617140000_spend_ledger/migration.sql`

- [ ] **Step 1: Add the columns to `schema.prisma`**

In `model RefGenJob` (line 319-348), add after `outputAssetIds String[] @default([])` (line 332):

```prisma
  /// 钱真相（OPT-6 P3a，纯记录）：付费 provider 调用提交时由 worker 在同一写入里快照
  /// （= REFGEN_PRICE_USD_PER_IMAGE * count）。null = 没扣过费。绝不参与任何 spend 判定。
  spentUsd       Float?
```

In `model GenJob` (line 357-403), add after `spent Boolean @default(false)` (line 389):

```prisma
  /// 钱真相（OPT-6 P3a，纯记录）：付费调用提交时 worker 在 commit tx 里快照（video=
  /// videoPriceUsd，image=GEN_PRICE_USD_PER_IMAGE*count），冻结如 Generation.entitySnapshot。
  /// null = 没扣过费。绝不参与任何 spend 判定。
  spentUsd           Float?
```

- [ ] **Step 2: Author the migration via `migrate diff … --script` (LOCAL, never prod)**

Use the diff-script ritual (avoids the LOCAL checksum-drift interactive `migrate dev` hits against the hand-authored prior migrations). The timestamp MUST be after the latest existing migration `20260617130000_model_registry_overlay`:

```bash
mkdir -p packages/db/prisma/migrations/20260617140000_spend_ledger
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" \
  pnpm --filter @fikirtive/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > /tmp/spend-diff.sql
```

NOTE: `--from-schema-datasource` reads the CURRENT DB state via the schema's datasource; `--to-schema-datamodel` reads the desired state from the (now-edited) schema model. The diff is the delta = exactly the two `ADD COLUMN`s. Inspect `/tmp/spend-diff.sql`: it MUST contain ONLY two `ALTER TABLE … ADD COLUMN "spentUsd" DOUBLE PRECISION;` statements (one for `GenJob`, one for `RefGenJob`) — NO `DROP`, NO `ALTER COLUMN` of any existing column, NO `NOT NULL`. Then write the verified SQL into the migration file `packages/db/prisma/migrations/20260617140000_spend_ledger/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "GenJob" ADD COLUMN "spentUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RefGenJob" ADD COLUMN "spentUsd" DOUBLE PRECISION;
```

(If `/tmp/spend-diff.sql` differs — e.g. statement order — use what the diff produced; it is the source of truth for what the client expects. It must remain two nullable `ADD COLUMN`s and nothing else.)

- [ ] **Step 3: Apply + regenerate client (LOCAL)**

```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm --filter @fikirtive/db exec prisma migrate deploy
pnpm --filter @fikirtive/db build
```
Expected: "All migrations have been successfully applied." (the `spend_ledger` migration listed), then the client builds with `genJob.spentUsd` / `refGenJob.spentUsd` available.

- [ ] **Step 4: Verify the columns landed nullable (LOCAL)**

```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" \
  pnpm --filter @fikirtive/db exec prisma migrate status
```
Expected: "Database schema is up to date!" — no drift, no pending migration.

- [ ] **Step 5: Commit (leave for user approval)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260617140000_spend_ledger
git commit -m "feat(opt6): add GenJob.spentUsd + RefGenJob.spentUsd (additive, record-only)"
```

---

## Task 2: Pure price-snapshot helpers in core (TDD)

Rationale: keep the money-critical worker write to a SINGLE byte-stable function call so it is testable, byte-stable, and impossible to get subtly wrong inline. `packages/core` has NO prisma — the helpers take a plain shape (the worker passes the loaded `job`). The clean extraction: a `GenSpendInput` / `RefGenSpendInput` typed on exactly the fields the price needs.

**Files:**
- Create: `packages/core/src/spend.ts`, `packages/core/src/spend.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** (`packages/core/src/spend.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { genSpentUsd, refgenSpentUsd } from "./spend.js";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd } from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";

describe("genSpentUsd", () => {
  it("image = flat per-image price × count", () => {
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 1);
    expect(genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }))
      .toBe(GEN_PRICE_USD_PER_IMAGE * 4);
  });
  it("video = videoPriceUsd with the job's resolved options", () => {
    const vo = { seconds: 5, resolution: "1080p", audio: true };
    expect(genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }))
      .toBe(videoPriceUsd("veo3.1-fast", { seconds: 5, resolution: "1080p", audio: true, count: 1 }));
  });
  it("video with null/partial videoOptions falls back to the model's defaults (never NaN)", () => {
    const v = genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: null });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});

describe("refgenSpentUsd", () => {
  it("= flat refgen per-image price × count (its OWN constant, not GEN_PRICE)", () => {
    expect(refgenSpentUsd({ model: "seedream", count: 1 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 1);
    expect(refgenSpentUsd({ model: "seedream", count: 3 })).toBe(REFGEN_PRICE_USD_PER_IMAGE * 3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fikirtive/core test -- spend`
Expected: FAIL — `genSpentUsd`/`refgenSpentUsd` not exported.

- [ ] **Step 3: Implement** (`packages/core/src/spend.ts`)

```ts
/**
 * Pure spend-snapshot helpers (OPT-6 P3a). RECORD-ONLY: the worker calls these at
 * the commit point to freeze GenJob.spentUsd / RefGenJob.spentUsd, exactly when
 * money is committed (like Generation.entitySnapshot). NO prisma, NO LLM — pure
 * functions over the price truth in gen.ts/refgen.ts so the money-critical worker
 * write is one byte-stable call. These never gate or influence spend.
 */
import {
  GEN_PRICE_USD_PER_IMAGE,
  videoPriceUsd,
  videoDefaults,
  type GenVideoModel,
} from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";

/** Exactly the GenJob fields the price needs (a subset of the row). */
export interface GenSpendInput {
  kind: "IMAGE" | "VIDEO";
  model: string;
  count: number;
  /** GenJob.videoOptions Json: { seconds, resolution, aspectRatio, fps, audio }. */
  videoOptions: { seconds?: number; resolution?: string; audio?: boolean } | null;
}

/** Frozen USD for a committed GenJob. Video: videoPriceUsd over the job's resolved
 *  options (fall back to the model's defaults exactly as the worker does at the
 *  provider call — never NaN). Image: flat per-image × count. */
export function genSpentUsd(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    const d = videoDefaults(job.model as GenVideoModel);
    return videoPriceUsd(job.model as GenVideoModel, {
      seconds: job.videoOptions?.seconds ?? d.seconds,
      resolution: job.videoOptions?.resolution ?? d.resolution,
      audio: job.videoOptions?.audio ?? d.audio,
      count: job.count,
    });
  }
  return GEN_PRICE_USD_PER_IMAGE * job.count;
}

/** Exactly the RefGenJob fields the price needs. */
export interface RefGenSpendInput {
  model: string;
  count: number;
}

/** Frozen USD for a committed RefGenJob. Uses refgen's OWN per-image constant
 *  (REFGEN_PRICE_USD_PER_IMAGE — same value as GEN_PRICE today but independent). */
export function refgenSpentUsd(job: RefGenSpendInput): number {
  return REFGEN_PRICE_USD_PER_IMAGE * job.count;
}
```

NOTE on the video fallback: the worker resolves `vo?.seconds ?? videoDefaults(job.model).seconds` at the provider call (gen.ts:348). `genSpentUsd` mirrors that fallback so the recorded price matches what was actually requested even on an older row with `videoOptions: null`. `videoPriceUsd` ignores `aspectRatio`/`fps`, so the input shape only needs `seconds`/`resolution`/`audio`.

- [ ] **Step 4: Export from the core barrel** (`packages/core/src/index.ts`)

Add: `export * from "./spend.js";`

- [ ] **Step 5: Run tests + build**

Run: `pnpm --filter @fikirtive/core test && pnpm --filter @fikirtive/core build`
Expected: the new `spend` tests PASS; all existing core tests still PASS (the new file is additive — no existing symbol changed).

- [ ] **Step 6: Commit (leave for user approval)**

```bash
git add packages/core/src/spend.ts packages/core/src/spend.test.ts packages/core/src/index.ts
git commit -m "feat(opt6): pure genSpentUsd/refgenSpentUsd price-snapshot helpers (TDD)"
```

---

## Task 3: Worker — write `GenJob.spentUsd` (money-critical, same-tx)

**This is a highest-trust edit. The ONLY delta is adding `spentUsd:` to `data: {}` objects the worker ALREADY writes. Do not add a write, a branch, an `await`, or reorder anything. Re-read `apps/worker/src/jobs/gen.ts` lines 116-421 before editing.**

**Files:**
- Modify: `apps/worker/src/jobs/gen.ts`

- [ ] **Step 1: Import the helper**

In the `@fikirtive/core` import block (gen.ts:17-26), add `genSpentUsd` to the named imports:

```ts
import {
  storageKey,
  newId,
  GEN_RETRY_LIMIT,
  videoDefaults,
  MAX_CONDITIONING_IMAGES,
  genSpentUsd,
  type GenJobData,
  type GenModel,
  type GenVideoModel,
} from "@fikirtive/core";
```

- [ ] **Step 2: PRIMARY write — in the SAME commit `$transaction` as the marker**

In the commit `$transaction` (gen.ts:370-390), the LAST op writes the resume marker `{ generationIds: ids, spent: true }` (line 388). Add `spentUsd` to that SAME update so it rides the exact same atomic commit as `spent: true` — frozen exactly when money is committed:

Find (line 388):
```ts
      await tx.genJob.update({ where: { id: job.id }, data: { generationIds: ids, spent: true } });
```
Replace with:
```ts
      await tx.genJob.update({ where: { id: job.id }, data: { generationIds: ids, spent: true, spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) } });
```
This is the PRIMARY write: `spentUsd` is computed from the frozen job inputs and committed in the SAME tx as `generationIds`+`spent` (gen.ts's documented commit point). It cannot be skipped or duplicated relative to the marker — they are one update.

- [ ] **Step 3: Resume — DEFENSIVE backfill (only if marker present but spentUsd null)**

The resume branch (gen.ts:141-147) runs when `job.generationIds.length > 0` (outputs recorded on a prior delivery) and finishes via a DONE update (line 144). Add `spentUsd` to that DONE update ONLY when it is still null (an older row committed before this feature, or a partial write) — a defensive backfill, never a recompute of a value already frozen:

Find (line 144):
```ts
      await prisma.genJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "", spent: true } });
```
Replace with:
```ts
      await prisma.genJob.update({
        where: { id: job.id },
        data: {
          status: "DONE", progress: 100, finishedAt: new Date(), error: "", spent: true,
          // defensive backfill: a row committed before spentUsd existed (or a partial
          // write) has the marker but null spentUsd — reconstruct from the frozen job
          // inputs. Never overwrites a value the commit tx already froze.
          ...(job.spentUsd == null ? { spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) } : {}),
        },
      });
```
(`job` is the full row loaded at gen.ts:117 via `findUnique` — `job.spentUsd` is available after Task 1's client regen. The spread adds the key only when null, so a frozen value is never clobbered.)

- [ ] **Step 4: FAILED catch — record spend on the "paid but not delivered" path**

The catch's terminal branch (gen.ts:411-416) writes `spent: spent || charged` so "paid but not delivered" is auditable. Add `spentUsd` on the SAME branch ONLY when it is the spent/charged terminal failure (so a free pre-charge failure stays `spentUsd: null`):

Find (line 411-416):
```ts
    await prisma.genJob.update({
      where: { id: job.id },
      // a post-charge failure records spent=true so "paid but not delivered" is
      // auditable (the UI/ops can tell it apart from a free pre-charge failure)
      data: final ? { status: "FAILED", error: message, finishedAt: new Date(), spent: spent || charged } : { status: "QUEUED", error: message, progress: 0 },
    });
```
Replace the `data:` expression so the FAILED branch also freezes `spentUsd` when (and only when) `spent || charged`:
```ts
    await prisma.genJob.update({
      where: { id: job.id },
      // a post-charge failure records spent=true + spentUsd so "paid but not
      // delivered" is auditable (told apart from a free pre-charge failure, which
      // stays spent=false / spentUsd=null). The QUEUED requeue path records neither.
      data: final
        ? { status: "FAILED", error: message, finishedAt: new Date(), spent: spent || charged, ...((spent || charged) ? { spentUsd: genSpentUsd({ kind: job.kind, model: job.model, count: job.count, videoOptions: job.videoOptions as { seconds?: number; resolution?: string; audio?: boolean } | null }) } : {}) }
        : { status: "QUEUED", error: message, progress: 0 },
    });
```
(The `final` requeue path — `{ status: "QUEUED", … }` — is unchanged: a recoverable post-commit failure already wrote `spentUsd` in the commit tx (Step 2), and a pre-charge failure has not spent.)

- [ ] **Step 5: Confirm no spend-decision path now reads `spentUsd`**

```bash
grep -n "spentUsd" apps/worker/src/jobs/gen.ts
```
Expected: exactly 3 hits, all WRITES (the 3 `data:` objects above). NONE in any `where`, `if`, claim, or pre-provider condition. `spentUsd` is write-only in the worker.

- [ ] **Step 6: Typecheck the worker**

Run: `pnpm --filter @fikirtive/worker typecheck`
Expected: clean (confirms `spentUsd` is on the client + `genSpentUsd` resolves + the `job.videoOptions` cast typechecks). If the worker has no `typecheck` script, run `pnpm --filter @fikirtive/worker build`.

- [ ] **Step 7: Commit (leave for user approval)**

```bash
git add apps/worker/src/jobs/gen.ts
git commit -m "feat(opt6): worker freezes GenJob.spentUsd in the commit tx (record-only, same-tx)"
```

---

## Task 4: Worker — write `RefGenJob.spentUsd` (money-critical, NET-NEW marker)

**Highest-trust edit. RefGenJob has NO spend marker today — this adds `spentUsd` as the refgen spend marker (`spentUsd != null`). Re-read `apps/worker/src/jobs/refgen.ts` lines 44-231 before editing. Do not add a branch or reorder — attach `spentUsd` to the existing money-point writes.**

**Files:**
- Modify: `apps/worker/src/jobs/refgen.ts`

- [ ] **Step 1: Import the helper**

In the `@fikirtive/core` import block (refgen.ts:25-32), add `refgenSpentUsd`:

```ts
import {
  storageKey,
  newId,
  REFGEN_RETRY_LIMIT,
  MAX_CONDITIONING_IMAGES,
  refgenSpentUsd,
  type RefGenJobData,
  type RefGenModel,
} from "@fikirtive/core";
```

- [ ] **Step 2: PRIMARY write — in the same update that records the paid outputs**

After the paid call, the worker records outputs on the job at refgen.ts:207 (`{ outputAssetIds }`) — this is refgen's commit point ("the commit point past which a retry resumes instead of re-spending", refgen.ts:186-187). Add `spentUsd` to THAT update so the spend snapshot is committed with `outputAssetIds` (the resume marker):

Find (refgen.ts:207):
```ts
    await prisma.refGenJob.update({ where: { id: job.id }, data: { outputAssetIds } });
```
Replace with:
```ts
    // record outputs (the resume marker) AND the frozen spend in one update — past
    // here a retry resumes instead of re-spending, so spentUsd is committed exactly
    // when money is committed (refgenSpentUsd = REFGEN_PRICE_USD_PER_IMAGE * count).
    await prisma.refGenJob.update({ where: { id: job.id }, data: { outputAssetIds, spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) } });
```
This rides the existing `outputAssetIds` write — refgen's documented commit boundary — so `spentUsd` is recorded exactly once, with the resume marker.

- [ ] **Step 3: Resume — DEFENSIVE backfill (marker present, spentUsd null)**

The resume branch (refgen.ts:78-83) runs when `job.outputAssetIds.length > 0` (a prior delivery paid + stored) and finishes via `attachOutputs` + `finalizeDone`. Backfill `spentUsd` ONLY when it is still null (an older row, or a crash between the `outputAssetIds` write in Step 2 and DONE). Add a single guarded update BEFORE `finalizeDone` so it is part of the resume settle (not a re-spend — the paid call already happened on the prior delivery):

Find (refgen.ts:78-83):
```ts
    if (job.outputAssetIds.length > 0) {
      await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds, job.variantId);
      await finalizeDone(job.id, job.mode, job.entityId, job.outputAssetIds[0]);
      console.log(`[refgen] ${job.id}: resumed — re-attached ${job.outputAssetIds.length} prior outputs (no re-spend)`);
      return;
    }
```
Replace with:
```ts
    if (job.outputAssetIds.length > 0) {
      await attachOutputs(job.entityId, job.ownerId, job.outputAssetIds, job.variantId);
      // defensive backfill: a row that recorded outputs before spentUsd existed (or
      // crashed between the outputAssetIds write and DONE) has the marker but null
      // spentUsd — reconstruct from the frozen job inputs. No re-spend (paid already).
      if (job.spentUsd == null) {
        await prisma.refGenJob.update({ where: { id: job.id }, data: { spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) } });
      }
      await finalizeDone(job.id, job.mode, job.entityId, job.outputAssetIds[0]);
      console.log(`[refgen] ${job.id}: resumed — re-attached ${job.outputAssetIds.length} prior outputs (no re-spend)`);
      return;
    }
```
(`job` is the full row loaded at refgen.ts:45 via `findUnique` — `job.spentUsd` is available after Task 1.)

- [ ] **Step 4: FAILED catch — record spend on the "paid but not delivered" path (NET-NEW)**

refgen's catch (refgen.ts:213-229) currently persists NO spend marker on FAILED. Mirror gen.ts: when the terminal failure is `spent || charged` (paid but the post-paid store/attach threw), freeze `spentUsd` so "paid but not delivered" is auditable. The catch already computes `charged` (line 220) and `spent` is in scope (line 59). Add `spentUsd` to the FAILED branch ONLY when `spent || charged`:

Find (refgen.ts:223-228):
```ts
    await prisma.refGenJob.update({
      where: { id: job.id },
      data: final
        ? { status: "FAILED", error: message, finishedAt: new Date() }
        : { status: "QUEUED", error: message, progress: 0 },
    });
```
Replace with:
```ts
    await prisma.refGenJob.update({
      where: { id: job.id },
      // a post-charge failure records spentUsd so "paid but not delivered" is
      // auditable (a free pre-charge failure stays spentUsd=null). The QUEUED
      // requeue path records nothing (a recoverable pre-charge retry).
      data: final
        ? { status: "FAILED", error: message, finishedAt: new Date(), ...((spent || charged) ? { spentUsd: refgenSpentUsd({ model: job.model, count: job.count }) } : {}) }
        : { status: "QUEUED", error: message, progress: 0 },
    });
```
NOTE: `spentUsd != null` is now refgen's spend marker (the spec's recommendation — cleaner than adding a parallel `spent Boolean`; additive either way). We do NOT add `RefGenJob.spent Boolean`: `spentUsd != null` carries the same information and is what the cost view reads.

- [ ] **Step 5: Confirm no spend-decision path reads `spentUsd`**

```bash
grep -n "spentUsd" apps/worker/src/jobs/refgen.ts
```
Expected: exactly 3 hits — 2 unconditional/guarded writes (Steps 2, 3) + 1 conditional write (Step 4), plus the 1 read `job.spentUsd == null` (Step 3's backfill guard). The ONLY read is the null-check guarding a backfill — never a spend gate, claim, or pre-provider condition.

- [ ] **Step 6: Typecheck the worker**

Run: `pnpm --filter @fikirtive/worker typecheck` (or `pnpm --filter @fikirtive/worker build`)
Expected: clean.

- [ ] **Step 7: Commit (leave for user approval)**

```bash
git add apps/worker/src/jobs/refgen.ts
git commit -m "feat(opt6): worker freezes RefGenJob.spentUsd at the paid commit (record-only, net-new marker)"
```

---

## Task 5: DEFERRED DECISION — planner-token (text-LLM) USD cost (§0.2)

**This task BUILDS NOTHING. It records the decision the spec demands be explicit, and verifies the hook for a future pass already exists.**

- [ ] **Step 1: The decision (DEFER planner-token USD estimation)**

The spec §0.2 / §5 says: decide whether to persist a per-call USD estimate on the `cowork.turn` / `cowork.enhance` / `cowork.draft` ActionEvents, OR explicitly defer. **DECISION: DEFER.** Rationale:
- The transport (`CoworkTransport.chat`) returns no token counts, so any USD estimate would be a guess, not a measurement.
- Media spend — the dominant cost — is NOW ledgered via `spentUsd` (Tasks 3-4). Planner spend is $0 today (default `COWORK_PROVIDER=mock`) and small even on a paid provider.
- The hook for a future token-cost pass already exists: `coworkTurn` / `enhancePrompt` / `coworkDraftStoryboard` ALL already record `via: transport.name` on their ActionEvent payloads (cowork-actions.ts:120, 166, 427). A later pass can join cost to `via` without a schema change.

This is a STATED decision, not a silent gap. **Flag it for the user at the Codex/deploy gate** — if the team prefers to track planner spend now, that is a separate small task once Modal billing returns token counts.

- [ ] **Step 2: Verify the `via` hook is present (no edit — confirmation only)**

```bash
grep -n "type: \"cowork.turn\"\|type: \"cowork.enhance\"\|type: \"cowork.draft\"" apps/web/lib/cowork-actions.ts
grep -n "via: transport.name" apps/web/lib/cowork-actions.ts
```
Expected: all three `cowork.*` ActionEvents present, each payload carrying `via: transport.name`. If any is missing `via`, STOP — the deferral's premise (the hook exists) is false and the user must decide before proceeding. (Confirmed present at the time of writing: lines 120, 166, 427.)

No files change in this task.

---

## Task 6: `refgen.start` audit on the variant path (Codex M-c)

The paid variant path (`createVariant` / `regenerateVariant` → `dispatchVariantJob` → worker `handleRefGen`) emits NO `refgen.start` today — `createVariant` emits `variant.create`, `regenerateVariant` emits nothing, and `dispatchVariantJob` (which actually creates the paid `RefGenJob` + sends to the queue) emits nothing. The money-gate audit page (Task 8) would miss this paid path. Add one `refgen.start` in `dispatchVariantJob` so BOTH callers are covered at the single point where the paid job is dispatched.

**Files:**
- Modify: `apps/web/lib/refgen-actions.ts`

- [ ] **Step 1: Emit `refgen.start` in `dispatchVariantJob` after a successful dispatch**

In `dispatchVariantJob` (refgen-actions.ts:143-186), after the queue send succeeds (the `try`/`catch` block at lines 176-184 that updates `queueJobId`) and BEFORE `return { jobId: job.id }` (line 185), add an audit event mirroring `startRefGen`'s `refgen.start` (refgen-actions.ts:108-110):

Find (refgen.ts variant path, line 184-185):
```ts
    return { jobId: job.id };
  }
```
Replace with:
```ts
    // audit the paid variant path (M-c): createVariant/regenerateVariant dispatch a
    // real RefGenJob here but bypass startRefGen, so they emitted no refgen.start —
    // the money-gate audit would miss it. mode:"VARIANT" distinguishes it.
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "refgen.start", payload: { jobId: job.id, entityId, variantId, count: 1, mode: "VARIANT" } },
    });
    return { jobId: job.id };
  }
```
(`prisma`, `newId`, `FOUNDER_OWNER_ID` are already imported in this file — refgen-actions.ts:9, 12, 15. This is the LAST statement on the success path, after the row is created + queued, so a failed dispatch — which returns `{ error }` at line 183 — does not emit a spurious start.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @fikirtive/web typecheck`
Expected: clean.

- [ ] **Step 3: Confirm both variant callers now reach the audit**

```bash
grep -n "type: \"refgen.start\"" apps/web/lib/refgen-actions.ts
```
Expected: 2 hits — `startRefGen` (the base/refsheet path, line ~109) and the new one in `dispatchVariantJob` (shared by `createVariant` + `regenerateVariant`).

- [ ] **Step 4: Commit (leave for user approval)**

```bash
git add apps/web/lib/refgen-actions.ts
git commit -m "feat(opt6): emit refgen.start on the variant dispatch path (money-gate audit coverage)"
```

---

## Task 7: `/admin/cost` read-only spend view (§②)

A server page summing `spentUsd` over `GenJob` + `RefGenJob` — per-day totals + recent jobs with their `spentUsd` + counts. Read-only; it cannot widen spend (it issues only `findMany`/`groupBy` reads). Gated by auth+allowlist like the other `/admin` pages (P1b adds `requireRole(finance)`). Mirrors `ModelsAdmin`'s inline-style card pattern.

**Files:**
- Create: `apps/web/app/admin/cost/page.tsx`, `apps/web/components/admin/CostAdmin.tsx`

- [ ] **Step 1: Server page** (`apps/web/app/admin/cost/page.tsx`)

Mirror `apps/web/app/admin/models/page.tsx`: gate, read at request time, pass plain data to a client component.

```tsx
import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";
import { CostAdmin, type DayRow, type JobRow } from "@/components/admin/CostAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Cost · Fikirtive admin" };

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CostPage() {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login?from=/admin/cost");

  const since = new Date(Date.now() - 30 * DAY_MS);
  // RECORD-ONLY reads: spentUsd is never null-coalesced into a spend decision here.
  const [genJobs, refGenJobs] = await Promise.all([
    prisma.genJob.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, spentUsd: { not: null }, finishedAt: { gte: since } },
      select: { id: true, kind: true, model: true, count: true, status: true, spentUsd: true, finishedAt: true },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.refGenJob.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, spentUsd: { not: null }, finishedAt: { gte: since } },
      select: { id: true, mode: true, model: true, count: true, status: true, spentUsd: true, finishedAt: true },
      orderBy: { finishedAt: "desc" },
    }),
  ]);

  // unify into one job list (source tags the origin)
  const jobs: JobRow[] = [
    ...genJobs.map((j) => ({ id: j.id, source: "gen" as const, label: j.kind === "VIDEO" ? "video" : "image", model: j.model, count: j.count, status: j.status, spentUsd: j.spentUsd ?? 0, finishedAt: (j.finishedAt ?? new Date(0)).toISOString() })),
    ...refGenJobs.map((j) => ({ id: j.id, source: "refgen" as const, label: `ref:${j.mode.toLowerCase()}`, model: j.model, count: j.count, status: j.status, spentUsd: j.spentUsd ?? 0, finishedAt: (j.finishedAt ?? new Date(0)).toISOString() })),
  ].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  // per-day totals (UTC day key)
  const byDay = new Map<string, { day: string; usd: number; jobs: number }>();
  for (const j of jobs) {
    const day = j.finishedAt.slice(0, 10);
    const e = byDay.get(day) ?? { day, usd: 0, jobs: 0 };
    e.usd += j.spentUsd; e.jobs += 1;
    byDay.set(day, e);
  }
  const days: DayRow[] = Array.from(byDay.values()).sort((a, b) => b.day.localeCompare(a.day));

  const totalUsd = jobs.reduce((s, j) => s + j.spentUsd, 0);

  return <CostAdmin days={days} jobs={jobs.slice(0, 100)} totalUsd={totalUsd} jobCount={jobs.length} sinceDays={30} />;
}
```

NOTE on the day rollup: done in JS over the 30-day window (small N — founder-scale) rather than a raw `groupBy` on a date-truncated column, which Prisma can't express portably. If the window ever grows large, swap to `prisma.$queryRaw` with `date_trunc('day', "finishedAt")`; for now the JS rollup is simplest and matches the read-only, founder-scale intent. (`groupBy` would also work for the all-time total but the JS path already has the rows.)

- [ ] **Step 2: Client component** (`apps/web/components/admin/CostAdmin.tsx`)

Mirror `ModelsAdmin.tsx` styling exactly (inline styles, `var(--*)`). Read-only — NO action imports, NO mutations.

```tsx
"use client";
/**
 * OPT-6 P3a cost view (section ②). READ-ONLY: sums the record-only spentUsd
 * ledger (GenJob + RefGenJob) into per-day totals + a recent-job table. It
 * cannot widen spend — it renders the frozen snapshots the worker wrote.
 * Mirrors ModelsAdmin's inline-style card pattern.
 */
export type DayRow = { day: string; usd: number; jobs: number };
export type JobRow = {
  id: string; source: "gen" | "refgen"; label: string; model: string;
  count: number; status: string; spentUsd: number; finishedAt: string;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export function CostAdmin({ days, jobs, totalUsd, jobCount, sinceDays }: { days: DayRow[]; jobs: JobRow[]; totalUsd: number; jobCount: number; sinceDays: number }) {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Cost &amp; usage</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          Media spend over the last {sinceDays} days, from the per-job spend ledger the worker freezes when a paid call commits. Read-only — this view records cost, it never authorizes it.
        </p>
      </header>

      <section style={{ display: "flex", gap: 24, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>TOTAL</span>
          <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{usd(totalUsd)}</span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>PAID JOBS</span>
          <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{jobCount}</span>
        </div>
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Per day</h2>
        {days.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No spend recorded in this window.</p>}
        {days.map((d) => (
          <div key={d.day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-2)", minWidth: 110 }}>{d.day}</span>
            <span style={{ font: "var(--text-body)", color: "var(--fg-1)", minWidth: 80 }}>{usd(d.usd)}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>{d.jobs} job{d.jobs === 1 ? "" : "s"}</span>
          </div>
        ))}
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Recent jobs</h2>
        {jobs.map((j) => (
          <div key={`${j.source}:${j.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", minWidth: 90 }}>{j.label}</span>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", minWidth: 110 }}>{j.model}</span>
            <span style={{ font: "var(--text-caption)", color: j.status === "FAILED" ? "#e5484d" : "var(--fg-2)", minWidth: 80 }}>{j.status}</span>
            <span style={{ font: "var(--text-body)", color: "var(--fg-1)", minWidth: 70 }}>{usd(j.spentUsd)}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", marginLeft: "auto" }}>{j.finishedAt.slice(0, 16).replace("T", " ")}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build`
Expected: clean (confirms `spentUsd` is on the client select + the `var(--*)` styling matches existing components).

- [ ] **Step 4: Commit (leave for user approval)**

```bash
git add apps/web/app/admin/cost apps/web/components/admin/CostAdmin.tsx
git commit -m "feat(opt6): /admin/cost read-only spend view (per-day + recent jobs)"
```

---

## Task 8: `/admin/audit` read-only money-gate viewer (§③ slice)

A read-only viewer over the money-gate ActionEvent taxonomy — recent events, filterable by type via a URL search param. This is the money-gate audit (pulled forward from P4's content/audit section). Read-only: `findMany` only. Gated by auth+allowlist (P1b adds `requireRole(moderator)`).

**Files:**
- Create: `apps/web/app/admin/audit/page.tsx`, `apps/web/components/admin/AuditAdmin.tsx`

- [ ] **Step 1: Server page** (`apps/web/app/admin/audit/page.tsx`)

The money-gate types (all confirmed present in the codebase — see Task 0 / the taxonomy grep): `gen.start`, `gen.guardian-block`, `refgen.start`, `cowork.turn`, `cowork.enhance`, `cowork.draft`, `config.edit`, `model.toggle`, `directive.edit`. Read the optional `?type=` filter from `searchParams` (Next 16 — `searchParams` is a Promise; read `apps/web/node_modules/next/dist/docs/` if unsure of the exact API).

```tsx
import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";
import { AuditAdmin, type AuditRow } from "@/components/admin/AuditAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit · Fikirtive admin" };

// the money-gate taxonomy this viewer surfaces (the spend-relevant ActionEvent types)
const MONEY_GATE_TYPES = [
  "gen.start", "gen.guardian-block", "refgen.start",
  "cowork.turn", "cowork.enhance", "cowork.draft",
  "config.edit", "model.toggle", "directive.edit",
] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login?from=/admin/audit");

  const { type } = await searchParams;
  const active = type && (MONEY_GATE_TYPES as readonly string[]).includes(type) ? type : null;

  const events = await prisma.actionEvent.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, type: active ? active : { in: [...MONEY_GATE_TYPES] } },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: { id: true, type: true, projectId: true, payload: true, createdAt: true },
  });

  const rows: AuditRow[] = events.map((e) => ({
    id: e.id, type: e.type, projectId: e.projectId,
    payload: JSON.stringify(e.payload ?? {}), createdAt: e.createdAt.toISOString(),
  }));

  return <AuditAdmin rows={rows} types={[...MONEY_GATE_TYPES]} active={active} />;
}
```

- [ ] **Step 2: Client component** (`apps/web/components/admin/AuditAdmin.tsx`)

Read-only; the type filter navigates via plain links (`?type=…`) so no client mutation is needed. Mirror the inline-style pattern.

```tsx
"use client";
/**
 * OPT-6 P3a money-gate audit viewer (section ③ slice). READ-ONLY: lists recent
 * spend-relevant ActionEvents (gen/refgen starts, guardian blocks, cowork turns,
 * config/model/directive edits), filterable by type. It only reads the audit log.
 */
import Link from "next/link";

export type AuditRow = { id: string; type: string; projectId: string | null; payload: string; createdAt: string };

export function AuditAdmin({ rows, types, active }: { rows: AuditRow[]; types: string[]; active: string | null }) {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Audit</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          The money-gate trail: every spend-relevant action the system recorded. Read-only.
        </p>
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Link href="/admin/audit" style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: active ? "var(--bg-2)" : "var(--bg-3)", color: "var(--fg-1)", textDecoration: "none" }}>all</Link>
        {types.map((t) => (
          <Link key={t} href={`/admin/audit?type=${encodeURIComponent(t)}`}
            style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: active === t ? "var(--bg-3)" : "var(--bg-2)", color: "var(--fg-1)", textDecoration: "none" }}>
            {t}
          </Link>
        ))}
      </nav>

      <section style={{ display: "grid", gap: 6, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        {rows.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No events.</p>}
        {rows.map((r) => (
          <div key={r.id} style={{ display: "grid", gap: 2, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-1)", minWidth: 160 }}>{r.type}</span>
              <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", marginLeft: "auto" }}>{r.createdAt.slice(0, 19).replace("T", " ")}</span>
            </div>
            <code style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.payload}</code>
          </div>
        ))}
      </section>
    </main>
  );
}
```
(If `var(--bg-3)` is not defined in `globals.css`, substitute an existing variable — check the file; `var(--bg-2)` + `var(--line-1)` are confirmed used by ModelsAdmin.)

- [ ] **Step 3: Flip the two NAV slots live** (`apps/web/app/admin/layout.tsx`)

The shell's `NAV` array (layout.tsx:13-22) has "Cost & usage" and "Content & audit" as disabled placeholders. Make them live:

Find:
```ts
  { href: "#", label: "Cost & usage", live: false },
  { href: "#", label: "Content & audit", live: false },
```
Replace with:
```ts
  { href: "/admin/cost", label: "Cost & usage", live: true },
  { href: "/admin/audit", label: "Content & audit", live: true },
```
(Leave "Team & access" and "System & queue" as `live: false` — those are P1b / P3b.)

- [ ] **Step 4: Build + typecheck**

Run: `pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build`
Expected: clean. (Manual, optional: `pnpm --filter @fikirtive/web dev`, sign in, visit `/admin/cost` + `/admin/audit`, confirm both render in the shell with the NAV slots live and the type filter on /audit narrows the list.)

- [ ] **Step 5: Commit (leave for user approval)**

```bash
git add apps/web/app/admin/audit apps/web/components/admin/AuditAdmin.tsx apps/web/app/admin/layout.tsx
git commit -m "feat(opt6): /admin/audit read-only money-gate viewer + flip cost/audit NAV live"
```

---

## Task 9: Local $0 spend-snapshot verification

Prove — without spending — that a DONE GenJob/RefGenJob gets the correct `spentUsd` via the pure helper + the real write path. Mirrors `scripts/local-model-disable-verify.mjs`: import built `dist`, drive core + a raw prisma read/write, $0, no worker, clean up after.

**Files:**
- Create: `scripts/local-spend-snapshot-verify.mjs`

- [ ] **Step 1: Write the check**

```js
// LOCAL: a DONE GenJob/RefGenJob gets the correct record-only spentUsd via the pure
// helper + the real prisma write path. $0 — inserts fake rows + invokes genSpentUsd/
// refgenSpentUsd directly (NO provider, NO worker, NO queue). Proves the math + write.
// Run: node scripts/local-spend-snapshot-verify.mjs
process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../packages/db/dist/src/index.js");
const {
  newId, FOUNDER_OWNER_ID,
  genSpentUsd, refgenSpentUsd,
  GEN_PRICE_USD_PER_IMAGE, REFGEN_PRICE_USD_PER_IMAGE, videoPriceUsd, videoDefaults,
} = await import("../packages/core/dist/index.js");

const fail = (m) => { throw new Error(m); };
const created = { genJobs: [], refGenJobs: [], projects: [], entities: [] };

try {
  const project = await prisma.project.create({ data: { id: newId(), name: "spend snapshot verify" } });
  created.projects.push(project.id);
  const entity = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "spend verify entity" } });
  created.entities.push(entity.id);

  // 1. IMAGE GenJob — expect GEN_PRICE_USD_PER_IMAGE * count
  const imgExpected = GEN_PRICE_USD_PER_IMAGE * 4;
  if (genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }) !== imgExpected) fail("image helper math");
  const imgJob = await prisma.genJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", kind: "IMAGE", model: "seedream", count: 4, status: "DONE",
    spent: true, spentUsd: genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }),
  }, select: { id: true, spentUsd: true } });
  created.genJobs.push(imgJob.id);
  if (imgJob.spentUsd !== imgExpected) fail(`image GenJob.spentUsd persisted ${imgJob.spentUsd}, want ${imgExpected}`);
  console.log(`✓ image GenJob.spentUsd = ${imgJob.spentUsd} (GEN_PRICE × 4)`);

  // 2. VIDEO GenJob — expect videoPriceUsd over the job's options
  const vo = { seconds: 5, resolution: "1080p", audio: true };
  const vidExpected = videoPriceUsd("veo3.1-fast", { seconds: 5, resolution: "1080p", audio: true, count: 1 });
  if (genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }) !== vidExpected) fail("video helper math");
  const vidJob = await prisma.genJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo, status: "DONE",
    spent: true, spentUsd: genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }),
  }, select: { id: true, spentUsd: true } });
  created.genJobs.push(vidJob.id);
  if (vidJob.spentUsd !== vidExpected) fail(`video GenJob.spentUsd persisted ${vidJob.spentUsd}, want ${vidExpected}`);
  console.log(`✓ video GenJob.spentUsd = ${vidJob.spentUsd} (videoPriceUsd)`);

  // 3. VIDEO with null videoOptions — must fall back to defaults, never NaN/null
  const fbExpected = videoPriceUsd("kling", { ...videoDefaults("kling"), count: 1 });
  const fbJob = await prisma.genJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", kind: "VIDEO", model: "kling", count: 1, status: "DONE",
    spent: true, spentUsd: genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: null }),
  }, select: { id: true, spentUsd: true } });
  created.genJobs.push(fbJob.id);
  if (fbJob.spentUsd !== fbExpected || !Number.isFinite(fbJob.spentUsd)) fail(`video-fallback spentUsd ${fbJob.spentUsd}, want ${fbExpected}`);
  console.log(`✓ video GenJob (null options) → defaults = ${fbJob.spentUsd}`);

  // 4. RefGenJob — expect REFGEN_PRICE_USD_PER_IMAGE * count (its OWN constant)
  const refExpected = REFGEN_PRICE_USD_PER_IMAGE * 3;
  if (refgenSpentUsd({ model: "seedream", count: 3 }) !== refExpected) fail("refgen helper math");
  const refJob = await prisma.refGenJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, entityId: entity.id, prompt: "x", model: "seedream", count: 3, mode: "REFSHEET", status: "DONE",
    outputAssetIds: [newId(), newId(), newId()], spentUsd: refgenSpentUsd({ model: "seedream", count: 3 }),
  }, select: { id: true, spentUsd: true } });
  created.refGenJobs.push(refJob.id);
  if (refJob.spentUsd !== refExpected) fail(`RefGenJob.spentUsd persisted ${refJob.spentUsd}, want ${refExpected}`);
  console.log(`✓ RefGenJob.spentUsd = ${refJob.spentUsd} (REFGEN_PRICE × 3)`);

  // 5. the cost view's read sums them (record-only aggregation)
  const sum = (await prisma.genJob.aggregate({ where: { id: { in: created.genJobs } }, _sum: { spentUsd: true } }))._sum.spentUsd ?? 0;
  const refSum = (await prisma.refGenJob.aggregate({ where: { id: { in: created.refGenJobs } }, _sum: { spentUsd: true } }))._sum.spentUsd ?? 0;
  const want = imgExpected + vidExpected + fbExpected + refExpected;
  if (Math.abs((sum + refSum) - want) > 1e-9) fail(`aggregate ${sum + refSum} != ${want}`);
  console.log(`✓ cost-view aggregate = ${(sum + refSum).toFixed(4)} (the per-day/total sum the page reads)`);

  console.log("\n✓ spend snapshot: helper math + persisted spentUsd + aggregate all correct ($0, no provider)");
} finally {
  for (const id of created.genJobs) await prisma.genJob.delete({ where: { id } }).catch(() => {});
  for (const id of created.refGenJobs) await prisma.refGenJob.delete({ where: { id } }).catch(() => {});
  for (const id of created.entities) await prisma.entity.delete({ where: { id } }).catch(() => {});
  for (const id of created.projects) await prisma.project.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
```

- [ ] **Step 2: Run it** (kill stale workers first, $0)

```bash
pkill -f 'apps/worker' 2>/dev/null || true
node scripts/local-spend-snapshot-verify.mjs
```
Expected:
```
✓ image GenJob.spentUsd = 0.16 (GEN_PRICE × 4)
✓ video GenJob.spentUsd = … (videoPriceUsd)
✓ video GenJob (null options) → defaults = …
✓ RefGenJob.spentUsd = 0.12 (REFGEN_PRICE × 3)
✓ cost-view aggregate = … (the per-day/total sum the page reads)

✓ spend snapshot: helper math + persisted spentUsd + aggregate all correct ($0, no provider)
```

- [ ] **Step 3: Commit (leave for user approval)**

```bash
git add scripts/local-spend-snapshot-verify.mjs
git commit -m "test(opt6): local $0 spend-snapshot verify (helper math + write + aggregate)"
```

---

## Task 10: Full local gate + STOP for Codex

- [ ] **Step 1: Run the whole local gate**

```bash
pkill -f 'apps/worker' 2>/dev/null || true
pnpm --filter @fikirtive/core test
pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build
pnpm --filter @fikirtive/worker typecheck   # or: pnpm --filter @fikirtive/worker build
pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" \
  pnpm --filter @fikirtive/db exec prisma migrate status
node scripts/local-spend-snapshot-verify.mjs
# regression: the money-safety invariants P1a/P2 already guard still hold
node scripts/verify-auth-guards.mjs
DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" GENERATION_PROVIDER=mock node scripts/verify-cowork-turn.mjs
node scripts/local-model-disable-verify.mjs
```
Expected: all green — core tests pass (incl. the new `spend` tests), every build/typecheck clean, `migrate status` up to date, the spend-snapshot verify passes ($0), and the P1a auth-guard + cowork-turn ($0/no GenJob) + model-disable regressions still hold.

- [ ] **Step 2: Confirm `spentUsd` never appears in a spend decision (final money-safety grep)**

```bash
grep -rn "spentUsd" apps/worker/src apps/web/lib
```
Expected: WRITES only (worker gen.ts/refgen.ts `data:` objects + the one refgen backfill null-guard read). NO `spentUsd` in any `where`/`if`/claim that precedes a `provider.generate*` call, and NONE in `apps/web/lib` (the cost read lives in the page, not an action). If any spend path reads `spentUsd`, STOP — that violates record-only.

- [ ] **Step 3: STOP — Codex money-safety gate**

Do NOT deploy. Hand the diff to `/codex` for the money-safety review. Focus points to call out:
1. **The worker `spentUsd` writes ride the SAME tx/update as the existing spend marker** — gen.ts commit tx (`generationIds`+`spent`+`spentUsd` in one `tx.genJob.update`), gen.ts resume/FAILED backfills (guarded, never clobber a frozen value), refgen.ts paid-record (`outputAssetIds`+`spentUsd` in one update), refgen.ts resume/FAILED. No new branch, no split commit, no path that could skip or duplicate a spend.
2. **`spentUsd` is record-only** — the Step 2 grep proves no spend path reads it.
3. **The migration is additive-nullable** and ships BEFORE the worker build (Task 1 before Tasks 3-4 in deploy order).
4. **The deferred planner-token decision** (Task 5) — confirm the team accepts deferring text-LLM USD estimation, given the `via` hook is in place and media spend is now ledgered.
5. The `/admin/cost` + `/admin/audit` pages are read-only (only `findMany`/`aggregate`).

Only after Codex PASS + explicit user authorization, deploy in this ORDER:
- (a) prod migration FIRST: `migrate:deploy` the `20260617140000_spend_ledger` migration against prod (cloud.env, localhost-guard, `migrate status` first) — additive-nullable, safe on the live DB.
- (b) THEN `railway up --service worker` (the worker now writes the columns the migration added).
- (c) THEN `railway up --service web` (the cost/audit pages + the variant `refgen.start`).
The reverse order (worker before migration) would only ERROR the worker write (`column does not exist`) — no data loss, no spend impact — but ship the migration first regardless.

---

## Self-Review (run before handing off)

**1. Spec coverage (P3a section §5 + §6 P3a row + §7 ledger):**
- `GenJob.spentUsd Float?` additive, worker-written in the commit tx (frozen like `Generation.entitySnapshot`) → Task 1 (column) + Task 3 (commit tx PRIMARY write, resume defensive backfill, spent||charged FAILED path). Snapshot = `videoPriceUsd` video / `GEN_PRICE_USD_PER_IMAGE * count` image → Task 2 `genSpentUsd`. ✓
- `RefGenJob.spentUsd Float?` NET-NEW (no `spent` column today; FAILED persisted no marker) → Task 1 (column) + Task 4 (paid-record PRIMARY, resume backfill, spent||charged FAILED — net-new). Snapshot = `REFGEN_PRICE_USD_PER_IMAGE * count` (its OWN constant) → Task 2 `refgenSpentUsd`. `spentUsd != null` is the refgen spend marker (no parallel `spent Boolean` — cleaner, spec-sanctioned). ✓
- Migration ordering (deploy before worker build; reverse only errors the write) → House rules + Task 10 deploy order. ✓
- Planner-token cost (§0.2) → Task 5: DEFERRED with the stated rationale + verified `via` hook; flagged for the user at the Codex gate. ✓
- `refgen.start` on the variant path (M-c) → Task 6 (`dispatchVariantJob`, covers create + regenerate). ✓
- `/admin/cost` read-only (per-day + recent + counts, can't widen spend) → Task 7. ✓
- `/admin/audit` read-only money-gate viewer over the taxonomy (gen.start, gen.guardian-block, refgen.start, cowork.turn/enhance/draft, config.edit, model.toggle, directive.edit), type-filterable → Task 8 + NAV flip. ✓
- LOCAL $0 verification a DONE Gen/RefGen job gets a spentUsd snapshot via the helper + write path, no provider → Task 9. ✓
- §7 ledger test: spentUsd in all charged paths for gen (commit tx) + refgen (3 points) + variant audit; REFGEN_PRICE for refgen vs videoPriceUsd/GEN_PRICE for gen; historical cost frozen → Tasks 2 (TDD), 3, 4, 9. ✓

**2. Placeholder scan:** no "TBD / similar to above / handle edge cases". Every worker edit gives the exact find/replace string relative to the existing spent-marker write; every page gives full source; the migration SQL is concrete; the verify script is complete with expected output. ✓

**3. Type consistency:** `genSpentUsd`/`refgenSpentUsd` + `GenSpendInput`/`RefGenSpendInput` used identically across Task 2 (def), Tasks 3-4 (worker calls with the `job.videoOptions as {…}` cast), Task 9 (script). `spentUsd` is `Float?` (TS `number | null`) everywhere; the cost page coalesces `?? 0` only for display, never for a decision. `DayRow`/`JobRow`/`AuditRow` exported from their components and imported by their pages. The video fallback in `genSpentUsd` mirrors the worker's own `vo?.seconds ?? videoDefaults(...)` at gen.ts:348 so a null-`videoOptions` row never yields NaN. ✓

**4. Money-safety self-check:** the ONLY worker delta is adding `spentUsd:` to `data:{}` objects the worker already writes (commit tx / resume DONE / FAILED catch for gen; paid-record / resume / FAILED for refgen) — no new write, branch, await, or reorder; the exactly-once claim, resume short-circuit, stale-GENERATING fail-closed, and `spent||charged` terminal logic are byte-for-byte preserved. `spentUsd` is never read before a paid call (Task 10 Step 2 grep enforces it). ✓

**Open caveat for the implementer:** the working tree already contains P1a + P2 (RuntimeConfig, ModelRegistryOverlay, the disable chokepoints + `workerDisabledModels`/`resolveDisabledModels`, /admin shell + Settings/Models/Knowledge/Directives) as UNCOMMITTED changes. P3a builds directly on them — do NOT re-create those symbols. The two NEW columns + two NEW pages + two worker-write edits + one audit line are purely additive on top.
