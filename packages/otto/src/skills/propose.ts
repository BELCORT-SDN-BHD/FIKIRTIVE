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
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import {
  proposeInput,
  buildProposeCard,
  unboundLockedNames,
  type ProposeInput,
  type CardPayload,
  type ProposeCardResult,
} from "./propose.helpers.js";

// Re-export types + pure helper so consumers can import from either file
export type { CardPayload, ProposeCardResult };
export { buildProposeCard };

// ---------------------------------------------------------------------------
// Execute function (DB side) — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executePropose(
  input: ProposeInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cardId: string; shownPriceDisplay: number } | { error: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // Validate entity ownership (security-critical: owner-scoped query)
  let ownedEntityIds: string[] = [];
  let entityRefImageCount: number | undefined;
  if (input.entityIds.length > 0) {
    const owned = await prisma.entity.findMany({
      where: { id: { in: input.entityIds }, ownerId: ctx.orgId, deletedAt: null },
      // #619 E-5: count live BASE refs alongside ownership — a bare mention conditions on
      // these in the worker (same counting rule as checkCast, apps/web/lib/cowork-guardian.ts).
      select: { id: true, _count: { select: { referenceImages: { where: { deletedAt: null, variantId: null } } } } },
    });
    ownedEntityIds = owned.map((e) => e.id);

    // #619 E-5: a variant @mention conditions on THAT variant's live refs instead.
    const selectedVariantIds = owned
      .map((e) => input.variantSel[e.id])
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    const variantCounts = new Map<string, number>();
    if (selectedVariantIds.length > 0) {
      const variants = await prisma.entityVariant.findMany({
        where: { id: { in: selectedVariantIds }, ownerId: ctx.orgId, deletedAt: null },
        select: { id: true, _count: { select: { referenceImages: { where: { deletedAt: null } } } } },
      });
      for (const v of variants) variantCounts.set(v.id, v._count?.referenceImages ?? 0);
    }
    // Total live reference photos the worker would aggregate for this card — feeds the
    // pre-approval truncation disclosure (display-only; never selection/pricing).
    entityRefImageCount = owned.reduce((sum, e) => {
      const variantId = input.variantSel[e.id];
      return sum + (variantId ? (variantCounts.get(variantId) ?? 0) : (e._count?.referenceImages ?? 0));
    }, 0);
  }

  const { cardPayload, shownPriceDisplay } = buildProposeCard(input, ctx, ownedEntityIds, {
    entityRefImageCount,
  });

  // #619 F6: identity-lock ↔ entityIds binding — a prompt that locks a KNOWN element's
  // identity ("keep Rosa identical to the reference …") while that element's id is missing
  // from the card would lock the words but never send the pixels (the character drifts).
  // Refuse the card so Otto re-reports the ids. Image cards only: entity reference images
  // feed image jobs; an i2v/reference-video plan takes identity from the frame itself.
  if (cardPayload.kind === "image") {
    const unbound = unboundLockedNames(
      cardPayload.structuredPrompt,
      cardPayload.entityIds,
      ctx.availableRefs ?? [],
    );
    if (unbound.length > 0) {
      return {
        error:
          `The prompt locks ${unbound.join(", ")} to a reference image, but the matching entity id(s) are missing from entityIds — ` +
          `call propose again including those ids so the reference image actually reaches the model.`,
      };
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
      payload: { ...cardPayload, ...(input.goal ? { goal: input.goal } : {}) },
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
