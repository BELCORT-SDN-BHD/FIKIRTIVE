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
// `parseReferenceRef` —— typed refs 的 wire 形状只有一份口径(`generation:<id>` / `upload:<id>`),
// 这里读它是为了认出「原样带回来的那几张」,绝不在本文件再抄一遍前缀。
import { newId, MAX_TURN_REFERENCES, parseReferenceRef } from "@fikirtive/core";
import { MAX_STORYBOARD_SHOTS } from "@fikirtive/otto";
// creation §5 :178 —— @ 选进来的 typed refs 在这里解析成规范身份(Generation.id)。
// 与聊天那一轮**同一个**解析器:owner 判据、格式判据、去重口径不可能各写一份。
import { resolveOwnedReferenceRefs } from "./reference-refs";
import type { StoryboardCardPayload } from "@fikirtive/otto";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import {
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
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
 *  用它的三个动作(add / delete / reorder)都不删已付费的子卡指针,
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
  videoPrompt: z.string().trim().min(1).max(2000).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
});

export async function editShotPrompt(raw: unknown): Promise<Ok | Err> {
  const parsed = editInput.safeParse(raw);
  // G 闸②:durationSeconds 也是可改字段 —— 两者都不传才拒。
  if (
    !parsed.success ||
    (parsed.data.videoPrompt === undefined &&
      parsed.data.durationSeconds === undefined)
  ) {
    return { error: "That edit isn't valid." };
  }
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, index, videoPrompt, durationSeconds } = parsed.data;
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
      const blocked = await inFlightPointerBlock(tx, ownerId, cur.shots[index]!, { videoPrompt, durationSeconds });
      if (blocked) { out = { error: blocked }; return; }
      const next = applyEditShotPrompt(cur, index, { videoPrompt, durationSeconds });
      await tx.chatMessage.update({
        where: { id: cardId },
        data: { payload: next as unknown as Prisma.InputJsonObject },
      });
      out = { payload: next };
    });
    return out;
  });
}

const referencesInput = z.object({
  cardId: cardIdSchema,
  index: z.number().int().min(0),
  /** 商家 @ 选的那几件,typed refs 的 wire 形状(`generation:<id>` / `upload:<Asset.id>`)。
   *  空数组 = 把这一镜挂的图全部取下。 */
  refs: z.array(z.string().min(1).max(96)).max(MAX_TURN_REFERENCES),
});

/**
 * creation §5 :178 —— 给一镜挂 Library 图(人工那一面),$0。
 *
 * 商家 @ 选的是 typed refs(`generation:` / `upload:`);落进分镜 payload 的却是**规范身份**
 * `Generation.id` —— 上传件的 wire 带的是 Asset id,而真会上路的是摄取它的那一行 Generation,
 * 那一步映射只有读过行才做得到。所以解析在这里做一次(`resolveOwnedReferenceRefs`,与聊天那
 * 一轮**同一个**解析器、同一条 owner 判据),下游一路不必再猜。
 *
 * 跨租户:解析器每一条查询都带 `ownerId`,而 `ownerId` 只来自 `requireOwner()` 的 session ——
 * 别家店的 id 在这里解析不出来,于是走「有一件取不到 ⇒ 整次拒绝、零写入」那条路,而不是
 * 悄悄少挂一张(那正是 FSE-002 的病灶)。回答不区分「别人家的」与「你自己删掉的」,所以它
 * 也当不了存在性问答机。
 *
 * 视频那一格的陈旧级联与在途闸不在这里手写:patch 走 `applyEditShotPrompt` /
 * `inFlightPointerBlock` 那条**同一条**路(见 `ShotPromptPatch.referenceGenerationIds`)。
 */
