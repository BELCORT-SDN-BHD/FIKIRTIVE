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
import { newId, referenceBudget } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import {
  proposeInput,
  buildProposeCard,
  buildReferenceBudgetNotes,
  withReferenceBudget,
  type ProposeInput,
  type CardPayload,
  type ProposeCardResult,
} from "./propose.helpers.js";

// Re-export types + pure helper so consumers can import from either file
export type { CardPayload, ProposeCardResult };
export { buildProposeCard };

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
): Promise<{ cardId: string; shownPriceDisplay: number }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // Validate entity ownership (security-critical: owner-scoped query)
  let ownedEntityIds: string[] = [];
  if (input.entityIds.length > 0) {
    const owned = await prisma.entity.findMany({
      where: { id: { in: input.entityIds }, ownerId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    ownedEntityIds = owned.map((e) => e.id);
  }

  const { cardPayload, shownPriceDisplay } = buildProposeCard(input, ctx, ownedEntityIds);

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
