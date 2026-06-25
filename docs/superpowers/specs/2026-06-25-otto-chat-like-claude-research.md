# Research: making Otto chat feel like Claude (deep-research, 2026-06-25)

105-agent deep research, adversarially verified (3-vote). Two high-confidence merged findings + ~24 sources.

## Finding 1 — Streaming + architecture (HIGH confidence)
- `@openai/agents` `Runner.run({ stream: true })` returns a **StreamedRunResult** (AsyncIterable) yielding:
  - `raw_model_stream_event` → token deltas (the assistant text)
  - `run_item_stream_event` (`.name` = `tool_called` / `tool_output` / `reasoning_item_created` / `tool_approval_requested` / `handoff_*`) → **live "proposing… / generating… / waiting for approval" status**
  - `agent_updated_stream_event` → handoffs
  - `toTextStream()` = text only, so surfacing tool status needs the **full** event stream.
- **Bridge it in a Route Handler, NOT a Server Action.** Pattern: pipe the agents stream into the **Vercel AI SDK** (`streamText` → `toUIMessageStreamResponse()`), consumed by **`useChat`** (messages as `id/role/parts`). SSE typed parts: `text` / `tool-input` / `tool-output` / `reasoning` / `step`. Multi-step runs stitched with `writer.merge` (`sendFinish:false` / `sendStart:false`).
- Verified against installed `agents-core` 0.11.8 event types.
- Sources: openai-agents-js streaming guide; ai-sdk stream-protocol; ai-sdk multistep cookbook.

## Finding 2 — Optimistic UI, thinking, generative widgets, scroll (HIGH confidence)
- **Optimistic echo:** React 19 `useOptimistic` — `addOptimistic` inside `startTransition` BEFORE the await → the user's message renders instantly; the optimistic + canonical (Postgres ChatThread) states converge in one render with no clearing flicker.
- **Inline widgets = "generative UI":** ordered typed `tool-{toolName}` parts (e.g. `tool-generateImage`) render custom React inline, in generation order (AI SDK 4.2+). This is exactly how the **plan card / generated image / ad-pack chooser** should render — as tool parts in the stream, not separate polled messages.
- **Thinking display:** Claude returns a distinct `thinking` block (type/thinking/signature) before text → render as a collapsible reasoning block. SSE `thinking_delta` exists when `thinking.display = summarized`. **CAVEAT:** summarized thinking is chunky (not token-by-token), and the newest models default to omitting it — so Otto's "thought process" is better shown as **live tool-step status** ("thinking… → planning… → making it…") than as streamed token-level reasoning.
- **Scroll:** `use-stick-to-bottom` pins to bottom via ResizeObserver (Safari lacks `overflow-anchor`), cancels on scroll-up; exposes `isAtBottom` / `scrollToBottom` + `scrollRef` / `contentRef`.
- Sources: react useOptimistic docs; ai-sdk 4.2 blog; Anthropic extended-thinking docs; use-stick-to-bottom.

## Recommended architecture (for our stack)
Next.js App Router + @openai/agents + Postgres ChatThread →
1. **New streaming Route Handler** (`/api/otto/stream`) that runs the Otto agent with `stream:true` and bridges events → Vercel AI SDK UI message stream (SSE).
2. **Client: `useChat`** (Vercel AI SDK) replaces the manual `ottoTurn` + poll loop. `useOptimistic` (or useChat's built-in) for instant user echo.
3. **Tool parts → inline React:** plan card, working/progress, generated image, ad-pack chooser all become typed `tool-*` parts rendered in-stream (kills the polling + the "appears as one block" feel).
4. **Thinking = live status** from `run_item_stream_event` names (proposing / generating / awaiting approval), with an optional collapsible block.
5. **Scroll:** `use-stick-to-bottom`.

## Key decisions / tradeoffs (for the brainstorm)
- **Adopt the Vercel AI SDK + Route Handler** (the verified path) vs incrementally bolt streaming onto server actions. The SDK is the well-trodden path but is a real architectural shift from today's `ottoTurn` server action.
- **Money safety must survive the rewrite:** the `generate` needsApproval gate + reserve→settle + exactly-once must stay intact under the streaming flow (the approval becomes a `tool_approval_requested` event + a resume call; generation result stays the worker's durable GEN_RESULT, surfaced as a tool part).
- **Generation is async (worker), not in-stream:** the image takes seconds-to-minutes on the worker. So the stream shows "making it…" (tool part) and the final image still arrives via the durable path — the stream handles the conversation, the worker handles the heavy generation.
- **Scope:** do streaming + optimistic + thinking-status + inline tool-part widgets as ONE coherent "Otto chat feels like Claude" update.
