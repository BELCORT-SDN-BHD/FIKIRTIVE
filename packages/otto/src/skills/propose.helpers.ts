/**
 * propose.helpers — pure, DB-free helpers for the propose tool.
 *
 * ZERO imports from @fikirtive/db or @openai/agents — fully unit-testable
 * without any mocking. DB and SDK wiring live in propose.ts.
 */
import { z } from "zod";
import {
  suggestModel,
  generationUnavailableMessage,
  videoPriceUsd,
  videoDefaults,
  VIDEO_ASPECT_ADAPTIVE,
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_PRICE_USD_PER_IMAGE,
  GEN_VIDEO_SECONDS,
  REFERENCE_VIDEO_MODEL,
  MAX_GEN_PROMPT,
  MAX_GEN_COUNT,
  displayCredits,
  pricedGenCredits,
  imageOutputSize,
  imageAspectHonoured,
  normalizeImageAspect,
  EXECUTED_SPEC,
  type GenVideoModel,
  type ReferenceBudget,
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

/**
 * 这一类创作现在**没有可用引擎**(后台把唯一那台关掉了)—— #647 T6。
 *
 * 为什么是抛,而不是返回一张标着「不可用」的卡:一张卡就是一个可以点下去的承诺。
 * 造不出真卡的时候唯一诚实的产物是**没有卡**,而抛异常让这件事 fail closed ——
 * 将来任何一个新入口忘了接住它,商家看到的是一个错误,而不是一张确认不了的付费卡。
 *
 * `message` 就是给商家看的那句话(English sentence case,不出现任何引擎/供应商名)。
 */
export class GenerationUnavailableError extends Error {
  constructor(readonly kind: "image" | "video") {
    // 措辞的单一来源在 @fikirtive/core —— 四个铸卡入口共用一份(#647 T6 修复轮 P1-1)。
    super(generationUnavailableMessage(kind));
    this.name = "GenerationUnavailableError";
  }
}

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
 * 片子形状那一格的卡面说法(#645 T4)。
 *
 * `adaptive` **不是一个具体形状** —— 引擎会跟着首帧自己挑。所以卡面绝不能把它印成
 * 「16:9」之类的具体值(那就是卡面承诺了一件引擎没答应的事),也不该印生硬的 "adaptive"。
 * 它的真实含义正好就是「和你给的图同一个形状」,于是就这么说。
 */
export function videoAspectChip(aspectRatio: string | undefined, hasSourceImage: boolean): string {
  if (aspectRatio === VIDEO_ASPECT_ADAPTIVE) {
    return hasSourceImage ? "Same shape as your reference" : "Shape picked to fit";
  }
  return aspectRatio ?? (hasSourceImage ? "Same shape as your reference" : "Default shape");
}

/**
 * 卡面规格条目（脱敏）。与 `reason` 同事实，但只从 `params` 取值，
 * 因此结构上不可能带出引擎名；并且只输出 `EXECUTED_SPEC` 认定执行层真会采纳的控制项，
 * 因此不可能承诺一件执行层做不到的事。这是卡面规格的**唯一一次**派生。
 */
export function buildSpecChips(
  kind: "image" | "video",
  params: CardPayload["params"],
  hasSourceImage: boolean,
  usesAttachedImage = false,
): string[] {
  const chips: string[] = [];
  if (kind === "video") {
    if (EXECUTED_SPEC.video.aspectHonoured) {
      chips.push(videoAspectChip(params.aspectRatio, hasSourceImage));
    }
    if (EXECUTED_SPEC.video.durationHonoured && typeof params.durationSeconds === "number") {
      chips.push(`${params.durationSeconds}s`);
    }
    if (EXECUTED_SPEC.video.resolutionHonoured && params.resolution) chips.push(params.resolution);
    // 声音：#646 T5 接通后这一条照实出现。判据仍然只有 EXECUTED_SPEC 一处 —— 哪天执行层
    // 又断了，改那一处，卡面立刻停止承诺。
    if (EXECUTED_SPEC.video.audioHonoured) chips.push(params.audio ? "With sound" : "No sound");
  } else {
    // 图片：判据是**这一趟真正会跑的那个适配器**会不会兑现画幅(imageAspectHonoured),
    // 不是那个「现役适配器能不能」的静态标志 —— 选中不发规格的备用路时,卡面必须闭嘴
    // (判官 r1 P2)。兑现不了就按执行层实际会产出的默认(方图)报尺寸。
    const honoured = imageAspectHonoured();
    const { width, height } = imageOutputSize(honoured ? params.aspectRatio : undefined);
    chips.push(`${width} × ${height}`);
    if (honoured && params.aspectRatio) chips.push(params.aspectRatio);
    chips.push(params.count === 1 ? "1 image" : `${params.count} images`);
    // #619：商家挂的那张图现在真的随卡进引擎（付费请求带 sourceGenerationId），
    // 所以卡面必须在批准前说出来。这一条只在卡真的带着图时出现 —— 界面上出现的
    // 每一句都得是执行层真会做的事（#608）。
    if (usesAttachedImage) chips.push("Uses your attached image");
  }
  return chips;
}

/**
 * #619 参考照片预算 —— 花钱**之前**说清楚这一趟真会用上几张。
 *
 * 数字不在这里算：`referenceBudget`（`@fikirtive/core`）是 worker 选片规则的唯一副本，
 * 且由 `apps/worker/src/jobs/gen-reference-budget.test.ts` 拿真 `handleGen` 发出去的
 * `inputImageUrls` 长度逐例对表。这里只负责把它说成人话。
 *
 * 两句话各管一件事，都不许静默：
 *   - 引擎上限截掉了元素照片 → 说清「真会用几张 / 商家一共给了几张」（含底图，因为底图
 *     也是引擎真收到的一张）；
 *   - 挂了不止一张图 → 说清哪张是底图，其余只参与理解（付费请求的底图字段是单值）。
 */
export function buildReferenceBudgetNotes(input: {
  budget: ReferenceBudget;
  attachedImageCount: number;
  usesAttachedImage: boolean;
}): string[] {
  const notes: string[] = [];
  if (input.budget.truncated) {
    notes.push(
      `This run will use ${input.budget.used} of your ${input.budget.total} reference photos.`,
    );
  }
  if (input.usesAttachedImage && input.attachedImageCount > 1) {
    notes.push(
      `You attached ${input.attachedImageCount} images — the first one is the base image; the others only informed this plan.`,
    );
  }
  return notes;
}

/**
 * 把参考照片披露并进已铸好的卡面。一旦有照片上不了车，这张卡就是 `downgraded` ——
 * 前端只在 `downgraded` 为 true 时渲染 `downgradeNote`（`OttoPlanCard.tsx`），
 * 所以两者必须一起写。纯展示：不改价、不改选型、不改 payload 的任何付费字段。
 */
export function withReferenceBudget(payload: CardPayload, notes: string[]): CardPayload {
  if (notes.length === 0) return payload;
  const merged = [payload.downgradeNote, ...notes].filter(Boolean).join(" ");
  return { ...payload, downgraded: true, downgradeNote: merged };
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
      // 如实说出这张卡真会产出的尺寸（卡上没带画幅、或这一趟的适配器不兑现 ⇒ 默认方图）。
      const { width, height } = imageOutputSize(imageAspectHonoured() ? params.aspectRatio : undefined);
      instead.push(width === height ? `a square ${width} × ${height} image` : `a ${width} × ${height} image`);
    } else {
      // #645 T4：adaptive 同样如实说成「跟着你的图走」，不冒充一个具体形状。
      instead.push(
        params.aspectRatio === VIDEO_ASPECT_ADAPTIVE
          ? (hasSourceImage ? "the shape of your reference" : "a shape picked to fit")
          : params.aspectRatio ?? (hasSourceImage ? "the shape of your reference" : "the default shape"),
      );
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
  // A reference (ctx.sourceGenerationId) becomes an i2v start-frame for a video plan; for an
  // image plan it rides along as the PRIMARY reference the image engine actually receives
  // (#619 Founder 决议：挂图 + 要图片 = 引擎真收到这张图。worker 把它 unshift 到参考数组
  // 第 0 位 —— apps/worker/src/jobs/gen.ts F09 —— 与详情页 edit 走的是同一条活路)。
  // `hasSourceImage` 仍然只说 i2v：它驱动选型与 @元素清空，那两件事对图片方案不变
  // （图片方案照旧保留商家 @ 的元素，参考图与元素图一起进引擎）。
  let kind = input.kind;
  let entityIds = input.entityIds;
  let variantSel = input.variantSel;
  const isRefVideo = kind === "video" && !!ctx.referenceVideoGenerationId;
  const isI2V = kind === "video" && !!ctx.sourceGenerationId && !isRefVideo;
  const hasSourceImage = isI2V;
  /** 图片方案带着商家挂的那张图（付费请求的编辑底图）。 */
  const usesAttachedImage = kind === "image" && !!ctx.sourceGenerationId;

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

  // Step 3: model selection.
  // #647 T6:null = 这一类的唯一引擎被后台关掉了。这里不给「降级卡」也不给「零元卡」——
  // 直接抛,由入口翻译成一句人话,一张卡都不落库(见 GenerationUnavailableError)。
  const sm = suggestModel({
    kind,
    desiredAspect: input.desiredAspect,
    desiredDuration: input.desiredDuration,
    desiredAudio: input.desiredAudio,
    hasSourceImage,
    hasTail: false,
    disabled: new Set(ctx.disabledModels),
  });
  if (!sm) throw new GenerationUnavailableError(kind);

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
  // #647 T6:视频引擎被关掉时 `vm` 是 null —— 这张图片卡照铸(图片引擎还开着),只是
  // 不再替一条现在做不了的片子报价。卡面上少一行,好过多一行做不到的承诺。
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
      const videoEstCredits = vm === null ? null : displayCredits(
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
      if (videoEstCredits !== null) videoStep = { estimatedCredits: videoEstCredits };
    } catch {
      // Best-effort — omit videoStep on any error
    }
  }

  // Step 4.7: 商家要的画幅没落到这张卡上,也是降级 —— 必须显式披露,不得静默。
  // suggestModel 只知道「这个模型能不能」，不知道「执行层会不会真用」，所以这两项
  // 在这里补齐。判据是**这张卡真会交付什么**,两种情况都算掉了:
  //   ① 这一趟真正会跑的适配器根本不采纳画幅(imageAspectHonoured 说了不算数);
  //   ② 采纳,但这条路没把商家的画幅放上卡(卡上的画幅 ≠ 他要的)。
  // 纯展示：不改 params、不改选型、不改报价。
  // #643 T2：比对前先归一商家的写法。`portrait` 和 `9:16` 是同一个形状，逐字比对会把一次
  // **已经兑现**的请求误报成降级 —— 那句披露会变成噪音，商家学会忽略它，真降级也就跟着被忽略。
  const imageAspectDropped =
    kind === "image" && !!input.desiredAspect &&
    (!imageAspectHonoured() || normalizeImageAspect(input.desiredAspect) !== sm.params.aspectRatio);
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
    specChips: buildSpecChips(kind, sm.params, hasSourceImage, usesAttachedImage),
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
    // isI2V | usesAttachedImage ⇒ !!ctx.sourceGenerationId, so the non-null assertion is sound.
    // video ⇒ i2v 起始帧；image ⇒ 引擎的编辑底图（第一参考）。两条路都真的送图。
    ...(isI2V || usesAttachedImage ? { sourceGenerationId: ctx.sourceGenerationId! } : {}),
    // isRefVideo ⇒ kind==="video" && !!ctx.referenceVideoGenerationId, so the non-null assertion is sound.
    ...(isRefVideo ? { referenceVideoGenerationId: ctx.referenceVideoGenerationId! } : {}),
  };

  // Step 6: the credit amount Otto may mention in chat = the real charge (estimatedCredits).
  const shownPriceDisplay = estimatedCredits;

  return { cardPayload, shownPriceDisplay };
}
