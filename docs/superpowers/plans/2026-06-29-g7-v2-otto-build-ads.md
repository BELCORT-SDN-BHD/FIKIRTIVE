# G7 v2 — Otto Builds Ads (the strategist) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Otto act as a brand-grounded media strategist: from a goal, propose a reasoned ad plan (Brand Brain + assets + insights) and build the whole campaign as a PAUSED draft in the user's real Meta account — spending $0 until the user launches it through v1's existing gate.

**Architecture:** Otto only PROPOSES (a strategist skill writes a BUILD card; read skills list pages/objects). The sole Meta-CREATE writer is a trusted server action `buildAdDraft` (NOT a skill) that creates campaign→adset→creative→ad ALL PAUSED, idempotently. "Build a paused draft" is a new money-class-`safe` op (paused spends nothing); modes ① ask / ② auto-build. LAUNCH = un-pause = v1's `approveMetaActionPlan` resume gate (no new spend path). Mirrors v1's `propose-meta-action`→`metaPropose`→`runApprovedPlan` seam.

**Tech Stack:** TypeScript, Next.js (apps/web), Prisma/Postgres, `@openai/agents` Otto framework, Vitest. Builds on G7 v1 (merged) + Brand Brain (G3b).

**Spec:** `docs/superpowers/specs/2026-06-29-g7-v2-otto-build-ads-design.md`.

## Global Constraints

- **Build = paused = $0 = money-class `safe`.** Creating PAUSED objects never spends. The only spend is LAUNCH = v1's resume gate. Never call v1's spend path from the build writer beyond the launch handoff.
- **SoD:** the LLM never sets money-relevant facts or touches Meta; it proposes copy/strategy. The server validates every concrete id (assetId, adsetId, pageId, objective ∈ supported set) against the owner's account.
- **`requireOwner` first** on every server action; ids never from the LLM as identity; owner-scoped. Block `isImpersonating`. Honor the kill-switch (`adsWritesPaused`) and `canWrite` on the build writer.
- **Skills reach Meta ONLY via injected ctx ports** (CI-fenced — `scripts/check-skill-imports.sh` already blocks `meta-graph` imports in skills; do not import it in any new skill).
- **Supported objectives (exact):** `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES`. The typed builder rejects anything else (fail-closed → friendly message, no card).
- **Everything created is `status:"PAUSED"`** and `special_ad_categories:[]`.
- **Exactly-once create:** one `MetaActionExecution` row per created object (`meta-build:<cardId>:<step>`), `appliedValue` = the created id; a re-run reads created ids, never re-creates. Partial-create → stop + report created ids; NO auto-delete.
- Tests mock the Meta Graph client + storage — no real Meta calls, no real uploads.
- Test commands: `pnpm --filter @fikirtive/web test <name>`, `pnpm --filter @fikirtive/otto test <name>`. Typecheck a file: `DATABASE_URL="postgresql://u:p@localhost:5432/db" pnpm --filter @fikirtive/web exec tsc --noEmit 2>&1 | grep <file>`. Catalog: `pnpm --filter @fikirtive/otto run catalog`. Fence: `bash scripts/check-skill-imports.sh`.
- **Worktree env:** work ONLY in `/Users/winnin/Desktop/fikirtive/.claude/worktrees/distracted-maxwell-7d1884` (branch `claude/g7-v2-build-ads`); deps installed; verify `git rev-parse --show-toplevel` before committing; NEVER touch `/Users/winnin/Desktop/fikirtive` (main checkout). No live `DATABASE_URL` → migrations are hand-written (see Task 1), validate with `prisma validate`+`generate`.

---

## File Structure

