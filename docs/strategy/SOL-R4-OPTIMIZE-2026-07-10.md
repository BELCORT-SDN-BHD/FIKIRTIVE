# Sol R4 — FIKIRTIVE 全方位优化审计

> **SUPERSEDED（部分）— 2026-08-09，#791-4 / #810**：本审计正文提到的 `worker-verdict` 运行模式
> （生成完成后自动计费跑一轮 Otto 评价）已于 #791-4 按 Founder 裁决整轮移除，不再存在于代码中。
> 此处只加注记，**正文一字未改** —— 这是 2026-07-10 那次审计的原始记录。


Audit snapshot: 2026-07-10, branch `claude/northstar-immersive`, final observed HEAD `d543d8deab437b436eab4f91a45a0a1870272a61`, `origin/main` `526482393766091deae08f95d936829768f53415`. Repository was read-only for this audit. No paid call, live provider action, Railway mutation, database mutation, or production test was performed. External GitHub rulesets, Railway variables, Sentry rules, UptimeRobot monitors, Neon restore settings, and live backup objects were not independently queried; where repository documents disagree about those facts, the disagreement is itself a finding.

Security note: this was a defensive source/configuration review, not a penetration test. The license finding is an engineering risk flag, not legal advice.

Impact scale: **Critical / High / Medium / Low**. Effort scale: **S / M / L**. “Quick win” means days, not “unimportant”; “structural” means the fix changes the system's shape.

## Executive verdict

FIKIRTIVE has unusually good written invariants and unusually weak correspondence between those invariants and the structures that claim to enforce them.

- The Otto seam enforces a three-field declaration, but it does not own the action, evidence, authority, economics, policy version, receipt, or calibration loop. It is a shallow wrapper over an SDK tool.
- The parity system is not merely incomplete. It contains demonstrably false equivalences while CI reports green. `createEntity → describeRefs`, `startRefGen → describeRefs`, and `deleteMemory → rememberBrandFact` do not represent the same capabilities.
- The approved Phase-2 scoped loader is directionally right and architecturally incomplete. It scopes schemas but leaves global instructions, opaque run-state compatibility, broad restore profiles, and all-or-nothing fallback unresolved.
- The 2,332-test number is real as a discovered Vitest count, but it measures a Node/unit/integration layer. There is no active browser regression layer, no storage package tests, no production image build/boot gate, and no policy calibration suite.
- The deployment topology remains capable of turning a source merge into a production rebuild and migration. Staging still has unresolved storage/secret isolation. A prior environment-copy operation actually pointed a staging deployment at the production database and ran `migrate deploy`; it was harmless only because there was no new migration.
- Backup code exists, but recovery is not proven, backup and assets share a bucket/credential failure domain, and operational alert wiring is documented as manual/unverified.
- A production dependency that has no source imports was found under PolyForm Shield's non-compete terms, with an unknown-license Shotstack transitive and GPL `ffmpeg-static` transitive. For a product with video editing, this is a commercial-release blocker until removed or cleared.
- The “78-commit branch problem” is now **98 commits ahead and 5 behind**, touching **267 files with 60,581 insertions and 1 deletion**. That is not a review unit. It is an integration landfill.
- This repository has 263 Markdown files and about 75,497 Markdown lines under `docs/`. The constitution pyramid is becoming a recurring context tax and a drift generator.
- Fleet/two-brain orchestration has good role separation but one live orchestrator session is still the control plane. There is no durable task DAG, evidence ledger, budget ledger, or takeover state. This R4 itself duplicated repository reading across independent brains more than necessary.

The optimal Otto design is not “add more fields to `defineOttoSkill`.” It is a three-module architecture:

1. **Capability runtime:** one typed action implementation, invoked by both UI and Otto, owning identity, tenant scope, validation, authority, economics, idempotency, execution, and receipt.
2. **Decision-policy registry:** immutable versioned judgment policies with typed evidence, applicability, prediction, retirement, decision records, outcomes, replay, shadowing, and calibration.
3. **Otto engine:** job-level skills compose capability handles and policies; a stable bundle resolver attaches only the relevant tools and instruction fragments, pins their versions into state, meters the run, and hides the raw SDK.

Everything else is migration detail.

---

# I. Named deep dive — the optimal Otto skill seam

## I.1 Three designs considered

| Design | Shape | Upside | Fatal weakness | Verdict |
|---|---|---|---|---|
| A. Metadata patch | Add `domain`, evidence, authority, policy version to current `defineOttoSkill`; cache Agents by domain set | Smallest diff | Keeps direct Prisma, optional-port bag, handwritten parity, declaration-only idempotency, global instructions, raw SDK leakage | Temporary bridge only |
| B. Capability runtime + policy registry + Otto engine | UI and skill invoke the same typed capability handle; job-level skills compose handles and policies; engine scopes stable bundles | Semantic parity, deep interface, versioned judgment, local declarations, replayable state | Medium migration and a small amount of code generation | **Choose this** |
| C. Universal `findCapability` + `invokeCapability` tools | Two schemas dispatch the entire catalog | Maximum schema compression | Replaces many typed interfaces with one JSON mega-interface; complicates approval replay and weak-model reliability | Reject until the catalog is far larger and B is measured insufficient |

The selected design follows the deep-module test: callers should learn one operation, while SDK choice, metering, state format, loading, evidence, authority, and receipts disappear behind it. Today callers import the singleton Agent and must understand `run`, `RunState`, restoration, budgets, context construction, and result persistence (`packages/otto/src/otto.ts:15-22`; `packages/otto/src/run-input.ts:58-75`; `apps/web/lib/otto-actions.ts:191-283,718-739`; `apps/worker/src/otto-resume.ts:61-110`).

## I.2 Recommended architecture

~~~text
UI server adapter ─┐
                   ├─> CapabilityRuntime.invoke(ActionHandle, ActorContext, input)
Otto skill adapter ┘        │
                            ├─ identity + tenant scope
DecisionPolicy.evaluate ────┤  evidence + applicability
                            ├─ authority + approval grant
                            ├─ quote + idempotency + execution
                            └─ ActionReceipt + DecisionRecord + outcome link

createOttoEngine.forTurn(...)
  ├─ resolves stable capability bundle + instruction fragments
  ├─ caches Agent by bundle hash
  ├─ pins bundle/capability/policy releases into state
  ├─ meters run
  └─ persists typed outcome
~~~

### Capability runtime

~~~ts
type ActionDefinition<I, O> = {
  id: ActionId;
  version: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;

  otto:
    | { kind: "required" }
    | { kind: "exempt"; class: "ADMIN" | "VISUAL" | "MONEY_IN" | "ACCOUNT_SECURITY"; reason: string };

  effects: readonly Array<
    | { kind: "read"; reach: "internal" | "external" }
    | { kind: "write"; reach: "internal" | "external" }
  >;

  economics:
    | { kind: "none" }
    | { kind: "metered"; meter: "otto-turn" | "search"; priceKey: string }
    | { kind: "reserved"; ledger: "credits"; quotePolicy: string; idempotency: "required" }
    | { kind: "pass-through"; ledger: "channel-fee" | "external-budget"; currency: string };

  authority: {
    actionClass: string;
    financialExposure: "none" | "bounded" | "open";
    blastRadius: "record" | "record-set" | "campaign" | "tenant" | "external-public";
    reversibility: "reversible" | "compensatable" | "irreversible" | "unknown";
    complianceTags: readonly string[];
  };

  execute(ctx: ActorContext, input: I): Promise<O>;
};
~~~

