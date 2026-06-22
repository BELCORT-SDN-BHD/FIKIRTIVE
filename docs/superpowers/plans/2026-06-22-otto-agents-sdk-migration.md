# Otto → OpenAI Agents SDK Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Otto's hand-rolled `cowork` planner pipeline with a multi-step agent built on the OpenAI Agents SDK, while keeping the money machine external and metering all paid-API spend (generation + every LLM call) through the credits ledger.

**Architecture:** Otto is an OpenAI Agents SDK `Agent` in a shared `@artlio/otto` package imported by both `apps/web` (interactive turns) and `apps/worker` (auto-resume turns). `RunState` persists to Neon Postgres on `ChatThread`. Spend stays in the existing `startGen`/credits/pg-boss path; Otto only proposes ($0) and triggers `generate` behind a `needsApproval` human gate. Otto-LLM tokens are metered via reserve→settle on the credits ledger.

**Tech Stack:** TypeScript, pnpm monorepo, Next.js 16 (`apps/web`), pg-boss worker (`apps/worker`), Prisma 7 + Neon, vitest, `@openai/agents` + `@openai/agents-extensions` + `@ai-sdk/anthropic` (NEW), Cloudflare R2, fal.

**Source spec:** [`docs/superpowers/specs/2026-06-22-otto-agent-sdk-migration-design.md`](../specs/2026-06-22-otto-agent-sdk-migration-design.md) (triple-reviewed v2).

## Global Constraints

- **Node floor exactly 22** — `@openai/agents` requires Node ≥22; keep `node:22-trixie-slim` on both images. Do not bump or drop below 22.
- **Money machine unchanged except three gated changes** — GEN `reserveCredits`/`settleCredits`/`refundReservation`, the worker `gen.ts`, `genRequest` + `superRefine`, and the fal wiring in `packages/generation/src/index.ts` are byte-for-byte unchanged. The ONLY money-machine changes are (A) variable settle in `credits.ts`, (B) the `GenJob_cowork_idempotency_once` predicate migration, (C) metering wraps on all LLM entrypoints. Every diff touching these runs the `money-safety-review` skill + Codex before merge.
- **Credit units** — display 1 USD = 10 credits ($0.10); **internal ledger 1 internal credit = $0.01** (`CREDITS_PER_USD = 100`, `INTERNAL_PER_DISPLAY = 10`, `packages/core/src/spend.ts`). All balance math/debits in internal credits.
- **Otto-LLM spend = reserve→settle, never post-paid debit** — reserve a turn budget (atomic, never-negative) BEFORE any model call; settle actual + release remainder after. The provider is never called without a successful reserve.
- **Identity from the verified session only** — `requireOwner()`/`auth()` (`apps/web/lib/auth-guard.ts`); pass `orgId` (= `ownerId` under org-as-tenant) to the ledger. Never trust model/body for identity.
- **Idempotency key stays `cowork:<cardId>` through Phase 1/2** — the prefix rename to `otto:` happens only in Phase 3, together with the index-predicate migration. Never introduce an `otto:`-prefixed spend key before that migration lands.
- **No new `CreditTxnKind` enum value** — reuse `RESERVE`/`SETTLE`; variable settle extends SETTLE semantics.
- **Naming** — new code is `otto`; no symbol named `planner`. The `cowork → otto` rename is Phase 3 only.
- **No legacy/shadow engine** — direct cutover gated by local QA + money-safety-review + Codex; rollback is `git revert` + redeploy.
- **Deploy** — push to `main` → Railway `NEEDS_APPROVAL`; approve web (runs `prisma migrate deploy`) then worker; verify live before claiming deployed.

---

## Phase 0 — Spike (GO/NO-GO gate)

> Phase 0 validates the unvalidated externals. Run it on the local QA stack (docker postgres + worker + mock provider). **If any task's GO criterion fails, STOP and re-evaluate the spec before Phase 1** — the SDK-glue tasks in Phase 1 depend on the API shapes this spike pins down. Spike code lives under `spike/otto-agents/` and is throwaway (not merged); the one exception is Task 0.4, whose `settleReservation` prototype graduates into Phase 1 Task 1.3.

### Task 0.1: SDK install + a live Anthropic turn via the aisdk adapter

