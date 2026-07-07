# Otto → OpenAI Agents SDK Migration — Design

Status: **DRAFT v2 for review** · Date: 2026-06-22 · Supersedes the earlier "migrate Otto to Vercel EVE" plan.

> Companion refs: [`docs/ops/config-and-architecture.md`](../../ops/config-and-architecture.md) · [`docs/architecture/codebase-audit-2026-06-22.md`](../../architecture/codebase-audit-2026-06-22.md).
> **v2 integrates three reviews (2026-06-22):** a 3-agent adversarial verification, a Codex review against the real money code (4 P1 findings), and `/plan-eng-review`. The biggest change from v1: **Otto-LLM spend is metered via reserve→settle (like GEN), not a post-paid debit** — this closes a provider-paid-before-debit bypass Codex found.

---

## 决策摘要 (TL;DR, 中文)

把 Otto 的"大脑"从手搓管线换成 **OpenAI Agents SDK**(一个库,放进**两端都能 import 的共享包**,跑在现有 Railway 上,**不迁 Vercel**)。Otto 变**完全 agentic**(多步、可调工具、`otto/` 文件夹随手加 skill/tool)。

**钱:所有花到付费 API 的(出图/视频 + Otto 自己的 LLM 调用 + `enhancePrompt`/`draftStoryboard` 等所有 LLM 入口)统一计入 credit。** 显示 1 USD = 10 credit;**内部账本 1 credit = $0.01**,运算走内部单位。**Otto-LLM 用"预留→结算"**(像 GEN 那样:**调用前先 reserve 一笔 turn 预算**=原子、永不为负、reserve 失败就不调用 provider;**turn 结束按实 settle + 退差额**)。花钱的 `generate` 走 `needsApproval` 人工闸 + 5 道防线。

**钱机器有三处必改、都过 `money-safety-review`**:(A) 给 credits 加**变额结算**(settle ≤ reserved、释放余量)以支撑 Otto-LLM 的 reserve→settle;(B) 改名时**幂等索引谓词**(写死 `LIKE 'cowork:%'`)随之迁移;(C) **把所有付费 LLM 入口都包进计费**(否则退役 R1 = 留绕过口)。GEN 的 reserve/settle/refund、worker、`genRequest`、fal 仍不动。

**出图后 Otto 自动回灌一轮**(在 **worker** 里跑,因为 gen job 本就在 worker durable 完成),**自然地问用户 verdict**("这版可以吗 / 要改什么")——不是推销式上钩,顺带收集反馈。

**直接上 prod、不留 legacy**,切换前过本地 QA(mock provider 零花钱)+ money-safety-review + Codex;出问题 `git revert`(钱机器没动,爆炸半径只在"Otto 聊天")。`cowork→otto` 全面改名 + 退役 R1,**放最后一步**。

---

## 1. Goals & non-goals

**Goals**
- Replace the hand-rolled Otto brain (`coworkTurn` → `cowork-planner` JSON prompt → `cowork-transport` → `suggestModel`) with a native multi-step tool-calling agent.
- Make Otto **fully agentic** and **extensible by dropping files** (`otto/tools/*.ts`, `otto/skills/*.md`).
- **Meter ALL paid-API spend (generation + every LLM entrypoint) into the credits ledger** with a tunable per-category margin, retiring R1 by making credits the single universal cap.
- Preserve every money-safety invariant; change the money machine only in the three explicit, gated ways in §11.
- Auto-resume: after a generation finishes, Otto runs one follow-up turn that asks the user a plain verdict question (feedback capture).
- Full `cowork → otto` rename; the word "planner" is retired.
- Stay on Railway + Neon + Cloudflare R2 + pg-boss.

