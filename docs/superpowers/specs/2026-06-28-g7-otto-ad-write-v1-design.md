# G7 v1 Design — Otto Manages Existing Meta Ads (write)

**Date:** 2026-06-28
**Historical status (2026-06-28):** merged as PR #64 (`f141037`); the then-recorded production/provider/App Review state is not current authority. Live deployment, permission and provider state must be queried in the corresponding GitHub task; unqueried state is `Unknown`.
**Scope:** v1 = slice (a) **manage existing** Meta ads only. Creating ads = v2.
**Grounds on:** [codebase grounding map](#references) · [agent-authz research](2026-06-28-g7-agent-authz-research.md) · legacy session provenance retained in Git history (not current authority)
**Builds on (historical design dependency):** G6 read-only Meta connector + the Otto Skill Framework. Current runtime and production availability require live verification.

---

## 创始人摘要 (Founder TL;DR — read this first)

G7 让 Otto **管理你已有的 Meta 广告**:暂停 / 恢复 / 改预算 / 改排期。这花的是**你真实的 Meta 广告费**(不是 FIKIRTIVE 积分),所以默认**最严**。

- **Otto 只会"提议"**,它手里**没有任何能直接改 Meta 的工具**。真正动手的是一段独立的服务器代码,只有〔你点批准〕或〔自动档下的纯省钱动作〕才会跑。
- **两档模式**(你在设置里拨):① **询问**(默认 —— 每个写操作都问)/ ③ **自动**(省钱动作如暂停、降预算自动做;**任何会花钱的永远先问你**)。
- **计划级批准**:Otto 出一张计划卡,列出每一步 + 总共花多少钱,你**一次看完、一次批准**。
- **三道墙保你的钱**:Otto 没有写工具 · CI 围栏挡死偷塞 · 服务器每次重查真相(身份、真实数值、省钱还是花钱)。+ 真钱专用薄层(防重复扣、批准绑死、急停开关)。
- **易于你管理**:Otto 的能力 = 一张自动生成的清单(`CATALOG.md`);规则 = 一张你读得懂的表格文件;控制 = Connections 里几个开关 + 急停。**没有东西藏起来。**
- **不在 v1**:建新广告、模式② 草稿、模式④ 托管+硬上限、对外 App Review、Cedar 策略引擎。

这三条优先级 —— **安全 > 效率 > 你能轻松管理** —— 是本设计的尺子(见 [memory: otto-build-priorities])。

---

## 1. Scope

### In v1
- A read of the owner's existing Meta objects (campaigns / ad sets / ads) with id, name, status, budget, schedule.
- Four write operations on a named existing object: **pause, resume, budget up/down, reschedule.**
- Two autonomy modes — **① Ask** (default) and **③ Auto** — with the per-org mode-switch setting + UI.
- **Plan-level batch approval**: one card lists many steps; approve once.
- The money-safety layer (SoD enforcement, exactly-once-processing idempotency, bound/expiring/single-use approval, non-idempotent duplicate-confirm, global kill-switch).

### Deferred (NOT in v1)
- **Creating** ads/campaigns from scratch (slice b → v2).
- Modes **② Draft** and **④ Autopilot + hard spend caps** (the 4-mode model stays the north star; v1 ships ①+③).
- Public **App Review** for `ads_management` (founder/team use it in Dev mode now, like G6).
- **Cedar** / any policy engine — v1 uses a hand-rolled deterministic policy file (§9).
- Per-account autonomy (v1 autonomy is **per-org**).

---

## 2. The three priorities (the design lens)

Every decision below is weighed against, in order (memory `otto-build-priorities`):
1. **Safety** — money/safety enforcement in deterministic code, never the prompt; SoD; default-strictest.
2. **Efficiency** — Otto does the grunt work + batches the asks (mode ③ + batch approval).
3. **Founder-manageability** — file-system style: capabilities are files (auto-listed in `CATALOG.md`), rules are ONE readable table-file, controls are simple UI toggles. Nothing buried.

---

## 3. Autonomy model (v1 = ①+③)

The locked 4-mode model (handoff §4); v1 ships the strictest two + the switch machinery.

| Mode | Otto may | v1 |
|---|---|---|
| **① Ask** (default) | every write asks; nothing auto-spends | ✅ |
| ② Draft | only drafts/proposals, never executes | deferred |
| **③ Auto** | money-**safe** ops auto; money-**spend** ops still ask | ✅ |
| ④ Autopilot | spend too, under hard caps | deferred |

- **Default is ①.** The mode is a **per-org** setting (`MetaConnection.adsAutonomy`, §8). Cleared on disconnect → resets to Ask on reconnect (fail-safe).
- Maps to the research's 5-level autonomy taxonomy (arXiv:2506.12469): ① ≈ **L4 "approver"** (maker-checker default), ③ ≈ approver-for-spend / collaborator-for-safe.

---

## 4. Operations + money-class taxonomy

Money-class is **computed server-side** from the real current→target delta — never declared by the LLM. It is the axis mode ③ keys off.

| Operation | Money-class | ① Ask | ③ Auto |
|---|---|---|---|
| Pause | **safe** | ask | **auto** |
| Lower budget | **safe** | ask | **auto** |
| Resume | **spend** | ask | ask |
| Raise budget | **spend** | ask | ask |
| Reschedule | **spend** (fail-safe — schedule's spend effect is subtle, never auto) | ask | ask |

**Fail-closed rule:** any operation whose money-class cannot be determined → treated as **spend** (ask). Unknown mode → **Ask**.

**Object levels:** status (pause/resume) applies at campaign / ad-set / ad. Budget applies where it lives (campaign CBO **or** ad-set ABO). Reschedule applies at ad-set (and campaign where supported). The typed action schema bounds each op to its valid level(s).

---

## 5. Architecture — 3 components + the trust boundary

The realized **Separation of Duties** (OWASP "proposer / approver / executor"; research finding 2). Mirrors the existing `propose` → `generate` seam.

```
 你 → Otto(AI)            只能"提议"
        │  metaListObjects (read)      ── free/read/external · ungated
        │  proposeMetaAction (draft)   ── free/write/internal · ungated · writes an ACTION_CARD, never Meta
        ▼
   ACTION_CARD (frozen plan, server-trusted values)
        │
        ▼
   executeMetaAction  ── trusted SERVER ACTION (apps/web/lib/meta-write-actions.ts)
     the ONLY thing that writes Meta. NOT an LLM tool. NOT in Otto's tool list.
     triggered by: 〔human Approve〕 or 〔③ + all-safe server auto-trigger〕
```

### Component A — `metaListObjects` (read skill)
- `cost:free, effect:read, reach:external` → ungated. Mirrors `meta-insights.ts`.
- New Graph readers `listCampaigns/listAdSets/listAds` in `apps/web/lib/meta-graph.ts` → `id, name, effective_status, daily_budget/lifetime_budget, start_time, end_time` (currency in minor units).
- New owner-scoped port impl (sibling of `fetchOwnerInsights`); reads via decrypted token; returns `{notConnected}/{needsReconnect}`, never throws.
- **Why new:** the entire existing Meta read surface is `me/adaccounts` + `{acct}/insights`. There is no object-level listing today — and the "LLM never trusted for current state" rule is impossible until current status/budget/schedule can be read server-side.

### Component B — `proposeMetaAction` (draft skill)
- `cost:free, effect:write, reach:internal` → ungated. Mirrors `propose.ts`.
- New pure builder `buildMetaPlanCard(input, ctx, currentMetaState)` (`propose-meta-action.helpers.ts`, no `@fikirtive/db`/`@openai/agents` imports → unit-testable) that:
  - assembles the step list,
  - **classifies each step's money-class server-side**,
  - writes `currentValue` from server-fetched state (display snapshot),
  - computes `targetValue` + `totalSpendImpactDisplay`.
- Skill (`propose-meta-action.ts`) owner-validates each target object id against the owner's token-visible accounts, persists **ONE** `ACTION_CARD` `ChatMessage` (steps live **inside one payload**, not N rows — the inverse of `propose-pack.ts`).
- **LLM input carries only**: target id(s) + intent (e.g. `+20%`, `pause`) + `planTitle`. Never current values, never money-class.

### Component C — `executeMetaAction` (trusted server executor — the only writer)
New file `apps/web/lib/meta-write-actions.ts`, mirroring `gen-actions.ts` `startGen`:
1. `requireOwner` (never accept ownerId from caller) + `isImpersonating` block (real-money action — block staff-as-customer even in Auto).
2. **Kill-switch check first** (§7), fail-closed.
3. Load the owned `ACTION_CARD`; verify the **approval binding** (§7) — actor + param-hash + not-expired + not-consumed.
4. Per step, in order: **re-read LIVE Meta state** via `metaGraphGet`, **recompute money-class** against live state, enforce the policy (§9) for (mode, money-class), then **atomic idempotency claim** (§7) → `metaGraphPost`.
5. Record per-step outcome; emit `ActionEvent` audit rows (best-effort).
- Injected into `OttoContext` as the `metaWrite` port by `buildOttoContext` (`apps/web/lib/otto-actions.ts`); **deliberately NOT injected** by `apps/worker/src/otto-resume.ts` (a worker verdict turn must never write Meta — exactly as `startGen` is withheld there).
- New outbound primitive: `metaGraphPost(token, path, body)` in `meta-graph.ts`, mirroring `metaGraphGet`'s auth header + `metaError`/code-190 contract.

### The three walls (SoD enforcement — all deterministic, none in the prompt)
1. **Capability wall** — Otto's tool list contains **zero** Meta-write tools. It cannot call the writer.
2. **CI fence** — extend `scripts/check-skill-imports.sh` to hard-fail any `skills/*` importing `meta-graph` / the write client. "Skills can't write Meta" becomes machine-enforced, not convention.
3. **Server re-verification** — `executeMetaAction` re-establishes every security/money fact server-side (identity, live current value, money-class) and ignores anything the LLM asserted.

---

## 6. Plan-level batch approval (the ACTION_CARD)

The efficiency lever + the maker-checker surface. One card = a frozen multi-step plan; approve once.

- **Card render** (`OttoActionPlanCard.tsx`, modeled on `OttoPlanCard.tsx`): step list with per-step money-class badges + each step's **server-fetched evidence** (e.g. `Ad A · last 14d: $200 spent · 0 conv`) + the **plan total spend impact** + ONE batch-approve button (+ Deny). Evidence is server-fetched, never Otto's prose — so the human approves on truth.
- **Auto path (③ + all steps safe):** the server auto-triggers `executeMetaAction` right after the card persists (within the turn's server context, which already holds `requireOwner`). The card shows "auto-done ✓". If **any** step is spend-class, the **whole card** waits for human approve (no partial auto-spend).
- **Approval is faithful replay, not re-planning:** approve binds to exactly the frozen steps. Otto cannot add/modify steps post-approval; a changed plan needs a fresh card.
- **Multi-step state** `deriveActionState` (multi-step analog of `deriveCardState`): aggregates per-step terminal signals → `pending / executing / all-done / partial / failed`.

---

## 7. Money-safety layer (research-backed; the "real money" delta over Claude Code)

Claude Code's actions are mostly reversible; Meta spend is not. These are the minimum additions for irreversible money (research findings 5, 7, 8, 12).

### 7.1 Bound, expiring, single-use approval (finding 5)
The approval record binds to the **exact action**: actor + tool + target id(s) + **hash of normalized step params** + timestamp + **expiry**. On use it is marked **CONSUMED** (single-use) — replay's second use fails; an edited plan's hash won't match. Stored on/with the `ACTION_CARD`.

### 7.2 Exactly-once **processing** (findings 8, 10)
Exactly-once *delivery* is impossible; we guarantee exactly-once *processing*:
- A **per-step idempotency key** `meta-act:<cardId>:<stepIndex>` backed by a `MetaActionExecution` row + an **all-status partial-unique index** (the row IS the exactly-once enforcer — there is no GenJob/ledger row for Meta writes). Modeled on `GenJob_cowork_idempotency_once`; hand-written migration (Prisma can't express partial-`WHERE`).
- Use Meta's request-level idempotency (`Idempotency-Key`-style, where the endpoint supports it) as an additional backstop.
- v1 keeps this as an idempotency-row + status machine (PENDING → APPLYING → APPLIED/FAILED). The full transactional-outbox+relay (`pg-transactional-outbox`, finding 9) is the documented growth path, **not** v1 — a single idempotent claim + live re-read covers v1's single-relay case.

### 7.3 Non-idempotent → reconcile, then duplicate-confirm (finding 12)
A Meta write can't be refunded. If a step's status is ambiguous after a crash (`APPLYING` with no confirmed result = **MAYBE-APPLIED**), the executor **re-reads live Meta state to reconcile**. If it still can't tell, it **stops and asks the human to confirm the retry** — never auto-retries. This is the research-backed form of our "stop + report, never auto-rollback" rule. **No automatic inverse/rollback calls** (they can themselves fail or spend).

### 7.4 Partial-batch failure policy
**Stop-on-first-failure + report.** If step k fails, steps 1..k−1 stay applied (and are reported as done), steps k+1.. are not attempted, and the card surfaces a `partial` state with the exact reason. No auto-undo.

### 7.5 Global kill-switch (finding 7)
A deterministic "**pause all Meta writes**" flag the executor checks **first**, fail-closed. Independent of autonomy mode; a human can hard-stop everything instantly. (Loop/token/cost caps on Otto's own turns already exist via `withLlmBudget`; per-spend hard caps are mode-④ territory, deferred.)

---

## 8. Data model changes

1. **`MetaConnection.adsAutonomy`** (`packages/db/prisma/schema.prisma`):
   ```prisma
   enum AdsAutonomy { ASK AUTO }
   // on MetaConnection: adsAutonomy AdsAutonomy @default(ASK)
   ```
   One-per-org via `ownerId @unique`. Lost on `disconnectMeta` → resets to ASK on reconnect (matches the fail-safe design). Seeded `ASK` in `completeMetaConnect` create branch.

2. **`MetaConnection.scope` → actually-granted scopes.** Today literal `'ads_read'`. Must (a) request `ads_management` in `buildAuthorizeUrl` (`meta-oauth.ts`), and (b) persist the **actually granted** scopes from Meta's `granted_scopes` in `completeMetaConnect` — never blindly write a literal. A user who declines write must NOT be marked write-capable. `getMetaConnection` surfaces a `canWrite` flag.

3. **`ACTION_CARD`** added to `ChatMessageKind` enum (clean switch semantics over a `GEN_CARD` + discriminator). Thread through: Prisma enum → `ChatMessageDTO.kind` (`apps/web/lib/types.ts`) → dto mapper → `otto-ui-messages.ts` (`placeholderTextFor` + `OttoUiMessageMetadata.kind`) → both `MessageRow` switches (`OttoConversation.tsx` + studio `Cowork.tsx`). Payload:
   ```ts
   type MetaActionCardPayload = {
     planTitle: string;
     steps: Array<{
       index: number;
       op: "pause" | "resume" | "budget_up" | "budget_down" | "reschedule";
       targetId: string;            // owner-validated server-side
       targetName: string;
       currentValue: {              // SERVER-fetched at propose time (DISPLAY ONLY — executor re-reads live)
         status?: string; dailyBudget?: number; lifetimeBudget?: number;
         startTime?: string; endTime?: string; currency: string;
       };
       targetValue: { /* same shape, server-computed from intent */ };
       moneyClass: "safe" | "spend";   // SERVER-computed
       evidence?: string;              // server-fetched justification line
     }>;
     totalSpendImpactDisplay: string;   // server-computed aggregate
     approval: {                        // §7.1
       paramHash: string; boundActor: string; expiresAt: string; consumedAt?: string;
     };
   };
   ```

4. **`MetaActionExecution`** (the exactly-once enforcer, §7.2):
   ```prisma
   model MetaActionExecution {
     id           String   @id
     ownerId      String
     cardId       String
     stepIndex    Int
     status       String   // PENDING | APPLYING | APPLIED | FAILED
     appliedValue Json?
     createdAt    DateTime @default(now())
   }
   ```
   + hand-written all-status partial-UNIQUE index on `(ownerId, cardId, stepIndex)` (use the `COALESCE(col,'')` NULL-collapse trick if any scope col is nullable, per `RefGenJob_active_entity_variant_key`).

5. **`ActionEvent`** audit rows per executed step (reuse the existing table/discipline from `startGen`).

---

## 9. The policy: hand-rolled, readable, Cedar-deferred

Per priority ③ (manageability) and YAGNI: v1's policy is ~10 rules (`2 modes × 5 ops × {safe,spend}`).

- **One pure function in one readable file** — `meta-action-policy.ts` — exposing a clear table mapping `(mode, op, moneyClass) → "auto" | "ask"`, default-deny, fully unit-tested. The founder can open it and read the rules like a settings sheet.
- **Structured to migrate to Cedar later** (research finding 6 — Cedar is the best-fit engine *if* the ruleset grows: more modes, per-account rules, ④ caps). Not now — a policy-engine dependency for ~10 rules is premature, and a single readable file serves manageability better.
- The policy is consulted **only** in trusted server code (`executeMetaAction` + the auto-trigger decision), never by the LLM.

---

## 10. Manageability (file-system alignment — priority ③)

"Manage Otto" = read a few clear files + flip a few toggles. Nothing buried.

- **Capabilities = files.** The 2 new skills are 2 files under `packages/otto/src/skills/`, auto-listed in `CATALOG.md` (CI-checked fresh). The founder sees Otto's entire capability set in one generated table. The Meta writer is deliberately **absent** from that list (it's not a skill).
- **Rules = one readable table-file** (`meta-action-policy.ts`, §9).
- **Controls = simple UI** in `OttoConnections.tsx`: the autonomy selector (Ask/Auto, with clear risk copy) + the kill-switch. Wired via a new `setAdsAutonomy(mode)` server action (mirrors `updateMemory`, `updateMany` owner-scoped).
- **Every action = a plan card** the founder reads (steps + total + evidence) before one approval.

---

## 11. Scope upgrade & reconnect (`ads_management`)

- `buildAuthorizeUrl` requests `ads_management` (parameterize the hardcoded `ads_read` — appears in 3 places: authorize url, `completeMetaConnect` upsert, model comment).
- Reconnect re-enters `/api/meta/authorize` + `/api/meta/callback` (CSRF `signState`/`verifyState` reused).
- `completeMetaConnect` persists **granted** scopes; sets `canWrite` from whether `ads_management` was granted.
- `OttoConnections` + `getMetaConnection` surface "write not granted — reconnect to let Otto manage ads." `metaListObjects`/`proposeMetaAction` degrade gracefully when `canWrite=false` (read still works; propose explains it needs reconnect).
- v1 path: founder/team in **Dev mode** (no App Review). Public `ads_management` App Review deferred.

---

## 12. Error handling

| Case | Behavior |
|---|---|
| Token expired / code-190 mid-batch | stop the batch at that step, mark `needsReconnect`, surface partial state — no further writes |
| Step target no longer exists / changed | reconcile by live re-read; if intent no longer valid, skip that step + report |
| Ambiguous apply (MAYBE-APPLIED) | reconcile by live re-read; if still unknown → ask human to confirm retry (§7.3) |
| Partial batch | stop-on-first-failure + report (§7.4); no auto-undo |
| Kill-switch on | refuse all writes, fail-closed (§7.5) |
| LLM proposes unknown/unowned object id | server owner-validation rejects at propose time; step never becomes approvable |

---

## 13. Security & tenancy

- `requireOwner` first line of every server action; `ownerId` never a parameter; owner-scoped queries (`{ ownerId, deletedAt: null }`).
- `isImpersonating` blocks staff-as-customer on all writes (even Auto).
- Token decrypted only inside the executor; never returned to the client. **Never rotate prod `TOKEN_ENCRYPTION_KEY`.**
- LLM-supplied object ids are untrusted → validated against the owner's token-visible accounts before any write.
- CI fence extended to Meta (§5, wall 2).

---

## 14. Testing strategy

- **Pure unit:** money-class derivation; the policy table `(mode, op, moneyClass) → auto|ask` incl. fail-closed defaults; `buildMetaPlanCard`; `deriveActionState` (incl. partial); approval param-hash bind/expire/consume.
- **Skill gate assertions:** `metaListObjects` = free/read/external/ungated; `proposeMetaAction` = free/write/internal/ungated (in `migration.test.ts` or per-skill tests).
- **Executor (`meta-write-actions`):** `requireOwner` enforced; `isImpersonating` blocked; **spend-class never auto under ③**; idempotency double-execute-safe; kill-switch refuses; missing `ads_management` → needsReconnect; MAYBE-APPLIED → reconcile/ask. Graph client **mocked** — no real Meta calls in tests.
- **CI fence:** a test that a skill importing `meta-graph` fails the fence.

---

## 15. Key files to touch

`packages/db/prisma/schema.prisma` (+ hand-written migration) · `packages/otto/src/context.ts` · `registry.ts` · new `skills/{meta-list-objects,propose-meta-action,propose-meta-action.helpers}.ts` · `apps/web/lib/{meta-graph,meta-actions,meta-insights,otto-actions,otto-client-actions,types,otto-ui-messages,otto-inject-helpers}.ts` · new `apps/web/lib/meta-write-actions.ts` · new `apps/web/lib/meta-action-policy.ts` · `apps/web/lib/meta-oauth.ts` · `apps/web/components/otto/{OttoConnections,OttoConversation}.tsx` · new `OttoActionPlanCard.tsx` · `apps/worker/src/otto-resume.ts` (omit port — verify only) · `scripts/check-skill-imports.sh`.

---

## 16. Resolved decisions / remaining open questions

**Resolved in this design:**
- Otto has **no** Meta-write tool; the writer is a server action (not gated via SDK interruption → avoids generalizing the 3 hardcoded `"generate"` interruption sites).
- Approval = the ACTION_CARD's own pending state + a dedicated approve server action (not RunState resume).
- Money-class lives in payload + executor, **not** the 3-field skill gate (a 4th axis is not added to the framework).
- `ACTION_CARD` = new enum value. Autonomy = per-org. Cedar deferred. Partial = stop+report. No auto-rollback.

**Remaining (resolve during planning):**
1. Exact reschedule object levels + the typed action-schema bounds.
2. Auto-trigger execution context detail — confirmed it runs inside the propose turn's server context (has `requireOwner`); verify no path executes outside a request.
3. Whether the auto-trigger and the human-approve path share one `executeMetaAction(cardId)` entry (intended: yes).
4. Approval param-hash canonicalization (normalize number formatting / key order before hashing).

---

## References
- Codebase grounding map — workflow `wf_942a51d2` synthesis (this session); covers exact symbols/risks.
- [Agent-authz deep research](2026-06-28-g7-agent-authz-research.md) — 12 verified findings.
- Legacy session provenance is retained in Git history, not as current authority · [Otto Skill Framework design](2026-06-26-otto-skill-framework-design.md) · [G6a](2026-06-28-g6a-meta-connect-design.md) · [G6b](2026-06-28-g6b-meta-insights-design.md).
- Memory: `otto-build-priorities`, `ask-before-spending-real-money`, `fikirtive-meta-app-config`.
