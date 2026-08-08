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

/** The legacy singleton — now the interactive runtime's production agent instance.
 *  Kept for RunState restore sites and back-compat imports. */
export const otto = ottoInteractiveRuntime.agent;