**New:** `apps/web/lib/meta-build-spec.ts` (pure: objectives, targeting mapping, `buildAdBuildCard`) · `apps/web/lib/meta-pages.ts` (owner-scoped `fetchOwnerPages`) · `apps/web/lib/meta-build-propose.ts` (`proposeAdBuildForOwner` port impl) · `apps/web/lib/meta-build-actions.ts` (`buildAdDraft` executor + `approveAdBuild` + `maybeAutoBuild`) · `packages/otto/src/skills/{propose-ad-build,list-meta-pages}.ts` · `apps/web/components/otto/OttoAdBuildCard.tsx`.
**Modify:** `packages/db/prisma/schema.prisma` (+migration) · `apps/web/lib/meta-graph.ts` (`listPages`, `metaGraphUpload`, `uploadAdImage/Video`, create POSTs) · `apps/web/lib/meta-actions.ts` + `meta-oauth.ts` (Page scope + `canManagePages` + `defaultPageId`) · `apps/web/lib/meta-action-policy.ts` (`build` op = safe) · `packages/otto/src/context.ts` (`metaPages`/`metaBuild`/`brandBrain` ports) · `registry.ts` · `apps/web/lib/otto-actions.ts` (inject ports) · `dto.ts`/`otto-ui-messages.ts`/`types.ts`/`otto-inject-helpers.ts` (BUILD_CARD) · both MessageRow surfaces (`OttoConversation.tsx`, `studio/Cowork.tsx`) · `apps/web/lib/otto-client-actions.ts` (`approveAdBuild`) · `packages/otto/src/instructions.ts` · `apps/worker/src/otto-resume.ts` (withhold build port — verify).

---

# PHASE A — Foundation (reads, scope, the safe-build money-class; no Meta create yet)

