# OPT-6 architecture audit — synthesis + revised design v2 (for Codex cross-check)

Date: 2026-06-17. Inputs: a 6-dimension adversarial workflow audit (money-safety, RBAC/auth, runtime-config,
knowledge-layer, phasing, data-model), each grounded in the real codebase. ALL six returned "needs-changes":
the SHAPE is sound (composer-after-route; dashboard overlays never widen spend; typed capability truth stays
in GEN_VIDEO_MODEL_OPTIONS) but there are 5 BLOCKERs that must change the design before a spec is written.

This doc is the input for a Codex cross-model check: validate/refute each BLOCKER against the code, find
anything the 6 agents missed, sanity-check revised design v2.

---

## The 5 BLOCKERs (deduped across dimensions) + the fix

### B1 — In-handler auth does not exist; RBAC is unbuildable on top of nothing
The app's ONLY auth is the OPT-IN proxy wall (`proxy.ts:23-26`, gated by `AUTH_ENABLED`). Of 9 `"use server"`
files, only `admin-actions.ts` + `admin/directives/page.tsx` call `auth()`/`allowed()`. `startGen`,
`coworkGenerate`, `coworkTurn`, `createProject`, etc. do ZERO in-handler auth — they authorize by the hardcoded
`OWNED = {ownerId: FOUNDER_OWNER_ID}` namespace, not by session. So "generalize requireAdmin → requireRole"
assumes per-handler identity that isn't there.
**Fix:** P1 must FIRST land an in-handler auth foundation — `requireSession()` (auth()+allowed()) + `requireRole(section,level)` — called at the top of EVERY exported server action and the `/files` route. Proxy wall = defense-in-depth only, never the boundary. Add a test asserting every admin action calls the guard before any DB write.

### B2 — A model-specific composer as an LLM rewrite doubles per-turn LLM cost
`coworkTurn` makes exactly ONE planner call today (≤2 with the JSON retry). A composer that "rewrites the prompt
after routing" via an LLM = 2 planner-class calls on EVERY propose turn — most of which never generate — and on
the soon-to-be-paid Modal planner that is real money for zero revenue.
**Fix:** the composer is a DETERMINISTIC, $0 transform: after `suggestModel` picks the model, resolve
`getEnhanceDirective(modelFamily(model), mode)` + rules-derived constraints and APPEND them to
`structuredPrompt` (string concat — exactly what `enhancePromptSkill.buildMessages` already does), before the
card is persisted in `coworkTurn`. No second LLM call. If a true LLM rewrite is ever wanted, it rides the
existing user-clicked `enhancePrompt` action (cost on intent, once), never per propose turn.
**Sub-fixes:** (a) derive `conditioned` from `entityIds.length>0` so `deriveMode` keys the directive correctly
for the image-keyframe case; (b) the composer may ONLY change `structuredPrompt` — never `desiredAspect/
desiredDuration/resolution/audio` (those stay owned by suggestModel + GEN_VIDEO_MODEL_OPTIONS); guard with a
test; (c) family-coverage: `suggestModel` picks the cheapest model, often an UNSEEDED family (only seedream/
kling/ltx are seeded; veo/seedance/wan/pixverse/grok/hailuo are not) → the composer is a no-op on the paid
path. Seed ≥1 directive per video family before shipping, and surface per-family coverage as a dashboard metric.

### B3 — "Disable a model" overlay is cosmetic unless enforced at the spend gate
The only place model is validated against a menu is `genRequest.superRefine`, against the hardcoded TYPED
constants. `coworkGenerateRequest.model` is a free-form `z.string()` override; the persisted card's model
survives; the worker trusts `job.model`. So a model "disabled" only in the picker/suggestModel is still
spendable via a stale card, a direct RPC, or the override.
**Fix:** the enabled-set is enforced INSIDE `startGen` AFTER `superRefine`, before `genJob.create`, via a
fail-closed resolver read: `if (disabledModels.has(model)) return {error}`. AND the registry is strictly a
SUBSET of the typed constants — `enabled = typedMenu.filter(m => !disabled.has(m))`; a DB row can NEVER admit a
model absent from GEN_VIDEO_MODELS/GEN_MODELS (adding a model stays a typed code change). Resolver fault →
fail-closed-to-typed-menu (a config hiccup must not silently re-enable a disabled model, nor block the whole menu).

