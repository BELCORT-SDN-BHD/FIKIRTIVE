/**
 * propose.helpers — pure, DB-free helpers for the propose tool.
 *
 * ZERO imports from @fikirtive/db or @openai/agents — fully unit-testable
 * without any mocking. DB and SDK wiring live in propose.ts.
 */
import { z } from "zod";
import {
  buildSpecChips,
  suggestModel,
  generationUnavailableMessage,
  videoPriceUsd,
  videoDefaults,
  VIDEO_ASPECT_ADAPTIVE,
  GEN_VIDEO_MODEL_OPTIONS,
  GEN_VIDEO_MODEL_INFO,
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
  type ApprovedEntity,
} from "@fikirtive/core";
import type { OttoContext } from "../context.js";
import { decideVideoAction } from "./video-intent.js";
import { videoActionUnavailableReason } from "./video-capabilities.js";

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
  /**
   * #775 判官 r1 P1-2 —— 这里**刻意没有** `videoAction` 之类的动作声明字段。
   *
   * r1 有过一个,后果正是判官指出的那两条:模型漏传它,一条严格编辑的提示词就带着 16:9
   * 上卡;模型传错它,卡说的和引擎会做的就不是一件事。一个可以漏传的旁路参数不可能成为
   * 单一真相来源。
   *
   * 现在动作从 `structuredPrompt` 自己认出来(`videoActionFromPrompt`)—— 那段字是卡上
   * 冻结、批准后原样送到引擎的同一份,引擎也正是从它读任务类型的。判据与执行同源,
   * 中间没有第二次转述,所以对不上这件事在结构上不存在。
   */
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
  /**
   * #774 判官 r2 P1 —— 这几个 @元素在**铸卡那一刻**叫什么、是什么类型,冻结在卡上。
   *
   * 引擎认人那几句机器指令(`Define the product in <Image_2> as <Subject_2>: 名字.`)
   * 里的名字只能来自这里。元素名是商家随时能改的自由文本(`updateEntity` 只 trim),
   * 名字若由 worker 在付费调用前现读,批准之后改一次名就能把没过审批的指令送进那次
   * 已经批准的付费调用。冻结在卡上 = 商家在按下按钮之前就看得见这份映射
   * (`approvedEntitiesNote`),按下之后谁也改不动它(卡 payload 不可变)。
   *
   * 次序 = `entityIds` 的次序。老卡没有这个字段 → 编号照旧,只是不写名字。
   */
  approvedEntities?: ApprovedEntity[];
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
  /**
   * #785 判官 r1 P1 —— **披露要数的那一份**:商家这一轮真 @ 到、且确属他自己的元素,
   * 取在任何场景清空**之前**。
   *
   * 为什么不能数 `cardPayload.entityIds`:首帧 i2v 那一档会把卡上的 @元素清空(引擎只认
   * 首帧),而「你给的 N 张一张都不会用上」这句话要说的正是被清掉的那些。数清空后的卡,
   * 数出来永远是 0 张里的 0 张 ⇒ 那句话永远不出现 ⇒ 静默,正是这条规矩要挡的东西。
   *
   * 只影响**披露**:卡上带走的仍然是 `cardPayload.entityIds`(worker 照它取图),
   * 这一份不参与选型、报价、预扣。
   */
  mentionedEntityIds: string[];
  mentionedVariantSel: Record<string, string>;
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
/**
 * 铸卡这一侧的**拒绝**族:造不出一张诚实的卡时抛它,入口把 `message` 原样交回对话,
 * 一张 GEN_CARD 都不落库。
 *
 * 为什么有一个共同基类:入口(`propose` / `proposePack`)只该认识「这是一次拒绝」这件事,
 * 不该逐个列举拒绝的理由 —— 每加一种拒绝就得回去改两个 catch,漏改一次就是一个没人接的
 * 崩溃。`message` 就是给商家看的那句话(English sentence case,不出现任何引擎/供应商名)。
 */
export class ProposeRefusal extends Error {}

