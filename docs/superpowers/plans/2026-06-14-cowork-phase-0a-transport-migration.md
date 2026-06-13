# Cowork Phase 0A — chatLLM transport + migrate 2 skills (parity) Implementation Plan

> **For agentic workers:** execute task-by-task, TDD-first. Steps use `- [ ]`.

**Goal:** De-tangle cowork's `transport / knowledge / parse` for the two existing skills (`draftStoryboard`, `enhancePrompt`) behind a model-neutral `CoworkTransport`, with parity tests proving byte-for-byte unchanged skill behavior. No new features.

**Architecture:** Model-neutral engine (transport + per-skill runners) lives in **`packages/core/`** (existing package — honors the Railway "no new workspace package" rule, and the only place with a vitest harness). `apps/web` server actions stay the thin money-safety + DB boundary, now importing `createTransport` + `runSkill` from `@artlio/core`. The old `apps/web/lib/cowork-provider.ts` is deleted.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod, vitest (core harness), Next 16 server actions.

---

## Two decisions flagged (deviation + intentional behavior change)

1. **Placement deviates from spec.** The master plan said transport+runners live in `apps/web/lib/cowork/`. They instead live in `packages/core/src/` because: `apps/web` has **no test harness** (its `test` is `echo 'no tests yet'`), parity tests are mandatory (money-safety), and the repo precedent (`createGenerationProvider` lives in `packages/generation`, not the app) puts env-factory + provider impls in a package. The new code is pure/model-neutral — the most core-appropriate kind. Reversible (all new files) if rejected.