**Files:**
- Create: `spike/otto-agents/agent.ts`, `spike/otto-agents/run.ts`
- Modify: root `package.json` (add deps to a spike workspace, or install at root temporarily)

**Steps:**

- [ ] **Step 1: Install the SDK + adapter + provider**

Run: `pnpm add @openai/agents @openai/agents-extensions @ai-sdk/anthropic ai zod -w`
Confirm Node: `node -v` → must print `v22.x` or higher.

- [ ] **Step 2: Build a trivial agent wired to Anthropic through the beta aisdk adapter**

```ts
// spike/otto-agents/agent.ts
import { Agent } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions";
import { anthropic } from "@ai-sdk/anthropic";

export const spikeAgent = new Agent({
  name: "SpikeOtto",
  instructions: "You are a terse assistant. Answer in one sentence.",
  model: aisdk(anthropic("claude-opus-4-8")),
});
```

- [ ] **Step 3: Run one turn and dump the usage shape**

```ts
// spike/otto-agents/run.ts
import { run } from "@openai/agents";
import { spikeAgent } from "./agent.js";

const result = await run(spikeAgent, "Say hello.");
console.log("FINAL:", result.finalOutput);
console.log("AGG USAGE:", JSON.stringify(result.state.usage ?? null));
console.log("PER-REQUEST:", JSON.stringify((result as any).requestUsageEntries ?? result.state?.requestUsageEntries ?? null));
console.log("RAW RESPONSES:", Array.isArray((result as any).rawResponses) ? (result as any).rawResponses.length : "n/a");
```

Run: `ANTHROPIC_API_KEY=... npx tsx spike/otto-agents/run.ts`

- [ ] **Step 4: Record GO/NO-GO**

GO if: the turn completes with `finalOutput`, AND a per-call/per-request token count is reachable (either `requestUsageEntries` or by summing `rawResponses` usage). Record the EXACT field path that yields per-call input/output tokens — Phase 1 Task 1.3 reads it for the `settle actual`. NO-GO if the adapter errors or no per-call usage is exposed (then metering granularity falls back to per-turn aggregate `result.state.usage`; note that and continue).

### Task 0.2: RunState pause / persist / rehydrate / single-use

**Files:** Create: `spike/otto-agents/approval.ts`

**Steps:**

- [ ] **Step 1: Add a needsApproval tool that records when it actually executes**

```ts
// spike/otto-agents/approval.ts
import { Agent, run, tool, RunState } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

let executions = 0;
const spend = tool({
  name: "spend",
  description: "Spend money. Always needs approval.",
  parameters: z.object({ cardId: z.string() }),
  needsApproval: true,
  execute: async ({ cardId }) => { executions += 1; return { ok: true, cardId, executions }; },
});

export const agent = new Agent({
  name: "ApprovalSpike",
  instructions: "When asked to spend, call the spend tool with cardId 'c1'.",
  model: aisdk(anthropic("claude-opus-4-8")),
  tools: [spend],
});
export { executions };
```

- [ ] **Step 2: Run until it parks on approval; serialize state to a string; print it**

```ts
let r = await run(agent, "Spend on card c1.");
if (r.interruptions?.length) {
  const serialized = r.state.toString();          // RunState → string
  require("node:fs").writeFileSync("/tmp/otto-runstate.json", serialized);
  console.log("PARKED. interruptions:", r.interruptions.length);
}
```

- [ ] **Step 3: In a FRESH process, rehydrate + approve + run; confirm execute runs exactly once**

```ts
// spike/otto-agents/resume.ts
import { run, RunState } from "@openai/agents";
import { agent } from "./approval.js";
const serialized = require("node:fs").readFileSync("/tmp/otto-runstate.json","utf8");
const state = await RunState.fromString(agent, serialized);   // needs the SAME agent instance
state.approve(state.getInterruptions?.()[0] ?? (state as any).interruptions[0]);
const r = await run(agent, state);
console.log("AFTER RESUME finalOutput:", r.finalOutput);
// Re-load the SAME serialized string again, approve again, run again:
const state2 = await RunState.fromString(agent, serialized);
try { state2.approve((state2 as any).interruptions[0]); const r2 = await run(agent, state2); console.log("SECOND RESUME ran again?", r2.finalOutput); }
catch (e) { console.log("SECOND RESUME rejected (good):", String(e)); }
```

