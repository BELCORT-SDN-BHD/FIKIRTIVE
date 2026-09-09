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
import {
  newId,
  referenceBudget,
  // FSE-001 —— 付费前的参考图尺寸闸:判据、租户 scope 与措辞各只有一处。
  generationReferenceScope,
  lineageCarriesOfficialActor,
  referenceUpscalePlan,
  referenceUnavailableMessage,
  REFERENCE_IMAGE_EXTS,
  type ApprovedEntity,
} from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import {
  proposeInput,
  buildProposeCard,
  buildReferenceBudgetNotes,
  referenceUpscaleNote,
  withReferenceBudget,
  withVideoReferenceChip,
  GenerationUnavailableError,
  ProposeRefusal,
  type ProposeInput,
  type CardPayload,
  type ProposeCardResult,
} from "./propose.helpers.js";

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
): Promise<{ cardId: string; shownPriceDisplay: number } | { error: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // Validate entity ownership (security-critical: owner-scoped query).
  // #774 判官 r2 P1:名字与类型跟归属**同一趟**读出来 —— 卡上冻结的就是这一刻的身份,
  // 引擎认人那几句机器指令以后只认它,不会在付费调用前再读一次活名称。
  let ownedEntities: ApprovedEntity[] = [];
  if (input.entityIds.length > 0) {
    ownedEntities = await prisma.entity.findMany({
      where: { id: { in: input.entityIds }, ownerId: ctx.orgId, deletedAt: null },
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
  const { cardPayload, shownPriceDisplay, mentionedEntityIds, mentionedVariantSel, mentionedElementCount } =
    built;

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

  // FSE-001 —— **付费前的尺寸闸 + 自动放大计划**(staging 探针 2026-09-08 / 09-09 实测)。
  //
  // 视频端在**建任务之前**就查参考图尺寸,闸是**宽与高各 ≥300px**(第三场探针逐字回执:
  // `expected the height to be at least 300px, but received a 300x200px image instead`)。
  // 那道闸在供应商那边不花钱,但它落在我们**预扣之后** —— 商家会先看到一张报了价的卡、
  // 按下 Generate、预扣、失败、退款,读到的只是一句「没成功」,而真正能修好它的动作一个字
  // 都没说。所以查在这里:`buildProposeCard` 已经回来了,但 GEN_CARD 还一行没落库、预扣
  // 还没发生 ⇒ 拒绝 = $0、零 GEN_CARD、零 GenJob、账本零新增行。
  //
  // 上一版只查宽度,那是个真漏洞:一张 400×200 的图过我们的闸、到供应商才被弹,而那时钱
  // 已经预扣。判据现在是短边(`referenceUpscalePlan`,core 里唯一一份,worker 读同一个)。
  //
  // ── 自动放大(Founder 2026-09-09 裁决)──────────────────────────────────────────
  // 短边落在 [100, 300) 时不再拒绝:worker 在提交供应商前按整数倍 lanczos 放大到刚好过门,
  // 产物只用于那一次请求。裁决的边界是「**仅限无人像的商品照**,演员图与任何含人像的图一律
  // 不动」——机器可查的那一半是**演员血统**(`lineageCarriesOfficialActor`):带演员血统的
  // 图做像素再处理会被视频端当真人拒收(规格 §5「像素完整性铁律」,2026-08-30 裁剪实证),
  // 所以那一档仍旧诚实拒绝,不放大。
  //
  // 只查商家挂的那几张商品图:演员的参考照走 Entity 的 `referenceImages`,由播种脚本保证
  // 尺寸(一律 Seedream 原件),根本不经这条挂图的路。
  const videoReferenceIds =
    finalPayload.kind === "video" ? (finalPayload.referenceGenerationIds ?? []) : [];
  if (videoReferenceIds.length > 0) {
    const rows = await prisma.generation.findMany({
      where: {
        id: { in: videoReferenceIds },
        ...generationReferenceScope(ctx.orgId, REFERENCE_IMAGE_EXTS),
      },
      select: { asset: { select: { width: true, height: true } }, entitySnapshot: true },
    });
    let upscaleCount = 0;
    for (const row of rows) {
      const plan = referenceUpscalePlan(row.asset);
      if (plan.action === "refuse") return { error: referenceUnavailableMessage("tooSmall") };
      if (plan.action !== "upscale") continue; // asIs / unknown —— 与这条修改之前逐字相同
      // 带演员血统 ⇒ 一格不动像素 ⇒ 它撑不起这一次引用,花钱前说出来。
      if (lineageCarriesOfficialActor(row.entitySnapshot)) {
        return { error: referenceUnavailableMessage("tooSmall") };
      }
      upscaleCount++;
    }
    // 披露句走的是既有那条路(`withReferenceBudget` 把话并进卡面),所以卡上说的与 worker
    // 真做的只有一份口径。数字不在这里编:它就是上面这一趟数出来的张数。
    //
    // 说不出来的那一档(`unknown`)两边一起沉默:worker 读的是同一对元数据,量不到就不放大,
    // 所以卡上不说、worker 不做,口径仍然只有一份。本站生成的资产落在这一档,而本站出图短边
    // 最小 1344px(`GEN_IMAGE_SIZES`),不可能需要放大;真正的缺口只有「上传图 ingest 还没
    // 量完就被拿去生成」,那一趟与今天逐字相同。补齐它要生成路把出图尺寸写进
    // `Asset.width/height`(规格 §5 FSE-001 残留①)。
    if (upscaleCount > 0) {
      finalPayload = withReferenceBudget(finalPayload, [referenceUpscaleNote(upscaleCount)]);
    }
  }

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

  return { cardId, shownPriceDisplay };
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
