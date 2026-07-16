# 总审查员手册(Reviewer Playbook)

> **性质(2026-07-16 sanitation 加注):派生安全检查表,不是项目法律、merge authority、
> 产品方向或 current-status 真源。** 主体生成于 2026-07-02(6-agent 全库测绘,基线 =
> main 合并 #99 后);条目必须结合当前代码与当前任务复核。项目入口/权限/合并纪律以根
> `AGENTS.md` 指向的现行项目法为准;本手册只能收窄审查,不能自行扩大权限。
> 历史全库测绘见 [CODEBASE-MAP-2026-07-02.md](CODEBASE-MAP-2026-07-02.md)。

## 审查角色与边界

审查是一次有边界的任务,不是可继承的控制面或常驻职位。审查者可以在当前任务授权内
检查事实、运行清单并报告 finding;能否修改、批准或合并,始终由现行项目法、当前 GitHub
任务和 separation-of-duties 共同决定。本文件不授予 merge、Blueprint、产品拍板、真实花费、
部署或外部写入权限。作者不得审批或合并自己实质编辑的 diff。

## 审查协议
0. **先按现行项目入口加载 authority**;`docs/BLUEPRINT.md` 与 diff 冲突时停手、报告,不得让本手册覆盖它。
1. **一律 PR + 当前 head 的全部 required checks 绿**;Actions 不可用时只按现行项目法与 `docs/runbooks/local-ci.md` 的 fallback 处理。本条不授予 merge 权限。
2. **钱路 diff**(genRequest/startGen/startRefGen/dispatch/幂等键/partial-unique 索引/provider 调用)必过 `money-safety-review` skill,逐检查项给结论。
3. **审查者不自批自己写的 PR** —— 自己的改动要么等 founder,要么换一个 session 审。(解读边界:"换一个 session"= 一个**独立**的审查会话从零跑清单;作者自己开个新会话给自己的 PR 盖章仍是自批,同样禁止。)
4. **UI/客户端 PR**:typecheck+单测不够,合并前需浏览器 runtime QA(谁提出谁验证,PR 里贴证据)。
5. **每笔真实花费**(fal/BytePlus/Stripe 验证跑)逐笔向 founder 确认 —— 「问」就是上限。
6. **产品取舍**摆选项+利弊给 founder,不替他拍板。
7. 审 diff 一律对着 `origin/main` 比,不信任本地 worktree 的旧文件。

## Worker 管线(ingest / render / caption / 队列 / reaper)

### 必查清单
- [ ] Any change to a *_QUEUE_POLICY, a handler timeout, or a STALE/REAP window must preserve the ordering chain: subprocess/provider timeout < on-claim STALE_MS < queue expireInSeconds < proactive REAP_MS (render 10m<13m<15m; caption 10m<13m<15m; gen/refgen fal-call<18m<20m<25m). Breaking it either expires live paid jobs (duplicate-delivery fail-close of an active gen) or reap-refunds a job pg-boss will still deliver.
- [ ] Queue policy consts live ONLY in packages/core and are createQueue'd identically by apps/web/lib/queue.ts and apps/worker/src/index.ts — reject any PR that inlines a policy on one side or adds a queue the other side doesn't create (ingest is already web-send/worker-create-only; don't repeat that pattern for money queues).
- [ ] retryDelay must stay explicitly set wherever retryBackoff is set — pg-boss defaults retry_delay=0, silently disabling backoff (instant retry hammering fal on a paid queue).
- [ ] Everything written to a job's error column, chat text, or RETHROWN from a handler must pass sanitizeError/scrubUrls — execa error.message is the full argv including presigned -i URLs with live X-Amz signatures, and pg-boss serializes thrown errors into pgboss.job.output. Check both the persist AND the throw.
- [ ] Reaper/fail-close branches on GenJob/RefGenJob must keep the commit-marker exclusion (generationIds/outputAssetIds isEmpty) and refund ONLY inside the same tx as a won conditional updateMany claim — never refund on a lost claim, never fail-close a committed job.
- [ ] Any new withLlmBudget refId prefix must be added to the allowlist in llm-reservation-reaper.ts or its leaked reservations never get swept; conversely NEVER add a bare-ULID (GenJob/RefGenJob-shaped) pattern there — the prefix filter is what keeps this reaper off the generation spend path.
- [ ] resumeOttoAfterGen must keep: ottoVerdictAt claim BEFORE the LLM call, startGen NOT in OttoContext, CAS on priorOttoState for every ottoState write, and all throws swallowed. Any diff that injects startGen or moves the claim after run() opens double-spend/duplicate-verdict.
- [ ] handleGen's commit tx must keep the conditional updateMany(status:'GENERATING') marker + REDELIVERY_DISCARD rollback and settleCredits INSIDE the same tx; the requeue path must stay a guarded updateMany(status in [QUEUED,GENERATING]) (F04). Run the money-safety-review skill on any diff touching these.
- [ ] New worker subprocess calls (ffmpeg/ffprobe/whisper) must be double-bounded: execa timeout AND an input-side cap (-t / -d / thread cap), with the queue expireInSeconds above the timeout.
- [ ] Ingest's hash re-verification must keep throw-on-read-failure semantics (only a CONFIRMED mismatch deletes); softening it to a swallowed error re-opens the forged-direct-upload hole (D19 rule 3), and the mismatch tx must keep cascading Generation soft-deletes.
- [ ] Storage keys reaching ffmpegInput/presignedGet must come from an owner-scoped DB row or a keyOwnerMatches-checked src. Watch render especially: editJson clip srcs are client-authored and only contract-parsed — any change that makes keys enumerable/guessable (or logs presigned URLs) is a cross-tenant read.
- [ ] Dockerfile changes: keep -DGGML_NATIVE=OFF (SIGILL portability), keep fonts-dejavu-core (render's hard-coded DRAWTEXT_FONT path), keep apt ffmpeg (7.x xfade/sidechaincompress values are asserted against it), and regenerate pnpm-lock.yaml for any dep change (worker Docker build is the only thing that catches a stale lockfile).

### 最脆弱的点(动了必红灯细看)
- ⚠️ apps/worker/src/jobs/gen.ts L594-611 — the conditional commit marker + REDELIVERY_DISCARD sentinel: replacing the throw with a return (or moving settleCredits out of the tx) silently commits user-visible Asset/Generation rows for a job a redelivery already FAILED+refunded = free delivery / ledger mismatch. Booby-trapped because it LOOKS like over-engineering.
- ⚠️ The timeout/stale/expire/reap number ladder (render.ts STALE_MS L367, caption.ts L40-42, gen.ts L47-63, core *_QUEUE_POLICY expireInSeconds): five magic numbers in four files whose pairwise ordering is the actual invariant; changing any one 'for headroom' without re-deriving the chain either double-runs paid jobs or refunds live ones.
- ⚠️ refgen.ts reapStaleRefGenJobs QUEUED branch (L97-109) has NO hasLiveGenMessage liveness check — the F07 fix landed only in gen.ts. A serial-queue burst >25m can spuriously fail+refund a refgen job pg-boss would still deliver; anyone 'harmonizing' gen↔refgen must copy the check the right direction.
- ⚠️ index.ts createQueue asymmetry: INGEST is created only by the worker while web sends to it (upload-actions.ts:207 catch logs 'UNVERIFIED' relying on a reconciliation sweep that does not exist yet), and QUEUES.sweep is created with no consumer or producer — both look like bugs, are known-deferred, and invite 'fixes' that change dispatch failure semantics on the D19-load-bearing hash-verification path.
- ⚠️ model-registry.ts workerDisabledModels fail-OPEN (empty set on DB fault) vs everything else in the worker being fail-closed — an inverted-polarity trap; 'fixing' it to fail-closed would fail every legitimately queued paid job during a DB blip, stranding reservations.
- ⚠️ otto-resume.ts ordering: ottoVerdictAt claim (L41) must precede withLlmBudget, and the two CAS writes compare against priorOttoState captured at L36 — reordering any of these (e.g. re-reading thread state later) reintroduces double-billed verdict turns or clobbers a concurrent web turn's ottoState.

## Admin / Auth(Better Auth、allowlist、operator 后台、冒充)

### 必查清单
- [ ] FOUNDER path exclusivity: requireOwner (auth-guard.ts) is the ONLY resolver allowed to return FOUNDER_OWNER_ID, and only via isFounderAdmin(email); any error path returning "founder" or a default org is an instant block. Grep new code for FOUNDER_OWNER_ID used as a fallback.
- [ ] R7 in-handler gates: every new server action / route handler re-asserts its own gate (requireSession | requireOwner | requireRole) as the first statement — proxy.ts is convenience, never the guard. ownerId/orgId must come from the gate result, never from client input.
- [ ] Spend never on requireRole: spend/generation actions gate with requireSession/requireOwner only; a PR that puts **operator/staff requireRole** on a tenant spend path, or loosens a spend gate to a role check, is wrong by design. **边界注(2026-07-03)**:未来租户侧审批席闸(宪法 7 RBAC)与市政厅 v2 授信限额是独立的新设计 —— 不被本条禁止,也不豁免本条;动工时单独立清单。
- [ ] allowed()/isAllowedEmail are async: reject any `if (!allowed(email))` without await (always-falsy Promise = gate silently open).
- [ ] Allowlist coverage for new auth methods: any new BA sign-in surface must be covered by databaseHooks user.create.before + session.create.before (not just hooks.before path prefixes), and any new outbound auth email must assertAllowedEmail before send (the sendResetPassword/sendMagicLink pattern). requireEmailVerification: true and accountLinking.requireLocalEmailVerified: true are non-removable.
- [ ] Role dual-write: User.role (canonical, read by roleForEmail/requireRole) and ba_user.role (read by the BA admin plugin's hasPermission for its client-callable /api/better-auth admin endpoints) must be written together (saveUserRole tx, converge founder promote). A ba_user.role write without the matching User.role write (or vice versa) desyncs two live permission systems.
- [ ] Two user-id spaces: any ban/session-cut/impersonation code must join Membership.userId → User.email → lowercase → BetterAuthUser.id (orgMemberBaUserIds pattern); passing User.id into a betterAuthSession/betterAuthUser where-clause silently no-ops.
- [ ] Admin actions taking an orgId must (a) reject orgId === FOUNDER_OWNER_ID and (b) verify the org exists with deletedAt: null (grantTenantCredits pattern — do NOT copy grantCreditsAction's weaker default-to-founder shape into multi-tenant code).
- [ ] Impersonation: every new spend or account-mutating entry point adds the isImpersonating() block (copy the exact error string pattern); stopImpersonatingTenant must stay gated on isImpersonating() — putting requireRole on it locks staff inside the impersonated session.
- [ ] proxy.ts matcher: api/better-auth and api/stripe stay excluded (lockout loop / webhook breakage); prod-enabled logic stays fail-closed (`AUTH_ENABLED !== "false"`); any new public route added to the matcher exclusion list needs explicit justification. nextCookies() stays the LAST BA plugin.
- [ ] Credits money-in: grantCredits/grantCreditsTx remain the only CreditAccount/CreditLedger writers; every grant carries a deterministic idempotencyKey (stripe:<session.id>, signup:<orgId>, client 8–100-char key); post-commit audit writes are best-effort catch-and-log — surfacing them as errors invites a retry under a NEW key = double grant.
- [ ] New tenant-scoped models go into TENANT_MODELS (packages/db/src/tenant-guard.ts) and every list/updateMany/deleteMany carries a defined ownerId; new admin sections require a SECTION_MATRIX cell + page-level requireRole(section, "read") + awareness that admin/layout.tsx stays founder-only until staff roles ship (removing that redirect exposes viewer-readable sections to every beta merchant).
- [ ] Redirect hygiene: any post-login/callback target flows through sanitizeCallbackURL (lib/safe-redirect.ts); admin read surfaces never emit storage URLs or /files paths cross-tenant (conversation-admin rule).

### 最脆弱的点(动了必红灯细看)
- ⚠️ lib/better-auth/server.ts:114 admin plugin — it mounts client-callable HTTP admin endpoints (impersonate, ban, set-password, set-role) under /api/better-auth gated SOLELY by ba_user.role ∈ adminRoles. Any code path that can write "super-admin" into ba_user.role (converge.ts:26 founder promote, admin-actions.ts:188 saveUserRole mirror) is a full-platform escalation lever that bypasses requireRole entirely — audit every new ba_user.role write with maximum suspicion.
- ⚠️ auth-guard.ts:requireOwner + bootstrapPersonalOrg — the deterministic `org_<userId>` id and the `signup:<orgId>` grant key are load-bearing for both concurrency convergence and grant idempotency; changing the id scheme (or moving the grant out of the tx) reintroduces double-org/double-grant races. The catch-block re-read (line 121) must keep the status:"active", deletedAt:null filter or a suspended user re-enters via the race path.
- ⚠️ app/admin/layout.tsx:36 founder-only redirect — SECTION_MATRIX intentionally grants viewer read on model/system/knowledge, so this single redirect is what keeps every beta merchant out of platform-wide admin reads. It looks like dead-weight double-gating and is tempting to "clean up" when staff roles ship; removing it without a staff-membership check is a cross-tenant data leak.
- ⚠️ tenant-actions.ts:126-138 stopImpersonatingTenant — deliberately NOT requireRole-gated (F15); the authorization IS the session's impersonatedBy field. A well-meaning "add the missing gate" fix locks staff inside customer sessions. Symmetrically, impersonateTenant's isFounderAdmin double-gate (line 111) must not be relaxed to plain requireRole when staff roles arrive.
- ⚠️ lib/allowlist.ts:allowed — async alias whose non-awaited use compiles fine and always passes; the same trap exists for every isImpersonating() call. One missing await = silently open gate; there is no lint rule enforcing this.
- ⚠️ credit-actions.ts:grantCreditsAction vs tenant-actions.ts:grantTenantCredits — near-duplicate money-mint actions with DIFFERENT validation strength (credits-action defaults orgId to founder and skips the org-exists check, relying on the CreditAccount FK as backstop). Copy-pasting the weaker one into future multi-tenant admin work, or unifying them by loosening the stronger one, mints credits into wrong/phantom orgs.

## Web 界面(路由、Otto 数据流、卡片五道缝)

### 必查清单
- [ ] New durable ChatMessage kind touches FIVE seams in lockstep: lib/types.ts kind union, otto-ui-messages.placeholderTextFor, OttoChatStream render branch, OttoConversation branch, and otto-inject-helpers filters (injectCardMessage kinds + appendDurableResults exclusions) — plus otto-stream-bridge tool_output allowlist + TOOL_STEP_LABELS if a tool streams it. Missing any one = invisible/duplicated cards (F23 class).
- [ ] api/otto/stream: pre-stream validation must keep returning plain JSON errors BEFORE the SSE opens; InsufficientCredits must persist NOTHING and write only data-error; reserve refId stays keyed on the unique userMessageId (`otto-stream:${userMessageId}`, F27) — never threadId:seq; finalizeOttoRun CAS (updateMany on {id, ownerId, ottoState: priorOttoState}) is shared with ottoTurn and must not fork.
- [ ] Card UIs may only call the existing gated server actions (ottoApprove / coworkGenerate / coworkVaryCard / cancelGenJob / storyboard-actions) — no new client-reachable spend seam; every approve path must also: add submittedCardIds, clear pendingApprovalCardIds, re-arm the poll (pollGaveUp/pollTerminal/pollCountRef/checkAgainUsedRef), and refresh balance.
- [ ] ottoStreamEnabled is hardcoded true in app/otto/page.tsx — a user-facing chat fix landed only in OttoConversation does NOT ship; conversely OttoConversation is still the reference for card branches and the skin-preview harness, so don't delete it casually.
- [ ] prepareSendMessagesRequest replaces the POST body wholesale because coworkTurnRequest is .strict(); any new turn field must be threaded through sendMessage's per-call `body` AND the route schema together, and note referenceVideoGenerationId takes precedence over sourceGenerationId (XOR).
- [ ] OttoChatStream captures transport + seed messages in a ONE-TIME useState and is remounted via key={thread.id} in OttoView — prop changes never reseed useChat; never 'fix' staleness by mutating chatInit, fix the keying.
- [ ] appendDurableResults must never append TEXT/GEN_CARD (double-renders the streamed turn) and syncCardJobIds must run before it in pollAndInjectResults — otherwise hasWorkingJob never flips and results never land.
- [ ] Pack rendering coalesces only CONSECUTIVE GEN_CARDs with the same payload.packId — server-side proposePack must keep pack cards contiguous in seq order or the PackCard confirm-total splits.
- [ ] Composer conventions: Shift+Enter submits / Enter inserts newline in all Otto message composers (MentionInput also Cmd/Ctrl+Enter); mention dropdown owns Enter/Tab/Esc/arrows; single-line fields keep Enter=submit (apps/web/AGENTS.md).
- [ ] Balance is DISPLAYED credits everywhere user-visible (creditsLabel; getMyAccount().balance); never surface $ — balanceUsd is internal math only (PackCard affordability uses the cents-first rounding in pack-credit-math.ts).
- [ ] Canvas paid flows: every spend behind a confirm dialog; kickoff failures must surface via fail()/onGenError (silent return = re-click = second idempotencyKey = second charge); model ids come from getActiveGenModels() server action, never client-side activeVideoModel() (F18); node placement after startGen goes through createNodeWithRetry.
- [ ] Route/auth invariants: ?view/?project/?thread validated server-side in app/otto/page.tsx (extend VALID_VIEWS, don't trust searchParams); /files keys pass keyOwnerMatches; proxy.ts must keep api/better-auth and api/stripe excluded; skin-preview keeps the production notFound(); admin actions re-assert requireAdmin regardless of the layout gate.

### 最脆弱的点(动了必红灯细看)
- ⚠️ lib/otto-stream-bridge.ts tool_called/tool_output allowlists are literal string matches ('propose'|'proposeStoryboard') against skill tool names — proposePack/propose-meta-action/propose-ad-build outputs are silently dropped today (F23); any skill rename or new card-proposing tool that skips this file makes cards invisible until reload, with zero errors.
- ⚠️ The five-seam card-kind contract (types.ts union → otto-ui-messages → OttoChatStream branches → otto-inject-helpers kind filters → bridge allowlist) has no compile-time enforcement — ACTION_CARD/BUILD_CARD already fell through it and render as inert placeholder sentences in the only live chat surface.
- ⚠️ OttoChatStream's poll state machine (pollGaveUp/pollTerminal/pollCountRef/checkAgainUsedRef) is reset from FOUR distinct sites (submit, card onApproved, pack packApproved, onRetry, plus the thread-switch effect); forgetting a reset in a new approve path silently dead-ends 'Otto is making this…' while credits are on hold.
- ⚠️ prepareSendMessagesRequest ↔ coworkTurnRequest.strict() coupling: useChat's default body is rejected by the route, so the shim must enumerate every field; a new field added on only one side either 400s every send or silently never reaches the server.
- ⚠️ syncCardJobIds → appendDurableResults ordering inside pollAndInjectResults: without the genJobId patch the in-memory GEN_CARD keeps genJobId=null, hasWorkingJob stays false, the poll never arms, and paid results never appear in the open thread.
- ⚠️ useCanvasGen spend kickoffs: the idempotencyKey is minted per click (`img-${Date.now()}`), so any silent failure path (gate error, node-create loss) that leaves the user staring at nothing converts a re-click into a second real charge — the fail()/createNodeWithRetry guards are the only thing standing between UI polish changes and double-spend (F18/F19/F20 lineage).

## Otto 包(skill 框架、registry、instructions、run-state)

### 必查清单
- [ ] 3-field honesty: cost/effect/reach must describe what execute ACTUALLY does (describeRefs is 'write' because of prisma.entity.updateMany — F38 precedent); any skill whose execute writes DB or calls an external port with side effects cannot be 'read'/'internal'. Check the derived gate: spend OR write+external ⇒ needsApproval true, and needsApproval stays a derived literal boolean — reject any hand-set needsApproval, predicate, or numeric form.
- [ ] Spend skills: the factory's idempotencyKey declaration is DOCUMENTATION ONLY (never invoked). A new/changed spend skill must implement the exactly-once check inside execute (any-status lookup BEFORE spending) AND be backed by a partial-unique DB index (pattern: generate.ts step 3 + GenJob_cowork_idempotency_once). Spend must route through an injected ctx port (startGen), never fal/reserveCredits/GenJob-insert directly.
- [ ] Identity & scoping: no orgId/ownerId/userId in parameters (factory throws — but also reject synonyms like accountId/tenantId that would let the model steer scope); every Prisma query in execute is scoped by ctx.orgId, and card/thread skills recheck threadId===ctx.threadId and projectId===ctx.projectId (generate.ts step 2 pattern). Model input must never carry model/price/params that override a persisted card (anti-flip: generate input is {cardId} only, overrides:undefined).
- [ ] Fence: no imports of @fikirtive/generation, reserveCredits, meta-graph/metaGraphPost in skills/ (CI hard-fails via scripts/check-skill-imports.sh). If the PR introduces a NEW spend-capable package or client, the fence blocklist must be EXTENDED in the same PR — it does not auto-cover new names. New direct @fikirtive/db use is warn-only: push back toward a ctx read-port.
- [ ] New external capability = new port on OttoContext with STRUCTURALLY re-declared types (packages/otto must never import from apps/web), injected in apps/web/lib/otto-actions.ts:buildOttoContext; explicitly decide the worker side — apps/worker/src/otto-resume.ts must NOT gain startGen. A verdict turn can incur its metered LLM cost, but it must not initiate a separate media/provider generation without the applicable user approval; any new worker port needs the same unattended-effect reasoning.
- [ ] Registration hygiene, all six spots: 1-line entry in registry.ts allSkills (order = tool order), registry.test.ts exact-name-list updated, gate assertion in migration.test.ts (cost/effect/needsApproval), CATALOG.md regenerated (catalog:check IS in CI — ci.yml runs it; a stale CATALOG.md fails the build), an instructions.ts 'When to call X' section for any model-facing skill, and the Parity Manifest entry.
- [ ] requires (资讯门): every requires.field exists in the parameters shape (factory throws otherwise) and is optional in the zod schema (else the SDK rejects the call before the friendly needMoreInfo preflight can fire); note the preflight only catches undefined/null/empty-string — a model passing 'n/a' sails through, so questions must teach the model to fill real answers.
- [ ] Prompt authority (decision 6): if a PR adds a prompt skill for a new model family, it must add the {skill, family} pair to PROMPT_SKILLS in the same PR, and verify BOTH spend surfaces skip the legacy directive for that family (cowork-actions.ts:578 button path; Otto generate.ts uses the card prompt raw). Never let a directive stack on a skilled family, and never let prompt-skill changes touch spend/safety fields.
- [ ] Instructions/description discipline: skill descriptions are model-facing — don't hand-append the requires questions (the factory does it; duplication = double prompts); prompt-text rules (English structuredPrompt, desiredDuration/Aspect/Audio on propose not in prompt, no invented ids) live in instructions.ts which is an INLINED TS constant — reject any readFileSync/runtime-file approach (breaks Next/Turbopack).
- [ ] Run-state safety: any change near run assembly keeps the invariants — fresh system message per turn + sanitizeHistory drops persisted system messages and input_image parts (bounded ottoState growth, F25); no naive token truncation (splits tool_call/tool_result pairs); RunState restore stays behind tryRestoreRunState (null = start fresh, never throw — F24, or every existing thread bricks on an SDK schema bump).
- [ ] LLM metering: Otto turn call sites must stay wrapped in withLlmBudget with maxSteps=OTTO_MAX_STEPS (10) and model=OTTO_DEFAULT_MODEL; 529 failover must remain structured-only in isOverloadError (no text matching) and same-tier (pricing lookup correctness).
- [ ] Compat surface: index.ts re-exports run/RunState from @openai/agents so web and worker share one SDK instance — a skill PR must not import the SDK separately in apps/*; bare-tool exports (export const x = xSkill.tool) are load-bearing for existing tests and web imports.

### 最脆弱的点(动了必红灯细看)
- ⚠️ generate.ts step 3 + GenJob_cowork_idempotency_once: the ONLY re-charge protection for Otto spend (Phase 0 proved SDK approval is not exactly-once). Any refactor that reorders the findFirst after startGen, narrows it by status, or changes the `cowork:${cardId}` key shape silently re-opens double-charging; the factory's idempotencyKey declaration would still pass, giving false confidence.
- ⚠️ skill.ts idempotencyKey is declaration-only — a brand-new cost:'spend' skill can satisfy defineOttoSkill's #4 check while having ZERO runtime exactly-once guard. The factory cannot enforce inside-execute behavior (#5/#6); only review + tests catch it.
- ⚠️ scripts/check-skill-imports.sh is a static grep blocklist (fal, reserveCredits, meta-graph/metaGraphPost). A new provider package (e.g. the BytePlus client) or a renamed spend function passes the fence untouched; direct Prisma in skills is warn-only, so a skill can write ANY owner's rows if it forgets the ctx.orgId where-clause — nothing structural stops it.
- ⚠️ Worker context asymmetry (apps/worker/src/otto-resume.ts): safety rests on startGen simply not being injected. There is no type-level or fence-level guard — one 'helpful' injection of startGen into the worker ctx creates an unattended spend path with no human in the loop.
- ⚠️ tryRestoreRunState / sanitizeHistory pair: an @openai/agents version bump can change RunState serialization — fromString throwing outside the wrapper bricks every existing thread; and any 'optimization' that truncates history items can split tool_call/tool_result pairs and break resumed runs (explicitly deferred, comment in run-input.ts).
- ⚠️ requires preflight only checks null/empty-trimmed-string, and requires fields must be optional in the zod schema — marking a required-info field as z.string() (non-optional) makes the SDK hard-fail the call before the needMoreInfo path fires, degrading 刨根问底 into raw tool errors. (CATALOG.md freshness IS CI-enforced — ci.yml runs catalog:check; corrected 2026-07-04, this line previously said it was not.)

## 钱路核心(ledger、定价、genRequest 闸、provider 边界)

### 必查清单
- [ ] Every reserveCredits sits in the SAME $transaction as its job insert, and every settleCredits/refundReservation in the same tx as the status write it finalizes — a finalizer outside the status tx, or a status write outside the finalizer tx, is a reject.
- [ ] settle/refund amounts are read FROM the RESERVE ledger row, never recomputed from pricing functions; any diff that recomputes the charge at finalize time (or passes a cost into settle/refund) breaks the in-flight price-drift immunity.
- [ ] Ledger writers use createMany({skipDuplicates:true}) with count===0 → return-before-account-mutation; NEVER try/catch a P2002 inside a PG transaction (aborts the whole tx and silently rolls back the caller's status write).
- [ ] Charge is pricedGenCredits/pricedRefgenCredits (internal credits, ×INTERNAL_PER_DISPLAY); genSpentUsd/refgenSpentUsd/GEN_PRICE_USD_PER_IMAGE/videoPriceUsd are RECORD-ONLY COGS — any diff that feeds a *SpentUsd value into reserve/settle/gate logic, or displayCredits back into the ledger, is a reject.
- [ ] Any new spendable request field or model must be validated in genRequest's .strict() schema + superRefine BEFORE persist/enqueue (model ∈ kind menu, controls ∈ GEN_VIDEO_MODEL_OPTIONS, tail ⇒ model.tail, count ≤ maxCount); a value the provider would reject or upgrade must never reach the worker. idempotencyKey stays REQUIRED.
- [ ] New-model diffs touch THREE tables in lockstep: GEN_VIDEO_MODELS + GEN_VIDEO_MODEL_INFO + GEN_VIDEO_MODEL_OPTIONS (core/gen.ts) AND VIDEO_CFG (generation/index.ts) or the BytePlus MODEL_MAPs — and if flat-priced, FLAT_PRICED_VIDEO_MODELS + VIDEO_CREDITS_BY_RESOLUTION; a model in the menu with no provider mapping fails pre-spend (OK), a mapping with no menu entry is dead; a BytePlus model NOT in FLAT_PRICED_VIDEO_MODELS silently charges by fal USD rates.
- [ ] Provider error discipline: failures before the billed POST/submit throw PLAIN Errors (worker retries); any failure after res.ok / task-created throws chargedError (worker terminal-fails + sets spent) — verify every new fetch/parse/download inside a provider is on the correct side of that line.
- [ ] Partial-unique index changes: predicates must stay IMMUTABLE (no ::text enum casts), GenJob_active_idempotency_key stays active-only while GenJob_cowork_idempotency_once stays all-status LIKE 'cowork:%', and the startGen P2002 recovery lookup must mirror the index it catches (cowork = any status, general = QUEUED/GENERATING).
- [ ] **Credits 账道**的 money-in 只有 grantCredits/grantCreditsTx(ledger-row-first、稳定幂等键 stripe:<session.id>/signup:<orgId>/admin keys;Stripe handler 除坏签名外一律 200、按 session id 去重;负数只走 ADJUST 条件递减)。**第二账道(通道费,宪法 5)是独立合法 money 面**:与 CreditLedger **零共享表/actions/finalizer**(grep 级隔离);任何把通道费写进 CreditLedger 的 diff = reject;审 P2 第二账道 diff 时逐条对 harmony-05 五条安全律(幂等键/行先行/事件后记账/fail-closed/互斥索引)+ 报价卡两账道分行列示 + **动工前先扩 money-safety-review Step-1 符号范围**(已写入该 skill 前瞻义务)。
- [ ] Refunds only fire when the caller's guarded status flip WON (updateMany count>0 on QUEUED/stale predicate); and post-enqueue bookkeeping failures (queueJobId persist) must stay best-effort — never refund a job a worker will still run.
- [ ] pg-boss queue policy edits keep retryDelay>0 alongside retryBackoff and expireInSeconds > the longest provider call (BytePlus 15-min poll + persist headroom < 20 min); shrinking expire or the poll-timeout ordering re-opens the expired-redelivery double-spend/false-FAIL window.
- [ ] Anything touching packages/db/src/credits.ts, the finalizer indexes, or worker settle/refund ordering triggers the money-safety-review skill and the founder's ask-before-spend rule for verification runs.

### 最脆弱的点(动了必红灯细看)
- ⚠️ packages/db/src/credits.ts settleCredits/refundReservation — the createMany(skipDuplicates) idiom: 'fixing' it to try/catch or plain create aborts the enclosing PG tx on conflict, rolling back the worker's DONE/FAILED write → retry → double-spend. The comment block is load-bearing.
- ⚠️ CreditLedger_finalizer_once + CreditLedger_ref_kind_once (20260619130000_credits migration, hand-written SQL Prisma can't express) — schema.prisma does NOT declare them, so any `prisma migrate dev --create-only` regeneration or db-push workflow can silently drop the only DB-level settle/refund mutual exclusion.
- ⚠️ The flat-vs-USD video pricing fork in spend.ts pricedGenCredits: seedance-2-fast charges from VIDEO_CREDITS_BY_RESOLUTION (resolution read from job.videoOptions, default '720p', unknown → 16) while every other model charges displayedFromUsd(genSpentUsd) — adding a BytePlus model without updating FLAT_PRICED_VIDEO_MODELS, or a resolution key mismatch, misprices silently in a paying path.
- ⚠️ generation/src/index.ts + byteplus.ts pre-charge vs chargedError boundary — one misplaced throw (e.g. plain Error after res.ok, or chargedError before the POST) converts retries into double-billing or single transient failures into terminal user-visible FAILs; BytePlus durationUnit 'num' and the single-string-vs-array `image` field are spend-test-verified shapes with 'don't fix without re-testing' warnings.
- ⚠️ startGen's P2002 recovery in gen-actions.ts (:139-155 region) — the cowork-key any-status vs general-key active-only branch must mirror the two GenJob indexes exactly; simplifying either branch reintroduces the exactly-once-ever TOCTOU (cowork) or masks unrelated unique violations (general).
- ⚠️ Worktree ≠ origin/main in exactly these money files (core/gen.ts, refgen.ts, generation/index.ts, byteplus.ts, schema.prisma + two 20260702 migrations, worker gen.ts) — post-#99 reviews reading the stale worktree will miss referenceVideoGenerationId and the fal refVideoUrl rejection; always diff against origin/main.

## Storage / DB(schema、裸 SQL 索引、内容寻址、D19)

### 必查清单
- [ ] New owner-scoped model = 4 things or reject: `ownerId String` + Organization @relation + the matching back-relation added on Organization + a leading (ownerId, …, deletedAt) index; ownerId must have NO default (drop_owner_default is policy) and every insert path must get it from requireOwner(), never FOUNDER_OWNER_ID.
- [ ] Soft-delete is an explicit decision: if the model has deletedAt, every list index and every uniqueness constraint must account for it (partial WHERE deletedAt IS NULL); if it hard-deletes (CanvasNode precedent), the PR must say why.
- [ ] Any uniqueness over nullable or soft-deletable columns goes in raw migration.sql as a partial/expression index (Prisma can't express it) with: IMMUTABLE predicate (enum compared to its own labels — reject `::text` casts; LIKE-constant and COALESCE(text) ok), `IF NOT EXISTS`, a schema.prisma comment pointing at the migration, and app code that catches P2002 with defined reuse/retry semantics.
- [ ] Drift check on every migration PR: `prisma migrate dev`/`diff` cannot see the 10 raw indexes — verify no generated migration DROPs one; if a constraint IS expressible in Prisma, model it with `map:` (MetaActionExecution_step_once precedent), and keep schema onDelete in sync with hand-written FKs (MetaConnection Cascade precedent).
- [ ] Untouchables — treat any diff on these as a money/data-loss incident: FOUNDER_OWNER_ID literal, Asset @@unique([ownerId, contentHash]), GenJob_active_idempotency_key, GenJob_cowork_idempotency_once, RefGenJob_active_entity_variant_key, CreditLedger_ref_kind_once + CreditLedger_finalizer_once, Generation_shot_version_live.
- [ ] Storage keys only via storageKey()/parseStorageKey(); the DB stores contentHash, never bucket paths; keys are built server-side from the resolved ownerId (client never names a key); any new blob-serving or key-resolving path calls keyOwnerMatches() and returns 404 (not 403) on mismatch.
- [ ] D19 on any new upload/import path: claimed size gets a finalize sizeOf() re-check, claimed hash gets the worker sha256Stream re-verify; readStream failures must THROW (queue retry), only a CONFIRMED mismatch may deleteObject; never deleteObject a hash that live Asset rows still reference (finalize's `reclaimable` guard).
- [ ] Presign discipline: presignedPut keeps ContentType + ContentLength + IfNoneMatch:"*" inside the signature; signPart signs the exact part length; completeMultipart keeps IfNoneMatch and treats 412 as abort+success; presignedGet keeps private/no-store + pinned ResponseContentType + attachment-for-non-renderables; presigned URLs never logged, never cached, redirects carry no-store + no-referrer.
- [ ] /files route: preserve the gate ORDER (allowlist → requireOwner → keyOwnerMatches → parse), Range/206 in the local path (Safari video), and the 1h presigned TTL rationale (F41) — shortening it re-breaks long-video playback.
- [ ] Generation rows are immutable outside the whitelist {shotId, version, attachedAt, deletedAt, favorite}; entitySnapshot is always written (empty = {"entities":[]}); attach paths must retry on Generation_shot_version_live P2002.
- [ ] Job tables follow row-before-dispatch (persist the DB row before pg-boss send) and carry @@index([status, updatedAt]) for the reaper; spent/spentUsd are records, never spend predicates.
- [ ] Migration hygiene: timestamped dir; additive-first (nullable soft-ref columns without FK is the established v1 pattern); seed/backfill BEFORE constraint creation; hand-written DDL idempotent; if a migration adds a devDep, pnpm-lock.yaml must be regenerated (worker Docker builds break otherwise).

### 最脆弱的点(动了必红灯细看)
- ⚠️ FOUNDER_OWNER_ID = "founder" (packages/core/src/storage-key.ts) is triple-baked: every existing R2 key namespace, the seeded Organization.id, and all legacy ownerId rows — changing it orphans every stored blob; a test pins it but only against the constant, not the DB seed.
- ⚠️ The 10 raw-SQL partial/expression indexes are invisible to prisma migrate diff — a routine `migrate dev` on an unrelated model can emit a DROP for one of them, and five of those indexes ARE the exactly-once money semantics (GenJob/RefGenJob dedup, CreditLedger settle/refund).
- ⚠️ Index-predicate immutability trap: writing `status::text IN (...)` in a partial-index predicate fails at apply time (enum ::text cast is not IMMUTABLE) — the working migrations compare the enum to its own labels; a well-meaning 'cleanup' rewrite breaks the migration on fresh databases.
- ⚠️ deleteObject on a content-addressed key can destroy bytes shared by OTHER rows (dedup means many Assets/Generations per hash across time): the finalize `reclaimable` guard (mode!=="existed" AND zero live Asset rows) and ingest's throw-on-read-failure / delete-only-on-confirmed-mismatch rules are load-bearing security, not best-effort cleanup.
- ⚠️ ChatThread deliberately has NO prisma @@index — the raw partial ChatThread_project_live_idx is the only list index; adding a 'missing' @@index creates duplicate-index drift, and dropping the partial silently kills thread-list performance while `prisma validate` stays green.
- ⚠️ The D21 sweep queue exists (QUEUES.sweep, created in apps/worker/src/index.ts) with NO handler — anyone implementing it must delete blobs only and keep Asset rows as tombstones (Generation FK Restrict makes row deletion impossible by design); a naive implementation that deletes rows or ignores Entity.baseAssetId protection corrupts provenance and live entities.



---

# 增补(2026-07-03 对齐审查,随宪法 v2.1 生效)

> 基线注:本手册主体测绘于 main #99;宪法与拍板会(2026-07-03)晚于它。以下增补条款优先于上文旧条款。

## 审查协议增补
- **双模两问(宪法 7,判例:报表引擎 Otto 替代案被 founder 否决)**:任何新功能面 (a) 人工不靠 Otto 能否完整操作?(b) 人工可见的数据面有没有对应 free/read skill 或明示豁免?任一为否 = 挡。
- **第九缝(Parity Manifest)**:新 server action / 新页面数据读取 → 必须在 parity-manifest 登记(配对 skill 或四类封闭豁免:ADMIN/VISUAL/MONEY_IN/ACCOUNT_SECURITY;新增豁免类 = 修宪);manifest 保持纯字面量;check-parity.sh warn→hard 阶段状态要核;viewContext(上下文桥)server 侧一律 ownerId 复核。
- **协议 #4 扩为两关**:UI 改动 = 浏览器 runtime QA **+ 设计审**(宪法 11:.gb 单一系统、基准 = Analytics 屏)。

## 钱路清单增补(定价规则,宪法 5)
- [ ] 任何新收费点/调价 diff 必附 costing 计算并过 **毛利率 ≥45% 地板**(口径 = (售价−成本)/售价;依据 harmony-04)
- [ ] 费率/价格字面量出现在 config 层之外 = reject;pricing/UI 文案出现 "unlimited" 类字样 = reject(宪法 8)。(解读边界:"config 层"= 集中定价模块 —— core/spend.ts 的定价表、档位 config 等;禁的是业务/UI 代码里散落的裸价数字;测试断言与文档示例不在此列)
- [ ] BytePlus 资源包余量告警工单(P1 必做)在包相关 diff 时核状态
- [ ] Search API(3x margin)走 withLlmBudget settle 的 search 项 —— 各费率各自 margin,不并轨;不做每次搜索弹审批

## Otto 包清单增补
- [ ] **效率良心(宪法 5 附则)**:触及 turn 循环/上下文组装/skill 步数的 diff,增查是否引入用户侧 token 浪费(冗余重发/臃肿上下文/多余步数)—— 是 = **缺陷级 reject**,不是"优化建议"。已知三工单勿重报:①prompt caching(前置:meter 补 cache_write 计量)②verdict 轮重发 base64 图 ③skill 确定性化
- [ ] **技能为弱模型设计(宪法 10)**:新 skill 的专业判断必须冻进确定性代码/schema/模板,不靠模型天赋(prompt-skills 范本)
- [ ] 注册处所从五处改**六处**:registry.ts / registry.test / migration.test / CATALOG.md(已入 CI catalog:check)/ instructions.ts / **Parity Manifest**

---

# 增补(2026-07-07,随宪法 v2.6 生效)

## Web 界面清单增补 —— live reflection(宪法 11 v2.6)
- [ ] 任何"后台状态会变化"的用户可见面(生成/发布/研究/Otto 写操作),diff 必须回答:界面如何**实时**得知变化?(推送、失效刷新、或有明确上限的短轮询)——"后台已完成而界面不知"按**缺陷级 reject**(参照 2026-07-07 吐槽清单头号痛点:生成 DONE 但卡片停在 On it)
- [ ] Otto 的写操作落到界面时必须走 coral 视觉语言(高亮 + 简短叙述),不得默默变更(O-12/v2.6 ③)
- [ ] 任何给 Otto 的新操作能力 = 动作层调用;出现"模拟点击/像素操作/DOM 驱动"类实现 = 违宪 v2.6 ②,一票否决

---

# 历史增补(2026-07-07 北极星原型流程;2026-07-16 降级)

> `docs/northstar/{PROGRAM,PAGE-INVENTORY,APPROVALS}.md` 现为历史设计证据,不再是作业队列、
> 双重批准真源或 current-status 台账。`APPROVALS.md` 为空,不能据此推导任何页面已批准。
> 当前 UIUX 范围与验收以 Blueprint、GitHub #334 的 Founder 决定和已对齐的 Route-B 计划为准。

## 当前审查用法

- [ ] 只有当前任务明确链接的北极星原型证据才进入该任务的设计基准;历史文件不能自行扩大 scope。
- [ ] UI/客户端改动仍需浏览器 runtime QA、当前 acceptance 对照和设计审;不能以历史原型状态替代当前证据。
- [ ] 产品代码与历史原型冲突时先按当前 authority 链核实;不得通过编辑空台账制造批准。
- [ ] 原型目录是否可改、谁可批、谁可合并,全部回到当前 GitHub task 和现行项目法判断。
