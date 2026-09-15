/**
 * propose — $0 tool
 *
 * Builds and persists a GEN_CARD chat message (a generation proposal the user
 * can later approve). Spends NO money, creates NO GenJob, calls NO generation-provider code.
 *
 * Identity comes exclusively from OttoContext (ctx), never from tool input — the
 * model cannot spoof ownerId, threadId, or projectId.
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { newId, referenceBudget, type ApprovedEntity } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import {
  proposeInput,
  buildProposeCard,
  buildReferenceBudgetNotes,
  withReferenceBudget,
  withVideoReferenceChip,
  GenerationUnavailableError,
  ProposeRefusal,
  type ProposeInput,
  type CardPayload,
  type ProposeCardResult,
} from "./propose.helpers.js";
// FSE-001 —— 付费前的参考图尺寸闸(唯一一份,两个铸卡入口读同一个)。
import { applyReferenceUpscaleGate } from "./reference-upscale-gate.js";
// FC-2 —— 「接着屏幕上那张图改」时,把那张图绑进这一轮的图片槽(判据与绑定都在那个模块)。
import { withContinuedImage } from "./image-continuation.js";
// FC-4 —— 角色被换掉时卡面与模型读到的**同一句**话。
import { FIRST_FRAME_DOWNGRADE_NOTE } from "./video-intent.js";

// Re-export types + pure helper so consumers can import from either file
export type { CardPayload, ProposeCardResult };
export { buildProposeCard, GenerationUnavailableError, ProposeRefusal };

/**
 * #619 E-5：**逐个** @元素有多少张活参考照，顺序 = 商家 @ 到它们的顺序（也就是卡上
 * `entityIds` 的顺序；首帧 i2v 那一档卡上被清空，数的仍是商家 @ 的那一份 —— #785 判官 r1 P1）。
 *
 * 口径逐字照抄 worker 的选片查询（`apps/worker/src/jobs/gen.ts:497-501`）：被 @ 的变体
 * 数该变体的图，否则数 base 图（`variantSel[id] ?? null`）。返回的是**数组**而不是总数 ——
 * round-robin 是按元素轮着取的，把它先加成一个总数就丢掉了算法要的输入。
 * 真正的截断计算交给 `referenceBudget`（`@fikirtive/core`，worker 规则的唯一副本）。
 */
