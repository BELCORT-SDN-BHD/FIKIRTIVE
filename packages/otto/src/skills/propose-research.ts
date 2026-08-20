/**
 * proposeResearch — $0 skill
 *
 * Persists a RESEARCH_CARD (a research PLAN: topic, goal, depth tier, sub-questions,
 * display estimate). Spends NO money, creates NO GenJob — approval + reserve + the
 * worker research loop are S3. Identity from ctx only.
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import { researchCardInput, buildResearchCardPayload, type ResearchCardInput } from "./propose-research.helpers.js";

export async function executeProposeResearch(
  input: ResearchCardInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cardId: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const payload = buildResearchCardPayload(input);

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
      kind: "RESEARCH_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload,
    },
  });

  return { cardId };
}

export const proposeResearchSkill = defineOttoSkill({
  name: "proposeResearch",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Draft a RESEARCH plan (RESEARCH_CARD) the user can review and approve before any research runs. " +
    "Provide topic and (optionally) goal, a depth tier (quick / standard / deep), and sub-questions to investigate. " +
    "$0: this only drafts the plan and shows an estimated cost; the actual multi-step research (search + read) " +
    "runs later in the background after the user approves the card.",
  parameters: researchCardInput,
  requires: [
    {
      field: "topic",
      question: "What topic or question should I research?",
    },
  ],
  execute: executeProposeResearch,
});