**Non-goals (deferred / out of scope)**
- Changing the GEN reserve/settle/refund path, the worker `gen.ts`, the `genRequest` zod gate, or the fal wiring (these stay byte-for-byte; the three §11 changes are NOT these).
- Migrating hosting to Vercel; Vercel EVE.
- The platform multi-tenancy overhaul (separate DEFERRED track); here we only ensure Otto derives the tenant from the verified session and scopes correctly.
- The admin-dashboard margin-tuning UI (it's the OPT-6 dashboard's job; this spec consumes the margin config, doesn't build the UI).
- Inline-blocking generation (Otto never holds a turn open on fal latency; the result arrives async and triggers a fresh turn — §8).

---

## 2. Why OpenAI Agents SDK (and why not EVE / Vercel)

| Constraint | OpenAI Agents SDK (chosen) | Vercel EVE (rejected) |
|---|---|---|
| Self-host on Railway/Neon | Plain npm library in our Node processes | Compiles to Vercel Functions; off-Vercel needs `@workflow/world-postgres` ("reference implementation", beta, graphile-worker LISTEN/NOTIFY risky on Neon's pooled endpoint) |
| Money path external | `RunState` serialize/deserialize persisted in **our** Postgres; no framework-owned durable backend | Vercel Workflow owns durability |
| Durable propose-only gate | per-tool `needsApproval` | `needsApproval`, bundled with Vercel lock-in |
| Maturity / Node | Stable library; Node floor **exactly 22** (we run node:22) | Beta (`eve@0.12.0`), hard Node 24 floor |
| Lock-in | Minimal | High (5 Vercel-proprietary services) |

The user's draw to EVE was filesystem-first authoring. We reproduce it with our own `otto/` folder convention plus one explicit ~10-line assembly file. **Caveat:** `@openai/agents`, `@openai/agents-extensions`, and `@ai-sdk/anthropic` are **not yet in the repo** (today's LLM goes through fal/OpenRouter via `cowork-transport.ts`); adding them — and the Anthropic AI-SDK adapter, which is **beta** — is part of the work and a Phase-0 spike target.

---

## 3. Architecture

Two halves with a hard line between them:

- **Brain (new):** Otto = an OpenAI Agents SDK `Agent`, defined in a **shared package** (e.g. `@fikirtive/otto`) so **both `apps/web` (interactive turns) and `apps/worker` (auto-resume turns, §8) can import it**. Conversation state (`RunState`) is serialized into **our Neon Postgres**, mapped onto `ChatThread`/`ChatMessage`.
- **Money machine (mostly unchanged — see §11):** `startGen` → `genRequest` zod gate → `reserveCredits` (atomic, never-negative) + `GenJob` insert **in one $transaction**; `boss.send(GEN_QUEUE)` is a **separate post-commit step** (not in the tx) → the pg-boss worker (`apps/worker/src/jobs/gen.ts`) calls fal, stores to R2, `settleCredits`. Exactly-once via a stable idempotency key + a partial-unique index (§5 #3).

**Identity:** the ledger and ownership are keyed by **`orgId`** (+ `refId`), not `ownerId`; today they coincide via org-as-tenant (`ownerId === orgId`; the worker calls `settleCredits(tx, { orgId: job.ownerId, refId: job.id })`). Otto's tools pass `orgId = the session's org`. There is **no `ctx.session` in the codebase today**; tenant identity is resolved by `requireOwner()`/`auth()` (`apps/web/lib/auth-guard.ts`). The Otto tool wrapper bridges the verified next-auth session into the SDK run context; "`ctx.session`" below means that bridged value, to be built.

**Where the loop runs:** the multi-step Otto loop runs inside a Next.js route handler (streaming). A `needsApproval` pause or a `maxTurns` boundary **ends the request** and persists RunState; a later request (or the worker, §8) resumes from the serialized state. No request is held open for minutes. Node 22 retained (SDK floor is exactly 22; `node:22-trixie-slim` satisfies it — a check, not a spike).

---

## 4. The agent: folder layout & extensibility

```
packages/otto/               # shared: imported by apps/web AND apps/worker
├─ otto.ts                   # assembly: model + tool list (~10 lines, the whole map of Otto)
├─ instructions.md           # Otto's standing identity + rules (today's COWORK_PLANNER_SYSTEM, minus JSON-envelope plumbing)
├─ tools/
│  ├─ propose.ts             # build a generation card ($0 GEN, no approval)
│  ├─ generate.ts            # the spend tool (needsApproval)
│  └─ …                      # future capabilities = drop a file here
├─ skills/                   # on-demand procedures, one .md per skill
└─ persistence.ts            # serialize/restore RunState ↔ our Postgres (ChatThread)
```

Adding a capability = drop a file in `tools/` or `skills/`. All symbols use the `otto` name; **no `planner` or `cowork` symbol** remains after Phase 3.

---

## 5. Tools & the spend gate (5 guardrails)

**`propose` tool** — no `needsApproval`. Builds/persists a `GEN_CARD` with a **display-only** estimated price; re-derives the model server-side via `suggestModel`; calls no media-gen action. $0 GEN.

**`generate` tool** — `needsApproval: true` (the SDK accepts `true` or an async `() => boolean`; **no SDK `always()` helper** — use literal `true` or a local `const always = () => true`; **never a numeric `?? 0` predicate**, which fails open). Input is **only a `cardId`**. Its `execute` builds a **minimal, server-derived `genRequest` from the persisted card** (it does NOT call `coworkGenerate` raw — that path accepts client overrides; the tool must reload kind/model/params server-side) and calls the unchanged `startGen` with the stable idempotency key, enqueues the pg-boss job, returns immediately.

Defense in depth:

1. **Human gate** — `needsApproval: true`. The approval **is bound to the exact `(cardId, payload-hash)` shown to the user** and rejected if `execute` resumes with a different `cardId` (prevents card-substitution between proposal and approval). Human gate only; exactly-once is #3.
2. **Ledger backstop (two mechanics, do not conflate):**
   - *GEN spend:* `reserveCredits` — atomic conditional decrement inside the job-insert tx; never-negative; **unchanged**.
   - *Otto-LLM spend:* **reserve→settle** (§6) — reserve a turn budget BEFORE any model call (atomic, never-negative, provider never paid if the reserve fails), settle actual + release remainder after. Same never-negative strength as GEN.
3. **Idempotency (exactly-once, independent of the human gate)** — a **stable** key minted with the card (not inside `execute`). Two partial-unique `GenJob` indexes exist: `GenJob_active_idempotency_key` (`status IN ('QUEUED','GENERATING')`) and `GenJob_cowork_idempotency_once` (**all-status, but `idempotencyKey LIKE 'cowork:%'`**). The all-status guarantee is **prefix-scoped**. Because the `generate` tool admits **any owned `cardId`** the model references, this index is the **only** thing preventing re-charge of an already-generated owned card → its correctness across the rename is load-bearing and gated (§9), **not deferrable**.
4. **Server-derived params for a user-confirmed card** — `execute` reloads kind/model/params from the persisted card; it ignores spend params in tool args. **Anti-flip** (no image→video to inflate cost) is owned by this card-reload; `genRequest`'s `superRefine` is the **secondary** shape/coherence validator (model-belongs-to-kind, valid video options, count ≤ max), not the anti-flip mechanism.
5. **Tenant scope** — tenant comes from the verified next-auth session (`requireOwner()`/`auth()` today, bridged as `ctx.session`), never from tool args/body. Every tool re-derives it and passes `orgId` to the ledger.

---

## 6. Credit model (unified, reserve→settle)

**Every paid-API action charges credits** — generation (fal) AND **every LLM entrypoint**: the Otto turn-model, `enhancePrompt`, `coworkDraftStoryboard`, and any other paid LLM call (Codex flagged these as current ledger-bypasses gated only by R1). The credits ledger is the single universal cap; this is the resolution of R1. **R1 cannot be retired until all these entrypoints are metered (§11 C).**

**Units (two — do not conflate):** display 1 USD = 10 credits ($0.10 each, user-facing); **internal ledger 1 internal credit = $0.01** (`CREDITS_PER_USD = 100`, `INTERNAL_PER_DISPLAY = 10`, per `packages/core/src/spend.ts`). All balance math/debits in internal credits; UI rounds to display via `displayedFromUsd()`.

**Margin** = markup on underlying API cost → credits, tunable per category (Otto-LLM, image, video) in the admin dashboard (OPT-6). The 10:1 display ratio is fixed; the margin is the knob.

**Two metering mechanics:**
- **Generation (cost known upfront):** `estimate → reserve → settle` in internal credits, exactly as today. Unchanged.
- **Otto-LLM (cost known only after the call) → reserve→settle, NOT post-paid debit.** (v1 used post-paid debit; Codex showed that pays the provider before debiting, so a concurrent consumer can make the debit fail after we've already paid. Reserve-before-call fixes it.)
  - **Reserve a turn budget BEFORE the turn runs:** `turnBudget = maxStepsPerTurn × oneStepFloor` (internal credits), via the atomic conditional-decrement `reserveCredits` (`WHERE balance >= cost`). If the org can't afford the budget, the turn never starts (Otto says "out of credits") and **no model call is made** → provider never paid without coverage.
  - **Settle actual after the turn:** read actual usage (sum `requestUsageEntries` from the run result — per-request token entries are exposed, not only the run aggregate), convert with margin to internal credits, **settle the actual and release `turnBudget − actual` back to balance.** This needs the one new ledger capability: **variable settle** (settle ≤ reserved, release the remainder) — §11 A.
  - **Floor formula (internal credits):**
    ```
    oneStepMaxUsd = contextCap(tokens) × inputPrice + outputCap(tokens) × outputPrice
    oneStepFloor  = ceil( oneStepMaxUsd × margin / 0.01 )
    turnBudget    = maxStepsPerTurn × oneStepFloor
    ```
    `contextCap`/`outputCap`/`maxStepsPerTurn` are config (we set the model call's `max_tokens = outputCap`, and compaction keeps input ≤ `contextCap`, so actual ≤ floor by construction — the reserve is a true upper bound); `inputPrice`/`outputPrice` from the model registry; `margin` from the dashboard.
  - **Never-negative under concurrency:** the reserve is a single atomic conditional decrement (same primitive that makes GEN safe), so two concurrent turns in one org can't both pass — the second reserve fails and that turn waits / declines.
  - **Granularity (spike/tuning):** per-turn reserve is the default; per-step reserve (smaller holds, more DB ops) is a tuning option the spike can evaluate.
  - **Runaway cap:** `maxStepsPerTurn` is the SDK's **`maxTurns`** run option (default 10); `MaxTurnsExceededError` is caught and surfaced as the §10 graceful degrade.

---

## 7. Multi-tenancy & identity

Tenant derived **only** from the verified next-auth session (`requireOwner()`/`auth()` today; bridged into the SDK run context). Every tool re-derives it and scopes every query; passes `orgId` (= `ownerId` under org-as-tenant) + a stable `refId` to the ledger. Never trust model output / request body for identity. (Broader platform multi-tenancy is a separate DEFERRED track.)

## 8. Auto-resume after a generation (runs in the worker)

Otto reacts to a finished generation without blocking a turn:

- `generate.execute` enqueues the pg-boss job and returns `{ genJobId, status: "queued" }`; the turn ends.
- When the **worker** finishes the gen job (settles credits, writes `GEN_RESULT` as today), it then **runs one Otto follow-up turn in-process** — it imports `@fikirtive/otto`, loads the thread's `RunState`, injects the result, and Otto produces a **plain verdict-asking message** ("这版符合你的预期吗?有什么要改的?" — a normal verdict prompt, **not** a salesy upsell), then persists RunState + the message. The user replies via the normal chat UI (web), which resumes the conversation.
- **Why the worker, not web:** the worker is already the durable (pg-boss) place where the gen job completes; running the resume there avoids web's request-scope problem and any cross-service HTTP. It works because the Otto agent lives in the shared `@fikirtive/otto` package the worker can import. The worker therefore needs `ANTHROPIC_API_KEY` + DB access (it has DB; add the model key).
- **Resume needs the live agent:** `RunState.fromString(agent, str)` requires rebuilding the identical agent graph — satisfied by importing `@fikirtive/otto` in the worker.
- This verdict turn is itself an Otto-LLM call → it reserves→settles credits like any turn (§6).

## 9. Naming migration (`cowork → otto`) — gated, last

- **New code is `otto`** (`packages/otto`, `otto-*`); `planner` does not appear.
- Surviving symbols (`coworkGenerate`, …), DB columns (`coworkBrief`), `ActionEvent type='cowork.turn'`, audit `via` are renamed.
- ⚠️ **The idempotency-key prefix `cowork:<cardId>` → `otto:<cardId>` is a MONEY-MACHINE change.** The all-status dedup index predicate is hardcoded `LIKE 'cowork:%'`; an `otto:`-keyed job falls outside it and silently loses exactly-once-ever. **Decision (resolves the v1 contradiction): keep `cowork:` keys through Phase 1/2** (existing index unchanged, zero gap); **do the prefix rename + index migration together in Phase 3**, in one money-safety-gated diff:
  1. Migration recreating `GenJob_cowork_idempotency_once` with a predicate covering `otto:%` **and** keeping `cowork:%` for historical rows (`LIKE 'otto:%' OR LIKE 'cowork:%'`, or two indexes).
  2. Update the `idempotencyKey.startsWith("cowork:")` branch in `startGen` (`gen-actions.ts:~141`) and the read guard (`cowork-actions.ts:~494`) in the same diff.
  3. Drain in-flight `cowork:` jobs before the cutover so dedup is never split.

## 10. Rollout — direct cutover, hard-gated (no legacy/shadow engine)

Blast radius of a brain bug is contained because the GEN money path is unchanged: worst case is "Otto chat misbehaves," recoverable by `git revert` + redeploy.

- **Phase 0 — Spike (go/no-go).** On the local QA stack: (a) `RunState` serialize → persist → rehydrate after a redeploy, AND **single-use** (an approved-then-rehydrated `generate` must NOT re-enter `execute` / is a no-op via the index); (b) the worker imports `@fikirtive/otto` and runs a resume turn (§8); (c) Anthropic via `@openai/agents-extensions` `aisdk(@ai-sdk/anthropic …)` (beta) works and per-request usage flows via `requestUsageEntries`; (d) the reserve→settle variable-settle ledger capability. Any failure → stop.
- **Phase 1 — Build + local QA.** Build `packages/otto`; add the variable-settle ledger capability + per-turn reserve→settle + the 5 guardrails; **wrap every paid-LLM entrypoint** (otto turn, `enhancePrompt`, `coworkDraftStoryboard`) in metering. **Keep `cowork:` idempotency keys** (no rename yet). Verify entirely on the local QA stack (docker postgres + worker + **mock provider = zero spend**): the test plan in §12.
- **Phase 2 — Cutover (hard gate).** (1) money-machine-touching diffs (variable settle, the generate tool, the metering wraps) pass **`money-safety-review` + Codex**; (2) push to `main` → Railway `NEEDS_APPROVAL`; (3) approve **web → worker**, then **verify live + hand-test one Otto round** (generation runs; GEN credits AND Otto-LLM credits reserve→settle correctly; balance never negative; auto-resume verdict turn fires); (4) on any problem, `git revert` + redeploy.
- **Phase 3 — Rename + retire R1.** Full `cowork → otto` rename; delete `cowork-transport.ts`/`cowork-planner.ts`/old `coworkTurn` (and their tests); retire `COWORK_PAID_PROVIDERS_ALLOWED` + its Railway env **only after §6 confirms every paid-LLM entrypoint is metered**. The idempotency-prefix change follows §9 (its own money-safety-gated diff).
- **Safety valve (not a legacy engine):** on an Otto-engine exception (incl. `MaxTurnsExceededError`), degrade to a friendly "I'm busy, try again shortly" reply, not a blank UI.

## 11. Money-machine: unchanged vs the three deliberate, gated changes

**Unchanged (byte-for-byte):** GEN `reserveCredits`/`refundReservation` + finalizer indexes; the worker `gen.ts` (fal call, settle/refund, R2 store); the `genRequest` zod gate + `superRefine`; the fal wiring in `packages/generation/src/index.ts`; pg-boss queues/policies; the `GenJob_active_idempotency_key` index.

**Deliberately changed — each gated by `money-safety-review` + Codex:**
- **(A) Variable settle in `credits.ts`** — extend `settleCredits` (or add `settleReservation(tx, {orgId, refId, actualInternal})`) to settle an amount ≤ the reserved amount and release the remainder, idempotent on `(orgId, refId)`. Needed for Otto-LLM reserve→settle (§6). Reuses RESERVE/SETTLE kinds — **no new `CreditTxnKind` enum value** (Codex: enum is GRANT/RESERVE/SETTLE/REFUND/ADJUST; adding DEBIT would be an extra migration — avoided).
- **(B) `GenJob_cowork_idempotency_once` predicate migration** for the prefix rename (§9), keeping `cowork:%` for historical rows.
- **(C) Wrap every paid-LLM entrypoint in metering** (`enhancePrompt`, `coworkDraftStoryboard`, the Otto turn) — required before retiring R1, or R1's removal opens a paid-API ledger bypass.

These three are the **only** money-machine changes; all small, explicit, gated.

## 12. Test plan (money migration — 100% of the money paths)

Extend the existing vitest suites (`gen.test.ts`, `spend.test.ts`, `cowork-*.test.ts`). New coverage:

```
MONEY-SAFETY (unit + [→E2E] for the full spend flow)
  ├─ never-negative under 2 concurrent Otto turns / one org (atomic reserve)
  ├─ exactly-once: double-approve / replayed generate tool → ONE charge
  ├─ reserve-before-call: reserve fails → provider (Anthropic) is NEVER called
  ├─ variable settle: settle actual < reserved → remainder released; idempotent on (orgId,refId)
  ├─ idempotency migration: both cowork: AND otto: keys dedup all-status
  ├─ per-turn floor math in INTERNAL credits (no 10× display/internal error)
  └─ no paid-LLM bypass: enhancePrompt / draftStoryboard / otto turn all metered (R1 retired)
HITL
  ├─ approval bound to (cardId, payload-hash); resume with a different cardId is rejected
  └─ approved-then-rehydrated generate is single-use (no re-charge)
AUTO-RESUME
  └─ worker loads RunState from @fikirtive/otto, runs the verdict turn, persists; verdict turn reserves→settles
LLM QUALITY
  └─ [→EVAL] otto instructions.md output quality vs today's planner prompt baseline
```

**Spike-only unknowns (settle in Phase 0):** cross-SDK-version RunState resume is a **compatibility project**, not an SDK guarantee — mitigate by draining parked approvals before an SDK upgrade (or version-branch); the `aisdk(@ai-sdk/anthropic)` adapter is **beta** — validate token-usage flow on that exact path; per-request usage via `requestUsageEntries`.

## 13. What already exists (reuse) vs replace

**Reuse:** credits ledger, pg-boss worker, `genRequest`, `suggestModel`, ChatThread/card model, the vitest money-path suites, the OPT-6 model registry + margin config. **Replace:** `cowork-planner` (JSON prompt), `cowork-transport` (3 transports), `coworkTurn`, the R1 double-lock.

## 14. Parallelization (worktree lanes)

| Lane | Modules | Depends on |
|---|---|---|
| A — `packages/otto` agent + tools + instructions | packages/otto, apps/web | — |
| B — variable-settle ledger + reserve→settle + tests | packages/db, packages/core | — |
| C — metering wraps for all LLM entrypoints | apps/web | B |
| D — idempotency-index migration + cowork→otto rename | packages/db, apps/* | A,B,C (Phase 3) |

A and B run in parallel. C waits on B. D is Phase 3, after A/B/C ship and verify. B, C, D are money-machine → sequential within themselves + gated.

## 15. Success criteria

- All 5 guardrails demonstrably hold (local QA + money-safety-review + Codex green), incl. approved-then-rehydrated `generate` single-use and the per-card index preventing re-charge.
- Every paid-API action (GEN + every LLM entrypoint) reserves→settles credits in **internal** units with the configured margin; balance never negative (incl. concurrency); the provider is never paid without a successful reserve; runaway turns bounded by `maxTurns`.
- The GEN reserve/settle/refund path, worker, `genRequest`, and fal wiring are unchanged; the only money-machine changes are (A) variable settle, (B) the index-predicate migration, (C) the LLM-entrypoint metering wraps.
- Auto-resume runs in the worker and asks a plain verdict question.
- Otto is multi-step, extensible by adding a file, `otto`-named with no `planner`/`cowork` symbols after Phase 3.
- Prod cutover verified live: a hand-tested generation, correct GEN + Otto-LLM credit settlement, and the verdict turn firing.
