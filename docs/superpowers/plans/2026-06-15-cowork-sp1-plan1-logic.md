# Cowork SP1 · Plan-1 (Logic, Headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Use **codegraph** (`codegraph node <symbol>`, `codegraph explore "<q>"`, `codegraph callers <symbol>`, `codegraph impact <symbol>`) instead of grep/find to locate and understand code.

**Goal:** Build the money-safe, headless core of the Cowork agent: a `coworkTurn` server action that turns a natural-language turn into a *validated structured proposal* (plan + reply + an optional Generate-card payload whose model is chosen by a deterministic `suggestModel`), persisted to a new chat thread — creating **zero** `GenJob` and never calling `startGen`.

**Architecture:** New `ChatThread`/`ChatMessage` Prisma models + `GenJob.threadId`. A pure core `suggestModel` (capability routing with param-snapping). A core `coworkTurnSchema` (the LLM trust boundary) + `COWORK_PLANNER_SYSTEM` + a bounded-retry assembler/parser. The `coworkTurn` web action orchestrates: assemble messages (bounded history + available refs + model summary) → `transport.chat` (json-mode + max_tokens) → parse/validate (≤1 retry) → `suggestModel` → persist user + agent messages in one `$transaction` → audit `cowork.turn`. No media spend. Verified by a mock-$0 script + vitest.

**Tech Stack:** Prisma 7.8 + Neon; `@fikirtive/core` (`cowork.ts`, `cowork-transport.ts`, `cowork-skills.ts`, `gen.ts`); `@fikirtive/db`; Next.js server actions; vitest.

**Spec:** [`../specs/2026-06-15-cowork-agent-loop-design.md`](../specs/2026-06-15-cowork-agent-loop-design.md) (v2, reviewed). This is **Plan-1 of 2**; Plan-2 (the Cowork UI surface + Generate card) is a separate plan that builds on this.

**House rules (non-negotiable):** money-safety #1 — `coworkTurn` NEVER calls `startGen` and creates NO `GenJob`; the planner LLM call is bounded (≤2 calls/turn incl. retry) + mock-$0 in dev (`COWORK_PROVIDER` unset) + audited; references stay entity/variant-keyed; additive migration only; TDD for core; **no auto-commit/push** (commit only when the user asks — the per-task "Commit" steps below are staged for the user to run/approve); `/codex` money-safety review before any deploy.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/db/prisma/schema.prisma` | data model | + `enum ChatRole`, `enum ChatMessageKind`, `model ChatThread`, `model ChatMessage`, `GenJob.threadId` |
| `packages/db/prisma/migrations/<ts>_cowork_threads/migration.sql` | migration | new (additive) + a partial index |
| `packages/core/src/cowork.ts` | core types/schema | `ChatMessage` role += `"assistant"`; `CoworkTransport.chat` opts += `responseFormat?/maxTokens?`; + cowork-turn types/schema/constants |
| `packages/core/src/cowork-transport.ts` | LLM transport | `FalTransport` forwards `response_format`/`max_tokens` |
| `packages/core/src/cowork-route.ts` | model routing | **new** — pure `suggestModel` |
| `packages/core/src/cowork-route.test.ts` | tests | **new** |
| `packages/core/src/cowork-planner.ts` | planner prompt/assembler/parser | **new** — `COWORK_PLANNER_SYSTEM`, `buildPlannerMessages`, `parseCoworkTurn`, `mockPlannerReply` |
| `packages/core/src/cowork-planner.test.ts` | tests | **new** |
| `packages/core/src/cowork.test.ts` | tests | + `coworkTurnSchema` cases (or a new `cowork-turn.test.ts`) |
| `packages/core/src/index.ts` | barrel | export the new symbols |
| `apps/web/lib/cowork-actions.ts` | the action | + `coworkTurn` |
| `scripts/verify-cowork-turn.mjs` | money-safety verify | **new** (mock-$0) |

---

### Task 1: Data model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_cowork_threads/migration.sql`

- [ ] **Step 1: Add the models + enums + `GenJob.threadId` to `schema.prisma`.** Use `codegraph node GenJob` (or open the file) to find the `GenJob` model; add `threadId String?` to it. Append the new enums + models near the other cowork-adjacent models:

```prisma
enum ChatRole { USER AGENT }
enum ChatMessageKind { TEXT PLAN GEN_CARD GEN_RESULT DENIAL TURN_ERROR }

model ChatThread {
  id        String        @id
  ownerId   String        @default("founder")
  projectId String
  title     String        @default("")
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  deletedAt DateTime?
  messages  ChatMessage[]

  @@index([projectId, ownerId, updatedAt]) // thread list (live-row partial index added in migration.sql)
}

model ChatMessage {
  id                 String          @id
  threadId           String
  ownerId            String          @default("founder")
  role               ChatRole
  kind               ChatMessageKind
  seq                Int
  text               String          @default("")
  payload            Json?
  genJobId           String?
  sourceGenerationId String?
  createdAt          DateTime        @default(now())
  deletedAt          DateTime?

  thread ChatThread @relation(fields: [threadId], references: [id], onDelete: Restrict)

  @@index([threadId, seq])
}
```

