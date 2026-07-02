# 全库审查地图(2026-07-02 基线)

> 6 个只读 mapper 对 main(含 #99)的测绘原文。配合 [REVIEWER-PLAYBOOK.md](REVIEWER-PLAYBOOK.md) 使用。

# Worker 管线(ingest / render / caption / 队列 / reaper)

FIKIRTIVE worker = one long-lived pg-boss v12 consumer container (Railway), `apps/worker/src/index.ts:main`. Postgres `pgboss` schema is the bus (excluded from Prisma migrations); web is producer-only, worker is consumer + supervisor.

## Boot / wiring — apps/worker/src/index.ts
- Connection: prefers `DATABASE_URL` (direct) over `DATABASE_URL_POOLED` (L39); exits if neither. Web side (`apps/web/lib/queue.ts:getBoss`) prefers POOLED, runs `supervise:false, schedule:false, migrate:false, max:2` — **worker owns pg-boss schema migration + maintenance**; deploy-order rule: worker deploys/migrates first.
- Sentry: init only if `SENTRY_DSN` (L46). `fatal()` handler (L54) on unhandledRejection/uncaughtException: flush→`process.exit(1)` (crash-on-fatal preserved; Railway restarts). `runHandler` (L66) captures UNEXPECTED handler throws to Sentry then rethrows so pg-boss keeps retry bookkeeping; "return-style" terminal FAILEDs never throw → never hit Sentry.
- Queue creation (L81–97): explicit `createQueue` before `work` (v12 requirement). Both web (queue.ts L30–37) and worker create render/refgen/gen/caption + DLQs with the SAME shared `*_QUEUE_POLICY` consts so boot order can't split policy. **ingest + sweep are created ONLY by the worker** — ingest policy is inline in index.ts (retryLimit 3, retryDelay 30, retryBackoff, expireInSeconds 1800, deadLetter `ingest.dlq`), and web still `boss.send(INGEST_QUEUE, …)` from `apps/web/lib/upload-actions.ts:207` and `apps/web/lib/actions.ts:523` (fresh-DB/web-first boot would throw; upload path catches + logs "UNVERIFIED" for a not-yet-built reconciliation sweep).
- `QUEUES.sweep` = "sweep" (queues.ts L8): created at L89, **no `boss.work` consumer, no producer anywhere** — D21 refcount-purge placeholder, dead today.
- All 5 workers run `batchSize:1` (serial per queue). render/refgen/gen/caption use `includeMetadata:true` so `job.retryCount` drives the FAILED-vs-requeue decision inside each handler.
- Heartbeat log every 60s (L154). Graceful shutdown: `boss.stop({graceful:true, timeout:30_000})` with double-signal guard (L185–199).
- **Reap timer** (L159–178): 5-min `setInterval` + once at startup, with `reaping` re-entrancy flag; runs `reapStaleGenJobs()` → `reapStaleRefGenJobs()` → `reapStaleLlmReservations()`, each error captured, loop continues.

## Queue policies (single source: packages/core)
- gen: `packages/core/src/gen.ts:248-264` — GEN_QUEUE="gen", GEN_RETRY_LIMIT=2, retryBackoff+retryDelay 30 (explicit retryDelay is load-bearing: pg-boss default retry_delay=0 makes retryBackoff a silent no-op → instant fal hammering), expireInSeconds 1200 (>longest fal call), DLQ "gen.dlq". Payload `genJobData={genJobId}` (row holds real data).
- refgen: `packages/core/src/refgen.ts:68-84` — identical shape (limit 2, delay 30, backoff, expire 1200, "refgen.dlq").
- render: `packages/core/src/timeline.ts:368-381` — RENDER_RETRY_LIMIT=2, retryDelay 20, backoff, expire 900 (> ffmpeg 10m timeout), "render.dlq".
- caption: `timeline.ts:392-401` — CAPTION_RETRY_LIMIT=2, retryDelay 20, backoff, expire 900 (> whisper 10m), "caption.dlq".
- DLQs are bare createQueue (no consumers) — dead-lettered messages are inspect-only.

## ingest — apps/worker/src/jobs/ingest.ts ($0, security-load-bearing)
Consumes `{assetId}`; produces Asset.durationS/width/height updates. `handleIngest`: missing row → drop; `deletedAt` set → return. **D19 hash re-verification**: key = `storageKey(asset.ownerId, asset.contentHash, ext)`; `sha256Stream(storage.readStream(key))` — a read failure MUST throw (pg-boss retry), only a CONFIRMED mismatch deletes: deleteObject + tx[soft-delete Asset, soft-delete its Generations, ActionEvent "asset.hash_mismatch"] (L72–89). Then `probeFile` (exported ffprobe helper, 60s timeout, reused by render+caption) → metadata write. Idempotent by construction. Money: none. Tenancy: key derived from the DB row's ownerId — no client input.

## render — apps/worker/src/jobs/render.ts ($0 compute, no credits)
Consumes `{renderJobId}` (RenderJob row carries its own editJson snapshot). Produces content-addressed mp4 Asset (source "RENDER") via `storage.put` + `asset.upsert(ownerId_contentHash)`, RenderJob DONE/progress. Flow: DONE short-circuit → **atomic claim** `updateMany(status QUEUED OR (RENDERING AND startedAt < now-STALE_MS))`, STALE_MS=13m sits between ffmpeg timeout (10m) and queue expire (15m) (L367–372) → `fikirtiveEdit.parse(job.editJson)` ("contract police") → plan inputs via `storage.ffmpegInput(srcToStorageKey(clip.asset.src))` (local path or 1h presigned R2 URL) → single ffmpeg filter_complex (xfade/concat chain, EP4 sidechaincompress ducking with music/voice/neutral partition in `buildAudioMix`, EP3 ASS subtitles + drawtext appended after the final vLabel), 10-min execa timeout, progress via `-progress pipe:1` line-buffered, throttled 2s, guarded `updateMany(status:"RENDERING")` so a late write can't undercut DONE/100. Failure: `final = retryCount >= RENDER_RETRY_LIMIT` → FAILED else reset QUEUED; **persisted error and rethrown error are both `sanitizeError`d** (redact.ts — execa message = full argv containing presigned `-i` URL + X-Amz signature; pg-boss serializes the thrown error into job.output, so raw rethrow would re-leak). Output capped at 720p (1080 downmapped, L404 — OOM guard). Money: none, re-render is free. Tenancy: **clip srcs come from client-authored editJson**; `startRender` (apps/web/lib/actions.ts:769) only contract-parses — no `keyOwnerMatches` per clip. Guessing another owner's sha256 is infeasible, but the worker itself will presign ANY well-formed `u/<owner>/<hash>.<ext>` key.

## caption — apps/worker/src/jobs/caption.ts ($0 — whisper.cpp, NEVER fal)
Consumes `{captionJobId}`; produces content-hash-keyed `Transcript` cache rows (`@@unique([contentHash, model])`, model "base.en") + CaptionJob status. Copies render's claim machinery exactly (STALE_MS 13m; CaptionJob reuses the RENDERING status name). Cache short-circuit before claim; audio gate caches an EMPTY transcript (upsert) so silent clips are DONE forever. Bounded: ffmpeg extract 60s timeout + `-t maxS`; whisper-cli 10m timeout + `-d` cap + thread cap (env WHISPER_THREADS≤8, WHISPER_MAX_SECONDS default 600). Cues policed per-entry through `captionCue.safeParse`, capped at MAX_CAPTIONS. Same sanitizeError persistence + sanitized rethrow. Money: none (deliberately NO spent/committed markers — re-run is free). Tenancy: producer `startCaption`/`ownedAssetFromSrc` (apps/web/lib/actions.ts:846-857) enforces `keyOwnerMatches` + owned Asset; **Transcript cache is GLOBAL cross-org by contentHash** — read path `getTranscript` is owner-gated, documented P3 decision (a per-org filter without changing the unique would break a second org's write).

## gen / refgen wiring bits beyond the handlers
- Reapers (both invoked from index.ts timer): `gen.ts:reapStaleGenJobs` (L204) — GENERATING older than GEN_REAP_MS=25m **AND `generationIds isEmpty`** (excludes committed-but-not-yet-DONE jobs; without it the reaper posts a false "you weren't charged" TURN_ERROR that wins the single-message unique index and swallows the real GEN_RESULT) → conditional FAIL + `refundReservation` + TURN_ERROR chat message; QUEUED older than GEN_QUEUED_REAP_MS=25m → first `hasLiveGenMessage()` (F07: raw SQL against `pgboss.job` state IN created/retry/active matched on `data->>'genJobId'`; **fails SAFE — returns true on query error, skipping the reap**) then FAIL+refund. Both cutoffs MUST exceed queue expire (20m).
- `refgen.ts:reapStaleRefGenJobs` (L78): same two branches (REFGEN_REAP_MS=REFGEN_QUEUED_REAP_MS=25m, GENERATING branch requires `outputAssetIds isEmpty`), no chat message, **and NO hasLiveGenMessage liveness check on the QUEUED branch** (the F07 fix is gen-only — refgen can still spuriously refund a starvation-delayed queued job).
- On-claim stale windows inside handlers: GEN_STALE_MS / REFGEN_STALE_MS = 18m (< expire 20m; a redelivery implies expiry passed).
- `llm-reservation-reaper.ts:reapStaleLlmReservations`: sweeps CreditLedger RESERVE rows >60m old whose refId matches LLM prefixes (`otto-turn:`, `otto-stream:`, `otto-approve:`, `otto-verdict:`, `brand-research:`, `draft:`, `enhance:`) with no SETTLE/REFUND finalizer → `refundReservation` per row. **The prefix allowlist is the wall keeping this reaper OFF the generation spend path** (Gen/RefGen use bare ULID refIds). Idempotency vs a racing settle = partial unique `CreditLedger_finalizer_once` ON (orgId,refId) WHERE kind IN ('SETTLE','REFUND') (migration 20260619130000_credits:57).
- `appendCoworkResult` idempotency = partial unique `ChatMessage_genjob_result_uniq` ON ChatMessage(genJobId) WHERE genJobId NOT NULL AND kind IN ('GEN_RESULT','TURN_ERROR') (migration 20260615151750; P2002 swallowed in the writer).
- gen handler money skeleton (for wiring context): `spent` flips at provider return; commit = one tx writing generationIds+spent+spentUsd via **conditional `updateMany(status:"GENERATING")`** + `settleCredits`; 0 rows matched → throw sentinel `REDELIVERY_DISCARD` to ROLL BACK the just-created user-visible Asset/Generation rows (a plain return would commit a free delivery); store+commit retried in-process ×4 (provider never re-called). `final = !committed && (spent || err.charged===true || retryCount>=GEN_RETRY_LIMIT)`; recoverable requeue is a GUARDED updateMany(status in QUEUED/GENERATING) so a finalizer-owned FAILED is never resurrected (F04). All caught errors persisted AND rethrown sanitized.

