# FIKIRTIVE v1 — Otto backend/wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design-independent backend/wiring for FIKIRTIVE's first ship — the parts the Otto front door (designed separately in Claude Design) plugs into: a concurrency-safe agent state, a context seam so Otto can see the brand + the user's reusable entities, an editable brand-memory store, goal-intent seeding, a plain-language Otto voice, and the additive data columns the future agency layer needs.

**Architecture:** Otto is an `@openai/agents` agent (`packages/otto`). The live web path is `ottoTurn`/`ottoApprove` in `apps/web/lib/otto-actions.ts`, which runs the agent, meters LLM cost via `withLlmBudget`, and persists `RunState` to `ChatThread.ottoState`. Heavy generation is async (the `generate` tool → `ctx.startGen` → a `GenJob` the worker processes). This plan changes only the agent-orchestration + data layers; it does NOT touch the money path (`startGen`, `withLlmBudget`, reserve→settle) or build any UI.

**Tech Stack:** TypeScript monorepo (pnpm). Next.js (App Router, non-standard — see Global Constraints). Prisma 7 + Postgres. `@openai/agents`. Vitest for unit tests.

## Global Constraints

(Every task implicitly includes these.)

- **Non-standard Next.js:** `apps/web/AGENTS.md` — APIs differ from training data. Before writing any route/layout code, read the relevant guide in `apps/web/node_modules/next/dist/docs/`. (This plan touches almost no routes; it's `lib/` + `packages/`.)
- **Money path is untouched.** Do not modify `startGen` (`apps/web/lib/gen-actions.ts`), `withLlmBudget`, or `packages/db/src/credits.ts`. Otto's `generate` tool and the `needsApproval`→`ottoApprove` loop stay as-is.
- **Owner-scoped + fail-closed.** Every new query/action on a tenant model carries an `ownerId` filter; every new server action starts with `const gate = await requireOwner(); if ("error" in gate) return gate;` and returns the `{ error: string }` contract on failure (mirror `setCoworkBrief`, `cowork-actions.ts:692`).
- **Migrations are additive only** — new tables + nullable columns, no backfill, no constraint that locks a populated table. New nullable scope columns are plain nullable `String?` (soft refs, no FK) for now.
- **TDD + frequent commits.** One test cycle per step. Match the existing vitest harness in `apps/web/lib/__tests__/otto-actions.test.ts` (vi.hoisted mocks of prisma/`run`/`RunState`/`requireOwner`/`withLlmBudget`; no real DB).
- **No fake data, no jargon to the user** (see Task 6).

---

## File Structure

- `apps/web/lib/otto-actions.ts` — MODIFY: CAS on the web `ottoState` writes (Task 1); call the context seam in `buildOttoContext` (Task 4); pass `goalKey`/`simpleMode` through (Tasks 5,6).
- `packages/otto/src/context.ts` — MODIFY: extend `OttoContext` with `brandContext?`, `availableRefs?`, `simpleMode?` (Tasks 4,6).
- `packages/otto/src/instructions.ts` — MODIFY: add an exported Simple-mode instruction block (Task 6).
- `packages/otto/src/otto.ts` / run assembly in `otto-actions.ts` — MODIFY: inject brand/refs/voice as a system message at run assembly (Tasks 4,6).
- `packages/db/prisma/schema.prisma` — MODIFY: `Memory` + `GenerationBatch` models; nullable scope columns (Task 2).
- `packages/db/prisma/migrations/<ts>_v1_additive/migration.sql` — CREATE (Task 2).
- `packages/db/src/tenant-guard.ts` — MODIFY: add `Memory`, `GenerationBatch` to `TENANT_MODELS` (Task 2).
- `apps/web/lib/memory-actions.ts` — CREATE: `listMemory`/`addMemory`/`updateMemory`/`deleteMemory` + `getBrandContextText` (Task 3).
- `packages/core/src/goals.ts` (or nearest core module) — CREATE: `GOAL_PRESETS` + `goalKey` schema field (Task 5).
- Tests alongside each (`apps/web/lib/__tests__/…`, `packages/*/src/*.test.ts`).

---

### Task 1: Concurrency-safe `ottoState` writes (CAS) on the web path

The worker already does compare-and-swap on `ottoState` (`apps/worker/src/otto-resume.ts:133-140,161-168`); the web path does blind `chatThread.update(...)` at `otto-actions.ts:291-294`, `303-319`, and `462-465`. A double-click approve / two tabs → last-writer-wins corrupts the serialized run. Fix: mirror the worker's `updateMany({ where: { …, ottoState: prior } })` + `count===0` guard, threading the `priorOttoState` already loaded at `:136` / re-read in approve.

**Files:**
- Modify: `apps/web/lib/otto-actions.ts` (the three update sites; `ottoTurn` already has `priorOttoState` at `:136`; `ottoApprove` loads `thread.ottoState` at `:367` — capture it as `priorOttoState` before `RunState.fromString`).
- Test: `apps/web/lib/__tests__/otto-actions.test.ts` (add a `mockChatThreadUpdateMany` to the hoisted block + the prisma mock).

**Interfaces:**
- Consumes: existing `priorOttoState: string | null` (ottoTurn) / `thread.ottoState` (ottoApprove); `prisma.chatThread.updateMany`.
- Produces: the `ottoTurn`/`ottoApprove` results gain a graceful `{ ... status: "stale" }` branch (extend the return unions with `{ threadId: string; status: "stale" }` for ottoTurn and `{ ok: true; status: "stale" }` for ottoApprove) — the client shows "this conversation moved on, refresh."

- [ ] **Step 1: Write the failing test** (CAS miss → stale, no message written)

```ts
// in otto-actions.test.ts, after the existing ottoTurn tests
it("ottoTurn returns 'stale' when ottoState moved on (CAS miss)", async () => {
  mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
  mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1" });
  mockChatThreadFindFirst.mockResolvedValue({ projectId: "p1", ottoState: '{"prior":"x"}' });
  mockChatMessageFindFirst.mockResolvedValue({ seq: 2 });
  mockRunStateFromString.mockResolvedValue(new MockRunState([{ role: "user", content: "hi" }]));
  mockRun.mockResolvedValue({ state: new MockRunState(), newItems: [], finalOutput: "ok", interruptions: [] });
  mockChatThreadUpdateMany.mockResolvedValue({ count: 0 }); // someone else wrote first
  const res = await ottoTurn({ threadId: "t1", projectId: "p1", text: "hi", entityIds: [], variantSel: {} });
  expect(res).toEqual({ threadId: "t1", status: "stale" });
  expect(mockChatMessageCreate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "AGENT", kind: "TEXT" }) }));
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts -t "CAS miss"`
Expected: FAIL (`mockChatThreadUpdateMany` undefined / status not "stale").

- [ ] **Step 3: Add the mock** to the `vi.hoisted` block and the prisma `chatThread` mock

```ts
// in vi.hoisted return: add
mockChatThreadUpdateMany: vi.fn(),
// in the @fikirtive/db vi.mock prisma.chatThread object: add
updateMany: mockChatThreadUpdateMany,
// in beforeEach default:
mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
```

- [ ] **Step 4: Implement CAS at the completed-persist site** (`otto-actions.ts:303-319`)

Replace the blind `$transaction([chatThread.update(...), chatMessage.create(...)])` with a CAS update first, then the message only on a win:

```ts
const { count } = await prisma.chatThread.updateMany({
  where: { id: threadId, ownerId, ottoState: priorOttoState },
  data: { ottoState: newOttoState, updatedAt: new Date() },
});
if (count === 0) { revalidatePath("/", "layout"); return { threadId, status: "stale" }; }
await prisma.chatMessage.create({
  data: { id: newId(), threadId, ownerId, role: "AGENT", kind: "TEXT", seq: ++seq, text: replyText },
});
```
Apply the same `updateMany` + `count===0 → stale` guard to the interruption-persist site (`:291`) and the `ottoApprove` persist sites (`:462`, and the final completed-persist in ottoApprove). In `ottoApprove`, capture `const priorOttoState = thread.ottoState;` right after the `findFirst` (`:367`) before `RunState.fromString`. (Note for `priorOttoState === null` on a brand-new thread: keep the existing create path; CAS only applies when resuming a prior state.)

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts`
Expected: PASS (new test + existing suite green).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/otto-actions.ts apps/web/lib/__tests__/otto-actions.test.ts
git commit -m "fix(otto): CAS guard on web ottoState writes (no last-writer-wins corruption)"
```

---

### Task 2: Additive migration — `Memory` + `GenerationBatch` + nullable scope columns

Adds the brand-memory store, the ad-pack grouping table, and the nullable scope columns the future agency layer needs (added now to avoid an ALTER on populated hot tables later). All additive; money path untouched. The agency-tier tables (Client/Brand/Campaign/BrandKit) are deferred — only their soft-ref columns are reserved now.

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (mirror existing model/index conventions: `id String @id`, `ownerId String`, `deletedAt DateTime?`, `@@index([ownerId, deletedAt])`).
- Create: a migration via the db package's migrate script.
- Modify: `packages/db/src/tenant-guard.ts` (`TENANT_MODELS`).
- Test: `packages/db/src/__tests__/tenant-guard.test.ts` (or wherever the guard test lives — match it; if none, create one).

**Interfaces:**
- Produces: model `Memory { id, ownerId, brandId String?, category String, content String, source String /* 'otto'|'user' */, pinned Boolean @default(false), createdAt, updatedAt, deletedAt }`; model `GenerationBatch { id, ownerId, projectId String?, name String, status String @default("active"), createdAt, updatedAt, deletedAt }`; nullable columns `Project.brandId/campaignId`, `Asset.brandId`, `GenJob.batchId`, `Generation.batchId`, `CreditLedger.brandId`, `Entity.brandId`, `ReferenceImage.brandId` (all `String?`).

- [ ] **Step 1: Write the failing test** (guard recognizes the new owner-scoped models)

```ts
import { describe, it, expect } from "vitest";
// import the TENANT_MODELS check indirectly: a findMany on Memory without ownerId must throw under test
import { prisma } from "@fikirtive/db";
it("tenant guard flags Memory.findMany without ownerId", async () => {
  await expect(prisma.memory.findMany({ where: {} as never })).rejects.toThrow(/tenant-guard/);
});
```
(If the guard suite uses a different harness, match it; the assertion is: `Memory` and `GenerationBatch` are in `TENANT_MODELS`.)

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @fikirtive/db exec vitest run -t "tenant guard flags Memory"`
Expected: FAIL (`prisma.memory` doesn't exist / not guarded).

- [ ] **Step 3: Add the models + columns to `schema.prisma`**

```prisma
model Memory {
  id        String   @id
  ownerId   String
  brandId   String?
  category  String
  content   String
  source    String   // 'otto' | 'user'
  pinned    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([ownerId, brandId, deletedAt])
}

model GenerationBatch {
  id        String   @id
  ownerId   String
  projectId String?
  name      String
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([ownerId, projectId, deletedAt])
}
```
Add nullable columns to existing models: `brandId String?` + `campaignId String?` on `Project`; `brandId String?` on `Asset`, `Entity`, `ReferenceImage`; `batchId String?` on `GenJob` and `Generation`; `brandId String?` on `CreditLedger`. (No FK, no default, no backfill.)

- [ ] **Step 4: Add to the tenant guard** (`tenant-guard.ts:7-11`)

```ts
const TENANT_MODELS = new Set([
  "Project", "Entity", "EntityVariant", "ReferenceImage", "Asset", "Shot", "ShotEntityRef",
  "Generation", "RenderJob", "GenJob", "RefGenJob", "ChatThread", "ChatMessage",
  "CaptionJob", "Transcript",
  "Memory", "GenerationBatch", // v1 additive
]);
```

- [ ] **Step 5: Generate + apply the migration, run tests**

```bash
pnpm --filter @fikirtive/db migrate:dev --name v1_additive   # creates migration.sql (additive)
pnpm db:generate
pnpm --filter @fikirtive/db exec vitest run
```
Expected: migration applies cleanly (new tables + nullable columns, no lock/backfill); guard test PASS. Verify the generated `migration.sql` contains only `CREATE TABLE` + `ALTER TABLE … ADD COLUMN … NULL` (no `NOT NULL`, no data migration).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/tenant-guard.ts packages/db/src
git commit -m "feat(db): additive v1 schema — Memory, GenerationBatch, nullable brand/batch scope columns"
```

---

### Task 3: Brand-memory backend (notes — NO retrieval, NO URL fetch)

The store + server actions + a `getBrandContextText` that compiles memory into the string Task 4 injects into Otto. Mirrors `setCoworkBrief` exactly (`cowork-actions.ts:692`). The memory PAGE is designed separately in Claude Design; this is its backend.

**Files:**
- Create: `apps/web/lib/memory-actions.ts`.
- Test: `apps/web/lib/__tests__/memory-actions.test.ts`.

**Interfaces:**
- Consumes: `requireOwner` (`./auth-guard`), `prisma` (`@fikirtive/db`), `newId` (`@fikirtive/core`), the `Memory` model (Task 2).
- Produces:
  - `listMemory(ownerId: string, brandId?: string | null): Promise<MemoryRow[]>` where `MemoryRow = { id; category; content; source: "otto"|"user"; pinned; updatedAt }`.
  - `addMemory(raw): Promise<{ ok: true; id: string } | { error: string }>` (fields: category, content, brandId?).
  - `updateMemory(raw): Promise<{ ok: true } | { error: string }>` (id, content, pinned?).
  - `deleteMemory(raw): Promise<{ ok: true } | { error: string }>` (id).
  - `getBrandContextText(ownerId: string, brandId?: string | null): Promise<string>` — compiles non-deleted memory into a compact, grouped plain-text block (empty string when none).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const { mockRequireOwner, mockMemoryCreate, mockMemoryFindMany } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(), mockMemoryCreate: vi.fn(), mockMemoryFindMany: vi.fn(),
}));
vi.mock("../auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({ prisma: { memory: { create: mockMemoryCreate, findMany: mockMemoryFindMany } } }));
vi.mock("@fikirtive/core", () => ({ newId: () => "m_1" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { addMemory, getBrandContextText } from "../memory-actions";

beforeEach(() => { vi.clearAllMocks(); mockRequireOwner.mockResolvedValue({ ownerId: "o1" }); });

it("addMemory persists owner-scoped with source 'user'", async () => {
  mockMemoryCreate.mockResolvedValue({ id: "m_1" });
  const res = await addMemory({ category: "voice", content: "warm, family tone" });
  expect(res).toEqual({ ok: true, id: "m_1" });
  expect(mockMemoryCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: "o1", category: "voice", content: "warm, family tone", source: "user" }) });
});

it("getBrandContextText compiles grouped notes (empty when none)", async () => {
  mockMemoryFindMany.mockResolvedValue([]);
  expect(await getBrandContextText("o1", null)).toBe("");
  mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "warm" }]);
  expect(await getBrandContextText("o1", null)).toContain("warm");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/memory-actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `memory-actions.ts`** (mirror `setCoworkBrief`)