Run: `ANTHROPIC_API_KEY=... npx tsx spike/otto-agents/resume.ts` (after the park step wrote `/tmp/otto-runstate.json`).

- [ ] **Step 4: Record GO/NO-GO**

GO if: rehydrate succeeds across a fresh process AND the tool `execute` fires exactly once for one approval. Record whether re-approving the same serialized state re-executes (if yes, our DB idempotency index is the single-use backstop — note it; that is acceptable because the `generate` tool keys on the stable `cowork:<cardId>` index). NO-GO if rehydrate throws or one approval double-executes with no DB backstop.

### Task 0.3: Worker can import the agent and run a resume turn

**Files:** Create: `spike/otto-agents/worker-resume.ts`

**Steps:**

- [ ] **Step 1: Simulate the worker path — a standalone script imports the agent and runs a turn from a serialized RunState**

```ts
// spike/otto-agents/worker-resume.ts  (stands in for apps/worker importing @artlio/otto)
import { run, RunState } from "@openai/agents";
import { agent } from "./approval.js";
const serialized = require("node:fs").readFileSync("/tmp/otto-runstate.json","utf8");
const state = await RunState.fromString(agent, serialized);
const r = await run(agent, state);   // worker rebuilds the identical agent graph by importing it
console.log("WORKER RAN OTTO TURN:", r.finalOutput);
```

- [ ] **Step 2: Record GO/NO-GO**

GO if a non-web Node process that imports the agent module can run a turn. NO-GO if the agent requires web-only globals. (This confirms §8: auto-resume runs in the worker via the shared `@artlio/otto` package.)

### Task 0.4: Variable-settle ledger prototype (graduates to Phase 1)

**Files:** Test: `packages/db/src/credits.spike.test.ts` (rename to real test in Task 1.3)

**Steps:**

- [ ] **Step 1: Read the current ledger to confirm the gap**

Run: `codegraph node packages/db/src/credits.ts` (or Read it). Confirm `settleCredits` settles the full reserved amount with no variable-actual path, and the `CreditLedger_finalizer_once` / `(orgId,refId,kind)` unique indexes.

- [ ] **Step 2: Write a failing test for variable settle against a test DB**

```ts
// packages/db/src/credits.spike.test.ts
import { describe, it, expect } from "vitest";
// settleReservation(tx,{orgId,refId,actualInternal}) should:
//   settle min(actualInternal, reserved), release (reserved - actual) back to balance, idempotent on (orgId,refId)
it("variable settle releases the unspent remainder", async () => {
  // reserve 1000 internal, settle actual 300 → balance back up by 700, ledger shows SETTLE 300
  // (use the repo's existing credits test harness / prisma test client)
});
```

- [ ] **Step 3: Run it, confirm it fails** (`settleReservation` not defined). Run: `pnpm --filter @artlio/db test -- credits.spike`

- [ ] **Step 4: Record GO/NO-GO**

GO if the variable-settle semantics are implementable with the existing schema (reuse SETTLE kind + a release adjustment, no new enum). This becomes Phase 1 Task 1.3's real implementation. NO-GO only if the schema genuinely cannot express it without a new enum (then the spec's "no new enum" claim is revisited).

### Task 0.5: Spike results + decision

- [ ] **Step 1: Append a `## Phase 0 results` section to this plan** recording each task's GO/NO-GO, the exact per-call usage field path (0.1), the single-use finding (0.2), and any spec deltas. If all GO, proceed to Phase 1. If any NO-GO, list the spec changes needed and STOP for re-review.
- [ ] **Step 2: Remove the spike workspace deps if they were added only for spiking** (Phase 1 re-adds them to the real packages). Do NOT commit `spike/`.

---

## Phase 1 — Build (local QA only; keep `cowork:` keys; no cutover)

> All Phase 1 work is verified on the local QA stack with the mock provider (zero real spend). Money-machine tasks (1.3, 1.5, 1.7) run `money-safety-review` before their commit. The exact `@openai/agents` call shapes in 1.6/1.8/1.9 use the signatures confirmed in Phase 0.

### Task 1.1: Scaffold the `@artlio/otto` package