`ActorContext` contains only verified server facts: branded `TenantId`, real `ActorId`, role/membership, session, correlation/trace ID, work-unit ID, and authority grants. Identity, price, evidence grade, approval, and idempotency key never come from model input.

Both surfaces are projections of the same handle:

~~~ts
export const createScheduledPost = toServerAction(scheduleDraftAction);

export const scheduleDraftSkill = defineOttoSkill({
  id: "schedule.manage-drafts",
  version: "1.0.0",
  uses: [scheduleReadAction, scheduleDraftAction],
  // ...model-facing intent schema/guidance only
});
~~~

The schedule path is the best existing seed: human and Otto already converge on `draftScheduledPost`, with shared core validation and one owner-scoped write authority (`packages/otto/src/context.ts:191-198`; `apps/web/lib/otto-actions.ts:266-268`). Generalize that pattern; do not generalize current direct-Prisma skills.

### Decision-policy registry

~~~ts
type DecisionPolicy<I, D, P> = {
  id: PolicyId;
  version: string;          // immutable; content hash is checked in CI
  status: "draft" | "shadow" | "active" | "deprecated";
  applies(input: I, evidence: EvidenceSnapshot): boolean;
  evidence: readonly EvidenceRequirement[];
  decide(input: I, evidence: EvidenceSnapshot): D; // pure
  prediction: z.ZodType<P>;
  retirement: RetirementRule;
  supersedes?: PolicyReleaseRef;
};

type EvidenceRequirement = {
  fact: string;
  accepts: readonly (
    | "source-observed"
    | "merchant-confirmed"
    | "linked"
    | "inferred"
  )[];
  maxAgeMs?: number;
  minSamples?: number;
  onMissing: "ask" | "abstain" | "recommend-only";
};
~~~

Every evaluation creates an immutable `DecisionRecord`: capability/policy IDs and hashes, actor and authority grant, evidence snapshot plus source/freshness, missing evidence, applicability, alternatives, recommendation, prediction interval, confidence, selected action, approval/override, receipt IDs, and later outcome links. A `DecisionOutcome` attaches source-observed or merchant-confirmed actuals without rewriting the original decision. Candidate policy releases run historical replay and shadow mode; promotion and rollback change a release pointer, not history.

This is the concrete implementation of the adopted doctrine that policies need applicability, evidence, prediction, retirement, and prediction-vs-actual records (`docs/strategy/TWO-BRAIN-MEMO-2026-07.md:7-11`).

### Otto engine and bundle resolver

~~~ts
const prepared = engine.forTurn({
  principal: verifiedPrincipal,
  work: { threadId, projectId, viewId, selectedResourceIds, pendingActionIds },
  message,
  priorState,
  mode: "fresh" | "approval" | "worker-verdict" | "system",
});

const outcome = await engine.run(prepared);
~~~

`forTurn` resolves a stable, versioned bundle:

~~~ts
type CapabilityBundle = {
  id: string;
  revision: number;
  capabilities: readonly CapabilityReleaseRef[];
  instructions: readonly InstructionFragmentRef[];
  dependencies: readonly BundleId[];
  schemaTokenBudget: number;
  toolsetHash: string;
};

type OttoStateEnvelopeV1 = {
  schema: 1;
  sdkState: string;
  bundle: { id: string; revision: number; toolsetHash: string };
  capabilities: readonly CapabilityReleaseRef[];
  policies: readonly PolicyReleaseRef[];
  pendingActions: readonly ActionId[];
};
~~~

Selection order:

1. Server-verified work/view/resource types.
2. Pending approval/action and the exact bundle that created it.
3. Capability-declared multilingual lexical signals.
4. A narrow general planning/clarification bundle, not the entire catalog.
5. A read-only `requestScope` escape hatch that returns `scope_expansion_required`; the host validates and reruns with an expanded stable bundle. It grants visibility only, never authority.

Agents are cached by stable bundle hash; tool order and instruction-fragment order are deterministic for prompt-cache stability. Domain instructions load with their tools. Otto identity, voice, and constitutional floor remain global. Resume/approval loads the exact pinned release set, not “whatever all skills means today.” A missing old release fails closed with a clean re-propose path.

### Skill granularity rule

Do not create one skill per server action. That would convert 80 parity debts into 80 schemas. Do not create one mega-skill per domain either.

Split a model-visible skill when **any** of these changes: user intent, evidence contract, authority cell, cost policy, idempotency/receipt semantics, or approval boundary. Combine low-level actions only when they form one user job and share all six. Examples:

- `schedule.inspect` and `schedule.manage-drafts` can be separate; `schedule.publish` must be separate.
- `meta.performance.diagnose` can hide multiple reads plus one deterministic policy and one internal card write.
- `generate` is an approval/continuation capability, not a default fresh-turn capability.
- Canvas pixel movement remains behind a higher-level visual intent or constitutional visual exemption.

## I.3 Required invariants

1. UI and Otto invoke the same `ActionHandle` and implementation.
2. Every human capability is `otto.required` or one of the four closed exemptions. There is no TODO state for new code.
3. Skills invoke only handles listed in `uses`; the invoker type and runtime both enforce it.
4. Skills cannot import Prisma, provider clients, `fetch`, or app-layer modules.
5. The constitutional approval formula remains a floor. The authority grid may only tighten it, never relax it (`docs/BLUEPRINT.md:48-62`).
6. Reserved/spend actions cannot execute without a claimed idempotent receipt and the domain's unique database backstop.
7. Unknown external outcome is never auto-retried.
8. Evidence quality is server-resolved, never model-asserted.
9. Policy releases are immutable and replayable.
10. State pins bundle, capability, and policy versions.
11. Worker/system principals receive explicit allowlists; absence is structural, not an optional port convention.
12. Registration, catalog, prompt fragments, action coverage, and test matrices are generated from definitions and checked in for founder-readable diffs.

## I.4 Migration order

1. **Safety/COGS quick win:** make worker verdict a no-tool, one-step profile; fix/remove fake `userId`; emit attached-tool/token/use metrics.
2. **Engine façade:** introduce `createOttoEngine`; initially keep the same 25 tools. Hide raw Agent/RunState/metering/persistence from callers.
3. **Action handles:** wrap existing shared authorities; migrate the 12 direct-Prisma production skill files. Then hard-ban DB/provider imports.
4. **Generated locality:** move model guidance next to the skill; generate registry, catalog, scope prompt, name tests, and action-coverage graph.
5. **Policy v1:** add `DecisionPolicyRelease`, `DecisionRecord`, and `DecisionOutcome`; migrate Meta diagnosis first.
6. **Scoped attachment:** stable bundles, scoped instructions, narrow ambiguity path, agent cache, exact state envelope.
7. **Parity cutover:** convert legacy human surfaces; forbid arbitrary action/route exports; delete the handwritten manifest, baseline, and regex scanner at zero.

