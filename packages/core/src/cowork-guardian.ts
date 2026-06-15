/**
 * consistencyGuardian (Phase 2) — the pure cast-consistency decision. Given the
 * @mentioned entities a generation would condition on (already loaded with live
 * ref counts) + the family's cast rule, return the HARD findings that should
 * block a paid generation BEFORE spend. Pure + total: no DB, no throw — the web
 * `checkCast` does the loading and stays fail-OPEN around this.
 *
 * Hard findings only (v1): a missing/deleted @mention, a CHARACTER with no
 * reference images, and (when the founder set castSeverity:"block") 2+ characters
 * on a model that can't keep them distinct. A "warn" severity is NOT a Guardian
 * block — promptCoach surfaces that softly in the composer.
 */
export type CastFinding = {
  // missing-source and empty-variant are produced by the web checkCast (which loads
  // DB state), not by the pure castFindings below. missing-source = an i2v start/end
  // frame that isn't an owned same-project image; empty-variant = an @mentioned
  // variant that was deleted or has no live reference image to condition on.
  kind: "missing-entity" | "character-no-refs" | "multi-char-block" | "missing-source" | "empty-variant";
  entityId?: string;
  message: string;
};

export function castFindings(input: {
  requestedEntityIds: string[];
  entities: { id: string; name: string; type: string; liveRefCount: number }[];
  castRule?: "warn" | "block";
}): CastFinding[] {
  const findings: CastFinding[] = [];

  const loaded = new Set(input.entities.map((e) => e.id));
  for (const id of input.requestedEntityIds) {
    if (!loaded.has(id)) {
      findings.push({ kind: "missing-entity", entityId: id, message: "An @mentioned element was deleted or isn't in this project — remove it before generating." });
    }
  }

  for (const e of input.entities) {
    if (e.type === "CHARACTER" && e.liveRefCount === 0) {
      findings.push({ kind: "character-no-refs", entityId: e.id, message: `"${e.name}" is a character with no reference images — generating now would waste money on an unanchored result. Add a reference first.` });
    }
  }

  const characterCount = input.entities.filter((e) => e.type === "CHARACTER").length;
  if (characterCount >= 2 && input.castRule === "block") {
    findings.push({ kind: "multi-char-block", message: `This model can't keep ${characterCount} characters distinct — generate them in separate shots.` });
  }

  return findings;
}
