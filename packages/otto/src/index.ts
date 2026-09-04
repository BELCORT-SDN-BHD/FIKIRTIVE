export {
  otto,
  ottoInstructions,
  OTTO_DEFAULT_MODEL,
  ottoInteractiveRuntime,
  ottoApprovalResumeRuntime,
} from "./otto.js";
export { ottoModelRuntime } from "./model.js";
export {
  createOttoRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  ottoBudgetArgsFor,
} from "./runtime.js";
export type {
  OttoRunProfile,
  OttoModelRuntime,
  OttoRuntimeDeps,
  OttoRuntime,
  OttoRuntimeExecution,
  OttoTurnRequest,
  OttoTurnRunResult,
  OttoTurnFinalization,
} from "./runtime.js";
export { ottoSimpleModeBlock } from "./instructions.js";
// buildProposeCard — the pure $0 card-payload helper (no DB/SDK). Exposed for the
// web gate① child-card minting layer (storyboard-gate1-actions), which prices minted
// children through the SAME path as a normal propose. Types travel with it.
export { buildProposeCard } from "./skills/propose.js";
// anchoredClipLines — the two official sentences an edit/extend prompt opens with
// (#775). Exposed for #922 缺口 A: the merchant-facing "Edit this clip" / "Continue this
// clip" entry mints the same anchored card from the merchant's own words, and must open
// it with the SAME assembler the Otto path uses — a second copy of the official phrasing
// would drift away from `anchoredVideoAction`, the money-path judge that reads it.
export { anchoredClipLines } from "./skills/seedance-prompt.helpers.js";
// ProposeRefusal — the base class BOTH card-minting refusals inherit (engine turned off,
// or this turn's shape cannot carry what the prompt asks for). Entry points catch the
// BASE class, never the individual reasons, so adding a third refusal cannot leave one
// entry silently uncaught (#775 · #647 T6). Exposed for the #922 缺口 A minting entry.
export { ProposeRefusal } from "./skills/propose.js";
export type { CardPayload, ProposeCardResult } from "./skills/propose.js";
// Codex staging CRE-STG-P1-003 —— 卡上一条参考回执的形状(服务端那一份 + 它的角色)。
// 角色的闭集本身在 `@fikirtive/core/reference-budget`,前端从那条子路径读。
export type { CardMediaReference } from "./skills/propose.helpers.js";
export { sanitizeRefDescription } from "./skills/describe-refs.js";
export type { OttoContext, OttoMediaReference, OttoSearchSlots, EntityType, LibraryItemView, LibraryHistoryView } from "./context.js";
export { buildUserTurn, stripHistoryImages, sanitizeHistory, tryRestoreRunState, tryRestoreRunStateWithContext } from "./run-input.js";
export type { RefImage } from "./run-input.js";
export { extractText } from "./run-output.js";
export { withLlmBudget, llmHoldInternal, actualCostInternal, mapOttoUsage, ReservationNotClaimed, ClaimFailed, SettleLostToRefund, type LlmBudgetArgs } from "./meter.js";
export type { TokenUsage } from "./meter.js";
// Re-export SDK primitives needed by web callers (Task 1.8 / streaming)
export { run, RunState, MaxTurnsExceededError } from "@openai/agents";
export type {
  AgentInputItem,
  RunStreamEvent,
  StreamedRunResult,
} from "@openai/agents";
export { allSkills, skillCatalog } from "./registry.js";
export { APPROVAL_TOOL_NAMES, approvalRefOf, collectApprovalInterruptions } from "./approval-tools.js";
export type { ApprovalInterruption } from "./approval-tools.js";
export type { SkillMeta } from "./registry.js";
export { familyHasPromptSkill } from "./prompt-skills.js";
export { defineOttoSkill, deriveNeedsApproval } from "./skill.js";
export type { OttoSkill, OttoSkillSpec, Cost, Effect, Reach } from "./skill.js";
export type { StoryboardCardPayload, StoryboardCardInput } from "./skills/propose-storyboard.helpers.js";
export { MAX_STORYBOARD_SHOTS } from "./skills/propose-storyboard.helpers.js";
// storyboard-edit — the PURE storyboard edit transforms (no DB/SDK), the single edit-semantics
// authority shared by the human server actions (apps/web/lib/storyboard-actions.ts via the
// re-export shim apps/web/lib/storyboard-edit.ts) and the editStoryboard skill (W-B3-C).
export { applyEditShotPrompt, applyAddShot, applyDeleteShot, applyReorderShots, applySetContinuity } from "./storyboard-edit.js";
export { editStaleness } from "./storyboard-edit.js";
export type { ShotPromptPatch, NewShotInput, EditStaleness } from "./storyboard-edit.js";
export { editStoryboardSkill } from "./skills/edit-storyboard.js";
// storyboard-child-job — 「一张子卡背后那条作业此刻算不算在途」的**唯一**判定(#782 r15,
// 判官 r14 P1)。与上面的纯变换同一条理由住在这里:编辑有三个执行器(人工 server action、
// editStoryboard skill、闸① 的 prepare/regen),而判定只能有一份。读库,不花钱。
export {
  lockCardTx,
  childJobFor,
  firstGenerationIdOf,
  isExhausted,
  isUnconsumedInFlight,
  inFlightPointerBlock,
  JOB_DEAD_STATUSES,
  JOB_LIVE_STATUSES,
  VIDEO_IN_FLIGHT_EDIT_BLOCK,
  FRAME_IN_FLIGHT_EDIT_BLOCK,
  // #925 —— 父卡不指着的子卡不许开销(confirm 侧的唯一校验入口)。
  assertStoryboardParentPointer,
  PARENT_POINTER_STALE_MESSAGE,
} from "./storyboard-child-job.js";
export type { ChildJob, PrismaTx } from "./storyboard-child-job.js";
export { proposeResearchSkill } from "./skills/propose-research.js";
export type { ResearchCardPayload, ResearchCardInput } from "./skills/propose-research.helpers.js";
export {
  RESEARCH_TIERS,
  researchTierEstimate,
  researchTierBudgetInternal,
  researchTierSearchBudgetInternal,
} from "./skills/propose-research.helpers.js";
// researchAgent — the bounded research agent + its two tools (S3 Task 2): readSource is free,
// searchSources is CHARGED (钱路 M1-c). The worker runs it inside withLlmBudget (the sole spend
// path). Its context is small + mutable (counters, sources) — and `searchesUsed` is what the
// search fee settles against, so that counter is money, not just telemetry.
export { researchAgent, searchSources, readSource } from "./research-agent.js";
export type { ResearchContext } from "./research-agent.js";
// validateKnowledgeBase stays package-internal: its one caller is the KB's own test, which
// holds the citation floor on the shipped data. It was never consumed outside this package.
export {
  META_EXPERTISE_KB, queryMetaKnowledge,
} from "./knowledge/meta-expertise.js";
export type {
  MetaExpertiseKB, MetaKnowledgeDomain, MetaCitation, MetaBenchmark, MetaKnowledgeEntry,
} from "./knowledge/meta-expertise.types.js";
export { diagnosePerformance } from "./diagnosis/diagnose-performance.js";
export type { DiagAdInput, DiagReason, DiagReasonKind, AdVerdict, PerformanceDiagnosis } from "./diagnosis/diagnose-performance.js";
export { buildPerformanceCardPayload } from "./skills/meta-expert.helpers.js";
export type { PerformanceCardPayload, PerfCardAd } from "./skills/meta-expert.helpers.js";