async function countLiveReferenceImagesPerEntity(
  ownerId: string,
  entityIds: string[],
  variantSel: Record<string, string>,
): Promise<number[]> {
  if (entityIds.length === 0) return [];
  return Promise.all(
    entityIds.map((entityId) =>
      prisma.referenceImage.count({
        where: { entityId, variantId: variantSel[entityId] ?? null, ownerId, deletedAt: null },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Execute function (DB side) — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executePropose(
  input: ProposeInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<
  | {
      cardId: string;
      shownPriceDisplay: number;
      /**
       * FC-4 —— 这张卡里商家挂的那张图**真正**扮演的角色(`null` = 没挂图 / 图片卡)。
       *
       * 交回给模型,是因为叙述那一句是模型写的、finalizer 只负责落库 —— 「不许说卡上
       * 没有的事」在结构上只有这一条路:把卡上真正的那一格交到它手里。走查那一轮它写的是
       * 「using your image as the first frame」,而卡上落的是 `reference` —— 它当时手上
       * 根本没有第二个版本可读。
       */
      attachmentRole: "startFrame" | "reference" | null;
      /** FC-4 —— 商家点名要首帧而这张卡给不了时的那一句(卡面披露的同一份措辞)。 */
      attachmentRoleNote?: string;
      /**
       * FC-2 —— 这张图片卡**接着这条对话正在做的那张图**改(服务端绑的,见
       * `image-continuation.ts`)。缺席 = 没有继承。
       *
       * 与 `attachmentRole` 同一条理由,只是方向相反:绑定不说出口,模型就可能写出
       * 「I'll make you a fresh one」,而卡上明明挂着刚才那张底图 —— 又是一次
       * 「说的与做的」分家,只是这次说的那句更好听。
       */
      continuesCurrentImage?: true;
    }
  | { error: string }
> {
  if (!runContext) throw new Error("OttoContext required");
  // FC-2 —— **归一化在最前面,一次**。这一路上读图片槽的不止铸卡一处(下面的
  // `referenceBudget` 名额、卡面披露、付费前的尺寸闸读的都是同一组 ctx 字段),所以
  // 「接着那张图改」这件事必须在入口就落进 ctx —— 否则名额按 0 张算、卡面按 1 张说,
  // 又是一次「说的与做的」分家。不继承时它原样返回同一个对象。
  const base = runContext.context as OttoContext;
  const ctx = withContinuedImage(base, input);
  /** 绑定发生了吗 —— `withContinuedImage` 不继承时原样返回同一个对象。 */
  const continuesCurrentImage = ctx !== base;

  // Validate entity ownership (security-critical: owner-scoped query).
  // #774 判官 r2 P1:名字与类型跟归属**同一趟**读出来 —— 卡上冻结的就是这一刻的身份,
  // 引擎认人那几句机器指令以后只认它,不会在付费调用前再读一次活名称。
  //
  // FSE-210(判官 P1-1)—— 查询集必须与 `buildProposeCard` 内部并的那份**同一个**集合:模型
  // 自带的 `input.entityIds` 并上这一轮服务端已核过归属的 `ctx.turnEntityIds`。只按
  // `input.entityIds` 查会漏查 turnEntityIds 独有的那几个 —— `buildProposeCard` 的归属闸
  // (`ownedSet`)读不到它们的行,会把一次本该被并集救回来的商家 `@` 误判成「归属不明」而抛
  // `EntityReferenceUnavailableError`。
  const wantedEntityIds = [...new Set([...input.entityIds, ...(ctx.turnEntityIds ?? [])])];
  let ownedEntities: ApprovedEntity[] = [];
  if (wantedEntityIds.length > 0) {
    ownedEntities = await prisma.entity.findMany({
      where: { id: { in: wantedEntityIds }, ownerId: ctx.orgId, deletedAt: null },
      select: { id: true, type: true, name: true },
    });
  }

  // #647 T6 / #775:造不出一张诚实的卡时,`buildProposeCard` 抛 `ProposeRefusal`
  // (引擎被后台关掉 / 这一趟的形状撑不起这段提示词要做的事)。接住它、把 message 原样
  // 交回对话 —— 一张 GEN_CARD 都不落库(下面的 create 根本走不到)。
  // 认的是**基类**,不是逐个理由:再加一种拒绝时这里不用改,也就不会漏掉一种。
  // 别的异常照旧上抛:那是真故障,不该被翻译成一句给商家看的话。
  let built: ProposeCardResult;
  try {
    built = buildProposeCard(input, ctx, ownedEntities);
  } catch (e) {
    if (e instanceof ProposeRefusal) return { error: e.message };
    throw e;
  }
  const {
    cardPayload,
    shownPriceDisplay,
    mentionedEntityIds,
    mentionedVariantSel,
    mentionedElementCount,
    attachmentRole,
    attachmentRoleDowngraded,
  } = built;

  // #619 E-5：截断与「只用第一张挂图」都必须在**批准前**出现在卡面上，不是事后在
  // 详情页解释。
  //
  // #785 判官 r1 P1:数的是**商家真 @ 了谁**(`mentionedEntityIds`,归属过滤后、场景清空前),
  // 不是卡上最终留下的那一份。首帧 i2v 会把卡上的 @元素清空,数清空后的卡就得到 0 张里的
  // 0 张 —— 于是「你那 N 张一张都不会用上」永远不出现,商家批准前什么都不知道。分母来自
  // 商家给的东西,分子(真会上车几张)照旧只来自 `referenceBudget`。
  const usesAttachedImage = cardPayload.kind === "image" && !!cardPayload.sourceGenerationId;
  const attachedImageCount = ctx.sourceGenerationIds?.length ?? (ctx.sourceGenerationId ? 1 : 0);
  // #785：视频这一支的名额取决于这张卡自己的形状(有没有首帧 / 整段参考视频)——
  // `referenceBudget` 与 worker 读的是同一个 `conditioningCap`,所以卡上说的张数与
  // 引擎真收到的张数不可能分家。
  const hasVideoStartFrame = cardPayload.kind === "video" && !!cardPayload.sourceGenerationId;
  const hasReferenceVideo = !!cardPayload.referenceVideoGenerationId;
  const budget = referenceBudget({
    kind: cardPayload.kind,
    perEntityLiveCounts: await countLiveReferenceImagesPerEntity(
      ctx.orgId,
      mentionedEntityIds,
      mentionedVariantSel,
    ),
    hasBaseImage: usesAttachedImage,
    attachedImageCount,
    hasVideoStartFrame,
    hasReferenceVideo,
    // FSE-001 判官 r1 P2 —— 名额里每个在场的元素先占 1 格。铸卡时截挂图的那一刀读的是
    // 同一个数(`buildProposeCard` 里那份 `mentionedElementCount`),所以卡上说的张数
    // 与卡上真列出来的那几件不可能分家。
    mentionedElementCount,
  });
  /** FSE-001 —— 这张视频卡真会带上路的商品图张数 = 卡上那一列的长度(已按名额截过)。 */
  const videoAttachedRiding =
    cardPayload.kind === "video" ? (cardPayload.referenceGenerationIds?.length ?? 0) : undefined;
  let finalPayload = withVideoReferenceChip(
    withReferenceBudget(
      cardPayload,
      // #979:那句「一张元素照都不上车」要说得完整,就得知道**为什么**不上车 ——
      // 同一组布尔既喂给名额计算,也喂给这句话,所以卡上的理由不可能与名额分家。
      buildReferenceBudgetNotes({
        budget,
        attachedImageCount,
        usesAttachedImage,
        videoShape: { hasStartFrame: hasVideoStartFrame, hasReferenceVideo },
        videoAttachedRiding,
      }),
    ),
    budget.used,
  );

  // FSE-001 —— **付费前的尺寸闸 + 自动放大计划**。闸本体搬去 `reference-upscale-gate.ts`,
  // 一个字未改:它有第二个入口(`executeProposePack` 铸的是同样的付费卡),留在这个函数体里
  // 那个入口就照旧漏。契约不变 —— 查在 GEN_CARD 落库之前、预扣之前:拒绝 = $0、零 GEN_CARD、
  // 零 GenJob、账本零新增行。
  const gated = await applyReferenceUpscaleGate(finalPayload, ctx.orgId);
  if ("error" in gated) return gated;
  finalPayload = gated.payload;

  // Persist GEN_CARD (match coworkTurn row shape)
  const last = await prisma.chatMessage.findFirst({
    where: { threadId: ctx.threadId, ownerId: ctx.orgId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  const cardId = newId();
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: ctx.threadId,
      ownerId: ctx.orgId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload: { ...finalPayload, ...(input.goal ? { goal: input.goal } : {}) },
    },
  });

  return {
    cardId,
    shownPriceDisplay,
    attachmentRole,
    // 卡面上写着的那一句,逐字交回给模型(两份措辞就是两种说法)。
    ...(attachmentRoleDowngraded ? { attachmentRoleNote: FIRST_FRAME_DOWNGRADE_NOTE } : {}),
    ...(continuesCurrentImage ? { continuesCurrentImage: true as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const proposeSkill = defineOttoSkill({
  name: "propose",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Build a generation proposal (GEN_CARD) the user can approve and generate later. " +
    "Call this when the user wants to create an image or video. " +
    "Provide kind, an English structuredPrompt, and any referenced entity ids. " +
    "Do NOT pick a model or set a price — those are computed server-side. " +
    "When the user wants a few options to choose from (an 'ad pack'), pass count (2–4) " +
    "to offer that many image variants — images only; video is always a single clip. " +
    "When the user asks for extra-fine detail on a picture, pass fineDetail:true — images " +
    "only; it costs more and the card shows the new price before they approve. " +
    "For a video that needs a starting picture, propose the picture with forVideo:true AND " +
    "videoPrompt (the seedancePrompt text for the clip): the video's own confirmation card " +
    "is then created for the user once that picture is made — never ask them to bring it back.",
  parameters: proposeInput,
  requires: [
    {
      field: "goal",
      question:
        "What is this creative for — its goal/purpose (e.g. an ad to drive signups, a product hero shot for the site)?",
    },
  ],
  execute: executePropose,
});