And on `model GenJob`, add (additive, nullable — keeps every existing money guard untouched):
```prisma
  threadId           String?   // set when a Cowork gen-card initiated this job (filters it out of GenSpace hydrate)
```

- [ ] **Step 2: Generate the migration without applying to prod.** From `packages/db`, create the migration SQL only:

Run: `cd packages/db && DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm exec prisma migrate dev --name cowork_threads --create-only`
Expected: creates `migrations/<timestamp>_cowork_threads/migration.sql` with `CREATE TABLE "ChatThread"`, `CREATE TABLE "ChatMessage"`, the two enums, and `ALTER TABLE "GenJob" ADD COLUMN "threadId"`. (Local DB only; `--create-only` does not apply.)

- [ ] **Step 3: Append a partial live-row index to the migration** (codebase idiom — matches the `WHERE deletedAt IS NULL` partial indexes in earlier migrations). Edit the generated `migration.sql`, append:
```sql
-- thread list reads only live threads (partial index, matching the repo idiom)
CREATE INDEX IF NOT EXISTS "ChatThread_project_live_idx"
ON "ChatThread"("projectId", "ownerId", "updatedAt") WHERE "deletedAt" IS NULL;
```

- [ ] **Step 4: Apply locally + regenerate the client.**
Run: `cd packages/db && DATABASE_URL="postgresql://fikirtive:fikirtive@localhost:5432/fikirtive" pnpm exec prisma migrate deploy && pnpm --filter @fikirtive/db build`
Expected: "All migrations have been successfully applied." + the Prisma client regenerates with `prisma.chatThread`/`prisma.chatMessage` + `GenJob.threadId`.

- [ ] **Step 5: Verify the tables + index exist locally.**
Run:
```bash
cd /Users/winnin/Documents/fikirtive/packages/db && node -e '
const {Client}=require("pg");const c=new Client({connectionString:"postgresql://fikirtive:fikirtive@localhost:5432/fikirtive"});
(async()=>{await c.connect();
const t=await c.query("SELECT to_regclass($1) a, to_regclass($2) b",["public.\"ChatThread\"","public.\"ChatMessage\""]);
const i=await c.query("SELECT 1 FROM pg_indexes WHERE indexname=$1",["ChatThread_project_live_idx"]);
const g=await c.query("SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2",["GenJob","threadId"]);
console.log("ChatThread:",t.rows[0].a,"ChatMessage:",t.rows[0].b,"partial idx:",i.rows.length===1,"GenJob.threadId:",g.rows.length===1);
await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})'
```
Expected: `ChatThread: ChatThread ChatMessage: ChatMessage partial idx: true GenJob.threadId: true`