---

# II. Otto findings

## O-01 — `defineOttoSkill` is a shallow wrapper, not the employee-policy seam

- **What:** `OttoSkillSpec` has name, description, input schema, one `cost/effect/reach` tuple, an `execute → unknown`, optional declaration-only idempotency, and string-level required fields. Its catalog repeats only those fields (`packages/otto/src/skill.ts:17-47,81-153`; `packages/otto/src/registry.ts:58-76`).
- **Why it matters:** capability version, policy version, evidence, authority, action reference, typed receipt, prediction, calibration, and state compatibility are outside the seam. Every new feature spreads those decisions across skill code, web actions, context builders, tests, manifest, global prompt, and docs.
- **Impact × effort:** **Critical × L — structural.**
- **Concrete fix:** adopt the capability runtime + decision-policy registry + Otto engine described above. Keep `defineOttoSkill` as a model-facing job declaration, not the business authority.

## O-02 — Parity is actively false, not merely incomplete

- **What:** CI verifies that a named skill exists, not that it invokes the paired action (`scripts/check-parity.mjs:129-151`). Concrete false mappings:
  - `actions.createEntity → describeRefs` (`packages/otto/src/parity-manifest.ts:87`), while `createEntity` creates an entity and ingests/attaches files (`apps/web/lib/actions.ts:326-352`) and `describeRefs` only caches descriptions on an existing entity (`packages/otto/src/skills/describe-refs.ts:45-88`).
  - Paid `refgen-actions.startRefGen → describeRefs` (`packages/otto/src/parity-manifest.ts:221`), while `startRefGen` reserves credits, creates a job, and enqueues it (`apps/web/lib/refgen-actions.ts:80-145`).
  - `memory-actions.deleteMemory → rememberBrandFact` (`packages/otto/src/parity-manifest.ts:169-174`), while the skill only creates memory (`packages/otto/src/skills/remember-brand-fact.ts:34-54`).
  - `actions.renameProject → setTitle` (`packages/otto/src/parity-manifest.ts:84-86`), while `setTitle` writes `ChatThread.title`, not `Project` (`packages/otto/src/skills/set-title.ts:29-41`).
- **Why it matters:** the machine can declare constitutional 100% parity green while Otto cannot perform the operation. This is worse than no check because it creates false confidence.
- **Impact × effort:** **Critical × M–L — structural.**
- **Concrete fix:** typed action handles shared by UI and Otto. Coverage means a job-level skill's `uses` contains the exact action handle; a string mapping cannot claim equivalence.

## O-03 — The 80-debt ratchet permits substitution, evasion, and category errors

- **What:** the current run reports **179 entries: 160 action exports, 9 API exports, 10 manually registered reads, and 80 `todoSkill` entries**. CI fails only if the total rises above 80 (`scripts/parity-debt-baseline.json:1`; `scripts/check-parity.mjs:160-180`). Clearing one old TODO and adding a new one passes. Discovery recognizes only regex-shaped `export async function` declarations (`scripts/check-parity.mjs:40-73`); const-arrow exports and unregistered reads can escape. Read coverage is a manual ten-item list (`packages/otto/src/parity-manifest.ts:24-75`). Internal wrappers are counted as if they were user capabilities.
- **Why it matters:** debt identity is not preserved, coverage is syntactic, and the unit of parity is an export rather than a user capability.
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** new action definitions require `otto.required | exempt` at the type level. Existing debt moves to an exact immutable `legacyParityDebtIds` set; new IDs cannot enter. An AST/ESLint rule bans raw exported handlers from `"use server"`/route modules except generated adapters. Delete TODO from the new interface.

## O-04 — Skill granularity and registration amplify every feature

- **What:** current skills range from 29-line CRUD wrappers to 170-line composite flows. Every skill is imported into one registry and one global instruction document (`packages/otto/src/registry.ts:1-76`; `packages/otto/src/instructions.ts:23-203`). Phase 2 proposes another manual `domain` registration point (`docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md:85-95`).
- **Why it matters:** one skill per CRUD action explodes schema count; one skill per domain hides incompatible authority/evidence; manual multi-file registration guarantees drift.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** job-level skills compose typed actions and split on intent/evidence/authority/cost/receipt boundaries. Co-locate guidance with the skill and generate registry, catalog, prompt fragments, exact-name tests, and action-coverage graph.

## O-05 — The safety tuple cannot represent real compound effects; idempotency metadata is theater

- **What:** approval derives from one `cost/effect/reach` tuple (`packages/otto/src/skill.ts:17-28,65-67`). `meta-expert` performs an external Meta read and an internal DB write but declares only `write/internal` (`packages/otto/src/skills/meta-expert.ts:36-45,67-85,97-109`). `idempotencyKey` is required for spend but never called by the factory; execution goes straight to `spec.execute` (`packages/otto/src/skill.ts:107-113,138-153`). The playbook admits it is documentation only (`docs/review/REVIEWER-PLAYBOOK.md:103`). `generate` is safe only because it hand-implements a lookup and relies on a unique DB index (`packages/otto/src/skills/generate.ts:90-130,150-166`).
- **Why it matters:** author-declared metadata can diverge from behavior, and a future spend skill can satisfy the factory while omitting the actual exactly-once mechanism.
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** actions declare an effect set and economics contract; skill risk is the worst-case composition. `ActionRunner` claims a typed execution receipt before spend and passes the derived idempotency key into the shared action. Domain-specific partial unique indexes remain the hard backstop.

## O-06 — Evidence, authority, and cost are prose; actor audit identity is already wrong

- **What:** `requires` checks only null/undefined/empty strings (`packages/otto/src/skill.ts:70-78,143-149`). It cannot express source, freshness, sample count, or abstention. `cost` is only `free|spend`; `researchWeb` is described as `$0` despite external search and turn metering (`packages/otto/src/skills/research-web.ts:106-116`; `packages/otto/src/meter.ts:109-169`). `OttoContext.userId` claims to be the verified user but `buildOttoContext` assigns `ownerId` (`packages/otto/src/context.ts:22-29`; `apps/web/lib/otto-actions.ts:236-240`). `requireOwner` returns email and ownerId, not actor ID (`apps/web/lib/auth-guard.ts:40-74`).
- **Why it matters:** `"n/a"` passes as evidence; “free” mixes user approval with provider COGS; multi-seat decisions cannot prove who instructed or approved them. Authority calibration becomes tenant-wide fiction.
- **Impact × effort:** **Critical × S for actor fix, L for full contract — mixed.**
- **Concrete fix:** immediately pass/remove the fake `userId`; then introduce branded Actor/Tenant IDs, typed evidence requirements, a sparse authority grid, and separate user-charge/platform-cost/quote/quota fields. Effective approval is constitutional floor **OR** an uncovered authority cell.

