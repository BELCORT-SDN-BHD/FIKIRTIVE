/**
 * Pure model-registry helpers (OPT-6 P2). No prisma — core stays pure. The DB
 * read-through lives in apps/web/lib/model-registry.ts + apps/worker/src/model-
 * registry.ts; this file owns ONLY the set math. Capability truth is 100% typed
 * (the three catalogs); the overlay can NARROW (disable) but never widen.
 */
import { GEN_MODELS, GEN_VIDEO_MODELS } from "./gen.js";
import { REFGEN_MODELS } from "./refgen.js";

/** Deduped union of EVERY typed model catalog — the write-time validation domain
 *  for an overlay row, and the iteration source for the admin UI. REFGEN_MODELS is
 *  a SEPARATE catalog (do not omit it). seedream appears in GEN + REFGEN → deduped. */
export const ALL_MODEL_IDS: readonly string[] = Array.from(
  new Set<string>([...GEN_MODELS, ...GEN_VIDEO_MODELS, ...REFGEN_MODELS]),
);

const ALL_SET = new Set(ALL_MODEL_IDS);

/** True iff modelId is in some typed catalog. Write-time guard: an overlay can
 *  only disable a model the code actually knows about. */
export function isKnownModelId(modelId: string): boolean {
  return ALL_SET.has(modelId);
}

/** The typed video menu with the disabled ids removed. ALWAYS a subset of
 *  GEN_VIDEO_MODELS (a garbage disabled id can't add anything). */
export function enabledVideoModels(disabled: ReadonlySet<string>): string[] {
  return (GEN_VIDEO_MODELS as readonly string[]).filter((m) => !disabled.has(m));
}

/** Literal membership in the disabled set. Used at every spend chokepoint to
 *  reject a chosen model. (The typed-menu validity check stays the authority —
 *  this only narrows.) */
export function isModelDisabled(modelId: string, disabled: ReadonlySet<string>): boolean {
  return disabled.has(modelId);
}

/** Build a disabled set from overlay rows, dropping any id the code doesn't know
 *  about. This makes "unknown modelId ignored at read" literally true at the
 *  resolver boundary: a garbage id can never even enter the set. */
export function knownDisabledSet(ids: readonly string[]): Set<string> {
  return new Set(ids.filter(isKnownModelId));
}