export class GenerationUnavailableError extends ProposeRefusal {
  constructor(readonly kind: "image" | "video") {
    // 措辞的单一来源在 @fikirtive/core —— 四个铸卡入口共用一份(#647 T6 修复轮 P1-1)。
    super(generationUnavailableMessage(kind));
    this.name = "GenerationUnavailableError";
  }
}

/**
 * #775 判官 r1 P1-1 —— 这段提示词要做的那件事,**这一趟的形状撑不起来**。
 *
 * 典型:一条以「Strictly edit <Video_1>…」开头的提示词,而商家这一轮一条片子都没挂。
 * r1 在这里铸出了一张普通视频卡 —— 那张卡是一个点得下去的付费承诺,商家批准之后拿到的
 * 是一条与他要求毫无关系的片子。降级成别的动作同样不行:那段提示词本身就是为「改这条
 * 片子」写的,换个动作只是换一种失望。
 *
 * 所以这里 fail closed —— 一张卡都不铸,把缺什么、怎么办交回给商家。措辞取自
 * `decideVideoAction` 的反问,与对话里那句话是同一句,不另写一份。
 */
export class VideoActionUnavailableError extends ProposeRefusal {
  constructor(message: string) {
    super(message);
    this.name = "VideoActionUnavailableError";
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
 * 卡面规格条目的**唯一一次**派生。#709 起它住在 `@fikirtive/core`(`spec-chips.ts`),
 * 因为读者不止 Otto 一个 —— 战役确认卡也要说同样的话。这里照旧原名再导出,所有既有
 * 调用点与测试一个字不用改。
 */
export { videoAspectChip } from "@fikirtive/core";
export { buildSpecChips };

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
      // #785：视频的三个带素材场景（首帧 / 首+末帧 / 整段参考视频）一张元素照都带不了，
      // 所以这里 used 会是 0。「use 0 of your 17」既不像人话，也读着像出了故障 ——
      // 零这一档单独说一句。仍然是**同一个数字**（budget），只是换了说法。
      input.budget.used === 0
        ? `None of your ${input.budget.total} reference photos will be used for this clip.`
        : `This run will use ${input.budget.used} of your ${input.budget.total} reference photos.`,
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
 * #785 —— 视频卡上「这一趟真会用上你几张参考照」那一格。
 *
 * 为什么要在卡铸好之后补一次:张数要查库(每个 @元素当下有几张活图),而 `buildProposeCard`
 * 是纯函数、不碰库。补的方式是**拿同一个 `buildSpecChips` 重算一遍**,不是在数组尾巴上
 * 手工 push 一格 —— 后者就是第二套卡面逻辑,`EXECUTED_SPEC` 那道闸从此管不到它。
 *
 * 入参只有张数;`kind` / `params` / 有没有底图这些全部从卡面自己再读一次,所以重算出来的
 * 前几格与第一次逐字相同(测试钉着)。纯展示:不改价、不改选型、不改任何付费字段。
 */
export function withVideoReferenceChip(payload: CardPayload, elementReferenceCount: number): CardPayload {
  if (payload.kind !== "video" || elementReferenceCount <= 0) return payload;
  return {
    ...payload,
    specChips: buildSpecChips(
      payload.kind,
      payload.params,
      !!payload.sourceGenerationId,
      false, // usesAttachedImage 是图片侧的概念(编辑底图),视频卡永远为 false
      { elementReferenceCount },
    ),
  };
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
 * @param input         - Raw LLM input (already zod-parsed by the SDK)
 * @param ctx           - OttoContext from the run (identity never comes from input)
 * @param ownedEntities - Entities confirmed owned by ctx.orgId, **with their current name and
 *                        type** (DB lookup done by caller). The names are what gets frozen onto
 *                        the card as `approvedEntities` — the caller must read them in the same
 *                        breath as the ownership check, never later.
 */
export function buildProposeCard(
  input: Pick<ProposeInput, "kind" | "structuredPrompt" | "entityIds" | "variantSel" | "desiredAspect" | "desiredDuration" | "desiredAudio" | "count" | "forVideo">,
  ctx: OttoContext,
  ownedEntities: ApprovedEntity[],
): ProposeCardResult {
  // Step 1: kind is the PLANNER'S decision — an attached reference no longer forces video.
  // A reference (ctx.sourceGenerationId) becomes an i2v start-frame for a video plan; for an
  // image plan it rides along as the PRIMARY reference the image engine actually receives
  // (#619 Founder 决议：挂图 + 要图片 = 引擎真收到这张图。worker 把它 unshift 到参考数组
  // 第 0 位 —— apps/worker/src/jobs/gen.ts F09 —— 与详情页 edit 走的是同一条活路)。
  // `hasSourceImage` 仍然只说 i2v：它驱动选型与 @元素清空，那两件事对图片方案不变
  // （图片方案照旧保留商家 @ 的元素，参考图与元素图一起进引擎）。
  let kind = input.kind;
  const isRefVideo = kind === "video" && !!ctx.referenceVideoGenerationId;
  const isI2V = kind === "video" && !!ctx.sourceGenerationId && !isRefVideo;
  const hasSourceImage = isI2V;
  /** 图片方案带着商家挂的那张图（付费请求的编辑底图）。 */
  const usesAttachedImage = kind === "image" && !!ctx.sourceGenerationId;

  /**
   * #775 判官 r1 P1-1 / P1-2 —— **这张卡是能力表上的哪一个动作**,在这里定,一次。
   *
   * 两个入参都不经过模型的第二次转述:
   *   · 形状 —— 服务端自己数出来的(片子/首帧都来自 `ctx`,由 D19 信任边界解析);
   *     末帧不是 propose 的概念(`suggestModel` 固定 `hasTail: false`),所以恒为 false;
   *   · 动作 —— 从 `structuredPrompt` 的官方开头认出来。那段字是卡上冻结、批准后原样送到
   *     引擎的同一份,引擎也正是从它读任务类型 —— 判据与执行同源。
   *
   * `decideVideoAction` 内部走的是能力表的 `needs(shape)`,所以「这个形状做不到这件事」
   * 只有一处判定,对话侧与铸卡侧共用。回 `ask` = 撑不起来 ⇒ 一张卡都不铸。
   */
  const videoShape = { hasStill: isI2V, hasEndStill: false, hasClip: isRefVideo };
  const decided =
    kind === "video" ? decideVideoAction({ prompt: input.structuredPrompt, shape: videoShape }) : null;
  if (decided?.kind === "ask") throw new VideoActionUnavailableError(decided.question);
  const cardAction = decided?.kind === "action" ? decided.action : null;

  /**
   * #775 判官 r3 P1-2 —— **第二个证人:商家这一轮自己打的那句话**。
   *
   * r3 之前,模型选错档没有任何一处会发现:商家说「sambung」(接下去),模型写了一条严格
   * 编辑的提示词,系统就忠实地把「改他的片子」做完了 —— 而那是一次不可撤销的付费运行,
   * 动的还是商家自己的东西。
   *
   * 这道对表刻意**很窄**,因为它拿的是关键词,而模型看得见整段对话:
   *   · 只在锚定那两档之间(`editClip` ↔ `extendClip`)对表 —— 那是唯一「做错了会动到
   *     商家原件」的分岔;
   *   · 只在措辞侧给出**明确单一结论**时才算数(含糊、零信号一律没有意见);
   *   · 对不上时**不改判、不纠正**,而是停下来问 —— 拿关键词去推翻模型就是另一种预判商家。
   * 一分钱都还没花,所以停下来问的代价只有一句话。
   *
   * #928 判官 r2 P1-1 —— 「措辞指着一个下架动作」原本挂在 `cardAction` 已经落在
   * editClip/extendClip 的条件里,于是模型把提示词写成中性的 guideFromClip 时(商家嘴上
   * 说「继续」「sambung」,模型没跟着走)这一整条检查被跳过 —— 商家的续写意图从没被读到,
   * 一张带参考片的普通提案照样铸卡收费。现在拆成两步:①「商家这句话是不是指着一个下架
   * 动作」对**所有**带参考片的视频提案都跑,与 `cardAction` 落在哪一档无关;②「编辑/续写
   * 互相错配」保持原来的窄范围,只在 `cardAction` 已经是 editClip/extendClip 时才对表。
   */
  if (kind === "video" && isRefVideo && ctx.turnText) {
    const fromWords = decideVideoAction({ text: ctx.turnText, shape: videoShape });
    // #922 —— 措辞侧指着一个**下架**的动作(商家说「接下去」,而续写关着)⇒ 照实说那一句,
    // 别把它当成对卡的默许。少了这一条,这道对表在续写下架期间会整条失效:关着的动作
    // 再也回不了 `action`,于是「他说接下去、模型写了严格编辑」会被静默铸成一张剪辑卡。
    if (fromWords.kind === "ask" && fromWords.options.some((a) => videoActionUnavailableReason(a) !== null)) {
      throw new VideoActionUnavailableError(fromWords.question);
    }
    if (
      cardAction &&
      (cardAction === "editClip" || cardAction === "extendClip") &&
      fromWords.kind === "action" &&
      (fromWords.action === "editClip" || fromWords.action === "extendClip") &&
      fromWords.action !== cardAction
    ) {
      throw new VideoActionUnavailableError(
        fromWords.action === "extendClip"
          ? "It sounds like you want that clip carried on rather than changed — tell me which, and I'll set it up."
          : "It sounds like you want something in that clip changed rather than carried on — tell me which, and I'll set it up.",
      );
    }
  }

  // Step 2: entityId scoping — keep only owned ids, drop foreign ones silently.
  // #785 判官 r1 P1:归属过滤挪到了 i2v 清空**之前**(原本是「先清空、再跳过过滤」)。
  // 卡面产物一个字节都没变(清空后的卡照旧是空的),换来的是下面那一份「商家真 @ 了谁」
  // 还留着 —— 披露要数的是它,不是清空后的卡(见 ProposeCardResult.mentionedEntityIds)。
  // #774:归属集从 `ownedEntities` 取 —— 与冻在卡上的名字**同一趟**读出来的那一份,
  // 所以「谁算他的」与「他批的是哪个名字」不可能来自两次不同的读。
  const ownedSet = new Set(ownedEntities.map((e) => e.id));
  let entityIds = input.entityIds.filter((id) => ownedSet.has(id));
  const ownedVarSel: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.variantSel)) {
    if (ownedSet.has(k)) ownedVarSel[k] = v;
  }
  let variantSel: Record<string, string> = ownedVarSel;
  /** 商家这一轮真 @ 到、且确属他自己的那一组 —— 只喂披露(张数要按这一份数)。 */
  const mentionedEntityIds = entityIds;
  const mentionedVariantSel = variantSel;

  if (isI2V) {
    // i2v conditions on the start frame, not on entity refs (preserve prior behavior)
    entityIds = [];
    variantSel = {};
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

  /**
   * #775 —— 改这条片子 / 把这条片子接下去,形状**只能**跟着商家那条片子走。
   *
   * 官方陷阱:在这两种任务上再指定一个比例,请求会**先被收下、事后才异步失败** ——
   * 商家看到的是一次批准之后石沉大海,而不是一句「这个选项在这里用不上」。所以判据必须
   * 落在批准**之前**的卡上,不能指望引擎替我们把关。
   *
   * `adaptive` 不是一个我们发明的值:它本来就在这台引擎的档位表里,且正是首帧那一档
   * (`i2vAspectRatio`)每天在用的那个值 —— 含义就是「跟着你给的东西走」,与这两个动作
   * 要的事情逐字相同。
   *
   * `cardAction` 来自上面那一次判定,而它已经过了能力表的 `needs(shape)` —— 所以走到
   * 这里的 editClip/extendClip **一定**真的有一条片子,不必也不该再判一次形状。
   */
  const anchoredToClip = cardAction === "editClip" || cardAction === "extendClip";

  if (isRefVideo) {
    const opts = GEN_VIDEO_MODEL_OPTIONS[REFERENCE_VIDEO_MODEL];
    const d = videoDefaults(REFERENCE_VIDEO_MODEL);
    sm.model = REFERENCE_VIDEO_MODEL;
    sm.params.durationSeconds = GEN_VIDEO_SECONDS;
    sm.params.resolution = d.resolution;
    sm.params.aspectRatio = anchoredToClip
      ? VIDEO_ASPECT_ADAPTIVE
      : input.desiredAspect && opts.aspectRatios.includes(input.desiredAspect) ? input.desiredAspect : d.aspectRatio;
    sm.params.audio = typeof input.desiredAudio === "boolean" ? input.desiredAudio : d.audio;
    sm.params.count = 1;
    // #769:引擎名从事实表取,不再手抄。手抄的那一份在换引擎(fast→mini)时不会跟着变,
    // 于是内部/审计文案会继续说一台已经不在产的引擎 —— 与 cowork-route 的做法对齐。
    sm.reason = `${GEN_VIDEO_MODEL_INFO[REFERENCE_VIDEO_MODEL].label} — ${sm.params.aspectRatio}, ${GEN_VIDEO_SECONDS}s reference video`;
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
  // #775 —— 剪辑/续写把商家点的形状换成了 adaptive,这同样是降级,必须**说出来**。
  // 商家没点形状时不算降级:他什么都没被换掉,那句披露只会变成噪音。
  const clipAspectForced =
    anchoredToClip && !!input.desiredAspect && input.desiredAspect !== VIDEO_ASPECT_ADAPTIVE;
  const requested: RequestedSpec = {
    ...sm.requested,
    ...(imageAspectDropped || clipAspectForced ? { aspect: input.desiredAspect } : {}),
    ...(audioNotHonoured ? { audio: input.desiredAudio } : {}),
  };
  const downgraded = sm.downgraded || imageAspectDropped || audioNotHonoured || clipAspectForced;
  /**
   * #775 —— 卡面/披露文案这一层,「商家给了一个引擎会照着定形状的东西」为真。
   *
   * 这个布尔**只**喂给两个纯展示函数(`buildSpecChips` / `buildDowngradeNote`),
   * 它们的作用是把 `adaptive` 说成人话。整段参考视频与首帧在这一点上是同一件事 ——
   * 形状跟着商家给的东西走 —— 所以卡上说「Same shape as your reference」而不是
   * 「Shape picked to fit」(后者听起来像我们替他挑的)。
   *
   * 刻意不动 `hasSourceImage` 本身:那个变量驱动**选型**与 @元素清空,而整段参考视频
   * 不是首帧,把它混进去会改掉付费行为。
   */
  const shapeFollowsWhatTheyGave = hasSourceImage || anchoredToClip;

  // Step 4.8: 审批身份快照 —— 这张卡最终留下的每个 @元素,配上它**此刻**的名字与类型。
  // 只认 ownedEntities 里那一份(归属查询同一趟读出来的),`entityIds` 里找不到身份的
  // 元素宁可不进快照:少一个名字是安全的降级,编一个名字不是。
  const ownedById = new Map(ownedEntities.map((e) => [e.id, e]));
  const approvedEntities = entityIds
    .map((id) => ownedById.get(id))
    .filter((e): e is ApprovedEntity => !!e);

  // Step 5: cardPayload (mirror coworkTurn 401–406)
  const cardPayload: CardPayload = {
    kind,
    model: sm.model,
    params: sm.params,
    reason: sm.reason,
    specChips: buildSpecChips(kind, sm.params, shapeFollowsWhatTheyGave, usesAttachedImage),
    downgraded,
    ...(downgraded
      ? { downgradeNote: buildDowngradeNote(kind, requested, sm.params, shapeFollowsWhatTheyGave) }
      : {}),
    structuredPrompt: input.structuredPrompt,
    entityIds,
    // #774 判官 r2 P1:名字与类型在这里一起冻结,次序跟着 entityIds 走。只收这张卡真的
    // 留下的那些元素 —— i2v 清空、归属过滤之后剩下谁,快照里就只有谁。空的就不写这个
    // 字段(老卡的形状),下游一律按「没有获批的名字」处理。
    ...(approvedEntities.length ? { approvedEntities } : {}),
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

  return { cardPayload, shownPriceDisplay, mentionedEntityIds, mentionedVariantSel };
}
