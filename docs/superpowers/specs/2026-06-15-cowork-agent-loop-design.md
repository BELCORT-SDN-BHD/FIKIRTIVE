# Cowork Agent Loop (SP1) — Design (v2, post-review)

**Status:** reviewed (Codex cross-model + 6-lens workflow → APPROVE-WITH-CHANGES; all P1/P2 folded in) — pending final user review → writing-plans.
**Date:** 2026-06-15
**Research:** [`2026-06-15-hedra-cowork-teardown.md`](../research/2026-06-15-hedra-cowork-teardown.md). **Review verdict:** the spine is best-practice and ships verbatim; the blockers clustered at the LLM↔catalog↔card contract + the structured-output/retry/memory machinery + persisted-card idempotency — all fixed below.

---

## Goal

A **conversational creative-agent** on a new **Cowork** surface: the user states intent in natural language; the agent plans, **suggests a model + writes a structured prompt**, and hands back a **human-gated, editable Generate card**. No **media** spend until the user clicks **Generate**. Captures Hedra's cowork moat on the capabilities Artlio already has.

## Architecture (one sentence)

A new `Cowork` surface renders a per-project chat thread; `coworkTurn` makes a **bounded** text-LLM call to produce a validated **structured turn** (plan + reply + an optional proposed Generate card whose model is chosen by a **deterministic core `suggestModel`** and whose params are **snapped to that model's real option set**); the card is a **draft**, and its **Generate button** is the sole **media**-spend path, building a **fresh server-side `genRequest`** (the lone gate) through the **unmodified `startGen`** with a **persisted `idempotencyKey`**; references stay entity/variant-keyed.

## Tech stack

Next.js 16 + React; server actions; Prisma 7.8 + Neon; `@artlio/core` cowork modules (`cowork-transport`, `cowork-skills`/`cowork-directives`, `cowork-guardian`); `gen-actions.ts` `startGen`; pg-boss gen worker; MentionInput + Phase A–C entity/variant refs; `GEN_VIDEO_MODEL_INFO/OPTIONS` + `videoPriceUsd`; vitest.

---

## Where SP1 sits (5-sub-project roadmap)

- **SP1 — Cowork agent loop (this spec).** Chat thread + planner + human-gated Generate card → new Cowork surface. No canvas, no lip-sync, agent-suggests-model (overridable), Always-Ask only.
- **SP2** transparent-reasoning polish (real streaming + timed steps) · **SP3** infinite canvas (replaces results-as-messages) · **SP4** talking-character/lip-sync (new fal avatar model + audio) · **SP5** upscale / credits ledger / autonomous mode.

**SP1 implementation splits into two plans** (review rec — prove the money-logic before pixels):
- **Plan-1 (logic, headless):** schema + migration + `suggestModel` + `coworkTurn`, verifiable by the mock-$0 script + core tests.
- **Plan-2 (UI):** the Cowork surface + Generate card (low-risk reuse) once Plan-1's safety tests are green.

## Locked scope (user-approved)

Lip-sync/audio **excluded** (SP4) · infinite canvas **deferred** (SP3; v1 = results-as-messages) · model routing **agent-suggests / user-overrides** (deterministic, not LLM-routed) · autonomy **Always-Ask only** (no autonomous mode) · reveal **staged, no token-streaming** (honest v1 placeholder, see §UI) · **new dedicated Cowork surface**.

## The invariants (non-negotiable, review-affirmed)

1. **No media spend without a human gate.** `coworkTurn` creates **no `GenJob`, never calls `startGen`, makes no fal media call** — it only *proposes*. The **only** fal media spend is the user's **Generate click** → a **fresh, server-side-`safeParse`d `genRequest`** → the **unmodified `startGen`** (inheriting every guard: idempotency fast-path, P2002 partial-unique backstop, `checkCast` Guardian fail-closed, dispatch-fail→FAILED, poll-timeout-non-retryable, honest "charged but…" copy). The agent cannot spend even if the LLM is fully adversarial. **The planner's own cost** is a small **text-LLM** call of the same class as today's `enhancePrompt`: **bounded to ≤3 LLM calls per turn** (1 plan + ≤1 structured-output retry + ≤1 post-model-pick prompt-polish), **mock-$0 in dev** (`COWORK_PROVIDER` opt-in), **audited** via a best-effort `cowork.turn` `ActionEvent`, with a **hard per-turn call cap** so a re-plan loop can't fan out cost.
2. **References stay entity/variant-keyed** (`@mira:red-dress` + `variantSel`) — reuse MentionInput + the Phase A–C variant layer, not Hedra's raw-asset model.

---

## Components

### 1. Data model (additive migration; aligned to repo day-1 invariants)

```prisma
enum ChatRole { USER AGENT }
enum ChatMessageKind { TEXT PLAN GEN_CARD GEN_RESULT DENIAL TURN_ERROR }

model ChatThread {
  id        String   @id
  ownerId   String   @default("founder")
  projectId String
  title     String   @default("")     // truncated from the first user message (no LLM call)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  messages  ChatMessage[]
  // live-rows idiom: partial index in migration.sql WHERE "deletedAt" IS NULL
}

model ChatMessage {
  id                 String          @id
  threadId           String
  ownerId            String          @default("founder")  // every business table reserves it day 1
  role               ChatRole
  kind               ChatMessageKind                       // explicit discriminator (queryable/auditable)
  seq                Int                                    // deterministic intra-thread ordering (not ms createdAt)
  text               String          @default("")
  // body by kind — a VERSIONED zod discriminated union defined in @artlio/core; never trusted raw.
  payload            Json?
  // provenance (SP3 canvas needs the source→output edge; set on GEN_CARD/GEN_RESULT)
  genJobId           String?         // sole link to produced media; URLs rehydrated at read via getGenJob
  sourceGenerationId String?         // the asset this gen conditioned on (i2v/edit source)
  createdAt          DateTime        @default(now())
  deletedAt          DateTime?
  thread             ChatThread      @relation(fields: [threadId], references: [id], onDelete: Restrict)
  @@index([threadId, seq])
}
```

Notes: **`onDelete: Restrict`** (no cascade — `genJobId` links immutable `Generation`/spend history; a thread soft-delete cascades to messages **in app code in one `$transaction`**, tombstone idiom). **`seq`** (not ms-resolution `createdAt`) guarantees plan-before-reply ordering. **URLs are never stored** on a message (content-addressed blobs are pruned by the D21 sweep) — `genJobId` is the sole link, rehydrated at read.

`GenJob` gains an optional **`threadId String?`** (additive) so cowork-originated gens are attributable and **excluded from GenSpace's `getRecentGenResults` hydrate** (no split-brain results panel).

### 2. `suggestModel` — deterministic routing with a coercion contract (core, pure, TDD)

The LLM emits creative *intent*; a pure core function picks the model **and snaps params to that model's real option set** — so what the card shows is exactly what `startGen` accepts.

```ts
// packages/core/src/cowork-route.ts
export function suggestModel(input: {
  kind: "image" | "video";
  desiredAspect?: string;      // from the LLM, treated as a HINT
  desiredDuration?: number;    // hint
  desiredAudio?: boolean;      // hint
  hasSourceImage?: boolean;    // SERVER-derived (owned Generation id), not an LLM boolean
  hasTail?: boolean;           // SERVER-derived
}): {
  model: string;
  // snapped to the chosen model's option set — the ONLY values the card pre-fills
  params: { aspectRatio?: string; resolution?: string; durationSeconds?: number; fps?: number; audio?: boolean; count: number };
  reason: string;              // claims only capabilities the chosen model exposes
  downgraded: boolean;         // requested ≠ snapped (so the card can say "5s not available → 4s")
  requested: { aspect?: string; duration?: number };
};
```

**Empty-list semantics (the v1 catalog reality):** `kling`/`kling-2.6`/`kling-3` have `aspectRatios: []` and `resolutions: []` — aspect is **source/endpoint-derived, NOT a selectable constraint**. So:
- An empty `aspectRatios` is a **capability flag ("source-derived")**: **for i2v** it is never a disqualifier (the source frame carries the aspect, so a 9:16 i2v stays on cheap Kling). **For t2v** (no source frame) an empty-aspect model cannot honor a requested aspect, so a `desiredAspect` **excludes** it and routes to an aspect-capable model; if none/forced fallback, `downgraded`+`reason` surface that the aspect was dropped.
- `desiredAspect` is a hard filter **only for t2v models that expose explicit aspect controls**; for i2v, aspect comes from the source frame, so `desiredAspect` is ignored as a routing constraint and not pre-filled.
- After picking, **snap** `desiredDuration`/aspect/etc. to the model's actual option set (or its `videoDefaults`); never return on an empty-capable set; set `downgraded` when snapping changed a value.
- Emit `audio` + `count` so `videoPriceUsd` (which needs both) yields a **truthful** price.
- image → `seedream`.

A vitest case per (kind × aspect × duration × tail) asserts the chosen model truly exposes what `reason` claims and that snapped params pass `genRequest.superRefine`.

### 3. `coworkTurn` — the planner server action

Input (zod `.strict()`): `{ threadId, projectId, text, entityIds?, variantSel? }`.

1. Validate project + thread owned/live; load a **bounded memory window** (last N turns; see §memory).
2. Build the planner input via a **dedicated assembler** (NOT `runSkill(input:string)` — that can't carry history/refs/catalog): the memory window + the project's **available refs** (`{id,name,type}[]`) + a model-catalog summary.
3. **One LLM call** with a new **`COWORK_PLANNER_SYSTEM`** (model-agnostic; emits the structured turn), `response_format: json_object` + a `max_tokens` bound. Parse via JSON-mode `JSON.parse` (brace-slice `extractJson` demoted to last-ditch). Validate against the **core turn schema** (below). **Bounded retry: ≤1** (attempt 2 appends the zod error); on persistent failure return the **defined terminus** `{ reply: "couldn't structure that — rephrase?", proposal: null }` — **never a card**.
4. The **core turn schema** (`@artlio/core`, `.strict()`) is the LLM-trust boundary:
   - `planSteps: string[]` (bounded count/length), `reply: string`.
   - `proposal: null | { kind, desiredAspect?, desiredDuration?, desiredAudio?, structuredPrompt (≤ MAX_GEN_PROMPT), entityIds, variantSel }`.
   - **Constraints enforced in core before use:** `structuredPrompt` clamped to `MAX_GEN_PROMPT`; `desiredAspect`/`desiredDuration` ∈ known catalog values (else dropped → snapped by `suggestModel`); **`entityIds ⊆ availableRefs`** (drop hallucinated ids); **`variantSel` keys ⊆ `entityIds`**; **default to the user's explicitly @mentioned `entityIds`/`variantSel`** (carried in the input) and visually distinguish user-mentioned vs agent-proposed refs.
5. If `proposal`: **server-derive** `hasSourceImage`/`hasTail` from owned `Generation` ids (not LLM booleans) → `suggestModel(...)` → concrete model + snapped params → **video-with-variant rule** (below) → assemble a `GEN_CARD` message `{ kind, model, params (snapped), structuredPrompt, entityIds, variantSel, sourceGenerationId?, reason, downgraded, cardId }`. Estimated price is **derived at render**, not stored.
6. Persist the **user message + the agent outcome** (plan + reply + card, **or** a `DENIAL`/`TURN_ERROR` message) in **one `$transaction`** at the end with `seq` (no dangling user msg on LLM failure; mirrors `draftStoryboard`'s single transaction). Truncate the thread title from the first user message.
7. Write a best-effort **`cowork.turn` `ActionEvent`** (audit the LLM spend). Return the turn. **No `GenJob`, no media spend.**

**Video + `@entity:variant` rule (P1):** Phase C `startGen` **drops `variantSel` for video** (the variant is baked into a keyframe; i2v conditions on the source/tail frame, not entity refs). So a video proposal that references a variant must **not** present the variant as video conditioning. The planner instead **proposes an image keyframe card first** ("I'll make the red-dress frame, then animate it"), or — if an owned source `Generation` already bakes the variant — sets `sourceGenerationId`. Variant chips never imply video conditioning unless they feed a source frame.

### 4. The Generate card (UI) — a **draft**, not a command

Renders a `GEN_CARD`: model dropdown (pre-filled with the suggestion, **editable**; if the suggested id is gone from the catalog it falls back to a valid model), snapped param pills (`GEN_VIDEO_MODEL_OPTIONS`), editable structured prompt, user-vs-agent ref chips, a **price re-derived live** from the *current* model+params (`videoPriceUsd`/`GEN_PRICE_USD_PER_IMAGE` — never the propose-time price), and `Skip` · **`Generate`**, plus an inline "or tell me what to do differently." **No autonomy dropdown in v1** — a one-line "You'll always confirm before anything generates" (the real dial is SP5).

On **Generate**:
- Build a **fresh `genRequest` server-side from the card's current fields** and call **unmodified `startGen`**. **`genRequest.safeParse` is the sole gate**; the client card is never trusted; `estimatedPriceUsd` is display-only.
- **`idempotencyKey = "cowork:" + <GEN_CARD message id>`** (per-clip `:<index>` for a video batch), **persisted on the card** — so a reload / cross-tab re-click of the **same** card hits `startGen`'s dedup fast-path + the partial-unique active-job index and returns the in-flight job instead of paying twice. (The card is persistent and replayable; the ephemeral GenSpace composer's `busyRef`-only guard is **insufficient** here.) The button keeps a synchronous `busyRef` for the same-tab same-frame case.
- The client **mirrors `superRefine`** for instant feedback on an out-of-set param (server `superRefine` stays the backstop).
- **Staleness backstop:** a card can sit for hours; `checkCast` (Guardian) + `superRefine` fail-closed on a **deleted ref / removed model** before spend; `startGen`'s "Project not found." surfaces as an error bubble.

On **Skip** → dismiss + system note. On **NL "do it differently" / denial** in the composer → another `coworkTurn` (re-plan); a denial persists as a `DENIAL` message (auditable), then a fresh card.

### 5. The Cowork surface (UI) — new top-level surface in `StudioShell`

- **Left:** the thread — message stream (user / plan / reply / card / result / denial) + a composer **reusing `MentionInput`** (so `@entity:variant` + `variantSel` flow in exactly as elsewhere) + send, with a **client in-flight guard** disabling send while a turn runs.
- **Right (v1):** results render as `GEN_RESULT` messages inline; a light thread list + "new thread." (SP3's canvas reuses the existing `Canvas.tsx` placeholder nav slot, not a 3rd surface.)
- **Staged reveal (honest v1):** the client **distinguishes `{error}` from `{messages}` BEFORE animating** (error → error bubble, never a phantom plan). On success, show the plan as a **single "Here's how I'll approach this" block** (NOT fake sequential typing) with a **genuine indeterminate spinner** during the blocking call. Timed-step animation is **SP2** (backed by real streaming) — the spec flags v1 reveal as a placeholder, not the moat feature.

### 6. Thread memory (typed + bounded)

Extend core `ChatMessage` with an **`assistant`** role (today it's `system|user` only — agent turns can't feed back without this). Feed the planner a **bounded window** (last N turns or a token budget; drop-oldest, keep the system prompt + current turn) of **NL text only** (`reply` + user prompts) — **never** raw structured payloads/`planSteps`; a past gen-card is summarized in one line ("proposed a 9:16 5s Kling video of @mira"). Prevents unbounded cost/latency, self-JSON re-ingestion, and context overflow.

---

## Data flow

```
"@Mira:red-dress 做个 9:16 5秒视频" → send (in-flight guard on)
  → coworkTurn: load memory window; persist nothing yet
    → 1 LLM call (COWORK_PLANNER_SYSTEM, json mode, max_tokens) → validate turn schema (≤1 retry)
    → proposal is VIDEO + variant → rule: propose an IMAGE keyframe card first
      (or set sourceGenerationId if an owned frame already bakes red-dress)
    → suggestModel(image, ...) → seedream + snapped params; reason; price derived at render
    → ONE $transaction: persist user msg + plan + reply + GEN_CARD (seq-ordered)
    → cowork.turn ActionEvent (best-effort) → return  ❰ NO media spend ❱
  → UI: if {error} → error bubble; else plan block + reply + card (live-derived price)
  → user edits (optional) → Generate (busyRef)  ❰ user-gated ❱
    → fresh server genRequest.safeParse (sole gate) + idempotencyKey "cowork:<cardId>"
    → unmodified startGen → existing Guardian/idempotency/worker/poll
    → GEN_RESULT message (genJobId + sourceGenerationId; URLs rehydrated at read)
  → "换个角度" → coworkTurn(feedback) → DENIAL logged → fresh card → ...
```

## Error handling

LLM failure/timeout → `{error}` (UI error bubble, no card, no spend) · malformed output → ≤1 retry → fallback `{reply, proposal:null}` · planner exception after persisting nothing → user msg + `TURN_ERROR` agent msg in the one transaction (no dangling user msg) · Generate/`startGen` failure → existing semantics (Guardian block / dispatch-fail / honest post-charge copy) · denial/cancel → `DENIAL` msg, zero spend · stale card (deleted ref / removed model) → Guardian + `superRefine` fail-closed before spend.

## Reused vs net-new

**Reused:** `cowork-transport` (LLM), `cowork-skills`/`cowork-directives` (the directive *content*, applied post-model-pick), `cowork-guardian` `castFindings` (inside `startGen`), `startGen` (sole media-spend path, unmodified), MentionInput + entity/@mention + variants, `GEN_VIDEO_MODEL_*` + `videoPriceUsd`, the gen worker + poll, `draftStoryboard`'s single-`$transaction` persistence pattern.

**Net-new:** `ChatThread`/`ChatMessage` (+ `GenJob.threadId`, `assistant` role) + additive migration; `cowork-route.ts` `suggestModel` (pure, TDD); the core **turn schema** (versioned discriminated union) + **`COWORK_PLANNER_SYSTEM`**; the `coworkTurn` action (bounded-retry, transactional, audited) + its planner assembler; the Cowork surface + Generate-card component; a StudioShell nav entry.

## Testing

- **core (vitest):** `suggestModel` per (kind×aspect×duration×tail) — valid capable model, empty-aspect not a disqualifier, snapped params pass `superRefine`, `reason` truthful, price-inputs (audio+count) present; the turn schema (accepts valid, rejects malformed, clamps `structuredPrompt`, enforces `entityIds⊆availableRefs` + `variantSel⊆entityIds`).
- **web:** `pnpm -r typecheck` + `pnpm --filter web build`.
- **mock-$0 verify (the money test):** (a) `coworkTurn` (mock LLM that emits a proposal) → a `GEN_CARD` and **zero `GenJob`/zero spend**; (b) a simulated card-Generate (mock provider) → **exactly one** `GenJob` via `startGen`; (c) **two clicks of the same card** (reload/cross-tab) → **exactly one** `GenJob` (idempotencyKey works).
- **Codex** money-safety pass on the SP1 diff before deploy: agent never reaches `startGen`; card-Generate reuses all guards + the persisted idempotencyKey; no autonomous path; per-turn LLM cap holds.

## Out of scope (v1)

Infinite canvas (SP3) · lip-sync/audio (SP4) · token-streaming + timed-step reveal (SP2) · autonomous "Never ask" (SP5) · upscale · credits ledger · cross-session brand learning.

## Resolved review findings

All 6 P1 (suggestModel coercion+empty-aspect; stale-card draft contract; gen-card idempotencyKey + safeParse-sole-gate; bounded structured-output retry + json mode; typed/bounded memory + `assistant` role; ChatMessage `ownerId`/Restrict+deletedAt/`kind` enum) and the P2s (one-`$transaction` turn + `seq` + in-flight guard; dedicated `COWORK_PLANNER_SYSTEM` + post-pick directive; dedicated planner assembler + mock proposal; constrain LLM to real refs; provenance `sourceGenerationId`; clamp `structuredPrompt`) and key P3s (`cowork.turn` ActionEvent; omit disabled autonomy control; honest staged reveal + error-before-animate; `GenJob.threadId` split-brain filter; partial live-row index; the Plan-1/Plan-2 split) are incorporated above.
