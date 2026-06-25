# Otto chat "feels like Claude" — streaming chat design

> Spec for ONE focused update. Research basis: `2026-06-25-otto-chat-like-claude-research.md`.
> Scope is the chat **experience** (how Otto talks). Otto's web/**research capability** is a SEPARATE next update — out of scope here.

**Goal:** Make the `/otto` conversation feel like chatting with Claude — the user's message appears instantly, Otto's reply streams in token-by-token, Otto's live "thought process" is visible, and cards/images render smoothly inline — without touching the money/generation path.

**Decisions locked (brainstorm 2026-06-25):**
- Build the streaming surface in parallel, behind a **founder-first flag**; old `OttoConversation` stays as fallback; money path untouched until verified.
- Thinking = a **live status line** (always) + an **expandable real-reasoning block** when the model provides it (graceful degradation).
- Architecture = **Vercel AI SDK (`ai` + `@ai-sdk/react` `useChat`)** + a streaming **Route Handler** bridging the `@openai/agents` run.
- Generation stays async on the worker; the stream carries the conversation, not the image bytes.

---

## Architecture

```
Client (OttoChatStream, useChat)
   │  POST /api/otto/stream   { threadId, projectId, text, simple:true }
   ▼
Route Handler (apps/web/app/api/otto/stream/route.ts)
   1. requireOwner()  (auth, owner-scoped)              ← same gate as ottoTurn
   2. persist the USER message to ChatThread            ← durable
   3. buildOttoContext(...) + withLlmBudget reserve     ← REUSED from otto-actions
   4. Runner.run(otto, input, { stream:true })
   5. bridge events → AI SDK UI message stream (SSE):
        raw_model_stream_event       → text part (token delta)
        run_item_stream_event        → status + tool-part + reasoning part
        agent_updated_stream_event   → (n/a; single agent)
   6. on finish: settle LLM budget (actual usage) +
        persist assistant message + GEN_CARD + ottoState (CAS)  ← same as ottoTurn
   ▼
ChatThread (Postgres) = source of truth (unchanged schema)
```

**Reuse, don't rewrite, the backend.** The Route Handler is a *streaming wrapper* around the SAME pieces `ottoTurn` already uses: `buildOttoContext`, the Otto agent + its tools (`propose`, `generate`, …), `withLlmBudget` metering, ottoState CAS persistence, message persistence. Only the transport (stream vs one-shot return) and the client differ. `ottoTurn` (server action) stays for the old surface + as a fallback.

**Client.** New `apps/web/components/otto/OttoChatStream.tsx` uses `useChat({ api: "/api/otto/stream" })`:
- `initialMessages` = the persisted ChatThread (canonical on load + reload).
- `useChat` gives optimistic user echo, streamed text, typed `parts`, and reconciliation to the persisted thread on finish.
- Renders parts → React (see UX table).
- Scroll via `use-stick-to-bottom` (pins to bottom, cancels on scroll-up, `scrollToBottom` affordance).

## The five UX pieces

| Piece | Implementation |
|---|---|
| **Instant echo** | `useChat` renders the submitted user message immediately (optimistic), before any round-trip; input clears; converges to the persisted message on finish (no flicker). |
| **Token streaming** | `raw_model_stream_event` deltas → `text` parts; rendered with a blinking cursor while streaming. |
| **Thought process** | `run_item_stream_event` (`tool_called` / `tool_output` / `reasoning_item_created`) → a **status line** ("Otto is thinking… → planning your ad… → making it…"). If the model emits a real `thinking`/reasoning part, also render an **expandable reasoning block** (collapsed by default). Graceful: no reasoning → status line only. |
| **Inline widgets** | The `propose` tool's GEN_CARD → a `tool-propose` part → renders **OttoPlanCard inline** in the stream (replaces the polled card). Generation result → renders the image / ad-pack chooser inline (see money section). |
| **Smoothness** | Typing cursor; skeleton/shimmer for the assistant bubble before first token; message entry transition (springy); status-line crossfade; auto-scroll. |

## Money & generation safety (UNCHANGED path)

- **Propose is $0 + in-stream:** Otto calls `propose` during the streamed turn → GEN_CARD persisted (as today) → rendered inline as the plan card.
- **"Make it" is the existing path:** the plan card's button still calls **`coworkGenerate`** (reserve→settle, exactly-once, model gate) — already fixed + verified. **No change to this code.**
- **Generation is async (worker):** the image is produced by the worker (seconds–minutes), not streamed. After "Make it", the new UI shows a "making it…" state and renders the durable **GEN_RESULT** when it lands. **Delivery (decided): reuse the existing durable GEN_RESULT write + the bounded poll ported from `OttoConversation`** (the proven approach — re-fetch the thread while a job is in flight, capped + recoverable). The **money code is not touched**; only the rendering moves. (A job-status SSE is a possible later refinement, explicitly NOT in this update.)
- **LLM metering preserved:** `withLlmBudget` reserve→settle wraps the streamed run; settle uses the streamed run's final usage. Otto's reasoning still deducts credit exactly as today.
- **ottoState CAS preserved:** persisted after the stream completes, with the same compare-and-set guard against last-writer-wins.

## Rollout (founder-first flag)

- **Flag (decided): a per-user `ottoStreamEnabled`** — true for the founder/allowlist (via `requireOwner`/`isFounderAdmin`). `OttoView` selects `OttoChatStream` vs `OttoConversation` on it. **The flag + the old component are TEMPORARY scaffolding for the build/verify period only — NOT a permanent fallback** (prod is internal-only; a permanent fallback is dead weight).
- During the build: the founder tries the streaming version on prod and can still flip to the working classic chat to get real work done meanwhile.
- **Cleanup, IN THIS UPDATE, once the streaming version is verified: delete `OttoConversation` + the `ottoStreamEnabled` flag (and `ottoTurn`/front-door classic paths if they become unused) — the streaming version becomes the one and only `/otto` chat.** The front door's first message also goes through the stream.

## Components / files

- **New:** `apps/web/app/api/otto/stream/route.ts` (streaming bridge); `apps/web/components/otto/OttoChatStream.tsx` (useChat client); small render helpers for parts (text, reasoning block, status line) reusing fk components + `OttoPlanCard` / `OttoResult`.
- **Modified:** `OttoView.tsx` (flag-select stream vs classic); a shared `buildOttoContext`/run helper extracted from `otto-actions.ts` if needed so the Route Handler and `ottoTurn` share it (no logic change).
- **Deps:** add `ai` + `@ai-sdk/react`, `use-stick-to-bottom`.
- **Untouched (money/gen):** `gen-actions.ts`, `cowork-actions.ts` (coworkGenerate), `meter.ts`, the worker, the DB schema.
- **Temporary, then deleted on verification:** `OttoConversation.tsx`, the `ottoStreamEnabled` flag (and `ottoTurn`/front-door classic paths once unused). No permanent fallback.

## Testing / verification

- Unit: the event→part bridge (agent events map to the right parts); the metering wrapper (reserve→settle around a streamed run); ottoState CAS after stream.
- Manual (founder flag, prod or local): send a message → instant echo + streamed reply + live status; propose → inline plan card; Make it → real generation result inline; reload → thread renders from Postgres; old surface unaffected with flag off.
- Money invariants unchanged (covered by existing tests; no money code modified).

## Out of scope (next update)
- Otto's web/research **capability** (a search tool + cited results). The streaming surface here is its display vehicle; the tool itself is the next spec.
