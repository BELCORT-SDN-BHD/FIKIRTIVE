# Otto Streaming Chat ("feels like Claude") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Spec: `docs/superpowers/specs/2026-06-25-otto-chat-streaming-design.md`. Research: `docs/superpowers/specs/2026-06-25-otto-chat-like-claude-research.md`.

**Goal:** Make `/otto` feel like chatting with Claude — instant user-message echo, token-streamed replies, a live "thought process", and inline cards/images — by streaming the existing Otto agent run, without touching the money/generation path.

**Architecture:** A new streaming Route Handler (`/api/otto/stream`) wraps the SAME pieces `ottoTurn` uses (`buildOttoContext`, `withLlmBudget`, `run`, `RunState`, CAS persistence) but runs the agent with `stream:true` and bridges its events into a Vercel AI SDK UI-message stream. A new client (`OttoChatStream`, `useChat`) renders streamed text + typed `tool-*`/reasoning parts. Selected per-user behind a temporary `ottoStreamEnabled` flag (founder-first); old `OttoConversation` is scaffolding, deleted on verification.

**Tech Stack:** Next.js 16 App Router, `@openai/agents` (agents-core 0.11.8), Vercel AI SDK (`ai` + `@ai-sdk/react` `useChat`), `use-stick-to-bottom`, React 19, Postgres (Prisma) ChatThread.

