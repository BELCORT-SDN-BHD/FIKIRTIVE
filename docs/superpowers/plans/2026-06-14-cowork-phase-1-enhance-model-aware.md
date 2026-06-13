# Cowork Phase 1 — model-aware Enhance Implementation Plan

> Execute TDD-first on the pure core surface; the action + call-sites verify via typecheck/lint.

**Goal:** Turn the 0B knowledge base into the first felt win — ✨ Enhance rewrites tuned to the (family × mode) the user is actually generating for. The ✨ chip becomes the visible "Artlio understands the models" proof.

**Architecture:** `enhanceRequest` gains an OPTIONAL gen-shape subset. The enhance **action** derives `family = modelFamily(model)` + `mode = deriveMode(shape)` **server-side** (R3 — client sends shape, not a mode string), best-effort reads `getEnhanceDirective(family,mode)`, and threads it via a new `SkillCtx.directive` into the skill's `buildMessages`, which appends it to the system prompt. **No directive → byte-identical to today** (parity preserved). Best-effort: a knowledge-read hiccup never blocks Enhance.

## File layout
- **Modify** `packages/core/src/cowork.ts` — add `SkillCtx { directive? }` to the port.
- **Modify** `packages/core/src/cowork-skills.ts` — `CoworkSkill.buildMessages(input, ctx?)`; `runSkill(..., ctx?)`; enhance `buildMessages` injects `ctx.directive`; storyboard ignores ctx.
- **Modify** `packages/core/src/cowork.ts` — extend `enhanceRequest` with optional `{ model?, kind?, conditioned?, hasSource?, hasTail? }`.
- **Modify** `packages/core/src/cowork-skills.test.ts` — add directive-injection tests; existing parity tests must still pass (no-ctx → ENHANCE_SYSTEM).
- **Modify** `apps/web/lib/cowork-actions.ts` — derive family/mode, best-effort directive read, pass ctx; add family/mode/directiveApplied to the enhance audit.
- **Modify** `apps/web/components/studio/GenSpace.tsx` — enhance() sends `{ model, kind, conditioned, hasSource, hasTail }`.
- **Modify** `apps/web/components/studio/Storyboard.tsx` — enhance() sends seedream/image shape (the shot prompt drives the keyframe image).

## Design — directive injection (parity-safe)
```ts
// cowork.ts port
export interface SkillCtx { directive?: string }
// enhance skill buildMessages
buildMessages(text, ctx) {
  const d = ctx?.directive?.trim();
  const system = d ? `${ENHANCE_SYSTEM}\n\nModel-specific guidance for this generation: ${d}` : ENHANCE_SYSTEM;
  return [{ role: "system", content: system }, { role: "user", content: text }];
}
```
- No directive ⇒ `system === ENHANCE_SYSTEM` (today's exact bytes) ⇒ parity. The i2v "motion-not-scene" rule rides in the directive TEXT, not a code branch.

## Action (cowork-actions.ts enhancePrompt)
```ts
let directive: string | undefined;
try {
  const family = model ? modelFamily(model) : undefined;
  if (family) directive = await getEnhanceDirective(family, deriveMode({ kind: kind ?? "image", conditioned, hasSourceImage: hasSource, hasTailImage: hasTail }));
} catch { /* best-effort — a knowledge hiccup never blocks Enhance */ }
const out = (await runSkill(enhancePromptSkill, text, transport, { directive })).trim().slice(0, MAX_ENHANCE_TEXT);
```
- Money-safety untouched (validate-before-spend, owner guard, best-effort audit). The DB read is a read (no spend) and is itself best-effort.

## Tasks
- [x] **T1 (core, TDD):** `SkillCtx` added; ctx threaded through `CoworkSkill`/`runSkill`; enhance injects directive; `enhanceRequest` extended. 4 new tests + all 0A parity tests green (core 88).
- [x] **T2 (action):** family/mode server-derived + best-effort directive read + ctx; audit gains family/mode/directiveApplied.
- [x] **T3 (call-sites):** GenSpace sends model/kind/conditioned/hasSource/hasTail; Storyboard sends seedream/image.
- [x] **T4 (verify):** core 88 green; core+db+web+worker typecheck; web lint. **Codex → VERDICT: SHIP** (no blocking issues). Not committed.
