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
  videoDefaults,
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_PRICE_USD_PER_IMAGE,
  GEN_VIDEO_SECONDS,
  REFERENCE_VIDEO_MODEL,
  MAX_GEN_PROMPT,
  MAX_GEN_COUNT,
  displayCredits,
  pricedGenCredits,
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
  // Set true when this image is the starting keyframe for a video the user asked for —
  // so the card shows the full two-step plan (image now, video next).
  forVideo: z.boolean().optional(),
  // 创作意图/目的 —— requires 资讯门要求它非空。琐碎请求可由 Otto 从上下文推断填入。
  goal: z.string().optional(),
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
  /** 内部/审计用的路由说明。**含引擎名**（`GEN_VIDEO_MODEL_INFO[…].label`），
   *  因此永远不得渲染到 UI。卡面渲染 `specSummary`。 */
  reason: string;
  /** `reason` 的脱敏版：同样的事实，去掉引擎名（引擎保密裁定）。
   *  这是卡面唯一可渲染的整句规格摘要。 */
  specSummary: string;
  downgraded: boolean;
  /** 仅当 `downgraded` 为 true 时存在：卡面必须显式展示的一行人话披露
   *  （"You asked for X — this will be Y."）。降级不得静默。 */
  downgradeNote?: string;
  structuredPrompt: string;
  entityIds: string[];
  variantSel: Record<string, string>;
  estimatedPriceUsd: number;
  /** The DISPLAYED charge in credits — the same pricedGenCredits value startGen reserves,
   *  so the card quote equals what actually leaves the balance. The card shows THIS, not
   *  estimatedPriceUsd (which is the record-only fal cost, ~2.5x lower). */
  estimatedCredits: number;
  /** Present only when this image card is the first step of a two-step video plan.
   *  DISPLAY ONLY — an estimate of the follow-on video step's cost. Never used to charge. */
  videoStep?: { estimatedCredits: number };
  sourceGenerationId?: string;
  /** 这条创作的目的/意图（来自 propose 的资讯门）。展示/审计用。 */
  goal?: string;
  referenceVideoGenerationId?: string;
};

export type ProposeCardResult = {
  cardPayload: CardPayload;
  shownPriceDisplay: number;
};

// ---------------------------------------------------------------------------
// Card copy helpers — pure, engine-free by construction
// ---------------------------------------------------------------------------

/**
 * 卡面规格摘要（脱敏）。与 `reason` 同源同事实，但只从 `params` 取值，
 * 因此结构上不可能带出引擎名。UI 只渲染这一版。
 */
export function buildSpecSummary(
  kind: "image" | "video",
  params: CardPayload["params"],
  hasSourceImage: boolean,
): string {
  const parts: string[] = [];
  if (kind === "video") {
    if (params.aspectRatio) parts.push(params.aspectRatio);
    else parts.push(hasSourceImage ? "Same shape as your reference" : "Default shape");
    if (typeof params.durationSeconds === "number") parts.push(`${params.durationSeconds}s`);
    if (params.resolution) parts.push(params.resolution);
    parts.push(params.audio ? "With sound" : "No sound");
  } else {
    if (params.aspectRatio) parts.push(params.aspectRatio);
    parts.push(params.count === 1 ? "1 image" : `${params.count} images`);
  }
  return parts.join(" · ");
}

/**
 * 降级披露。只在 `downgraded` 为 true 时调用：把「商家要的」与「实际会做的」
 * 并排说清楚。任何说不清具体项的降级也必须给出一句不撒谎的兜底，绝不静默。
 */
