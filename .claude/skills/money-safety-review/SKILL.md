---
name: money-safety-review
description: Spend-path gate for Fikirtive. Use when a diff touches AI-generation spend — the typed genRequest gate, startGen, startRefGen, dispatchVariantJob/createVariant/regenerateVariant, coworkGenerate, idempotencyKey/dedup, partial-unique idempotency indexes, generation provider calls, the credit ledger, or Otto LLM metering. Auto-fire when reviewing or writing any change that could create or charge a paid job, write a money ledger, call a paid provider, or alter exactly-once dedup. Skip entirely for UI/CSS/docs/non-spend changes.
---

Real money is spent on AI generation (BytePlus/fal provider) and Otto LLM turns (Anthropic). This gate exists to keep the **spend path** exactly-once and single-authority. It is **not** a universal checklist — apply **proportional rigor**: max scrutiny on the spend path, nothing on everything else.

## Step 1 — Does this diff touch the spend path? (exit fast)

Known spend-path seams include the symbols and files below, plus the catch-all at the end. Verify the live diff and call graph rather than treating this navigation list as exhaustive authority:

- The typed gate `genRequest` (`packages/core/src/gen.ts`) and `genJobData`.
- The paid generation entrypoints: `coworkGenerate` → `startGen`; direct `startGen` (`apps/web/lib/gen-actions.ts`); `startRefGen` (`apps/web/lib/refgen-actions.ts`); and `dispatchVariantJob` / `createVariant` / `regenerateVariant` (`apps/web/lib/refgen-actions.ts`).
- `idempotencyKey` and the dedup machinery (the findFirst fast-path + P2002 backstop in any of the above).
- The partial-unique indexes: `GenJob_active_idempotency_key`, `GenJob_cowork_idempotency_once`, `RefGenJob_active_entity_variant_key` (in `packages/db/prisma/migrations/`).
- The generation **provider calls** inside `handleGen` (`apps/worker/src/jobs/gen.ts`) — `provider.generate` / `provider.generateVideo` — and the `spent`/`committed` flags and store/commit transaction around them. (`refgen.ts` has the same shape for the variant path.)
- The **provider implementations** themselves (`packages/generation/src/byteplus.ts` / fal path in `index.ts`) — the pre-charge vs chargedError boundary.
- **The ledger core**: `packages/db/src/credits.ts`(reserveCredits/settleCredits/refundReservation/grantCreditsTx)and the finalizer partial-unique indexes.
- **Otto LLM metering**: `packages/otto/src/meter.ts` (`withLlmBudget`) + `packages/core/src/llm-prices.ts` (margin/价格表) — every real Otto model turn is paid provider usage and must remain metered.
- **Reaper refund paths**: gen/refgen reapers + `apps/worker/src/jobs/llm-reservation-reaper.ts`(incl. its refId prefix allowlist).
- **The callers that reach those authorities**: `coworkGenerate`(`apps/web/lib/cowork-actions.ts`)、Otto resume/turn(`apps/web/lib/otto-actions.ts`)、Otto SSE 轮次(`apps/web/app/api/otto/stream/route.ts`)、research 轮次(`apps/worker/src/jobs/research.ts`)、Otto generate skill(`packages/otto/src/skills/generate.ts` 的 `ctx.startGen`)、批量编排与其 per-cell 幂等键(`apps/web/lib/factory-batch.ts`、`apps/web/lib/batch-idempotency.ts`、`apps/web/lib/campaign-generation-confirm.ts`)、以及直接调 `refundReservation` 的 `apps/web/lib/actions.ts`。它们本身不新开钱道,但改错一行就会改变「扣多少 / 扣几次」。
- **The prices the reserve is computed from**: `packages/core/src/spend.ts`(pricedGenCredits/pricedRefgenCredits/CREDITS_PER_USD)与 `packages/core/src/otto-budget.ts`(turnBudgetInternal —— `withLlmBudget` 的预留额)。
- **Otto 花费参数层(决定「收不收费 / 收多少 / 最多几轮」的那一层,不是调用点)**:`packages/otto/src/runtime.ts` 的 `ottoBudgetArgsFor`(推导每次 `withLlmBudget` 的 `paid` / `prices` / `maxSteps` —— 改一个比较符,要么全部付费轮次变免费,要么全部 fixture 轮次开始收费)、`packages/otto/src/model.ts` 的 `ottoModelRuntime`(冻结绑定 `billableModelId` 与 `pricing: llmPricesFor`)、`packages/otto/src/skills/propose-research.helpers.ts` 的 `researchTierBudgetInternal`(**该档预留额本身**)。
- **Research 一档的真实花费面**:`apps/worker/src/otto-resume.ts`(verdict 轮次是真付费调用,`refId = otto-verdict:<jobId>` 即幂等键)、`apps/web/lib/research-actions.ts`(余额预检 + `idempotencyKey = research:<cardId>`)、以及 `RESEARCH_QUEUE_POLICY` 真正落到队列的两处 `apps/worker/src/index.ts` 与 `apps/web/lib/queue.ts`(那里的 `retryLimit: 0` 就是「失败不重投 = 不二次扣费」)。
- **Catch-all(枚举防腐)**: ANY new outbound paid API call site, and ANY writer of CreditLedger or a future money ledger, is spend path — whether or not listed above.