```ts
"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";

export type MemoryRow = { id: string; category: string; content: string; source: "otto" | "user"; pinned: boolean; updatedAt: Date };

export async function listMemory(ownerId: string, brandId?: string | null): Promise<MemoryRow[]> {
  const rows = await prisma.memory.findMany({
    where: { ownerId, brandId: brandId ?? null, deletedAt: null },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    select: { id: true, category: true, content: true, source: true, pinned: true, updatedAt: true },
  });
  return rows as MemoryRow[];
}

export async function addMemory(raw: unknown): Promise<{ ok: true; id: string } | { error: string }> {
  const r = raw as { category?: unknown; content?: unknown; brandId?: unknown };
  const category = typeof r?.category === "string" ? r.category.trim() : "";
  const content = typeof r?.content === "string" ? r.content.trim() : "";
  if (!category || !content) return { error: "A memory needs a category and some text." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const id = newId();
  try {
    await prisma.memory.create({ data: { id, ownerId: gate.ownerId, brandId: typeof r.brandId === "string" ? r.brandId : null, category: category.slice(0, 60), content: content.slice(0, 2000), source: "user", pinned: true } });
  } catch { return { error: "Couldn't save that — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true, id };
}

export async function updateMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown; content?: unknown; pinned?: unknown };
  if (typeof r?.id !== "string" || typeof r?.content !== "string") return { error: "Invalid memory edit." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  try {
    const { count } = await prisma.memory.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      data: { content: r.content.trim().slice(0, 2000), pinned: typeof r.pinned === "boolean" ? r.pinned : undefined, source: "user" },
    });
    if (!count) return { error: "Memory not found." };
  } catch { return { error: "Couldn't save that — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  try {
    const { count } = await prisma.memory.updateMany({ where: { id: r.id, ownerId: gate.ownerId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!count) return { error: "Memory not found." };
  } catch { return { error: "Couldn't delete — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Compile this owner/brand's memory into a compact plain-text block for Otto's context. */
export async function getBrandContextText(ownerId: string, brandId?: string | null): Promise<string> {
  const rows = await prisma.memory.findMany({
    where: { ownerId, brandId: brandId ?? null, deletedAt: null },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    select: { category: true, content: true },
    take: 100,
  });
  if (!rows.length) return "";
  const byCat = new Map<string, string[]>();
  for (const r of rows) (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r.content);
  return [...byCat.entries()].map(([cat, items]) => `${cat}: ${items.join("; ")}`).join("\n").slice(0, 3000);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/memory-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/memory-actions.ts apps/web/lib/__tests__/memory-actions.test.ts
git commit -m "feat(memory): editable brand-memory notes store + getBrandContextText (no retrieval/fetch)"
```

