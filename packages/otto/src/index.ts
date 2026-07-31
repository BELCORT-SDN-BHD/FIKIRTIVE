export {
  otto,
  ottoVerdict,
  ottoInstructions,
  OTTO_DEFAULT_MODEL,
  ottoInteractiveRuntime,
  ottoApprovalResumeRuntime,
  ottoWorkerVerdictRuntime,
} from "./otto.js";
export { ottoModelRuntime } from "./model.js";
export {
  createOttoRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  ottoBudgetArgsFor,
  noopTraceSink,
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
export { propose } from "./skills/propose.js";
// buildProposeCard — the pure $0 card-payload helper (no DB/SDK). Exposed for the
// web gate① child-card minting layer (storyboard-gate1-actions), which prices minted
// children through the SAME path as a normal propose. Types travel with it.
export { buildProposeCard } from "./skills/propose.js";
export type { CardPayload, ProposeCardResult } from "./skills/propose.js";
export { generate } from "./skills/generate.js";
export { updateBrief } from "./skills/update-brief.js";
export { describeRefs, sanitizeRefDescription } from "./skills/describe-refs.js";
export { setTitle } from "./skills/set-title.js";
export type { OttoContext, EntityType, LibraryItemView, LibraryHistoryView } from "./context.js";
export { buildUserTurn, stripHistoryImages, sanitizeHistory, tryRestoreRunState, tryRestoreRunStateWithContext } from "./run-input.js";
export type { RefImage } from "./run-input.js";
export { extractText } from "./run-output.js";
export { withLlmBudget, actualCostInternal, mapOttoUsage } from "./meter.js";
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
export { PROMPT_SKILLS, PROMPT_SKILLED_FAMILIES, familyHasPromptSkill } from "./prompt-skills.js";
export { defineOttoSkill, deriveNeedsApproval } from "./skill.js";
export type { OttoSkill, OttoSkillSpec, Cost, Effect, Reach } from "./skill.js";
export type { StoryboardCardPayload, StoryboardCardInput } from "./skills/propose-storyboard.helpers.js";
export { MAX_STORYBOARD_SHOTS } from "./skills/propose-storyboard.helpers.js";
// storyboard-edit — the PURE storyboard edit transforms (no DB/SDK), the single edit-semantics
// authority shared by the human server actions (apps/web/lib/storyboard-actions.ts via the
// re-export shim apps/web/lib/storyboard-edit.ts) and the editStoryboard skill (W-B3-C).
export { applyEditShotPrompt, applyAddShot, applyDeleteShot, applyReorderShots } from "./storyboard-edit.js";
export type { ShotPromptPatch, NewShotInput } from "./storyboard-edit.js";
export { editStoryboard, editStoryboardSkill } from "./skills/edit-storyboard.js";
export { proposeResearch, proposeResearchSkill } from "./skills/propose-research.js";
export type { ResearchCardPayload, ResearchCardInput } from "./skills/propose-research.helpers.js";
export { RESEARCH_TIERS, researchTierEstimate, researchTierBudgetInternal } from "./skills/propose-research.helpers.js";
// researchAgent — the bounded research agent + its FREE tools (S3 Task 2). The worker runs it
// inside withLlmBudget (the sole spend path). Its context is small + mutable (counters, sources).
export { researchAgent, searchSources, readSource } from "./research-agent.js";
export type { ResearchContext } from "./research-agent.js";
export {
  META_EXPERTISE_KB, validateKnowledgeBase, queryMetaKnowledge, getBenchmark,
} from "./knowledge/meta-expertise.js";
export type {
  MetaExpertiseKB, MetaKnowledgeDomain, MetaCitation, MetaBenchmark, MetaKnowledgeEntry,
} from "./knowledge/meta-expertise.types.js";
export { diagnosePerformance } from "./diagnosis/diagnose-performance.js";
export type { DiagAdInput, DiagReason, DiagReasonKind, AdVerdict, PerformanceDiagnosis } from "./diagnosis/diagnose-performance.js";
export { buildPerformanceCardPayload } from "./skills/meta-expert.helpers.js";
export type { PerformanceCardPayload, PerfCardAd } from "./skills/meta-expert.helpers.js";
