> **性质**:给 agent 的深度参考(总蓝图 `docs/BLUEPRINT.md` 的原料层)。大变更后由总审查员更新或重生成 —— 这一层**允许**演进。

# FIKIRTIVE 扩展缝隙总清单 — The Expansion Seams (2026-07-02)

> How new features plug into the city without breaking it. For each seam: what it connects, the exact recipe (with a worked example already in the repo), and what breaks if you go around it. Paths are repo-relative. Worktree ≈ origin/main @ 00bc499 (includes #99 storyboard). Companion deep-dive: `docs/review/CODEBASE-MAP-2026-07-02.md` + `docs/review/REVIEWER-PLAYBOOK.md`.

## The city's traffic laws (apply to every seam)

1. **Identity comes from the session, never the client/model.** Every action opens with `requireOwner()` (`apps/web/lib/auth-guard.ts`) and uses `gate.ownerId`. Spend + mutations additionally check `isImpersonating()`.
2. **Validate-before-spend.** Typed zod contracts (`.strict()` + `superRefine`) reject anything a provider would mischarge for — BEFORE a job row or reservation exists.
3. **Money exactly-once = DB partial-unique indexes,** never app-level checks alone. All 10 raw-SQL partial/expression indexes are inventoried in `docs/review/CODEBASE-MAP-2026-07-02.md` §5 (they are invisible to `prisma migrate diff` — schema comments are the only in-schema record).
4. **Fail closed.** Missing classification → most dangerous value (skills); no session → error, never a default org; misconfigured provider → $0 mock, never silent real spend.
5. **Typed tables are the capability truth.** Admin overlays/config can only NARROW (disable), never widen.

---

## Seam 1 — defineOttoSkill (Otto 技能框架)

**Connects:** the LLM agent loop (@openai/agents) ↔ app capabilities (DB reads, external APIs, spend) with a build-time safety gate.

**Files:**
- `packages/otto/src/skill.ts` — the fail-closed factory
- `packages/otto/src/skills/AGENTS.md` — the canonical 5-step recipe (auto-loaded as skills/CLAUDE.md)
- `packages/otto/src/skills/_template.ts` — copy-me starter
- `packages/otto/src/registry.ts` — `allSkills` (one line per skill; array order = agent tool order); `registry.test.ts` pins the exact sorted 16-name list
- `packages/otto/src/context.ts` — `OttoContext` ports (the ONLY door to the outside)
- `packages/otto/src/catalog.ts` → `skills/CATALOG.md` (`pnpm --filter @fikirtive/otto run catalog`)
- `scripts/check-skill-imports.sh` — CI fence (`.github/workflows/ci.yml:41`)
- Design spec: `docs/superpowers/specs/2026-06-26-otto-skill-framework-design.md`

**The 3-field declaration (cannot omit):**
- `cost: "free" | "spend"` (spend ⇒ REQUIRES `idempotencyKey` declaration)
- `effect: "read" | "write"` (our DB OR the outside world)
- `reach: "internal" | "external"`
- `needsApproval = cost==="spend" || (effect==="write" && reach==="external")` — external READS (web lookups) are not gated; external WRITES (post/publish) and all spend are.

**Factory enforcement (definition time, throw = build fails):** parameters must be `z.object`; identity keys `orgId/ownerId/userId` banned from parameters (identity from ctx only); spend without idempotencyKey → throw; missing cost/effect/reach default to the MOST dangerous (`spend`/`write`/`external`); optional `requires:[{field,question}]` 资讯门 — factory appends questions to the model-facing description AND preflights execute, returning `{needMoreInfo}` when fields are missing. NOTE: the declared `idempotencyKey` fn is never called at runtime — it documents the key; the real guard is inside execute + a DB unique index.

**The 5-step recipe (AGENTS.md, worked example `searchWeb` → live file `skills/research-web.ts`):**
1. **Declare a port** on `OttoContext` (`../context.ts`). Skills never call `fetch()`/fal/Prisma-for-external directly — only injected `ctx` ports.
2. **Inject the real port** in `apps/web/lib/otto-actions.ts:buildOttoContext` (~line 120; API key, rate-limit, logging). Worker side (`apps/worker/src/otto-resume.ts`) builds a minimal ctx — `startGen` is INTENTIONALLY NOT injected there so a resumed verdict turn can never spend.
3. **Write the skill:** copy `_template.ts` → `skills/<name>.ts`, fill the 3 fields + `execute`. Also `export const <name> = <name>Skill.tool;`.
4. **Register:** import + one entry in `registry.ts` `allSkills` (update `registry.test.ts`'s pinned name list).
5. **Test + catalog:** gate assertion in `migration.test.ts` (or `<name>.test.ts`) + port-required guard; regenerate `CATALOG.md`. (Caveat: `catalog:check` is NOT in CI — a stale CATALOG.md won't block merge; regenerate manually.)

**Reference spend skill:** `skills/generate.ts` — the 7-step gate (port required → owner-scoped card recheck → exactly-once via `cowork:<cardId>` + DB index → disabled-model check → pure `buildGenRequestFromCard` with overrides:undefined (the model can never pass spend params) → `ctx.startGen` only → best-effort genJobId patch).

**Bypass consequences:** a hand-rolled `tool()` skips fail-closed derivation → an approval gate can silently fail open. Importing `@fikirtive/generation` or `reserveCredits` inside `skills/*` → CI hard-fails (`check-skill-imports.sh`; `fence.test.ts` proves it). Identity fields in parameters → the model chooses the tenant → cross-tenant action.

---

## Seam 2 — GenerationProvider + the model tables (生成模型/供应商缝)

**Connects:** the model menu the user sees ↔ the zod money-gate ↔ pricing ↔ the provider's actual API wiring. **The lockstep rule: one model = one entry in EVERY table, or the seam rejects it (by design).**

**Files & tables:**
- `packages/core/src/gen.ts`:
  - `GEN_MODELS` / `GEN_VIDEO_MODELS` — the typed menus (the zod authority)
  - `GEN_VIDEO_MODEL_INFO` — label / sound / tail facts (UI picker)
  - `GEN_VIDEO_MODEL_OPTIONS` — durations/resolutions/aspectRatios/fps/audioToggle/maxCount (what the endpoint really accepts; validated per-request in `genRequest.superRefine`)
  - `videoRateUsdPerSec` — exhaustive TS `switch` over `GenVideoModel` (COGS basis + live price hint)
  - `videoDefaults()` — first-of-each-list defaults
  - `modelFamily()` — prefix→family map (prompt-knowledge key; version bumps inherit automatically; unknown → undefined, never throws)
- `packages/generation/src/index.ts`:
  - `VIDEO_CFG` — per-model fal endpoints + param NAMES (imageParam/tailParam/firstLast/audioParam/resolutionParam/durationUnit "str"|"s"|"num"|"none")
  - `FAL_MODELS` — image t2i/edit endpoint ids
  - `MockProvider` ($0 deterministic) / `FalProvider` / `createGenerationProvider()` env factory (unset → mock; fail-safe)
  - `chargedError()` — tags `{charged:true}` on post-billing failures; the worker must terminal-fail these (a retry would re-POST = double charge). Plain errors = pre-charge, retryable.
- `packages/generation/src/byteplus.ts` — `BytePlusProvider` (`IMAGE_MODEL_MAP`, `VIDEO_MODEL_MAP`, async submit + in-provider poll with `TIMEOUT_MS` 15min < queue expire 20min)
- `packages/core/src/spend.ts` — `FLAT_PRICED_VIDEO_MODELS` + `VIDEO_CREDITS_BY_RESOLUTION` (BytePlus flat charge) vs `displayedFromUsd(genSpentUsd)` (fal models)
- `packages/core/src/model-registry.ts` — `ALL_MODEL_IDS` union (admin overlay validation domain)
- Worker singleton: `apps/worker/src/generation.ts` (`provider = createGenerationProvider()`)

**Recipe — add a video MODEL (worked examples: the `pixverse-v6` / `seedance-2` entries, all landed as single commits touching exactly these tables):**
1. Append id to `GEN_VIDEO_MODELS` (order = picker order).
2. Add its `GEN_VIDEO_MODEL_INFO` row (label/sound/tail — verify tail support against the endpoint schema).
3. Add its `GEN_VIDEO_MODEL_OPTIONS` row (only values the endpoint truly accepts; default-first lists).
4. Add its `videoRateUsdPerSec` case (TS exhaustiveness makes forgetting a compile error) — verify against the provider's pricing page.
5. Add its `VIDEO_CFG` entry in `packages/generation/src/index.ts` (endpoints + exact param names; comments there record verified quirks, e.g. seedance duration is a real int despite the schema page, grok/bytedance ids have no `fal-ai/` prefix).
6. If the family is new: extend `modelFamily()` + `MODEL_FAMILIES` (prompt knowledge), optionally a prompt skill or ModelDirective.
7. If charged flat (BytePlus-style): add to `FLAT_PRICED_VIDEO_MODELS` + resolution table in `spend.ts`.
8. Tests: `gen.test.ts` iterates `GEN_VIDEO_MODELS`; run a real cheap spend test before trusting param encodings (the seedance comment says exactly this).

**Recipe — add a PROVIDER (worked example: `byteplus.ts`, the fal→BytePlus migration):**
1. Implement `GenerationProvider` (`generate` + `generateVideo`; types in `packages/core/src/refgen.ts`). Providers download outputs and return bytes; the worker stores them content-addressed.
2. Honor the charge contract: pre-charge failures throw plain (retryable); anything after the provider billed throws `chargedError` (terminal). Batch = all-or-nothing (a paid-for-but-missing output is never silently dropped).
3. Reject unsupported request shapes PRE-spend (fal rejects `refVideoUrl`; BytePlus rejects `tailImageUrl` — defense in depth on top of the zod gate).
4. Add an env branch in `createGenerationProvider()` that THROWS if its key is missing; anything unrecognized stays mock ($0) so a misconfigured prod can't silently burn money.
5. Absorb async/polling INSIDE the provider (poll timeout < `GEN_QUEUE_POLICY.expireInSeconds`); the worker interface stays synchronous.

**Bypass consequences:** a model not in the menu never reaches the worker (`genRequest.superRefine` rejects — money safety, don't "fix" by loosening). Missing `VIDEO_CFG` → provider throws pre-POST, no spend. Skipping the options table → users can select values the endpoint 422s on, or costlier tiers than priced. Retrying a `charged` error → double billing. Charging users off `videoRateUsdPerSec` directly instead of `pricedGenCredits` → breaks reserve==settle determinism.

---

## Seam 3 — Credit ledger (记账缝：任何新的付费功能怎么收钱)

**Connects:** every paid action ↔ the per-org balance (THE spend cap) ↔ exactly-once accounting under retries/crashes/races.

**Files:**
- `packages/db/src/credits.ts` — **the SOLE writer of CreditAccount/CreditLedger.** `reserveCredits` / `settleCredits` / `refundReservation` / `grantCredits` / `grantCreditsTx` / `InsufficientCredits`.
- `packages/core/src/spend.ts` — pricing (units: internal credit = $0.01, displayed = 10 internal = $0.10; `pricedGenCredits`/`pricedRefgenCredits` = CHARGE, deterministic; `genSpentUsd`/`refgenSpentUsd` = record-only COGS; margin = the gap).
- Indexes (migration `20260619130000_credits`): `CreditLedger(orgId,idempotencyKey)` unique; `CreditLedger_ref_kind_once` (orgId,refId,kind) WHERE refId NOT NULL; `CreditLedger_finalizer_once` (orgId,refId) WHERE kind IN ('SETTLE','REFUND') — a job is settled XOR refunded, the losing finalizer P2002-no-ops BEFORE any account mutation.
- Worked examples: fixed-price job = `apps/web/lib/gen-actions.ts:startGen` + `apps/worker/src/jobs/gen.ts`; variable-price LLM = `packages/otto/src/meter.ts:withLlmBudget` (+ `apps/worker/src/jobs/llm-reservation-reaper.ts`); money-in = `apps/web/app/api/stripe/webhook/route.ts` + beta grant in `auth-guard.ts:bootstrapPersonalOrg`.

**Invariants (never break):** `balance == Σ balanceDelta`, `reserved == Σ reservedDelta` per org; account mutation + ledger row ALWAYS in one transaction; balance never negative (conditional UPDATE, not a check constraint); settle amount is read FROM the RESERVE ledger row, never recomputed (immune to price-code drift while a job is in flight); `settle`/`refund` use `createMany({skipDuplicates:true})` = ON CONFLICT DO NOTHING — deliberately NOT try/catch, because a caught P2002 leaves the whole PG transaction aborted and silently rolls back the caller's job-status write.

**Recipe — charge for ANY new paid thing:**
1. **Price it deterministically in core** (internal credits). Fixed price → reserve == settle, no reconciliation. Variable cost (LLM-style) → reserve a budget, settle `actualInternal ≤ reserved` (the remainder auto-refunds inside `settleCredits`).
2. **Pick a refId** unique per paid unit (Gen/RefGen use the job ULID; LLM turns use prefixed ids like `otto-stream:<userMessageId>`). If your reservation can leak (no worker finalizer), the refId prefix MUST join the allowlist in `llm-reservation-reaper.ts` — that prefix wall is what keeps the reaper off the generation spend path.
3. **Reserve in the SAME `$transaction` as your job-row insert:** `reserveCredits(tx,{orgId,refId,cost})`. `InsufficientCredits` rolls the whole tx back (no job) → return a friendly "out of credits" (client maps it to a Top-up link).
4. **Idempotency on the request:** REQUIRE an idempotencyKey in your contract (genRequest makes it non-optional: "a keyless request could otherwise bypass dedup and double-charge"). Fast-path pre-check + a partial-unique index on the job table as the race-proof backstop (`GenJob_active_idempotency_key` for re-submittable things, `GenJob_cowork_idempotency_once` LIKE 'cowork:%' for once-EVER things); catch P2002 → return the winner's job, no re-charge.
5. **Worker finalizes in the commit/fail transaction:** success commit tx = status write + `settleCredits`; terminal failure tx = FAILED write + `refundReservation`. Both idempotent via the partial uniques. Commit uses a conditional `updateMany(status:"GENERATING")`; 0 rows → throw the redelivery sentinel to roll back user-visible rows (see `gen.ts` skeleton, map §钱路 5).
6. **Snapshot COGS record-only** (`spentUsd` via `genSpentUsd`) at the commit point + a `spent` boolean (money truth; FAILED+spent = paid-but-not-delivered, auditable, founder absorbs).
7. **Money-in ONLY via `grantCredits`/`grantCreditsTx`** with an idempotencyKey (`stripe:<session.id>` — session-scoped so completed + async_payment_succeeded dedup; `signup:<orgId>` for the beta grant, atomic inside the org-bootstrap tx).

**Bypass consequences:** writing CreditAccount/CreditLedger anywhere else breaks the Σ invariants and the admin ledger views; reserving outside the insert tx → orphan holds or unfunded jobs; recomputing the settle amount → over/under-charge after a price change deploys mid-flight; a spend path without the key/index machinery → double-charge on double-click/redelivery (this is exactly what the partial uniques exist to make impossible). The `money-safety-review` skill + the skills CI fence (`reserveCredits` import ban) gate this seam in review.

---

## Seam 4 — Channel / connector foundation (渠道缝：TikTok/Lazada 怎么接)

**Connects:** third-party platforms (OAuth + tokens + capabilities) ↔ the Connections UI ↔ Otto's read/write skills ↔ per-org preferences.

**Files:**
- `apps/web/lib/channels/types.ts` — the `Channel` interface (`ChannelId` is an OPEN string, never a closed enum; capabilities; connectionStatus/connectUrl/disconnect/listTargets now, publish/insights stubbed `notImpl` until the Schedule/Analytics plans).
- `apps/web/lib/channels/registry.ts` — `registerChannel()` / `listChannels()` / `getChannel()`; adapters self-register by being imported here.
- Worked example adapter: `apps/web/lib/channels/instagram.ts` (+ `facebook.ts`, `meta-shared.ts`).
- OAuth pattern: `apps/web/lib/meta-oauth.ts` (HMAC-signed CSRF `state` = base64url({ownerId,nonce,ts}) + HMAC(BETTER_AUTH_SECRET), 10-min TTL, constant-time compare) + `apps/web/app/api/meta/{authorize,callback}/route.ts` (callback: `requireOwner` + `verifyState` + **`verified.ownerId === gate.ownerId`** + server-side code→token exchange in `meta-actions.ts:completeMetaConnect`; all errors redirect `/otto?view=connections&error=…`).
- Token storage: `MetaConnection` model (`schema.prisma:987`) — one per org (`ownerId @unique`), `accessTokenEnc` AES-256-GCM via `apps/web/lib/token-encryption.ts` (never plaintext, never client), capability booleans (`canWrite`/`canManagePages` — true only if the platform actually granted the scope), `adsWritesPaused` kill-switch, `adsAutonomy ASK|AUTO`.
- Write idempotency: `MetaActionExecution` — one row per (owner, card, stepIndex), unique `MetaActionExecution_step_once`.
- Per-org prefs: `Organization.settings Json` = `OwnerSettings` (`apps/web/lib/owner-settings.ts` — typed defaults + `mergeSettings` drops unknown keys/wrong types; `owner-settings-actions.ts` gates writes by `key in DEFAULT_SETTINGS` + typeof match + impersonation block). Already carries Schedule-ready keys (autoPublish, timezone, defaultPostTimes).

**Recipe — a TikTok (or Lazada) connector:**
1. **Storage:** `TikTokConnection` modeled on MetaConnection (ownerId @unique + Cascade FK written explicitly in schema — see the MetaConnection comment about migrate-dev drift; encrypted tokens; status; per-scope capability booleans; a kill-switch boolean for any write capability).
2. **OAuth routes:** `/api/tiktok/authorize` (requireOwner → `signState(ownerId)` → provider consent URL) and `/api/tiktok/callback` (requireOwner → verifyState → ownerId match → server-side token exchange → upsert connection → redirect to connections view with `connected`/`error` params). Reuse `signState`/`verifyState` verbatim.
3. **Adapter:** `lib/channels/tiktok.ts` implementing `Channel` (capabilities table from the platform docs; `listTargets` = the accounts/shops; publish/insights `notImpl` until their plan) + `registerChannel(tiktok)` in `registry.ts`. The Connections UI and future Schedule surface consume the registry — no per-channel UI forks.
4. **Otto skills via ports (Seam 1):** read skills = declare a port on `OttoContext`, inject in `buildOttoContext`, `defineOttoSkill` free/read/external (worked examples: `meta-insights.ts`, `list-meta-pages.ts`). Writes = the two-phase Meta pattern: a $0 `propose-*` skill that persists a card (Seam 8), then a gated web-side execute action with per-step `*ActionExecution` idempotency rows, autonomy ASK/AUTO, and the kill-switch checked at the executor.
5. **Prefs:** extend `OwnerSettings` with typed defaults — `mergeSettings` upgrades existing rows automatically; the Json column means NO migration.

**Bypass consequences:** unsigned/unchecked state → CSRF lets an attacker bind THEIR platform account to a victim org (or vice versa); tokens outside token-encryption → plaintext at rest; skipping the ownerId match in callback → connector hijack across tenants; writes without step-idempotency → duplicate posts/campaigns on retry; hardcoding a channel enum instead of the registry → every future channel touches every consumer.

---

## Seam 5 — Tenant model (租户缝：ownerId 到处都要在)

**Connects:** every business row ↔ exactly one Organization (the tenant) ↔ the session that may touch it.

**Files:** `apps/web/lib/auth-guard.ts` (`requireSession` — the spend gate; `requireRole` — operator RBAC, never gates spend; `requireOwner` — THE fail-closed session→ownerId resolver; `bootstrapPersonalOrg` — deterministic `org_<userId>`, atomic beta grant); `packages/db/src/tenant-guard.ts` (`TENANT_MODELS` backstop extension); `packages/core/src/storage-key.ts` (`keyOwnerMatches`, `FOUNDER_OWNER_ID="founder"` DO-NOT-CHANGE); schema conventions in `packages/db/prisma/schema.prisma` (every business table's `ownerId` FKs Organization with a required back-relation, ~25 of them; the `DEFAULT 'founder'` was dropped in migration 20260619140000 — inserts MUST supply ownerId).

**requireOwner contract (spec §6.3):** off-allowlist → error; founder-admin email → `"founder"` (the ONLY path that ever returns it); other users → their org, else synchronous idempotent bootstrap (org + Membership(owner) + beta grant in ONE tx); bootstrap failure → error, NEVER a default. Suspended/revoked memberships denied even if soft-deleted.

**Recipe — add a new owner-scoped model:**
1. Schema: `ownerId String` + `organization Organization @relation(...)` + the back-relation on Organization (prisma generate breaks without it — good, fail-loud) + `@@index([ownerId, …])` for your hot reads.
2. Add the model name to `TENANT_MODELS` in `tenant-guard.ts` (the backstop warns in prod / THROWS under test when `findMany/findFirst/updateMany/deleteMany` lack a defined `ownerId` filter).
3. Every server action: open with `requireOwner()`; scope every query with `gate.ownerId` (the guard's documented blind spots — raw SQL, nested writes, findUnique-by-unique-key, aggregate/groupBy — are YOUR responsibility + the 2-org isolation test).
4. Spend or mutation actions: also the `isImpersonating()` block (impersonation is for seeing, not acting — F15).
5. Any stored blobs: keys via `storageKey(ownerId, sha256, ext)` server-side; serving via `keyOwnerMatches` (404, not 403 — no existence oracle).
6. Soft-delete convention: `deletedAt DateTime?` if rows are user-visible history; queries carry `deletedAt: null`.

**Bypass consequences:** forgetting the TENANT_MODELS entry silences the backstop for that model; an unscoped query = cross-tenant read (prod only warns — by design a false positive must not 500 a live request, so the test-mode throw + isolation suite is the real net); defaulting ownerId or falling back to `"founder"` hands a user the founder's data AND credits.

---

## Seam 6 — Queue / worker (异步任务缝)

**Connects:** web (producer-only) ↔ Postgres `pgboss` schema (the bus) ↔ the long-lived worker container (consumer + supervisor + reapers).

**Files:** queue consts + POLICY per domain in `packages/core` (e.g. `gen.ts:GEN_QUEUE_POLICY`, `refgen.ts`, `timeline.ts` for render/caption); `apps/web/lib/queue.ts:getBoss` (lazy singleton, `supervise:false, schedule:false, migrate:false, max:2` — **the worker owns pg-boss schema migration; deploy-order rule: worker deploys first**); `apps/worker/src/index.ts` (explicit `createQueue` before `work` — v12 requirement; `batchSize:1`; `includeMetadata:true` so `retryCount` drives FAILED-vs-requeue; reap timer; graceful shutdown); handlers in `apps/worker/src/jobs/`; `apps/worker/src/redact.ts` (`sanitizeError` for anything persisted or rethrown into pg-boss job.output).

**Recipe — add an async job type (worked examples: $0 = `jobs/caption.ts`; paid = `jobs/gen.ts`):**
1. **Job-row model** in Prisma: status machine (QUEUED/…/DONE/FAILED), `@@index([status, updatedAt])` for the stuck-row reaper scan. **Persist the row BEFORE `boss.send`** (never orphan a job — and for paid jobs the reserve lives in that same insert tx, Seam 3).
2. **Queue consts in `packages/core`:** `X_QUEUE`, `X_DLQ`, `X_QUEUE_POLICY` with retryLimit, **explicit `retryDelay`** (pg-boss defaults retry_delay=0, which makes `retryBackoff` a silent no-op → instant retry hammering a paid provider), `expireInSeconds` LONGER than the longest legitimate run (else an active paid job gets expired + redelivered), `deadLetter`.
3. **Create the queue in BOTH places with the SAME policy object:** worker `index.ts` AND web `queue.ts:getBoss` (so boot order can't split policy — ingest skipped this and a fresh-DB web-first boot throws; don't repeat it).
4. **Dispatch:** `boss.send(X_QUEUE, { xJobId })` — payload is just the row id; the row holds real data.
5. **Handler:** idempotent; DONE short-circuit; **atomic claim** via conditional `updateMany` (QUEUED → RUNNING, with a stale-claim window < queue expire, cf. STALE_MS 13m vs expire 15m in render); `final = retryCount >= LIMIT` decides FAILED vs reset-to-QUEUED (guarded updateMany so a finalizer-owned FAILED is never resurrected — F04); `sanitizeError` everything persisted/rethrown. Paid jobs additionally: `chargedError` → terminal, settle/refund in the commit/fail tx, redelivery sentinel on 0-row commit.
6. **Reaper** if the job holds money or user-visible state: add to the 5-min `reap()` loop in `index.ts` (patterns in `gen.ts:reapStaleGenJobs` — cutoffs MUST exceed queue expire; the GENERATING branch must exclude committed-but-unfinalized jobs).
7. **Deploy hygiene:** any new package.json dep → regenerate `pnpm-lock.yaml` or the worker Docker build dies (ERR_PNPM_OUTDATED_LOCKFILE, PR #68); binaries (ffmpeg/whisper) live in the worker Dockerfile.

**Bypass consequences:** `work()` without `createQueue` throws in v12; missing explicit retryDelay = instant-retry storms on transient provider 5xx (real money); expire shorter than the handler = duplicate delivery of ACTIVE paid jobs; skipping the row-before-send order = paid job with no record; raw error rethrow = presigned URLs (with signatures) leaked into pg-boss job.output.

---

## Seam 7 — Design system: `.gb` + shadcn (界面缝)

**Connects:** every new screen ↔ one token vocabulary + one component kit, so the app reads as a single product (and dark mode / future re-skins stay one-file changes).

**Files:** `apps/web/app/globals.css` — the `.gb` block (line ~591: Grok-bright tokens; `.gb.dark` variant; `@theme inline` registers the shadcn color utilities); `apps/web/components/ui/*` — the 14 shadcn primitives with FIKIRTIVE variants (see `button.tsx`: `default`=INK primary CTA, `brand`=CORAL for OTTO/agent-initiated moments only, `soft`, `secondary`, `ghost`, `destructive`); `docs/ui-rework/fk-to-gb-token-map.md` — the token map + conversion rules; design source of truth = claude.ai/design project `0abf8563` ("FIKIRTIVE — Grok-bright"; fonts Geist + JetBrains Mono; typography gold standard = the Analytics screen, aligned in #86).

**Recipe — new UI stays on-system:**
1. Render under a `.gb` root (the otto app root is already `.gb`; `skin="gb"` is hardcoded post-#80 cutover). New standalone pages wrap their root in `className="gb"`.
2. Build from `components/ui/*` + tailwind token utilities (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `rounded-[var(--radius-card)]`) — never raw hex, never legacy Vapor `al-*`/glass classes on light surfaces.
3. **The coral law:** coral `#EC5828` = `--brand` / `bg-brand` / `text-brand`, reserved for OTTO/agent moments. `--accent` in `.gb` is the NEUTRAL `#ECECEA` hover tint. Putting coral on `bg-accent` is the documented silent-inversion bug (fk-to-gb-token-map.md spells it out). INK (`bg-primary`) is the human-action CTA. Semantic colors (`success/warning/error/info` + `-soft` pairs) = state only.
4. Radii: 14px controls / 18px cards / 24px modals (`--radius`, `--radius-card`, `--radius-modal`).
5. New tokens: add to the `.gb` block AND the `@theme inline` registration (both light and `.gb.dark` values) — never inline one-off values.
6. Radix portals render outside `.gb` — components that portal (dropdowns, dialogs) need the `.gb` class carried to the portal container or they lose tokens (`.gb` was put on `<body>` to auto-fix this class of bug in S4; keep it in mind for new portal components).
7. Composer input convention (`apps/web/AGENTS.md`): multi-line message composers submit on Shift+Enter, plain Enter = newline; single-line fields keep Enter=submit.

**Bypass consequences:** hardcoded hex breaks `.gb.dark` and the next re-skin; coral-on-accent inverts the brand language; Vapor classes on light surfaces = dark-on-light unreadable text (the standing `MentionInput` `.pop-menu` debt is the cautionary example); off-kit components fork the design system and every future sweep (#93-style) has to hunt them.

---

## Seam 8 — ChatMessage card kinds: the five-seam contract (卡片五道缝)

**Connects:** a durable ChatMessage row ↔ the live streaming UI ↔ approval/spend hooks. A "card" is how Otto proposes anything ($0) that a human later approves (possibly spending).

**Current kinds** (`ChatMessageKind` PG enum, `schema.prisma:766`): TEXT, PLAN, GEN_CARD, GEN_RESULT, DENIAL, TURN_ERROR, ACTION_CARD, BUILD_CARD, STORYBOARD_CARD.

**The 5 seams a NEW card kind must thread (miss one and the card is invisible or inert):**
1. **Durable write** — add the kind to the `ChatMessageKind` enum (this IS a PG enum → requires a migration, unlike role strings) and persist it from the skill via a card-writer PORT (worked example: `proposeStoryboard` → `STORYBOARD_CARD` with a validated payload; server-minted stable ids inside the payload).
2. **Rehydration** — `apps/web/lib/otto-ui-messages.ts:threadToUiMessages` maps the durable row → UIMessage metadata `{durableId, kind, payload, genJobId}`; add the kind to the union in `apps/web/lib/types.ts`.
3. **Live streaming injection** — `apps/web/lib/otto-stream-bridge.ts:bridgeEvent` `tool_output` allowlist must include your propose tool (it returns `{cardId}` on the shared `data-tool-propose` channel), plus a `TOOL_STEP_LABELS` narration entry. **This allowlist being incomplete is the F23 root cause.**
4. **Inject/dedup helpers** — `apps/web/lib/otto-inject-helpers.ts:injectCardMessage` must accept the kind (dedup by `metadata.durableId`); if the card leads to a paid job, wire `syncCardJobIds` (patches genJobId after approval so polling arms) and note `appendDurableResults` appends GEN_RESULT|TURN_ERROR ONLY.
5. **Render branch** — `components/otto/OttoChatStream.tsx` render pre-pass needs an explicit branch (GEN_CARD→OttoPlanCard, STORYBOARD_CARD→StoryboardCard, …); unknown kinds render as inert placeholder text. (Legacy `OttoConversation.tsx` too if it must work in skin-preview.)

**The proof both ways:** `STORYBOARD_CARD` (#99) threaded all five and works end-to-end; `ACTION_CARD`/`BUILD_CARD` did only seams 1–2 + the legacy renderer → in the live streaming UI they render as dead placeholder text (audit F23, fix in flight — the runbook's shape: add the render branches, generalize the bridge allowlist + inject helpers for `{cardIds[]}`).

**The card→spend law:** cards are $0 to create. Spend happens ONLY when a human clicks approve, and the button calls a PRE-EXISTING gated action (`ottoApprove` → `coworkGenerate` → the generate skill's 7-step gate → `startGen`). A new card kind must NEVER carry its own spend path — the card payload is display+parameters; the server recomputes/validates everything at approval time (anti-flip: `buildGenRequestFromCard` takes ONLY cardId).

---

## Secondary seams (smaller, but decided — don't rediscover them)

- **ModelRegistryOverlay** (`schema.prisma:729`, `packages/core/src/model-registry.ts`, admin `saveModelEnabled`): the emergency kill-switch. Can ONLY narrow the typed catalogs (`isKnownModelId` write-time; `knownDisabledSet` read-time drops garbage). Worker-side read fails OPEN by design (the typed zod gate is the authority); web spend paths check `isModelDisabled` pre-spend, and the Otto generate skill re-checks it so a card built before a disable can't spend.
- **RuntimeConfig** (`schema.prisma:716`): key-PK config with per-key zod on BOTH read and write; DB miss → env fallback. Per-VALUE privilege escalation is the pattern (`saveRuntimeConfig`: `cowork_provider=modal` demands super-admin + env creds). Add a config knob = key + zod + fallback, not a new table.
- **Operator RBAC** (`packages/core/src/roles.ts`): `SECTION_MATRIX` is the single truth (roles × sections, deny-by-default; `roles.test.ts` pins every cell). New admin area = new SECTION + matrix cells + `requireRole(section, action)` on page and every action. RBAC NEVER gates spend (spend = `requireSession`/`requireOwner`).
- **Agency-layer soft refs:** nullable `brandId`/`campaignId`/`batchId` columns (no FK) already sit on Project/Entity/ReferenceImage/Asset/CreditLedger/GenJob/Generation/Memory — the agency/brand layer lands by scoping these, zero future migration. Follow the convention on new models.
- **Strings-not-enums for roles/statuses:** `Membership.role/status`, `User.role` are code-validated strings so new roles need no migration. Contrast: `ChatMessageKind`/`AdsAutonomy` ARE PG enums (migration required) — pick deliberately.
- **Partial-unique indexes are raw SQL:** Prisma can't express them; write hand-authored migrations with `IF NOT EXISTS`, run data repair BEFORE constraint creation, and leave a schema comment (the 10-index inventory + immutable-predicate rules — enum compared to its own labels, no `::text` casts — live in the map §5).
- **Storage:** ONE key scheme `u/<ownerId>/<sha256>.<ext>` for every blob type (`packages/core/src/storage-key.ts`, `packages/storage/src/index.ts`). New media rides the same content-addressed path: client hashes, server names keys, `finalize` re-verifies size, ingest re-verifies hash (D19). Never invent a second key scheme.
- **ActionEvent** audit: append an event for security-relevant transitions (rbac.deny, impersonate.start/stop, credits.purchase.bad, asset.hash_mismatch); audits are best-effort — an audit failure must never flip a deny or prompt a retry-under-new-key.
- **Prompt knowledge:** per-(family×mode) `ModelDirective` rows + the prompt-skills authority rule (#98): families with a prompt skill (`PROMPT_SKILLS` in `packages/otto/src/prompt-skills.ts` — seedream/seedance) use the skill-assembled prompt as SOLE authority; directive fallback only for unskilled families. Adding a family's prompt mastery = a deterministic `<family>Prompt` skill + a `PROMPT_SKILLS` entry, never stacking both.

## The one-page cheat sheet (加什么 → 走哪条缝)

| You're adding… | Seams, in order |
|---|---|
| A new Otto capability (read/lookup) | 1 (port + skill) |
| A new Otto proposal → human approves → paid job | 8 (card) → 1 (propose skill $0 + gated execute) → 3 (reserve/settle) → 6 (job) |
| A new image/video model | 2 (five tables in lockstep) + maybe 3 (flat-price table) + prompt knowledge |
| A new generation backend | 2 (provider + env factory + chargedError contract) |
| Any new paid thing (non-generation too) | 3 (price → refId → reserve-in-tx → key+index → settle/refund) + 6 if async |
| A social/commerce platform | 4 (connection table + OAuth + adapter + registry) → 1 (skills via ports) → 8 if Otto proposes writes |
| A new owner-visible data type | 5 (ownerId + TENANT_MODELS + requireOwner) + 7 for its UI |
| A new admin surface | RBAC matrix + requireRole + FOUNDER_OWNER_ID stamping + audit |
| A new screen | 7 (.gb + shadcn + coral law) |


## Seam 9 — Parity Manifest(第九缝,2026-07-03 入宪)
完整施工配方在 `docs/design/2026-07-03-harmony-02-parity-manifest.md`:每个新 server action / 页面数据读取,出生即在 `packages/otto/src/parity-manifest.ts` 登记(配对 skill、四类封闭豁免之一,或 rollout 期明确 `todoSkill` 债务);CI `scripts/check-parity.sh` 已接入 `pnpm lint:parity`,会硬拦漏登记/僵尸登记/未知 skill/未知豁免。豁免四类:ADMIN / VISUAL / MONEY_IN / ACCOUNT_SECURITY —— 新增类别 = 修宪。
