# OPT-6 — Operator Admin Dashboard + RBAC + Model-Knowledge Layer — Design Spec (v4)

**Goal:** Give the Artlio team a single internal control plane to run the studio — manage models/providers,
see + audit spend, review content, tune prompt knowledge, and govern who-can-do-what — replacing scattered env
vars + redeploys, WITHOUT ever weakening the money-safety invariant.

**Architecture:** A `/admin` shell grown from the existing `/admin/directives`, backed by four pillars
(in-handler auth, DB runtime-config, operator-RBAC, a deterministic model-knowledge composer). Every dashboard
control is READ + config-OVERLAY only; the typed media-spend gate (`genRequest.superRefine` + the worker) stays
the sole, unchanged authority over money.

**Tech stack:** Next.js 16 (customized — read `node_modules/next/dist/docs/` before framework code), Prisma 7 +
Neon Postgres (additive migrations only), next-auth v5 (DB session strategy), the existing `ActionEvent` audit +
`ModelDirective` config precedents.

**Scope note:** This is ONE design spec covering all of OPT-6, decomposed into independently-shippable phases.
Each phase becomes its OWN implementation plan (writing-plans) + Codex gate + deploy. Do not build it as one
mega-change.

**Provenance:** 2026-06-17 deep research → 6-dimension adversarial workflow audit (v2) → Codex cross-check →
6-dimension adversarial SPEC-verification workflow + Codex cross-check (this v4). Audit trail:
`docs/superpowers/research/2026-06-17-opt6-audit-synthesis.md`. v4 folds every confirmed BLOCKER from both
rounds + the 4 user decisions (TRUE-disable; operator-RBAC team-only; Moderator=review/audit-only;
phase order foundation→money-obs→model/knowledge→RBAC).

---

## 0. Load-bearing invariants (every phase must preserve these)

1. **Money-safety #1 (MEDIA spend).** The dashboard never WIDENS media spend; controls only READ, NARROW
   (disable), or carry advisory text. The COMPLETE set of MEDIA-spend paths (each must honor model-disable +
   the spentUsd ledger + in-handler auth):
   - **a.** cowork card: user Generate → `coworkGenerate` → `startGen` → worker `handleGen`.
   - **b.** direct image/video: `startGen` from `GenSpace.tsx` / `Storyboard.tsx`.
   - **c.** reference base/sheet: `startRefGen` → worker `handleRefGen`.
   - **d.** reference VARIANT: `createVariant` / `regenerateVariant` → `dispatchVariantJob` → worker
     `handleRefGen` (this path does NOT pass through `startRefGen` — easy to miss; refgen-actions.ts:130/191/222).
   The typed gate (`genRequest.superRefine` + `GEN_VIDEO_MODEL_OPTIONS`) is unchanged and remains the sole
   authority over which (model,params) may spend.
2. **Text-LLM spend is a SEPARATE, small paid path.** `coworkTurn`/`enhancePrompt`/`coworkDraftStoryboard` call
   the real planner LLM when `COWORK_PROVIDER∈{fal,modal}` (today default mock = $0). The cowork agent still
   never triggers MEDIA spend, but planner tokens ARE money once a paid provider is on. v4 treats this
   explicitly in §5 (ledger) rather than pretending it is $0.
3. **Typed capability truth.** `GEN_VIDEO_MODELS` / `GEN_VIDEO_MODEL_OPTIONS` / `videoRateUsdPerSec` (gen.ts) +
   `VIDEO_CFG` (generation) remain the compile-time source of truth. A DB row can never ADD a model or RAISE a
   cap — only disable a typed one or carry advisory notes.
4. **Operator-RBAC, not tenancy.** The dashboard is for the Artlio team only. `ownerId` stays the constant
   `FOUNDER_OWNER_ID` for all business rows. Roles gate WHO on the team may use which admin section over the
   shared studio data. Per-user data ownership / multi-tenancy is OUT OF SCOPE.
5. **Fail-closed config.** A runtime-config read returns the safe default on a missing/garbage value; the env
   kill-switch (`COWORK_VISION_ENABLED=false/0`) is a hard override the DB cannot countermand; safety caps stay
   clamped. NOTE the one asymmetry (§2): a SET provider with a MISSING credential is handled by `getTransport()`
   catching the throw → mock, NOT by `createTransport` (which throws by design).