## O-07 — Judgment is deterministic but not versioned or calibrated

- **What:** Meta diagnosis hardcodes `winner >= mean × 1.25` and `loser <= mean × 0.6` (`packages/otto/src/diagnosis/diagnose-performance.ts:58-85`). Tests prove those constants execute as written (`packages/otto/src/diagnosis/diagnose-performance.test.ts:15-35`), not that they predict a useful business result. The KB has a date version and optional string `appliesWhen`, but no policy release, expiry, prediction, retirement, or calibration (`packages/otto/src/knowledge/meta-expertise.types.ts:20-35`; `packages/otto/src/knowledge/meta-expertise.ts:7-22`). Existing `ModelDirective` revisions record editable prompt material, confidence strings, and source, not decision outcomes (`packages/db/prisma/schema.prisma:728-750,781-797`).
- **Why it matters:** “deterministic” prevents model improvisation; it does not turn a coded hypothesis into proven judgment. The product moat in the two-brain memo does not exist until policy predictions meet outcomes.
- **Impact × effort:** **Critical × M–L — structural moat.**
- **Concrete fix:** immutable policy releases, typed DecisionRecord/Outcome tables, replay/shadow/promotion, and calibration by merchant segment and policy version. Migrate Meta diagnosis first; do not bury this in generic `ActionEvent.payload`.

## O-08 — Static attachment wastes tokens and weakens least capability

- **What:** one module-level Agent always receives all 25 tools (`packages/otto/src/otto.ts:15-20`; `packages/otto/src/registry.ts:30-56`). The approved audit measured about 7.7k tool-schema tokens and 12.4k constant-prefix tokens per step, up to ten steps (`docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md:12-21`). Prompt caching is now implemented at the model layer (`packages/otto/src/model.ts:82-185`), so the spec's “not enabled” status is stale, but caching lowers price rather than interface complexity.
- **Why it matters:** irrelevant tools increase input cost, tool-choice error, and unattended mutation surface. Every parity-debt skill makes every future turn heavier.
- **Impact × effort:** **High × M — structural efficiency/safety.**
- **Concrete fix:** stable many-to-many bundles with scoped instruction fragments, deterministic order, token budgets, bundle-hash Agent caching, and usage telemetry.

## O-09 — Approved Phase 2 is directionally right and still not optimal

- **What:** the design assigns one domain per skill, falls back to all tools on zero keyword hit, and uses all tools for every restore/approval/worker resume (`docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md:85-115`). Its proposed `core` permanently includes broad creation and spend-adjacent skills (`docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md:85-93`). Global instructions still name tools that a scoped Agent would not have (`packages/otto/src/instructions.ts:23-203`).
- **Why it matters:** shared capabilities are many-to-many, zero-hit ambiguity becomes maximum cost, and the agent can be instructed to call absent tools. Restore correctness is preserved by discarding the efficiency/safety goal exactly where unattended execution happens.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** bundle dependencies rather than one domain field; scope instructions with tools; use server-owned view/work/pending-action facts first; narrow general fallback; typed scope expansion; pin exact releases for continuation. `generate` loads only in creation or a pending approved card context.

## O-10 — Opaque RunState is not a durable business-state contract

- **What:** `ChatThread` stores only an opaque SDK JSON string (`packages/db/prisma/schema.prisma:827-846`). Restoration accepts whichever current Agent the caller provides and drops the state on incompatibility (`packages/otto/src/run-input.ts:58-75`). There is no bundle hash, capability release, policy release, pending action list, or state schema version outside the SDK blob.
- **Why it matters:** a tool rename, scoped bundle change, policy upgrade, or SDK schema bump can make an approval unrepeatable. “Start fresh” is unacceptable for an approval tied to spend or an external action.
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** wrap SDK state in `OttoStateEnvelopeV1`; pin bundle/action/policy releases and pending IDs; keep old releases replayable during their retention window; return typed `state_incompatible` and require re-proposal when replay is impossible.

## O-11 — Worker verdict turns are direct waste and an unattended mutation surface

- **What:** after generation, the worker restores the full Agent and permits up to ten metered turns merely to ask whether the result looks right (`apps/worker/src/otto-resume.ts:61-96`). It omits `startGen`, but all direct-Prisma free/write skills remain attached because the singleton tool list is unchanged (`apps/worker/src/otto-resume.ts:49-59`; `packages/otto/src/otto.ts:15-20`).
- **Why it matters:** this pays full schema cost for deterministic copy and grants an unattended system principal irrelevant mutation tools. An absent port is not least privilege.
- **Impact × effort:** **High × S — quick win.**
- **Concrete fix:** no-tool, one-step localized verdict profile, or deterministic localized copy. If model nuance is retained, attach exactly zero write/spend handles and a one-step cap. Record it as a distinct system profile.

## O-12 — `OttoContext` is a service locator and skills bypass it anyway

- **What:** the context is 208 lines mixing identity, attachments, model flags, prompt context, job state, and many optional domain ports (`packages/otto/src/context.ts:18-207`). Web eagerly assembles/wires every domain per turn (`apps/web/lib/otto-actions.ts:210-283`). Twelve production skill files import `@fikirtive/db`; the fence explicitly warns and exits zero (`scripts/check-skill-imports.sh:1-20`).
- **Why it matters:** every domain changes a central bag and multiple callers; missing capabilities fail at runtime; business logic and ownership checks live in model adapters rather than the action layer.
- **Impact × effort:** **High × L — structural.**
- **Concrete fix:** context becomes verified actor/work/trace plus a restricted `CapabilityInvoker`. Domain adapters stay private behind capability definitions. Unavailable adapter means capability not loaded. After migration, DB/fetch/provider imports under `skills/` hard-fail CI.

## O-13 — `packages/core` is already broad; do not dump the policy system into it

- **What:** the root barrel exports unrelated IDs, storage, timeline, upload, generation, spend, cowork, model registry, roles, brand, web search, product, and schedule primitives (`packages/core/src/index.ts:1-107`). It already needed a special server-only split to prevent `node:dns` leaking into clients (`packages/core/src/index.ts:81-87`; `packages/core/package.json:6-46`).
- **Why it matters:** adding the entire employee policy/action runtime to the root barrel increases coupling and accidental client bundles.
- **Impact × effort:** **Medium × S — architectural guardrail.**
- **Concrete fix:** keep core for stable cross-runtime primitives. Put capability/policy modules in a dedicated package or explicit narrow domain subpaths; no new wildcard exports from the root.

## O-14 — Skill testing proves implementation behavior, not employee effectiveness

