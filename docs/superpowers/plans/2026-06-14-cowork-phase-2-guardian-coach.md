# Cowork Phase 2 — Guardian (spend-gate) + Coach ($0 hints) Implementation Plan

> TDD-first on the pure surface (the linter + the cast-finding decision). The `startGen` wire is a CHECKPOINT — built last, shown before it's applied.

**Goal:** Two $0-default read skills. **Guardian** blocks a paid generation before spend when it would obviously waste money (a CHARACTER with no reference images; a missing/deleted entity; a cross-project i2v source/tail). **Coach** shows offline, $0 composer hints tuned to the (family × mode) the user is generating for.

**Architecture:** Pure decision logic in `@artlio/core` (TDD): `lintPrompt(...)` (Coach) and `castFindings(...)` (Guardian's pure part). The web side loads DB state and calls them: `checkCast()` in `startGen`'s validate-before-spend window (returns `{error, report}` for hard findings, **fail-OPEN on its own faults**), and a Coach pill in the composer fed by a rules-map threaded from the page.

## Scope decision (YAGNI vs the master plan)
- The master plan's SOFT multi-character "Generate anyway" two-call flow is **deferred**. Reason: it needs a new `{warn}` return variant + changes to ~10 `startGen` callers, for a warning that **Coach already surfaces** in the composer. v1: `castSeverity:"block"` → Guardian hard-blocks; `"warn"` → no block (Coach hints it). Documented; revisit if a real block-severity case appears.

## File layout
- **Create** `packages/core/src/cowork-coach.ts` — `CoachHint`, `lintPrompt(input)`, `looksLikeTagSoup(text)` (pure) (+ `.test.ts`).
- **Create** `packages/core/src/cowork-guardian.ts` — `CastFinding`, `castFindings(input)` (pure: CHARACTER-no-refs, missing-entity, multi-char-block) (+ `.test.ts`).
- **Modify** `apps/web/lib/cowork-knowledge.ts` — `getCastRule(family,mode)` + `getRulesMap()` (family→mode→parsed rules, enabled only).
- **Create** `apps/web/lib/cowork-guardian.ts` — `checkCast(req)`: load entities-with-refs + source/tail DB checks, call `castFindings`, return `{error, report} | null`; whole body try/catch → fail-OPEN.
- **Modify** `apps/web/lib/gen-actions.ts` — **CHECKPOINT**: call `checkCast` after video-options resolve (gen-actions.ts:54), before `genJob.create` (gen-actions.ts:59); `if (block) return block`.
- **Modify** `apps/web/app/studio/page.tsx` + `components/studio/Studio.tsx` + `components/studio/GenSpace.tsx` — thread `rulesMap`; mount a debounced Coach pill before the ✨ Enhance chip (GenSpace.tsx:409).

## Pure designs (TDD targets)
```ts
// cowork-coach.ts
export type CoachHint = { id: string; tone: "warn" | "info"; message: string };
export function lintPrompt(input: { text: string; mode: GenMode; rules?: ModelDirectiveRules; characterCount: number }): CoachHint[];
// rules-driven: i2vMotionNotScene (in i2v/i2v-tail), maxConcurrentMotions (note), noTagCommas (when looksLikeTagSoup),
// castSeverity (when characterCount>=2), pitfalls[] (each a note). No directive/rules → []. No fragile NLP.
export function looksLikeTagSoup(text: string): boolean; // >=3 commas AND short avg segment (safe heuristic)

// cowork-guardian.ts (pure)
export type CastFinding = { kind: "missing-entity" | "character-no-refs" | "multi-char-block"; entityId?: string; message: string };
export function castFindings(input: {
  requestedEntityIds: string[];
  entities: { id: string; name: string; type: string; liveRefCount: number }[]; // loaded live entities
  characterCount: number;
  castRule?: "warn" | "block";
}): CastFinding[];
// missing-entity: requested id with no loaded entity; character-no-refs: CHARACTER w/ liveRefCount 0;
// multi-char-block: characterCount>=2 AND castRule==="block". "warn" produces NO finding (Coach handles it).
```

## checkCast (web — calls castFindings + source/tail DB check)
```ts
export async function checkCast(req): Promise<{ error: string; report: { findings: CastFinding[] } } | null> {
  try {
    const entities = await prisma.entity.findMany({ where: { id: { in: req.entityIds }, ownerId: FOUNDER_OWNER_ID, deletedAt: null },
      select: { id: true, name: true, type: true, _count: { select: { referenceImages: { where: { deletedAt: null } } } } } });
    // map to liveRefCount; characterCount = entities.filter(type CHARACTER).length
    const findings = castFindings({ requestedEntityIds: req.entityIds, entities: mapped, characterCount, castRule });
    // + source/tail: a sourceGenerationId/tailGenerationId not found as an owned, same-project, live image → hard finding
    if (findings.length) return { error: findings[0].message, report: { findings } };
    return null;
  } catch { return null; } // fail-OPEN — a Guardian fault must NEVER block a legit render
}
```

## Tasks
- [x] **T1 (Coach pure, TDD):** `cowork-coach.ts` + 10 tests.
- [x] **T2 (Guardian pure, TDD):** `castFindings` + 6 tests (multi-char block-only; not warn).
- [x] **T3 (knowledge):** `getCastRule` + `getRulesMap`.
- [x] **T4 (Coach UI):** rulesMap threaded; collapsed pill replacing the dotted list.
- [x] **T5 (Guardian web):** `checkCast` (entity load + source/tail check gated to worker semantics + fail-open).
- [x] **T6 (CHECKPOINT — approved):** `startGen` wire applied (before genJob.create); audits `gen.guardian-block`.
- [x] **T7 (verify):** core 104 green; core+db+web+worker typecheck; web lint. **Codex → FIX (1 P1: source/tail never-loosen) → fixed → SHIP.**

## UX redesign (user-directed deep research → Option A)
- Deep-researched preventive-block + inline-coaching UX (NN/g, Carbon/USWDS, Grammarly, AI-tool patterns). Verdict: the Guardian is a **warning, not an error** — amber △, never the red failure path.
- User picked **Option A**: an amber assist-bar above Generate with "Add a reference in Elements"; Generate stays live (no dead-disable); `role="alert"`. Client mirrors `castFindings` for an instant pre-check; server stays the money backstop.
- Coach hints → a **collapsed pill** ("N tips for <model>"), warn vs info tone, expand on click.
- Shared 3-tone language: info (muted) / warn (amber `--warning`) / error (red `--danger`, untouched).
