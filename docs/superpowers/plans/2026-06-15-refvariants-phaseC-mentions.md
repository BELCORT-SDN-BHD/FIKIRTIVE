# Reference variant @mentions (Phase C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Let a prompt @mention a specific variant (`@Mira:red-dress`), so a generation conditions on that variant's image instead of the entity's base refs.

**Architecture:** Additive + backward-compatible. `genRequest` keeps `entityIds` and adds optional `variantSel: { [entityId]: variantId }`. The mention chip stores an optional `variantId`; `resolveDoc` returns the `variantSel` map; the composers thread it into `startGen`, which stores it on `GenJob.variantSel` (column already migrated in Phase A). The worker scopes each mentioned entity's conditioning refs to the selected variant (or base refs when none), fails closed on a variant that resolved to zero live refs, and freezes the `variantId` into the provenance snapshot. The guardian validates variant selections pre-spend. A bare `@Mira` (no variant) behaves exactly as today.

**Tech Stack:** Tiptap mention extension, Next.js server actions, pg-boss worker, zod, vitest (core).

**Spec:** `docs/superpowers/specs/2026-06-15-reference-base-variants-design.md` (Phase C / @mention section). Builds on Phase A+B (pushed `d801a05`).

**⚠️ Coordination:** Phase C edits `apps/web/components/studio/GenSpace.tsx`, which may carry the concurrent GenSpace-lint fix. **Execute the GenSpace task (C3) only with a clean tree** (concurrent GenSpace/TOCTOU work committed first) to avoid tangled commits. Do C1/C2/C4/C5/C6 first; do C3 (composers) when the tree is clean.

**House rules:** money-safety (validate-before-spend, fail-closed, no double-spend), surgical, TDD for core, `GENERATION_PROVIDER=mock` for gen tests (kill stale workers), commits per task, no push/deploy without the user asking, `/codex` before deploy.

---

## File structure

| File | Change |
|---|---|
| `packages/core/src/gen.ts` | `genRequest` add `variantSel: z.record(z.string().max(64)).optional()` |
| `packages/core/src/gen.test.ts` | variantSel cases |
| `apps/web/components/MentionInput.tsx` | `MentionItem` variants; suggestion lists entity + variants; chip stores `variantId`; `resolveDoc` returns `variantSel`; `buildMentionDoc` preserves `variantId` |
| `apps/web/components/studio/GenSpace.tsx` | thread `variantSel` from mention onChange → `startGen` |
| `apps/web/components/studio/Storyboard.tsx` | same in the shot-card composer |
| `apps/web/lib/gen-actions.ts` | `startGen` persists `variantSel` on the GenJob |
| `apps/web/lib/cowork-guardian.ts` | `checkCast` validates each selected variant is live + has ≥1 live ref (fail-closed) |
| `apps/worker/src/jobs/gen.ts` | conditioning scoped per (entityId, variantSel[entityId]); fail-closed on 0 refs; snapshot freezes variantId |

---

### Task C1: `genRequest.variantSel` contract (TDD)

**Files:** `packages/core/src/gen.ts:151`, `packages/core/src/gen.test.ts`

- [ ] **Step 1: Failing test.** In `gen.test.ts`, add to the genRequest describe block:
```ts
  it("accepts an optional variantSel map and defaults it absent", () => {
    const base = { projectId: "p1", prompt: "hi", entityIds: ["e1"], kind: "image", model: "seedream", count: 1 };
    expect(genRequest.parse(base).variantSel).toBeUndefined();
    expect(genRequest.parse({ ...base, variantSel: { e1: "v1" } }).variantSel).toEqual({ e1: "v1" });
    expect(() => genRequest.parse({ ...base, variantSel: { e1: "x".repeat(65) } })).toThrow();
  });
```
(Adjust the `base` fixture to match the existing genRequest required fields — read the current schema at gen.ts:140-194 first and mirror a valid request used elsewhere in the test file.)

- [ ] **Step 2: Run → fail.** `pnpm --filter @fikirtive/core test -- gen`