export async function setShotReferences(raw: unknown): Promise<Ok | Err> {
  const parsed = referencesInput.safeParse(raw);
  if (!parsed.success) return { error: "That change isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, index, refs } = parsed.data;
    const ownerId = gate.ownerId;
    const card = await loadCard(cardId, ownerId);
    if (!card) return { error: "Card not found." };
    /**
     * creation §5 :178(判官 r4 P1)—— **只减不增的那一趟不再解析一次。**
     *
     * 卡面唯一的取下入口是逐张的 X,它交出的是「减掉这一张」的**整份剩余清单**;而解析器的
     * where 带 `deletedAt: null`(`reference-refs.ts`)。于是剩下那几张里只要有一张已经被删出
     * Library(`deleteGeneration` 是软删,分镜卡上挂着的清单一格不动),整次编辑就在这里被判
     * unresolved、零写入 —— 这一镜「挂着图、又拿不下来」,而闸①/闸② 同时对整张卡 fail closed,
     * 同卡别的镜头也出不了片,拒绝句给的两条出路在卡面上一条都走不通。
     *
     * 清单里的每一格都是这一镜此刻就挂着的规范身份 ⇒ 归属早在它被挂上那一刻按 ownerId 查过,
     * 而归属不会随删除改变;别家店的 id 进不了这份清单(它当初就被拒过),所以这条捷径不是
     * 一道租户口子。只要多出一张新的,整份照旧走解析器 —— 归属、格式、跨租户三道判据一格没动。
     */
    const attached = new Set(
      (card.payload as StoryboardCardPayload | null)?.shots?.[index]?.referenceGenerationIds ?? [],
    );
    const keptIds = refs.map((ref) => parseReferenceRef(ref)).map((ref) => (ref?.type === "generation" ? ref.id : null));
    let referenceGenerationIds: string[];
    if (keptIds.every((id) => id !== null && attached.has(id))) {
      // 只减不增(逐张取下、一次全取下、原样重发、重排)——一格都不必再问数据库。
      referenceGenerationIds = [...new Set(keptIds as string[])];
    } else {
      const resolved = await resolveOwnedReferenceRefs(ownerId, refs);
      if (resolved.unresolved > 0) {
        return { error: "One of those isn't one of your images any more — pick another. Nothing was changed." };
      }
      if (resolved.unusableFormat > 0) {
        return { error: "One of those files can't be used as a reference — pick an image instead. Nothing was changed." };
      }
      // 元素(`@产品`/`@演员`)走的是 `entityIds` 那条既有通道,不是这一格。混进来就整次拒绝,
      // 免得商家以为自己给这一镜挂上了一件其实走了另一条路的东西。
      if (resolved.entityIds.length > 0) {
        return { error: "Pick images from your Library here — a product or a person goes in the shot's description instead. Nothing was changed." };
      }
      const videos = resolved.media.filter((m) => m.kind === "video");
      if (videos.length > 0) {
        return { error: "A clip can't be a reference photo for a shot — pick an image instead. Nothing was changed." };
      }
      referenceGenerationIds = resolved.media.map((m) => m.generationId);
    }
    // 与 editShotPrompt 同一笔带卡锁的事务:换掉挂图会删掉已付费的视频子卡指针(陈旧级联),
    // 所以判定与删指针必须在同一笔事务里(#782 r15 的那一条,逐字同法)。
    let out: Ok | Err = { error: "Card not found." };
    await prisma.$transaction(async (tx) => {
      await lockCardTx(tx, card.id);
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null, thread: { deletedAt: null, ownerId } },
        select: { payload: true },
      });
      if (!fresh?.payload) { out = { error: "Card not found." }; return; }
      const cur = fresh.payload as unknown as StoryboardCardPayload;
      if (index >= cur.shots.length) { out = { error: "That shot no longer exists." }; return; }
      const blocked = await inFlightPointerBlock(tx, ownerId, cur.shots[index]!, { referenceGenerationIds });
      if (blocked) { out = { error: blocked }; return; }
      // FSE-208 —— 「带不上参考图的镜头连挂都不许挂上去」这道闸(`referenceRideBlock`)随
      // 闸①整段报废一并删除:任何镜头现在都带得上参考图(`attachShotLibraryImages` 在
      // storyboard-gate1-actions.ts 无条件调用),没有「这一镜带不上」这一档可拒绝。
      const next = applyEditShotPrompt(cur, index, { referenceGenerationIds });
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
  videoPrompt: z.string().trim().min(1).max(2000),
});

export async function addShot(raw: unknown): Promise<Ok | Err> {
  const parsed = addInput.safeParse(raw);
  if (!parsed.success) return { error: "That shot isn't valid." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<Ok | Err> => {
    const { cardId, title, videoPrompt } = parsed.data;
    const card = await loadCard(cardId, gate.ownerId);
    if (!card) return { error: "Card not found." };
    const cur = (card.payload ?? {}) as StoryboardCardPayload;
    if (cur.shots.length >= MAX_STORYBOARD_SHOTS) return { error: `A storyboard can have at most ${MAX_STORYBOARD_SHOTS} shots.` };
    // shotId 在 ACTION 层铸造(纯 edit 层保持确定性)——F4 付费写回按它定位镜头。
    return persist(cardId, applyAddShot(cur, { shotId: newId(), title, videoPrompt }));
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

// PR #1417 判官 P1-C —— `setStoryboardContinuity`(人工那一面的 #782 接续开关)整段报废
// 删除:开关承诺的接续传帧(#782 闸③)在 FSE-208 之后数学上不可达(见
// `storyboard-gate1-actions.ts`),开关只会说谎(承诺「你只要做第一帧」而首帧概念已退场)。
// Otto 侧的同名 op(`editStoryboard op=setContinuity`)同 PR 一并删除
// (`packages/otto/src/skills/edit-storyboard.ts`),两面不留一面还在骗商家。

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