- **What:** Otto has substantial tests, but factory and registry tests pin metadata/names, skill tests often call exported `executeX` directly, and diagnosis tests encode current threshold examples. There are no policy replay, shadow, calibration, bundle-resolution, token-budget, human/Otto adapter-equivalence, multilingual trajectory, or versioned resume suites (`packages/otto/src/skill.test.ts:127-138`; `packages/otto/src/registry.test.ts:5-28`; `packages/otto/src/diagnosis/diagnose-performance.test.ts:8-69`).
- **Why it matters:** a policy can be perfectly tested and commercially wrong; a skill can pass direct-execute tests while the weak model never selects it or lacks evidence.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** seven layers: generated definition invariants; action-contract tests through UI and Otto adapters; two-tenant and idempotency tests on real local Postgres; policy golden/property/mutation tests; historical replay/shadow calibration; deterministic resolver + token budgets + exact resume tests; scripted weak-model trajectories in English/华语/Bahasa. Live-model effectiveness eval remains non-CI and paid only with founder approval.

---

# III. Engineering, security, data, and operations findings

## E-01 — “2,332 tests” is accurate and not the confidence statement it sounds like

- **What:** read-only `vitest list --json` discovered exactly **2,332** cases: web 1,273; worker 94; core 455; db 26; generation 20; Otto 464, across 226 test files. CI provisions Postgres, applies migrations, checks schema drift, and runs the workspace suite (`.github/workflows/ci.yml:80-117`). But web tests use Node, not a browser (`apps/web/vitest.config.ts:21-29`); storage's “test” is an echo (`packages/storage/package.json:12-20`); the only E2E scripts are archived; Playwright is installed but has no test script or CI job (`package.json:17-33`). There is no coverage threshold.
- **Why it matters:** the suite covers pure policy/contract logic, many money/idempotency paths, migrations, and selected owner-scoped integration. It does **not** cover browser hydration, React behavior, deep links, cross-page persistence, production Docker images, R2 behavior, provider binaries, deployment/promotion, backup restoration, or policy calibration. The pre-walk found 4 P1 and 12 P2 defects despite the test count (`docs/northstar/QA-REPORT-PREWALK.md:1-5,23-49`).
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** keep the suite; add a small high-value browser journey layer, storage contract tests against MinIO/R2-compatible local service, Docker build/boot smoke, and risk-weighted coverage thresholds only for money/tenant/authority/policy/receipt modules. Stop advertising a raw count without a coverage map.

## E-02 — CI checks code shape, not the production artifact

- **What:** CI has three jobs: packages/type/fences, Next build, and unit/integration (`.github/workflows/ci.yml:19-117`). It does not run workspace lint, Playwright, worker Docker build, web Docker build/boot, image scan, dependency audit, secret scan, license gate, SBOM, deployment smoke, or canary. Tenancy and direct-Prisma checks are explicitly informational (`.github/workflows/ci.yml:41-49`; `scripts/check-no-raw-prisma.sh:1-9`). Root has a lint script that CI never calls (`package.json:17-28`).
- **Why it matters:** the thing tested is not the thing deployed. Worker-only build/runtime failures, Docker dependency drift, browser failures, licensing, and vulnerable dependencies can all merge green.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** add lint; build both images; boot them against ephemeral Postgres/MinIO; run Playwright smoke; scan secrets/dependencies/licenses/images; generate SBOM/provenance. Split fast PR gates from slower release gates instead of stuffing everything into one blocking job.

## E-03 — Production promotion is source-based, mutable, and coupled to migration

- **What (dated observation):** repository law and CI then described main push as auto-deploy + prod migration. The web container ran `prisma migrate deploy` at boot and as root for an obsolete local-volume rationale. A then-proposed release design, now retained only in Git history, suggested a protected branch after staging while Railway would still rebuild from source. Re-query all implementation and platform facts before use.
- **Why it matters:** a validated SHA can produce a different binary at promotion; web/worker/migration can roll at different times; application rollback does not roll schema back.
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** CI builds signed immutable web/worker images once, produces SBOMs, tests those digests, deploys the same digests to staging, then promotes them to prod. Migration is an explicit release job with expand/contract compatibility checks before app rollout. Canary and rollback point to image digests, not a source rebuild.

## E-04 — Staging is still production-capable

- **What (dated observation):** staging facts and credential placement were reported as unsafe, and a then-proposed release design remained target-state. Current staging/provider/credential facts require live queries; this historical report is not a credential or deployment source.
- **Why it matters:** staging compromise/operator error can touch prod assets, spend real money, send real messages, mutate platform accounts, or migrate prod.
- **Impact × effort:** **Critical × S–M — immediate.**
- **Concrete fix:** separate bucket + bucket-scoped token; remove all paid keys from mock staging; separate Meta/Resend apps; deployment-time environment allow/deny list; never duplicate production; staging deploys only a CI-cleared candidate digest; production promotes that digest.

## E-05 — Tenant enforcement explicitly fails open in production

- **What:** the Prisma extension covers only `findMany/findFirst/updateMany/deleteMany`, with documented blind spots for raw SQL, nested writes, unique reads, aggregate/groupBy/count (`packages/db/src/tenant-guard.ts:3-8,36-49`). In production it warns and executes (`packages/db/src/tenant-guard.ts:51-69`). Eight owner-bearing models are exempt (`packages/db/src/tenant-guard.ts:21-34`). The static scanner counts a stale model list and always exits zero (`scripts/check-no-raw-prisma.sh:1-9`).
- **Why it matters:** the constitution says one cross-tenant byte is an incident, while the runtime knowingly permits suspect queries. This audit did not prove an active leak; it proved the guard is not an iron curtain.
- **Impact × effort:** **Critical × L — structural.**
- **Concrete fix:** tenant-scoped repositories/action adapters constructed from verified `ActorContext`; platform-admin adapters are separate and explicit. Freeze every current legacy raw site by identity and fail CI on a new one. New capability code cannot obtain an unscoped client. Move production from warn-and-run to fail-closed once admin paths are separated.

## E-06 — Prisma debt is manageable but concentrated in invisible invariants and dead auth models

- **What:** current schema has 48 models, 12 enums, and 63 migrations. Retired Auth.js `Account`, `Session`, and `VerificationToken` coexist with Better Auth structures, and their removal is already approved after recovery proof (`packages/db/prisma/schema.prisma:527-575`; `docs/MASTERPLAN.md:80,230`). Ten raw partial/expression indexes are invisible to Prisma diff; five carry exactly-once money semantics (`docs/review/REVIEWER-PLAYBOOK.md:151-168`; `.github/workflows/ci.yml:108-116`). `ActionEvent.payload Json` is becoming a generic sink (`packages/db/prisma/schema.prisma:714-725`).
- **Why it matters:** an unrelated migration can silently drop a load-bearing raw index while schema diff stays green. Generic JSON is the wrong home for immutable decision/receipt semantics.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** catalog required raw indexes and exact predicates; test `pg_catalog/pg_indexes` after every fresh migration. Complete dead-auth drops only after a real restore drill. Add typed/versioned policy, decision, outcome, receipt, and backup-run tables rather than extending generic JSON.

## E-07 — A backup job is not a recovery capability

