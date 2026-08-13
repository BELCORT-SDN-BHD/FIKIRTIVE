"use server";
/**
 * storyboard-actions — STORYBOARD_CARD 的 $0 编辑动作(改文字/增/删/重排)。
 * 全部 owner-scoped(身份来自 requireOwner 的 session,绝不来自客户端输入)。
 * 只改卡片 payload —— 不产生 GenJob、不 reserve/settle。
 * 首帧图生成(碰 generate)在 F4,不在这里。
 *
 * #782 r15(判官 r14 P1):「不碰花钱路径」曾经写成「所以随便改」,那是错的。这里确实一分钱
 * 都不花,但 editShotPrompt 删掉的 `videoCardId` / `firstFrameCardId` 是**已经花掉的钱**与
 * 这一镜之间的唯一连线 —— 删了它,那笔钱的产出永远回不来,而下一次 prepare 会开出第二笔账。
 * 所以 editShotPrompt 现在是一笔带卡锁的事务,并且在删指针前先问闸① 的同一个问题。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { MAX_STORYBOARD_SHOTS } from "@fikirtive/otto";
import type { StoryboardCardPayload } from "@fikirtive/otto";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
  applySetContinuity,
} from "./storyboard-edit";
// #782 r15(判官 r14 P1):闸① 早就有「这张子卡此刻算不算在途」的正确判定,编辑路径缺的
// 就是它。人工这一面与 Otto 那一面共用同一份判定、同一句话 —— 只关一扇门等于没关。
// 见 packages/otto/src/storyboard-child-job.ts 的模块说明。
import { lockCardTx, inFlightPointerBlock } from "@fikirtive/otto";

type Ok = { payload: StoryboardCardPayload };
type Err = { error: string };

const cardIdSchema = z.string().min(1);

/** owner-scoped 载入一张 STORYBOARD_CARD;身份来自 session。 */
async function loadCard(cardId: string, ownerId: string) {
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, thread: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return null;
  return card;
}

/** 回写新 payload(只改 payload,绝不动 genJobId)。
 *  并发模型:read-modify-write,last-write-wins —— 两端同时编辑最坏是丢一次编辑。
 *  用它的四个动作(add / delete / reorder / setContinuity)都不删已付费的子卡指针,
 *  所以「丢一次编辑」是这里唯一的坏结果。editShotPrompt 会删,因此它**不**走这条路:
 *  见下面那一笔带卡锁的事务(#782 r15,判官 r14 P1)。 */
async function persist(cardId: string, payload: StoryboardCardPayload): Promise<Ok> {
  await prisma.chatMessage.update({
    where: { id: cardId },
    data: { payload: payload as unknown as Prisma.InputJsonObject },
  });
  return { payload };
}

const editInput = z.object({
  cardId: cardIdSchema,
  index: z.number().int().min(0),
  firstFramePrompt: z.string().trim().min(1).max(2000).optional(),
  videoPrompt: z.string().trim().min(1).max(2000).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
});

export async function editShotPrompt(raw: unknown): Promise<Ok | Err> {
  const parsed = editInput.safeParse(raw);
  // G 闸②:durationSeconds 也是可改字段 —— 三者都不传才拒。
  if (
    !parsed.success ||
    (parsed.data.firstFramePrompt === undefined &&
      parsed.data.videoPrompt === undefined &&
      parsed.data.durationSeconds === undefined)
  ) {
    return { error: "That edit isn't valid." };
  }
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, index, firstFramePrompt, videoPrompt, durationSeconds } = parsed.data;
    const ownerId = gate.ownerId;
    const card = await loadCard(cardId, ownerId);
    if (!card) return { error: "Card not found." };
    // #782 r15 —— 判定与删指针必须是**同一笔事务**,不能 check-then-act 分开跑:两步之间
    // 任何一个写者插进来(prepare 换指针、regen 铸替换卡、sync 落产出),我们就会拿着一份
    // 过期的答案去删一个已经不是原来那条的指针。取的是闸① 那五个 RMW 用的**同一把**卡级
    // advisory lock,所以同一张父卡的写者严格串行;锁内重读父卡,锁前快照一格都不进写路径。
    let out: Ok | Err = { error: "Card not found." };
    await prisma.$transaction(async (tx) => {
      await lockCardTx(tx, card.id);
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null, thread: { deletedAt: null, ownerId } },
        select: { payload: true },
      });
      // 卡在等锁期间没了(删除 / kind 变了 / payload 空 / thread 失活)→ 零写入,
      // 且**不**回退到锁前快照 —— 过期快照绝不驱动写(与闸① 的 R3①/R5① 同一条)。
      if (!fresh?.payload) { out = { error: "Card not found." }; return; }
      const cur = fresh.payload as unknown as StoryboardCardPayload;
      if (index >= cur.shots.length) { out = { error: "That shot no longer exists." }; return; }
      const blocked = await inFlightPointerBlock(tx, ownerId, cur.shots[index]!, firstFramePrompt !== undefined);
      if (blocked) { out = { error: blocked }; return; }
      const next = applyEditShotPrompt(cur, index, { firstFramePrompt, videoPrompt, durationSeconds });
      await tx.chatMessage.update({
        where: { id: cardId },
        data: { payload: next as unknown as Prisma.InputJsonObject },
      });
      out = { payload: next };
    });
    return out;
  });
}