## otto-resume — apps/worker/src/otto-resume.ts:resumeOttoAfterGen
Called from gen.ts on BOTH success paths (resume L309 + fresh L634), best-effort (never throws into handleGen). Consumes the finished GenJob's thread; produces one AGENT ChatMessage (verdict) + CAS'd ChatThread.ottoState. Gates in order: threadId null → skip; thread owned+live+has ottoState; **at-most-once claim = `genJob.updateMany({id, ottoVerdictAt: null} → set ottoVerdictAt)` BEFORE the LLM call**; `tryRestoreRunState` unrestorable → skip (F24). Money: the verdict turn IS metered via `withLlmBudget` (refId `otto-verdict:<genJobId>`, OTTO_DEFAULT_MODEL, paid:true; refunds on throw; MaxTurnsExceeded settles partial usage via usageOnError) but **can NEVER spend on generation: `startGen` is intentionally NOT injected into OttoContext** — an Otto `generate` call parks as a needsApproval interruption whose paused state is persisted for web-side approval. State writes are CAS on `ottoState === priorOttoState` (loses to any concurrent web turn, skips silently). sanitizeHistory strips accumulated images before re-run (F25). Tests: otto-resume.test.ts (473 lines) pin claim/CAS/no-startGen.

## Shared seams
- storage: `apps/worker/src/storage.ts` → `createStorage(LOCAL_ROOT)` from packages/storage/src/index.ts. Driver by env `STORAGE_DRIVER=r2` (needs R2_ENDPOINT/KEYS/BUCKET, throws loudly if partial — no silent local fallback) else LocalDiskStorage. One key scheme `u/<ownerId>/<sha256>.<ext>`; `parseStorageKey` on every method = path-traversal guard. Worker-relevant: `put` (content-addressed, dedup), `readStream` (ingest hash check), `ffmpegInput` (local path OR 1h presigned GET — "never log argv containing this URL"), `presignedGet` (gen conditioning refs, 1h), `deleteObject` (idempotent). R2 `exists/sizeOf` only treat 404/NotFound as absent — auth/network errors surface.
- generation provider: `apps/worker/src/generation.ts` → `createGenerationProvider()`: mock by default ($0), fal only when `GENERATION_PROVIDER=fal`+`FAL_KEY`. gen.ts branches on `provider.name === "mock"` to relax unreachable-ref refusals.
- model-registry: `apps/worker/src/model-registry.ts:workerDisabledModels` — reads ModelRegistryOverlay (ownerId FOUNDER_OWNER_ID, enabled:false); **returns EMPTY set on any DB fault** (fail-open by design: the typed superRefine that admitted the queued job is the authority; this check only catches jobs queued before an emergency disable). gen.ts L319 fail-closes+refunds a disabled-model job pre-spend.
- redact: `apps/worker/src/redact.ts` — `scrubUrls` (regex all http(s) URLs) for logs, `sanitizeError` (execa errors collapse to exit-code summary; else scrub+cap 300) for anything PERSISTED to a job `error` column or rethrown into pg-boss job.output.
- Dockerfile: node:22-trixie-slim + apt ffmpeg 7.x (xfade/sidechaincompress availability is asserted in code comments against THIS build) + fonts-dejavu-core (render's DRAWTEXT_FONT hard-codes the DejaVu path) + whisper.cpp v1.7.4 built with `-DGGML_NATIVE=OFF` (portable SIMD — removing it SIGILLs on narrower runtime hosts) + baked base.en model. Any new package.json dep needs pnpm-lock regen or the Docker build dies with ERR_PNPM_OUTDATED_LOCKFILE (PR #68 lesson; only worker breaks, web doesn't COPY packages/generation).
- Tests (vitest, `apps/worker`): gen-reaper.test.ts, gen-requeue.test.ts (F04 guarded requeue), refgen-reaper.test.ts, llm-reservation-reaper.test.ts, otto-resume.test.ts.

---

# Admin / Auth(Better Auth、allowlist、operator 后台、冒充)

## 1. Better Auth core (apps/web/lib/better-auth/)

**server.ts:auth** — `betterAuth()` singleton. basePath `/api/better-auth`, prismaAdapter, BA models mapped to `ba_*` tables (BetterAuthUser/Session/Account/Verification). Key config, all load-bearing:
- `emailAndPassword.requireEmailVerification: true` — marked NON-REMOVABLE: unverified signup would mint a session → account takeover via convergeIdentity.
- `account.accountLinking`: trustedProviders `["google"]` + `requireLocalEmailVerified: true` (anti-takeover on OAuth linking).
- Allowlist enforcement is **three-layered**: `hooks.before` (path-scoped `/sign-in|/sign-up` body email → `assertAllowedEmail`), `databaseHooks.user.create.before` (Gate 1: no ba_user row for non-allowlisted, all methods incl. OAuth callback), `databaseHooks.session.create.before` (Gate 2: `assertAllowedForUserId` — covers repeat sign-ins + revocation).
- `databaseHooks.*.after` → `converge.ts:convergeIdentity`.
- Plugins in order: `magicLink` (15 min expiry, `assertAllowedEmail` before send), `customSession` (adds `role` via `roleForEmail`), `admin({ac, roles:{"super-admin":superAdminRole}, adminRoles:["super-admin"], impersonationSessionDuration: 1800})`, `nextCookies()` **MUST be last**.
- BETTER_AUTH_SECRET guard is a console.error only (build-safe, BA fails closed itself). `trustedOrigins` pinned to BETTER_AUTH_URL origin.

**gate.ts** — `assertAllowedEmail` (throws APIError FORBIDDEN; null/undefined email throws = fail-closed), `assertAllowedForUserId` (ba_user id → email → assert).

**compat.ts** — `auth()`: NextAuth-shaped drop-in `{user:{email,name,image,role}}`; **role is recomputed per-request via `roleForEmail(email)`** (fresh DB read, NOT the customSession-cached role — role changes take effect immediately). `isImpersonating()`: reads raw BA session `.session.impersonatedBy`.

**session-role.ts:roleForEmail** — canonical `User.role` by lowercased email; missing/garbage/DB-error → `"viewer"`, never throws.

