"use server";
/**
 * storyboard-actions — STORYBOARD_CARD 的 $0 编辑动作(改文字/增/删/重排)。
 * 全部 owner-scoped(身份来自 requireOwner 的 session,绝不来自客户端输入)。
 * 只改卡片 payload —— 不产生 GenJob、不 reserve/settle、不碰任何花钱路径。
 * 首帧图生成(碰 generate)在 F4,不在这里。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { MAX_STORYBOARD_SHOTS } from "@fikirtive/otto";
import type { StoryboardCardPayload } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
} from "./storyboard-edit";

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
 *  并发模型:read-modify-write,last-write-wins($0 payload 写,零 money 耦合 ——
 *  两端同时编辑最坏是丢一次编辑,绝不会重复扣费或污染花钱状态,故不加乐观锁)。 */
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
});

export async function editShotPrompt(raw: unknown): Promise<Ok | Err> {
  const parsed = editInput.safeParse(raw);
  if (!parsed.success || (parsed.data.firstFramePrompt === undefined && parsed.data.videoPrompt === undefined)) {
    return { error: "That edit isn't valid." };
  }
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, index, firstFramePrompt, videoPrompt } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (index >= cur.shots.length) return { error: "That shot no longer exists." };
  return persist(cardId, applyEditShotPrompt(cur, index, { firstFramePrompt, videoPrompt }));
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
  const { cardId, title, firstFramePrompt, videoPrompt } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (cur.shots.length >= MAX_STORYBOARD_SHOTS) return { error: `A storyboard can have at most ${MAX_STORYBOARD_SHOTS} shots.` };
  return persist(cardId, applyAddShot(cur, { title, firstFramePrompt, videoPrompt }));
}

const deleteInput = z.object({ cardId: cardIdSchema, index: z.number().int().min(0) });

export async function deleteShot(raw: unknown): Promise<Ok | Err> {
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return { error: "That delete isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, index } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (index >= cur.shots.length) return { error: "That shot no longer exists." };
  if (cur.shots.length <= 1) return { error: "A storyboard needs at least one shot." };
  return persist(cardId, applyDeleteShot(cur, index));
}

const reorderInput = z.object({ cardId: cardIdSchema, order: z.array(z.number().int().min(0)).min(1) });

export async function reorderShots(raw: unknown): Promise<Ok | Err> {
  const parsed = reorderInput.safeParse(raw);
  if (!parsed.success) return { error: "That reorder isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { cardId, order } = parsed.data;
  const card = await loadCard(cardId, gate.ownerId);
  if (!card) return { error: "Card not found." };
  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  const next = applyReorderShots(cur, order);
  if (next === cur) return { error: "That reorder isn't valid." }; // 非合法排列 → 纯函数原样返回
  return persist(cardId, next);
}