const addInput = z.object({
  cardId: cardIdSchema,
  title: z.string().trim().max(120).optional(),
  firstFramePrompt: z.string().trim().min(1).max(2000),
  videoPrompt: z.string().trim().min(1).max(2000),
});

export async function addShot(raw: unknown): Promise<Ok | Err> {
  const parsed = addInput.safeParse(raw);
  if (!parsed.success) return { error: "That shot isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, title, firstFramePrompt, videoPrompt } = parsed.data;
    const card = await loadCard(cardId, gate.ownerId);
    if (!card) return { error: "Card not found." };
    const cur = (card.payload ?? {}) as StoryboardCardPayload;
    if (cur.shots.length >= MAX_STORYBOARD_SHOTS) return { error: `A storyboard can have at most ${MAX_STORYBOARD_SHOTS} shots.` };
    // shotId 在 ACTION 层铸造(纯 edit 层保持确定性)——F4 付费写回按它定位镜头。
    return persist(cardId, applyAddShot(cur, { shotId: newId(), title, firstFramePrompt, videoPrompt }));
  });
}

const deleteInput = z.object({ cardId: cardIdSchema, index: z.number().int().min(0) });

export async function deleteShot(raw: unknown): Promise<Ok | Err> {
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return { error: "That delete isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, index } = parsed.data;
    const card = await loadCard(cardId, gate.ownerId);
    if (!card) return { error: "Card not found." };
    const cur = (card.payload ?? {}) as StoryboardCardPayload;
    if (index >= cur.shots.length) return { error: "That shot no longer exists." };
    if (cur.shots.length <= 1) return { error: "A storyboard needs at least one shot." };
    return persist(cardId, applyDeleteShot(cur, index));
  });
}

const continuityInput = z.object({ cardId: cardIdSchema, continuity: z.boolean() });

/** #782 接续开关(人工那一面)——$0,与 Otto 的 `editStoryboard op=setContinuity`
 *  共用同一条纯变换,两面不可能对同一个开关有两种语义。不碰任何已生成的帧/片。 */
export async function setStoryboardContinuity(raw: unknown): Promise<Ok | Err> {
  const parsed = continuityInput.safeParse(raw);
  if (!parsed.success) return { error: "That change isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, continuity } = parsed.data;
    const card = await loadCard(cardId, gate.ownerId);
    if (!card) return { error: "Card not found." };
    const cur = (card.payload ?? {}) as StoryboardCardPayload;
    return persist(cardId, applySetContinuity(cur, continuity));
  });
}

const reorderInput = z.object({ cardId: cardIdSchema, order: z.array(z.number().int().min(0)).min(1) });

export async function reorderShots(raw: unknown): Promise<Ok | Err> {
  const parsed = reorderInput.safeParse(raw);
  if (!parsed.success) return { error: "That reorder isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, order } = parsed.data;
    const card = await loadCard(cardId, gate.ownerId);
    if (!card) return { error: "Card not found." };
    const cur = (card.payload ?? {}) as StoryboardCardPayload;
    const next = applyReorderShots(cur, order);
    if (next === cur) return { error: "That reorder isn't valid." }; // 非合法排列 → 纯函数原样返回
    return persist(cardId, next);
  });
}
