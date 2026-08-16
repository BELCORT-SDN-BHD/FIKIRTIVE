/**
 * otto.ts — the PRODUCTION composition root (engine spec §6.2, WO-OTTO-PHASE1).
 *
 * The one place server-owned code composes the production runtime: the Anthropic
 * model-runtime manifest (model.ts) and the full static skill registry, bound via
 * createOttoRuntime. Composed at module load (process bootstrap) and frozen — no
 * request, env flip, or client signal can re-compose it (PH1-A5). Fixture/CLI
 * runtimes are SEPARATE test compositions (see runtime.test.ts); the production
 * artifact composes only this.
 *
 * #952 — createOttoRuntime's three profiles ("interactive" / "approval-resume" /
 * "eval") only ever limited tools/steps, and every profile carries the same full
 * toolset at OTTO_MAX_STEPS (#791-4 removed the one profile that didn't). So the
 * two profiles production actually composes produced byte-identical runtimes —
 * two separate `Agent` instances with the same name/instructions/tools/model, for
 * no behavioral difference. Composing ONCE and exporting the SAME object under both
 * names removes that duplicate construction without touching the B9 full-toolset
 * recovery rule (still every skill, still OTTO_MAX_STEPS) or the resume behavior
 * itself: `tryRestoreRunStateWithContext` only needs an agent whose tools resolve
 * the same names, not the exact `new Agent(...)` instance that parked the state —
 * runtime.test.ts's "restores an old-construction SDK state…" case already proves
 * that by resuming against a THIRD, independently built Agent.
 */
import { allSkills } from "./registry.js";
import { ottoInstructions } from "./instructions.js";
import { ottoModelRuntime, OTTO_DEFAULT_MODEL } from "./model.js";
import { createOttoRuntime, type OttoRuntimeDeps } from "./runtime.js";

/** Re-exported for credit price lookup back-compat. The manifest (model.ts
 *  ottoModelRuntime.billableModelId) is the billing source of truth. */
export { OTTO_DEFAULT_MODEL };

/** Otto's durable identity + creative rules. Inlined as a TS constant (see instructions.ts) —
 *  NOT a runtime file read, so it loads in Next/Turbopack (web), tsx (worker), dist, and vitest. */
export { ottoInstructions };

/** The production deps: ONE manifest + the full registry. */
const productionOttoDeps: OttoRuntimeDeps = Object.freeze({
  modelRuntime: ottoModelRuntime,
  skills: allSkills,
});

/** Fresh + stream + approval-resume turns (web): full toolset, OTTO_MAX_STEPS. */
export const ottoInteractiveRuntime = createOttoRuntime(productionOttoDeps, "interactive");

/** Approval-resume turns (web ottoApprove) — the SAME composed runtime as
 *  ottoInteractiveRuntime (see file docblock): full toolset per the frozen B9
 *  recovery rule (恢复轮全量装载), OTTO_MAX_STEPS. Restore + resume use THIS
 *  runtime's agent. Kept as its own export name for call-site clarity. */
export const ottoApprovalResumeRuntime = ottoInteractiveRuntime;

/** The legacy singleton — now the interactive runtime's production agent instance.
 *  Kept for RunState restore sites and back-compat imports. */
export const otto = ottoInteractiveRuntime.agent;