- [ ] **Step 6: Commit (staged for user approval).**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): cowork ChatThread/ChatMessage + GenJob.threadId (SP1 plan-1)"
```

---

### Task 2: Core transport + `ChatMessage` extensions

**Files:**
- Modify: `packages/core/src/cowork.ts`
- Modify: `packages/core/src/cowork-transport.ts`
- Test: `packages/core/src/cowork-transport.test.ts` (exists — extend)

- [ ] **Step 1: Failing test — `FalTransport` forwards json-mode + max_tokens; `MockTransport` ignores them.** In `cowork-transport.test.ts` add:
```ts
it("FalTransport forwards response_format + max_tokens in the request body", async () => {
  let sentBody: any;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) }; }) as any;
  try {
    const { FalTransport } = await import("./cowork-transport.js");
    await new FalTransport("k").chat("planner", [{ role: "user", content: "hi" }], { responseFormat: "json_object", maxTokens: 1500 });
    expect(sentBody.response_format).toEqual({ type: "json_object" });
    expect(sentBody.max_tokens).toBe(1500);
  } finally { globalThis.fetch = orig; }
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @fikirtive/core test -- cowork-transport`  Expected: FAIL (opts not forwarded / type error).

- [ ] **Step 3: Implement.** In `cowork.ts`, extend the two types:
```ts
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
```
```ts
export interface CoworkTransport {
  readonly name: string;
  chat(
    skillId: string,
    messages: ChatMessage[],
    opts?: { mockReply?: () => string; responseFormat?: "json_object"; maxTokens?: number },
  ): Promise<{ text: string }>;
}
```
In `cowork-transport.ts`, update `FalTransport.chat` to accept + forward the opts (Mock signature already accepts `opts`; leave its body as-is):
```ts
async chat(_skillId: string, messages: ChatMessage[], opts?: { responseFormat?: "json_object"; maxTokens?: number }): Promise<{ text: string }> {
  const res = await fetch("https://fal.run/openrouter/router/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: this.model,
      messages,
      ...(opts?.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) { const detail = await res.text().catch(() => ""); throw new Error(`fal llm → ${res.status}: ${detail.slice(0, 300)}`); }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: data.choices?.[0]?.message?.content ?? "" };
}
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @fikirtive/core test -- cowork-transport && pnpm --filter @fikirtive/core typecheck`  Expected: PASS. (The `"assistant"` role widening must not break existing skills — they only emit `system`/`user`.)

- [ ] **Step 5: Commit (staged).**
```bash
git add packages/core/src/cowork.ts packages/core/src/cowork-transport.ts packages/core/src/cowork-transport.test.ts
git commit -m "feat(core): cowork transport json-mode/max_tokens + assistant role (SP1 plan-1)"
```

---

### Task 3: `suggestModel` — deterministic routing (pure, TDD)

**Files:**
- Create: `packages/core/src/cowork-route.ts`
- Create: `packages/core/src/cowork-route.test.ts`
- Modify: `packages/core/src/index.ts` (export)

Inputs come from `gen.ts` — confirm with `codegraph node GEN_VIDEO_MODEL_OPTIONS` and `codegraph node videoPriceUsd`. Key reality (verified): `kling`/`kling-2.6`/`kling-3` have `aspectRatios: []` + `resolutions: []` (aspect is **source/endpoint-derived**, NOT a selectable constraint); `videoDefaults(model)` gives first-of-each-list; image model = `seedream`.

- [ ] **Step 1: Failing tests.** `cowork-route.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { suggestModel } from "./cowork-route.js";
import { GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "./gen.js";

describe("suggestModel", () => {
  it("image → seedream with count default", () => {
    const r = suggestModel({ kind: "image" });
    expect(r.model).toBe("seedream");
    expect(r.params.count).toBeGreaterThanOrEqual(1);
  });
  it("video honours a 9:16 t2v request with a model that exposes aspect", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16" });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    // chosen model must actually expose 9:16, OR be source-derived (empty list) — never claim it falsely
    expect(o.aspectRatios.length === 0 || o.aspectRatios.includes("9:16")).toBe(true);
    if (o.aspectRatios.length) expect(r.params.aspectRatio).toBe("9:16");
  });
  it("empty-aspect (Kling-class) models are NOT disqualified by a desiredAspect", () => {
    // a model with aspectRatios:[] must remain selectable; desiredAspect is a hint, not a filter, for it
    const r = suggestModel({ kind: "video", desiredAspect: "9:16", hasSourceImage: true });
    expect(r.model).toBeTruthy(); // never throws / never empty
  });
  it("snaps an unavailable duration to the model's option set and flags downgraded", () => {
    const r = suggestModel({ kind: "video", desiredDuration: 7 });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.durations).toContain(r.params.durationSeconds);
    expect(r.downgraded).toBe(true);
  });
  it("always returns audio + count (so videoPriceUsd is truthful)", () => {
    const r = suggestModel({ kind: "video" });
    expect(typeof r.params.audio === "boolean").toBe(true);
    expect(r.params.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @fikirtive/core test -- cowork-route`  Expected: FAIL ("suggestModel is not a function").

- [ ] **Step 3: Implement `cowork-route.ts`.**
```ts
import { GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS, GEN_VIDEO_MODEL_INFO, videoDefaults, videoPriceUsd, type GenVideoModel } from "./gen.js";

export interface SuggestModelInput {
  kind: "image" | "video";
  desiredAspect?: string;      // HINT (from the LLM) — never trusted as a hard filter for empty-aspect models
  desiredDuration?: number;    // HINT
  desiredAudio?: boolean;      // HINT
  hasSourceImage?: boolean;    // SERVER-derived
  hasTail?: boolean;           // SERVER-derived
}
export interface SuggestModelResult {
  model: string;
  params: { aspectRatio?: string; resolution?: string; durationSeconds?: number; fps?: number; audio?: boolean; count: number };
  reason: string;
  downgraded: boolean;
  requested: { aspect?: string; duration?: number };
}

export function suggestModel(input: SuggestModelInput): SuggestModelResult {
  if (input.kind === "image") {
    return { model: "seedream", params: { count: 1 }, reason: "image → Seedream", downgraded: false, requested: {} };
  }
  // candidate video models: capability filter that treats empty option-lists as
  // "source/endpoint-derived" (a flag, NOT a disqualifier).
  const wantTail = !!input.hasTail;
  const candidates = (GEN_VIDEO_MODELS as readonly string[]).filter((m) => {
    const o = GEN_VIDEO_MODEL_OPTIONS[m as GenVideoModel];
    if (wantTail && !GEN_VIDEO_MODEL_INFO[m as GenVideoModel].tail) return false;
    // aspect is a hard filter ONLY for models that expose an explicit aspect list (t2v controls);
    // empty list = source-derived → always eligible.
    if (input.desiredAspect && o.aspectRatios.length > 0 && !o.aspectRatios.includes(input.desiredAspect)) return false;
    return true;
  });
  const pool = candidates.length ? candidates : (GEN_VIDEO_MODELS as readonly string[]).slice();
  // cheapest-capable by per-second rate at the model's default settings, quality (later in list) as tie-break
  const pick = pool
    .map((m) => {
      const d = videoDefaults(m as GenVideoModel);
      return { m, rate: videoPriceUsd(m as GenVideoModel, { seconds: 1, resolution: d.resolution, audio: d.audio, count: 1 }) };
    })
    .sort((a, b) => a.rate - b.rate)[0]!.m as GenVideoModel;

  const o = GEN_VIDEO_MODEL_OPTIONS[pick];
  const d = videoDefaults(pick);
  // snap params to the chosen model's option set
  const snap = <T>(want: T | undefined, list: readonly T[], fallback: T): { v: T; downgraded: boolean } =>
    want != null && list.includes(want) ? { v: want, downgraded: false } : { v: fallback, downgraded: want != null };
  const dur = snap(input.desiredDuration, o.durations, d.seconds);
  // aspect: only meaningful when the model exposes a list; else source-derived (omit)
  const aspect = o.aspectRatios.length ? snap(input.desiredAspect, o.aspectRatios, d.aspectRatio) : { v: undefined as string | undefined, downgraded: false };
  const audio = o.audioToggle && typeof input.desiredAudio === "boolean" ? input.desiredAudio : d.audio;
  const downgraded = dur.downgraded || aspect.downgraded;

  return {
    model: pick,
    params: {
      durationSeconds: dur.v,
      ...(aspect.v ? { aspectRatio: aspect.v } : {}),
      ...(o.resolutions.length ? { resolution: d.resolution } : {}),
      audio,
      count: 1,
    },
    reason: `${GEN_VIDEO_MODEL_INFO[pick].label} — ${o.aspectRatios.length ? `${aspect.v}` : "source-derived aspect"}, ${dur.v}s`,
    downgraded,
    requested: { aspect: input.desiredAspect, duration: input.desiredDuration },
  };
}
```

- [ ] **Step 4: Run → pass + typecheck.** `pnpm --filter @fikirtive/core test -- cowork-route && pnpm --filter @fikirtive/core typecheck`  Expected: PASS.

- [ ] **Step 5: Export + commit (staged).** Add `export * from "./cowork-route.js";` to `packages/core/src/index.ts`.
```bash
git add packages/core/src/cowork-route.ts packages/core/src/cowork-route.test.ts packages/core/src/index.ts
git commit -m "feat(core): deterministic suggestModel routing with param-snapping (SP1 plan-1)"
```

---

### Task 4: Cowork turn schema + planner (core, TDD)

**Files:**
- Modify: `packages/core/src/cowork.ts` (the turn schema + constants)
- Create: `packages/core/src/cowork-planner.ts`
- Create: `packages/core/src/cowork-planner.test.ts`
- Modify: `packages/core/src/index.ts` (export)

- [ ] **Step 1: Failing test — the turn schema is the LLM trust boundary.** `cowork-planner.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { coworkTurnSchema, parseCoworkTurn, mockPlannerReply, MAX_PLAN_STEPS } from "./cowork-planner.js";
import { MAX_GEN_PROMPT } from "./gen.js";

describe("coworkTurnSchema", () => {
  const refs = ["e1", "e2"];
  const ok = { planSteps: ["look at refs", "pick model"], reply: "On it.", proposal: { kind: "image", structuredPrompt: "a cat", entityIds: ["e1"], variantSel: { e1: "v1" } } };
  it("accepts a valid turn", () => {
    expect(parseCoworkTurn(JSON.stringify(ok), refs).proposal?.entityIds).toEqual(["e1"]);
  });
  it("drops entityIds not in availableRefs and variantSel keys not in entityIds", () => {
    const t = parseCoworkTurn(JSON.stringify({ ...ok, proposal: { ...ok.proposal, entityIds: ["e1", "ghost"], variantSel: { e1: "v1", ghost: "v9" } } }), refs);
    expect(t.proposal?.entityIds).toEqual(["e1"]);
    expect(Object.keys(t.proposal?.variantSel ?? {})).toEqual(["e1"]);
  });
  it("clamps structuredPrompt to MAX_GEN_PROMPT", () => {
    const t = parseCoworkTurn(JSON.stringify({ ...ok, proposal: { ...ok.proposal, structuredPrompt: "x".repeat(MAX_GEN_PROMPT + 500) } }), refs);
    expect((t.proposal?.structuredPrompt.length ?? 0) <= MAX_GEN_PROMPT).toBe(true);
  });
  it("caps planSteps and accepts a null proposal (talk-only turn)", () => {
    const t = parseCoworkTurn(JSON.stringify({ planSteps: Array(50).fill("s"), reply: "hi", proposal: null }), refs);
    expect(t.planSteps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
    expect(t.proposal).toBeNull();
  });
  it("mockPlannerReply parses cleanly through parseCoworkTurn", () => {
    expect(() => parseCoworkTurn(mockPlannerReply("make a video of @mira"), refs)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @fikirtive/core test -- cowork-planner`  Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** In `cowork.ts` add the schema + constants (reuse `MAX_GEN_PROMPT` from `gen.ts`):
```ts
import { MAX_GEN_PROMPT, MAX_GEN_ENTITIES } from "./gen.js"; // add to the existing gen import
export const MAX_PLAN_STEPS = 8;
export const COWORK_MEMORY_TURNS = 8;

export const coworkProposalSchema = z.object({
  kind: z.enum(["image", "video"]),
  desiredAspect: z.string().max(12).optional(),
  desiredDuration: z.number().int().min(1).max(60).optional(),
  desiredAudio: z.boolean().optional(),
  structuredPrompt: z.string().trim().min(1).max(MAX_GEN_PROMPT),
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
  variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
}).strict();

export const coworkTurnSchema = z.object({
  planSteps: z.array(z.string().trim().min(1).max(200)).max(MAX_PLAN_STEPS).default([]),
  reply: z.string().trim().min(1).max(2000),
  proposal: coworkProposalSchema.nullable().default(null),
}).strict();
export type CoworkTurn = z.infer<typeof coworkTurnSchema>;
```
Create `cowork-planner.ts`:
```ts
import { coworkTurnSchema, MAX_PLAN_STEPS, type ChatMessage, type CoworkTurn } from "./cowork.js";

export { MAX_PLAN_STEPS };

export const COWORK_PLANNER_SYSTEM =
  `You are Fikirtive's creative-director agent. The user describes what they want to create. ` +
  `Respond with ONLY a JSON object (no prose, no markdown fences): ` +
  `{"planSteps":["short step", ...],"reply":"a short natural-language message in the user's language","proposal":null | {"kind":"image"|"video","desiredAspect"?:"16:9","desiredDuration"?:5,"desiredAudio"?:true,"structuredPrompt":"a vivid generator prompt","entityIds":["<id>"...],"variantSel":{"<entityId>":"<variantId>"}}}. ` +
  `planSteps: 2-${MAX_PLAN_STEPS} short reasoning steps (what you'll look at, which model class, why). ` +
  `proposal: set it ONLY when the user wants something generated; otherwise null and just talk in "reply". ` +
  `Reference ONLY entity ids from the provided available-refs list; never invent ids. Do NOT choose a model or set price — that is decided downstream. ` +
  `For a VIDEO that should feature a specific character variant, propose an IMAGE keyframe first (kind:"image"); video conditions on a source frame, not on entity refs.`;

/** Build the planner messages: system + a context block + bounded NL history + the user turn. */
export function buildPlannerMessages(args: {
  userText: string;
  history: ChatMessage[];        // already windowed + NL-only (assistant/user)
  availableRefs: { id: string; name: string; type: string }[];
  modelSummary: string;          // e.g. "image: seedream; video: kling/veo3.1/... (agent picks)"
}): ChatMessage[] {
  const refsBlock = args.availableRefs.length
    ? `Available @refs (use ONLY these ids): ${args.availableRefs.map((r) => `${r.id}=${r.name}(${r.type})`).join("; ")}`
    : "Available @refs: none";
  return [
    { role: "system", content: `${COWORK_PLANNER_SYSTEM}\n\n${refsBlock}\nModels available downstream: ${args.modelSummary}` },
    ...args.history,
    { role: "user", content: args.userText },
  ];
}

/** Pull the first {...} (json-mode usually returns clean JSON; this is the fallback). */
function sliceJson(text: string): string {
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("cowork: no JSON object in planner output");
  return text.slice(s, e + 1);
}

/** Validate the (untrusted) planner output into a CoworkTurn, constraining refs to availableRefs. */
export function parseCoworkTurn(text: string, availableRefIds: string[]): CoworkTurn {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = JSON.parse(sliceJson(text)); }
  const turn = coworkTurnSchema.parse(raw);
  if (turn.proposal) {
    const allowed = new Set(availableRefIds);
    const entityIds = turn.proposal.entityIds.filter((id) => allowed.has(id));
    const variantSel: Record<string, string> = {};
    for (const [k, v] of Object.entries(turn.proposal.variantSel)) if (entityIds.includes(k)) variantSel[k] = v;
    turn.proposal = { ...turn.proposal, entityIds, variantSel };
  }
  return turn;
}

/** Deterministic $0 planner reply for dev/test (parsed like a real one). */
export function mockPlannerReply(userText: string): string {
  const t = userText.trim().replace(/\s+/g, " ").slice(0, 140);
  return JSON.stringify({
    planSteps: ["read the request", "draft a structured image prompt"],
    reply: `Here's a proposal for: ${t}`,
    proposal: { kind: "image", structuredPrompt: `${t}, cinematic lighting, rich detail`, entityIds: [], variantSel: {} },
  });
}
```

- [ ] **Step 4: Run → pass + typecheck.** `pnpm --filter @fikirtive/core test -- cowork-planner && pnpm --filter @fikirtive/core typecheck`  Expected: PASS.

- [ ] **Step 5: Export + commit (staged).** Add `export * from "./cowork-planner.js";` to `index.ts`.
```bash
git add packages/core/src/cowork.ts packages/core/src/cowork-planner.ts packages/core/src/cowork-planner.test.ts packages/core/src/index.ts
git commit -m "feat(core): cowork turn schema + planner prompt/parse (LLM trust boundary) (SP1 plan-1)"
```

---

### Task 5: `coworkTurn` server action (the money-safe orchestration)

**Files:**
- Modify: `apps/web/lib/cowork-actions.ts`
- Modify: `packages/core/src/cowork.ts` (add a `coworkTurnRequest` zod input)

Mirror the existing `coworkDraftStoryboard`/`enhancePrompt` patterns (verified above): `safeParse` → project guard → transport → **one `$transaction`** → best-effort `ActionEvent`. **It must NOT import or call `startGen`** and must create **no `GenJob`**.

- [ ] **Step 1: Add the input schema to `cowork.ts`.**
```ts
export const coworkTurnRequest = z.object({
  threadId: z.string().min(1).max(64).optional(), // absent → create a new thread
  projectId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(MAX_COWORK_IDEA),
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
  variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
}).strict();
export type CoworkTurnRequest = z.infer<typeof coworkTurnRequest>;
```

- [ ] **Step 2: Implement `coworkTurn` in `cowork-actions.ts`.** Add the imports (`coworkTurnRequest`, `buildPlannerMessages`, `parseCoworkTurn`, `mockPlannerReply`, `COWORK_MEMORY_TURNS`, `suggestModel`, `videoPriceUsd`, `GEN_PRICE_USD_PER_IMAGE`, `GEN_VIDEO_MODELS`, `GEN_MODELS`, `type ChatMessage`) and:
```ts
const PLANNER_MAX_TOKENS = 1200;

export async function coworkTurn(raw: unknown): Promise<{ threadId: string } | { error: string }> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };
  const { projectId, text, entityIds, variantSel } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  // resolve / create the thread
  let threadId = parsed.data.threadId ?? null;
  if (threadId) {
    const t = await prisma.chatThread.findFirst({ where: { id: threadId, ...OWNED }, select: { id: true } });
    if (!t) return { error: "Conversation not found." };
  } else {
    threadId = newId();
    await prisma.chatThread.create({ data: { id: threadId, ownerId: FOUNDER_OWNER_ID, projectId, title: text.slice(0, 80) } });
  }

  // bounded, NL-only memory window (assistant/user), oldest-dropped
  const recent = await prisma.chatMessage.findMany({
    where: { threadId, deletedAt: null, kind: { in: ["TEXT", "PLAN"] } },
    orderBy: { seq: "desc" }, take: COWORK_MEMORY_TURNS * 2, select: { role: true, text: true },
  });
  const history: ChatMessage[] = recent.reverse().map((m) => ({ role: m.role === "AGENT" ? "assistant" : "user", content: m.text }));

  const availableRefs = await loadAvailableRefs(projectId); // {id,name,type}[] — entities in the project
  const modelSummary = `image: ${GEN_MODELS.join("/")}; video: ${GEN_VIDEO_MODELS.join("/")} (agent picks by capability)`;
  const messages = buildPlannerMessages({ userText: text, history, availableRefs, modelSummary });

  // ≤2 LLM calls total (1 + at most 1 retry). mock-$0 in dev.
  const refIds = availableRefs.map((r) => r.id);
  let turn: import("@fikirtive/core").CoworkTurn | null = null;
  for (let attempt = 0; attempt < 2 && !turn; attempt++) {
    try {
      const { text: out } = await transport.chat("coworkPlanner", attempt === 0 ? messages : [...messages, { role: "user", content: "Your previous reply was not valid JSON for the schema. Reply with ONLY the JSON object." }], {
        mockReply: () => mockPlannerReply(text), responseFormat: "json_object", maxTokens: PLANNER_MAX_TOKENS,
      });
      turn = parseCoworkTurn(out, refIds);
    } catch { /* malformed → retry once, else fall through */ }
  }
  if (!turn) turn = { planSteps: [], reply: "I couldn't structure that — could you rephrase?", proposal: null };

  // prefer the user's explicit @mentions when the proposal omitted them
  if (turn.proposal && entityIds.length && !turn.proposal.entityIds.length) {
    turn.proposal.entityIds = entityIds;
    turn.proposal.variantSel = variantSel;
  }

  // build the gen-card payload (NO suggestModel for video-with-variant: planner already
  // proposes an image keyframe first per COWORK_PLANNER_SYSTEM)
  let cardPayload: Record<string, unknown> | null = null;
  if (turn.proposal) {
    const sm = suggestModel({
      kind: turn.proposal.kind,
      desiredAspect: turn.proposal.desiredAspect,
      desiredDuration: turn.proposal.desiredDuration,
      desiredAudio: turn.proposal.desiredAudio,
      hasSourceImage: false, // v1: no canvas source-frame yet (i2v source comes in a later slice)
      hasTail: false,
    });
    const price = turn.proposal.kind === "video"
      ? videoPriceUsd(sm.model as any, { seconds: sm.params.durationSeconds ?? 1, resolution: sm.params.resolution ?? "", audio: !!sm.params.audio, count: sm.params.count })
      : GEN_PRICE_USD_PER_IMAGE * sm.params.count;
    cardPayload = {
      kind: turn.proposal.kind, model: sm.model, params: sm.params, reason: sm.reason, downgraded: sm.downgraded,
      structuredPrompt: turn.proposal.structuredPrompt, entityIds: turn.proposal.entityIds, variantSel: turn.proposal.variantSel,
      estimatedPriceUsd: price, // DISPLAY-only; the card re-derives on Generate (Plan-2)
    };
  }

  // persist user + agent messages in ONE transaction with explicit seq (no dangling user msg)
  const last = await prisma.chatMessage.findFirst({ where: { threadId }, orderBy: { seq: "desc" }, select: { seq: true } });
  let seq = (last?.seq ?? 0);
  const rows: any[] = [
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "USER", kind: "TEXT", seq: ++seq, text, payload: { entityIds, variantSel } },
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "PLAN", seq: ++seq, text: "", payload: { planSteps: turn.planSteps } },
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "TEXT", seq: ++seq, text: turn.reply },
  ];
  if (cardPayload) rows.push({ id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "GEN_CARD", seq: ++seq, text: "", payload: cardPayload });

  await prisma.$transaction([
    prisma.chatMessage.createMany({ data: rows }),
    prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } }),
  ]);
  try {
    await prisma.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.turn", payload: { via: transport.name, hasCard: !!cardPayload, model: cardPayload?.model ?? null } } });
  } catch { /* audit best-effort */ }
  revalidatePath("/", "layout");
  return { threadId };
}
```
Add a `loadAvailableRefs(projectId)` helper near the top (reuse the entity DTO/query — confirm with `codegraph node getEntities`): returns the project's live entities as `{id, name, type}[]`.

- [ ] **Step 3: Build core + typecheck web.** `pnpm --filter @fikirtive/core build && pnpm --filter web typecheck`  Expected: PASS. (If `videoPriceUsd`'s model arg type complains, import `GenVideoModel` and cast `sm.model as GenVideoModel`.)

- [ ] **Step 4: Static money-safety check — `coworkTurn` must not reference `startGen`/`genJob.create`.**
Run: `codegraph callers startGen` (confirm `coworkTurn` is NOT a caller) and `grep -n "startGen\|genJob.create\|genRequest" apps/web/lib/cowork-actions.ts`  Expected: **no matches** in `cowork-actions.ts`.

- [ ] **Step 5: Commit (staged).**
```bash
git add packages/core/src/cowork.ts apps/web/lib/cowork-actions.ts
git commit -m "feat(web): coworkTurn — propose-only agent turn (no media spend) (SP1 plan-1)"
```

---

### Task 6: Mock-$0 verify + integration gate

**Files:**
- Create: `scripts/verify-cowork-turn.mjs`

- [ ] **Step 1: Write the verify script** (mirrors `scripts/verify-phaseC-*.mjs`: loads `packages/db/.env`, refuses `GENERATION_PROVIDER=fal`, mock transport by leaving `COWORK_PROVIDER` unset):
```js
// Proves coworkTurn is propose-only: it persists a thread + messages + a GEN_CARD and
// creates ZERO GenJob / spends $0 (COWORK_PROVIDER unset → MockTransport). Local dev DB.
// Run: node --import ./apps/worker/node_modules/tsx/dist/loader.mjs scripts/verify-cowork-turn.mjs
import { readFileSync } from "node:fs";
const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (process.env.COWORK_PROVIDER === "fal" || process.env.GENERATION_PROVIDER === "fal") { console.error("✗ refusing: a fal provider would spend"); process.exit(1); }
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId } = await import("../packages/core/dist/index.js");
const { coworkTurn } = await import("../apps/web/lib/cowork-actions.ts");

