/**
 * editStoryboard — $0 skill(W-B3-C,对等债 debt-11~13/75~77 清偿件)
 *
 * Edits an EXISTING STORYBOARD_CARD the same way the human server actions do
 * (apps/web/lib/storyboard-actions.ts):edit a shot's prompts/duration, add a
 * shot, delete a shot, or reorder shots. Spends NO money, creates NO GenJob,
 * touches NO genJobId/spend field — it only rewrites the card payload through
 * the SAME pure transforms (../storyboard-edit.js) the human action layer uses,
 * so the two executors cannot drift (含 G 闸② 陈旧级联:改帧文字才作废已付费
 * 首帧;改视频文字/时长只作废视频)。
 *
 * Identity from ctx ONLY (orgId = ownerId);cardId 来自模型但载入必须 owner-scoped
 * (id + ownerId + kind + 双 deletedAt),防跨租户/跨类卡。边界策略与动作层一致:
 * add ≤ MAX_STORYBOARD_SHOTS、delete 后 ≥1 镜头、reorder 必须合法排列。
 * Make all / Retry(付费管线)绝不在此 —— 那是 storyboard-gate1-actions(批2 W-B3-H)。
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { newId } from "@fikirtive/core";
import { prisma, Prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";
import { MAX_STORYBOARD_SHOTS, type StoryboardCardPayload } from "./propose-storyboard.helpers.js";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
} from "../storyboard-edit.js";

export const editStoryboardInput = z.object({
  cardId: z.string().min(1).describe("The STORYBOARD_CARD id being edited (from the storyboard card in this conversation)."),
  op: z.enum(["editShot", "addShot", "deleteShot", "reorderShots"]),
  /** editShot / deleteShot:0-based shot index(卡片镜头列表里的当前位置). */
  index: z.number().int().min(0).optional(),
  /** editShot(至少给一项)/ addShot(必给):镜头文字与时长. */
  firstFramePrompt: z.string().trim().min(1).max(2000).optional(),
  videoPrompt: z.string().trim().min(1).max(2000).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
  /** addShot 可选标题. */
  title: z.string().trim().max(120).optional(),
  /** reorderShots:当前 0-based index 的一个完整排列,如 [2,0,1]. */
  order: z.array(z.number().int().min(0)).optional(),
});

export type EditStoryboardInput = z.infer<typeof editStoryboardInput>;

type EditResult = { cardId: string; shotCount: number } | { error: string };

export async function executeEditStoryboard(
  input: EditStoryboardInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<EditResult> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  // owner-scoped 载入(同 storyboard-actions.loadCard:id + ownerId + kind + 双 deletedAt)。
  const card = await prisma.chatMessage.findFirst({
    where: { id: input.cardId, ownerId: ctx.orgId, kind: "STORYBOARD_CARD", deletedAt: null },
    select: { id: true, payload: true, thread: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ctx.orgId) {
    return { error: "Card not found." };
  }
  const cur = (card.payload ?? {}) as StoryboardCardPayload;

  let next: StoryboardCardPayload;
  switch (input.op) {
    case "editShot": {
      if (input.index === undefined) return { error: "editShot needs a shot index." };
      if (
        input.firstFramePrompt === undefined &&
        input.videoPrompt === undefined &&
        input.durationSeconds === undefined
      ) {
        return { error: "editShot needs at least one of firstFramePrompt, videoPrompt or durationSeconds." };
      }
      if (input.index >= cur.shots.length) return { error: "That shot no longer exists." };
      next = applyEditShotPrompt(cur, input.index, {
        firstFramePrompt: input.firstFramePrompt,
        videoPrompt: input.videoPrompt,
        durationSeconds: input.durationSeconds,
      });
      break;
    }
    case "addShot": {
      if (input.firstFramePrompt === undefined || input.videoPrompt === undefined) {
        return { error: "addShot needs both firstFramePrompt and videoPrompt." };
      }
      if (cur.shots.length >= MAX_STORYBOARD_SHOTS) {
        return { error: `A storyboard can have at most ${MAX_STORYBOARD_SHOTS} shots.` };
      }
      // shotId 在执行层铸造(纯 edit 层保持确定性)——付费写回按它定位镜头(同动作层)。
      next = applyAddShot(cur, {
        shotId: newId(),
        title: input.title,
        firstFramePrompt: input.firstFramePrompt,
        videoPrompt: input.videoPrompt,
      });
      break;
    }
    case "deleteShot": {
      if (input.index === undefined) return { error: "deleteShot needs a shot index." };
      if (input.index >= cur.shots.length) return { error: "That shot no longer exists." };
      if (cur.shots.length <= 1) return { error: "A storyboard needs at least one shot." };
      next = applyDeleteShot(cur, input.index);
      break;
    }
    case "reorderShots": {
      if (!input.order) return { error: "reorderShots needs the new order." };
      next = applyReorderShots(cur, input.order);
      if (next === cur) return { error: "That reorder isn't valid." }; // 非合法排列 → 纯函数原样返回
      break;
    }
  }

  // 回写新 payload(只改 payload,绝不动 genJobId)。并发模型同动作层:
  // read-modify-write,last-write-wins($0 payload 写,零 money 耦合)。
  await prisma.chatMessage.update({
    where: { id: card.id },
    data: { payload: next as unknown as Prisma.InputJsonObject },
  });
  return { cardId: card.id, shotCount: next.shots.length };
}

export const editStoryboardSkill = defineOttoSkill({
  name: "editStoryboard",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Edit an EXISTING storyboard card the user is reviewing: change a shot's prompts or duration (op=editShot), " +
    "add a shot (op=addShot, build its prompts via seedreamPrompt/seedancePrompt first), remove a shot (op=deleteShot), " +
    "or reorder shots (op=reorderShots with the full new order, e.g. [2,0,1]). " +
    "$0: this only rewrites the draft storyboard; it never generates or re-generates any image/video.",
  parameters: editStoryboardInput,
  execute: executeEditStoryboard,
});

export const editStoryboard = editStoryboardSkill.tool;
