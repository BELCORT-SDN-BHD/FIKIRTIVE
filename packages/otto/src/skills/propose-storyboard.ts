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
import {
  storyboardCardInput,
  buildStoryboardPayload,
  shotsMissingFirstFramePrompt,
  type StoryboardCardInput,
} from "./propose-storyboard.helpers.js";

/** 拒绝那句话里的镜头名 —— 商家数的是第几个镜头,所以 0 基序号 +1(同 storyboard-gate1-actions)。 */
function shotLabel(index: number, title?: string): string {
  return title ? `Shot ${index + 1} "${title}"` : `Shot ${index + 1}`;
}

/**
 * creation §5 :172⑤ —— 「这一镜免写首帧文字」的**唯一**判据闸。
 *
 * 免写的只有 @ 到演员(CHARACTER)的镜头,而演员这件事只有服务端读得到(`Entity.type`),
 * 所以 schema 判不了,这道闸只能在这里。位置在落库之前 ⇒ $0:一张卡都不写、一分钱不动。
 *
 * 只 @ 了商品的镜头(产品广告里最常见的特写)照旧是两步,少了首帧文字它会在闸① 把**整张
 * 卡**的首帧一起拒掉 —— 所以要在 Otto 交稿这一刻就说清楚,而不是等商家按下 Make all。
 *
 * 元素读带 ctx.orgId:别家店的演员 id 读不出来 ⇒ 在这里数出 0 ⇒ 那一镜照旧要首帧文字。
 */
async function refuseShotsMissingFirstFramePrompt(
  input: StoryboardCardInput,
  orgId: string,
): Promise<string | null> {
  if (!input.shots.some((s) => !s.firstFramePrompt?.trim())) return null;
  const ids = [...new Set(input.shots.flatMap((s) => s.entityIds ?? []))];
  const owned = ids.length
    ? await prisma.entity.findMany({
        where: { id: { in: ids }, ownerId: orgId, deletedAt: null },
        select: { id: true, type: true },
      })
    : [];
  const cast = new Set(owned.filter((e) => e.type === "CHARACTER").map((e) => e.id));
  const missing = shotsMissingFirstFramePrompt(input.shots, cast);
  if (!missing.length) return null;
  const named = missing.map((i) => shotLabel(i, input.shots[i]!.title)).join(", ");
  const those = missing.length > 1 ? "those shots are" : "that shot is";
  return (
    `${named}: no cast member in there, so ${those} still made in two steps (opening still, then the clip) — ` +
    "write the opening still with seedreamPrompt, put it in each of those shots' firstFramePrompt, and lay " +
    "the storyboard out again. Nothing was made and nothing was charged."
  );
}

export async function executeProposeStoryboard(
  input: StoryboardCardInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ cardId: string } | { error: string }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // creation §5 :172⑤ —— 落库之前的那一道($0)。见 refuseShotsMissingFirstFramePrompt。
  const refusal = await refuseShotsMissingFirstFramePrompt(input, ctx.orgId);
  if (refusal) return { error: refusal };

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
    "Provide storyboardTitle and shots (1–8), each with a videoPrompt. Build each shot's prompts " +
    "by calling seedreamPrompt (first frame) and seedancePrompt (video) FIRST — do not hand-write them. " +
    "A shot that @mentions a CAST MEMBER (a person from the Library) is made in ONE paid step and needs no " +
    "firstFramePrompt; every other shot — including one that @mentions only products — is still made in two " +
    "steps, so it must carry a firstFramePrompt. " +
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
