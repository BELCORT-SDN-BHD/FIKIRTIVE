/**
 * Pure builder: card payload → genRequest input.
 *
 * Extracted from `coworkGenerate` (apps/web/lib/cowork-actions.ts lines 545–565).
 * This file MUST remain pure — no @artlio/db, no apps/* imports, no Prisma.
 * The logic is behavior-identical to the original: same field order, same
 * spread/conditional patterns, same fallback chain.
 */
import { coworkProposalSchema } from "./cowork.js";
import { GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "./gen.js";

/** The assembled genRequest object that `buildGenRequestFromCard` returns on success.
 *  Exported for use in OttoContext.startGen (packages/otto cannot import apps/*). */
export type GenRequestInput = Record<string, unknown>;

export function buildGenRequestFromCard(args: {
  cardPayload: unknown;
  projectId: string;
  threadId: string;
  cardId: string;
  prompt: string;
  entityIds: string[];
  variantSel: Record<string, string>;
  overrides?: {
    model?: string;
    count?: number;
    durationSeconds?: number | null;
    resolution?: string | null;
    aspectRatio?: string | null;
    audio?: boolean | null;
  };
}): { ok: true; req: Record<string, unknown> } | { ok: false; error: string } {
  const { cardPayload, projectId, threadId, cardId, prompt, entityIds, variantSel, overrides } = args;

  // Step 1: re-validate the persisted proposal subset (mirrors coworkGenerate line 501–502).
  const p = (cardPayload ?? {}) as Record<string, unknown>;
  const proposal = coworkProposalSchema.safeParse({
    kind: p.kind,
    desiredAspect: p.desiredAspect,
    desiredDuration: p.desiredDuration,
    desiredAudio: p.desiredAudio,
    structuredPrompt: p.structuredPrompt,
    entityIds: p.entityIds ?? [],
    variantSel: p.variantSel ?? {},
  });
  if (!proposal.success) return { ok: false, error: "This card is no longer valid." };

  // Step 2: model must be a non-empty string (mirrors coworkGenerate line 503–505).
  const model = typeof p.model === "string" ? p.model : null;
  if (!model) return { ok: false, error: "This card is missing a model." };

  // Step 3: extract params and sourceGenerationId (mirrors coworkGenerate lines 504, 508).
  const params = (p.params ?? {}) as {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    audio?: boolean;
    count?: number;
  };
  const sourceGenerationId = typeof p.sourceGenerationId === "string" ? p.sourceGenerationId : null;

  // Step 4: chosen model (mirrors coworkGenerate line 517).
  const chosenModel = overrides?.model ?? model;

  // Step 5: audioToggle (mirrors coworkGenerate lines 545–547).
  const audioToggle =
    proposal.data.kind === "video" && (GEN_VIDEO_MODELS as readonly string[]).includes(chosenModel)
      ? GEN_VIDEO_MODEL_OPTIONS[chosenModel as GenVideoModel].audioToggle
      : false;

  // Step 6: count (mirrors coworkGenerate line 555).
  const count = proposal.data.kind === "video" ? 1 : (overrides?.count ?? params.count ?? 1);

  // Step 7: assemble the request object — field order and spread patterns identical to
  // coworkGenerate lines 548–565 (the critical byte-identical requirement).
  const ov = overrides;
  const req = {
    projectId,
    threadId,
    prompt,
    entityIds,
    ...(Object.keys(variantSel).length ? { variantSel } : {}),
    ...(sourceGenerationId ? { sourceGenerationId } : {}),
    count,
    kind: proposal.data.kind, // CARD-trusted — anti-flip
    model: chosenModel,
    ...(proposal.data.kind === "video"
      ? {
          durationSeconds: ov?.durationSeconds ?? params.durationSeconds ?? null,
          resolution: ov?.resolution ?? params.resolution ?? null,
          aspectRatio: ov?.aspectRatio ?? params.aspectRatio ?? null,
          ...(audioToggle ? { audio: ov?.audio ?? params.audio ?? null } : {}),
        }
      : {}),
    idempotencyKey: `cowork:${cardId}`,
  };

  return { ok: true, req };
}