**机器镜像(改一处必须改两处)**: `scripts/ci/check-money-path-review.mjs` 持有本 Step 1 文件清单的机器副本(`MONEY_PATH_FILES` 出钱侧 + `MONEY_IN_FILES` 进钱侧 + `MONEY_PATH_PREFIXES` 迁移),PR 命中清单时强制 PR 正文带 `[MONEY-SAFETY-REVIEWED: <reviewer> @ <head-sha>]`(token 绑 head sha,加 commit 即失效;清仗流程见该脚本 `stampInstructions`)。本表新增任何付费调用点或 ledger writer,必须在同一变更里同时更新那份清单,否则 CI 拦不住它。**那份清单是下限,不是定义**:它枚举不到的路径仍受本表 catch-all 与项目法第 3 条约束;反过来,gate 绿灯只证明「有人敲过章」,不证明复审真的做了(token 无认证,防的是遗忘不是故意)。

**Money-in note**: `grantCredits`/Stripe webhook diffs are guarded by REVIEWER-PLAYBOOK(admin-auth + money 清单), not this skill's checks — do not treat Step-1 NO as "money-in is unreviewed". 机器侧对应 `MONEY_IN_FILES`:`apps/web/app/api/stripe/webhook/route.ts`、`apps/web/lib/credit-actions.ts`、`apps/web/lib/tenant-actions.ts`、`apps/web/lib/auth-guard.ts`(signup `grantCreditsTx`)—— 命中时同样要 token,但复审依据是 `docs/review/REVIEWER-PLAYBOOK.md`,不是本 skill 的 (a)-(e)。

**前瞻义务**：任何新的付费调用点、预算执行、第二钱账道或 ledger writer 动工前，先在同一变更中扩本表、对应 machine fence 与 exactly-once tests；不得因旧枚举未列出而绕过 review。

**If NO — none of the above is in the diff — STOP. This skill does not apply. Exit immediately and defer to normal proportional review.** Do NOT money-gate UI, CSS, copy, docs, admin read-only pages, the $0 worker paths (render.ts, caption.ts, ffmpeg/whisper), or anything else that cannot reach the symbols above. No money-safety theater.

If YES, run every check below.

## Checks (run all when Step 1 is YES)

Each check ends on a concrete, checkable verdict. A single failed check blocks the change.

### (a) genRequest stays the sole GenJob validation gate; idempotencyKey stays REQUIRED
- `genRequest` is the only validator before a GenJob is created. No new code path may create/enqueue a GenJob bypassing `genRequest.safeParse` + its `.superRefine` + `checkCast`. The variant path (RefGenJob) is the documented exception — it has its own model/disable checks; it must not gain a way to spend on an unvalidated `(model, params)`.
- `genRequest.idempotencyKey` stays `z.string().min(1).max(80)` — **required, never `.optional()`/`.nullish()`**. A keyless request would bypass dedup and double-charge. Verdict: the field is still required and every caller passes a stable key (`frame:<shotId>:<slot>`, `animate:<shotId>`, `cowork:<cardId>`, or a per-click `newId()`).
- `.strict()` stays on `genRequest` (no silent extra fields), and any new video/param field is range-checked in the `.superRefine` against the model's option set before it can reach the worker.

### (b) the cowork propose path creates NO GenJob and never spends on media before approval
- The ONLY cowork media-generation spend is the user clicking Generate on a persisted card → `coworkGenerate` → `startGen`; the propose side (Otto turns / cards, `estimatedPriceUsd` display-only) must stay $0 on media. Otto's own LLM usage remains separately metered through `withLlmBudget`. Verdict: the diff adds no GenJob create, no `boss.send(GEN_QUEUE…)`, and no generation-provider call to the agent/turn/propose path.

### (c) new/changed spend is additive and cannot double-charge
- `coworkGenerate` re-spend guard intact: it reads any-status `GenJob` by `idempotencyKey: cowork:<cardId>` and returns the existing job; the race-proof backstop is the all-status unique index `GenJob_cowork_idempotency_once`. A card generates **at most once ever** — retry = a new card, never a silent re-charge.
- `startGen` / `startRefGen` / `dispatchVariantJob` keep the **findFirst(active)-then-create + catch P2002 → reuse in-flight job** pattern, backed by `GenJob_active_idempotency_key` / `RefGenJob_active_entity_variant_key`. A new spend path must replicate this, not invent a checkless create.
- Worker store-self-heal intact (`handleGen`, `apps/worker/src/jobs/gen.ts`): `spent` flips true the instant the paid call returns; after that a failure must NOT retry (the stale-`GENERATING` claim is failed closed: "not retrying, to avoid a double charge"). `committed` + the resume path (`generationIds` recorded) finish via attach+DONE without re-spending, and a wrongly-FAILED-but-committed job still resumes. Verdict: the diff preserves the QUEUED→GENERATING atomic claim, the `spent`-then-no-retry rule, and the resume short-circuit.

### (d) migrations additive-only
- Any new migration only ADDs (columns/indexes), never drops or rewrites a spend column or an idempotency index. New partial-unique indexes use `CREATE UNIQUE INDEX IF NOT EXISTS … WHERE …` (Prisma can't express the predicate; it lives in `migration.sql`). Verify every migration against a fresh test database and the current release procedure; repository text must not assume a live deployment topology.

### (e) independent adversarial re-gate before merge eligibility
- Require an independent cross-family review of the full spend diff, specifically hunting double-spend, fail-open behaviour, and bypasses. This review is evidence only: it does not grant merge, deployment, or spend authority, and direct pushes to `main` remain prohibited.

## Invocation

**Model-invoked** (this file keeps a `description`): it should auto-fire whenever a reviewed or in-progress diff touches the spend-path symbols above, so the gate can't be forgotten on the one change that can lose money. It is also user-invokable by name. The Step-1 fast exit is what keeps the always-loaded description cheap in practice — on a non-spend diff the skill returns in one step.
