# Cowork SP1 · Plan-2 (UI Surface + Spend Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Use **codegraph** (`codegraph node <symbol>`, `codegraph explore "<q>"`, `codegraph callers <symbol>`) instead of grep/find to locate code.

**Goal:** Ship the Cowork agent's user-facing surface: a chat thread where the agent proposes an editable **Generate card**, and the *user's* Generate click is the only thing that spends — through the unmodified `startGen` money gate — with cowork-generated media cleanly separated from the rest of the studio and results persisted back into the thread.

**Architecture:** A new `"cowork"` `StudioView` surface (`Cowork.tsx`) renders a thread's messages (`TEXT`/`PLAN`/`GEN_CARD`/`GEN_RESULT`). The composer reuses `MentionInput` and calls the Plan-1 `coworkTurn` (propose-only). A `GEN_CARD` renders the proposal with a live-re-derived price and an embedded `MentionInput`; its Generate button calls a NEW thin `coworkGenerate` server action that reads the persisted card server-side, builds a fresh `genRequest` server-side (the SOLE spend gate stays `startGen`'s `safeParse` + Guardian), tags the job with the thread id, and dedupes on `idempotencyKey = cowork:<cardId>`. The thread id flows through `genRequest → startGen → GenJob.threadId → Generation.threadId` (worker), and all three GenSpace/Assets/Editor read paths filter `threadId IS NULL` so cowork drafts never leak into the main workspace. On completion the worker best-effort appends a durable `GEN_RESULT` message to the thread.

**Tech Stack:** Next.js 16 (customized — see `apps/web/AGENTS.md`), React client components, Prisma 7.8 + Neon, `@fikirtive/core` (`gen.ts`, `cowork.ts`, `cowork-route.ts`), `@fikirtive/db`, server actions, vitest, pg-boss worker.

**Spec:** [`../specs/2026-06-15-cowork-agent-loop-design.md`](../specs/2026-06-15-cowork-agent-loop-design.md) (v2, reviewed). This is **Plan-2 of 2**; Plan-1 (headless logic — schema, `suggestModel`, the turn trust boundary, `coworkTurn`) is landed locally on branch `cowork-sp1-plan1` (commits `780b7df..098a7bb`, Codex-clean).

**Resolved scope decisions (from the user, 2026-06-15):**
- **D1 — full `threadId` plumbing (not minimal).** Thread the id through `genRequest → startGen → GenJob.threadId` (additive, behavior-preserving on `startGen`) AND add `Generation.threadId` (worker copies it) + a migration; filter all THREE leak queries (`getRecentGenResults`, `getCandidates`, `getProjectMedia`). The maps' "filter one query" assumption was wrong — the `Generation` table (candidates + Assets + Editor) had no thread link.
- **D2 — persist `GEN_RESULT`.** When a cowork job completes, the **worker** best-effort appends a `GEN_RESULT` `ChatMessage` (uses the existing `GEN_RESULT` kind + `ChatMessage.genJobId`), so results survive reload. The UI also polls `getGenJob` for live in-session feedback.

**House rules (non-negotiable):** money-safety #1 — the agent NEVER spends; the only media-spend path is the user Generate click through the UNMODIFIED-LOGIC `startGen` (`safeParse` + `checkCast` Guardian are the gate; we only ADD an optional `threadId` tag — no spend-logic change). Reuse `startGen`/`MentionInput`/`coworkTurn`/entity-variant refs. Additive migration only (apply to LOCAL `postgresql://fikirtive:fikirtive@localhost:5432/fikirtive`, never prod). TDD for core (vitest). `GENERATION_PROVIDER=mock` + `COWORK_PROVIDER` unset for any gen/LLM test; **kill stale fal workers first**. Surgical changes. **No auto-commit/push** (the per-task "Commit" steps are staged for the user). `/codex` money-safety review before any deploy.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/db/prisma/schema.prisma` | data model | + `Generation.threadId String?` (GenJob.threadId already exists) |
| `packages/db/prisma/migrations/<ts>_cowork_plan2_schema/migration.sql` | migration | new (additive): `Generation.threadId` + partial-unique `ChatMessage(genJobId)` result-message index |
| `packages/core/src/gen.ts` | `genRequest` schema | + optional `threadId` field |
| `packages/core/src/gen.test.ts` | tests | + `threadId` accept/round-trip cases |
| `apps/web/lib/gen-actions.ts` | spend path | `startGen` persists `threadId`; `getRecentGenResults` filters `threadId: null` |
| `apps/worker/src/jobs/gen.ts` | worker | `Generation.threadId = job.threadId`; best-effort `GEN_RESULT` message on DONE |
| `apps/web/lib/data.ts` | read layer | `getCandidates`/`getProjectMedia` filter `threadId: null`; + `getCoworkThreads`/`getCoworkThread` |
| `apps/web/lib/types.ts` | DTO types | + `ChatThreadDTO`, `ChatMessageDTO` |
| `apps/web/lib/dto.ts` | DTO transforms | + `toChatThreadDTO`/`toChatMessageDTO` (re-parse GEN_CARD payload; resolve GEN_RESULT urls) |
| `apps/web/lib/cowork-actions.ts` | spend action | + `coworkGenerate` (server-built genRequest → `startGen`) |
| `apps/web/components/studio/StudioShell.tsx` | nav | + `"cowork"` to `StudioView`, `WORKSPACE`, `TITLES` |
| `apps/web/components/studio/Studio.tsx` | dispatcher | + `case "cowork"`, `threads` prop |
| `apps/web/app/studio/page.tsx` | hydrate | + `"cowork"` to `STUDIO_VIEWS`, fetch `getCoworkThreads` |
| `apps/web/components/studio/Cowork.tsx` | surface | **new** — thread render + composer + Generate card |
| `scripts/verify-cowork-plan2.mjs` | money-safety verify | **new** (mock-$0: spend-once, threadId-tag, no leak) |

---

### Task 1: `Generation.threadId` + cowork result-message unique index + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Generation`, ~line 214)
- Create: `packages/db/prisma/migrations/<ts>_cowork_plan2_schema/migration.sql`

