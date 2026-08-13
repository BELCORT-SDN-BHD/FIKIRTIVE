/**
 * proposeStoryboard — $0 skill
 *
 * Persists an ordered STORYBOARD_CARD (per shot: first-frame prompt + video prompt).
 * Otto assembles each shot's prompts via the D/E skills (seedreamPrompt / seedancePrompt)
 * BEFORE calling this. Spends NO money, creates NO GenJob. Identity from ctx only.
 * First-frame images (gate ①) are generated later (block F4), never here.
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import { storyboardCardInput, buildStoryboardPayload, type StoryboardCardInput } from "./propose-storyboard.helpers.js";

export async function executeProposeStoryboard(
  input: StoryboardCardInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cardId: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const payload = buildStoryboardPayload(input);

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
      kind: "STORYBOARD_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload,
    },
  });

  return { cardId };
}

export const proposeStoryboardSkill = defineOttoSkill({
  name: "proposeStoryboard",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Lay out an ordered STORYBOARD for a video/ad the user can review and edit before anything is generated. " +
    "Provide storyboardTitle and shots (1–8), each with firstFramePrompt + videoPrompt. Build each shot's prompts " +
    "by calling seedreamPrompt (first frame) and seedancePrompt (video) FIRST — do not hand-write them. " +
    "Set continuity:true when the shots are one unbroken take — the same scene, the same subject, the camera or the " +
    "action simply carrying on — so each shot starts exactly where the one before it stopped. Leave it off when the " +
    "shots are separate moments (different places, a cut between scenes), which is the common case for a product ad. " +
    "With continuity on, only the first shot needs a first-frame image; every later shot picks up the frame the " +
    "previous shot ended on, so the shots are made one after another instead of all at once. " +
    "$0: this only drafts the storyboard; first-frame images and videos are generated later after the user approves.",
  parameters: storyboardCardInput,
  requires: [
    {
      field: "goal",
      question:
        "What is this storyboard/video for — its goal/purpose (e.g. a festive launch ad to drive store visits)?",
    },
  ],
  execute: executeProposeStoryboard,
});

export const proposeStoryboard = proposeStoryboardSkill.tool;