---

## 1. Pillar A — In-handler auth foundation (BLOCKER B1)

**Problem:** the only auth is the OPT-IN proxy wall (`proxy.ts`, gated by `AUTH_ENABLED`). Of the 8 file-level
`"use server"` lib files, only `admin-actions.ts` re-asserts identity in-handler. Everything else authorizes by
the hardcoded `OWNED = {ownerId: FOUNDER_OWNER_ID}` namespace, not by session. Data-bearing PAGES (`/studio`,
`/editor`, `/library`) also read founder data with no auth (`/studio` calls `auth()` only for the avatar label;
`/editor` calls none). RBAC on top of this is unbuildable.

**Design:**
- Add `requireSession()` — `auth()` + `allowed(email)` — reusing the existing `allowed()` allowlist as the outer
  wall. Returns the session or the `{error}` contract for actions.
- **Cover ALL 8 file-level `"use server"` lib files:** `actions`, `admin-actions` (already guarded — keep),
  `cowork-actions`, `cowork-fetch`, `gen-actions`, `refgen-actions`, **`studio-actions`** (was missed in v3 — 7
  unguarded actions: addShot/deleteShot/moveShot/addScene/setShotPromptText/setShotFrame/setShotTransition),
  `upload-actions`. `login/page.tsx` uses an INLINE directive and is the pre-auth sign-in page — intentionally
  exempt. The **guard test enumerates use-server files DYNAMICALLY** (AST/source scan) so a future file can't
  silently bypass it — do NOT hardcode the list in the test.
- **Cover data-bearing routes/pages:** the `/files/[...key]` route calls `auth()`+`allowed()` at the TOP of GET
  (before `parseStorageKey`/`presignedGet`/`get`, gating BOTH the presigned-redirect and byte-serving branches)
  and returns **302→/login or 401** (NOT the `{error}` object — it would render as a broken image). Data-bearing
  page loaders (`/studio`, `/editor`, `/library`, `/admin/*`) call `auth()`+`allowed()` and redirect on fail.
- This pillar is auth ONLY. Role checks (`requireRole`) arrive in Pillar C; until then every authenticated
  allowlisted team member is treated as today's founder-admin.

---

## 2. Pillar B — DB runtime-config layer

**Goal:** flip operational toggles (vision caps, `COWORK_PROVIDER` planner transport) without a redeploy.

**Data:** `RuntimeConfig { key String @id, valueJson Json, updatedAt DateTime @updatedAt, updatedBy String }` —
keys are a fixed code-side enum; values validated by a per-key zod schema on read AND write (mirrors
`ModelDirective.rules`).

**Resolver `resolveConfig(key)`** = read DB → run the SAME validation/clamp the env path uses → env fallback →
code default. **Async, non-throwing** (DB error → code default, logged). Returns a fully-resolved bounded object.