> **Why the index (from the GEN_RESULT-owner research, 2026-06-15):** the worker is the durable writer of the result message (Option A — see Task 3). The worker's resume path re-runs a redelivered job to DONE, so an unguarded append would write a **duplicate** `GEN_RESULT`. A `findFirst` guard is racy under resume+redelivery; the race-proof fix (and the repo idiom — same as `idempotencyKey`/shot-version) is a **partial-unique index on `ChatMessage(genJobId) WHERE kind IN ('GEN_RESULT','TURN_ERROR')`** + swallow P2002 in the writer. Prisma can't express a partial `WHERE`, so it's appended as raw SQL (matching the `ChatThread_project_live_idx` idiom from the Plan-1 migration).

- [ ] **Step 1: Add the column to `schema.prisma`.** In `model Generation` add (additive, nullable — keeps every existing query/worker write valid):
```prisma
  threadId       String?   // set by the worker (= GenJob.threadId) when a cowork gen produced this; filters it out of candidate/asset/editor views
```

- [ ] **Step 2: Create the migration (LOCAL only, no prod).**
Run: `cd packages/db && DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm exec prisma migrate dev --name cowork_plan2_schema --create-only`
Expected: a new `migrations/<ts>_cowork_plan2_schema/migration.sql` containing `ALTER TABLE "Generation" ADD COLUMN "threadId" TEXT;`.

- [ ] **Step 3: Append the result-message partial-unique index (raw SQL — repo idiom).** Edit the generated `migration.sql` and append:
```sql
-- one durable result/error message per cowork GenJob (worker is the sole writer; this
-- turns its at-least-once resume attempts into effectively-once — swallow P2002 in the writer)
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_genjob_result_uniq"
ON "ChatMessage"("genJobId") WHERE "genJobId" IS NOT NULL AND "kind" IN ('GEN_RESULT', 'TURN_ERROR');
```

- [ ] **Step 4: Apply locally + regenerate the client.**
Run: `cd packages/db && DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm exec prisma migrate deploy && pnpm --filter @fikirtive/db build`
Expected: "All migrations have been successfully applied." + `prisma.generation` now has `threadId`.

- [ ] **Step 5: Verify the column + index exist.**
Run:
```bash
cd /Users/winnin/Documents/fikirtive/packages/db && node -e '
const {Client}=require("pg");const c=new Client({connectionString:"postgresql://fikirtive:fikirtive@localhost:5432/fikirtive"});
(async()=>{await c.connect();
const g=await c.query("SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2",["Generation","threadId"]);
const i=await c.query("SELECT 1 FROM pg_indexes WHERE indexname=$1",["ChatMessage_genjob_result_uniq"]);
console.log("Generation.threadId:",g.rows.length===1,"| result-uniq idx:",i.rows.length===1);await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})'
```
Expected: `Generation.threadId: true | result-uniq idx: true`