- **What:** nightly `pg_dump` with 30-day retention and missing-key retries exists (`apps/worker/src/db-backup.ts:112-178`). It silently no-ops when R2/config is absent (`apps/worker/src/db-backup.ts:154-165`). Backups use the same R2 bucket and credential family as live assets (`packages/storage/src/index.ts:413-441,500-517`; `docs/runbooks/db-backup.md:11-18`). Success means object upload/key existence. The runbook itself says a backup without a restore drill is not a backup and requires a real drill plus seven green days (`docs/runbooks/db-backup.md:20-45`; `docs/MASTERPLAN.md:68`).
- **Why it matters:** one R2 credential/bucket incident can remove assets and backups; a corrupt object still satisfies existence; no persistent RPO/RTO or backup-age signal exists.
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** dedicated backup bucket/account-scoped credential, immutable retention where available, checksum/size manifest, persistent `BackupRun`, daily age alert, monthly automated restore to a disposable database with schema/ledger/business-count invariants, measured RPO/RTO, and a separate asset-recovery plan.

## E-08 — Monitoring is code-ready and operationally unclosed

- **What:** `/api/health` checks web/DB and a worker heartbeat (`apps/web/app/api/health/route.ts:1-21`). Sentry is optional and tracing is off (`apps/web/instrumentation.ts:1-11`; `apps/worker/src/index.ts:54-77`). The incident runbook says UptimeRobot, Sentry DSNs/alerts, and Stripe event subscriptions require manual setup and may not exist; logs have no durable retention (`docs/ops/incident-visibility.md:9-33,50-54`). Common Otto failures are caught, logged, and returned generically, so exception monitoring may never see them (`apps/web/lib/otto-actions.ts:619-623`).
- **Why it matters:** liveness can stay green while paid jobs fail/refund, queues age, backups stop, margins collapse, webhooks lag, or decision quality degrades.
- **Impact × effort:** **Critical × S–M — quick operational close, then structural.**
- **Concrete fix:** launch gate with proof that alerts fire; named escalation destination; persistent structured metrics for queue depth/oldest age, paid-job failure/refund, leaked reservation age, provider spend/output, Otto error rate, backup age, webhook failure, credit invariant mismatch, and policy calibration. Correlation IDs join decision → action → job → ledger → receipt. Retain logs at least 30 days.

## E-09 — Supply-chain and secret assurance are absent

- **What:** actions use mutable tags and CI declares no minimal `permissions` block (`.github/workflows/ci.yml:20-34,66-78,97-106`). There is no CODEOWNERS, Dependabot/Renovate, secret-scanner config, SBOM, image scan, or license policy. Worker downloads/compiles mutable external inputs without checksums (`apps/worker/Dockerfile:1-37`). A read-only `pnpm audit --json` reported 1,087 dependencies with 2 moderate and 2 low advisories, 0 high/critical. `.gitignore` excludes common env/session artifacts, but that is not scanning (`.gitignore:7-9,20-25`). A limited tracked/history key-prefix scan found no obvious live key; that is not evidence of absence.
- **Why it matters:** compromised actions, transitive drift, or accidental secrets can enter with no automated gate. Workflow and money-path files have no declared reviewer ownership.
- **Impact × effort:** **High × S–M — mixed.**
- **Concrete fix:** SHA-pin actions and base images; minimum GitHub permissions; CODEOWNERS for workflows/Docker/money/tenant paths; gitleaks-equivalent history scan; production dependency audit with reachability triage; Renovate/Dependabot; SBOM/provenance/image scan; checksums for downloaded binaries/models; production web as non-root and pruned runtime images.

## E-10 — The repository carries an apparently unused commercially restricted video dependency

- **What:** `@shotstack/shotstack-studio` is a production dependency (`apps/web/package.json:13-21`), and build scripts explicitly allow its canvas and `ffmpeg-static` postinstalls (`pnpm-workspace.yaml:4-10`). No source import was found outside manifests. The installed package declares PolyForm Shield 1.0.0; its license forbids providing a product that competes with the software (`node_modules/.pnpm/@shotstack+shotstack-studio@2.11.5/node_modules/@shotstack/shotstack-studio/LICENSE:52-68`). The transitive canvas package reports unknown license metadata and `ffmpeg-static` reports GPL-3.0-or-later. The repository has no root LICENSE/NOTICE or automated license gate.
- **Why it matters:** FIKIRTIVE has video editing/rendering. An unused dependency creates installation, image-size, attack-surface, and commercial-license risk for zero product value.
- **Impact × effort:** **Potentially blocking × S if unused — highest-ROI quick win.**
- **Concrete fix:** remove the dependency and allow-build entries now if truly unused, regenerate lockfile, build/test. If it is required, stop commercial release until counsel clears the exact use/distribution facts or a commercial grant/replacement exists. Add production license allowlist, notices, and SBOM gate.

## E-11 — Product and policy instrumentation is missing

- **What:** no PostHog/Mixpanel/Amplitude/Segment-style product analytics dependency or equivalent typed event pipeline was found. `ActionEvent` is an owner-scoped free-form operational event table created for upgrade counts (`packages/db/prisma/schema.prisma:714-725`); it is not a versioned product funnel, receipt, or calibration system.
- **Why it matters:** the company cannot answer time-to-first-value, prompt→proposal→approval→successful outcome conversion, cohort retention, failure/retry friction, manual operator minutes, or policy prediction error. “Optimize everywhere” without measurement becomes taste plus anecdotes.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** privacy-minimized, typed `ProductEvent`/warehouse feed with event version, actor/tenant pseudonyms, session/work unit, release, capability/policy IDs, channel, outcome, latency, cost, and error class. Never copy raw prompts or customer content by default. Define the founding-cohort funnel and dashboard before onboarding.

## E-12 — Bus factor is one and operational ownership is implicit

- **What:** git history is overwhelmingly one identity (821 commits under the founder identity at audit time); current branch's 98 commits are almost entirely that same identity. There is no CODEOWNERS, SECURITY.md, root LICENSE/NOTICE, on-call ownership map, or machine-readable service/secret/recovery owner list. Many live-system checks are explicitly founder-only/manual (`docs/ops/incident-visibility.md:14-33`; `docs/runbooks/staging.md:45-80`).
- **Why it matters:** one unavailable founder blocks release, key rotation, recovery, alerts, legal clearance, and platform access. Agent context is not institutional ownership.
- **Impact × effort:** **High × M — structural operations.**
- **Concrete fix:** service catalog with owner/deputy, credential location/rotation date, recovery contact, provider admin accounts, RPO/RTO, escalation, and last drill; second human admin for critical vendors; encrypted break-glass procedure; CODEOWNERS and incident commander rotation. Do not put secrets in the catalog.

---

# IV. Governance and documentation findings

## G-01 — The 78-commit problem is now a 98-commit integration failure

