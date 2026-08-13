/**
 * propose — $0 tool
 *
 * Builds and persists a GEN_CARD chat message (a generation proposal the user
 * can later approve). Spends NO money, creates NO GenJob, calls NO fal/generation code.
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
  GenerationUnavailableError,
  type ProposeInput,
  type CardPayload,
  type ProposeCardResult,
} from "./propose.helpers.js";

// Re-export types + pure helper so consumers can import from either file
export type { CardPayload, ProposeCardResult };
export { buildProposeCard, GenerationUnavailableError };

/**
 * #619 E-5：**逐个** @元素有多少张活参考照，顺序 = 卡上的 `entityIds` 顺序。
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

  // #647 T6:唯一那台引擎被后台关掉时,`buildProposeCard` 抛 GenerationUnavailableError。
  // 接住它、把它的 message 原样交回对话 —— 一张 GEN_CARD 都不落库(下面的 create 根本
  // 走不到)。别的异常照旧上抛:那是真故障,不该被翻译成一句「关掉了」。
  let built: ProposeCardResult;
  try {
    built = buildProposeCard(input, ctx, ownedEntities);
  } catch (e) {
    if (e instanceof GenerationUnavailableError) return { error: e.message };
    throw e;
  }
  const { cardPayload, shownPriceDisplay } = built;

  // #619 E-5：截断与「只用第一张挂图」都必须在**批准前**出现在卡面上，不是事后在
  // 详情页解释。数的是卡上最终留下的元素（buildProposeCard 已做归属过滤与 i2v 清空）——
  // 那也正是 GenJob 会带走、worker 会照着取图的那一份。
  const usesAttachedImage = cardPayload.kind === "image" && !!cardPayload.sourceGenerationId;
  const attachedImageCount = ctx.sourceGenerationIds?.length ?? (ctx.sourceGenerationId ? 1 : 0);
  const finalPayload = withReferenceBudget(
    cardPayload,
    buildReferenceBudgetNotes({
      budget: referenceBudget({
        kind: cardPayload.kind,
        perEntityLiveCounts: await countLiveReferenceImagesPerEntity(
          ctx.orgId,
          cardPayload.entityIds,
          cardPayload.variantSel,
        ),
        hasBaseImage: usesAttachedImage,
        attachedImageCount,
      }),
      attachedImageCount,
      usesAttachedImage,
    }),
  );

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
    "to offer that many image variants — images only; video is always a single clip.",
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

export const propose = proposeSkill.tool;