2. **R4 is the one INTENTIONAL behavior change.** `createTransport()` gates real cowork on **`COWORK_PROVIDER=fal`** (mirroring `createGenerationProvider`), NOT on `FAL_KEY` presence (today's `createCoworkProvider`). **Deploy implication:** after this lands, prod/staging must set `COWORK_PROVIDER=fal` (in addition to `FAL_KEY`) or cowork silently uses the $0 mock. This is the R4 anti-silent-spend hardening — must be coordinated with the Railway env before deploy. Everything *else* (prompts, mock outputs, error strings, money-safety scaffolding) is parity-preserved.

3. **Enhance 2000-cap unified onto the skill (documented sub-parity).** The old code was asymmetric: the FAL provider sliced its output to `MAX_ENHANCE_TEXT` internally, the mock did not (the action sliced both). A single unified `parse` cannot reproduce *both* old paths byte-for-byte because the action's trailing `.trim().slice()` composes differently with each — they diverge by **≤1 trailing-whitespace char**, only when an enhance output crosses 2000 at a whitespace boundary. The skill clamps in `parse` for every transport, making the **fal/prod path byte-exact** and leaving the negligible edge on the dev-only mock. Documented in `cowork-skills.ts` + its test; raised by Codex (P2) and accepted as inherent/immaterial.

## File layout

- **Modify** `packages/core/src/cowork.ts` — add `ChatMessage` + `CoworkTransport` port; remove now-dead `CoworkProvider` interface. Keep `CoworkPlan` + all schemas/consts.
- **Create** `packages/core/src/cowork-skills.ts` — `draftStoryboardSkill`, `enhancePromptSkill` (`{ id, buildMessages, parse, mockReply }`), private `extractJson`, `runSkill()`.
- **Create** `packages/core/src/cowork-skills.test.ts` — parity goldens (prompts, parse, mock round-trips).
- **Create** `packages/core/src/cowork-transport.ts` — `MockTransport`, `FalTransport`, `createTransport()`.
- **Create** `packages/core/src/cowork-transport.test.ts` — gate selection, fetch envelope, error string.
- **Modify** `packages/core/src/index.ts` — re-export the two new modules.
- **Modify** `apps/web/lib/cowork-actions.ts` — swap `provider`→`transport`; `provider.planStoryboard`/`enhancePrompt`→`runSkill(...)`; `provider.name`→`transport.name`. Scaffolding untouched.
- **Delete** `apps/web/lib/cowork-provider.ts`.

## Design contracts (the lightweight, registry-deferred shape per R2)

```ts
// core/cowork.ts — the new port (replaces CoworkProvider)
export type ChatMessage = { role: "system" | "user"; content: string };
export interface CoworkTransport {
  readonly name: string;                                   // "mock" | "fal:llm" (parity — keep)
  chat(skillId: string, messages: ChatMessage[], opts?: { mockReply?: () => string }): Promise<{ text: string }>;
}
```
- **skillId is carried (R1)** so the mock never sniffs prompt text. The mock dispatch is even more explicit: `runSkill` passes the skill's `mockReply` via `opts`, so `MockTransport` returns it directly — no central registry (R2 deferral honored).
- **`runSkill`** spine: `parse( (await transport.chat(skill.id, skill.buildMessages(input), { mockReply: () => skill.mockReply(input) })).text )`.

## Parity goldens (captured from current source — assert these)

- `runSkill(draftStoryboardSkill, "a lone dog", mockTransport)` deep-equals:
  `{ scenes: [{ title: "Scene 1", shots: [5 beats].map(b => ({ prompt: \`${b} — a lone dog, cinematic lighting\` })) }] }`
  beats = `["establishing wide shot","medium shot introducing the subject","close-up on a telling detail","an emotional beat / reaction","closing wide shot"]`.
- `runSkill(enhancePromptSkill, "  a  cat  ", mockTransport)` === `"a cat, cinematic lighting, shallow depth of field, rich detail, dynamic composition"`.
- `draftStoryboardSkill.buildMessages("X")[0].content` === the exact storyboard system string (with `At most 6 scenes and 8 shots per scene.`).
- `enhancePromptSkill.buildMessages("X")[0].content` === the exact enhance system string.
- `enhancePromptSkill.parse("")` throws `"cowork: empty enhancement from the LLM"`; `parse("  hi  ")` === `"hi"`; `parse("x".repeat(2100)).length` === 2000.
- `draftStoryboardSkill.parse("noise")` throws `"cowork: no JSON object in the LLM output"`; valid-JSON-with-prose parses; over-cap plan throws ZodError.
- `createTransport()` → `MockTransport` (no `COWORK_PROVIDER`); `COWORK_PROVIDER=fal` + `FAL_KEY` → `FalTransport` (`name "fal:llm"`); `COWORK_PROVIDER=fal` + no key → throws `"COWORK_PROVIDER=fal but FAL_KEY is not set"`.
- `FalTransport.chat` (fetch stubbed): POST `https://fal.run/openrouter/router/openai/v1/chat/completions`, headers `Authorization: "Key <key>"` + `Content-Type: application/json`, body `{ model: "anthropic/claude-sonnet-4.5", messages }`; returns `{ text: choices[0].message.content }`; `!res.ok` throws `\`fal llm → ${status}: ${detail.slice(0,300)}\``.

## Tasks

- [x] **T1** — `cowork-skills.test.ts` + `cowork-skills.ts`; 9 tests green.
- [x] **T2** — `cowork-transport.test.ts` + `cowork-transport.ts`; 9 tests green.
- [x] **T3** — `ChatMessage`+`CoworkTransport` added, dead `CoworkProvider` removed; `index.ts` wired; core built; full core suite green (65); core typecheck clean.
- [x] **T4** — `cowork-actions.ts` migrated; `cowork-provider.ts` deleted; apps/web typecheck + lint clean; no stale refs.
- [x] **T5** — Full verify (core 65 green; core+web+worker typecheck; web lint). Codex reviewed twice → **VERDICT: SHIP**. P2 (enhance clamp) resolved as documented sub-parity. **Not committed** (awaiting go-ahead). `COWORK_PROVIDER=fal` deploy flag raised.

## Verify commands
- Core tests: `pnpm --filter @artlio/core test`
- Core build (so apps/web sees new exports via dist): `pnpm --filter @artlio/core build`
- Core typecheck: `pnpm --filter @artlio/core typecheck`
- Web typecheck/lint: (resolve from apps/web package.json during T4)