## Task 1: DB schema — BUILD_CARD, Page fields

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/<ts>_g7v2_build/migration.sql`.
**Interfaces — Produces:** `ChatMessageKind.BUILD_CARD`; `MetaConnection.canManagePages Boolean @default(false)`; `MetaConnection.defaultPageId String?`.

- [ ] **Step 1:** Add `BUILD_CARD` to `enum ChatMessageKind` (alongside `ACTION_CARD`); add to `model MetaConnection`: `canManagePages Boolean @default(false)` and `defaultPageId String?`.
- [ ] **Step 2:** Hand-write the migration (no live DB): a folder `<YYYYMMDDHHMMSS>_g7v2_build` (timestamp later than the newest existing) with `ALTER TYPE "ChatMessageKind" ADD VALUE 'BUILD_CARD';` + `ALTER TABLE "MetaConnection" ADD COLUMN "canManagePages" BOOLEAN NOT NULL DEFAULT false;` + `ADD COLUMN "defaultPageId" TEXT;`. Match the SQL style of the newest existing migration.
- [ ] **Step 3:** Validate WITHOUT a DB: `DATABASE_URL="postgresql://u:p@localhost:5432/db" pnpm --filter @fikirtive/db exec prisma validate` then `... prisma generate` (no `migrate`). Note in the commit that application is deferred.
- [ ] **Step 4:** Commit: `feat(g7v2): db — BUILD_CARD kind + canManagePages/defaultPageId`.

## Task 2: Read FB Pages + Page-scope upgrade

**Files:** Modify `apps/web/lib/meta-graph.ts` (`listPages`), `apps/web/lib/meta-oauth.ts` (scope), `apps/web/lib/meta-actions.ts` (`completeMetaConnect`/`getMetaConnection`); Create `apps/web/lib/meta-pages.ts`; Create `packages/otto/src/skills/list-meta-pages.ts`; Modify `packages/otto/src/context.ts`, `registry.ts`, `apps/web/lib/otto-actions.ts`. Tests: `apps/web/lib/__tests__/meta-pages.test.ts`, extend `meta-oauth.test.ts`/`meta-actions.test.ts`, `packages/otto/src/skills/list-meta-pages.test.ts`.

**Interfaces — Produces:**
- `type MetaPage = { id: string; name: string }`
- `listPages(token): Promise<any[]>` in meta-graph.ts (`GET /me/accounts` fields `id,name`)
- `fetchOwnerPages(ownerId): Promise<{ pages: MetaPage[] } | { needsReconnect: true } | { notConnected: true } | { needsPageScope: true }>` (meta-pages.ts; plain server fn, NOT `'use server'`; mirror `fetchOwnerAdObjects`)
- `getMetaConnection` result gains `canManagePages: boolean`, `defaultPageId: string|null`
- `OttoContext.metaPages?: { list(): Promise<...> }`; skill `listMetaPages` (free/read/external, ungated; mirror `metaListObjects`)

- [ ] **Step 1 (TDD):** `meta-pages.test.ts` — mock graph+prisma: notConnected when no row; maps pages from `listPages`; `needsPageScope:true` when `conn.canManagePages===false`; `needsReconnect` on code-190. Run → FAIL.
- [ ] **Step 2:** Implement `listPages` (mirror `listCampaigns`'s `metaGraphGet` shape) + `fetchOwnerPages` (mirror `fetchOwnerInsights`: owner-scoped conn → if `!canManagePages` return `{needsPageScope:true}` → decrypt → `listPages` → map; 190 → needsReconnect). Run → PASS.
- [ ] **Step 3 (TDD):** `meta-oauth.test.ts` — authorize url now requests `pages_show_list` (and `business_management`) in addition to `ads_read,ads_management`. `meta-actions.test.ts` — `completeMetaConnect` sets `canManagePages = granted.includes("pages_show_list")`; `getMetaConnection` returns `canManagePages`+`defaultPageId`. Run → FAIL.
- [ ] **Step 4:** Implement: add `pages_show_list,business_management` to `buildAuthorizeUrl` scope; in `completeMetaConnect` set `canManagePages` from granted scopes + seed `defaultPageId:null`; extend `getMetaConnection` select+return. Run → PASS.
- [ ] **Step 5:** `listMetaPages` skill (copy `meta-list-objects.ts`: free/read/external; calls `ctx.metaPages.list()`; friendly message on notConnected/needsReconnect/needsPageScope — "Reconnect Meta and allow Page access so I can build ads."). Add `metaPages` port to `context.ts`; inject `metaPages: { list: () => fetchOwnerPages(ownerId) }` in `buildOttoContext`; register in `registry.ts`; regenerate catalog. Test `list-meta-pages.test.ts` (gate + port). Run otto test → PASS; fence exit 0.
- [ ] **Step 6:** Commit: `feat(g7v2): read FB Pages + pages_show_list scope + listMetaPages skill`.

## Task 3: money-class `build`=safe + objective/targeting validation (pure)

**Files:** Modify `apps/web/lib/meta-action-policy.ts`; Create `apps/web/lib/meta-build-spec.ts` (validators only this task); Tests: extend `meta-action-policy.test.ts`, `apps/web/lib/__tests__/meta-build-spec.test.ts`.

**Interfaces — Produces:**
- `meta-action-policy.ts`: extend `AdOp` with `"build"`; `classifyMoneyClass("build") === "safe"`.
- `meta-build-spec.ts`: `type BuildObjective = "OUTCOME_TRAFFIC"|"OUTCOME_ENGAGEMENT"|"OUTCOME_LEADS"|"OUTCOME_SALES"`; `const SUPPORTED_OBJECTIVES: readonly BuildObjective[]`; `function isSupportedObjective(s: string): s is BuildObjective`; `type TargetingHint = { countries?: string[]; cities?: string[]; ageMin?: number; ageMax?: number; interests?: string[] }`; `function shapeTargeting(hint: TargetingHint|undefined): Record<string, unknown>` (maps to a valid Meta targeting spec; empty/unmappable → broad `{ geo_locations: { countries: ["MY"] } }` default — document the MY default); `function isValidHttpUrl(s: string): boolean`.

- [ ] **Step 1 (TDD):** `meta-action-policy.test.ts` — `classifyMoneyClass("build")` is `"safe"`; `policyDecision("AUTO","safe")==="auto"` already covers build-auto. `meta-build-spec.test.ts` — `isSupportedObjective` true for the 4, false for `"OUTCOME_AWARENESS"`/junk; `shapeTargeting({countries:["MY"],ageMin:25,ageMax:44})` → `{ geo_locations:{countries:["MY"]}, age_min:25, age_max:44 }`; `shapeTargeting(undefined)` → broad MY default; `isValidHttpUrl` true for `https://kaia.com/x`, false for `javascript:...`/`""`. Run → FAIL.
- [ ] **Step 2:** Implement: add `"build"` to `AdOp` + `SAFE_OPS` in `meta-action-policy.ts`. Implement `meta-build-spec.ts` validators. Run → PASS.
- [ ] **Step 3:** Commit: `feat(g7v2): build=safe money-class + objective/targeting/url validators`.