## Global Constraints
- **Money/generation path is UNTOUCHED.** Do not modify `gen-actions.ts`, `cowork-actions.ts` (`coworkGenerate`), `packages/otto/src/meter.ts`, the worker, or the DB schema. "Make it" still calls `coworkGenerate`. Generation result is delivered by the existing durable GEN_RESULT + the bounded poll ported from `OttoConversation`.
- **Preserve metering + state exactly:** the streamed run is wrapped in `withLlmBudget` (reserve→settle with the run's final usage), and `ChatThread.ottoState` is persisted with the existing **CAS** guard (`updateMany where ottoState = priorOttoState`).
- **ChatThread (Postgres) stays the source of truth.** Streaming is transient; persist final messages + ottoState after the stream; `useChat` hydrates from the persisted thread.
- **Theme/scope:** all UI under the `.fk` light theme; do NOT edit `globals.css` or the dark `/studio`.
- **Rollout:** `ottoStreamEnabled` = founder/allowlist only (via `requireOwner`/`isFounderAdmin`). The flag + `OttoConversation` are temporary; deleted in Task 8 after the founder verifies. No permanent fallback.
- **Cross-package builds:** changing `packages/*` needs `pnpm --filter @fikirtive/<pkg> build` before web sees it.

---

### Task 1: Dependencies + streaming-run primitive

**Files:**
- Modify: `apps/web/package.json` (add deps)
- Modify: `packages/otto/src/index.ts` (export the streaming run + event types if not already exported)
- Test: `packages/otto/src/stream.test.ts`

**Interfaces:**
- Produces: `runStreamed(otto, input, opts)` (or confirm `run(otto, input, { stream: true })`) returning a `StreamedRunResult` that is `AsyncIterable` over events with `.type` ∈ `raw_model_stream_event | run_item_stream_event | agent_updated_stream_event`, and (after consumption) `.state` (for `RunState.toString()`) and `.usage`.

- [ ] **Step 1:** Add deps: `pnpm --filter @fikirtive/web add ai @ai-sdk/react use-stick-to-bottom`. Run `pnpm --filter @fikirtive/web exec tsc -p tsconfig.json --noEmit` — expect clean.
- [ ] **Step 2:** In `packages/otto/src/index.ts`, confirm/add an export for the streaming run. Read `packages/otto/node_modules/@openai/agents-core/dist/run.d.ts` to confirm the exact streaming entry (`run(agent, input, { stream: true })` → `StreamedRunResult`) and the event union (`events.d.ts`). Export a thin `export async function runOttoStreamed(input, opts)` wrapper if it improves the seam, else re-export `run`.
- [ ] **Step 3 (failing test):** `stream.test.ts` — mock the model provider (reuse the otto test harness), run the otto agent with `stream:true` on a trivial input, assert the iterator yields at least one `raw_model_stream_event` and that `.state.toString()` is a non-empty string after consumption.
- [ ] **Step 4:** Run `pnpm --filter @fikirtive/otto exec vitest run src/stream.test.ts` — make it pass (build the package first if needed).
- [ ] **Step 5:** Commit: `feat(otto): expose streaming run + verify event/state shape`.

### Task 2: Streaming Route Handler — the bridge (money/meter/persist preserved)

**Files:**
- Create: `apps/web/app/api/otto/stream/route.ts`
- Modify: `apps/web/lib/otto-actions.ts` (extract a shared `persistOttoTurnResult(...)` helper if it reduces duplication — NO logic change; ottoTurn keeps working)
- Test: `apps/web/lib/__tests__/otto-stream-bridge.test.ts`

**Interfaces:**
- Consumes: `buildOttoContext` (otto-actions.ts:99), `withLlmBudget`, `run`(stream:true), `RunState`, `mapOttoUsage`, `OTTO_MAX_STEPS` (from @fikirtive/otto + otto-actions).
- Produces: `POST /api/otto/stream` accepting `{ threadId?, projectId, text, entityIds?, variantSel?, simple?, goalKey?, sourceGenerationId? }`, returning an AI SDK UI-message stream (SSE).

- [ ] **Step 1:** Read the AI SDK UI-message-stream API in the installed version: `apps/web/node_modules/ai/dist/index.d.ts` — confirm `createUIMessageStream`, the writer's `write(...)` part shapes (`text`, `reasoning`, `tool-input`/`tool-output` or `data-*`), and the response helper (`createUIMessageStreamResponse` / `toUIMessageStreamResponse`). Note the exact part type names for this version in a comment at the top of the route.
- [ ] **Step 2 (failing test):** `otto-stream-bridge.test.ts` — unit-test a pure `bridgeEvent(event)` mapper: `raw_model_stream_event`(token) → `{type:'text-delta', delta}`; `run_item_stream_event` with `.name==='tool_called'` & item name `propose` → a `tool-propose` part + a status `{type:'data-status', text:'planning…'}`; `reasoning_item_created` → `{type:'reasoning', ...}`. Assert the mapping for each event kind.
- [ ] **Step 3:** Implement `bridgeEvent` (pure, in the route file or a sibling `otto-stream-bridge.ts`) + the route handler: `requireOwner()` → validate project (mirror ottoTurn 143–158) → persist USER message + create/lookup thread + `priorOttoState` (mirror ottoTurn 174–226) → `buildOttoContext({ ..., simpleMode: simple })` → open `createUIMessageStream` → inside, `withLlmBudget(...)` wrapping `run(otto, runInput, { context, maxTurns: OTTO_MAX_STEPS, stream: true })`; iterate events → `writer.write(bridgeEvent(e))`; after the loop, persist assistant message + any GEN_CARD + `ottoState` via the SAME CAS path (mirror ottoTurn 297–392). Return the stream response.
- [ ] **Step 4:** Run the bridge unit test — pass. Run `pnpm --filter @fikirtive/web exec tsc --noEmit` — clean.
- [ ] **Step 5:** Commit: `feat(otto-fe): streaming /api/otto/stream — agent run bridged to AI SDK UI stream (meter+CAS preserved)`.

### Task 3: OttoChatStream client — text streaming + optimistic echo + scroll

**Files:**
- Create: `apps/web/components/otto/OttoChatStream.tsx`
- Create: `apps/web/components/otto/parts/TextPart.tsx`
- Test: render smoke (the fk test pattern)

**Interfaces:**
- Consumes: `useChat` (`@ai-sdk/react`), `useStickToBottom` (`use-stick-to-bottom`), `ChatThreadDTO`, fk components.
- Produces: `<OttoChatStream projectId entities thread onThreadUpdate onEditByHand />` (prop-compatible with how `OttoView` renders `OttoConversation`).

- [ ] **Step 1:** Implement `OttoChatStream` with `useChat({ api: '/api/otto/stream', body: { projectId, threadId, simple: true }, initialMessages: thread.messages mapped to AI SDK messages })`. Render `messages[].parts`: `text` parts → `TextPart` (Otto bubble / user bubble by role) with a blinking cursor while `status==='streaming'`. Composer → `handleSubmit`; the user message shows instantly (useChat optimistic). Reuse the fk styles from `OttoConversation` (header, bubbles, composer).
- [ ] **Step 2:** Wrap the message list with `useStickToBottom` (`scrollRef`/`contentRef`); add a "scroll to bottom" affordance shown when `!isAtBottom`.
- [ ] **Step 3:** Manual verify (local or founder flag): send a message → instant echo + token-streamed reply + auto-scroll. Confirm reload renders from the persisted thread.
- [ ] **Step 4:** Commit: `feat(otto-fe): OttoChatStream (useChat) — streamed text + optimistic echo + stick-to-bottom`.

### Task 4: Thought process — status line + collapsible reasoning

**Files:**
- Create: `apps/web/components/otto/parts/StatusLine.tsx`, `apps/web/components/otto/parts/ReasoningPart.tsx`
- Modify: `OttoChatStream.tsx`

**Interfaces:**
- Consumes: the `data-status` parts + `reasoning` parts emitted by `bridgeEvent` (Task 2).

- [ ] **Step 1:** `StatusLine` renders the latest `data-status` for an in-flight assistant turn ("Otto is thinking… / planning your ad… / making it…") with the `OttoAvatar` thinking state; hidden once the turn completes.
- [ ] **Step 2:** `ReasoningPart` renders any `reasoning` parts as a collapsible block (collapsed by default, "Otto's thinking" toggle). Graceful: if no reasoning parts arrive, render nothing (status line only).
- [ ] **Step 3:** Wire both into `OttoChatStream`'s part renderer. Manual verify the status transitions during a real turn.
- [ ] **Step 4:** Commit: `feat(otto-fe): live status line + collapsible reasoning (graceful)`.

### Task 5: Inline widgets — plan card + generation result as parts

**Files:**
- Modify: `OttoChatStream.tsx`, `apps/web/components/otto/parts/` (a `ToolProposePart` wrapper)
- Reuse (unchanged): `OttoPlanCard.tsx`, `OttoResult.tsx`

**Interfaces:**
- Consumes: `tool-propose` parts (Task 2) + the durable GEN_RESULT (via the bounded poll ported from `OttoConversation`).

- [ ] **Step 1:** Render a `tool-propose` part by mounting the existing **`OttoPlanCard`** inline (pass the card payload + `threadId`/`projectId`). "Make it" still calls `coworkGenerate` — DO NOT change that path.
- [ ] **Step 2:** Port the bounded in-flight poll from `OttoConversation` (the `hasWorkingJob` + capped poll + "Check again") so that after "Make it", the durable GEN_RESULT is fetched and rendered inline via the existing **`OttoResult`** (image / ad-pack chooser / Download / Copy / Edit by hand).
- [ ] **Step 3:** Manual verify (founder flag, real provider with the spend confirmed): propose → inline plan card → Make it → "making it…" → result renders inline. Money invariants unchanged.
- [ ] **Step 4:** Commit: `feat(otto-fe): inline plan card + generation result as stream parts (coworkGenerate unchanged)`.

### Task 6: Front door via stream + flag wiring in OttoView

**Files:**
- Modify: `apps/web/components/otto/OttoView.tsx`, `apps/web/components/otto/OttoApp.tsx` (pass the flag), `apps/web/app/otto/page.tsx` (compute `ottoStreamEnabled`)
- Modify: `OttoChatStream.tsx` / `OttoFrontDoor.tsx` (front-door first message routes through the stream when the flag is on)

**Interfaces:**
- Consumes: `requireOwner`/`isFounderAdmin` for the flag; the existing `OttoFrontDoor` goal chips.
- Produces: `ottoStreamEnabled: boolean` threaded `page → OttoApp → OttoView`.

- [ ] **Step 1:** In `page.tsx`, compute `ottoStreamEnabled` (founder/allowlist via the owner gate) and pass it down to `OttoApp` → `OttoView`.
- [ ] **Step 2:** In `OttoView`, when `ottoStreamEnabled` and a thread is active, render `OttoChatStream`; else render the existing `OttoConversation`. Front door: when the flag is on, "Let's go" / goal chip starts the conversation through the stream (create the thread, then `OttoChatStream` takes over) — reuse the existing goalKey seeding.
- [ ] **Step 3:** Typecheck clean. Manual verify: founder sees streaming; (simulate non-founder) sees classic.
- [ ] **Step 4:** Commit: `feat(otto-fe): founder-flagged OttoChatStream in OttoView + streamed front door`.

### Task 7: Smoothness polish

**Files:** Modify `OttoChatStream.tsx` + parts.

- [ ] **Step 1:** Add: a skeleton/shimmer assistant bubble before the first token; a blinking caret on the streaming text; springy message-entry transition; status-line crossfade. Use the `.fk` motion tokens.
- [ ] **Step 2:** Manual verify the feel end-to-end (founder flag): "100% smooth" check — instant echo, smooth token flow, no layout jank, smooth card/result entry.
- [ ] **Step 3:** Commit: `feat(otto-fe): streaming micro-interactions (skeleton, caret, entry transitions)`.

### Task 8: Cleanup — make streaming the only `/otto` chat (AFTER founder verification)

> GATE: run this task ONLY after the founder confirms the streaming version is good on prod. Until then, the flag + `OttoConversation` stay.

**Files:** Delete `OttoConversation.tsx`; remove the `ottoStreamEnabled` flag + branching in `OttoView`/`OttoApp`/`page.tsx`; remove `ottoTurn` + its client wrapper if now unused (grep first).

- [ ] **Step 1:** Grep for all references to `OttoConversation`, `ottoStreamEnabled`, `ottoTurn`. Remove the flag branching; make `OttoChatStream` unconditional.
- [ ] **Step 2:** Delete `OttoConversation.tsx`; delete `ottoTurn` (otto-actions) + `ottoTurn` client wrapper ONLY if grep shows zero remaining users (the front door + conversation now stream). Keep `ottoApprove` (still used). Keep all money/gen code.
- [ ] **Step 3:** `pnpm --filter @fikirtive/web exec tsc --noEmit` clean; web tests green.
- [ ] **Step 4:** Commit: `refactor(otto-fe): streaming is the only /otto chat; remove classic fallback + flag`.

---

## Notes for the implementer
- The AI SDK part-type names and the `@openai/agents` streaming event field names have changed across versions — **Task 1 Step 2 and Task 2 Step 1 are read-the-installed-`.d.ts`-first steps; use the exact names from the installed versions**, not names from memory.
- Generation is async (worker). The stream carries the conversation; the image arrives via the durable GEN_RESULT + the ported poll. Do not try to stream image bytes.
- Every spend stays behind the existing `coworkGenerate`/`startGen` path. This update changes transport + rendering only.