---

### Task 4: Dynamic-context-injection seam — Otto sees the brand + reusable entities

Today `buildOttoContext` (`otto-actions.ts:61-82`) carries only ids + `startGen`, and run assembly (`:182-189`) replays history + the user text — so the agent can't see the brand or the user's @mention entities. (The legacy planner `coworkTurn` loads refs via `loadAvailableRefs`, `cowork-actions.ts:58`, but the agent path doesn't.) Add `brandContext` + `availableRefs` to `OttoContext`, populate them in `buildOttoContext`, and inject them as a system message at run assembly.

**Files:**
- Modify: `packages/otto/src/context.ts` (extend the interface).
- Modify: `apps/web/lib/otto-actions.ts` (`buildOttoContext` populates the new fields; run assembly prepends an injected system message).
- Test: `apps/web/lib/__tests__/otto-actions.test.ts` (assert the run input includes the injected context).

**Interfaces:**
- Consumes: `getBrandContextText` (Task 3); a refs loader (extract/reuse `loadAvailableRefs` shape from `cowork-actions.ts:58` → `{ id; name; type }[]`).
- Produces: `OttoContext` gains `brandContext?: string` and `availableRefs?: { id: string; name: string; type: string }[]`; `buildOttoContext` accepts no new required args (it derives them from `ownerId`/`projectId`); run assembly emits a leading `{ role: "system", content }` item built from these.

- [ ] **Step 1: Write the failing test** (injected context reaches the run input)

```ts
it("ottoTurn injects brand context + refs as a system message", async () => {
  mockRequireOwner.mockResolvedValue({ ownerId: "o1" });
  mockProjectFindFirst.mockResolvedValue({ id: "p1", ownerId: "o1", coworkBrief: null });
  mockEntityFindMany.mockResolvedValue([{ id: "e1", name: "CocoCandy", type: "PRODUCT", variants: [], descriptionJson: null }]);
  mockMemoryFindMany.mockResolvedValue([{ category: "voice", content: "warm, family tone" }]);
  mockRun.mockResolvedValue({ state: new MockRunState(), newItems: [], finalOutput: "ok", interruptions: [] });
  mockChatThreadUpdateMany.mockResolvedValue({ count: 1 });
  await ottoTurn({ projectId: "p1", text: "make an ad", entityIds: [], variantSel: {} }); // new thread
  const runInput = mockRun.mock.calls[0][1]; // 2nd arg to run(otto, input, opts)
  const sys = (runInput as any[]).find((m) => m.role === "system");
  expect(sys.content).toContain("warm, family tone");
  expect(sys.content).toContain("CocoCandy");
});
```
(Add `mockEntityFindMany`, `mockMemoryFindMany` to the hoisted block + prisma mock, per Task 1's pattern.)

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts -t "injects brand context"`
Expected: FAIL (no system message in run input).

- [ ] **Step 3: Extend `OttoContext`** (`packages/otto/src/context.ts`)

```ts
  /** Compiled brand memory text for THIS run (injected as a system message at run assembly). */
  brandContext?: string;
  /** The owner's reusable entities the agent may @-reference (name + type only; ids for tools). */
  availableRefs?: { id: string; name: string; type: string }[];
```

- [ ] **Step 4: Populate in `buildOttoContext` + inject at run assembly** (`otto-actions.ts`)

In `buildOttoContext`, load and attach:
```ts
const [brandContext, availableRefs] = await Promise.all([
  getBrandContextText(ownerId, null),                 // Task 3 (brandId null until the agency layer)
  loadAvailableRefsForAgent(ownerId),                 // returns { id, name, type }[] (extract from cowork-actions loadAvailableRefs)
]);
return { orgId: ownerId, userId: ownerId, projectId, threadId, disabledModels, sourceGenerationId: sourceGenerationId ?? null, startGen, brandContext, availableRefs };
```
At run assembly (`:182-189`), prepend a system message when context exists:
```ts
function buildContextSystemMessage(ctx: OttoContext): AgentInputItem | null {
  const parts: string[] = [];
  if (ctx.brandContext) parts.push(`What you know about the user's brand:\n${ctx.brandContext}`);
  if (ctx.availableRefs?.length) parts.push(`Reusable items you can @-reference (use the id with tools): ${ctx.availableRefs.map((r) => `@${r.name} [${r.type}, id=${r.id}]`).join(", ")}`);
  return parts.length ? ({ role: "system", content: parts.join("\n\n") } as AgentInputItem) : null;
}
// then:
const sys = buildContextSystemMessage(ctx);
let runInput: AgentInputItem[];
if (priorOttoState) {
  const priorState = await RunState.fromString(otto, priorOttoState);
  runInput = [...(sys ? [sys] : []), ...priorState.history, { role: "user", content: text } as AgentInputItem];
} else {
  runInput = [...(sys ? [sys] : []), { role: "user", content: text } as AgentInputItem];
}
```
(Use `Promise.all`; if the refs/memory reads fail, default to `[]`/`""` — context injection must never fail the turn, mirroring `coworkTurn`'s best-effort refs gather.)

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/context.ts apps/web/lib/otto-actions.ts apps/web/lib/__tests__/otto-actions.test.ts
git commit -m "feat(otto): dynamic context seam — inject brand memory + reusable entities into the run"
```

---

### Task 5: Goal-intent seeding for Otto's opening turn

Goal tiles are UI (Claude Design), but the backend that turns a chosen goal into a scoped opening is here. Thread an optional `goalKey` through the turn request and seed Otto's first turn with that goal's framing.

**Files:**
- Create: `packages/core/src/goals.ts` (the preset map) + export from the core index.
- Modify: the `coworkTurnRequest` zod schema in `@fikirtive/core` (add optional `goalKey`).
- Modify: `apps/web/lib/otto-actions.ts` (`ottoTurn`: on a NEW thread with a `goalKey`, prepend the preset's opening instruction to the first user turn / as a system note).
- Test: `packages/core/src/goals.test.ts` + an `otto-actions` test that a `goalKey` seeds the opening.

**Interfaces:**
- Produces: `GOAL_PRESETS: Record<string, { label: string; opening: string }>` and `isGoalKey(k: string): boolean`; `coworkTurnRequest` gains `goalKey: z.enum([...]).optional()` (keys validated against the presets).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { GOAL_PRESETS, isGoalKey } from "./goals";
it("has the v1 goal presets with plain-language openings", () => {
  expect(Object.keys(GOAL_PRESETS)).toEqual(expect.arrayContaining(["sell-product", "announce-sale", "get-followers", "make-video"]));
  expect(GOAL_PRESETS["sell-product"].opening).toMatch(/product/i);
  expect(isGoalKey("sell-product")).toBe(true);
  expect(isGoalKey("nope")).toBe(false);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @fikirtive/core exec vitest run src/goals.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `goals.ts`**

```ts
export const GOAL_PRESETS = {
  "sell-product": { label: "Sell a product", opening: "The user wants to promote a product. Ask, in plain language, only: what's the product, who's it for, and where will they post it. Then propose images + a short video." },
  "announce-sale": { label: "Announce a sale", opening: "The user wants to announce a sale or promo. Ask only: what's the offer, and when. Then propose simple promo posts." },
  "get-followers": { label: "Get more followers", opening: "The user wants more followers. Ask only: what's their business, and which platform. Then propose short social videos." },
  "make-video": { label: "Make a video", opening: "The user wants a short video. Ask only: what's it about, and how long. Then propose a short video." },
} as const;
export type GoalKey = keyof typeof GOAL_PRESETS;
export function isGoalKey(k: string): k is GoalKey { return Object.prototype.hasOwnProperty.call(GOAL_PRESETS, k); }
```
Export from the core index. Add `goalKey: z.enum(["sell-product","announce-sale","get-followers","make-video"]).optional()` to `coworkTurnRequest`.

- [ ] **Step 4: Seed the opening in `ottoTurn`** (new-thread path only)

After parsing, when `isNew && parsed.data.goalKey`, prepend the preset's `opening` as a system message in the first run input (reuse Task 4's system-message assembly — append the goal opening to `parts`):
```ts
if (isNew && parsed.data.goalKey && isGoalKey(parsed.data.goalKey)) {
  ctx.brandContext = [ctx.brandContext, `Goal for this conversation: ${GOAL_PRESETS[parsed.data.goalKey].opening}`].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @fikirtive/core exec vitest run src/goals.test.ts && pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/goals.ts packages/core/src/goals.test.ts packages/core/src apps/web/lib/otto-actions.ts
git commit -m "feat(otto): goal-intent presets seed a scoped opening turn"
```

---

### Task 6: Simple-mode plain-language voice for Otto

Otto's instructions (`packages/otto/src/instructions.ts`) don't forbid jargon and even ask for a "verdict". Add a Simple-mode instruction block injected ONLY in simple mode (via the context seam), so it isn't baked into the shared identity the non-simple/agency path also uses.

**Files:**
- Modify: `packages/otto/src/instructions.ts` (export a `ottoSimpleModeBlock` constant).
- Modify: `packages/otto/src/context.ts` (add `simpleMode?: boolean`).
- Modify: `apps/web/lib/otto-actions.ts` (`buildOttoContext` accepts/sets `simpleMode`; the run-assembly system message appends the block when `ctx.simpleMode`); thread `simple` through the turn request (add `simple: z.boolean().optional()` to `coworkTurnRequest`).
- Test: `packages/otto/src/instructions.test.ts` (block content) + an `otto-actions` test (block present only in simple mode).

**Interfaces:**
- Produces: `ottoSimpleModeBlock: string`; `OttoContext.simpleMode?: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ottoSimpleModeBlock } from "./instructions";
it("simple-mode block bans jargon in plain language", () => {
  expect(ottoSimpleModeBlock).toMatch(/plain language/i);
  expect(ottoSimpleModeBlock).toMatch(/generation|render|model|keyframe/i); // names the banned words to avoid
  expect(ottoSimpleModeBlock.toLowerCase()).not.toContain("verdict");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: FAIL (export missing).

- [ ] **Step 3: Add the block** (`instructions.ts`)

```ts
export const ottoSimpleModeBlock = `## Talking to a beginner (Simple mode)
This user has no marketing or AI knowledge. Use plain, warm language only.
- Never say: "generation", "render", "model", "keyframe", "proposal", "parameters", "verdict".
- Instead say: "image" / "video", "starting picture", "idea", and "how does this look?".
- Ask at most 2-3 short questions before proposing something.
- When something is ready, ask simply "how does this look — want any changes?".`;
```

- [ ] **Step 4: Wire it through the seam**

Add `simpleMode?: boolean` to `OttoContext`. `buildOttoContext({ ..., simpleMode })` sets it from the request's `simple` flag. In `buildContextSystemMessage` (Task 4), append `ottoSimpleModeBlock` to `parts` when `ctx.simpleMode`. Add `simple: z.boolean().optional()` to `coworkTurnRequest` and pass it into `buildOttoContext` in `ottoTurn`/`ottoApprove`.

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts && pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/instructions.ts packages/otto/src/instructions.test.ts packages/otto/src/context.ts apps/web/lib/otto-actions.ts packages/core/src
git commit -m "feat(otto): simple-mode plain-language voice, injected only in simple mode"
```

---

## Final verification (after all tasks)

```bash
pnpm typecheck && pnpm test
```
Expected: all green. Then run the app money-safe (`GENERATION_PROVIDER=mock`) and confirm a new thread with a `goalKey` + `simple:true` produces a scoped, plain-language opening that references the user's brand memory + entities, and that a double-approve returns `stale` rather than corrupting the thread.

## Open decisions (confirm before/while executing)
- **Batch ("choose from a batch"):** `GenerationBatch` the *table* is created here (Task 2), but making Otto *emit N proposals as one batch* (the `propose` tool change + the chooser) is a separate, design-coupled decision deferred from this backend plan. v1 can ship honest single-output; confirm whether to add "emit N" now.
- **Memory model vs extending `coworkBrief`:** this plan adds a dedicated `Memory` model (Task 2/3). `Project.coworkBrief` stays as-is; `getBrandContextText` could later also fold it in. Confirm we want the structured model (recommended) over reusing the single text field.
- **`brandId` is always `null` until the agency layer** — `getBrandContextText(ownerId, null)` and `Memory.brandId=null` for v1. The columns exist (Task 2) so the agency layer adds scoping without a migration.
- **Refs loader extraction:** Task 4 needs a `{id,name,type}` refs loader for the agent; extract a shared helper from `cowork-actions.ts:loadAvailableRefs` rather than duplicating (DRY) — confirm the extraction location (`apps/web/lib/data.ts` is a candidate).
