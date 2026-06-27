# Design spec — Ultra-review fixes (stack #48–#59)

Date: 2026-06-28
Status: scope approved by founder ("一个 cleanup PR 全修"; video model = Veo 3.1 Lite for now).
Branch: `claude/otto-review-fixes` (off `claude/otto-g5c-discover`). Grounded in the G1→G5c stack.

## 1. What this is

A single cleanup PR addressing the 10 confirmed findings + 2 latent-hardening items from the multi-agent
adversarial review of the 12-PR stack. The review found **0 critical**, **no reachable money leak**, **no
cross-tenant read/write**, and **SSRF requests blocked** — so this PR is correctness/UX/hardening, not a
security emergency. It must itself touch the money path only to make the existing single spend gate
*consistent* (the one Important finding), never to weaken it.

## 2. Scope (the fixes)

### Important
- **F1 — Video-model gate vs selection contradiction.** `assertSpendableModel(model,'video')` (G1) requires
  `model === activeVideoModel()` (default `kling`), but `suggestModel` (used by propose/proposePack/cowork)
  still picks the cheapest of 13 models — so agent-built video cards get priced then **rejected at
  `startGen`**. Fix: (a) `activeVideoModel()` default → `"veo3.1-lite"` (kling lacks aspect ratios + audio;
  founder swaps via `OTTO_DEFAULT_VIDEO_MODEL` later); (b) `suggestModel`'s video branch returns
  `activeVideoModel()` (params clamped to that model's options) so the frozen card model always equals the
  spendable model. No change to reserve/settle/pricing; just aligns the model id the agent proposes.

### Minor — money/UX
- **F2 — Canvas direct-gen double-submit.** `useCanvasGen` uses a `Date.now()` idempotency key and
  `FlowCanvas`'s Generate has no in-flight guard → a double-click makes two paid jobs. Fix: a `submittingRef`
  + disabled Generate button while a submit is in flight.
- **F3 — DetailPanel result invisible.** Regen/Animate/Edit spend credits but only flip a transient label;
  the new asset never loads into the panel (unlike Crop). Fix: on poll `done`, resolve the job's new
  generation id (`getGenJob(jobId).generationIds[0]`) and reload it via `getGeneration` like `handleCropConfirm`.

### Minor — SSRF (requests already blocked; info/hardening)
- **F4 — Error text leaks resolved internal IP.** `url-safety.ts:200` embeds the resolved private IP in the
  thrown message, which `researchWeb` returns to the user (a DNS-resolution oracle). Fix: drop `(${address})`
  from the resolved-IP rejection (match the lexical messages).
- **DEFERRED — DNS-rebinding TOCTOU (no IP pinning).** Pre-existing (inherited by `fetchAndExtract`), mitigated
  by `redirect:"error"` + 8s timeout; the full fix is a custom undici dispatcher pinning the validated IP.
  Out of scope for this PR; tracked as a follow-up.

### Minor — schema
- **F5 — BrandKit duplicate-on-race.** `saveBrandKit` is findFirst-then-create with no uniqueness; concurrent
  saves can create duplicate kits. `brandId` is nullable, so a plain `@@unique([ownerId,brandId])` does NOT
  dedup the common `brandId = null` case (Postgres treats NULLs as distinct). Fix: a raw-SQL **unique index on
  `(ownerId, COALESCE(brandId,''))`** + `saveBrandKit` catches the unique violation (P2002) and falls back to
  update.
- **F6 — Dead favorite index.** `Generation_ownerId_favorite_deletedAt_idx` is not used by any hot path (the
  favorites query is served by `Generation_library_idx`). Fix: drop it (migration).

### Minor — React lifecycle
- **F7 — TemplateModal poll setState-after-unmount.** `pollJob` runs up to 90s and writes state
  unconditionally; the modal unmounts on close. Fix: a `cancelledRef` set in a cleanup effect, checked before
  each setState (mirror `useCanvasGen.poll`).
- **F8 — OttoLibrary load-more vs replace race.** A late append can resurrect stale-page rows onto a new
  filtered set. Fix: a monotonic request-id ref; drop responses whose id is no longer current.
- **F9 — OttoDiscover copy timeout.** `setTimeout(setCopied)` has no cleanup. Fix: track the timeout id, clear
  on unmount.

### Latent hardening (inert today, cheap parity fixes)
- **H1 — `saveBrandKit` `logoAssetId`** stored from client without ownership check. Fix: null it unless it
  names an Asset owned by the caller.
- **H2 — `createCanvasNode` attribution** (`generationId`/`genJobId`/`sourceNodeId`) stamped from client
  without validation, asymmetric with the already-validated `threadId`. Fix: validate each owner-scoped (and
  project-scoped where applicable), null on mismatch — like `threadId`.

## 3. Money / safety
- **The spend gate is only made consistent, never weakened.** F1 changes which model id the agent *proposes*
  so it matches the already-enforced spendable model; reserve→settle, idempotency, and pricing are untouched.
  No new spend path, no new model added (Veo 3.1 Lite already exists in the priced table).
- **All hardening is owner-scoped fail-closed**, matching the existing `requireOwner` + ownerId patterns.

## 4. Testing
- Unit: `activeVideoModel` default = `veo3.1-lite` + env override; `suggestModel` video returns the active
  model with valid clamped params; `saveBrandKit` logo-ownership null-coercion + duplicate-race fallback;
  `createCanvasNode` attribution null-coercion for foreign ids; url-safety resolved-IP message omits the IP.
- Component/build: F2/F3/F7/F8/F9 verified by `tsc` + the build gate (no RTL in repo); manual smoke for the
  money-path UX (F3 result appears; F2 no double job).
- Full `pnpm -r build` shows `├ ƒ /otto` + `Done`; the existing suite stays green except the pre-existing
  `DATABASE_URL` integration tests.

## 5. Out of scope
DNS IP-pinning (deferred follow-up); the 3 refuted findings (no defect); any new feature.
