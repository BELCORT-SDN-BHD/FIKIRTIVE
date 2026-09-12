/**
 * proposeStoryboard — $0 skill
 *
 * Persists an ordered STORYBOARD_CARD (per shot: a video prompt — that's the whole
 * input shape now, see propose-storyboard.helpers.ts). Otto assembles each shot's
 * video prompt via the E skill (seedancePrompt) BEFORE calling this. Spends NO
 * money, creates NO GenJob. Identity from ctx only.
 *
 * FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 首帧合成(闸①)对所有镜头都已
 * 退场:没有「两步」这一档,`refuseShotsMissingFirstFramePrompt`(点名「这一镜要走两步却
 * 没有首帧文字」)随之整段报废删除,不留替代覆盖(报废,不是迁移)。PR #1417 判官 P2-1 —
 * `firstFramePrompt` 那一格本身(不只是它的拒绝闸)也已从输入 schema 里删除,不再是
 * 「接受但不用」的遗留字段(报废,不是保留兼容)。
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import {
  storyboardCardInput,
  buildStoryboardPayload,
  type StoryboardCardInput,
} from "./propose-storyboard.helpers.js";

export async function executeProposeStoryboard(
  input: StoryboardCardInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cardId: string } | { error: string }> {
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
    "Provide storyboardTitle and shots (1–8), each with a videoPrompt. Build each shot's videoPrompt " +
    "by calling seedancePrompt FIRST — do not hand-write it. Every shot is made in one paid step directly " +
    "into a clip (no separate opening-still step), whether or not it @mentions a cast member. " +
    "$0: this only drafts the storyboard; videos are generated later after the user approves.",
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
