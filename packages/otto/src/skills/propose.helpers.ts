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
  EXECUTED_SPEC,
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
   *  因此永远不得渲染到 UI。卡面渲染 `specChips`。 */
  reason: string;
  /** 卡面要显示的规格条目，**服务端唯一一次派生**（`buildSpecChips`）。
   *  前端只按顺序渲染这个数组，自己不再从 `params` 二次推导 —— 两处推导正是
   *  「说的」与「做的」失同步的来源（#580 复审 r1 P1-1/P1-2）。
   *  每一条都只可能来自 `EXECUTED_SPEC` 认定执行层真会采纳的控制项，
   *  且结构上不可能带出引擎名（只读 `params`，从不读 `model`/`reason`）。 */
  specChips: string[];
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
// 有效规格 —— 卡面文案的唯一真相来源
// ---------------------------------------------------------------------------

/**
 * 执行层**真正会做的事**。卡面显示的每一条规格都从这里派生。
 *
 * 声明本身住在 `@fikirtive/core`（`executed-spec.ts`），因为它有两个必须钉在一起的读者：
 * 这里的卡面文案（「说的」），和 `@fikirtive/generation` 里对现役图像适配器请求体的
 * 整体断言（「做的」）。适配器一改，那条断言立刻红，逼着这份声明一起改，卡面于是自动
 * 开始说新话 —— 这就是 #580 复审 r2 P2 要的那道真闸（上一版是扫源码字符串，扫不出行为）。
 *
 * 本模块只改**展示**：这份声明不参与选型、报价、预扣或任何 provider 调用。
 */
export { EXECUTED_SPEC } from "@fikirtive/core";

// ---------------------------------------------------------------------------
// Card copy helpers — pure, engine-free by construction
// ---------------------------------------------------------------------------

/**
 * 卡面规格条目（脱敏）。与 `reason` 同事实，但只从 `params` 取值，
 * 因此结构上不可能带出引擎名；并且只输出 `EXECUTED_SPEC` 认定执行层真会采纳的控制项，
 * 因此不可能承诺一件执行层做不到的事。这是卡面规格的**唯一一次**派生。
 */
export function buildSpecChips(
  kind: "image" | "video",
  params: CardPayload["params"],
  hasSourceImage: boolean,
): string[] {
  const chips: string[] = [];
  if (kind === "video") {
    if (EXECUTED_SPEC.video.aspectHonoured) {
      chips.push(params.aspectRatio ?? (hasSourceImage ? "Same shape as your reference" : "Default shape"));
    }
    if (EXECUTED_SPEC.video.durationHonoured && typeof params.durationSeconds === "number") {
      chips.push(`${params.durationSeconds}s`);
    }
    if (EXECUTED_SPEC.video.resolutionHonoured && params.resolution) chips.push(params.resolution);
    // 声音：audioHonoured 为 false 时这一条不出现 —— 没接通就不承诺。接通那天改
    // EXECUTED_SPEC 一处，卡面自动开始说真话。
    if (EXECUTED_SPEC.video.audioHonoured) chips.push(params.audio ? "With sound" : "No sound");
  } else {
    // 图片：执行层固定输出方图，所以卡面报的就是它真会产出的尺寸，而不是商家要的画幅。
    const { width, height } = EXECUTED_SPEC.image.outputSize;
    chips.push(`${width} × ${height}`);
    if (EXECUTED_SPEC.image.aspectHonoured && params.aspectRatio) chips.push(params.aspectRatio);
    chips.push(params.count === 1 ? "1 image" : `${params.count} images`);
  }
  return chips;
}

/** 商家提出的、可能被执行层打折的诉求。 */
export type RequestedSpec = { aspect?: string; duration?: number; audio?: boolean };

/**
 * 降级披露。只在 `downgraded` 为 true 时调用：把「商家要的」与「实际会做的」
 * 并排说清楚。任何说不清具体项的降级也必须给出一句不撒谎的兜底，绝不静默。
 *
 * 「实际会做的」一律取自 `EXECUTED_SPEC`：图片的画幅到不了执行层，就说方图尺寸；
 * 声音控制没接通，就直说控制不了，而不是承诺一个静音结果。
 */
export function buildDowngradeNote(
  kind: "image" | "video",
  requested: RequestedSpec,
  params: CardPayload["params"],
  hasSourceImage: boolean,
): string {
  const asked: string[] = [];
  const instead: string[] = [];
  const notes: string[] = [];

  if (typeof requested.duration === "number" && requested.duration !== params.durationSeconds) {
    asked.push(`${requested.duration}s`);
    instead.push(
      typeof params.durationSeconds === "number" ? `${params.durationSeconds}s` : "a different length",
    );
  }
  if (requested.aspect && !(kind === "video" && requested.aspect === params.aspectRatio)) {
    asked.push(requested.aspect);
    if (kind === "image") {
      // 执行层不接受图片画幅：如实说出它真会产出的方图尺寸。
      const { width, height } = EXECUTED_SPEC.image.outputSize;
      instead.push(`a square ${width} × ${height} image`);
    } else {
      instead.push(params.aspectRatio ?? (hasSourceImage ? "the shape of your reference" : "the default shape"));
    }
  }
  if (asked.length > 0) {
    notes.push(`You asked for ${asked.join(" and ")} — this will be ${instead.join(" and ")}.`);
  }
  if (kind === "video" && typeof requested.audio === "boolean" && !EXECUTED_SPEC.video.audioHonoured) {
    // 不承诺静音，也不承诺有声 —— 只如实说这个开关还没接到执行层。
    notes.push("Sound isn't something I can set here yet, so the clip comes as it comes.");
  }
  if (notes.length === 0) {
    return "Some of what you asked for isn't available here — the details above are what you'll get.";
  }
  return notes.join(" ");
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

  // Step 4.7: 执行层收不下的诉求也是降级 —— 必须显式披露，不得静默。
  // suggestModel 只知道「这个模型能不能」，不知道「执行层会不会真用」，所以这两项
  // 在这里按 EXECUTED_SPEC 补齐：图片的画幅根本到不了执行层；声音开关没接通。
  // 纯展示：不改 params、不改选型、不改报价。
  const imageAspectDropped =
    kind === "image" && !!input.desiredAspect && !EXECUTED_SPEC.image.aspectHonoured;
  const audioNotHonoured =
    kind === "video" && typeof input.desiredAudio === "boolean" && !EXECUTED_SPEC.video.audioHonoured;
  const requested: RequestedSpec = {
    ...sm.requested,
    ...(imageAspectDropped ? { aspect: input.desiredAspect } : {}),
    ...(audioNotHonoured ? { audio: input.desiredAudio } : {}),
  };
  const downgraded = sm.downgraded || imageAspectDropped || audioNotHonoured;

  // Step 5: cardPayload (mirror coworkTurn 401–406)
  const cardPayload: CardPayload = {
    kind,
    model: sm.model,
    params: sm.params,
    reason: sm.reason,
    specChips: buildSpecChips(kind, sm.params, hasSourceImage),
    downgraded,
    ...(downgraded
      ? { downgradeNote: buildDowngradeNote(kind, requested, sm.params, hasSourceImage) }
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