**Files:**
- Create: `packages/otto/package.json`, `packages/otto/tsconfig.json`, `packages/otto/src/index.ts`, `packages/otto/src/instructions.md`, `packages/otto/src/otto.ts`
- Modify: root `pnpm-workspace.yaml` (already globs `packages/*` — confirm), `package.json` `onlyBuiltDependencies` if needed.

**Interfaces:**
- Produces: `export const otto: Agent` (the assembled agent), `export { ottoInstructions }`. Imported by `apps/web` and `apps/worker`.

- [ ] **Step 1: Create the package manifest**

```json
// packages/otto/package.json
{
  "name": "@artlio/otto",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@openai/agents": "*", "@openai/agents-extensions": "*", "@ai-sdk/anthropic": "*",
    "@artlio/core": "workspace:*", "@artlio/db": "workspace:*", "zod": "*"
  }
}
```

- [ ] **Step 2: Move `COWORK_PLANNER_SYSTEM` content into `instructions.md`** (identity/rules only; drop the "respond with ONLY a JSON object" envelope instructions — the SDK does tool-calling natively). Read it from `packages/core/src/cowork-planner.ts:5-17` and adapt.

- [ ] **Step 3: Write the assembly** (`otto.ts`) — model via `aisdk(anthropic(...))`, `instructions` from the md, `tools: [propose, generate]` (added in 1.4/1.5), `modelSettings` with `maxTokens = outputCap`, and `maxTurns` (the runaway cap).

- [ ] **Step 4: Commit**

```bash
git add packages/otto && git commit -m "feat(otto): scaffold @artlio/otto shared agent package"
```

### Task 1.2: Config constants (caps + per-category margin lookup)

**Files:** Create: `packages/core/src/otto-budget.ts`; Test: `packages/core/src/otto-budget.test.ts`

**Interfaces:**
- Produces: `oneStepFloorInternal(model, margin): number`, `turnBudgetInternal(model, margin, maxSteps): number`, constants `OTTO_CONTEXT_CAP_TOKENS`, `OTTO_OUTPUT_CAP_TOKENS`, `OTTO_MAX_STEPS`.

- [ ] **Step 1: Write failing tests for the floor math in INTERNAL credits**