export function buildDowngradeNote(
  requested: { aspect?: string; duration?: number },
  params: CardPayload["params"],
  hasSourceImage: boolean,
): string {
  const asked: string[] = [];
  const instead: string[] = [];
  if (typeof requested.duration === "number" && requested.duration !== params.durationSeconds) {
    asked.push(`${requested.duration}s`);
    instead.push(
      typeof params.durationSeconds === "number" ? `${params.durationSeconds}s` : "a different length",
    );
  }
  if (requested.aspect && requested.aspect !== params.aspectRatio) {
    asked.push(requested.aspect);
    instead.push(params.aspectRatio ?? (hasSourceImage ? "the shape of your reference" : "the default shape"));
  }
  if (asked.length === 0) {
    return "Some of what you asked for isn't available here — the details above are what you'll get.";
  }
  return `You asked for ${asked.join(" and ")} — this will be ${instead.join(" and ")}.`;
}

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
  input: Pick<ProposeInput, "kind" | "structuredPrompt" | "entityIds" | "variantSel" | "desiredAspect" | "desiredDuration" | "desiredAudio" | "count" | "forVideo">,
  ctx: OttoContext,
  ownedEntityIds: string[],
): ProposeCardResult {
  // Step 1: kind is the PLANNER'S decision — an attached reference no longer forces video.
  // A reference (ctx.sourceGenerationId) becomes an i2v start-frame ONLY for a video plan;
  // for an image plan it is a vision reference the planner already SAW (buildOttoContext)
  // and is NOT threaded into the gen request (no silent image-to-image).
  let kind = input.kind;
  let entityIds = input.entityIds;
  let variantSel = input.variantSel;
  const isRefVideo = kind === "video" && !!ctx.referenceVideoGenerationId;
  const isI2V = kind === "video" && !!ctx.sourceGenerationId && !isRefVideo;
  const hasSourceImage = isI2V;

  if (isI2V) {
    // i2v conditions on the start frame, not on entity refs (preserve prior behavior)
    entityIds = [];
    variantSel = {};
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

  if (isRefVideo) {
    const opts = GEN_VIDEO_MODEL_OPTIONS[REFERENCE_VIDEO_MODEL];
    const d = videoDefaults(REFERENCE_VIDEO_MODEL);
    sm.model = REFERENCE_VIDEO_MODEL;
    sm.params.durationSeconds = GEN_VIDEO_SECONDS;
    sm.params.resolution = d.resolution;
    sm.params.aspectRatio = input.desiredAspect && opts.aspectRatios.includes(input.desiredAspect) ? input.desiredAspect : d.aspectRatio;
    sm.params.audio = typeof input.desiredAudio === "boolean" ? input.desiredAudio : d.audio;
    sm.params.count = 1;
    sm.reason = `Seedance 2.0 Fast — ${sm.params.aspectRatio}, ${GEN_VIDEO_SECONDS}s reference video`;
    sm.downgraded = sm.downgraded || (input.desiredDuration != null && input.desiredDuration !== GEN_VIDEO_SECONDS);
  }

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

  // Step 4.5: the DISPLAYED charge in CREDITS — computed from the SAME pricedGenCredits
  // value startGen reserves (gen-actions.ts), so the card quote equals what actually
  // leaves the balance. (estimatedPriceUsd above stays the record-only fal cost.)
  const estimatedCredits = displayCredits(
    pricedGenCredits({
      kind: kind === "video" ? "VIDEO" : "IMAGE",
      model: sm.model,
      count: kind === "video" ? 1 : sm.params.count,
      referenceVideoGenerationId: isRefVideo ? ctx.referenceVideoGenerationId : null,
      videoOptions:
        kind === "video"
          ? { seconds: sm.params.durationSeconds, resolution: sm.params.resolution, audio: sm.params.audio }
          : null,
    }),
  );

  // Step 4.6: video-step estimate — DISPLAY ONLY.
  // When this image card is the first step of a two-step video plan (forVideo=true),
  // estimate the follow-on video cost so the card can show the full plan total.
  // Errors are silently swallowed — videoStep is best-effort and must never break the card.
  let videoStep: { estimatedCredits: number } | undefined;
  if (kind === "image" && input.forVideo) {
    try {
      const vm = suggestModel({
        kind: "video",
        desiredAspect: input.desiredAspect,
        desiredDuration: input.desiredDuration,
        desiredAudio: input.desiredAudio,
        hasSourceImage: true,
        hasTail: false,
        disabled: new Set(ctx.disabledModels),
      });
      const videoEstCredits = displayCredits(
        pricedGenCredits({
          kind: "VIDEO",
          model: vm.model,
          count: 1,
          videoOptions: {
            seconds: vm.params.durationSeconds,
            resolution: vm.params.resolution,
            audio: vm.params.audio,
          },
        }),
      );
      videoStep = { estimatedCredits: videoEstCredits };
    } catch {
      // Best-effort — omit videoStep on any error
    }
  }

  // Step 5: cardPayload (mirror coworkTurn 401–406)
  const cardPayload: CardPayload = {
    kind,
    model: sm.model,
    params: sm.params,
    reason: sm.reason,
    specSummary: buildSpecSummary(kind, sm.params, hasSourceImage),
    downgraded: sm.downgraded,
    ...(sm.downgraded
      ? { downgradeNote: buildDowngradeNote(sm.requested, sm.params, hasSourceImage) }
      : {}),
    structuredPrompt: input.structuredPrompt,
    entityIds,
    variantSel,
    estimatedPriceUsd: price,
    estimatedCredits,
    ...(videoStep ? { videoStep } : {}),
    // isI2V ⇒ kind==="video" && !!ctx.sourceGenerationId, so the non-null assertion is sound.
    ...(isI2V ? { sourceGenerationId: ctx.sourceGenerationId! } : {}),
    // isRefVideo ⇒ kind==="video" && !!ctx.referenceVideoGenerationId, so the non-null assertion is sound.
    ...(isRefVideo ? { referenceVideoGenerationId: ctx.referenceVideoGenerationId! } : {}),
  };

  // Step 6: the credit amount Otto may mention in chat = the real charge (estimatedCredits).
  const shownPriceDisplay = estimatedCredits;

  return { cardPayload, shownPriceDisplay };
}
