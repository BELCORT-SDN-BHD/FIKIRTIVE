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
    "Provide kind, a structuredPrompt built by the matching prompt skill (seedancePrompt returns " +
    "Chinese for video, seedreamPrompt returns English for image — pass it through unchanged), " +
    "and any referenced entity ids. " +
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
