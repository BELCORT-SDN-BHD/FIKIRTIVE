/**
 * Pure gating rule for the "Add to Library" upload form (walkthrough P1-6).
 *
 * The Type field used to start pre-selected to REFERENCE_FORMATS[0] ("Avatar / Cast" →
 * CHARACTER), so a merchant who never touched the dropdown got a silently CHARACTER-typed
 * element for whatever they uploaded — a product photo included. That label isn't cosmetic:
 * it flows straight into the generation prompt as "Define the person in <Image_1>"
 * (packages/core/src/reference-budget.ts, SLOT_NOUN.CHARACTER = "person"), which is what
 * primes the engine's real-face check to fire on an inert product shot.
 *
 * Fix: no default. The merchant must pick a type before Add is enabled — the same honesty
 * rule createEntity's server action already enforces (`ENTITY_TYPES.has(type)`), just moved
 * one step earlier so the UI can't silently submit a guess.
 */
export const NO_TYPE_SELECTED = "";

export function canSubmitNewLibraryAsset(input: {
  name: string;
  type: string;
  fileCount: number;
  locked: boolean;
}): boolean {
  return (
    !input.locked &&
    input.name.trim().length > 0 &&
    input.type.trim().length > 0 &&
    input.fileCount > 0
  );
}