---

# PHASE B — The build pipeline

## Task 4: Asset upload to Meta (`metaGraphUpload` + image/video)

**Files:** Modify `apps/web/lib/meta-graph.ts`; Test `apps/web/lib/__tests__/meta-graph.test.ts`.
**Interfaces — Produces:**
- `metaGraphUpload(token, path, fields: Record<string,string>, file: { bytes: Buffer|Uint8Array; filename: string; contentType: string }): Promise<any>` — multipart POST, same auth + `metaError`/code-190 contract as `metaGraphPost`.
- `uploadAdImage(token, accountId, file): Promise<string>` (`POST /act_<id>/adimages` → returns the `image_hash`)
- `uploadAdVideo(token, accountId, file): Promise<string>` (`POST /act_<id>/advideos` → returns the `video_id`)

- [ ] **Step 1 (TDD):** mock `fetch` — `uploadAdImage` posts multipart to `…/adimages` and returns the `image_hash` from `{ images: { bytes: { hash } } }` (use Meta's real response shape); a 190 error throws with `.metaError.code===190`. Run → FAIL.
- [ ] **Step 2:** Implement `metaGraphUpload` (mirror `metaGraphPost` auth/error contract but `body: FormData` with the file + fields) + the two helpers (parse the documented Meta response shapes: adimages → `images[<filename>].hash`; advideos → `id`). Run → PASS.
- [ ] **Step 3:** Commit: `feat(g7v2): metaGraphUpload + adimages/advideos upload`.

## Task 5: `buildAdBuildCard` payload builder (pure)

**Files:** Modify `apps/web/lib/meta-build-spec.ts` (add the builder + payload types); Test `apps/web/lib/__tests__/meta-build-spec.test.ts`.
**Interfaces — Consumes:** `isSupportedObjective`, `shapeTargeting`, `isValidHttpUrl` (Task 3); `buildApproval`/`Approval`/`PlanStep` (`meta-approval.ts`); `MetaAdObject` (`meta-objects.ts`); `MetaPage` (Task 2).
**Produces:**
- `type AdBuildInput = { goal: string; reasoning: string; mode: "create"|"into_existing"; objective: string; pageId: string; targetingHint?: TargetingHint; dailyBudgetMinor: number; startTime?: string; creative: { assetId: string; kind: "image"|"video"; message: string; headline?: string; cta: string; link: string }; intoExisting?: { adsetId: string } }`
- `type MetaAdBuildCardPayload` = the spec §6 shape (with server-shaped `targeting`, `approval`, `buildOutcome?`).
- `function buildAdBuildCard(input: AdBuildInput, ctx: { accountId: string; assetExists: boolean; assetKind: "image"|"video"; pageValid: boolean; adsetValid: boolean }, actor: string, nowIso: string): MetaAdBuildCardPayload` — **validates** objective ∈ supported (else throw `unsupported objective`), `isValidHttpUrl(link)` (else throw `invalid link`), `dailyBudgetMinor > 0` (else throw), `assetExists`/`pageValid`/(if into_existing)`adsetValid` (else throw — the caller pre-resolves these flags from owner-scoped lookups). Shapes `targeting = shapeTargeting(input.targetingHint)`. Builds `approval = buildApproval([{index:0, op:"build", targetId: input.creative.assetId, targetValue: { objective, dailyBudgetMinor, pageId, mode, adsetId }}], actor, nowIso, 10*60*1000)`.

- [ ] **Step 1 (TDD):** valid create input → payload with `mode:"create"`, server-shaped `targeting`, `approval.paramHash` truthy, `buildOutcome` absent; unsupported objective throws; bad link throws; `dailyBudgetMinor:0` throws; `into_existing` with `adsetValid:false` throws; missing asset throws. Run → FAIL.
- [ ] **Step 2:** Implement. Run → PASS.
- [ ] **Step 3:** Commit: `feat(g7v2): buildAdBuildCard — validated, server-shaped BUILD payload`.

## Task 6: `proposeAdBuild` skill + `proposeAdBuildForOwner` port

**Files:** Create `apps/web/lib/meta-build-propose.ts`, `packages/otto/src/skills/propose-ad-build.ts`; Modify `packages/otto/src/context.ts` (`metaBuild` port + a `brandBrain` port), `registry.ts`, `apps/web/lib/otto-actions.ts`. Tests: `apps/web/lib/__tests__/meta-build-propose.test.ts`, `packages/otto/src/skills/propose-ad-build.test.ts`.

**Interfaces — Produces:**
- `OttoContext.metaBuild?: { propose(input: AdBuildInput-shape): Promise<{ cardId: string; autoBuilt: boolean } | { notConnected: true } | { needsReconnect: true } | { needsPageScope: true } | { invalid: Array<{ field: string; reason: string }> }> }` (structural input re-declared in otto — no web import).
- `proposeAdBuildForOwner(ownerId, threadId, input): ...` in `meta-build-propose.ts`: `fetchOwnerPages` (friendly variants) → resolve flags: assetExists (owner-scoped `Generation`/`Asset` lookup by `assetId` + its kind), pageValid (input.pageId ∈ pages OR `defaultPageId`), adsetValid (if into_existing, `fetchOwnerAdObjects` contains the adset), objective supported, link valid, budget>0 — collect failures into `invalid[]` (NO card if any); else `buildAdBuildCard(...)` → persist ONE `BUILD_CARD` `ChatMessage` → return `{ cardId, autoBuilt:false }` (auto-build wired in Task 7).
- skill `proposeAdBuildSkill` (free/write/internal → ungated); `executeProposeAdBuild` calls `ctx.metaBuild.propose(input)` and renders the result as a confirmation or a friendly message (not connected / reconnect+pages / "I couldn't find that image" / "that's not a supported objective"). LLM input exposes ONLY the strategy fields (goal/reasoning/mode/objective/pageId/targetingHint/dailyBudgetMinor/startTime/creative/intoExisting) — NO server/identity/approval keys.

- [ ] **Step 1:** Add the `metaBuild` port (structural) + a `brandBrain: { context(): Promise<string> }` port to `context.ts`; inject `brandBrain` in `buildOttoContext` wired to the existing `getBrandContextText` (find it — G3b; it already feeds the agent, so reuse the same source/ownerId).
- [ ] **Step 2 (TDD):** otto `propose-ad-build.test.ts` — gate free/write/internal/ungated; calls `ctx.metaBuild.propose` and reports cardId; `{invalid:[...]}` → friendly message, no throw; zod input has no `approval`/`targeting`(shaped)/identity keys. web `meta-build-propose.test.ts` (mock `fetchOwnerPages`/`fetchOwnerAdObjects`/prisma/Generation) — persists ONE BUILD_CARD with server-built payload; `needsPageScope` pass-through; `invalid` when asset not owned / objective unsupported / bad link → NO card persisted. Run → FAIL.
- [ ] **Step 3:** Implement the port impl (copy the persist shape from `meta-propose.ts` `proposeMetaActionForOwner`, payload via `buildAdBuildCard`) + the thin skill (copy `propose-meta-action.ts`); inject `metaBuild` in `buildOttoContext`; register the skill; regenerate catalog. Run both suites → PASS; fence exit 0 (the skill imports NO meta-graph/prisma/web).
- [ ] **Step 4:** Commit: `feat(g7v2): proposeAdBuild skill (thin) + metaBuild port — strategist, owner-validated`.

## Task 7: `buildAdDraft` executor — the only Meta-create writer

**Files:** Create `apps/web/lib/meta-build-actions.ts`; Modify `apps/web/lib/meta-build-propose.ts` (auto-build trigger), `apps/web/lib/otto-actions.ts` (no extra port — executor reached via approve action + auto), `apps/web/lib/otto-client-actions.ts` (`approveAdBuild`), `apps/worker/src/otto-resume.ts` (verify withheld). Test `apps/web/lib/__tests__/meta-build-actions.test.ts`.

**Interfaces — Produces:**
- `runAdBuild(ownerId, cardId): Promise<{ createdIds: Record<string,string>; state: "done"|"partial"|"failed" }>` — the trusted ordered create (NOT `'use server'`). Mirrors `runApprovedPlan` discipline.
- `approveAdBuild(cardId)` (`'use server'`): `requireOwner` → impersonation-block → **kill-switch + canWrite check BEFORE consume** (per the v1 ultra-fix) → load owner BUILD_CARD → `verifyApproval(payload.approval, [the same single build PlanStep], ownerId, now)` → consume → `runAdBuild`. Surface via `otto-client-actions.ts`.
- `maybeAutoBuild(ownerId, cardId)`: mode `AUTO` (build is `safe`, `policyDecision("AUTO","safe")==="auto"`) + kill-switch/canWrite OK → `runAdBuild` without human approval; called from `proposeAdBuildForOwner` after persist (wrapped in try/catch → `autoBuilt:false`/`buildOutcome` on throw, per the v1 maybeAutoRun fix). Records `buildOutcome` on the card.

**runAdBuild algorithm (ALL created objects `status:"PAUSED"`):** load conn (kill-switch→throw, `!canWrite`→refuse), decrypt token, load BUILD_CARD payload. Per object IN ORDER with a `MetaActionExecution` claim (`findFirst` by `(ownerId, cardId, stepIndex)` → if APPLIED read `appliedValue` as the created id, SKIP the create; else `create` PENDING w/ P2002-catch → APPLYING → create → store id in `appliedValue`, APPLIED):
1. `step 0` upload: read the owner's asset bytes from storage (owner-scoped `Generation`/`Asset`), `uploadAdImage`/`uploadAdVideo` → `imageHashOrVideoId`.
2. `step 1` creative: `metaGraphPost /act_<id>/adcreatives` with `object_story_spec` (page_id, link_data{message,link,image_hash,call_to_action{type:cta,value:{link}}} OR video_data{video_id,message,call_to_action,image:thumbnail}) → `creative_id`.
3. (create mode) `step 2` campaign → `step 3` adset (with `targeting`, `daily_budget`, `billing_event:"IMPRESSIONS"`, an `optimization_goal` valid for the objective, `status:PAUSED`, `start_time`). (into_existing: skip 2–3; use `payload.intoExisting.adsetId`.)
4. `step 4` ad → `metaGraphPost /act_<id>/ads {name, adset_id, creative:{creative_id}, status:PAUSED}` → `ad_id`.
Partial failure → stop, return `state:"partial"` with the `createdIds` so far (recorded in the rows; NO auto-delete). `done` when the ad is created.

- [ ] **Step 1 (TDD):** mock graph(+upload)+prisma+storage. Cover: kill-switch → throws, no graph calls; `!canWrite` → refusal; create-path builds all 5 objects PAUSED in order, threading ids (assert each create body has `status:"PAUSED"` and the parent id from the prior step); into_existing skips campaign+adset and uses the given adsetId; idempotent — a re-run with `step 2` already APPLIED reads the id, no second campaign create; partial — `step 3` create throws → `step 4` not attempted, state `partial`, earlier ids returned. `approveAdBuild`: impersonation blocked; kill-switch ON → error, approval NOT consumed (re-approve after un-pause works); valid → consumes + runs. `maybeAutoBuild`: AUTO + canWrite → runs; ASK or kill-switch → not run; a throw → `buildOutcome.built=false`, no turn-throw. Run → FAIL.
- [ ] **Step 2:** Implement `runAdBuild` + `approveAdBuild` + `maybeAutoBuild` (mirror `meta-write-actions.ts` `runApprovedPlan`/`approveMetaActionPlan`/`maybeAutoRun` patterns — owner-scope, claim, P2002-catch, kill-switch-before-consume, gate-before-consume). Wire `maybeAutoBuild` into `proposeAdBuildForOwner` (try/catch; set `buildOutcome`). Surface `approveAdBuild` in `otto-client-actions.ts`. Confirm `apps/worker/src/otto-resume.ts` never imports the build executor (add a guard test like the v1 worker test). Run → PASS; tsc clean.
- [ ] **Step 3:** Commit: `feat(g7v2): buildAdDraft — sole Meta-create writer (paused, ordered, idempotent) + approve/auto gates`.

---

# PHASE C — UI + launch handoff

## Task 8: BUILD_CARD threading + derive state

**Files:** Modify `apps/web/lib/types.ts`, `apps/web/lib/dto.ts`, `apps/web/lib/otto-ui-messages.ts`, `apps/web/lib/otto-inject-helpers.ts`. Test: extend `otto-inject-helpers.test.ts`, `dto.test.ts`.

- [ ] **Step 1 (TDD):** `deriveBuildState(payload, executions)` → `"pending"|"building"|"built"|"partial"|"failed"` (mirror `deriveActionState`). Run → FAIL.
- [ ] **Step 2:** Add `"BUILD_CARD"` to `ChatMessageDTO.kind` + `OttoUiMessageMetadata.kind`; a `placeholderTextFor` case ("Otto drafted an ad plan."); the `dto.ts` `BUILD_CARD` payload arm that **strips `approval.boundActor`+`paramHash`** (client-safe, per the v1 ultra-fix) — keep `approval.expiresAt`/`consumedAt`, all display fields, and `buildOutcome`; implement `deriveBuildState`. Run → PASS.
- [ ] **Step 3:** Commit: `feat(g7v2): thread BUILD_CARD through DTO/ui-messages + deriveBuildState (client-safe payload)`.

## Task 9: `OttoAdBuildCard` + MessageRow + launch handoff

**Files:** Create `apps/web/components/otto/OttoAdBuildCard.tsx`; Modify `apps/web/components/otto/OttoConversation.tsx`, `apps/web/components/studio/Cowork.tsx`. (Launch handoff reuses v1 — no new launch code.)
**Interfaces — Consumes:** `MetaAdBuildCardPayload`, `approveAdBuild` (`otto-client-actions.ts`), `proposeMetaAction`/the v1 ACTION_CARD for launch.

- [ ] **Step 1:** Build `OttoAdBuildCard.tsx` (model on `OttoActionPlanCard.tsx`): render the strategy (objective + `reasoning`), targeting summary, the creative preview (the asset + `message`/`headline`/`cta`/`link`), suggested `dailyBudgetMinor` (currency-aware via the v1 `formatMoney` guard — handle the account currency), Page name. Control: if `payload.buildOutcome?.built` → "Draft built ✓ — review & **Launch**" with a Launch affordance; else if `payload.autoEligible`-style mode-② state → auto-built status; else **Approve**/**Deny** (`approve()` → `approveAdBuild(cardId)`). Honest copy: "Otto builds this paused — **nothing spends until you launch**."
- [ ] **Step 2 — Launch handoff:** the **Launch** affordance creates a **v1 ACTION_CARD** that `resume`s the built campaign/adset/ad ids (call the v1 `proposeMetaAction`-equivalent server path, OR a thin `launchAdDraft(cardId)` server action that builds a v1 resume ACTION_CARD from `payload.buildOutcome.createdIds` and routes to `approveMetaActionPlan`). Reuse v1's gate verbatim — do NOT write new spend code. (If the simplest path is "open in Meta to launch," still provide the in-Otto launch via the v1 resume gate.)
- [ ] **Step 3:** Wire `kind === "BUILD_CARD"` → `<OttoAdBuildCard/>` in both `OttoConversation.tsx` and `Cowork.tsx`. tsc clean on changed files.
- [ ] **Step 4:** Commit: `feat(g7v2): OttoAdBuildCard + render wiring + launch-via-v1-gate handoff`.

## Task 10: Otto instructions + catalog + full verification

**Files:** Modify `packages/otto/src/instructions.ts`, `packages/otto/src/skills/CATALOG.md` (regenerated).

- [ ] **Step 1:** Add a strategist block to `instructions.ts`: when the user wants to advertise / promote something, Otto should (1) `metaListObjects`/`listMetaPages` as needed, (2) ground the plan in Brand Brain, (3) call `proposeAdBuild` with the strategy (goal, objective from the supported 4, chosen existing asset, brand-voice copy, CTA, link, a suggested budget, targeting hint) — Otto NEVER claims it launched/spent; it builds a PAUSED draft and the user launches. Otto must NOT invent asset/adset/page ids (use the ids from the read skills) and must NOT set money-class.
- [ ] **Step 2:** `pnpm --filter @fikirtive/otto run catalog` — confirm `propose-ad-build` (free/write/internal/❌) + `list-meta-pages` (free/read/external/❌) present; NO build WRITER skill (it's a server action).
- [ ] **Step 3 — Full verification:** build workspace packages, then `pnpm --filter @fikirtive/otto test` + `pnpm --filter @fikirtive/web test` (G7v2 suites green; identify pre-existing DB failures via comparison), `tsc --noEmit` (web+worker, no new errors), `bash scripts/check-skill-imports.sh` (exit 0). Fix any cross-task integration break.
- [ ] **Step 4:** Commit: `feat(g7v2): strategist instructions (build-only) + catalog + verification`.

---

## Self-Review (against the spec)

**Spec coverage:** §2 experience → Tasks 6,7,9. §3 money-safety (build=safe, launch=v1) → Tasks 3,7,9. §4 autonomy ①+② → Tasks 3,7. §5 skills+writer+fence → Tasks 2,6,7,10. creative pipeline → Tasks 4,7. Page binding → Tasks 1,2,7. §6 data model → Tasks 1,5,8. §7 scope (objectives/single-adset/image+video/Page-required/into-existing) → Tasks 3,5,6,7. §8 reuse → every task mirrors a named v1/G3b symbol. §9 security/idempotency → Tasks 6,7. §10 testing → every task TDD. open-Qs §12 resolved: Page scope (Task 2), targeting (Task 3 shapeTargeting + MY-broad fallback), link (Task 3 isValidHttpUrl + LLM-proposed), default page (Task 1 defaultPageId).

**Placeholder scan:** mirror-citations point at concrete v1/G3b files (implementers read them); all new signatures defined in their task's Interfaces block.

**Type consistency:** `AdBuildInput`/`MetaAdBuildCardPayload`/`BuildObjective`/`TargetingHint`/`MetaPage` consistent across Tasks 2/3/5/6/7/8/9. `build` op (money-class safe) consistent across Tasks 3/7. `approval` reuses v1's `meta-approval.ts` shape. The executor mirrors `runApprovedPlan`'s `MetaActionExecution` claim exactly (Task 7 ↔ v1).

**Open (resolve in implementation):** the exact `optimization_goal` per objective (Task 7 — pick a valid default per objective from Meta's docs); the adcreative `object_story_spec` exact shape for image vs video (Task 7 — follow Meta Marketing API docs, mock in tests); whether `business_management` is actually required alongside `pages_show_list` (Task 2 — request both; harmless if one is unused).