let failed = false; const check = (l, ok, d) => { console.log(`${ok ? "✓" : "✗"} ${l}`, d ?? ""); if (!ok) failed = true; };
try {
  const project = await prisma.project.create({ data: { id: newId(), name: "cowork turn test" } });
  const genJobsBefore = await prisma.genJob.count();
  const r = await coworkTurn({ projectId: project.id, text: "make an image of a calm seascape" });
  check("coworkTurn returned a threadId", !!r.threadId, r);
  const msgs = await prisma.chatMessage.findMany({ where: { threadId: r.threadId }, orderBy: { seq: "asc" } });
  const kinds = msgs.map((m) => m.kind);
  check("persisted USER+PLAN+TEXT+GEN_CARD in order", JSON.stringify(kinds) === JSON.stringify(["TEXT", "PLAN", "TEXT", "GEN_CARD"]), kinds);
  const card = msgs.find((m) => m.kind === "GEN_CARD");
  check("gen-card has a model + structuredPrompt + estimatedPriceUsd", !!card?.payload?.model && !!card?.payload?.structuredPrompt && typeof card?.payload?.estimatedPriceUsd === "number", card?.payload);
  const genJobsAfter = await prisma.genJob.count();
  check("ZERO GenJob created (no media spend)", genJobsAfter === genJobsBefore, { before: genJobsBefore, after: genJobsAfter });
  if (failed) { console.error("\n✗ coworkTurn money-safety FAILED"); process.exit(1); }
  console.log("\n✓ coworkTurn: propose-only — thread + card persisted, zero GenJob, $0");
} finally { await prisma.$disconnect(); }
```

- [ ] **Step 2: Build the deps the script imports, then run it.**
Run: `pnpm --filter @fikirtive/core build && pnpm --filter @fikirtive/db build && node --import ./apps/worker/node_modules/tsx/dist/loader.mjs scripts/verify-cowork-turn.mjs 2>&1 | grep -E "✓|✗"`
Expected: all ✓, ending `✓ coworkTurn: propose-only — thread + card persisted, zero GenJob, $0`.

- [ ] **Step 3: Full gate.**
Run: `pnpm -r typecheck && pnpm --filter @fikirtive/core test`
Expected: all packages typecheck; core tests pass (incl. the new `cowork-route` + `cowork-planner` suites).

- [ ] **Step 4: Commit (staged).**
```bash
git add scripts/verify-cowork-turn.mjs
git commit -m "test(cowork): mock-$0 verify coworkTurn is propose-only, zero GenJob (SP1 plan-1)"
```

- [ ] **Step 5: STOP — Codex money-safety gate before any deploy.** `/codex review` the Plan-1 diff, focus: `coworkTurn` creates no `GenJob` + never reaches `startGen`; the planner LLM call is bounded (≤2) + mock-$0 in dev + audited; the turn schema constrains refs (`entityIds⊆availableRefs`, `variantSel⊆entityIds`) + clamps `structuredPrompt`. Address P1/P2. Do NOT deploy (Plan-1 is headless; the surface ships in Plan-2).

---

## Self-Review

**Spec coverage (Plan-1 scope):** ChatThread/ChatMessage + GenJob.threadId (T1) ✓; `assistant` role + transport json-mode/max_tokens (T2) ✓; `suggestModel` coercion+empty-aspect contract + audio/count (T3) ✓; turn schema clamps + ref-subset constraints + COWORK_PLANNER_SYSTEM + bounded-retry parse (T4) ✓; `coworkTurn` one-`$transaction` persist + seq + server-side suggestModel + cowork.turn ActionEvent + video-variant→image-keyframe rule + no-startGen (T5) ✓; mock-$0 zero-GenJob verify + gate + Codex (T6) ✓. **Deferred to Plan-2 (UI):** the Generate card, the persisted `idempotencyKey=cowork:<cardId>`, the fresh-server-`genRequest`-on-Generate (the actual spend), live price re-derivation, staged reveal, the Cowork surface, `GenJob.threadId` filtering in `getRecentGenResults`. (Plan-1 sets the column; Plan-2 wires the filter + the spend.)

**Placeholder scan:** no TBD/TODO; every code step has complete code; the one helper left to the implementer (`loadAvailableRefs`) has a defined signature + a codegraph pointer to the existing entity query.

**Type consistency:** `CoworkTurn`/`coworkProposalSchema` fields (`planSteps`/`reply`/`proposal`/`kind`/`structuredPrompt`/`entityIds`/`variantSel`/`desiredAspect`/`desiredDuration`/`desiredAudio`) are consistent across T4↔T5; `suggestModel` `SuggestModelResult.params` (`aspectRatio`/`resolution`/`durationSeconds`/`fps`/`audio`/`count`) consumed unchanged by T5's price calc; `ChatMessageKind` literals (`TEXT`/`PLAN`/`GEN_CARD`/`GEN_RESULT`/`DENIAL`/`TURN_ERROR`) match the schema (T1) and the verify script (T6).
