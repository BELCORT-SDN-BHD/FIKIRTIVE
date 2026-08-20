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
  applySetContinuity,
} from "../storyboard-edit.js";
// #782 r15(判官 r14 P1):editShot 会删掉「已经花掉的钱」与这一镜之间的唯一连线,所以它
// 在删之前必须问一次「那条作业还在途吗」——与人工动作层**同一份**判定、同一句话。
import { lockCardTx, inFlightPointerBlock } from "../storyboard-child-job.js";

export const editStoryboardInput = z.object({
  cardId: z.string().min(1).describe("The STORYBOARD_CARD id being edited (from the storyboard card in this conversation)."),
  op: z.enum(["editShot", "addShot", "deleteShot", "reorderShots", "setContinuity"]),
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
  /** setContinuity(#782):镜头是否一镜接一镜(下一镜从上一镜真实停住的那一帧起步). */
  continuity: z.boolean().optional(),
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

  // #782 r15(判官 r14 P1)—— editShot 是唯一会删掉付费子卡指针的那一个 op,所以只有它走
  // 「卡锁 → 锁内重读 → 在途闸 → 写」这一笔事务。判定与删指针必须在同一笔事务里:分成两步跑
  // 就等于给「作业在两步之间落账」留一个窗口。取的是闸① 那五个 RMW 用的同一把卡级 advisory
  // lock,所以人工动作、这里、以及 prepare/regen/sync 在同一张父卡上严格串行。
  //
  // 其余四个 op(add / delete / reorder / setContinuity)一格不删已付费指针,照旧走下面的
  // last-write-wins 写回,一个字没改。
  if (input.op === "editShot") {
    if (input.index === undefined) return { error: "editShot needs a shot index." };
    if (
      input.firstFramePrompt === undefined &&
      input.videoPrompt === undefined &&
      input.durationSeconds === undefined
    ) {
      return { error: "editShot needs at least one of firstFramePrompt, videoPrompt or durationSeconds." };
    }
    const index = input.index;
    let out: EditResult = { error: "Card not found." };
    await prisma.$transaction(async (tx) => {
      await lockCardTx(tx, card.id);
      const fresh = await tx.chatMessage.findFirst({
        where: {
          id: card.id, ownerId: ctx.orgId, kind: "STORYBOARD_CARD", deletedAt: null,
          thread: { deletedAt: null, ownerId: ctx.orgId },
        },
        select: { payload: true },
      });
      // 卡在等锁期间没了 → 零写入,且不回退到锁前快照(过期快照绝不驱动写)。
      if (!fresh?.payload) { out = { error: "Card not found." }; return; }
      const locked = fresh.payload as unknown as StoryboardCardPayload;
      if (index >= locked.shots.length) { out = { error: "That shot no longer exists." }; return; }
      const blocked = await inFlightPointerBlock(tx, ctx.orgId, locked.shots[index]!, {
        firstFramePrompt: input.firstFramePrompt,
        videoPrompt: input.videoPrompt,
        durationSeconds: input.durationSeconds,
      });
      if (blocked) { out = { error: blocked }; return; }
      const edited = applyEditShotPrompt(locked, index, {
        firstFramePrompt: input.firstFramePrompt,
        videoPrompt: input.videoPrompt,
        durationSeconds: input.durationSeconds,
      });
      await tx.chatMessage.update({
        where: { id: card.id },
        data: { payload: edited as unknown as Prisma.InputJsonObject },
      });
      out = { cardId: card.id, shotCount: edited.shots.length };
    });
    return out;
  }

  let next: StoryboardCardPayload;
  switch (input.op) {
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
    case "setContinuity": {
      // #782:接续开关走**同一套**纯变换(applySetContinuity),与人工动作层
      // setStoryboardContinuity 逐字同源 —— 两个执行器不可能对同一个开关有两种语义。
      if (input.continuity === undefined) return { error: "setContinuity needs continuity true or false." };
      next = applySetContinuity(cur, input.continuity);
      break;
    }
  }

  // 回写新 payload(只改 payload,绝不动 genJobId)。并发模型同动作层:read-modify-write,
  // last-write-wins —— 走到这里的四个 op 都不删已付费的子卡指针,所以「丢一次编辑」是这里
  // 唯一的坏结果(#782 r15:editShot 会删,所以它在上面走了带卡锁的事务,不到这一行)。
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
    "reorder shots (op=reorderShots with the full new order, e.g. [2,0,1]), " +
    "or turn continuous shots on/off (op=setContinuity with continuity true/false) when the user says the shots " +
    "should flow as one unbroken take, or should be separate moments instead. " +
    "$0: this only rewrites the draft storyboard; it never generates or re-generates any image/video.",
  parameters: editStoryboardInput,
  execute: executeEditStoryboard,
});
