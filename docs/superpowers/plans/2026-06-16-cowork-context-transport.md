# Cowork Context-layer-v1 + Provider-Configurable Multimodal Transport — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute task-by-task. Steps use `- [ ]`.

**Goal:** Rebuild cowork's context layer so the planner gets the cheapest representation that achieves quality (structured descriptions, ProjectBrief, rolling summary, scoped retrieval, prompt caching), and make the planner LLM transport **provider-configurable + multimodal** so it runs on Claude now and swaps to a self-hosted Modal model later with zero logic changes.

**Architecture:** "Project context store + assemble-only-relevant + describe-once-reuse, behind a provider-neutral multimodal transport; the spend gate is untouched." Grounded in the Claude-Code-context-architecture research (this is that pattern applied to a creative project). The user-agreed sequence: **Claude first, swap to the Modal self-host later (seamlessly).**

**Tech Stack:** Next.js 16 (apps/web), pnpm monorepo (packages core/db), Prisma+Neon, fal.ai. Planner transport: today fal→OpenRouter→Claude (text-only). Target: multimodal `content` + `createTransport` switch (mock|fal|modal|claude).

**MONEY-SAFETY (rule #1, invariant across every task):** the cowork agent NEVER spends. The ONLY media-spend path is the user clicking Generate → `coworkGenerate` → `startGen` (unchanged). The transport returns `{ text }` and has no handle to `startGen`/queue/fal-media. Any sub-agent (e.g. vision-describe) MUST never import `gen-actions` / touch `GenJob`. `COWORK_PROVIDER` default stays **mock** (a stray key cannot silently activate a paid provider).

---

## Phasing

- **Phase A — Transport foundation (THIS plan, detailed below).** Multimodal `content` type + provider-configurable `createTransport` + a `ModalTransport` class (the self-host seam; works once the user deploys Modal + sets env). Vision becomes structurally possible on the existing fal→OpenRouter→Claude path (image_url content). No new keys required; default behavior unchanged. Money-safe (transport-only).
- **Phase B — Context store + assembly (next plan).** `ReferenceImage.descriptionJson` (structured per best I2V/I2I axes), `ProjectBrief` (CLAUDE.md-analog, per project), `ChatThread.rollingSummary` (keep the 8-turn verbatim bound + fold older turns), scoped ref retrieval (expand descriptions only for @-mentioned entities), result compaction (one-line refs), a `ContextAssembler` seam, prompt caching on the stable head.
- **Phase C — Vision describe-and-cache (next plan).** An isolated vision sub-agent populates `descriptionJson` once at upload (see-once → describe → reuse). Requires Phase A's multimodal transport + a vision-capable backend.
- **Deferred (reserve seams only):** pgvector/graph engine; the Modal deployment itself (user's infra track — we provide the llama.cpp-server Modal code + steps when they're ready); native-Anthropic caching breakpoints if the fal path can't carry them.

---

## Phase A tasks

Files: `packages/core/src/cowork.ts` (the `ChatMessage`/`CoworkTransport` types), `packages/core/src/cowork-transport.ts` (impls + factory), `packages/core/src/cowork-transport.test.ts` (extend). Callers (`apps/web/lib/cowork-actions.ts`, `packages/core/src/cowork-planner.ts`) pass `string` content today and must stay untouched (additive widening).

### Task CT-A1: Multimodal `content` type (additive)

**Files:** `packages/core/src/cowork.ts` (`ChatMessage`), `packages/core/src/cowork-transport.test.ts`.

- [ ] **Widen `ChatMessage.content`** from `string` to `string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>` (OpenAI multimodal shape). Keep `role` unchanged. Add a short comment: the array form is for image-bearing turns only; all current callers pass `string` and are unaffected.
- [ ] **`MockTransport` + `FalTransport` pass-through:** `MockTransport` ignores messages (unchanged). `FalTransport` already forwards `messages` verbatim into the OpenRouter body — confirm it forwards the array form unchanged (OpenRouter is OpenAI-compatible and accepts image_url content for vision models). No code change should be needed beyond the type widening; verify.
- [ ] **Test:** a `ChatMessage` with array content (text + image_url) typechecks and round-trips through the transport body shape; existing string-content tests still pass.
- [ ] **Verify:** `pnpm --filter @artlio/core typecheck && pnpm --filter @artlio/core test`; `pnpm --filter web typecheck` (existing string callers unaffected).

### Task CT-A2: `ModalTransport` (OpenAI-compatible self-host seam)

**Files:** `packages/core/src/cowork-transport.ts`, `packages/core/src/cowork-transport.test.ts`.

- [ ] **Add `ModalTransport implements CoworkTransport`** (`name = "modal"`), constructor `(endpoint: string, apiKey: string, model?: string)`. `chat()` mirrors `FalTransport`'s envelope but POSTs `${endpoint}/v1/chat/completions` with `Authorization: Bearer ${apiKey}`, body `{ model, messages, ...(responseFormat ? {response_format} : {}), ...(maxTokens ? {max_tokens} : {}) }`. Forwards multimodal `content` as-is. Same `{ text }` return + same error-throw on `!res.ok`.
- [ ] **Test:** mock `fetch`; assert it POSTs to the configured endpoint with the Bearer header and parses `choices[0].message.content`; a thrown non-ok surfaces an error. (No real network.)
- [ ] **Verify:** core typecheck + test.

### Task CT-A3: provider-configurable `createTransport`

**Files:** `packages/core/src/cowork-transport.ts`, `packages/core/src/cowork-transport.test.ts`.

- [ ] **Extend `createTransport()`** to switch on `process.env.COWORK_PROVIDER`: `"fal"` → `FalTransport(FAL_KEY)` (unchanged); `"modal"` → `ModalTransport(MODAL_LLM_ENDPOINT, MODAL_LLM_KEY)` (throw if either env missing, mirroring the fal branch); anything else incl. unset → `MockTransport()` (default-safe). Keep the existing safety comment + extend it.
- [ ] **Test:** `COWORK_PROVIDER` matrix — unset→mock, `fal`+no key→throws, `modal`+no endpoint/key→throws, `modal`+both→ModalTransport. (Set/restore `process.env` per case.)
- [ ] **Verify:** core typecheck + test; `pnpm --filter web build`.

### Task CT-A4: Phase A gate + money-safety + Codex

- [ ] **Full local gate:** `pnpm -r test` (core green; worker empty-suite exit-1 is the known pre-existing quirk), `pnpm -r build`.
- [ ] **Money-safety check (state it explicitly):** the transport port returns `{ text }` only and has no handle to `startGen`/queue/fal-media; `createTransport` default is mock; no spend path added. `coworkTurn` still imports `startGen` only via `coworkGenerate` (unchanged).
- [ ] **Codex review** of the Phase-A diff (money-safety focus: transport swap can't leak into spend; default-mock preserved; additive type widening doesn't break callers).
- [ ] **NO deploy** from Phase A alone unless the user authorizes — it's transport plumbing with no behavior change (default unchanged). Bundle deploy with Phase B or on explicit request.

---

## Phase B / C (outline — separate plans when reached)

**Phase B — context store:** migrations for `ReferenceImage.descriptionJson` (Json?, structured: subject/action/setting/style/lighting/mood/camera/wardrobe/negatives), `ProjectBrief` (per-project: creative direction + entity baselines + constraints; human-authored first), `ChatThread.rollingSummary` (String?); `buildPlannerMessages` injects brief + descriptions(scoped to @-mentioned) + rolling summary, keeping the ≤8 verbatim window; planner-written summary every N turns; result-compaction one-liners; a `ContextAssembler` seam (rules now, pluggable to retrieval later); prompt caching on the stable head (needs the native-Anthropic or a cache-capable path — decide at Phase B). All propose-side, money-safe.

**Phase C — vision describe-and-cache:** an isolated vision sub-agent (a new skill, mockable $0) that runs ONE multimodal `transport.chat` per uploaded reference → structured `descriptionJson`; gated behind `COWORK_VISION_ENABLED` (default off); ONE image/turn, current-message-only, size-capped; `cowork.vision` audit event. Invariant: this sub-agent NEVER imports `gen-actions`/touches `GenJob`.

**Self-host (user's parallel infra track):** when the user deploys the Modal model, we provide the llama.cpp-server Modal Function code + GBNF grammar from `coworkTurnSchema` + the A/B-vs-Claude harness + failover; then flip `COWORK_PROVIDER=modal` only after the harness clears the pass-bar.