- [ ] **Step 3: Implement.** In `packages/core/src/gen.ts`, after the `entityIds` field (line 151) add:
```ts
    // Phase C: { [entityId]: variantId } — which variant each @mention selected.
    // Absent → all mentions condition on base refs (backward-compat).
    variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).optional(),
```
(If this zod version's `z.record` takes a single arg, use `z.record(z.string().min(1).max(64))` for the value schema.)

- [ ] **Step 4: Run → pass.** `pnpm --filter @fikirtive/core test -- gen && pnpm --filter @fikirtive/core typecheck`

- [ ] **Step 5: Commit.** `git add packages/core/src/gen.ts packages/core/src/gen.test.ts && git commit -m "feat(core): genRequest.variantSel for @mention variants (phase C)"`

---

### Task C2: MentionInput — variant-aware chips

**Files:** `apps/web/components/MentionInput.tsx`

The chip currently stores `{ id, label, entityType }`; `resolveDoc → { ids, text }`. Add an optional `variantId` to the chip + the suggestion list + the resolver.

- [ ] **Step 1: Extend the suggestion model + dropdown.**
- `MentionItem` (line 17): add `variantId?: string` and a display suffix. Build items as entity + one row per live variant:
```ts
interface MentionItem { id: string; name: string; type: EntityDTO["type"]; aka?: string; variantId?: string; variantLabel?: string }
```
- In the suggestion `items` fn (line 155), for each matching entity, emit the bare entity AND one item per `e.variants` (already on `EntityDTO` from Phase B) whose name/handle matches the query, e.g. `{ id: e.id, name: e.name, type: e.type, variantId: v.id, variantLabel: v.name }`. Cap the combined list at 8.
- In `MentionList`, render `variantLabel` when present (e.g. `Mira · red dress`).
- `pick`/`command` (line 29): pass `variantId` through: `props.command({ id: item.id, label: item.variantLabel ? `${item.name}:${item.variantLabel}` : item.name, entityType: item.type, variantId: item.variantId })`.

- [ ] **Step 2: Store `variantId` on the mention node.** In the `Mention.extend addAttributes` (line 141), add a `variantId` attribute mirroring the `entityType` pattern (default null, parseHTML from `data-variant-id`, renderHTML to `data-variant-id`).

- [ ] **Step 3: `resolveDoc` returns `variantSel`.** Change the signature + walk:
```ts
export function resolveDoc(doc: DocNode, byId: Map<string, EntityDTO>): { ids: string[]; variantSel: Record<string, string>; text: string } {
  const ids: string[] = [];
  const variantSel: Record<string, string> = {};
  let text = "";
  const walk = (node: DocNode) => {
    if (node.type === "text") text += node.text ?? "";
    if (node.type === "mention" && node.attrs?.id) {
      ids.push(node.attrs.id);
      if (node.attrs.variantId) variantSel[node.attrs.id] = node.attrs.variantId; // last write wins (one variant per entity per prompt)
      text += byId.get(node.attrs.id)?.name ?? node.attrs.label ?? "";
    }
    node.content?.forEach(walk);
    if (node.type === "paragraph") text += "\n";
  };
  walk(doc);
  return { ids: [...new Set(ids)], variantSel, text: text.trim() };
}
```
(Add `variantId?: string` to the `DocNode.attrs` type at line 57.)

- [ ] **Step 4: `buildMentionDoc` preserves `variantId`.** Extend the `mentioned` param + the mention token attrs to carry `variantId` (thread it through the `Tok` mention attrs at lines 82, 99). The Enhance rebuild must keep variant bindings.

- [ ] **Step 5: `onChange` signature.** The component's `onChange: (text, ids, doc)` → `onChange: (text, ids, variantSel, doc)`. Update the `onUpdate` call (line 207-210) to pass `variantSel`. (Callers update in C3.)

- [ ] **Step 6: Typecheck.** `pnpm --filter web typecheck` will fail at the call sites until C3 — that's expected; confirm MentionInput.tsx itself has no internal type errors by reading it. Commit after C3 compiles, OR commit C2+C3 together. **Recommend committing C2+C3 together** (the onChange signature change couples them).

---

### Task C3: Composers thread `variantSel` ⚠️ (clean tree required)

**Files:** `apps/web/components/studio/GenSpace.tsx`, `apps/web/components/studio/Storyboard.tsx`

> Do this ONLY with a clean working tree (concurrent GenSpace lint fix committed). Verify `git status` shows no uncommitted `GenSpace.tsx` before editing.

- [ ] **Step 1: GenSpace.** It holds `prompt` + `promptIds` + `seedDoc` state and a `<MentionInput onChange={(text, ids, doc) => …}>`. Add a `promptVariantSel` state; update the onChange to `(text, ids, variantSel, doc) => { setPrompt(text); setPromptIds(ids); setPromptVariantSel(variantSel); setSeedDoc(doc); }`. Pass `variantSel: promptVariantSel` into the `startGen({...})` request (only when non-empty).

- [ ] **Step 2: Storyboard.** The shot-card composer (`ShotCard`) has `text`/`ids`/`doc` + a `MentionInput`. Add a `variantSel` to the shot's local state, thread it through onChange + the `startGen` call for that shot's frame/animate. (Saving `variantSel` into the shot's `promptDoc` is automatic — the doc already encodes the mention `variantId` attrs; only the live `startGen` request needs the map.)

- [ ] **Step 3: Typecheck + build.** `pnpm --filter web typecheck && pnpm --filter web build`

- [ ] **Step 4: Commit (C2+C3 together).** `git add apps/web/components/MentionInput.tsx apps/web/components/studio/GenSpace.tsx apps/web/components/studio/Storyboard.tsx && git commit -m "feat(web): @mention a specific variant (mention chips + composers) (phase C)"`

---

### Task C4: `startGen` persists `variantSel`

**Files:** `apps/web/lib/gen-actions.ts`

- [ ] **Step 1.** In `startGen`, destructure `variantSel` from the parsed `genRequest` and include it in the `GenJob.create` data: `variantSel: variantSel ?? null`. (The column is `Json?`, migrated in Phase A.) No other change — `entityIds` still stored as today.
- [ ] **Step 2.** `pnpm --filter web typecheck`
- [ ] **Step 3.** Commit: `git commit -m "feat(web): persist variantSel on GenJob (phase C)"`

---

### Task C5: Guardian validates variant selections (fail-closed)

**Files:** `apps/web/lib/cowork-guardian.ts`

- [ ] **Step 1.** `checkCast` already pre-validates entities (exist, have refs). Extend it: it receives `variantSel` (thread it through `startGen`'s `checkCast({...})` call). For each `[entityId, variantId]` in `variantSel`: load `EntityVariant { id: variantId, entityId, ownerId, deletedAt: null }` and count its live refs (`ReferenceImage WHERE entityId, variantId, deletedAt null`). If the variant is missing/deleted OR has 0 refs → return a block ("That variant has no image yet — generate it first, or use the base"). Fail-closed (no spend).
- [ ] **Step 2.** Thread `variantSel` into the `checkCast(...)` call in `gen-actions.ts startGen` (where it's already invoked pre-spend).
- [ ] **Step 3.** `pnpm --filter web typecheck`; local DB verify script asserting a deleted/empty-variant selection blocks.
- [ ] **Step 4.** Commit.

---

### Task C6: Worker conditioning scoped per variant + snapshot freezes variantId

**Files:** `apps/worker/src/jobs/gen.ts` (conditioning ~159-174, snapshot ~182)

- [ ] **Step 1: Per-entity variant-scoped conditioning.** Replace the single `referenceImage.findMany({ where: { entityId: { in: job.entityIds } } })` (line 159-166) with a per-entity resolve that honors `job.variantSel`:
```ts
const variantSel = (job.variantSel as Record<string, string> | null) ?? {};
const refs: { asset: { ownerId: string; contentHash: string; ext: string } }[] = [];
for (const entityId of job.entityIds) {
  const variantId = variantSel[entityId] ?? null;
  const where = variantId
    ? { entityId, variantId, ownerId: job.ownerId, deletedAt: null }
    : { entityId, variantId: null, ownerId: job.ownerId, deletedAt: null };
  const found = await prisma.referenceImage.findMany({ where, orderBy: { position: "asc" }, include: { asset: true } });
  if (variantId && found.length === 0) {
    throw new Error(`variant ${variantId} for entity ${entityId} has no live refs — refusing to spend on a degraded generation`);
  }
  refs.push(...found);
}
```
(Keep the existing presign loop + the `!isMock && refs.length > 0 && inputImageUrls.length < refs.length` unreachable check.) The 0-ref throw is BEFORE the paid call → fail-closed, no spend. (Note: capping total refs at `MAX_CONDITIONING_IMAGES`/the seedream 15 limit — preserve whatever cap the current code applies; apply it to the aggregated `refs`.)

- [ ] **Step 2: Snapshot freezes variantId.** In the entitySnapshot build (line 179-183), include the selected variant + scope refHashes to it:
```ts
entities: entities.map((e) => {
  const variantId = variantSel[e.id] ?? null;
  const refsForHash = variantId
    ? e.referenceImages.filter((r) => r.variantId === variantId)
    : e.referenceImages.filter((r) => r.variantId === null);
  return { id: e.id, name: e.name, type: e.type, variantId, refHashes: refsForHash.map((r) => r.asset.contentHash) };
}),
```
(Adjust the entities query at line 179 to include `referenceImages` with `variantId` selected — it already includes referenceImages; ensure `variantId` is available on them.)

- [ ] **Step 3: Verify (mock, $0).** A local script: create an entity + base + a variant (with a ref), a GenJob with `variantSel: {entityId: variantId}`, run `handleGen` (mock), assert it conditioned on the variant's ref (1 input) and the snapshot recorded the variantId. Plus a deleted-variant case → throws before spend.

- [ ] **Step 4: Commit.** `git commit -m "feat(worker): scope gen conditioning to @mentioned variant + snapshot variantId (phase C)"`

---

### Task C7: Integration gate

- [ ] `pnpm -r typecheck && pnpm --filter @fikirtive/core test && pnpm --filter web build`
- [ ] `/codex review` the Phase C diff — money-safety focus: can a variant mention spend on a deleted/empty variant (must fail-closed in BOTH guardian and worker)? Does a bare `@entity` still condition on base refs (backward-compat)? Address P1/P2.
- [ ] STOP — no deploy. Report for the A+B+C deploy decision.

---

## Self-Review

**Spec coverage (Phase C):** genRequest.variantSel (C1) ✓; MentionInput dropdown shows variants + chip carries variantId + resolveDoc/buildMentionDoc (C2) ✓; composers thread variantSel (C3) ✓; startGen persists (C4) ✓; guardian fail-closed validation (C5) ✓; worker variant-scoped conditioning + fail-closed-on-0-refs + snapshot variantId (C6) ✓; gate (C7) ✓.

**Type consistency:** `variantSel: Record<string,string>` ({entityId→variantId}) consistent across genRequest (C1), resolveDoc (C2), onChange (C2/C3), startGen/GenJob (C4), checkCast (C5), worker (C6). `onChange(text, ids, variantSel, doc)` — all MentionInput callers (GenSpace, Storyboard, and any other) must update (grep `MentionInput` for callers in C3).

**Backward-compat:** absent `variantSel` (old GenJobs, bare mentions) → base-ref conditioning, exactly as today. The worker reads `job.variantSel ?? {}`.

**Money-safety:** double fail-closed (guardian pre-spend + worker pre-paid-call) on a variant with 0 live refs; one-variant-per-entity-per-prompt (the map key is entityId — documented limitation).

**Open:** rename `entityIds`→structured was rejected (kept additive `variantSel` for backward-compat + minimal churn). Same entity twice with different variants in one prompt is unsupported (map model) — documented.