```ts
import { describe, it, expect } from "vitest";
import { oneStepFloorInternal, turnBudgetInternal } from "./otto-budget.js";
it("floor is ceil(usd*margin/0.01) internal credits — no 10x display error", () => {
  // model price input $15/1M, output $75/1M; ctx 12000, out 1500, margin 3
  // oneStepMaxUsd = 12000*15e-6 + 1500*75e-6 = 0.2925 ; *3 /0.01 = 87.75 → ceil 88 internal
  expect(oneStepFloorInternal({ inputPerToken: 15e-6, outputPerToken: 75e-6 }, 3)).toBe(88);
});
it("turn budget = maxSteps * floor", () => {
  expect(turnBudgetInternal({ inputPerToken: 15e-6, outputPerToken: 75e-6 }, 3, 10)).toBe(880);
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @artlio/core test -- otto-budget`
- [ ] **Step 3: Implement** using `CREDITS_PER_USD`/`INTERNAL_PER_DISPLAY` from `spend.ts` (import, don't hardcode 0.01). Prices come from the model registry; margin from runtime config (per category).
- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(otto): per-turn credit budget math (internal units)`.

### Task 1.3: Variable settle in the credits ledger (money-machine change A)

**Files:** Modify: `packages/db/src/credits.ts`; Test: `packages/db/src/credits.test.ts` (extend); run `money-safety-review` before commit.

**Interfaces:**
- Produces: `settleReservation(tx, { orgId, refId, actualInternal }): Promise<void>` — settles `min(actualInternal, reserved)` as SETTLE, releases `reserved - actual` back to `CreditAccount.balance`, idempotent on `(orgId, refId)` (re-call is a no-op).

- [ ] **Step 1: Write failing tests** (graduate Task 0.4's spike test):
  - reserve 1000, `settleReservation` actual 300 → balance += 700, ledger SETTLE row = 300, RESERVE row remains 1000.
  - idempotent: calling `settleReservation` twice with the same `(orgId,refId)` does not double-release.
  - actual ≥ reserved → settles the full reserved, releases 0.
  - never drives balance negative.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** reusing the existing SETTLE kind + an atomic release update inside the passed `tx`; key the no-op on the existing finalizer/ref-kind unique. **No new `CreditTxnKind`.**
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: `money-safety-review` + commit** `feat(credits): variable settle for reserve-then-actual (Otto-LLM)`.

### Task 1.4: `propose` tool ($0)

**Files:** Create: `packages/otto/src/tools/propose.ts`; Test: `packages/otto/src/tools/propose.test.ts`

**Interfaces:**
- Produces: `export const propose` (Agents SDK tool, no `needsApproval`). Input: `{ idea, kind, refs[] }`. Output (to model via `toModelOutput`): `{ cardId, shownPriceDisplay }`. Side effect: persists a `GEN_CARD` ChatMessage with display-only price; calls `suggestModel` server-side; derives `ownerId` from `ctx.session`.

- [ ] **Step 1: Write failing tests** — propose builds a card, returns cardId, sets display price only, calls `suggestModel` (cheapest capable, admin-disabled filtered), never calls `startGen`. Assert `ownerId` comes from the bridged session, not input.
- [ ] **Step 2–4: TDD** — reuse the card-building logic from `coworkTurn` (`cowork-actions.ts:386-407`). **Step 5: Commit.**

### Task 1.5: `generate` tool (the spend gate; money-machine adjacent)

**Files:** Create: `packages/otto/src/tools/generate.ts`; Test: `packages/otto/src/tools/generate.test.ts`; run `money-safety-review` before commit.

**Interfaces:**
- Consumes: `buildGenRequestFromCard` (Task 1.6), `startGen` (unchanged), `ctx.session`.
- Produces: `export const generate` — `needsApproval: true`, input `{ cardId }` ONLY. `execute` loads the owned card, builds the server-derived `genRequest`, calls `startGen({ ..., idempotencyKey: 'cowork:'+cardId })`, returns `{ genJobId, status }`.

- [ ] **Step 1: Write failing tests:**
  - `needsApproval` is `true` (constant) — assert it is not a numeric predicate.
  - approval bound to `(cardId, payloadHash)`: resuming `execute` with a different `cardId` than approved is rejected.
  - model/kind/params are reloaded from the persisted card; tool-arg overrides are ignored (anti-flip: cannot turn an image card into a video).
  - idempotency: two approved calls for one card → one `GenJob` (the all-status `cowork:` index); `startGen` called with `cowork:<cardId>`.
  - `ownerId` from session; cross-tenant cardId rejected.
- [ ] **Step 2–4: TDD.** `execute` MUST go through `startGen` (never call the fal provider or `reserveCredits` directly).
- [ ] **Step 5: `money-safety-review` + commit** `feat(otto): generate tool gated by needsApproval, server-derived from card`.

### Task 1.6: Extract `buildGenRequestFromCard` (DRY)

**Files:** Create: `packages/core/src/gen-from-card.ts`; Modify: `apps/web/lib/cowork-actions.ts` (`coworkGenerate` to call it); Test: `packages/core/src/gen-from-card.test.ts`

**Interfaces:**
- Produces: `buildGenRequestFromCard(card, { ownerId }): GenRequest` — the single server-trusted card→genRequest builder used by BOTH `coworkGenerate` (existing) and the `generate` tool (1.5). Card-trusted `kind`; re-runs the `genRequest` shape.

- [ ] **Step 1: Write failing test** asserting identical output to today's `coworkGenerate` request-building for a sample card.
- [ ] **Step 2–4: TDD;** refactor `coworkGenerate` to call it (behavior-preserving; the existing `cowork-actions` tests must stay green). **Step 5: Commit.**

### Task 1.7: Meter all paid-LLM entrypoints via reserve→settle (money-machine change C)

**Files:** Create: `packages/otto/src/meter.ts` (`withLlmBudget`); Modify: `apps/web/lib/cowork-actions.ts` (`enhancePrompt`, `coworkDraftStoryboard`); Test: `packages/otto/src/meter.test.ts`; run `money-safety-review`.

**Interfaces:**
- Produces: `withLlmBudget(orgId, refId, model, margin, fn): Promise<T>` — reserves `turnBudgetInternal` (atomic), runs `fn` (the model call), reads actual usage via the Phase-0-confirmed field path, `settleReservation` the actual, releases remainder. Throws `OutOfCreditsError` BEFORE calling `fn` if the reserve fails.

- [ ] **Step 1: Write failing tests:**
  - reserve fails (insufficient balance) → `fn` is NEVER invoked (assert with a spy); throws `OutOfCreditsError`.
  - happy path → reserve, run, settle actual, release remainder; balance nets to `-actual`.
  - two concurrent `withLlmBudget` for one org with balance for only one → exactly one runs, the other throws (atomic reserve).
  - **bypass check:** grep test — `enhancePrompt` and `coworkDraftStoryboard` both go through `withLlmBudget` (no direct transport call left).
- [ ] **Step 2–4: TDD.** Wrap `enhancePrompt`/`coworkDraftStoryboard` (and later the Otto turn, 1.8) in `withLlmBudget`.
- [ ] **Step 5: `money-safety-review` + commit** `feat(otto): meter all LLM entrypoints via reserve→settle`.

### Task 1.8: Wire Otto into web (replace `coworkTurn`)

**Files:** Create: `apps/web/app/api/otto/route.ts` (or a server action) + `apps/web/lib/otto-session.ts` (RunState ↔ ChatThread persistence, session bridge); Modify: the chat UI caller; Test: `apps/web/lib/otto-session.test.ts`

**Interfaces:**
- Consumes: `otto` (1.1), `withLlmBudget` (1.7), `requireOwner()`.
- Produces: an endpoint that runs an Otto turn (streamed), persists `RunState` to `ChatThread`, bridges the next-auth session into the run context, and wraps the run in `withLlmBudget`. On `needsApproval` / `maxTurns`, persists state + ends the request.

- [ ] **Step 1: Write failing tests** — a turn persists/restores RunState round-trip on `ChatThread`; the session ownerId reaches the tools; the turn is wrapped in `withLlmBudget`; `MaxTurnsExceededError` → graceful-degrade reply.
- [ ] **Step 2–4: TDD** using the exact `run()`/streaming/`RunState` signatures confirmed in Phase 0. Replace the `coworkTurn` call site (leave `coworkTurn` in place until Phase 3 deletion). **Step 5: Commit.**

### Task 1.9: Auto-resume in the worker

**Files:** Modify: `apps/worker/src/jobs/gen.ts` (after settle + `GEN_RESULT` write, trigger the resume turn); Create: `apps/worker/src/otto-resume.ts`; Modify: `apps/worker/Dockerfile`/env to add `ANTHROPIC_API_KEY`; Test: `apps/worker/src/otto-resume.test.ts`

**Interfaces:**
- Consumes: `otto` (1.1), `withLlmBudget`, the thread's `RunState`.
- Produces: `resumeOttoAfterGen(genJobId)` — loads the thread RunState, injects the result, runs one turn (Otto asks a PLAIN verdict question — "does this meet your expectation / anything to change?", NOT an upsell), persists state + message. Metered via `withLlmBudget`.

- [ ] **Step 1: Write failing tests** — after a gen settles, `resumeOttoAfterGen` runs an Otto turn that produces a verdict-asking assistant message and persists RunState; the resume turn reserves→settles; idempotent if the worker retries the job (don't double-run the verdict turn — key on genJobId).
- [ ] **Step 2–4: TDD.** The verdict-question phrasing lives in `instructions.md` / a small skill — keep it natural, not salesy. **Step 5: Commit.**

### Task 1.10: Otto tools/skills harness + local QA pass

- [ ] **Step 1: Confirm the only tools Otto has are `propose` + `generate`** (no shell/file/web tools — the SDK doesn't ship them by default, but assert the tool list in a test).
- [ ] **Step 2: Run the full local QA stack** ([[local-qa-stack]] recipe: docker postgres + migrate deploy + dev :3100 with `FOUNDER_ADMIN_EMAILS` + mock provider + worker). Drive a full Otto round: chat → propose card → approve generate → worker generates (mock) → auto-resume verdict turn. Verify credits reserve→settle on every LLM turn + GEN settle; balance never negative.
- [ ] **Step 3: Run the whole test suite** `pnpm -r test` → all green. **Commit** any fixes.

---

## Phase 2 — Cutover (hard gate)

### Task 2.1: Pre-cutover review gate
- [ ] Run `money-safety-review` over the full diff of the money-machine-touching files (`credits.ts`, the `generate` tool, `meter.ts`, `gen-from-card.ts`, worker resume).
- [ ] Run `/codex review` on the branch diff. Resolve every `[P1]`.

### Task 2.2: Ship
- [ ] **Step 1: Push to `main`** (`git push origin main`) → creates Railway `NEEDS_APPROVAL`.
- [ ] **Step 2: Approve `web` first** (runs `prisma migrate deploy` — the variable-settle migration is additive), then approve `worker`. Verify each `railway deployment list` = `SUCCESS`.
- [ ] **Step 3: Verify live** — sign in, run one real Otto round (real provider): generation runs, the GEN credit settles, the Otto-LLM turns reserve→settle, balance correct, the auto-resume verdict turn fires. Confirm branding/logs.
- [ ] **Step 4: Rollback path documented** — if broken, `git revert <range>` + redeploy. The money machine is unchanged so spend is safe; worst case is Otto chat.

---

## Phase 3 — Rename + retire R1 (separate gated diff)

### Task 3.1: Idempotency-index predicate migration (money-machine change B)
**Files:** Create: `packages/db/prisma/migrations/<ts>_genjob_otto_idempotency/migration.sql`; Modify: `apps/web/lib/gen-actions.ts:~141`, `apps/web/lib/cowork-actions.ts:~494`; run `money-safety-review`.
- [ ] **Step 1: Drain in-flight `cowork:` jobs** (confirm no QUEUED/GENERATING `cowork:` GenJob).
- [ ] **Step 2: Migration** — recreate `GenJob_cowork_idempotency_once` with predicate `idempotencyKey LIKE 'otto:%' OR idempotencyKey LIKE 'cowork:%'` (keep historical rows covered).
- [ ] **Step 3: Update the `startsWith("cowork:")` branch** + read guard to accept both prefixes; switch the `generate` tool to mint `otto:<cardId>`.
- [ ] **Step 4: Tests** — both `cowork:` and `otto:` keys dedup all-status. **Step 5: `money-safety-review` + commit.**

### Task 3.2: cowork → otto rename
- [ ] Rename surviving symbols (`coworkGenerate` → `ottoGenerate`, etc.), DB columns (`coworkBrief` → `ottoBrief`, additive migration + backfill), `ActionEvent type='cowork.turn'` → `'otto.turn'`, audit `via`. Update all references. Tests green.

### Task 3.3: Delete the old pipeline + retire R1
- [ ] Delete `cowork-transport.ts` (+ `cowork-transport.test.ts`), `cowork-planner.ts` (+ test), old `coworkTurn`, `getTransport`/`effectiveCoworkProvider`.
- [ ] **Confirm every paid-LLM entrypoint is metered (1.7)** — then remove `COWORK_PAID_PROVIDERS_ALLOWED` from the code AND the Railway env.
- [ ] Full suite green; `money-safety-review` on the deletion diff (ensure no metering path was removed). Ship via the Phase 2 gate.

---

## Self-Review notes (gaps to watch during execution)

- Phase 0 is a true gate: do not start Phase 1 SDK-glue tasks (1.8, 1.9) until 0.1–0.3 are GO and the exact usage field path + RunState signatures are recorded.
- `withLlmBudget` (1.7) is the single chokepoint for "no paid-LLM bypass" — every new LLM call in the future must go through it; add a lint/grep CI check if practical.
- The `generate` tool must NEVER import the fal provider or `reserveCredits` directly (1.5) — only `startGen`. A reviewer should reject any such shortcut.
- Mock provider must cover the Otto model too (local QA = zero spend) — confirm the SDK can be pointed at a fake model in test (a stub `LanguageModel`), or gate Otto behind the mock in the test harness (Task 1.10).

---

## Phase 0 results — GO (run 2026-06-22, throwaway `/tmp/otto-spike`, live Sonnet calls)

**Verdict: GO.** All critical unknowns resolved; the one "negative" finding (SDK is not exactly-once) is exactly what the design already accounts for.

**Verified versions (Node ≥22; tested on v23):** `@openai/agents@0.11.8`, `@openai/agents-extensions@0.11.8`, `@ai-sdk/anthropic@3.0.85`, `ai@6.0.208`, `zod@4.4.3`. These satisfy the adapter's peer deps (`ai ^6`, `@ai-sdk/provider ^2||^3`, `zod ^4`).

**0.1 (adapter + usage) — GO, with corrections:**
- **Adapter import path is `@openai/agents-extensions/ai-sdk` (subpath), export `aisdk`** — NOT top-level `@openai/agents-extensions`, NOT `aisdk(...)` from the package root. Wiring: `import { Agent, run, tool, RunState } from "@openai/agents"; import { aisdk } from "@openai/agents-extensions/ai-sdk"; import { anthropic } from "@ai-sdk/anthropic"; const model = aisdk(anthropic("claude-sonnet-4-6"));`
- **Per-call usage IS exposed:** `result.state.usage` (aggregate) carries `inputTokens`/`outputTokens`/`totalTokens` PLUS `requestUsageEntries[]` (per-model-call) AND `inputTokensDetails.{cached_tokens,cache_write_tokens}`. → §6 `settle actual` reads `result.state.usage.requestUsageEntries`; cache-aware settlement is possible (charge cached input at the ~0.1× rate). `result.context.usage` was null — use `result.state.usage`.

**0.2 (RunState pause / rehydrate / single-use) — GO, confirms the design:**
- `needsApproval: true` parks the turn as a `RunToolApprovalItem`; **the tool does NOT execute before approval** (verified: `exec.log` empty at park). This is the structural propose-only guarantee.
- `RunState`: serialize via `state.toString()` (~12KB, contains `$schemaVersion`), rehydrate via `await RunState.fromString(agent, str)`; approve via `state.getInterruptions()` → `state.approve(it)` → `run(agent, state)`.
- **Cross-process rehydrate + approve + run works** (fresh process resumed and executed once) → worker auto-resume (§8) is viable; the worker imports `@artlio/otto` and runs `run(agent, RunState.fromString(...))`.
- ⚠️ **The SDK is NOT exactly-once:** replaying the SAME saved pre-approval state in two fresh processes executed the tool TWICE. → Exactly-once MUST come from our DB layer, never the SDK approval. Confirms guardrail #3 / Option 1: GEN spend stays a server action behind the all-status `cowork:<cardId>` index; Otto-LLM reserve keyed on a stable per-turn `refId` (DB unique). The plan already assumes this — no change, but it is now empirically load-bearing, not theoretical.

**0.3 (worker resume) — GO:** a plain Node process (no web globals) imported the agent and ran a turn from a serialized `RunState`. The worker can host the §8 auto-resume.

**0.4 (variable settle) — GO (code-verified, build in Phase 1 Task 1.3):** `credits.ts` exposes `reserveCredits` (atomic conditional decrement `WHERE balance >= cost`), `settleCredits`, `refundReservation`; `CreditTxnKind = GRANT/RESERVE/SETTLE/REFUND/ADJUST`; finalizer `(orgId,refId,kind)` unique. Variable settle (settle ≤ reserved + release remainder, idempotent on `(orgId,refId)`) is implementable by reusing SETTLE + an atomic release update — **no new enum** (confirmed by the Codex review against the file).

**Deployment gotcha to bake into Phase 2:** `@ai-sdk/anthropic` reads `ANTHROPIC_BASE_URL` and appends `/messages`. The Claude Code dev environment sets `ANTHROPIC_BASE_URL=https://api.anthropic.com` (no `/v1`), which 404s. On Railway, **leave `ANTHROPIC_BASE_URL` unset** (provider defaults to `https://api.anthropic.com/v1`) or set it WITH `/v1`. The local QA stack / dev shell must override it the same way the spike did.

**Cost note (corrects the earlier calculator):** real Opus 4.8 = $5 in / $25 out per 1M (cached input ~$0.50/1M); Sonnet 4.6 = $3/$15. The §6 floor formula should pull these from the model registry and apply the cache-read rate to the cached portion of the input — Otto's stable prefix (instructions + brief + refs) should sit in the cached span.