### B4 — The cost ledger has no data: no persisted per-job dollar amount exists
`GenJob.spent` is a BOOLEAN ("did the paid call return"), not USD. `videoPriceUsd`/`GEN_PRICE_USD_PER_IMAGE`
are pure TS estimators, never persisted (only the card's DISPLAY-only `estimatedPriceUsd`). So a P3 cost ledger
can count jobs but cannot sum dollars.
**Fix:** add an additive nullable `GenJob.spentUsd Float?`, written by the worker at the moment `spent` flips
true (snapshot the estimator, freezing historical cost like `Generation.entitySnapshot` freezes provenance).
This is a worker + migration change — own it explicitly.

### B5 — Data model: don't re-key ModelDirective; User.role needs real auth wiring
- **Model registry:** do NOT re-key `ModelDirective` family→model (it deliberately folds versions to a family;
  re-keying abandons that + duplicates the typed capability truth → drift, and a per-model table reads like a
  gate). Add a SEPARATE thin overlay table: `ModelRegistryOverlay { ownerId @default("founder"), modelId,
  enabled @default(true), notes, @@unique([ownerId, modelId]) }`. `modelId` is validated at WRITE against
  `[...GEN_MODELS, ...GEN_VIDEO_MODELS]`; the admin UI renders by ITERATING those typed arrays; the overlay
  stores only the boolean + advisory notes. Per-model PROMPT knowledge stays on the EXISTING ModelDirective
  family×mode grid (composer routes suggestModel→modelFamily()→family directive) — ZERO new knowledge table.
- **RBAC:** `User.role String @default("viewer")` (a string validated by a code-side zod enum, NOT a Postgres
  enum — additive, no enum-migration to add a 6th role later). Extend the `auth()` session callback to surface
  `session.user.role`; `requireRole` checks the env allowlist (outer wall) AND the DB role; seed the founder via
  an idempotent first-sign-in upsert keyed on the AUTH_ALLOWED_EMAILS email (User rows are created lazily on
  sign-in, so cannot be seeded at migration time). `ownerId="founder"` stays untouched; the spend path NEVER
  reads role. RBAC is OPERATOR-RBAC (who may flip which admin sections over shared founder data) — NOT
  tenant-RBAC (per-user data ownership), which would need a full ownerId migration out of scope here.
- Per-section permissions = a static code-side `section→role` matrix (5 fixed roles), NOT a dynamic
  Role/Permission table (which would re-introduce drift). Eval cases = one thin additive table keyed on
  (family,mode) with a Json results column.

---

## Other STRONG corrections (not blockers, fold into spec)

- **Runtime-config web/worker boundary:** the WORKER is a separate process reading its own env; a DB toggle does
  NOT reach it. `GENERATION_PROVIDER`/`FAL_KEY` (the real spend gate) live in the worker, read once at boot.
  Draw an explicit map: web-readable keys (vision caps, `COWORK_PROVIDER` planner transport) vs worker-only keys
  (label "restart required", or have the worker read via the same resolver per-job with fail-closed=mock).
- **COWORK_PROVIDER is bound once at module load** (`const transport = createTransport()` at cowork-actions.ts:28)
  → a DB toggle won't take effect without restart unless transport creation moves to a per-request (cached)
  async factory. Vision config is already per-request (easier).
- **Resolver is fail-closed + non-throwing:** DB value → SAME `clampInt`/credential-check → env fallback; on any
  DB error return the code default. Keep the env kill-switch (`COWORK_VISION_ENABLED=false/0`) as a HARD override
  the DB cannot countermand. Do NOT cache the safety keys (multi-process; an emergency flip must propagate).
- **autoSpendBudget:** DEFER the column (additive later is free); reserving it now is a misleading affordance vs
  the "agent never spends" invariant. P4 uses USAGE-ACCOUNTING (read GenJob spend), not budget-authorization.
- **COWORK_PROVIDER=modal (uncensored)** = a content/ToS surface → super-admin-only toggle, high-sensitivity
  audit; the enforced moderation gate is the fal worker call (which has NO safety params today).
- **Moderator role guards a gate that doesn't exist** (zero content-moderation code). Either build a real gate
  (fal safety params on the worker call, per-model) before P4, or ship Moderator as review/audit-only (read the
  ActionEvent taxonomy), not enforcement — don't ship a no-op guard.
- **Audit transactionally:** write the ActionEvent in the SAME transaction as the admin mutation (as
  `saveModelDirective` already does), and have `requireRole` emit a denied-attempt event.

---

## Revised phase plan v2 (re-cut per the phasing + auth findings)

- **P1a — Foundation-lite:** admin shell (grows from /admin) + in-handler auth (`requireSession`) on all actions
  + runtime-config resolver (vision caps first; `COWORK_PROVIDER` per-request cached factory; fail-closed;
  web/worker boundary documented). Guarded by the EXISTING requireAdmin/allowlist (no 5-role RBAC yet).
- **P3a — Money observability (pulled BEFORE P2):** `GenJob.spentUsd` + worker write; per-job/per-day spend
  view; money-gate audit page over the existing ActionEvent taxonomy. Read-only — cannot widen spend. Rationale:
  P2 CHANGES spend behavior (Modal planner, vision default-on); see spend before changing it.
- **P2 — Model & knowledge (= idea-1):** `ModelRegistryOverlay` (enable/disable enforced in startGen) +
  per-family directive seeding + the deterministic $0 composer + `COWORK_PROVIDER` runtime switch + vision flag +
  $0/mock eval harness (structural assertions in CI; any quality-judge run is offline, sampled, budgeted).
- **P1b — RBAC:** `User.role` + session wiring + `requireRole(section,level)` + per-action audit + founder
  first-sign-in seed. Slotted when multi-operator access is actually needed (NOT on P2's critical path).
- **P3b — Queue/system health.** **P4 — content/moderation (+ pull the audit/log-viewer slice forward to ride
  with P2 so uncensored-planner output is reviewable from when P2 enables it).** **P5 — plus.**

---

## Open decisions for the user
1. "Disable a model" semantics: TRUE spend block (enforce in startGen, recommended) vs UI-only hide?
2. RBAC = operator-RBAC only (recommended), explicitly NOT per-user tenancy in this scope — confirm?
3. Phase re-cut: foundation-lite → money-observability → model/knowledge → RBAC later — OK, or keep RBAC in P1?
4. Moderator role: build a real fal-safety gate before P4, or ship Moderator as review/audit-only for now?

## Codex cross-check addendum (2026-06-17)
Codex CONFIRMED all 5 BLOCKERs against the code (nit: 8 `"use server"` files, not 9). It added 3 MISSED issues
that v3 MUST fold in before this becomes a spec:

- **M1 — worker-side disable.** Enforcing model-disable only in `startGen` does NOT stop an ALREADY-QUEUED
  GenJob (the worker claims + spends later: `apps/worker/src/jobs/gen.ts:171,333`). If "disable" means an
  emergency spend STOP, also re-check the disabled-set in the worker before the provider call (or cancel queued
  jobs). If it only means "no NEW jobs," startGen is enough — depends on the semantics decision.
- **M2 — refgen is a second paid path, uncovered.** `startRefGen` (`refgen-actions.ts:25`) → worker
  `refgen.ts:164` also spends, has no persisted USD, and model-disable in startGen wouldn't touch it. The ledger
  (`spentUsd`), the disable enforcement, AND the in-handler auth must ALL cover refgen, not just gen.
- **M3 — composer must reapply spend-side.** `coworkGenerate` spends the client-supplied `prompt` and allows a
  model override (`GenerateCard.tsx:179`, `cowork-actions.ts:509`). A composer that runs only in `coworkTurn`
  is bypassable/stale; if composition matters for quality it must be RE-applied deterministically in
  `coworkGenerate` AFTER final model/shape resolution. (Keep it $0 — string transform, clamp to MAX_GEN_PROMPT.)

Fix-risk refinements to bake into v3: (a) startGen chokepoint is right for NEW jobs only; (b) composer concat
must clamp MAX_GEN_PROMPT + reapply spend-side; (c) ModelRegistryOverlay must iterate typed constants + ignore
unknown DB rows + keep a core↔provider VIDEO_CFG mapping test; (d) seed role only for explicit founder/admin
emails (not every allowlist entry) and write the role BEFORE any role-dependent session use; (e) write
`spentUsd` in ALL charged paths (DONE, resume-if-missing, spent||charged-failure) and add `RefGenJob.spentUsd`.

**Codex verdict:** v2 is close but NOT spec-ready until it adds worker-side disabled-model enforcement,
spend-side deterministic composition, and refgen coverage (auth + ledger + disable). → these become v3.