- [ ] **Step 6: Commit (staged).**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): Generation.threadId + cowork result-message unique index (SP1 plan-2)"
```

---

### Task 2: `genRequest.threadId` + `startGen` persists it (TDD)

**Files:**
- Modify: `packages/core/src/gen.ts` (the `genRequest` object, ~line 165-195)
- Modify: `packages/core/src/gen.test.ts`
- Modify: `apps/web/lib/gen-actions.ts` (`startGen` destructure + `genJob.create`; `getRecentGenResults` where)

- [ ] **Step 1: Failing test.** In `gen.test.ts` add:
```ts
it("genRequest accepts an optional threadId (cowork tag) and rejects an over-long one", () => {
  const base = { projectId: "p1", prompt: "a cat", count: 1, kind: "image", model: "seedream" };
  expect(genRequest.safeParse({ ...base, threadId: "t_123" }).success).toBe(true);
  expect(genRequest.safeParse(base).success).toBe(true); // absent is fine (backward-compat)
  expect(genRequest.safeParse({ ...base, threadId: "x".repeat(65) }).success).toBe(false);
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @fikirtive/core test -- gen` Expected: FAIL (`threadId` rejected by `.strict()`).

- [ ] **Step 3: Implement.** In `gen.ts` `genRequest` object, add next to `idempotencyKey` (keep `.strict()`):
```ts
    // cowork tag: when set, this gen belongs to a Cowork thread — startGen persists it
    // onto GenJob.threadId so the worker can tag the Generation and the studio views can
    // filter cowork drafts out. Server-derived (never client-trusted for trust, but bounded).
    threadId: z.string().min(1).max(64).nullish(),
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @fikirtive/core test -- gen && pnpm --filter @fikirtive/core build` Expected: PASS.

- [ ] **Step 5: `startGen` persists it.** In `apps/web/lib/gen-actions.ts`:
  - Add `threadId` to the destructure (line 28): `..., idempotencyKey, variantSel, threadId } = parsed.data;`
  - In `prisma.genJob.create` data (after `idempotencyKey: idempotencyKey ?? null,`), add:
```ts
        threadId: threadId ?? null, // cowork tag — keeps this job out of the GenSpace/Assets/Editor views
```

- [ ] **Step 6: `getRecentGenResults` excludes cowork jobs.** In `gen-actions.ts` `getRecentGenResults`, change the `genJob.findMany` where (line 152) from `{ projectId, ownerId: FOUNDER_OWNER_ID }` to:
```ts
    where: { projectId, ownerId: FOUNDER_OWNER_ID, threadId: null },
```

- [ ] **Step 7: Typecheck.** `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck` Expected: PASS.

- [ ] **Step 8: Commit (staged).**
```bash
git add packages/core/src/gen.ts packages/core/src/gen.test.ts apps/web/lib/gen-actions.ts
git commit -m "feat(core+web): genRequest.threadId; startGen persists it; getRecentGenResults filters cowork (SP1 plan-2)"
```

---

### Task 3: Worker tags `Generation.threadId` + persists `GEN_RESULT` (D2)

**Files:**
- Modify: `apps/worker/src/jobs/gen.ts` (the completion `$transaction`, ~line 328-353)

Use `codegraph node` or read `apps/worker/src/jobs/gen.ts:300-355` first to confirm the exact surrounding code (the `tx.generation.create` at 336-342 and the DONE update at 353).

- [ ] **Step 1: Tag the Generation rows.** In the completion `$transaction`, in `tx.generation.create({ data: { ... } })` (line 337-341), add `threadId: job.threadId ?? null,` to the data:
```ts
        const gen = await tx.generation.create({
          data: {
            id: newId(), ownerId: job.ownerId, projectId: job.projectId, shotId: null,
            threadId: job.threadId ?? null, // cowork tag (null for normal studio gens) → keeps it out of candidate/asset views
            assetId: asset.id, source: "GENERATED", promptText: job.prompt, modelRef: job.model,
            entitySnapshot, version: 1, attachedAt: null,
          },
        });
```

- [ ] **Step 2: Add a best-effort `appendCoworkResult` helper** (mirrors the existing `attachBestEffort` post-commit pattern — read it first via `codegraph node attachBestEffort`). Idempotency is enforced by the Task-1 partial-unique index, so the worker just swallows P2002 (race-proof, unlike a `findFirst` guard). Place it near `attachBestEffort` in `apps/worker/src/jobs/gen.ts`:
```ts
// D2 (GEN_RESULT-owner research): the worker is the DURABLE writer of a cowork job's
// result/error message. Post-commit + best-effort (like attachBestEffort): it can never
// throw into the completion path, never flip `committed`, never re-spend, never delay DONE.
// Exactly-once is the partial-unique index ChatMessage(genJobId) WHERE kind IN
// (GEN_RESULT,TURN_ERROR) — a resume/redelivery re-attempt hits P2002 and is swallowed.
async function appendCoworkResult(job: { id: string; threadId: string | null; ownerId: string; kind: string; model: string }, kind: "GEN_RESULT" | "TURN_ERROR", generationIds: string[], errorText = "") {
  if (!job.threadId) return;
  try {
    const last = await prisma.chatMessage.findFirst({ where: { threadId: job.threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
    await prisma.chatMessage.create({
      data: {
        id: newId(), threadId: job.threadId, ownerId: job.ownerId, role: "AGENT", kind,
        seq: (last?.seq ?? 0) + 1, text: errorText,
        genJobId: job.id,
        payload: { kind: job.kind === "VIDEO" ? "video" : "image", model: job.model, generationIds },
      },
    });
  } catch (e) {
    // P2002 = the result/error message for this job already exists (resume/redelivery) → no-op.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return;
    console.warn(`[gen] ${job.id}: ${kind} append failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}
```
(`newId` is already imported in this worker file; confirm with `codegraph node` — if not, add it from `@fikirtive/core`. `role`/`kind` are passed as the string literals Prisma accepts.)

- [ ] **Step 3: Write `GEN_RESULT` on every transition to DONE.** AFTER the `status: "DONE"` update (line 353) and the `console.log`, call (idempotent — covers both the happy-path and the resume branch, since both reach this DONE update):
```ts
    await appendCoworkResult(job, "GEN_RESULT", generationIds);
```

- [ ] **Step 4: Write `TURN_ERROR` only on TERMINAL failure.** In the `catch` block, AFTER the `genJob.update({ ... status: ... })` that sets the job state, add — gated on `final` so a requeue/RESUME (which will later succeed) never shows the user a failure (`generationIds` isn't in scope in the catch — pass `[]`):
```ts
    if (final) await appendCoworkResult(job, "TURN_ERROR", [], message);
```

- [ ] **Step 5: Typecheck the worker.** `pnpm --filter @fikirtive/worker typecheck` (or `pnpm -r typecheck`) Expected: PASS.

- [ ] **Step 6: Commit (staged).**
```bash
git add apps/worker/src/jobs/gen.ts
git commit -m "feat(worker): tag cowork Generation.threadId + durable GEN_RESULT/TURN_ERROR message (SP1 plan-2)"
```

---

### Task 4: Close the `Generation`-table leak (`getCandidates` + `getProjectMedia`)

**Files:**
- Modify: `apps/web/lib/data.ts` (`getCandidates` ~80-86, `getProjectMedia` ~90-96)

- [ ] **Step 1: Filter candidates.** In `getCandidates`, add `threadId: null` to the where:
```ts
export async function getCandidates(projectId: string) {
  return prisma.generation.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, projectId, shotId: null, threadId: null, ...notDeleted },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
}
```

- [ ] **Step 2: Filter the Assets library.** In `getProjectMedia`, add `threadId: null`:
```ts
export async function getProjectMedia(projectId: string) {
  return prisma.generation.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, projectId, threadId: null, ...notDeleted },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
}
```

- [ ] **Step 3: Typecheck.** `pnpm --filter web typecheck` Expected: PASS. (Verification of the full no-leak property is the mock-$0 script in Task 10.)

- [ ] **Step 4: Commit (staged).**
```bash
git add apps/web/lib/data.ts
git commit -m "feat(web): exclude cowork gens from candidates + Assets library (SP1 plan-2)"
```

---

### Task 5: Cowork read layer + DTOs

**Files:**
- Modify: `apps/web/lib/data.ts` (+ `getCoworkThreads`, `getCoworkThread`)
- Modify: `apps/web/lib/types.ts` (+ `ChatThreadDTO`, `ChatMessageDTO`)
- Modify: `apps/web/lib/dto.ts` (+ `toChatThreadDTO`, `toChatMessageDTO`)

Read `apps/web/lib/dto.ts` `toEntityDTO` (~22-41) and `apps/web/lib/types.ts` `EntityDTO` first to match the DTO idiom (no BigInt, client-safe shapes, `storageKeyToSrc` for image urls).

- [ ] **Step 1: Read queries.** In `data.ts` add (mirrors `getShots` project-scoped hydrate + `getEntities` owner scope; messages ordered by `seq`):
```ts
/** Live cowork threads for a project, newest activity first (list rail). */
export async function getCoworkThreads(projectId: string) {
  return prisma.chatThread.findMany({
    where: { projectId, ownerId: FOUNDER_OWNER_ID, ...notDeleted },
    orderBy: { updatedAt: "desc" },
    include: { messages: { where: notDeleted, orderBy: { seq: "asc" }, include: { } } },
  });
}

/** One owned, live thread with its messages in seq order (deep-link / refetch). */
export async function getCoworkThread(threadId: string) {
  return prisma.chatThread.findFirst({
    where: { id: threadId, ownerId: FOUNDER_OWNER_ID, ...notDeleted },
    include: { messages: { where: notDeleted, orderBy: { seq: "asc" } } },
  });
}

export type ChatThreadWithMessages = NonNullable<Awaited<ReturnType<typeof getCoworkThread>>>;
```

- [ ] **Step 2: DTO types.** In `types.ts` add:
```ts
export interface ChatMessageDTO {
  id: string;
  role: "USER" | "AGENT";
  kind: "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR";
  seq: number;
  text: string;
  /** GEN_CARD: re-validated proposal payload; GEN_RESULT: { kind, model, urls }; PLAN: { planSteps }. null otherwise. */
  payload: unknown | null;
  genJobId: string | null;
  createdAt: string;
}
export interface ChatThreadDTO {
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
  messages: ChatMessageDTO[];
}
```

- [ ] **Step 3: DTO transforms with read-validation.** In `dto.ts` add (re-parse a GEN_CARD payload through `coworkProposalSchema` so a malformed/edited JSON can't crash render; resolve GEN_RESULT image urls from the stored `generationIds`). This needs the gen rows for GEN_RESULT — pass a resolved `urlsByJob: Map<jobId, string[]>` built by the caller (Step 4):
```ts
import { coworkProposalSchema } from "@fikirtive/core";

export function toChatMessageDTO(m: ChatThreadWithMessages["messages"][number], urlsByJob: Map<string, string[]>): ChatMessageDTO {
  let payload: unknown | null = null;
  if (m.kind === "GEN_CARD" && m.payload) {
    // m.payload is the full card; re-validate the PROPOSAL subset, keep the display extras as-is
    const p = m.payload as Record<string, unknown>;
    const proposal = coworkProposalSchema.safeParse({ kind: p.kind, desiredAspect: p.desiredAspect, desiredDuration: p.desiredDuration, desiredAudio: p.desiredAudio, structuredPrompt: p.structuredPrompt, entityIds: p.entityIds ?? [], variantSel: p.variantSel ?? {} });
    payload = proposal.success ? { ...p, ...proposal.data } : null; // malformed → render as plain (no card)
  } else if (m.kind === "GEN_RESULT" && m.payload) {
    const p = m.payload as { kind?: string; model?: string };
    payload = { kind: p.kind ?? "image", model: p.model ?? "", urls: m.genJobId ? (urlsByJob.get(m.genJobId) ?? []) : [] };
  } else if (m.kind === "PLAN" && m.payload) {
    payload = m.payload; // { planSteps }
  }
  return { id: m.id, role: m.role, kind: m.kind, seq: m.seq, text: m.text, payload, genJobId: m.genJobId, createdAt: m.createdAt.toISOString() };
}

export function toChatThreadDTO(t: ChatThreadWithMessages, urlsByJob: Map<string, string[]>): ChatThreadDTO {
  return { id: t.id, projectId: t.projectId, title: t.title, updatedAt: t.updatedAt.toISOString(), messages: t.messages.map((m) => toChatMessageDTO(m, urlsByJob)) };
}
```

- [ ] **Step 4: GEN_RESULT url resolver in `data.ts`.** Add a helper that resolves the image urls for the GEN_RESULT messages of a thread (reuse the `getGenJob` url logic — `storageKey`/`storageKeyToSrc`):
```ts
import { storageKey, storageKeyToSrc } from "@fikirtive/core";

/** Map of genJobId → ordered image urls for the GEN_RESULT messages in these threads. */
export async function resolveCoworkResultUrls(threads: { messages: { genJobId: string | null; kind: string }[] }[]) {
  const jobIds = threads.flatMap((t) => t.messages.filter((m) => m.kind === "GEN_RESULT" && m.genJobId).map((m) => m.genJobId as string));
  const map = new Map<string, string[]>();
  if (!jobIds.length) return map;
  const jobs = await prisma.genJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, generationIds: true } });
  const allGenIds = jobs.flatMap((j) => j.generationIds);
  const gens = allGenIds.length ? await prisma.generation.findMany({ where: { id: { in: allGenIds } }, include: { asset: true } }) : [];
  const genById = new Map(gens.map((g) => [g.id, g]));
  for (const j of jobs) {
    map.set(j.id, j.generationIds.map((gid) => genById.get(gid)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext))));
  }
  return map;
}
```

- [ ] **Step 5: Typecheck.** `pnpm --filter web typecheck` Expected: PASS.

- [ ] **Step 6: Commit (staged).**
```bash
git add apps/web/lib/data.ts apps/web/lib/types.ts apps/web/lib/dto.ts
git commit -m "feat(web): cowork thread read layer + DTOs (GEN_CARD read-validation, GEN_RESULT urls) (SP1 plan-2)"
```

---

### Task 6: `coworkGenerate` — the money-safe Generate action

**Files:**
- Modify: `apps/web/lib/cowork-actions.ts` (+ `coworkGenerate`)
- Modify: `packages/core/src/cowork.ts` (+ `coworkGenerateRequest` zod input)

The critic's verified design: do NOT call `startGen` directly from the client with client params. A thin server action reads the persisted GEN_CARD, derives `threadId` + `projectId` server-side (anti-spoof), builds the `genRequest` server-side from the card's `model`/`kind`/`params` (server-trusted) taking only the *edited* `prompt`/`entityIds`/`variantSel` from the client, and calls `startGen` (the sole gate). `idempotencyKey = cowork:<cardId>` (stable — never per-retry, or it defeats dedup).

- [ ] **Step 1: Input schema in `cowork.ts`.**
```ts
export const coworkGenerateRequest = z.object({
  cardId: z.string().min(1).max(64),
  prompt: z.string().trim().min(1).max(MAX_GEN_PROMPT),
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
  variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
}).strict();
export type CoworkGenerateRequest = z.infer<typeof coworkGenerateRequest>;
```

- [ ] **Step 2: Implement `coworkGenerate` in `cowork-actions.ts`.** Add imports (`coworkGenerateRequest`, `coworkProposalSchema`, `startGen` from `./gen-actions`). It returns `{ id }` (the GenJob id) | `{ error }`:
```ts
export async function coworkGenerate(raw: unknown): Promise<{ id: string } | { error: string }> {
  const parsed = coworkGenerateRequest.safeParse(raw);
  if (!parsed.success) return { error: "That card can't be generated." };
  const { cardId, prompt, entityIds, variantSel } = parsed.data;

  // Load the GEN_CARD server-side — threadId + projectId + the trusted model/params
  // come from the PERSISTED card, never from the client (anti-spoof).
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId: FOUNDER_OWNER_ID, kind: "GEN_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, genJobId: true, thread: { select: { projectId: true, deletedAt: true, ownerId: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== FOUNDER_OWNER_ID) return { error: "Card not found." };

  // re-validate the persisted proposal subset; the model/kind/params are server-trusted
  const p = (card.payload ?? {}) as Record<string, unknown>;
  const proposal = coworkProposalSchema.safeParse({ kind: p.kind, desiredAspect: p.desiredAspect, desiredDuration: p.desiredDuration, desiredAudio: p.desiredAudio, structuredPrompt: p.structuredPrompt, entityIds: p.entityIds ?? [], variantSel: p.variantSel ?? {} });
  if (!proposal.success) return { error: "This card is no longer valid." };
  const model = typeof p.model === "string" ? p.model : null;
  const params = (p.params ?? {}) as { aspectRatio?: string; resolution?: string; durationSeconds?: number; audio?: boolean; count?: number };
  if (!model) return { error: "This card is missing a model." };

  // Build the genRequest SERVER-SIDE. model/kind/count/video-params come from the card;
  // only the (possibly edited) prompt + refs come from the client. startGen.safeParse +
  // checkCast remain the SOLE spend gate; effectiveVariantSel drops it for video there.
  const req = {
    projectId: card.thread.projectId,
    threadId: card.threadId,
    prompt,
    entityIds,
    ...(Object.keys(variantSel).length ? { variantSel } : {}),
    count: proposal.data.kind === "video" ? 1 : (params.count ?? 1),
    kind: proposal.data.kind,
    model,
    ...(proposal.data.kind === "video" ? {
      durationSeconds: params.durationSeconds ?? null,
      resolution: params.resolution ?? null,
      aspectRatio: params.aspectRatio ?? null,
      audio: params.audio ?? null,
    } : {}),
    idempotencyKey: `cowork:${cardId}`, // stable — same card always dedupes; NEVER per-retry
  };

  const res = await startGen(req); // the ONLY spend path (unmodified logic — safeParse + Guardian)
  if ("error" in res) return res;

  // mark the card as generated (re-spend guard on reload: the UI disables Generate when
  // genJobId is set). Best-effort — the spend already happened safely via startGen.
  try { await prisma.chatMessage.update({ where: { id: cardId }, data: { genJobId: res.id } }); } catch { /* non-fatal */ }
  return res;
}
```

- [ ] **Step 3: Build + typecheck.** `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck` Expected: PASS.

- [ ] **Step 4: Static money-safety check.** Run `grep -n "genJob.create\|prisma.genJob.create" apps/web/lib/cowork-actions.ts` → **no matches** (coworkGenerate must spend ONLY via `startGen`, never create a GenJob directly). Confirm `startGen` is the only spend call.

- [ ] **Step 5: Commit (staged).**
```bash
git add packages/core/src/cowork.ts apps/web/lib/cowork-actions.ts
git commit -m "feat(web): coworkGenerate — server-built genRequest → startGen (sole gate), threadId-tagged (SP1 plan-2)"
```

---

### Task 7: Register the `"cowork"` surface

**Files:**
- Modify: `apps/web/components/studio/StudioShell.tsx` (`StudioView`, `WORKSPACE`, `TITLES` — ~17-35)
- Modify: `apps/web/components/studio/Studio.tsx` (`surface()` switch ~52-68, `Studio` props ~18)
- Modify: `apps/web/app/studio/page.tsx` (`STUDIO_VIEWS` ~12, data fetch ~32-132)

Read these three files first (they're small) to match the exact nav-array and switch idiom.

- [ ] **Step 1: `StudioShell.tsx`.** Add `"cowork"` to the `StudioView` union; add to `WORKSPACE` after `assets` (reuse `IcSparkle` or pick `IcUsers` from `ds.tsx`); add to `TITLES`:
```ts
export type StudioView = "genspace" | "canvas" | "storyboard" | "editor" | "elements" | "assets" | "cowork" | "plans" | "account";
// in WORKSPACE array, after the assets entry:
  { view: "cowork", label: "Cowork", Icon: IcSparkle },
// in TITLES:
  cowork: "Cowork",
```

- [ ] **Step 2: `Studio.tsx`.** Add a `threads` prop to `Studio` and a `case` to `surface()`:
```ts
// in the Studio props type:
  threads?: ChatThreadDTO[];
// in surface() switch, before default:
    case "cowork":
      return <Cowork projectId={project.id} entities={entities} threads={threads ?? []} />;
```
Add the imports: `import { Cowork } from "./Cowork";` and `import type { ChatThreadDTO } from "@/lib/types";`.

- [ ] **Step 3: `app/studio/page.tsx`.** Add `"cowork"` to `STUDIO_VIEWS`; fetch threads server-side and pass to `Studio`:
```ts
// STUDIO_VIEWS set:
const STUDIO_VIEWS = new Set([... , "cowork"]);
// in the data fetch (alongside entities/shots/media), after resolving projectId:
const threadRows = await getCoworkThreads(projectId);
const coworkUrls = await resolveCoworkResultUrls(threadRows);
const threads = threadRows.map((t) => toChatThreadDTO(t, coworkUrls));
// pass to <Studio ... threads={threads} />
```
Add imports for `getCoworkThreads`, `resolveCoworkResultUrls` (from `@/lib/data`) and `toChatThreadDTO` (from `@/lib/dto`).

- [ ] **Step 4: Typecheck.** `pnpm --filter web typecheck` Expected: PASS. (`Cowork` is created in Task 8 — until then, stub it: `export function Cowork() { return null; }` so this task compiles independently, then Task 8 replaces it.)

- [ ] **Step 5: Commit (staged).**
```bash
git add apps/web/components/studio/StudioShell.tsx apps/web/components/studio/Studio.tsx apps/web/app/studio/page.tsx
git commit -m "feat(web): register the cowork studio surface + hydrate threads (SP1 plan-2)"
```

---

### Task 8: `Cowork.tsx` surface shell (thread render + composer)

**Files:**
- Create: `apps/web/components/studio/Cowork.tsx`

Mirror `GenSpace.tsx`'s `.screen` (scroll area) + `.composer-dock` layout and its `busyRef` synchronous double-click guard. Read `GenSpace.tsx:80-200` + `470-545` for the exact class names + `MentionInput` usage. The composer calls the Plan-1 `coworkTurn`; the agent's messages render by `kind`. **Logic is fully specified below; presentational class names follow GenSpace.**

- [ ] **Step 1: Component skeleton (state + thread state + turn handler).**
```tsx
"use client";
import { useRef, useState } from "react";
import { coworkTurn } from "@/lib/cowork-actions";
import { MentionInput } from "@/components/MentionInput";
import { GenerateCard } from "./GenerateCard";
import type { EntityDTO, ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

export function Cowork({ projectId, entities, threads }: { projectId: string; entities: EntityDTO[]; threads: ChatThreadDTO[] }) {
  // v1: single active thread (most recent) or a fresh one. (Thread-list rail is a later slice.)
  const [thread, setThread] = useState<ChatThreadDTO | null>(threads[0] ?? null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>(threads[0]?.messages ?? []);
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [variantSel, setVariantSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous double-submit guard (same pattern as GenSpace)
  const [composerKey, setComposerKey] = useState(0);

  async function send() {
    if (!text.trim() || busy || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const res = await coworkTurn({ threadId: thread?.id, projectId, text, entityIds: ids, variantSel });
      if ("error" in res) { /* surface inline (toast/message) */ return; }
      // refetch the canonical thread (cheap; one thread) so new messages + ids render
      const { getCoworkThreadClient } = await import("@/lib/cowork-fetch"); // see Step 3
      const fresh = await getCoworkThreadClient(res.threadId);
      if (fresh) { setThread(fresh); setMessages(fresh.messages); }
      setText(""); setIds([]); setVariantSel({}); setComposerKey((k) => k + 1);
    } finally { busyRef.current = false; setBusy(false); }
  }
  // ... render (Step 2)
}
```

- [ ] **Step 2: Render messages by kind + composer.** In the `.screen` scroll area, map `messages` (already seq-ordered) to bubbles; the composer reuses `MentionInput` (same `onChange` signature as GenSpace):
```tsx
  return (
    <div className="genspace-screen"> {/* reuse GenSpace layout classes */}
      <div className="genspace-results" /* scroll area */>
        {messages.map((m) => {
          if (m.kind === "TEXT") return <div key={m.id} className={m.role === "USER" ? "cw-msg cw-user" : "cw-msg cw-agent"}>{m.text}</div>;
          if (m.kind === "PLAN") { const steps = (m.payload as { planSteps?: string[] })?.planSteps ?? []; return <ul key={m.id} className="cw-plan">{steps.map((s, i) => <li key={i}>{s}</li>)}</ul>; }
          if (m.kind === "GEN_CARD") return <GenerateCard key={m.id} cardId={m.id} payload={m.payload} entities={entities} alreadyGenerated={!!m.genJobId} />;
          if (m.kind === "GEN_RESULT") { const r = m.payload as { urls?: string[] }; return <div key={m.id} className="cw-result">{(r?.urls ?? []).map((u, i) => <img key={i} src={u} alt="" />)}</div>; }
          if (m.kind === "DENIAL" || m.kind === "TURN_ERROR") return <div key={m.id} className="cw-msg cw-error">{m.text}</div>;
          return null;
        })}
      </div>
      <div className="genspace-composer-dock">
        <MentionInput entities={entities} docKey={String(composerKey)} placeholder="Describe what you want to create…" disabled={busy}
          onChange={(t, i, vs) => { setText(t); setIds(i); setVariantSel(vs); }} onSubmit={send} />
        <button className="al-btn al-btn-primary" disabled={busy || !text.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
```

- [ ] **Step 3: Client thread refetch helper.** Create `apps/web/lib/cowork-fetch.ts` (a `"use server"` wrapper exposing `getCoworkThread` + `resolveCoworkResultUrls` + DTO for client refetch):
```ts
"use server";
import { getCoworkThread, resolveCoworkResultUrls } from "./data";
import { toChatThreadDTO } from "./dto";
import type { ChatThreadDTO } from "./types";
export async function getCoworkThreadClient(threadId: string): Promise<ChatThreadDTO | null> {
  const t = await getCoworkThread(threadId);
  if (!t) return null;
  const urls = await resolveCoworkResultUrls([t]);
  return toChatThreadDTO(t, urls);
}
```

- [ ] **Step 4: Add the CSS classes** (`cw-msg`/`cw-user`/`cw-agent`/`cw-plan`/`cw-result`/`cw-error`) to the studio stylesheet alongside the GenSpace classes, matching the existing design tokens. (Find the GenSpace CSS module/global the `.genspace-*` classes live in via `codegraph`/grep `genspace-composer-dock`.)

- [ ] **Step 5: Typecheck + build.** `pnpm --filter web typecheck` Expected: PASS (after Task 9 provides `GenerateCard`). If running before Task 9, stub `GenerateCard`.

- [ ] **Step 6: Commit (staged).**
```bash
git add apps/web/components/studio/Cowork.tsx apps/web/lib/cowork-fetch.ts apps/web/app/**/*.css
git commit -m "feat(web): Cowork surface — thread render + MentionInput composer → coworkTurn (SP1 plan-2)"
```

---

### Task 9: `GenerateCard.tsx` — the editable proposal + Generate button

**Files:**
- Create: `apps/web/components/studio/GenerateCard.tsx`

The card renders the persisted proposal, lets the user edit refs/prompt via `MentionInput` (seeded from `structuredPrompt` with `buildMentionDoc`), shows a **live re-derived** price (display only), and a Generate button that calls `coworkGenerate` with a synchronous `busyRef` guard and is **disabled once generated** (re-spend guard — `idempotencyKey` only dedupes while QUEUED/GENERATING; once DONE the partial-unique index no longer blocks). It polls `getGenJob` for live in-session result (the durable copy is the worker-written GEN_RESULT).

- [ ] **Step 1: Component.**
```tsx
"use client";
import { useRef, useState } from "react";
import { MentionInput, buildMentionDoc } from "@/components/MentionInput";
import { coworkGenerate } from "@/lib/cowork-actions";
import { getGenJob } from "@/lib/gen-actions";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd, type GenVideoModel } from "@fikirtive/core";
import type { EntityDTO } from "@/lib/types";

const POLL_CAP = 120;

export function GenerateCard({ cardId, payload, entities, alreadyGenerated }: { cardId: string; payload: unknown; entities: EntityDTO[]; alreadyGenerated: boolean }) {
  const p = (payload ?? {}) as { kind?: "image" | "video"; model?: string; reason?: string; downgraded?: boolean; structuredPrompt?: string; entityIds?: string[]; variantSel?: Record<string, string>; params?: { durationSeconds?: number; resolution?: string; audio?: boolean; count?: number } };
  const byId = new Map(entities.map((e) => [e.id, e]));
  const seedDoc = buildMentionDoc(p.structuredPrompt ?? "", (p.entityIds ?? []).map((id) => { const e = byId.get(id); return e ? { id: e.id, name: e.name, type: e.type, variantId: p.variantSel?.[id] } : null; }).filter((x): x is NonNullable<typeof x> => !!x));

  const [prompt, setPrompt] = useState(p.structuredPrompt ?? "");
  const [ids, setIds] = useState<string[]>(p.entityIds ?? []);
  const [variantSel, setVariantSel] = useState<Record<string, string>>(p.variantSel ?? {});
  const [generated, setGenerated] = useState(alreadyGenerated);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [result, setResult] = useState<{ status: "pending" | "done" | "failed"; urls: string[]; message?: string }>({ status: "pending", urls: [] });
  const [showResult, setShowResult] = useState(false);

  // live price (DISPLAY ONLY — the real charge is re-derived inside startGen)
  const price = p.kind === "video"
    ? videoPriceUsd((p.model ?? "") as GenVideoModel, { seconds: p.params?.durationSeconds ?? 1, resolution: p.params?.resolution ?? "", audio: !!p.params?.audio, count: 1 })
    : (p.params?.count ?? 1) * GEN_PRICE_USD_PER_IMAGE;

  async function generate() {
    if (busy || busyRef.current || generated) return; // generated → re-spend guard
    busyRef.current = true; setBusy(true); setShowResult(true); setResult({ status: "pending", urls: [] });
    try {
      const res = await coworkGenerate({ cardId, prompt, entityIds: ids, variantSel });
      if ("error" in res) { setResult({ status: "failed", urls: [], message: res.error }); return; }
      setGenerated(true);
      // poll for the live result (mirrors GenSpace launch(): POLL_CAP, non-retryable on timeout)
      let n = 0;
      const t = setInterval(async () => {
        n += 1;
        try {
          const job = await getGenJob(res.id);
          if (!job) { if (n > POLL_CAP) { clearInterval(t); setResult({ status: "failed", urls: [], message: "Status unknown — reload to check." }); } return; }
          if (job.status === "DONE") { clearInterval(t); setResult({ status: "done", urls: job.urls }); }
          else if (job.status === "FAILED") { clearInterval(t); setResult({ status: "failed", urls: [], message: job.error || "Generation failed" }); }
          else if (n > POLL_CAP) { clearInterval(t); setResult({ status: "failed", urls: [], message: "Still running — reload to check (don't re-run, you may have been charged)." }); }
        } catch { if (n > POLL_CAP) { clearInterval(t); setResult({ status: "failed", urls: [], message: "Status unknown — reload to check." }); } }
      }, 2000);
    } finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <div className="cw-card">
      <div className="cw-card-head">
        <span className="cw-card-model">{p.model}</span>
        <span className="cw-card-price">~${price.toFixed(2)}</span>
        {p.downgraded && <span className="cw-card-note" title={p.reason}>adjusted</span>}
      </div>
      <MentionInput entities={entities} initialDoc={seedDoc} docKey={cardId} disabled={busy || generated}
        onChange={(t, i, vs) => { setPrompt(t); setIds(i); setVariantSel(vs); }} />
      {p.kind === "video" && <p className="cw-card-hint">Variant binding applies to image keyframes; video animates the source frame.</p>}
      <button className="al-btn al-btn-primary" disabled={busy || generated || !prompt.trim()} onClick={generate}>
        {generated ? "Generated" : busy ? "Generating…" : "Generate"}
      </button>
      {showResult && (
        <div className="cw-card-result">
          {result.status === "pending" && <span>Generating…</span>}
          {result.status === "failed" && <span className="cw-error">{result.message}</span>}
          {result.status === "done" && result.urls.map((u, i) => <img key={i} src={u} alt="" />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build.** `pnpm --filter web typecheck && pnpm --filter web build` Expected: PASS.

- [ ] **Step 3: Commit (staged).**
```bash
git add apps/web/components/studio/GenerateCard.tsx
git commit -m "feat(web): GenerateCard — editable proposal, live price, spend-once Generate via coworkGenerate (SP1 plan-2)"
```

---

### Task 10: Integration gate (mock-$0 verify + Codex)

**Files:**
- Create: `scripts/verify-cowork-plan2.mjs`

- [ ] **Step 1: Kill stale fal workers + confirm mock.** `ps aux | grep -iE "worker|tsx" | grep -v grep` → kill any stray cowork/fal worker (per the `lesson-stale-fal-worker` rule). Confirm `GENERATION_PROVIDER` is unset/mock + `COWORK_PROVIDER` unset for the run.

- [ ] **Step 2: Mock-$0 verify script** (proves the spend-once + threadId-tag + no-leak invariants without importing the `"use server"` modules, mirroring `verify-cowork-turn.mjs`: replicate `coworkGenerate`'s server-build + call the REAL `startGen` is not node-importable, so prove the load-bearing DB invariants):
```js
// Proves Plan-2 money-safety at $0 (local dev DB), following the repo verify idiom
// (no "use server" import). Asserts: (1) a GenJob tagged threadId is EXCLUDED from
// getRecentGenResults' filter; (2) a Generation tagged threadId is EXCLUDED from the
// candidate + project-media filters; (3) idempotencyKey "cowork:<cardId>" + the
// partial-unique index dedupes a same-key active job (the double-spend guard).
import { readFileSync } from "node:fs";
const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (process.env.GENERATION_PROVIDER === "fal" || process.env.COWORK_PROVIDER === "fal") { console.error("✗ refusing: a fal provider is set"); process.exit(1); }
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID } = await import("../packages/core/dist/index.js");
let failed = false; const check = (l, ok, d) => { console.log(`${ok ? "✓" : "✗"} ${l}`, d ?? ""); if (!ok) failed = true; };
const created = { projects: [] };
try {
  const project = await prisma.project.create({ data: { id: newId(), name: "plan2 verify" } });
  created.projects.push(project.id);
  const tid = newId();
  // a cowork-tagged GenJob + Generation
  await prisma.genJob.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", entityIds: [], count: 1, model: "seedream", kind: "IMAGE", status: "DONE", threadId: tid } });
  const asset = await prisma.asset.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, contentHash: "p2-" + newId(), ext: "png", mime: "image/png", sizeBytes: 1n, source: "GENERATED" } });
  await prisma.generation.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, shotId: null, threadId: tid, assetId: asset.id, source: "GENERATED", promptText: "x", modelRef: "seedream", version: 1 } });
  // replicate the three filters (the queries the code uses)
  const recent = await prisma.genJob.count({ where: { projectId: project.id, ownerId: FOUNDER_OWNER_ID, threadId: null } });
  const cands = await prisma.generation.count({ where: { ownerId: FOUNDER_OWNER_ID, projectId: project.id, shotId: null, threadId: null, deletedAt: null } });
  const media = await prisma.generation.count({ where: { ownerId: FOUNDER_OWNER_ID, projectId: project.id, threadId: null, deletedAt: null } });
  check("cowork GenJob excluded from getRecentGenResults filter", recent === 0, { recent });
  check("cowork Generation excluded from candidates filter", cands === 0, { cands });
  check("cowork Generation excluded from Assets filter", media === 0, { media });
  // double-spend guard: the partial-unique index on (owner, project, idempotencyKey) for ACTIVE rows
  const key = "cowork:" + newId();
  await prisma.genJob.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", entityIds: [], count: 1, model: "seedream", kind: "IMAGE", status: "QUEUED", idempotencyKey: key, threadId: tid } });
  let blocked = false;
  try { await prisma.genJob.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", entityIds: [], count: 1, model: "seedream", kind: "IMAGE", status: "QUEUED", idempotencyKey: key, threadId: tid } }); }
  catch (e) { blocked = typeof e === "object" && e !== null && e.code === "P2002"; }
  check("duplicate active cowork idempotencyKey blocked (P2002 — no double-spend)", blocked, { key });
  // result-message exactly-once: the partial-unique index blocks a 2nd GEN_RESULT for the same job
  const thread = await prisma.chatThread.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, title: "p2" } });
  const jid = newId();
  await prisma.chatMessage.create({ data: { id: newId(), threadId: thread.id, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "GEN_RESULT", seq: 1, genJobId: jid, payload: { kind: "image" } } });
  let dupResult = false;
  try { await prisma.chatMessage.create({ data: { id: newId(), threadId: thread.id, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "GEN_RESULT", seq: 2, genJobId: jid, payload: { kind: "image" } } }); }
  catch (e) { dupResult = typeof e === "object" && e !== null && e.code === "P2002"; }
  check("duplicate GEN_RESULT for same genJobId blocked (worker resume can't double-append)", dupResult, { jid });
  if (failed) { console.error("\n✗ Plan-2 money-safety verify FAILED"); process.exit(1); }
  console.log("\n✓ Plan-2: cowork media isolated from all 3 views, double-spend blocked, result-message exactly-once, $0");
} finally {
  for (const id of created.projects) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: id } } }).catch(() => {});
    await prisma.chatThread.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.generation.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.genJob.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
}
```

- [ ] **Step 3: Build deps + run.**
Run: `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build && node scripts/verify-cowork-plan2.mjs 2>&1 | grep -E "✓|✗"`
Expected: all ✓, ending `✓ Plan-2: cowork media isolated from all 3 views, double-spend blocked, $0`.

- [ ] **Step 4: Full gate.** `pnpm -r typecheck && pnpm --filter @fikirtive/core test && pnpm --filter web build` Expected: all green.

- [ ] **Step 5: Commit (staged).**
```bash
git add scripts/verify-cowork-plan2.mjs
git commit -m "test(cowork): mock-\$0 verify Plan-2 isolation + double-spend guard (SP1 plan-2)"
```

- [ ] **Step 6: STOP — Codex money-safety gate.** `/codex review` the Plan-2 diff. Focus: `coworkGenerate` spends ONLY via `startGen` (no direct `GenJob` create) and builds the genRequest server-side from the persisted card (never client model/count/price); `threadId` is derived server-side (anti-spoof); the 3 leak filters are complete; the worker's `GEN_RESULT` write is best-effort + exactly-once + post-commit (can't affect spend); the Generate button is disabled-once-generated (re-spend guard). Address P1/P2. Then (only with explicit user authorization) the standard prod deploy: `migrate:deploy` then `railway up --service web`/`--service worker`.

---

## Self-Review

**Spec coverage (Plan-2 scope):** new Cowork surface (T7, T8) ✓; Generate card reusing MentionInput (T9) ✓; persisted `idempotencyKey=cowork:<cardId>` (T6) ✓; live re-derived price, display-only (T9) ✓; fresh server-built genRequest with `safeParse`+Guardian as the sole gate (T6) ✓; staged reveal of agent messages (T8 renders PLAN→TEXT→GEN_CARD by seq) ✓; `GenJob.threadId IS NULL` filter (T2) plus the two `Generation`-table filters the maps missed (T4) ✓; no autonomy dropdown (Always-Ask only — T9 has just a Generate button) ✓. **Decisions honored:** D1 full plumbing (T1/T2/T3/T4) ✓; D2 persisted GEN_RESULT via the worker (T3) ✓.

**Money-safety:** the agent (`coworkTurn`) never spends (Plan-1, unchanged); the only spend is the user Generate click → `coworkGenerate` → `startGen` (sole `safeParse`+`checkCast` gate, logic unchanged — only an additive `threadId`). Server-built genRequest (no client model/count/price). `idempotencyKey` stable per card; Generate disabled once generated (re-spend guard); poll-timeout non-retryable; worker GEN_RESULT write is post-commit best-effort (can't re-charge). Verified by T10's mock-$0 script + the Codex gate.

**Placeholder scan:** every code step has complete code; the only adapted-not-verbatim parts are the presentational CSS class names in T8/T9 (explicitly noted to follow the existing `.genspace-*` design tokens — logic is complete).

**Type consistency:** `ChatThreadDTO`/`ChatMessageDTO` (T5) consumed unchanged by T7 (`Studio` prop), T8 (`Cowork`), T9 (`GenerateCard`). `coworkGenerateRequest` (T6, core) consumed by `coworkGenerate` (T6, web) and called by `GenerateCard` (T9) with `{cardId, prompt, entityIds, variantSel}`. `genRequest.threadId` (T2) is set by `coworkGenerate` (T6) and persisted by `startGen` (T2) → read by the worker (T3) → filtered by the 3 queries (T2/T4). GEN_CARD payload fields (`kind/model/params/reason/downgraded/structuredPrompt/entityIds/variantSel`) written by Plan-1 `coworkTurn` are read by `toChatMessageDTO` (T5) and `coworkGenerate` (T6) and `GenerateCard` (T9) — consistent.