- **What:** final read-only git measurement: **98 ahead / 5 behind `origin/main`**, 267 changed files, +60,581/−1. During the audit the branch state advanced, consistent with multiple harnesses operating concurrently. Fleet procedure allows workers to rebase and push to a shared branch (`.claude/skills/fleet-orchestration/SKILL.md:44-53`).
- **Why it matters:** no reviewer can reason about this as one change. Five main commits are missing; prototype, governance, and implementation are coupled; conflicts and stale assumptions compound daily.
- **Impact × effort:** **Critical × L now, larger tomorrow — structural.**
- **Concrete fix:** freeze feature additions; inventory commits by vertical journey and dependency; create fresh `origin/main`-based stacked PRs; land law/verdict docs separately; use an ephemeral preview integration branch only; sync daily; set maximum PR age/diff/commit budgets and enforce them in the fleet runner.

## G-02 — LAW, FACT, PLAN, and STATUS are mixed and contradict one another

- **What (dated observation):** law, CI, a then-proposed release design, scoped-loading docs and code contradicted one another. Re-query current law/code/GitHub rather than carrying any dated status claim forward.
- **Why it matters:** precedence solves normative conflict, not stale operational fact. Agents spend time reconciling documents and can still act on the wrong deployment/security state.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** keep BLUEPRINT as immutable LAW. Add a machine-readable governance index with stable decision ID, class (`LAW|DECISION|SPEC|FACT|RUNBOOK`), status, owner, effective commit, supersedes, implementation link, verification command, and expiry. Generate bootstrap/status pages and verify code-derived facts in CI.

## G-03 — Documentation volume is now a recurring fleet tax

- **What:** `docs/` contains 334 files, including 263 Markdown files and about 75,497 Markdown lines. Mandatory bootstrap plus playbook/verdicts/seams/designs runs into thousands of lines before a worker reads task code. Every fleet member repeats much of that read. The two-brain process then archives the full Sol original and a separate memo (`.claude/skills/two-brain/SKILL.md:12-17`).
- **Why it matters:** context cost, latency, contradictions, and stale search results rise with every round. “File-system manageability” fails when the correct file cannot be identified cheaply.
- **Impact × effort:** **High recurring × M — structural.**
- **Concrete fix:** generate a ≤300-line agent law bundle; path-based routing tells workers which playbook sections and current specs apply; frontmatter marks status/supersession/effective SHA; archived plans leave default search; one decision ledger links originals rather than copying status facts into every layer.

---

# V. Agent operations and two-brain findings

## A-01 — One orchestrator session is the fleet's single control plane

- **What:** the chief owns architecture, work orders, final review, and founder decisions (`.claude/skills/fleet-orchestration/SKILL.md:10-24`); two-brain adjudication explicitly cannot be delegated (`.claude/skills/two-brain/SKILL.md:10-17`). Worker handoff is reduced to SHA/count/checklist (`.claude/skills/fleet-orchestration/SKILL.md:44-53`). There is no durable DAG with prompt hash, owner, model, branch, status, heartbeat, evidence, budget, dependencies, decisions, and takeover instructions. Codex runs outside the Workflow fleet (`.claude/skills/fleet-orchestration/SKILL.md:17,69-83`).
- **Why it matters:** if the orchestrator context dies, execution state, dependency graph, and unresolved adjudication die with it. Resuming a model run is not the same as recovering the project.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** durable `fleet-run.json`/database record per operation; immutable task/prompt hashes; statuses and heartbeats; input/output artifact paths; branch/SHA; tests/evidence; budget/usage; decision log; next action; named deputy. Product adjudication stays with the chief; operational state does not.

## A-02 — Shared-branch fleet mechanics normalize bypass and collision

- **What:** workers self-verify with `tsc`, then may `git pull --rebase && git push --no-verify` to the shared branch (`.claude/skills/fleet-orchestration/SKILL.md:46-53`). The skill already records collisions in shared files and cross-zone state blind spots (`.claude/skills/fleet-orchestration/SKILL.md:64-67`).
- **Why it matters:** `--no-verify` plus a shared moving target allows one worker to push code that has not passed the full machine gates and forces other workers to rebase across unreviewed changes. The 98-commit branch is the visible consequence.
- **Impact × effort:** **High × M — structural.**
- **Concrete fix:** one branch/PR per task; immutable base SHA; full scoped gates before handoff; integration bot/chief cherry-picks only accepted commits; shared files have a named owner, not “append at tail”; no worker pushes the integration or release branch directly.

## A-03 — Model routing is doctrine, not an optimization loop

- **What:** the fleet skill assigns Opus/Sonnet/Codex tiers by role and asks for warning before heavy runs (`.claude/skills/fleet-orchestration/SKILL.md:10-24,81-82`). It tracks no task-level token/quota budget, stop rule, accepted-finding yield, false-positive rate, rework commits, wall time, defect escape, or cost per accepted result.
- **Why it matters:** “Luna cheap, Sol sharp, Opus quality” can become folklore. Parallel fleets may spend more rereading context than solving work. Model upgrades/downgrades cannot be evidence-based without outcomes.
- **Impact × effort:** **Medium–High × S–M — quick measurement, structural routing.**
- **Concrete fix:** scorecard by task class/model: cost/quota, latency, accepted outputs, false positives, rework, escaped defects. Set per-task budgets and cancellation rules. Route by measured cost per accepted outcome; periodically rerun a fixed benchmark.

## A-04 — Two-brain protects against agreement bias and then ossifies too quickly

- **What:** the process correctly requires an independent adversarial answer and founder decision, but “确定即固化” immediately turns agreement into skill/law/verdict (`.claude/skills/two-brain/SKILL.md:12-17`). The strategic memo itself says policies are hypotheses requiring calibration (`docs/strategy/TWO-BRAIN-MEMO-2026-07.md:7-11`).
- **Why it matters:** architectural consensus is not production evidence. Immediate codification grows the constitution pyramid and makes trial hypotheses expensive to retire.
- **Impact × effort:** **High × S — governance quick win.**
- **Concrete fix:** lifecycle `proposal → trial → accepted → deprecated/retired`. Only safety law can skip trial. Product/policy decisions carry hypothesis, success metric, expiry, owner, evidence threshold, and retirement condition before entering law or a permanent skill.

## A-05 — This R4 orchestration duplicated discovery work

- **What:** three independent architecture lanes were useful for Design-It-Twice comparison, but each reread overlapping Otto/parity/governance material. The main orchestrator also repeated those reads. The useful diversity was in interface choices; duplicate repository archaeology was mostly waste. Until this final file was written, the only complete synthesis lived in one session.
- **Why it matters:** fleets burn context and quota on identical evidence gathering, then risk inconsistent line citations and counts.
- **Impact × effort:** **Medium × S — quick win.**
- **Concrete fix:** phase 1 produces an immutable evidence pack: facts, commands, counts, citations, unknowns. Phase 2 gives independent designers the same pack but forbids cross-reading proposals. Phase 3 has one critic attack all designs. Persist synthesis incrementally, not only at the final turn.

---

# VI. Product operations and cohort-readiness findings

## P-01 — Walk/UAT is a tour, not a repeatable acceptance system

