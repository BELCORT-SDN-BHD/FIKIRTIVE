// Pure validators for Meta ad build specs. Server-side builder. No side-effects.

import { buildApproval, type Approval } from "./meta-approval";

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

// ---------------------------------------------------------------------------
// AdBuildInput / MetaAdBuildCardPayload / buildAdBuildCard
// ---------------------------------------------------------------------------

export type AdBuildInput = {
  goal: string;
  reasoning: string;
  mode: "create" | "into_existing";
  objective: string;
  pageId: string;
  targetingHint?: TargetingHint;
  dailyBudgetMinor: number;
  startTime?: string;
  creative: {
    assetId: string;
    kind: "image" | "video";
    message: string;
    headline?: string;
    cta: string;
    link: string;
  };
  intoExisting?: { adsetId: string };
};

export type MetaAdBuildCardPayload = {
  goal: string;
  reasoning: string;
  mode: "create" | "into_existing";
  objective: BuildObjective;
  accountId: string;
  currency?: string;
  pageId: string;
  igAccountId?: string;
  targeting: Record<string, unknown>;
  dailyBudgetMinor: number;
  startTime?: string;
  creative: {
    assetId: string;
    kind: "image" | "video";
    message: string;
    headline?: string;
    cta: string;
    link: string;
  };
  intoExisting?: { adsetId: string };
  approval: Approval;
  buildOutcome?: Record<string, unknown>;
};

/**
 * Builds a frozen, validated BUILD card payload from LLM-proposed input + server-resolved ctx.
 * Throws a clear Error on any validation failure — never produces an invalid payload.
 */
export function buildAdBuildCard(
  input: AdBuildInput,
  ctx: {
    accountId: string;
    currency?: string;
    assetExists: boolean;
    assetKind: "image" | "video";
    pageValid: boolean;
    adsetValid: boolean;
  },
  actor: string,
  nowIso: string
): MetaAdBuildCardPayload {
  // Server-side validation — fail closed
  if (!isSupportedObjective(input.objective)) {
    throw new Error(`unsupported objective: ${input.objective}`);
  }
  if (!isValidHttpUrl(input.creative.link)) {
    throw new Error(`invalid link: ${input.creative.link}`);
  }
  if (!(input.dailyBudgetMinor > 0)) {
    throw new Error(`invalid budget: dailyBudgetMinor must be > 0`);
  }
  if (!ctx.assetExists) {
    throw new Error(`unknown asset: ${input.creative.assetId}`);
  }
  if (input.creative.kind !== ctx.assetKind) {
    throw new Error(
      `asset kind mismatch: input says ${input.creative.kind} but asset is ${ctx.assetKind}`
    );
  }
  if (!ctx.pageValid) {
    throw new Error(`invalid page: ${input.pageId}`);
  }
  if (input.mode === "into_existing") {
    if (!input.intoExisting?.adsetId) {
      throw new Error("into_existing requires intoExisting.adsetId");
    }
    if (!ctx.adsetValid) {
      throw new Error(`invalid ad set: ${input.intoExisting.adsetId}`);
    }
  }

  // Server-shaped fields (objective validated above; targeting shaped from hint)
  const objective = input.objective as BuildObjective;
  const targeting = shapeTargeting(input.targetingHint);

  // Approval binds the resolved build step
  const approval = buildApproval(
    [
      {
        index: 0,
        op: "build",
        targetId: input.creative.assetId,
        targetValue: {
          objective,
          dailyBudgetMinor: input.dailyBudgetMinor,
          pageId: input.pageId,
          mode: input.mode,
          adsetId: input.intoExisting?.adsetId ?? null,
        },
      },
    ],
    actor,
    nowIso,
    10 * 60 * 1000
  );

  const payload: MetaAdBuildCardPayload = {
    goal: input.goal,
    reasoning: input.reasoning,
    mode: input.mode,
    objective,
    accountId: ctx.accountId,
    pageId: input.pageId,
    targeting,
    dailyBudgetMinor: input.dailyBudgetMinor,
    creative: { ...input.creative },
    approval,
  };

  if (ctx.currency !== undefined) {
    payload.currency = ctx.currency;
  }
  if (input.startTime !== undefined) {
    payload.startTime = input.startTime;
  }
  if (input.intoExisting !== undefined) {
    payload.intoExisting = input.intoExisting;
  }

  return payload;
}
