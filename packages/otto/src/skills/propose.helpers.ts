/**
 * propose.helpers — pure, DB-free helpers for the propose tool.
 *
 * ZERO imports from @fikirtive/db or @openai/agents — fully unit-testable
 * without any mocking. DB and SDK wiring live in propose.ts.
 */
import { z } from "zod";
import {
  suggestModel,
  videoPriceUsd,
  GEN_PRICE_USD_PER_IMAGE,
  MAX_GEN_PROMPT,
  MAX_GEN_COUNT,
  displayCredits,
  CREDITS_PER_USD,
  type GenVideoModel,
} from "@fikirtive/core";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Input schema (what the LLM provides) — re-exported for propose.ts
// ---------------------------------------------------------------------------
export const proposeInput = z.object({
  kind: z.enum(["image", "video"]),
  structuredPrompt: z.string().min(1).max(MAX_GEN_PROMPT),
  entityIds: z.array(z.string()).default([]),
  variantSel: z.record(z.string(), z.string()).default({}),
  desiredAspect: z.string().optional(),
  desiredDuration: z.number().optional(),
  desiredAudio: z.boolean().optional(),
  // Ad pack: how many image options to offer the user to choose from (images only;
  // video is always one clip). Clamped server-side to [1, MAX_GEN_COUNT].
  count: z.number().int().min(1).max(MAX_GEN_COUNT).optional(),
});

export type ProposeInput = z.infer<typeof proposeInput>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CardPayload = {
  kind: "image" | "video";
  model: string;
  params: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    audio?: boolean;
    count: number;
  };
  reason: string;
  downgraded: boolean;
  structuredPrompt: string;
  entityIds: string[];
  variantSel: Record<string, string>;
  estimatedPriceUsd: number;
  sourceGenerationId?: string;
};

export type ProposeCardResult = {
  cardPayload: CardPayload;
  shownPriceDisplay: number;
};

// ---------------------------------------------------------------------------
// Pure helper — no DB, no SDK
// ---------------------------------------------------------------------------

/**
 * Pure helper: compute the GEN_CARD payload from validated inputs.
 * No prisma, no SDK imports — all DB interactions live in executePropose().
 *
 * @param input          - Raw LLM input (already zod-parsed by the SDK)
 * @param ctx            - OttoContext from the run (identity never comes from input)
 * @param ownedEntityIds - Entity ids confirmed owned by ctx.orgId (DB lookup done by caller)
 */
export function buildProposeCard(
  input: Pick<ProposeInput, "kind" | "structuredPrompt" | "entityIds" | "variantSel" | "desiredAspect" | "desiredDuration" | "desiredAudio" | "count">,
  ctx: OttoContext,
  ownedEntityIds: string[],
): ProposeCardResult {
  // Step 1: i2v coercion (mirror coworkTurn 375–383)
  let kind = input.kind;
  let entityIds = input.entityIds;
  let variantSel = input.variantSel;
  let hasSourceImage = false;

  if (ctx.sourceGenerationId) {
    kind = "video";
    entityIds = [];
    variantSel = {};
    hasSourceImage = true;
  }

  // Step 2: entityId scoping — keep only owned ids, drop foreign ones silently
  if (!hasSourceImage) {
    const ownedSet = new Set(ownedEntityIds);
    entityIds = entityIds.filter((id) => ownedSet.has(id));
    const filteredVarSel: Record<string, string> = {};
    for (const [k, v] of Object.entries(variantSel)) {
      if (ownedSet.has(k)) filteredVarSel[k] = v;
    }
    variantSel = filteredVarSel;
  }

  // Step 3: model selection
  const sm = suggestModel({
    kind,
    desiredAspect: input.desiredAspect,
    desiredDuration: input.desiredDuration,
    desiredAudio: input.desiredAudio,
    hasSourceImage,
    hasTail: false,
    disabled: new Set(ctx.disabledModels),
  });

  // Step 3.5: ad-pack count — the user can ask for N image options to choose from.
  // Images only (video stays a single clip). The count lives on the FROZEN card
  // (params.count) and drives BOTH the displayed price (unit × count, Step 4) and
  // the worker's image loop, so the reservation equals the settlement for any N.
  // Clamped to [1, MAX_GEN_COUNT] here; the spend-input validator re-checks the bound.
  if (kind === "image" && typeof input.count === "number") {
    sm.params.count = Math.min(Math.max(Math.trunc(input.count), 1), MAX_GEN_COUNT);
  }

  // Step 4: price computation (mirror coworkTurn 398–400)
  const price =
    kind === "video"
      ? videoPriceUsd(sm.model as GenVideoModel, {
          seconds: sm.params.durationSeconds ?? 1,
          resolution: sm.params.resolution ?? "",
          audio: !!sm.params.audio,
          count: sm.params.count,
        })
      : GEN_PRICE_USD_PER_IMAGE * sm.params.count;

  // Step 5: cardPayload (mirror coworkTurn 401–406)
  const cardPayload: CardPayload = {
    kind,
    model: sm.model,
    params: sm.params,
    reason: sm.reason,
    downgraded: sm.downgraded,
    structuredPrompt: input.structuredPrompt,
    entityIds,
    variantSel,
    estimatedPriceUsd: price,
    ...(ctx.sourceGenerationId ? { sourceGenerationId: ctx.sourceGenerationId } : {}),
  };

  // Step 6: displayed credit amount
  const shownPriceDisplay = displayCredits(Math.round(price * CREDITS_PER_USD));

  return { cardPayload, shownPriceDisplay };
}