- **What (dated observation):** the walk manual and then-proposed release smoke gate were prose checklists, while pre-walk evidence exposed broken journeys. Current acceptance must use the aligned Route-B gates and task-linked evidence, not this historical claim.
- **Why it matters:** every release re-pays human discovery cost; founder time is spent finding mechanics defects instead of judging product/effectiveness; results cannot be compared across builds.
- **Impact × effort:** **Critical × M — structural.**
- **Concrete fix:** executable canonical journeys with deterministic seeded tenants/data and mock providers. Playwright captures console/network/screenshots/traces and expected DB/receipt state. Minimum: login; Otto proposal→approval→job→live reflection; refresh/resume; schedule draft→queue; credit/idempotency; two-tenant denial; cross-zone state; rollback. Founder UAT begins only after mechanics are green and judges usefulness/taste.

## P-02 — There is no founding-cohort operating ledger

- **What:** the adopted strategy says one real commercial loop first, explicit exclusions, manual-path disclosure, operator-minute tracking, and evidence receipts (`docs/strategy/TWO-BRAIN-MEMO-2026-07.md:7-11,40-44,76-81`). The product lacks a single cohort dashboard tying merchant, enabled capability cell, exclusions, authority grants, work units, action receipts, outcomes, support time, incidents, and next review.
- **Why it matters:** the team cannot distinguish software value from founder/agent concierge labor, cannot price support load, and cannot tell whether an “AI employee” delivered a repeatable result.
- **Impact × effort:** **High × M — product ops.**
- **Concrete fix:** cohort contract + operations ledger: supported/excluded capabilities, authority cells, evidence grades, expected SLA, manual steps, operator minutes, incidents, costs, receipts, merchant-confirmed outcomes, renewal reason, kill criteria. Review weekly; feed policy calibration and roadmap.

## P-03 — Prototype breadth is being mistaken for launch evidence

- **What:** this branch adds over 60k lines across 267 files, dominated by Northstar mock/prototype surfaces. The walk manual explicitly says the prototype intentionally built many options for founder voting (`docs/northstar/WALK-MANUAL-ENDGAME.md:9-13`). Yet release and strategy documents increasingly speak in “built/online” language, while the QA report still shows systemic state and deep-link gaps (`docs/northstar/QA-REPORT-PREWALK.md:23-49`).
- **Why it matters:** polished mock breadth can create internal confidence without proving one production commercial loop, receipt, recovery, or retention.
- **Impact × effort:** **High × S decision / L implementation.**
- **Concrete fix:** stop measuring pages/features. Pick one founding-cohort work cell; define start state, authority, evidence, action, receipt, outcome, failure/recovery, and kill metric. Everything outside that cell is explicitly excluded or concierge-assisted until proven.

---

# VII. Top 10 by ROI

ROI here means risk/value removed per unit of effort, not strategic importance alone.

1. **Remove or legally clear Shotstack immediately.** Potential commercial blocker, no detected imports, tiny removal effort. Verify web/worker builds afterward. (`apps/web/package.json:13-21`; `pnpm-workspace.yaml:4-10`)
2. **Make worker verdict no-tool and one-step.** Immediate COGS reduction and least-capability improvement with a small change. (`apps/worker/src/otto-resume.ts:49-96`)
3. **Stop source merge → prod rebuild/migration; finish staging isolation.** Critical blast-radius reduction for medium effort. Promote one tested immutable artifact. (`apps/web/Dockerfile:30-35`; `docs/runbooks/staging.md:45-91,119-129`)
4. **Prove alerts and recovery rather than documenting them.** Dedicated backup bucket, restore drill, backup-age/queue/job alarms, real alert fire test. (`docs/runbooks/db-backup.md:20-45`; `docs/ops/incident-visibility.md:9-33,50-54`)
5. **Add five to seven executable browser journeys.** Converts 2,332 implementation tests into launch confidence and protects founder UAT time. (`apps/web/vitest.config.ts:21-29`; `docs/northstar/QA-REPORT-PREWALK.md:1-49`)
6. **Replace parity strings with capability-by-construction and freeze exact legacy debt IDs.** Removes false green status and prevents new debt structurally. (`scripts/check-parity.mjs:129-180`; `packages/otto/src/parity-manifest.ts:77-110,165-173,221-226`)
7. **Fix real actor identity and add the DecisionRecord/ActionReceipt spine.** Small actor fix unlocks multi-seat audit; receipt spine implements the product's authorization→evidence thesis. (`packages/otto/src/context.ts:22-29`; `apps/web/lib/otto-actions.ts:236-240`; `docs/strategy/TWO-BRAIN-MEMO-2026-07.md:7-11`)
8. **Ship stable scoped bundles with scoped instructions and pinned state.** Reduces per-turn cost/tool error without weakening resume. (`packages/otto/src/otto.ts:15-20`; `packages/db/prisma/schema.prisma:827-846`)
9. **Build tenant-scoped capability repositories and fail closed.** Higher effort, but mandatory before multi-tenant scale. (`packages/db/src/tenant-guard.ts:3-8,36-69`)
10. **Durable fleet/governance facts.** One evidence pack, one run DAG, generated status, PR size/age budgets. Recovers recurring agent cost and prevents another 98-commit branch. (`.claude/skills/fleet-orchestration/SKILL.md:28-53`; `AGENTS.md:54-61`)

Strategic note: the versioned policy/calibration system is the long-term moat and belongs immediately after the capability/receipt spine. It ranks below several quick operational fixes on ROI only because it is a larger build.

---

# VIII. The three to do before taking founding-cohort money

## 1. Commercial/legal gate — remove the unused restricted dependency

Definition of done:

- Shotstack studio/canvas and `ffmpeg-static` transitive are absent from production dependency graph and allow-build config, **or** written legal clearance/commercial grant covers the exact FIKIRTIVE use and distribution.
- Production license allowlist/SBOM gate exists.
- Web and worker production images build after removal/replacement.

Do not take customer money while an apparently unused non-compete dependency sits in the shipped graph.

## 2. Release-control gate — one candidate artifact, isolated staging, executable UAT, tested rollback

Definition of done:

- `main` cannot directly deploy or migrate production.
- CI builds immutable web/worker images once; staging and prod use the same digests.
- Mock staging has no paid/live provider credentials and no production bucket.
- The founding-cohort canonical journey passes in Playwright against the release candidate, including refresh/resume, credit/idempotency, and expected receipt state.
- Explicit migration job and rollback/canary drill are proven.

## 3. Failure-containment gate — tenant denial, restore proof, and alarms that actually fire

Definition of done:

- Every cohort-visible capability has a reviewed shared action path and a two-tenant denial test; unsupported Otto actions are contractually excluded, not falsely mapped in parity.
- Latest backup restores into a disposable database and ledger/schema/business counts reconcile; backup uses an independent bucket/credential.
- Web-down, worker-stale, backup-old, queue-old, paid-job-failure, and credit-invariant alarms are fired in a drill and reach a named human.

Do **not** block the first cohort on the complete Otto architecture rewrite. Constrain the cohort to one honest commercial cell, manually verify that cell's action/evidence/authority path, and exclude the rest. Then build the capability/policy/engine architecture behind real receipts and outcomes instead of another speculative city-wide refactor.