**Concrete migration notes (the audit's confirmed subtleties):**
- `coworkVisionConfig()` becomes **async** (it is sync today). Ripple to spell out: `await` at its 2 call sites
  (`refImageDataUrl` cowork-actions.ts:35, `coworkTurn` :275 — both already in async fns), extract+export the
  private `clampInt` closure so the resolver reuses it, and update the ~8 synchronous test assertions in
  `cowork-reply.test.ts`. Empty table → env default (vision DEFAULT-ON preserved). `COWORK_VISION_ENABLED=false/0`
  stays a hard env override the DB cannot flip back on.
- **`COWORK_PROVIDER` bind-once fix:** today `const transport = createTransport()` runs ONCE at module load
  (cowork-actions.ts:28). Replace with `getTransport()` — a per-request resolve, **resolved ONCE per action**
  (one `await getTransport()` at the top of the handler, instance reused for that request's `.chat`/`.name`).
  **ALL THREE consumers** convert: `coworkTurn`, `enhancePrompt`, `coworkDraftStoryboard` (and their
  `transport.name` audit reads move below the await) — not just coworkTurn.
- **createTransport throws — reconcile (BLOCKER):** `createTransport` falls back to Mock ONLY for unset/unknown
  provider; a SET provider with a MISSING credential THROWS by design (and a test enforces "never silent-mock").
  So `getTransport()` must (1) validate credential-presence at config-WRITE time (reject a `COWORK_PROVIDER=fal`
  toggle if the web process has no `FAL_KEY`), AND (2) CATCH any factory throw at request time → Mock + a
  best-effort audit log (covers later env drift). Do NOT "fix" createTransport into a silent mock — the loud
  throw is intentional and tested.
- **Web/worker boundary (BLOCKER):** the worker is a separate process reading its own env; a DB toggle does NOT
  reach it. The dashboard governs WEB-side keys (vision caps, `COWORK_PROVIDER` planner transport) live;
  worker-side keys (`GENERATION_PROVIDER`, `FAL_KEY` — the MEDIA spend gate) are labeled "restart required". The
  UI must never imply control over a value the worker reads once from env.
- **No caching** of safety keys (multi-process web + horizontal scale): read-through-uncached like
  `ModelDirective` so an emergency flip propagates immediately.
- **Audit:** config writes go through a `requireRole`-guarded action writing an `ActionEvent`
  (`type:"config.edit"`) transactionally with the upsert.

---

## 3. Pillar C — Operator-RBAC (team-only)

`User.role String @default("viewer")` — a string validated by a code-side zod enum `ROLES` (NOT a Postgres enum;
additive, no migration to add a 6th role later).

**Roles → scope (informal):** super-admin (founder; everything incl. role assignment + provider=modal),
ops (model registry, prompt/knowledge, non-provider runtime-config, system/queue health), finance (cost read +
export), moderator (content review + audit log), viewer (read).

**The authoritative section → minimum-role matrix** (`requireRole(section, action)` consumes THIS; it is the
single exported const the guard test asserts is complete):

| Section | read | mutate |
|---|---|---|
| ① Model & Provider | ops | ops (provider=modal: **super-admin only**) |
| ② Cost & usage | finance | — (read-only section) |
| ③ Content & moderation & audit | moderator | moderator |
| ④ Team & access | super-admin | super-admin |
| ⑤ System & queue health | ops | ops |
| ⑥ Prompt & knowledge | ops | ops |

- "viewer" = read-only on ①⑤⑥ (operational), NOT on ②cost or ④team (those carry sensitive spend/identity data).
  super-admin supersedes all; each named role implies read on its own section.
- **Self-escalation rule:** role assignment (§④) requires super-admin AND rejects `target === self` for any
  elevation; granting super-admin goes through a separate guarded path. `requireRole` denies by default + emits a
  denied-attempt `ActionEvent`.
- **Session wiring:** add an `auth()` session callback that loads `role` from the User row → `session.user.role`
  (next-auth DB-session passes the fresh User row to the callback every request).
- **Founder seed — TWO parts (the audit's gap):** (1) a one-time BACKFILL in the P1b migration/deploy step:
  `UPDATE "User" SET role='super-admin' WHERE email IN (<FOUNDER_ADMIN_EMAILS env>)` so the EXISTING founder row
  + any live session is correct immediately (else the founder is stuck as default `viewer` until re-sign-in);
  (2) an ongoing idempotent upsert in the `events.signIn` handler (runs before the redirect → before any
  role-dependent request) for future sign-ins. Both read the SAME dedicated `FOUNDER_ADMIN_EMAILS` env (distinct
  from `AUTH_ALLOWED_EMAILS`). The allowlist stays the outer wall (never reads role), so a default-viewer can
  never lock the team out of the app — only out of role-gated sections.
- **Audit transactionally:** every admin mutation writes its `ActionEvent` in the SAME transaction as the write.
- Section ④ "Team & access" IS this pillar's UI (list members, assign roles). No end-user/quota management.

---

## 4. Pillar D — Model-knowledge layer = idea-1

### 4a. Deterministic $0 composer — compose ONLY at spend-side (BLOCKER: double-append)
The composer is a deterministic, $0 string transform that appends the resolved model-family directive to the
prompt. **It runs ONLY in `coworkGenerate` (the spend side), NOT in `coworkTurn`.** Rationale (confirmed): if it
also baked into the persisted `structuredPrompt` at coworkTurn, that text seeds the editable card prompt
(`GenerateCard.tsx`), which `coworkGenerate` then spends AND re-composes → the directive appears TWICE. Keeping
the card prompt directive-free and composing once at spend resolves both the double-append AND the model-override
mismatch (the user can switch the card's model to another family) in one move.
- In `coworkGenerate`, after `chosenModel` resolves (~502) and before building `req` (~509): compose from the
  client `prompt` using `getEnhanceDirective(modelFamily(chosenModel), deriveMode({kind, conditioned:
  entityIds.length>0, hasSourceImage: !!sourceGenerationId, hasTail:false}))`, append directive + rules-derived
  constraints, clamp to `MAX_GEN_PROMPT`. **No LLM call.**
- `conditioned = entityIds.length>0` is an advisory APPROXIMATION (a bare 0-ref LOCATION mention runs as t2i at
  the worker but keys i2i here) — acceptable because the composer is advisory text, never a spend decision, and
  it matches the existing Guardian's `conditioned:true` precedent. DOCUMENT it as such.
- **Guard test:** the directive appears EXACTLY ONCE in the prompt `coworkGenerate` passes to `startGen`; the
  composer changes only the prompt string, never model/kind/count/`desired*`/params; output is byte-stable (no
  LLM); clamped.
- **Family coverage:** `suggestModel` picks the cheapest model, often an UNSEEDED family (only seedream/kling/ltx
  seeded; veo/seedance/wan/pixverse/grok/hailuo unseeded → composer is a no-op there). Seed ≥1 directive per
  video family before P2 ships; surface per-family coverage as a dashboard metric.
- *(Out of scope unless explicitly added: directives for the direct GenSpace/Storyboard `startGen` paths — those
  are separate startGen-side requirements, not part of this composer.)*

### 4b. Model registry overlay + TRUE disable (BLOCKER B3 + "真停花钱" + 4th path)
- New table `ModelRegistryOverlay { id String @id, ownerId String @default("founder"), modelId String,
  enabled Boolean @default(true), notes String @default(""), updatedAt DateTime @updatedAt,
  @@unique([ownerId, modelId]) }`. `modelId` validated at WRITE against the UNION of ALL typed model catalogs:
  `[...GEN_MODELS, ...GEN_VIDEO_MODELS, ...REFGEN_MODELS]` (deduped — REFGEN_MODELS is a SEPARATE catalog the v3
  draft missed). The admin UI renders by ITERATING those typed arrays; unknown DB rows are ignored at read. The
  overlay stores ONLY the boolean + advisory notes. Capability truth stays 100% typed.
- **Enforcement (TRUE spend block) — at EVERY media-spend path of §0.1:** `enabled = typedMenu.filter(m =>
  !disabled.has(m))`. Enforce the disabled-set at:
  1. picker / `suggestModel` candidate pool (UX),
  2. `startGen` AFTER `superRefine`, before `genJob.create` (paths a + b),
  3. `startRefGen` (path c),
  4. **`dispatchVariantJob`** (path d — the variant path that bypasses startRefGen),
  5. the worker before the provider call in BOTH `handleGen` (gen.ts:333/341) AND `handleRefGen` (refgen.ts:165)
     — catches ALREADY-QUEUED jobs.
  Each read is fail-closed-to-typed-menu on a DB fault.
- **Seedream coupling note:** `GEN_MODELS`, `REFGEN_MODELS` both = `["seedream"]` today, so disabling seedream
  disables ALL image generation (base/sheet/variant + direct image). The dashboard renders ONE shared
  "image model" toggle (not per-path), and the spec calls this out so the operator isn't surprised.
- Per-model PROMPT knowledge stays on the EXISTING `ModelDirective` family×mode grid. Do NOT re-key ModelDirective.

### 4c. Eval harness ($0)
`PromptEvalCase { id String @id, ownerId String @default("founder"), family String, mode String, input String,
expectationJson Json?, lastResultJson Json?, createdAt DateTime @default(now()), updatedAt DateTime @updatedAt,
@@index([ownerId, family, mode]) }`. The harness runs `mockPlannerReply → parseCoworkTurn → suggestModel →
composer` against the MOCK transport — NEVER `startGen`/`coworkGenerate`/refgen. CI asserts STRUCTURAL invariants
(directive exactly-once on the FULL coworkTurn+coworkGenerate round-trip; correct family/mode; no param drift;
per-family coverage). A quality-JUDGE run (real LLM) is OUT of CI — offline, sampled, super-admin-gated,
count-capped.

---

## 5. Spend ledger data (BLOCKER B4 + refgen + planner-token)

- **`GenJob.spentUsd Float?`** (additive nullable), written by the worker in the SAME transaction as the commit
  marker (gen.ts:375, alongside `generationIds`+`spent`) — frozen exactly when delivered, like
  `Generation.entitySnapshot`. Snapshot = `videoPriceUsd(...)` for video, `GEN_PRICE_USD_PER_IMAGE * job.count`
  for image. The resume branch (gen.ts:142) is a DEFENSIVE backfill only (if `generationIds` present but
  `spentUsd` null, reconstruct from `job.videoOptions`/`job.count`). Also write on the `spent||charged` failure
  path (gen.ts:402).
- **`RefGenJob.spentUsd Float?`** — NET-NEW behavior (RefGenJob has NO `spent` column today; refgen's failure
  path persists no spend marker). Add the write at all three refgen points using the worker's in-memory
  `spent`/`charged`: DONE finalize (refgen.ts:198), resume (refgen.ts:78), and the catch terminal branch
  (refgen.ts:208-214, when `spent||charged`). Snapshot = `REFGEN_PRICE_USD_PER_IMAGE * job.count` (its OWN
  constant, NOT `GEN_PRICE_USD_PER_IMAGE` — same value today but independent). `spentUsd != null` IS the refgen
  spend marker (optionally also add `RefGenJob.spent Boolean` for parity — implementer's call, additive).
- **Planner-token (text-LLM) cost (§0.2):** persist a per-call USD estimate on the `cowork.turn` /
  `cowork.enhance` / `cowork.draft` `ActionEvent` payload when a paid provider is active (mock = 0). This is the
  only way the §② ledger reflects planner spend once `COWORK_PROVIDER=modal/fal`. (If the team prefers, defer
  this with the explicit rationale "planner stays $0 until Modal ships" — but it must be a stated decision, not a
  silent gap.)
- **Migration ordering:** run `prisma migrate deploy` (add the nullable columns) BEFORE shipping the worker build
  that writes them (the columns are additive-nullable so reverse order only errors the worker write, no data loss
  — but state the order).

---

## 6. Section map → phases

Sections (team-only): ① Model & Provider control, ② Cost & usage, ③ Content & moderation & audit, ④ Team &
access (= RBAC admin UI), ⑤ System & queue health, ⑥ Prompt & knowledge mgmt (directives + composer + eval +
**`COWORK_PLANNER_SYSTEM` editing + ProjectBrief defaults + the structured-description template** — all via the
RuntimeConfig pattern; the user said "all of these"). PLUS (marketing/analytics, support, invite-codes/
subscriptions, export) is end-user/business-facing → P5, mostly deferred.

### Phase plan (each = its own implementation plan + Codex gate + deploy)

- **P1a — Foundation.** Admin shell + in-handler auth (Pillar A: `requireSession` on all 8 use-server lib files
  via a dynamic guard test + data-bearing page loaders + `/files` route) + runtime-config resolver (Pillar B:
  vision caps live; `COWORK_PROVIDER` per-request `getTransport()` across all 3 consumers, throw-catch→mock,
  write-time credential validation; web/worker boundary documented; fail-closed). Guarded by the EXISTING
  requireAdmin/allowlist (no 5-role RBAC yet). *Independently shippable: hardening + a settings page.*
- **P3a — Spend observability (before P2).** `GenJob.spentUsd` + `RefGenJob.spentUsd` + worker writes (all
  charged paths incl. variant) + the planner-token cost decision; per-job/per-day spend view (§②); money-gate
  audit page over the ActionEvent taxonomy **incl. `refgen.start`** (+ emit `refgen.start` from
  `dispatchVariantJob`/`regenerateVariant`, which are currently under-audited): gen.start, gen.guardian-block,
  refgen.start, cowork.turn, cowork.enhance, config.edit. Read-only — cannot widen spend.
- **P2 — Model & knowledge = idea-1 (§① + §⑥).** `ModelRegistryOverlay` + TRUE-disable at all 5 chokepoints +
  the shared-image-toggle note; per-family directive seeding; deterministic $0 spend-side composer; vision flag
  UI; `COWORK_PROVIDER` switch UI **(mock/fal/Claude only — the `modal` option is deferred to P1b because it is
  super-admin-only and RBAC ships in P1b)**; `COWORK_PLANNER_SYSTEM`/ProjectBrief/description-template editing;
  $0/mock eval harness; per-family coverage metric.
- **P1b — RBAC (§④).** `User.role` + session callback + `requireRole(section,action)` + the §3 matrix const +
  per-action audit + founder backfill migration + signIn upsert + the Team & access UI. Unlocks the `modal`
  provider option (super-admin-gated). Slotted when multi-operator access is actually needed.
- **P3b — System & queue health (§⑤).** pg-boss jobs, failed gens, deploy status (read-only).
- **P4 — Content & moderation & audit (§③).** Review generated content + audit/log viewer (pull the read-only
  log-viewer slice forward to ride with P2 so uncensored-planner output is reviewable from when a paid planner
  is enabled). Moderator = review/audit-only (per decision); the real fal-safety gate (per-model safety params on
  the worker call) is a separate later task, NOT shipped as a fake guard.
- **P5 — PLUS.** marketing/analytics, support, invite-codes/subscriptions, export — deferred / read-only stubs.

---

## 7. Testing strategy (the guards both audit rounds demanded)

- **Auth:** a guard test DYNAMICALLY enumerates every file-level `"use server"` lib file + asserts each exported
  action calls `requireSession`/`requireRole` before any prisma write (catches a future studio-actions-style
  omission); data-bearing pages + `/files` redirect/401 on unauth.
- **Disable:** a disabled model is rejected at startGen, startRefGen, dispatchVariantJob, AND the worker
  (handleGen + handleRefGen); an already-queued job for a now-disabled model fails without spending;
  fail-closed-to-typed-menu on a config-read fault.
- **Registry subset property:** for ANY (even garbage/malicious) overlay contents, the resolved enabled-set is
  ALWAYS a subset of `[...GEN_MODELS,...GEN_VIDEO_MODELS,...REFGEN_MODELS]`; unknown modelIds ignored; core↔
  provider mapping test (VIDEO_CFG separate from GEN_VIDEO_MODEL_OPTIONS).
- **Composer:** directive appears EXACTLY ONCE in the coworkGenerate→startGen prompt (full round-trip, with and
  without a card model-override); changes only the prompt string; $0; clamped; correct family/mode incl. the
  {image, entityIds} keyframe case.
- **Runtime-config:** empty table + no env → exact current defaults; garbage DB value clamps/fails-closed; a
  provider value with a missing web credential → getTransport catches → mock (and write-time validation rejects
  the toggle); a change is observed on the next coworkTurn AND enhancePrompt AND coworkDraftStoryboard.
- **Ledger:** spentUsd written in all charged paths for gen (commit tx) AND refgen (3 points) AND variant;
  REFGEN_PRICE used for refgen, videoPriceUsd/GEN_PRICE for gen; historical cost frozen.
- **RBAC:** the section→role matrix const covers all 6 sections; role assignment is super-admin-only +
  self-escalation-proof; denied attempts audited; founder backfill + signIn upsert both read FOUNDER_ADMIN_EMAILS.
- All gen/LLM tests run with `GENERATION_PROVIDER=mock` + `COWORK_PROVIDER` unset; kill stale fal workers first.

---

## 8. Explicitly deferred / out of scope (record, don't build)

- Per-user multi-tenancy (migrating `ownerId` off `FOUNDER_OWNER_ID`) — the dashboard is team-only.
- `autoSpendBudget` / autonomous-spend authorization — contradicts "agent never triggers media spend"; additive
  later is free. P4 uses usage-ACCOUNTING (read spend), not budget-authorization.
- Real fal content-moderation gate (per-model safety params) — its own task before Moderator becomes enforcement.
- Modal self-hosted planner deployment **+ provider A/B + failover settings** (user-vision §1) — the user's
  parallel infra track; the `COWORK_PROVIDER=modal` seam + runtime toggle (P1b-gated) are ready for it.
- Direct GenSpace/Storyboard prompt composition — the composer here is cowork-card-only.
- Admin network-layer hardening for formal launch — the dashboard is same-domain `/admin/*` in the web app
  (auth allowlist + layout gate + P1b RBAC). When Artlio formally launches, OPTIONALLY add Cloudflare Access /
  IP-allowlist over the `/admin/*` path for a network-layer gate (no service split needed). A separate
  `admin.artlio.com` subdomain/service is explicitly NOT planned (overkill for a team tool). [user 2026-06-17]