**converge.ts:convergeIdentity** — sign-in convergence, best-effort/never-throws. Refuses unless `emailVerified` (founder-promote on unverified identity = takeover). Creates canonical `User` row; if `isFounderAdmin(email)`: promotes `User.role`→"super-admin", **mirrors to `ba_user.role`** (the admin plugin's hasPermission reads the raw column), upserts founder-org Membership. Non-founder: dynamic-imports `bootstrapPersonalOrg`. Audits `auth.signin` (ownerId "founder").

**access.ts** — `ac` statement space = admin plugin 1.6.20 defaults (`user: create/list/set-role/ban/impersonate/impersonate-admins/delete/set-password/set-email/get/update`, `session: list/revoke/delete`); `superAdminRole` grants all. **The admin plugin mounts client-callable HTTP endpoints under /api/better-auth gated ONLY by `ba_user.role` against this** — see fragile list.

**sender.ts:sendAuthEmail** — in-memory rate limit 5/email/hour (per-instance, resets on deploy); prod hard-requires RESEND_API_KEY; dev writes `.data/last-magic-link.txt`.

**client.ts:authClient** — magicLinkClient only (no adminClient; impersonation is server-action-only). **route.ts** (`app/api/better-auth/[...all]`) — `toNextJsHandler(auth)`.

## 2. Allowlist (lib/allowlist.ts)

- `isAllowedEmail`: FOUNDER_ADMIN_EMAILS ∪ AUTH_ALLOWED_EMAILS (env, checked FIRST — DB can never lock the founder out) ∪ `AllowedEmail` table (`status !== "revoked"`); DB outage → false (fail closed). All comparisons lowercased.
- `allowed()`: **async** thin alias — a bare `!allowed(email)` is always falsy (Promise); every call site must await.
- `isFounderAdmin`: FOUNDER_ADMIN_EMAILS only (distinct list; sync).
- `AllowedEmail` model (schema.prisma:610): email PK lowercased, status invited|active|revoked.

## 3. Guards (lib/auth-guard.ts)

- `requireSession()` — auth() + allowed(). **The gate for spend actions** (operator-RBAC never gates spend).
- `requireRole(section, action)` — allowlist outer wall (never reads role) → `roleAllows` matrix; deny writes best-effort `rbac.deny` ActionEvent (audit failure never flips deny). Returns `{email, role}`.
- `requireOwner()` — THE fail-closed session→ownerId resolver, used by every tenant-data and spend site. Contract: off-allowlist → error; `isFounderAdmin(email)` → `FOUNDER_OWNER_ID` ("founder", storage-key.ts:10) — **the ONLY path that may ever return "founder"**; else first non-founder Membership (suspended/revoked denied even if soft-deleted); none → synchronous `bootstrapPersonalOrg`; bootstrap failure → error, NEVER a default.
- `bootstrapPersonalOrg(userId, email)` — deterministic `org_<userId>` (concurrency convergence + charset-safe for storageKey); tx: org upsert + Membership(owner) upsert + revive-if-not-suspended + `User.activeOrgId` + `grantCreditsTx` beta grant idempotent on `signup:<orgId>` (atomic — grant failure rolls back the whole org). P2002 race → re-read membership, else null.

## 4. Operator RBAC matrix (packages/core/src/roles.ts)

`ROLES` = super-admin/ops/finance/moderator/viewer (sibling roles, NOT a ladder). `SECTIONS` = model/cost/content/team/system/knowledge/credits/tenants. `SECTION_MATRIX` is the single source of truth; `roleAllows` = deny-by-default, super-admin supersedes every cell. Pins: team + tenants = super-admin-only (empty sets); cost = read-only (finance); credits mutate = finance; viewer reads model/system/knowledge only. `User.role` default "viewer" (plain string column, zod-validated). The provider=modal exception is per-VALUE in saveRuntimeConfig, not in the matrix.

## 5. Operator console

**app/admin/layout.tsx** — auth()+allowed → /login; then **`isFounderAdmin` else redirect "/"** (closed-beta: without this, any beta merchant [default viewer] could read /admin/system|models|knowledge via the matrix). Convenience wall; every action re-asserts.

**Pages** — each does `requireRole(section,"read")`: settings+models→model, directives+knowledge→knowledge, cost→cost, credits→credits, content+audit+conversations(+[threadId])→content, team→team, system→system, tenants(+[orgId])→tenants.

**lib/admin-actions.ts** (all write platform config stamped ownerId=FOUNDER_OWNER_ID, audited transactionally):
- `saveModelDirective` / `seedResearchDirectives` — requireRole("knowledge","mutate"); seed refresh only where `source:"research" AND revisions:{none:{}}` (atomic in WHERE — never clobbers founder edits).
- `saveRuntimeConfig` — requireRole("model","mutate"); **per-VALUE escalation**: `cowork_provider=modal` additionally requires `gate.role==="super-admin"` + MODAL env creds; `=fal` requires FAL_KEY.
- `saveModelEnabled` — requireRole("model","mutate"); `isKnownModelId` write-time validation.
- `saveUserRole` — requireRole("team","mutate") (=super-admin); zod roleSchema; **self-change forbidden** (no self-demote/self-grant); tx writes `User.role` AND mirrors `ba_user.role` by lowercased email + `rbac.role.set` audit.

**lib/credit-actions.ts:grantCreditsAction** — requireRole("credits","mutate") (finance/super-admin). orgId defaults FOUNDER_OWNER_ID (P2 form), ≤64 chars, **no org-existence check** (FK on CreditAccount.orgId is the backstop; contrast grantTenantCredits). displayedAmount: non-zero int, |x|≤1,000,000, ×INTERNAL_PER_DISPLAY. Client idempotencyKey 8–100 chars → `grantCredits` (source ADMIN). Negative ADJUST → InsufficientCredits mapped to error. Audit is best-effort AFTER commit (an audit error must not prompt a retry under a new key = double grant).

**lib/tenant-actions.ts** (all requireRole("tenants","mutate") = super-admin-only, all reject `orgId === FOUNDER_OWNER_ID`):
- `orgMemberBaUserIds` / `ownerBaUserId` — the **email join across the two user-id spaces** (Membership.userId → User.email → lowercase → BetterAuthUser.id). BA ban/session ops take BA ids, never User.id.
- `setMembershipStatus(orgId, status ∈ {active,suspended})` — one tx: `Membership.updateMany({where:{orgId}})` + on suspend: `betterAuthUser` banned=true + `betterAuthSession.deleteMany` (immediate global cut; the admin plugin's session.create.before ban hook blocks re-login); on active: unban. Membership.status stays the authoritative per-tenant gate (requireOwner consumes it); the BA mirror is defense-in-depth. Dual audit (founder + org ownerId).
- `cutTenantSessions` — deletes members' ba_session rows; audited.
- `inviteTenant` / `revokeTenantInvite` — AllowedEmail upsert(status invited) / updateMany(status revoked); `normEmail` regex+254-cap+lowercase.
- `impersonateTenant(orgId)` — **double gate**: requireRole + `isFounderAdmin(gate.email)`; resolves org's first owner to BA id; `auth.api.impersonateUser({body:{userId}, headers})`; audit `impersonate.start`. 30-min session (server.ts).
- `stopImpersonatingTenant` — gate is `isImpersonating()` itself, deliberately NOT requireRole (F15: the active session IS the viewer-role customer; BA's stopImpersonating only reverts a session carrying impersonatedBy — that IS the authorization). Audit `impersonate.stop`.
- `grantTenantCredits` — same validation shape as grantCreditsAction but **verifies org exists + deletedAt:null and forbids founder** ("NEVER fall back to founder"); dual audit.

**lib/tenant-admin.ts** (`listTenants`, `getTenantDetail`) and **lib/conversation-admin.ts** — read-only cross-tenant aggregation, gated at pages (tenants-read / content-read). conversation-admin: findMany always pinned to a known owner set; NEVER emits storage URLs (only safe metadata).

## 6. Tenant-facing actions in this surface

- **lib/owner-settings-actions.ts** — `getOwnerSettings`/`setOwnerSetting`: requireOwner-scoped to `gate.ownerId`; set blocked by `isImpersonating()` (F15: impersonation is for seeing, not acting); key must exist in DEFAULT_SETTINGS + typeof match.
- **lib/billing-actions.ts** — `listCreditPacks` (ungated read of active Stripe Prices with metadata.credits, limit 100); `createTopupCheckout(priceId)`: requireOwner; **orgId into client_reference_id + metadata comes from gate.ownerId, never client input**; price re-fetched server-side and validated (active, integer credits>0).
- **app/api/stripe/webhook/route.ts** — unauthenticated by design (signature = auth via `stripe.webhooks.constructEvent` + STRIPE_WEBHOOK_SECRET); grants on `checkout.session.completed` AND `async_payment_succeeded` when `payment_status==="paid"`; **idempotencyKey `stripe:<session.id>`** (session-scoped, not event-scoped — exactly-once across both event types); bad metadata → 200 + `credits.purchase.bad` audit (no retry storm). Trusts metadata.orgId because createTopupCheckout wrote it server-side.
- **app/files/[...key]/route.ts** — auth()+allowed → 302 /login; requireOwner; `keyOwnerMatches(joined, owner.ownerId)` (packages/core/src/storage-key.ts) else 404. Presigned GET 1h TTL with private,no-store + no-referrer.

## 7. Proxy wall (apps/web/proxy.ts)

Next 16 proxy (middleware successor). Enabled = prod: `AUTH_ENABLED !== "false"` (**fail-closed** — forgetting the flag walls the app); dev: `=== "true"` (opt-in). No session → redirect `/login?from=<path+query>`; LoginForm passes `from` through `sanitizeCallbackURL` (lib/safe-redirect.ts — rejects `//`, `/\` protocol-relative smuggling). Matcher MUST keep excluding: `login`, `skin-preview` (dev-only), `api/better-auth` (else sign-in lockout loop), `api/stripe` (webhook), Next statics. The wall is convenience; R7 = every handler re-asserts.

## 8. Impersonation spend/mutation blocks

`isImpersonating()` blocks at web entry points: gen-actions.ts:32, refgen-actions.ts:30/281/351, otto-actions.ts:341/547, cowork-actions.ts:82/160, brand-research.ts:42, api/otto/stream/route.ts:82, meta-write-actions.ts:14/406, meta-build-actions.ts:392, owner-settings-actions.ts:27. Banner: app/layout.tsx:25 → components/admin/ImpersonationBanner.tsx (calls stopImpersonatingTenant).

## 9. Isolation backstop (packages/db/src/tenant-guard.ts)

`withTenantGuard` Prisma extension: `findMany/findFirst/updateMany/deleteMany` on TENANT_MODELS (Project, Entity, EntityVariant, ReferenceImage, Asset, Shot, ShotEntityRef, Generation, RenderJob, GenJob, RefGenJob, ChatThread, ChatMessage, CaptionJob, Transcript, Memory, GenerationBatch) must carry a **defined** ownerId (top-level or in AND). Warns in prod (never 500s a live request), THROWS under NODE_ENV=test. Documented blind spots: raw SQL, nested writes, findUnique, aggregate/groupBy/count (exempt on purpose — admin platform reads use them).

## 10. Tests anchoring this surface (apps/web/lib/__tests__/)

require-owner.test.ts, tenant-actions.test.ts (573 lines), tenant-guard.test.ts, tenant-admin.test.ts, better-auth-{server,gate,access,compat,converge,route,sender,session-role,client}.test.ts, allowlist.test.ts, owner-settings.test.ts, conversation-admin.test.ts; packages/core/src/roles.test.ts locks the matrix cell-by-cell.

---

# Web 界面(路由、Otto 数据流、卡片五道缝)

All paths under apps/web/. Worktree = main@46e5dbe; main is 5 ahead (#97 ref-video, #99 storyboard, #102/#104) — post-#99 files below read via `git show origin/main:`.

## 1. Routes (app/)
- `page.tsx` → redirect("/otto"). `library/page.tsx` and `m/page.tsx` also redirect /otto (retired surfaces).
- `otto/page.tsx` (force-dynamic) — THE product surface. `requireOwner()` gate; VALID_VIEWS = ["otto","stuff","library","templates","discover","memory","account","connections","schedule","analytics"]; validates ?view/?project (must be owned, else oldest)/?thread (must be in project, else most recent). `skin="gb"` hardcoded (cutover), `ottoStreamEnabled=true` HARDCODED (line 70, 2026-07-01 rollout). Parallel loads: getEntities, getCoworkThreads, getMyAccount, listMemory, getMyAds, getMyAdJobs, getRecentGenerationThumbs, getAllCoworkThreadMetas → props into OttoApp (keyed by projectId). balanceCredits = DISPLAYED credits (nav shows credits, never $).
- `billing/page.tsx` — getMyAccount + listCreditPacks → components/billing/BuyPackButton (Stripe checkout; LIVE on prod). ?status=success|cancel banners.
- `login/page.tsx` — Better Auth magic-link.
- `admin/*` (14 pages) — `admin/layout.tsx` gates: allowed() email allowlist + `isFounderAdmin` (founder-only, redirect "/"); actions independently re-assert requireAdmin.
- `skin-preview/{,account,admin,nodes,trace}` — dev harness, `notFound()` when NODE_ENV==="production"; the ONLY caller passing ottoStreamEnabled=false (keeps OttoConversation alive). `kitchensink/` — throwaway shadcn proof.
- API: `api/better-auth/[...all]` (BA handler); `api/otto/stream` (POST, streaming turn — see §4); `api/meta/authorize` + `api/meta/callback` (OAuth; authorize errors redirect `/otto?view=connections&error=…`); `api/stripe/webhook` (signature = auth; grants on checkout.session.completed AND async_payment_succeeded (F01); idempotencyKey `stripe:<session.id>`; grantCredits-only); `files/[...key]` (GET media: allowlist + requireOwner + `keyOwnerMatches` cross-tenant guard, R2 presignedGet 3600s (F41) 302 no-store, else local bytes with Range/206).
- `proxy.ts` auth wall: prod fail-closed (ON unless AUTH_ENABLED==="false"), dev opt-in; excludes /login, api/better-auth, api/stripe, statics; preserves query in ?from= (F42).

## 2. Shell: OttoApp → OttoNav + OttoView
- `components/otto/OttoApp.tsx:OttoApp` — client state: view (OttoViewKey, 10 keys), threads, activeThreadId, balanceCredits (refreshBalance→getMyAccount), navCollapsed/chatCollapsed, seedText (Discover→composer). 4s interval `listProjectThreadActivity(projectId)` (lib/thread-activity.ts: pending = in-flight GenJob QUEUED/GENERATING or pending CanvasNode, owner+project scoped) → activity Set; only polls while view==="otto". Project CRUD: createProject/renameProject/deleteProject/autoTitleProjectIfDefault (auto-title effect, name-write only). handleDeleteThread = optimistic removal + rollback on error (deleteCoworkThread, nextActiveThreadId from lib/thread-list).
- `OttoNav.tsx` NAV_ITEMS (line 106): otto→"Canvas", stuff→"My Stuff", memory→"Brand memory", schedule, analytics, account. Below: campaigns/threads tree (cross-project via router push `/otto?project=&thread=`; same-project via state), History thumbs, balance chip (display-only, no link), user row. NOT in nav: library / templates / discover / connections — reachable ONLY via ?view= deep link (connections also via meta-authorize error redirect and Account settings section links).
- `OttoView.tsx` dispatch: memory→OttoMemory; schedule/analytics→ComingSoon placeholder (both DORMANT); stuff→OttoStuff (tabs "cast"|"ads": entities + ads/adJobs); library→OttoLibrary (getGenerationHistory + DetailPanel); account→OttoAccount (client-fetch getAccountViewData → settings/sections.tsx buildSettingsSections — includes Connections + "OTTO behavior" adsAutonomy toggle); templates→OttoTemplates (TEMPLATES → TemplateModal → **startGen = real spend**); discover→OttoDiscover (INSPIRATIONS; onUseInOtto seeds composer + view→otto); connections→OttoConnections (getMetaConnection/disconnectMeta/setAdsAutonomy/setAdsWritesPaused, optimistic w/ rollback).
- view==="otto": split pane. Left = OttoFrontDoor (when !activeThread) else OttoChatStream (ottoStreamEnabled, keyed `key={activeThread.id}`) else OttoConversation (dead for users). Right = FlowCanvas (always mounted; gets activeThreadId + activity + skin). ConvoTabs only when skin!=="gb" (i.e. never in prod).

## 3. Streaming chat spine (client)
- `OttoFrontDoor.tsx` — GOAL_TILES goalKeys: sell-product|announce-sale|get-followers|make-video. start(): streaming path = createEmptyCoworkThread → onStreamStart(thread,{text,goalKey?,entityIds?}) → OttoView.setPendingFirst (keyed to threadId) → OttoChatStream mount-effect auto-sends ONCE (pendingSentRef + onPendingFirstSent clears parent). Fallback classic ottoTurn path still coded.
- `OttoChatStream.tsx` (main, post-#99) — useChat<OttoUiMessage> with one-time `useState(chatInit)`: DefaultChatTransport api="/api/otto/stream"; prepareSendMessagesRequest REPLACES the body wholesale (route schema coworkTurnRequest is .strict()): {projectId, threadId, text=latestUserText(messages), simple:true, goalKey?, entityIds?, referenceVideoGenerationId? XOR sourceGenerationId? (refVideo wins)}. Seed = threadToUiMessages(thread).
  - onData: `data-step`→stepEvents (OttoTrace via deriveTraceSteps, otto-status-helpers); `data-status`→liveStatus (+needs_approval→pendingApprovalCardIds set); `data-error`→streamError/streamErrorKind ("insufficient_credits" renders /billing "Top up" link); `data-tool-propose`→proposeCardId→getCoworkThreadClient→injectCardMessage.
  - onFinish: refetch thread → onThreadUpdate + onBalanceRefresh.
  - Bounded result poll: POLL_MS=2500, MAX_POLLS=48 (~2min); armed by hasWorkingJob; pollGaveUp→"Check again" (one re-arm via checkAgainUsedRef)→pollTerminal. Reset sites: submit(), onApproved (card + pack), onRetry, thread-switch effect (prevThreadIdRef). pollAndInjectResults = appendDurableResults(syncCardJobIds(cur,fresh),fresh) + balance refresh when new terminal lands.
  - Render pre-pass: CONSECUTIVE GEN_CARDs sharing payload.packId coalesce → PackCard group. Branches: GEN_CARD→OttoPlanCard, GEN_RESULT→OttoResult (sourceCardId via cardIdByJobId map), DENIAL|TURN_ERROR→error bubble (durable text), STORYBOARD_CARD→StoryboardCard, PLAN→null, else text/reasoning parts (TextPart/ReasoningPart). **NO ACTION_CARD/BUILD_CARD branch — they render as inert placeholder text (F23, in-flight).**
  - Composer: Shift+Enter submits, Enter=newline (AGENTS.md convention); @mention dropdown intercepts Enter/Tab/Esc/arrows (otto-mentions.ts). Attach: image → uploadFilesDirect + finalizeCandidateUploads → sourceGenerationId; video → frame picker (F28 frameReady gate; webm Infinity-duration force-seek fix) → frame-as-image, or "Use whole video" (isRefVideoDurationOk, REF_VIDEO_MIN/MAX_SECONDS from lib/video-frame.ts) → referenceVideoGenerationId.
- `OttoConversation.tsx` — legacy durable-thread renderer (ottoTurn server action, no streaming). ONLY renderer of OttoActionPlanCard (ACTION_CARD) + OttoAdBuildCard (BUILD_CARD); also has STORYBOARD_CARD branch post-#99. Dead for normal users.

## 4. Streaming route + pure mappers
- `app/api/otto/stream/route.ts:POST` — mirrors ottoTurn: requireOwner (identity never from input), impersonation 403, coworkTurnRequest.safeParse, pre-stream validation (owned project; validateOwnedGenerationExt for sourceGenerationId IMAGE_EXTS / referenceVideoGenerationId VIDEO_EXTS; owned+in-project thread; replyToMessageId scoped) — returns JSON errors BEFORE the SSE opens. Persists USER msg (thread create first, FK order), seq = read-max+1. Reserve refId = `otto-stream:${userMessageId}` (F27 — NOT threadId:seq). withLlmBudget wraps run(otto,…,{stream:true}); drains events writing stepEventOf → data-step and bridgeEvent parts (lazy text-start/reasoning-start framing, ids OTTO_TEXT_ID/OTTO_REASONING_ID); awaits r.completed then returns usage for settle. InsufficientCredits → data-error, persist NOTHING; MaxTurnsExceededError → persist degrade TEXT + data-status degraded; other → data-error (refunded). Then `finalizeOttoRun` (lib/otto-actions.ts, shared with ottoTurn; CAS = `chatThread.updateMany({where:{id, ownerId, ottoState: priorOttoState}})`) → data-status stale | needs_approval{pendingCardIds} | done{threadId}.
- `lib/otto-stream-bridge.ts` — PURE. bridgeEvent: output_text_delta→text-delta; tool_called → data-status "planning" ONLY for `propose`|`proposeStoryboard`; tool_output → data-tool-propose ONLY for `propose`|`proposeStoryboard` (proposePack / propose-meta-action / propose-ad-build DROPPED — F23 root cause); reasoning_item_created→reasoning-delta. stepEventOf + TOOL_STEP_LABELS (exact skill tool names incl. seedreamPrompt/seedancePrompt/proposePack/meta-*) → data-step narration, paired by rawItem.callId. Exported payload types OttoStatusData/OttoErrorData/OttoStepData.
- `lib/otto-inject-helpers.ts` — PURE. resultJobIds/errorJobIds; deriveCardState precedence failed>done>working(genJobId||submitted)>idle; hasWorkingJob (GEN_CARD w/ genJobId lacking terminal GEN_RESULT/TURN_ERROR); proposeCardId; injectCardMessage (accepts kind GEN_CARD | STORYBOARD_CARD post-#99, dedup by metadata.durableId, same-ref if unchanged); syncCardJobIds (patches in-memory GEN_CARD genJobId after "Make it" — without it the poll never arms); appendDurableResults (**GEN_RESULT|TURN_ERROR ONLY — never TEXT/GEN_CARD/DENIAL**, dedup durableId); deriveActionState (ACTION_CARD exec rows: pending/executing/done/partial/failed).
- `lib/otto-ui-messages.ts` — threadToUiMessages: durable msg → UIMessage; TEXT verbatim; non-TEXT → placeholderTextFor stub + metadata {durableId, kind, payload, genJobId}; kinds (lib/types.ts:68, main): TEXT|PLAN|GEN_CARD|GEN_RESULT|DENIAL|TURN_ERROR|ACTION_CARD|BUILD_CARD|STORYBOARD_CARD.

## 5. Cards → spend hooks (client calls only pre-existing gated actions)
- `OttoPlanCard.tsx`: pendingApproval → `ottoApprove({threadId,cardId})` (resume parked run) ELSE `coworkGenerate({cardId,…})`; retry → `coworkVaryCard`; cancel → `cancelGenJob`. onApproved: submittedCardIds add + pendingApproval delete + poll re-arm + balance refresh.
- `PackCard.tsx` + `pack-credit-math.ts`: two-step confirm "Make all N for ~X? This will spend real credits." packTotalCredits = Σ(estimatedCredits ?? max(1,ceil(estimatedPriceUsd/0.1))); canAffordPack floors via Math.round(usd*100)/10 (IEEE-754 guard). Sequential per-card ottoApprove/coworkGenerate — deliberately NO new server action.
- `OttoResult.tsx`: media grid + "Make another" → coworkVaryCard(sourceCardId); costCredits display via creditsLabel.
- `StoryboardCard.tsx` (main only, #99): $0 per-shot editing — parseStoryboardCardPayload/MAX_STORYBOARD_SHOTS (lib/storyboard-card.ts); actions editShotPrompt/addShot/deleteShot/reorderShots (lib/storyboard-actions.ts); any success restamps indices and force-closes the open edit form (index-shift mis-save guard).
- `OttoActionPlanCard.tsx` / `OttoAdBuildCard.tsx`: Meta write v1/v2 approve UIs — only mounted by OttoConversation ⇒ unreachable in prod chat (F23).

## 6. Canvas
- `components/canvas/FlowCanvas.tsx`: skin==="gb" ⇒ nodes via `syncOttoCanvasNodes(projectId, activeThreadId)` (lib/otto-canvas-bridge.ts — display-only chat→canvas bridge: one node per GEN_RESULT generation, idempotent, pure planner planBridgeNodes in otto-canvas-bridge-core.ts; resolves job-only nodes' generationId) else listCanvasNodes. Reload nudged by activity Set. Confirm dialogs: generate confirm, make-video (motion presets) confirm, paid-aware delete confirm via `isInFlightPaidGen` (pending/timeout + no url = reserved, delete ≠ refund).
- `components/canvas/useCanvasGen.ts`: IMAGE_VARIANT_COUNT=4 (count is priced/capped MAX_GEN_COUNT); generateImage/animate/generateVideoFromText all: `getActiveGenModels()` server action cached in modelsRef (F18 — never client activeVideoModel()), startGen with per-click idempotencyKey, `createNodeWithRetry` (3 attempts — a paid job must not lose its card; exhaustion message points at library), `fail()` surfaces every kickoff error (F19/F20). poll: 192×2.5s ≈ 8min; give-up → status "timeout" (≠ failed; worker settles regardless).
- `components/asset/DetailPanel.tsx`: library/canvas detail incl. paid animate. `components/MentionInput.tsx`: canvas prompt bar (Cmd/Ctrl+Enter back-compat; known pre-existing `.pop-menu` debt).

## 7. LIVE vs dormant
LIVE: streaming Otto chat (sole surface), canvas image(4-var)/video gen with confirms, storyboard cards ($0), Stripe packs (/billing + webhook, live keys), Meta READ (connections/insights).
DORMANT: Meta WRITE v1 ACTION_CARD (needs ads_management reconnect) + v2 BUILD_CARD (needs pages_show_list) — doubly dead: also unrenderable in streaming UI (F23); schedule/analytics = ComingSoon; library/templates/discover = deep-link-only (not in nav); OttoConversation (skin-preview only); /m, /library redirects; skin-preview/kitchensink dev-only.

In-flight F23 fix shape (docs/audit-2026-07-02-full.md + runbook-partA): add ACTION_CARD/BUILD_CARD branches to OttoChatStream mirroring OttoConversation:511-527; generalize bridge tool_output allowlist + proposeCardId/injectCardMessage for {cardIds[]} and card kinds; display-only, approve buttons keep calling existing gated actions.

---

# Otto 包(skill 框架、registry、instructions、run-state)

MAPPED FROM origin/main @ 7c53bb0 (#99); this worktree is pre-#99 (lacks propose-storyboard) — all facts below read via `git show origin/main:`.

## packages/otto layout
src/: otto.ts (Agent assembly) · registry.ts (skill list) · skill.ts (defineOttoSkill factory) · context.ts (OttoContext ports) · instructions.ts · run-input.ts · prompt-skills.ts · meter.ts (withLlmBudget) · model.ts (529 failover) · catalog.ts (+ scripts/gen-catalog.ts → src/skills/CATALOG.md) · index.ts (public surface) · skills/ (16 skills + AGENTS.md authoring how-to + _template.ts).

## registry.ts
`allSkills: OttoSkill[]` — ONE line per skill, array order = agent tool order. Exact order: proposeSkill, proposePackSkill, generateSkill, updateBriefSkill, describeRefsSkill, setTitleSkill, rememberBrandFactSkill, researchWebSkill, metaInsightsSkill, metaListObjectsSkill, listMetaPagesSkill, proposeMetaActionSkill, proposeAdBuildSkill, seedreamPromptSkill, seedancePromptSkill, proposeStoryboardSkill (16 total). `skillCatalog: SkillMeta[]` = projection {name, cost, effect, reach, needsApproval, description, requires}. registry.test.ts pins the EXACT sorted 16-name list ("collects all sixteen skills").

FULL SKILL TABLE (name | cost/effect/reach | needsApproval | requires | notes):
1. propose | free/write/internal | ❌ | requires:[goal] | GEN_CARD; model/price computed server-side; count 2–4 = image ad-pack variants
2. proposePack | free/write/internal | ❌ | requires:[goal] | 1–8 items, each its own GEN_CARD; $0
3. generate | spend/write/internal | ✅ (the ONLY gated skill) | — | idempotencyKey:(i)=>`cowork:${i.cardId}`; input = {cardId} ONLY
4. updateBrief | free/write/internal | ❌
5. describeRefs | free/write/internal | ❌ | effect deliberately "write" (prisma.entity.updateMany caching; F38 note in migration.test.ts)
6. setTitle | free/write/internal | ❌
7. rememberBrandFact | free/write/internal | ❌
8. researchWeb | free/read/external | ❌ (external READ not gated)
9. meta-insights | free/read/external | ❌
10. meta-list-objects | free/read/external | ❌
11. list-meta-pages | free/read/external | ❌
12. propose-meta-action | free/write/internal | ❌ | ACTION_CARD via ctx.metaPropose
13. propose-ad-build | free/write/internal | ❌ | BUILD_CARD via ctx.metaBuild.propose (PAUSED draft)
14. seedreamPrompt | free/read/internal | ❌ | deterministic: execute = ({prompt: assembleSeedream(i)}), zero I/O
15. seedancePrompt | free/read/internal | ❌ | deterministic: assembleSeedance; creative prompt only (no res/duration/ratio)
16. proposeStoryboard | free/write/internal | ❌ | requires:[goal] | STORYBOARD_CARD, $0, shots 1–8 (MAX_STORYBOARD_SHOTS=8 in propose-storyboard.helpers.ts); server-minted stable shotId per shot; entityIds per shot pass-through for F4

## skill.ts — defineOttoSkill guarantees (all DEFINITION-time, throw = build fails)
- deriveNeedsApproval(cost,effect,reach) = `cost==="spend" || (effect==="write" && reach==="external")` — pure, exported.
- Fail-closed defaults: missing cost→"spend", effect→"write", reach→"external" (most dangerous).
- parameters MUST be z.object (guard on .shape, fail-loud message).
- #3 identity gate: IDENTITY_KEYS=["orgId","ownerId","userId"] — any of these in parameters shape → throw. Identity comes from ctx only.
- #4: cost:"spend" without spec.idempotencyKey → throw. NOTE: the declared idempotencyKey fn is NEVER CALLED at runtime — it documents/justifies the key; the real guard must live inside execute + a DB unique index.
- requires (资讯门): each requires.field must exist in parameters shape → else throw. At runtime the factory (a) appends the questions to the model-facing description ("Before calling, make sure you have…"), (b) preflights execute: missingRequired() treats undefined/null/empty-trimmed-string as missing → returns {needMoreInfo:[{field,question}]} WITHOUT running execute. Only propose/proposePack/proposeStoryboard declare requires (all: goal).
- needsApproval passed to tool() as a LITERAL boolean (never a predicate/number — numeric predicates fail open).
- #5/#6 (inside-execute rules) are NOT factory-enforceable → fenced by scripts/check-skill-imports.sh + tests.
- Returned OttoSkill: {name,cost,effect,reach,needsApproval,description(un-augmented),requires,tool}. Each skill file also exports the bare tool (`export const X = XSkill.tool`).

## Fence — scripts/check-skill-imports.sh (repo root; CI: .github/workflows/ci.yml:41)
HARD-fail grep over packages/otto/src/skills/*.ts (excl. .test.ts): `from "@fikirtive/generation"` | `reserveCredits` | `meta-graph` | `metaGraphPost`. WARN-only (does not fail): direct `from "@fikirtive/db"` (current skills do owner-scoped Prisma reads/writes directly — migrate behind read-ports incrementally). fence.test.ts writes a probe file and asserts the script fails on reserveCredits + @fikirtive/generation imports.

## context.ts — OttoContext (re-derived FRESH every run from verified session; NEVER persisted in RunState)
Identity/scope (always): orgId (=ownerId, ledger key), userId, projectId, threadId, disabledModels[]. Per-turn: sourceGenerationId? (i2v frame), referenceVideoGenerationId? (整段参考, video plans only), images? ({label,dataUrl}[] — current turn only, stripped from history), brandContext?, availableRefs?, simpleMode?, activeJob?.
Ports (all optional, structurally re-declared — NO web imports; MetaAdObject re-declared locally):
- startGen?: (GenRequestInput)=>{id}|{error} — THE app-level spend entrypoint (= apps/web startGen; does its own requireOwner + genRequest validation + reserve + GenJob insert + enqueue)
- metaAds.list / metaPages.list / metaInsights.get(datePreset) — read ports
- metaPropose(input)→ACTION_CARD / metaBuild.propose(input)→BUILD_CARD — card-writer ports
- research.fetchUrl (search? optional, unwired) · brandBrain.context()
INJECTION SITES: web = apps/web/lib/otto-actions.ts:buildOttoContext (~line 120) injects ALL ports incl. real startGen (from gen-actions.ts); used by otto-actions turn/approve paths and apps/web/app/api/otto/stream/route.ts (streaming). Worker = apps/worker/src/otto-resume.ts builds a minimal ctx with startGen INTENTIONALLY NOT INJECTED (verdict turn must not spend; a resumed generate parks/errors "startGen port required"). buildContextSystemMessage (otto-actions.ts:94) composes the per-turn system msg from ctx (brandContext/refs/simpleMode block/activeJob line).

## otto.ts / model.ts / meter.ts
otto = new Agent<OttoContext>({name:"Otto", instructions:ottoInstructions, model:ottoModel, modelSettings:{maxTokens:OTTO_OUTPUT_CAP_TOKENS}, tools: allSkills.map(s=>s.tool)}). maxTurns is a run() option supplied by callers (OTTO_MAX_STEPS=10, packages/core/src/otto-budget.ts).
model.ts: OTTO_PRIMARY_MODEL="claude-sonnet-4-6", OTTO_FALLBACK_MODEL="claude-sonnet-4-5" (same tier so OTTO_DEFAULT_MODEL price lookup stays valid). isOverloadError = STRICTLY structured (statusCode===529, data.error.type==="overloaded_error", responseBody token, recursive via lastError/cause with cycle guard) — never generic text. withOverloadFailover wraps doGenerate/doStream at LanguageModel layer (invisible to Agent/RunState).
meter.ts withLlmBudget: reserve BEFORE model call (turnBudgetInternal(prices,margin,maxSteps)); settle actual (≤ reserved); fn-throw → full refund unless usageOnError yields usage; paid:false bypasses entirely; unknown model → sonnet pricing (never free). mapOttoUsage/actualCostInternal exported (cached ⊆ input clamp).

## instructions.ts — inlined TS constants (NOT runtime file reads; Next/Turbopack constraint)
Exports: ottoInstructions + ottoSimpleModeBlock (separate; injected only via buildContextSystemMessage on simple-door path). ottoInstructions ## sections, in order: Understand intent (刨根问底 + needMoreInfo protocol) · Craft the prompt with the model skill (Seedream/Seedream sole-authority + desiredDuration/desiredAspect/desiredAudio go on propose, never in prompt) · When to call propose · When to call proposeStoryboard (beats-vs-clips boundary; $0 claim) · Reference rules · Model/pricing (never pick) · Video keyframes (forVideo:true) · Attached reference image (kind from ASK not attachment) · Language (replies user-language, structuredPrompt English) · updateBrief · describeRefs (see-once) · setTitle (once) · generate (spend warning) · Verdict after generation · Identity preservation · Honesty & limits (status only from given line) · meta-list-objects + propose-meta-action (never claims executed) · Brand memory · list-meta-pages + propose-ad-build (4 objectives; never invent ids; PAUSED draft).

## run-input.ts
buildUserTurn(text, images?) — plain string content when no images; else [input_text, ...input_image] parts (agents-SDK shape, NOT chat-completions image_url). stripHistoryImages — drops input_image parts from rehydrated user turns; single remaining input_text collapses back to plain string. sanitizeHistory (F25) — filters ALL role:"system" items (fresh system msg is prepended every turn) then stripHistoryImages; deliberately NO token truncation (would split tool_call/tool_result pairs). tryRestoreRunState (F24) — RunState.fromString wrapped, returns null (console.warn) on corrupt/schema-bumped state instead of bricking every thread; callers: turn paths start fresh, resume paths surface clean error/skip.

## prompt-skills.ts (decision 6, #98)
PROMPT_SKILLS = [{skill:seedreamPromptSkill, family:"seedream"}, {skill:seedancePromptSkill, family:"seedance"}] — pairs the LIVE skill object with the family so a test can assert registration. PROMPT_SKILLED_FAMILIES derived Set; familyHasPromptSkill(family?) → false for undefined (unknown model keeps directive fallback). AUTHORITY RULE: for skilled families the skill-assembled prompt is SOLE authority — the legacy family×mode ModelDirective (packages/core/cowork-directives.ts) must NOT be stacked on either spend surface. Consumers: apps/web/lib/cowork-actions.ts:578 (button path: `family && !familyHasPromptSkill(family) ? await getEnhanceDirective(...) : undefined`); Otto path: generate.ts uses card.payload.structuredPrompt directly (no directive composer at all — documented in file header). Prompt-only; never affects spend/safety.

## generate.ts — THE spend gate (7 steps in executeGenerate)
1 startGen port required (fail loud) → 2 card load owner-scoped {id, ownerId:ctx.orgId, kind:"GEN_CARD", deletedAt:null} + thread.deletedAt/ownerId + card.threadId===ctx.threadId + thread.projectId===ctx.projectId all rechecked ("Card not found." on any mismatch) → 3 exactly-once: GenJob findFirst {ownerId, idempotencyKey:`cowork:${cardId}`} ANY status → return existing job w/o re-charge; DB unique index GenJob_cowork_idempotency_once is the race-proof backstop (Phase 0 proved SDK approval is NOT exactly-once) → 4 disabled-model check (isModelDisabled vs ctx.disabledModels — card built before a disable must not spend) → 5 buildGenRequestFromCard (pure, overrides:undefined — anti-flip: model cannot pass/override spend params; input is ONLY cardId) → 6 ctx.startGen(built.req) — the ONLY spend path (never fal / reserveCredits / GenJob insert directly) → 7 best-effort chatMessage.update genJobId (UI only, NOT the guard).

## Catalog & authoring
catalog.ts renderCatalog = pure sorted markdown table. `pnpm --filter @fikirtive/otto run catalog` writes src/skills/CATALOG.md; `catalog:check` (--check) exits non-zero if stale — but CI (.github/workflows/ci.yml) runs ONLY check-skill-imports.sh, NOT catalog:check → stale CATALOG.md is not CI-blocked. skills/AGENTS.md = 5-step recipe (declare port on OttoContext → inject in buildOttoContext → copy _template.ts, fill 3 fields → 1-line registry entry → gate test in migration.test.ts + regenerate catalog).

## index.ts public surface
otto, ottoInstructions, OTTO_DEFAULT_MODEL, ottoSimpleModeBlock; bare tools (propose, generate, updateBrief, describeRefs+sanitizeRefDescription, setTitle); OttoContext type; run-input fns + RefImage; withLlmBudget/actualCostInternal/mapOttoUsage/TokenUsage; re-exported SDK primitives (run, RunState, MaxTurnsExceededError + types) so web/worker share ONE SDK instance; allSkills/skillCatalog/SkillMeta; PROMPT_SKILLS trio; defineOttoSkill/deriveNeedsApproval + types; StoryboardCardPayload/StoryboardCardInput/MAX_STORYBOARD_SHOTS.

---

# 钱路核心(ledger、定价、genRequest 闸、provider 边界)

All refs = origin/main (worktree is slightly behind in exactly these files; verified via `git show origin/main:`).

## 1. Credit ledger — packages/db/src/credits.ts (SOLE writer of CreditAccount/CreditLedger)
- Kinds: `CreditTxnKind = GRANT | RESERVE | SETTLE | REFUND | ADJUST`; `CreditTxnSource = ADMIN | BETA | PROMO | PURCHASE | SYSTEM` (schema.prisma:636-650; migration 20260619130000_credits).
- `CreditAccount{orgId PK, balance, reserved}` (internal credits, 1 = $0.01). Invariants: balance == Σ balanceDelta, reserved == Σ reservedDelta, per org; account mutation + ledger row ALWAYS in one tx.
- `reserveCredits(tx,{orgId,refId,cost})` credits.ts:34 — conditional `updateMany where balance>=cost` (decrement balance, increment reserved); count===0 → throws `InsufficientCredits` (rolls back caller's job insert). Ledger row idempotencyKey `reserve:<refId>`.
- `settleCredits(tx,{orgId,refId,actualInternal?})` credits.ts:66 — held amount B read FROM the RESERVE row (never recomputed → immune to price drift in flight). A = actualInternal===undefined ? B : clamp(trunc,0,B). Insert via `createMany({skipDuplicates:true})` (ON CONFLICT DO NOTHING — NOT try/catch, a caught P2002 aborts the whole PG tx); count===0 → no-op BEFORE any account change. Then balance += B−A, reserved −= B. Key `settle:<refId>`.
- `refundReservation(tx,{orgId,refId})` credits.ts:92 — same skipDuplicates pattern, key `refund:<refId>`, full release.
- `grantCreditsTx(tx,{orgId,amount,idempotencyKey,...})` credits.ts:118 — in-caller-tx grant, createMany skipDuplicates then account upsert; positive only; never throws P2002 inside the tx.
- `grantCredits({...})` credits.ts:139 — own $transaction; ledger `create` FIRST (replay → P2002 → `{duplicate:true}`); amount>0 = GRANT + upsert; amount<0 = ADJUST via conditional decrement `where balance>=dec` (never creates an account, never negative; count===0 → InsufficientCredits).

## 2. Partial-unique dedup indexes (names + predicates, from migrations)
- `CreditLedger_orgId_idempotencyKey_key` — plain UNIQUE(orgId,idempotencyKey) (20260619130000_credits:39).
- `CreditLedger_ref_kind_once` ON (orgId,refId,kind) WHERE refId IS NOT NULL (same migration:50) — ≤1 RESERVE/SETTLE/REFUND each per job.
- `CreditLedger_finalizer_once` ON (orgId,refId) WHERE refId IS NOT NULL AND kind IN ('SETTLE','REFUND') (same migration:57) — THE finalizer mutual exclusion: SETTLE vs REFUND race, loser P2002-no-ops before account mutation.
- `GenJob_active_idempotency_key` ON GenJob(ownerId,projectId,idempotencyKey) WHERE idempotencyKey IS NOT NULL AND status IN ('QUEUED','GENERATING') (20260612140000) — active-only so shot frames can regenerate later.
- `GenJob_cowork_idempotency_once` ON GenJob(ownerId,projectId,idempotencyKey) WHERE idempotencyKey LIKE 'cowork:%' (20260617000000) — ALL-status: a cowork card spends exactly once EVER (closes the TOCTOU past-DONE window).
- `RefGenJob_active_entity_variant_key` ON RefGenJob(ownerId,entityId,COALESCE(variantId,'')) WHERE status IN ('QUEUED','GENERATING') (20260615120000) — COALESCE is load-bearing (NULL variantIds are distinct in PG).
- `ChatMessage_genjob_result_uniq` ON ChatMessage(genJobId) WHERE genJobId IS NOT NULL AND kind IN ('GEN_RESULT','TURN_ERROR') (20260615151750) — one durable cowork result per job; worker swallows P2002.
- `Generation_shot_version_live` ON Generation(shotId,version) WHERE shotId IS NOT NULL AND deletedAt IS NULL (20260613000000) — race-safe version allocation (attachToShot retries on violation).
- Founder seed in 20260619130000: CreditAccount 'founder' balance 100,000,000 + GRANT key `grant:founder-seed`.

## 3. Pricing — packages/core/src/spend.ts (+ gen.ts, refgen.ts)
- Units: `CREDITS_PER_USD=100`, `INTERNAL_PER_DISPLAY=10` (1 displayed = $0.10); ledger/balance ALWAYS internal; `displayCredits()` = view seam only.
- CHARGE (deterministic, reserve==settle): `pricedGenCredits(job)` spend.ts — IMAGE: count×INTERNAL_PER_DISPLAY (1 displayed/image). VIDEO: if `isFlatPricedVideoModel` (`FLAT_PRICED_VIDEO_MODELS = {"seedance-2-fast"}`) → `VIDEO_CREDITS_BY_RESOLUTION = {"720p":7, "1080p":16}` (unknown res → 16) ×10; else `displayedFromUsd(genSpentUsd(job))`×10 where displayedFromUsd = max(1, ceil(usd/0.1)). `pricedRefgenCredits` = count×10.
- COGS (RECORD-ONLY, never gates spend): `genSpentUsd` — VIDEO: `videoPriceUsd(model,{seconds,resolution,audio,count})` = count×seconds×`videoRateUsdPerSec` (per-model switch in gen.ts; seedance-2-fast 0.03/s BytePlus basis), options fall back to `videoDefaults(model)`; IMAGE: `GEN_PRICE_USD_PER_IMAGE = 0.04`×count. `refgenSpentUsd` = `REFGEN_PRICE_USD_PER_IMAGE = 0.04`×count (refgen.ts, independent constant).
- `BETA_INITIAL_GRANT_CREDITS = 100×INTERNAL_PER_DISPLAY`, granted idempotently under key `signup:<orgId>`.

## 4. genRequest gate — packages/core/src/gen.ts:genRequest (.strict())
Fields: projectId, shotId?, sourceGenerationId?, tailGenerationId?, referenceVideoGenerationId? (all ≤64), prompt ≤MAX_GEN_PROMPT(2000), entityIds ≤MAX_GEN_ENTITIES(8), variantSel? (bounded record), count int 1..MAX_GEN_COUNT(4), kind ∈ GEN_KINDS default "image", model string ≤40 default "seedream", **idempotencyKey REQUIRED 1..80** (keyless requests can't bypass dedup), threadId?, video controls durationSeconds/resolution/aspectRatio/fps/audio (nullish).
superRefine (all validate-before-spend): (a) every variantSel key ∈ entityIds; (b) model ∈ kind's menu — GEN_MODELS=["seedream"] vs GEN_VIDEO_MODELS (13: kling, veo3.1-lite, ltx-2, kling-2.6, kling-3, veo3.1-fast, seedance-2-fast, veo3.1, pixverse-v6, grok-imagine, wan-2.5, hailuo-02, seedance-2); (c) tailGenerationId only when kind=video AND `GEN_VIDEO_MODEL_INFO[model].tail===true`; (d) every video control ∈ `GEN_VIDEO_MODEL_OPTIONS[model]` (durations/resolutions/aspectRatios/fps lists), audio:false only when audioToggle, count ≤ maxCount.
refGenRequest (refgen.ts): entityId, prompt ≤2000, count 1..MAX_REFGEN_COUNT(6), model z.enum(["seedream"]), mode ∈ {REFSHEET,BASE,VARIANT}; superRefine: VARIANT ⟺ variantId.

## 5. Reserve / settle / refund call sites (origin/main line numbers)
RESERVE (always in the same tx as the job insert):
- `startGen` apps/web/lib/gen-actions.ts:134 (cost=pricedGenCredits :102; genJob.create + reserve; InsufficientCredits → friendly error; P2002 → return the winner's job — cowork keys matched ANY status, general keys active-only; pre-check findFirst at :52-54; also `checkCast` guardian block, `resolveDisabledModels`, `assertSpendableModel` all BEFORE the tx; video forces count=1).
- `startRefGen` apps/web/lib/refgen-actions.ts:93; `dispatchVariantJob` (shared helper) :204, called by `createVariant`(:279)/`regenerateVariant`(:349); costs :81/:195.
- `withLlmBudget` packages/otto/src/meter.ts:113 (reserve = `turnBudgetInternal` from packages/core/src/otto-budget.ts: OTTO_CONTEXT_CAP_TOKENS 12k / OTTO_OUTPUT_CAP_TOKENS 1.5k / OTTO_MAX_STEPS 10); refIds `otto-turn:<threadId>:<seq>` (otto-actions.ts) and `otto-stream:<threadId>:<seq>` (app/api/otto/stream/route.ts).
SETTLE (worker commit tx only): apps/worker/src/jobs/gen.ts:308 (image commit), :629 (video commit); apps/worker/src/jobs/refgen.ts:151 (spent-resume), :322 (commit); meter.ts:125 (usageOnError) and :145 (actual ≤ reserve; remainder auto-refunded inside settleCredits).
REFUND (with the FAILED write, same tx): worker gen.ts:170 (failGenJob), :226 + :370 (stale reapers), :251 (duplicate-delivery fail-closed), :689 (terminal catch — sets spent when `charged`); worker refgen.ts:63, :93, :107, :226, :359; apps/worker/src/jobs/llm-reservation-reaper.ts:40 (RESERVE rows past stale window with no finalizer); web gen-actions.ts:171 (boss.send dispatch failed — but queueJobId-persist failure after enqueue is best-effort, NO refund); cowork-actions.ts:753 `cancelGenJob` (updateMany WHERE status='QUEUED' only, refund iff count>0).
Spend snapshot (record-only): worker gen.ts:302/:624/:687 `genSpentUsd` → GenJob.spentUsd + `spent` bool; refgen.ts:147/:319/:357 `refgenSpentUsd`.

## 6. Provider seam — packages/generation/src/index.ts
- Interface `GenerationProvider` + `GenerationRequest`/`GeneratedImage`/`VideoRequest{prompt,imageUrl,tailImageUrl?,refVideoUrl?,durationSeconds,model,resolution?,aspectRatio?,fps?,audio?}`/`GeneratedVideo` defined in packages/core/src/refgen.ts.
- `createGenerationProvider()` index.ts (bottom): `GENERATION_PROVIDER==="fal"` → `FalProvider(FAL_KEY)` (throws if key missing); `==="byteplus"` → `BytePlusProvider(BYTEPLUS_API_KEY)`; ANYTHING else incl. unset → `MockProvider` ($0, offline — fail-safe default). Worker singleton: apps/worker/src/generation.ts:5 `export const provider = createGenerationProvider()`.
- `chargedError(msg)` index.ts — tags `{charged:true}` on post-billing failures; worker must terminal-fail (retry = double-charge). Plain errors = pre-charge, retryable.
- FalProvider: sync `fal.run` POST; !res.ok = plain (retry); after ok everything is chargedError; image batch all-or-nothing (short batch / any failed download fails the whole batch); `generateVideo` driven by `VIDEO_CFG` table (per-model endpoints, imageParam/tailParam/firstLast, durationUnit "str"|"s"|"num"|"none"); rejects `refVideoUrl` pre-spend (BytePlus-only); no-tail-support → error pre-POST.
- BytePlusProvider (byteplus.ts): `ARK_BASE` ap-southeast; `IMAGE_MODEL_MAP {seedream: "seedream-5-0-260128"}`; `VIDEO_MODEL_MAP {"seedance-2-fast": "dreamina-seedance-2-0-fast-260128"}`. Images: count parallel single-image POSTs, `watermark:false` (F40), multi-ref `image` (single string for 1 ref — live-verified shape; array for 2+). Shortfall (F05): any fulfilled OR charged rejection → chargedError; ALL pre-charge rejections → rethrow plain (retry). Video: async task submit + in-provider poll, `TIMEOUT_MS = 15min` (< GEN_QUEUE_POLICY.expireInSeconds 20min); post-submit poll exceptions keep polling, timeout → chargedError; tailImageUrl rejected pre-spend; refVideoUrl sent as `role:"reference_video"`.
- Queue policy (core/gen.ts + refgen.ts): GEN_QUEUE_POLICY / REFGEN_QUEUE_POLICY — retryLimit 2, retryBackoff + retryDelay 30 (without retryDelay pg-boss backoff is a silent no-op), expireInSeconds 1200, deadLetter GEN_DLQ/REFGEN_DLQ; BOTH web and worker create queues with the same object.

## 7. Money-in
- Beta grant: apps/web/lib/auth-guard.ts:109 `grantCreditsTx` inside the org-bootstrap tx, key `signup:<orgId>`, amount BETA_INITIAL_GRANT_CREDITS, source BETA.
- Stripe: apps/web/app/api/stripe/webhook/route.ts — events handled: `checkout.session.completed` AND `checkout.session.async_payment_succeeded` (F01: delayed FPX/GrabPay), both gated on `session.payment_status === "paid"`; signature via `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` (only bad signature is 4xx; everything else 200 to stop retries); metadata gate: orgId string + credits positive integer, else `credits.purchase.bad` ActionEvent + 200; grant = `grantCredits({amount: credits×INTERNAL_PER_DISPLAY, source:"PURCHASE", idempotencyKey: "stripe:<session.id>"})` — dedup on SESSION id, not event id.
- Admin: apps/web/lib/credit-actions.ts:39 and tenant-actions.ts:155 `grantCredits(source:"ADMIN")` (signed ADJUST allowed).

---

# Storage / DB(schema、裸 SQL 索引、内容寻址、D19)

## 1. packages/storage (packages/storage/src/index.ts — single file)

KEY SCHEME (one, everywhere): `u/<ownerId>/<sha256-hex>.<ext>`. Helpers live in packages/core/src/storage-key.ts:
- `storageKey(ownerId, contentHash, ext)` — validates hash `^[0-9a-f]{64}$`, ext `^[0-9a-z]{1,8}$` (lowercased, leading dot stripped), owner `[0-9A-Za-z_-]+`; throws otherwise.
- `parseStorageKey(key)` — strict single-regex parse; traversal structurally impossible. Every driver method calls it first.
- `keyOwnerMatches(key, ownerId)` — never throws; THE single cross-tenant guard for serving content-addressed blobs.
- `FOUNDER_OWNER_ID = "founder"` — DO-NOT-CHANGE literal; baked into every R2 key AND seeded as Organization.id; pinned by storage-key.test.ts.

`Storage` interface (both drivers): `put` (content-addressed, dedup by hash; in-memory, small objects only), `get` (whole-object; r2 mode has no callers today — comment says add streaming variant first), `url(key)` → always `/files/<key>`, `ffmpegInput` (local: fs path; r2: 1h presigned URL — worker-only, never log argv), `presignedGet(key, expires=300)` (local: **null** → route streams; r2: presigned GET with response-header overrides riding INSIDE the signature: `ResponseCacheControl: private, no-store`, `ResponseContentType` pinned from ext — stored ContentType is client-influenced on direct uploads — and non-renderable exts forced `attachment`), `exists`/`sizeOf` (ONLY 404/NotFound/NoSuchKey means absent; auth/network errors must throw, not read as miss), `readStream` (worker D19 hash re-verify), `deleteObject` (missing = no-op), plus 5 direct-upload methods (r2 only; `LocalDiskStorage` throws — gate on `supportsDirectUpload`).

Direct-upload hardening (R2Storage):
- `presignedPut`: ContentType + ContentLength + `IfNoneMatch:"*"` inside the signature — size/type pinned, URL single-shot (no replay-overwrite after verification).
- `signPart`: exact per-part ContentLength signed (no oversized-part storage leak).
- `completeMultipart`: `IfNoneMatch:"*"`; on 412/PreconditionFailed → abortMultipart + treat as success (concurrent same-content winner; bytes identical).
- `abortMultipart`: NoSuchUpload swallowed.
- `put` dedup is Head-then-Put best-effort, race harmless (content-addressed).

Factory `createStorage(localRoot)`: `STORAGE_DRIVER=r2` requires ALL of R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET or it THROWS (no silent local fallback in prod). `R2_FORCE_PATH_STYLE !== "false"` → path-style (MinIO test double). Handles: apps/web/lib/storage.ts (`storage`, `extFromFilename` → fallback "bin", `kindOf` image/video/other — video set excludes avi on purpose) and apps/worker/src/storage.ts (`ARTLIO_DATA_DIR` overridable local root).

## 2. /files/[...key] route contract (apps/web/app/files/[...key]/route.ts)

Order is load-bearing: (1) `auth()` + `allowed(email)` allowlist → 302 /login; (2) `requireOwner()` → 302 /login; (3) `keyOwnerMatches(joined, owner.ownerId)` → **404** (not 403 — no existence oracle); (4) `parseStorageKey` (malformed → 404 via catch); (5) `storage.presignedGet(key, 3600)` — F41: 1h TTL (default 300s expired mid-playback), safe because content-addressed = immutable; if non-null → 302 redirect with `Cache-Control: private, no-store` + `Referrer-Policy: no-referrer` (signed URL must not linger in caches/referrers); (6) local fallback: streams bytes with **Range/206** support (Safari refuses <video> without it), `private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `kindOf(ext)==="other"` → `Content-Disposition: attachment`. 416 with `Content-Range: bytes */total` on bad ranges. Tests: apps/web/app/files/__tests__/route.test.ts.

## 3. Upload path (claimed size+hash are UNTRUSTED — D19)

Client apps/web/lib/direct-upload.ts: hash-wasm streaming sha256 → `authorizeUpload` → Uppy PUT direct to R2 → `finalizeCandidateUploads`. Server apps/web/lib/upload-actions.ts: every action opens with `requireOwner()`; key always built server-side via `storageKey(ownerId, sha256, ext)` (client never names keys). authorize: `exists` → `{kind:"exists"}` (dedup, $0); ≤ UPLOAD_SINGLE_MAX_BYTES → single presignedPut else multipart. finalize: `sizeOf` re-check ("claimed size bought URLs, reality decides rows"); on mismatch, deleteObject ONLY if mode!=="existed" AND zero live Asset rows share the hash (never destroy deduped bytes); then `asset.upsert` on `ownerId_contentHash` (resurrects tombstone: deletedAt:null + realigns ext/mime/size to the HEAD-verified object) + Generation row + ingest dispatch. Worker apps/worker/src/jobs/ingest.ts: `sha256Stream(storage.readStream(key))` re-hash — read failure THROWS (pg-boss retries; swallowing would let a forged same-size upload survive); only a CONFIRMED mismatch → deleteObject + tombstone Asset + soft-delete its Generations + ActionEvent `asset.hash_mismatch`.

## 4. Prisma schema (packages/db/prisma/schema.prisma, 1020 lines; generator prisma-client → ../generated/prisma; postgres)

IDs = app-supplied ULIDs (`newId()`); tenancy: Organization IS the tenant, every business table's `ownerId` is an FK to Organization.id with a required back-relation on Organization (~25 back-relations — adding an owner-scoped model without one breaks generate). ownerId DEFAULT was DROPPED (20260619140000) — inserts must supply it from requireOwner.

Models (purpose · owner-scope · soft-delete):
- **Project** — project root; ownerId; deletedAt. editJson = working cut. `@@index([ownerId,deletedAt])`.
- **Entity** — cross-project reusable entity; ownerId; deletedAt. baseAssetId = soft pointer (no FK, revalidated live before VARIANT spend). `@@index([ownerId,type,deletedAt])`.
- **EntityVariant** — named look registry; ownerId; deletedAt. entity FK **Restrict**. Handle uniqueness is PARTIAL (migrations, below).
- **ReferenceImage** — entity↔asset join with position/viewTag/variantId; ownerId; deletedAt. variant FK **Restrict**.
- **Asset** — content-addressed media; ownerId; deletedAt = tombstone ONLY (rows never physically deleted; Generation FK Restrict makes row-delete impossible BY DESIGN — sweep contract deletes the R2 blob only). `@@unique([ownerId, contentHash])` = THE dedup invariant + upsert target. `@@index([deletedAt])` for the cross-owner 30-day sweep scan.
- **Shot** — storyboard unit + status machine; ownerId; deletedAt. `@@unique([projectId, number])`. Covering `Shot_order_idx (ownerId,projectId,deletedAt,scene,number)`. firstFrame/lastFrameGenerationId = ids, deliberately no relation.
- **ShotEntityRef** — DERIVED index of promptDoc chips (rebuilt on save; not truth); ownerId; no soft-delete. `@@id([shotId, entityId])`.
- **Generation** — immutable history; ownerId; deletedAt = hide only. Mutable whitelist: **shotId, version, attachedAt, deletedAt, favorite** — everything else frozen. `entitySnapshot` REQUIRED (write `{"entities":[]}` when empty). (shotId,version) uniqueness is PARTIAL (below). Hot covering indexes: `Generation_media_idx`, `Generation_candidates_idx`, `Generation_library_idx` (keyset pagination — id as createdAt tiebreak).
- **TemplateBundle** — ComfyUI registry; ownerId; deprecatedAt (no deletedAt). `@@unique([slug,version])`; versionHash + zipHash `@unique` (zip location derived `bundles/<zipHash>.zip` — D14, no paths in DB).
- **RenderJob / CaptionJob** — async jobs, row persisted BEFORE pg-boss dispatch (never orphan a render); ownerId; no soft-delete. `@@index([status, updatedAt])` = stuck-row reaper scan.
- **Transcript** — whisper cache; ownerId; no soft-delete. `@@unique([contentHash, model])` = cache key.
- **RefGenJob** — paid refgen job; ownerId; no soft-delete. spentUsd = record-only (never a spend predicate). Anti-double-charge = PARTIAL UNIQUE (below); startRefGen catches P2002 → reuses in-flight job.
- **GenJob** — paid gen job; ownerId; no soft-delete. `spent` Boolean = money truth (FAILED+spent = paid-but-not-stored, auditable); spentUsd record-only; ottoVerdictAt = at-most-once claim. Idempotency = TWO partial uniques (below). `@@index([ownerId,status])`.
- **User/Account/Session/VerificationToken** — NextAuth-shape tables (auth retired to BA but tables remain); User.role code-validated string (viewer default), activeOrgId reserved.
- **Organization** — tenant root; id = ULID or literal "founder" (seeded; NEVER change); slug `@unique`; settings Json (OwnerSettings); deletedAt reserved.
- **Membership** — user↔org, `@@unique([userId, orgId])`; role/status = code-validated strings, NOT PG enums (add roles without migration).
- **AllowedEmail** — email PK, LOWERCASED at write+compare.
- **CreditAccount** — orgId PK; balance/reserved Int internal credits; balance never negative (conditional UPDATE, not a check constraint).
- **CreditLedger** — append-only, dual signed deltas (balance == Σ balanceDelta, reserved == Σ reservedDelta); `@@unique([orgId, idempotencyKey])`; exactly-once worker finalize = partial uniques (below).
- **ActionEvent** — audit events (also used by ingest hash-mismatch).
- **ModelDirective** — prompt directives; `@@unique([ownerId, family, mode])`; **ModelDirectiveRevision** history (FK Cascade).
- **RuntimeConfig** — key PK; per-key zod both sides; DB miss → env fallback.
- **ModelRegistryOverlay** — `@@unique([ownerId, modelId])`; can ONLY narrow the typed catalog (disable), never add models/raise caps.
- **ChatThread** — cowork thread; ownerId; deletedAt. **Intentionally NO prisma @@index** — the only list index is the raw partial (below); don't "helpfully" add one.
- **ChatMessage** — ownerId; deletedAt; `@@index([threadId, seq])`; thread FK **Restrict**; genJobId one-result-per-job partial unique (below).
- **Memory / BrandRule / GenerationBatch** — ownerId (+nullable brandId soft-ref, no FK — v1-additive agency-layer convention repeated on Project/Entity/ReferenceImage/Asset/CreditLedger/GenJob/Generation as brandId/campaignId/batchId).
- **BrandKit** — ownerId; no deletedAt; uniqueness is a raw EXPRESSION index (below); logoAssetId unenforced soft-ref.
- **BetterAuth**: BetterAuthUser/Session/Account/Verification `@@map`ped to ba_user/ba_session/ba_account/ba_verification; ba_user.role = MIRROR of User.role; banned gate in session hook; ba_session.impersonatedBy.
- **CanvasNode** — canvas item; ownerId; **NO deletedAt (hard-delete model)**; generationId/genJobId/threadId all soft-refs validated in actions, no FK.
- **MetaConnection** — one per org (`ownerId @unique`); accessTokenEnc AES-256-GCM (apps/web/lib/token-encryption.ts), never plaintext/client; onDelete **Cascade written in schema explicitly to match the hand-written FK** (else migrate dev recreates constraint forever); adsWritesPaused kill-switch; canWrite/canManagePages capability booleans.
- **MetaActionExecution** — ad-write step idempotency; `@@unique([ownerId,cardId,stepIndex], map:"MetaActionExecution_step_once")` — plain unique deliberately MODELED in schema to stop migrate-dev drift (the migration comment mislabels it "partial-unique"; it has no WHERE).

## 5. Migrations directory (packages/db/prisma/migrations/ — 51 dirs, postgres lock)

Conventions: `YYYYMMDDHHMMSS_name` dirs; hand-authored ones use synthetic times (…120000/130000) and one short-form outlier `20260630_org_settings`; only 20260619120000_org_tenant carries a `rollback.sql`. Hand-written DDL uses `IF NOT EXISTS`; data repair runs BEFORE constraint creation (20260613 renumbers duplicate versions before creating the unique; 20260615024341 backfills Entity.baseAssetId); 20260619120000 seeds the founder org (ON CONFLICT DO NOTHING) BEFORE adding the ~20 ownerId FKs so zero backfill validates; 20260619140000 drops `DEFAULT 'founder'` from ownerId on every business table.

**COMPLETE raw-SQL partial/expression index inventory (invisible to `prisma migrate diff` — schema comments are the only in-schema record):**
1. `GenJob_active_idempotency_key` ON GenJob(ownerId, projectId, idempotencyKey) WHERE idempotencyKey IS NOT NULL AND status IN ('QUEUED','GENERATING') — 20260612140000. Double-submit shield; startGen catches P2002 → reuse.
2. `GenJob_cowork_idempotency_once` ON GenJob(ownerId, projectId, idempotencyKey) WHERE idempotencyKey LIKE 'cowork:%' — 20260617000000. Forever-once for cowork keys (no status filter).
3. `RefGenJob_active_entity_variant_key` ON RefGenJob(ownerId, entityId, COALESCE(variantId,'')) WHERE status IN ('QUEUED','GENERATING') — 20260615120000. One active job per (owner, entity, variant); base rows COALESCE to '' → serialized per entity.
4. `Generation_shot_version_live` ON Generation(shotId, version) WHERE shotId IS NOT NULL AND deletedAt IS NULL — 20260613000000 (dropped the old non-partial `Generation_shotId_version_key`). attachToShot retries on violation.
5. `CreditLedger_ref_kind_once` ON CreditLedger(orgId, refId, kind) WHERE refId IS NOT NULL — 20260619130000. Exactly-once RESERVE/SETTLE/REFUND per job.
6. `CreditLedger_finalizer_once` ON CreditLedger(orgId, refId) WHERE refId IS NOT NULL AND kind IN ('SETTLE','REFUND') — 20260619130000. A job is settled XOR refunded, never both.
7. `ChatMessage_genjob_result_uniq` ON ChatMessage(genJobId) WHERE genJobId IS NOT NULL AND kind IN ('GEN_RESULT','TURN_ERROR') — 20260615151750. Worker at-least-once → effectively-once (swallow P2002).
8. `ChatThread_project_live_idx` ON ChatThread(projectId, ownerId, updatedAt) WHERE deletedAt IS NULL — 20260615124202. The ONLY thread-list index.
9. `EntityVariant_entityId_handle_live` ON EntityVariant(entityId, handle) WHERE deletedAt IS NULL — 20260615024341.
10. `BrandKit_owner_brand_unique` ON BrandKit(ownerId, COALESCE(brandId,'')) — 20260628120000 (EXPRESSION, not partial; dedups incl. brandId IS NULL).

IMMUTABLE-predicate rules documented in-migration: enum columns compared to their OWN labels (`status IN ('QUEUED','GENERATING')` — a `::text` cast is NOT immutable and Postgres rejects it in a predicate); `LIKE 'constant%'` and `COALESCE(text,...)` are fine.

## 6. Sweep status (D21)

apps/worker/src/queues.ts declares `QUEUES.sweep`; apps/worker/src/index.ts creates the queue but registers **no boss.work handler** — the refcount sweeper is UNIMPLEMENTED. Today soft-deleted assets' blobs are never purged. Contract for whoever builds it (per Asset model comment): delete the R2 blob only; the Asset row stays forever as a tombstone (Generation FK Restrict makes row deletion impossible by design); 30-day window; refcount across ReferenceImage + Generation; Entity.baseAssetId is protected only while a base-level ReferenceImage points at the same asset.

---

