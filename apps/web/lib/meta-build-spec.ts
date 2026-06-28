// Pure validators for Meta ad build specs. No imports beyond types. No side-effects.

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export type BuildObjective =
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_LEADS"
  | "OUTCOME_SALES";

export const SUPPORTED_OBJECTIVES: readonly BuildObjective[] = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
];

export function isSupportedObjective(s: string): s is BuildObjective {
  return (SUPPORTED_OBJECTIVES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export type TargetingHint = {
  countries?: string[];
  cities?: string[];
  ageMin?: number;
  ageMax?: number;
  interests?: string[];
};

/**
 * Map a TargetingHint to a valid Meta targeting spec.
 * Broad default is MY (Malaysia, the founder's market) when no countries are given
 * or when the hint is empty/undefined.
 */
export function shapeTargeting(hint: TargetingHint | undefined): Record<string, unknown> {
  const h = hint ?? {};
  const countries = h.countries?.length ? h.countries : ["MY"];
  const geoLocations: Record<string, unknown> = { countries };
  if (h.cities?.length) {
    geoLocations.cities = h.cities;
  }

  const spec: Record<string, unknown> = { geo_locations: geoLocations };
  if (h.ageMin !== undefined) spec.age_min = h.ageMin;
  if (h.ageMax !== undefined) spec.age_max = h.ageMax;
  if (h.interests?.length) {
    // v1 minimal: wrap in flexible_spec array
    spec.flexible_spec = [{ interests: h.interests }];
  }
  return spec;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/** Returns true only for http:// or https:// URLs. */
export function isValidHttpUrl(s: string): boolean {
  if (!s) return false;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
