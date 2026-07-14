/**
 * otto.ts — the PRODUCTION composition root (engine spec §6.2, WO-OTTO-PHASE1).
 *
 * The one place server-owned code composes the production runtimes: the Anthropic
 * model-runtime manifest (model.ts), the full static skill registry, and the
 * privacy-minimal trace sink, bound per profile via createOttoRuntime. Runtimes are
 * composed at module load (process bootstrap) and frozen — no request, env flip, or
 * client signal can re-compose them (PH1-A5). Fixture/CLI runtimes are SEPARATE test
 * compositions (see runtime.test.ts); the production artifact composes only this.
 */
import { allSkills } from "./registry.js";
import { ottoInstructions } from "./instructions.js";
import { ottoModelRuntime, OTTO_DEFAULT_MODEL } from "./model.js";
import { createOttoRuntime, noopTraceSink, type OttoRuntimeDeps } from "./runtime.js";

/** Re-exported for credit price lookup back-compat. The manifest (model.ts
 *  ottoModelRuntime.billableModelId) is the billing source of truth. */
export { OTTO_DEFAULT_MODEL };

/** Otto's durable identity + creative rules. Inlined as a TS constant (see instructions.ts) —
 *  NOT a runtime file read, so it loads in Next/Turbopack (web), tsx (worker), dist, and vitest. */
export { ottoInstructions };

/** The production deps: ONE manifest + the full registry + the no-op trace sink. */
const productionOttoDeps: OttoRuntimeDeps = Object.freeze({
  modelRuntime: ottoModelRuntime,
  skills: allSkills,
  traceSink: noopTraceSink,
});

/** Fresh + stream turns (web): full toolset, OTTO_MAX_STEPS. */
export const ottoInteractiveRuntime = createOttoRuntime(productionOttoDeps, "interactive");

/** Approval-resume turns (web ottoApprove): full toolset per the frozen B9 recovery
 *  rule (恢复轮全量装载), OTTO_MAX_STEPS. Restore + resume use THIS runtime's agent. */
export const ottoApprovalResumeRuntime = createOttoRuntime(productionOttoDeps, "approval-resume");

/** Worker post-generation verdict (apps/worker/src/otto-resume.ts): ZERO tools, single step. */
export const ottoWorkerVerdictRuntime = createOttoRuntime(productionOttoDeps, "worker-verdict");

/** The legacy singleton — now the interactive runtime's production agent instance.
 *  Kept for RunState restore sites and back-compat imports. */
export const otto = ottoInteractiveRuntime.agent;

/**
 * ottoVerdict — the worker-verdict runtime's agent: an INDEPENDENT system profile used ONLY
 * by the worker's post-generation verdict turn (apps/worker/src/otto-resume.ts). It shares
 * Otto's durable identity (ottoInstructions), model, and output cap — so the verdict copy
 * keeps Otto's voice — but carries ZERO tools.
 *
 * Why a separate profile: the verdict turn only speaks one sentence ("does this look right?").
 * Running the full `otto` (the full 45-skill registry, up to OTTO_MAX_STEPS billed turns) just
 * to say that is COGS waste AND an over-privilege surface (a write/spend tool could be reached).
 * An empty toolset removes that surface entirely — no tool can be called — and lets the run
 * finish in a single step (the runner runs it with maxTurns:1 and reserves maxSteps:1).
 * Do NOT add tools here.
 */
export const ottoVerdict = ottoWorkerVerdictRuntime.agent;
