"use server";
/**
 * storyboard-gate1-actions — 闸① 的 $0 铸卡层。
 *
 * 为 STORYBOARD_CARD 的每个"缺首帧图"镜头铸一张子 GEN_CARD(定价走 buildProposeCard,
 * 与普通 propose 同一条路),并把子卡 id 登记回父卡的 shot.firstFrameCardId。
 *
 * 花钱不在这里:铸子卡 = $0(ChatMessage,genJobId 不写=null,不建 GenJob,不 reserve/settle)。
 * 用户确认后由客户端逐子卡调现有 coworkGenerate(childCardId)——每子卡自有
 * `cowork:<childCardId>` 的 once-EVER 幂等 key,钱路一行不改。禁止复合 key(spec §7)。
 *
 * spent 侦测是纯只读:查子卡是否已有 `cowork:<childCardId>` 的 GenJob(镜像 coworkGenerate
 * 自己的 re-spend guard 读法,cowork-actions.ts:523-527)——读,绝不写。
 *
 * 全部 owner-scoped:身份来自 requireOwner 的 session,绝不来自客户端输入。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { newId, storageKey, storageKeyToSrc } from "@fikirtive/core";
import { buildProposeCard } from "@fikirtive/otto";
import type { OttoContext, StoryboardCardPayload } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";

export type ChildFrameCard = {
  shotId: string;
  childCardId: string;
  estimatedCredits: number;
  structuredPrompt: string;
  entityIds: string[];
  /** 子卡是否已"花过钱":已有 genJobId,或已存在其 cowork:<id> 幂等 job。UI 据此跳过已扣费的。 */
  spent: boolean;
};

type Err = { error: string };
type Shot = StoryboardCardPayload["shots"][number];
type PrismaTx = Prisma.TransactionClient;

const prepareInput = z.object({ cardId: z.string().min(1) });
const regenInput = z.object({ cardId: z.string().min(1), shotId: z.string().min(1) });
const syncInput = z.object({ cardId: z.string().min(1) });

/** owner-scoped 载入一张 STORYBOARD_CARD(复制 F3 storyboard-actions.ts 的模式;不跨文件导出)。
 *  身份来自 session;thread.ownerId/deletedAt 复核防越权。 */
async function loadCard(cardId: string, ownerId: string) {
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, thread: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return null;
  return card;
}

/** 该 owner 拥有的 entity id(对齐 buildOttoContext / propose-pack 的取法)。空输入不查库。 */
async function ownedEntityIdsFor(ownerId: string, entityIds: string[]): Promise<string[]> {
  if (entityIds.length === 0) return [];
  const owned = await prisma.entity.findMany({
    where: { id: { in: entityIds }, ownerId, deletedAt: null },
    select: { id: true },
  });
  return owned.map((e) => e.id);
}

/** buildProposeCard 需要的最小 OttoContext(它只读 orgId/threadId/disabledModels 及两个 source 字段)。
 *  source/referenceVideo 留 undefined —— 子卡是纯 image 计划,不带起始帧/参考视频。 */
function minimalCtx(ownerId: string, threadId: string, disabledModels: string[]): OttoContext {
  return {
    orgId: ownerId,
    userId: ownerId,
    projectId: "",
    threadId,
    disabledModels,
    sourceGenerationId: undefined,
    referenceVideoGenerationId: undefined,
  };
}

/** 只读:子卡是否已存在其 cowork:<childCardId> 幂等 job(镜像 coworkGenerate 的 guard 读,绝不写)。 */
async function spentOf(childCardId: string, ownerId: string): Promise<boolean> {
  const job = await prisma.genJob.findFirst({
    where: { ownerId, idempotencyKey: `cowork:${childCardId}` },
    select: { id: true },
  });
  return job !== null;
}

/** 铸一张子 GEN_CARD($0):定价走 buildProposeCard,payload 加 storyboardCardId+shotId 回链。
 *  seq = 同 thread 最新 +1(propose-pack.ts:46-108 先例)。genJobId 不写(null)。
 *  返回新子卡 id 及其 ChildFrameCard(spent 固定 false —— 刚铸,尚无幂等 job)。 */
async function mintChild(
  tx: PrismaTx,
  parent: { id: string; threadId: string },
  shot: Shot,
  ownerId: string,
  ctx: OttoContext,
  ownedIds: string[],
): Promise<ChildFrameCard> {
  const { cardPayload } = buildProposeCard(
    {
      kind: "image",
      structuredPrompt: shot.firstFramePrompt,
      entityIds: shot.entityIds ?? [],
      variantSel: {},
      count: 1,
    },
    ctx,
    ownedIds,
  );

  const payload = { ...cardPayload, storyboardCardId: parent.id, shotId: shot.shotId };

  const last = await tx.chatMessage.findFirst({
    where: { threadId: parent.threadId, ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  const childCardId = newId();
  await tx.chatMessage.create({
    data: {
      id: childCardId,
      threadId: parent.threadId,
      ownerId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload: payload as unknown as Prisma.InputJsonObject,
    },
  });

  return {
    shotId: shot.shotId,
    childCardId,
    estimatedCredits: cardPayload.estimatedCredits,
    structuredPrompt: cardPayload.structuredPrompt,
    entityIds: cardPayload.entityIds,
    spent: false,
  };
}

// ---------------------------------------------------------------------------
// prepareStoryboardFirstFrames — idempotent $0 mint of missing first-frame children
// ---------------------------------------------------------------------------

export async function prepareStoryboardFirstFrames(
  raw: unknown,
): Promise<{ children: ChildFrameCard[]; totalCredits: number } | Err> {
  const parsed = prepareInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };

  const cur = (card.payload ?? {}) as StoryboardCardPayload;

  // Source disabledModels + owned entities ONCE (same sourcing as buildOttoContext).
  const disabledModels = Array.from(await resolveDisabledModels());
  const allEntityIds = [...new Set(cur.shots.flatMap((s) => s.entityIds ?? []))];
  const ownedIds = await ownedEntityIdsFor(ownerId, allEntityIds);
  const ctx = minimalCtx(ownerId, card.threadId, disabledModels);

  const children: ChildFrameCard[] = [];

  await prisma.$transaction(async (tx) => {
    // Re-read the parent payload INSIDE the tx (RMW) so a concurrent edit can't be clobbered.
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    const payload = (fresh?.payload ?? cur) as StoryboardCardPayload;

    // Build the next shots array, mutating ONLY firstFrameCardId on target shots.
    const nextShots: Shot[] = [];
    let changed = false;

    for (const shot of payload.shots) {
      // Has an image already → skip entirely (no mint, no change).
      if (shot.firstFrameGenerationId) {
        nextShots.push(shot);
        continue;
      }

      // Already points at a child → try to reuse it.
      if (shot.firstFrameCardId) {
        const existing = await tx.chatMessage.findFirst({
          where: { id: shot.firstFrameCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
          select: { id: true, payload: true, genJobId: true },
        });
        const existingPrompt =
          existing && ((existing.payload ?? {}) as { structuredPrompt?: unknown }).structuredPrompt;
        if (existing && existingPrompt === shot.firstFramePrompt) {
          // Fresh → REUSE, do not mint. Compute spent (genJobId OR idempotency job).
          const spent = existing.genJobId != null || (await spentOf(existing.id, ownerId));
          const p = (existing.payload ?? {}) as { structuredPrompt?: string; entityIds?: string[]; estimatedCredits?: number };
          children.push({
            shotId: shot.shotId,
            childCardId: existing.id,
            estimatedCredits: typeof p.estimatedCredits === "number" ? p.estimatedCredits : 0,
            structuredPrompt: typeof p.structuredPrompt === "string" ? p.structuredPrompt : shot.firstFramePrompt,
            entityIds: Array.isArray(p.entityIds) ? p.entityIds : (shot.entityIds ?? []),
            spent,
          });
          nextShots.push(shot);
          continue;
        }
        // Missing or stale (defensive) → mint a replacement.
      }

      // Mint a fresh child for this shot.
      const shotOwnedIds = ownedIds.filter((id) => (shot.entityIds ?? []).includes(id));
      const child = await mintChild(tx, card, shot, ownerId, ctx, shotOwnedIds);
      children.push(child);
      nextShots.push({ ...shot, firstFrameCardId: child.childCardId });
      changed = true;
    }

    if (changed) {
      await tx.chatMessage.update({
        where: { id: card.id },
        data: { payload: { ...payload, shots: nextShots } as unknown as Prisma.InputJsonObject },
      });
    }
  });

  const totalCredits = children.filter((c) => !c.spent).reduce((sum, c) => sum + c.estimatedCredits, 0);
  return { children, totalCredits };
}

// ---------------------------------------------------------------------------
// regenShotFirstFrameCard — mint a FRESH replacement child for one shot ($0)
// ---------------------------------------------------------------------------

export async function regenShotFirstFrameCard(
  raw: unknown,
): Promise<{ child: ChildFrameCard } | Err> {
  const parsed = regenInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };

  const cur = (card.payload ?? {}) as StoryboardCardPayload;
  if (!cur.shots.some((s) => s.shotId === parsed.data.shotId)) {
    return { error: "That shot no longer exists." };
  }

  const disabledModels = Array.from(await resolveDisabledModels());
  const ctx = minimalCtx(ownerId, card.threadId, disabledModels);

  let child: ChildFrameCard | null = null;

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    const payload = (fresh?.payload ?? cur) as StoryboardCardPayload;

    const target = payload.shots.find((s) => s.shotId === parsed.data.shotId);
    if (!target) return; // vanished mid-flight → no writes; caller returns error below.

    const ownedAll = await ownedEntityIdsFor(ownerId, target.entityIds ?? []);
    child = await mintChild(tx, card, target, ownerId, ctx, ownedAll);
    const newChildId = child.childCardId;

    const nextShots = payload.shots.map((s) => {
      if (s.shotId !== parsed.data.shotId) return s;
      // Replace firstFrameCardId; DROP firstFrameGenerationId (old image invalidated) by key-omission.
      const { firstFrameGenerationId: _drop, ...rest } = s;
      return { ...rest, firstFrameCardId: newChildId };
    });

    await tx.chatMessage.update({
      where: { id: card.id },
      data: { payload: { ...payload, shots: nextShots } as unknown as Prisma.InputJsonObject },
    });
  });

  if (!child) return { error: "That shot no longer exists." };
  return { child };
}

// ---------------------------------------------------------------------------
// syncStoryboardFirstFrames — $0 reconcile: write finished gen ids back by shotId
// ---------------------------------------------------------------------------

/** Read-only: the child card's finished GenJob, if any. Prefer the best-effort
 *  `genJobId` link coworkGenerate stamped (cowork-actions.ts:614); fall back to the
 *  durable `cowork:<childId>` idempotency key (mirrors spentOf's read). Never writes. */
async function doneJobFor(childCardId: string, ownerId: string): Promise<{ id: string } | null> {
  const child = await prisma.chatMessage.findFirst({
    where: { id: childCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
    select: { genJobId: true },
  });
  const job = child?.genJobId
    ? await prisma.genJob.findFirst({ where: { id: child.genJobId, ownerId }, select: { id: true, status: true } })
    : await prisma.genJob.findFirst({
        where: { ownerId, idempotencyKey: `cowork:${childCardId}` },
        select: { id: true, status: true },
      });
  if (!job || job.status !== "DONE") return null; // missing/queued/generating/failed → leave the shot alone
  return { id: job.id };
}

/** Read-only: the first Generation id this DONE job produced, via its durable GEN_RESULT
 *  message (owner-scoped). Returns null if the result isn't written yet or is malformed. */
async function firstGenerationIdOf(genJobId: string, ownerId: string): Promise<string | null> {
  const result = await prisma.chatMessage.findFirst({
    where: { genJobId, ownerId, kind: "GEN_RESULT", deletedAt: null },
    select: { payload: true },
  });
  const ids = (result?.payload as { generationIds?: unknown } | null)?.generationIds;
  const first = Array.isArray(ids) ? ids[0] : undefined;
  return typeof first === "string" && first.length > 0 ? first : null;
}

/** Owner-scoped Generation id → thumbnail URL (mirrors data.ts getGenerationThumbs:
 *  Generation → asset → storageKey → src). A generation whose row is gone is omitted. */
async function resolveFrameUrls(ownerId: string, generationIds: string[]): Promise<Record<string, string>> {
  const clean = [...new Set(generationIds.filter(Boolean))];
  if (clean.length === 0) return {};
  const gens = await prisma.generation.findMany({
    where: { id: { in: clean }, ownerId, deletedAt: null },
    include: { asset: true },
  });
  const byGenId: Record<string, string> = {};
  for (const g of gens) {
    byGenId[g.id] = storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext.toLowerCase()));
  }
  return byGenId;
}

export async function syncStoryboardFirstFrames(
  raw: unknown,
): Promise<{ payload: StoryboardCardPayload; frames: Record<string, string> } | Err> {
  const parsed = syncInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };

  const cur = (card.payload ?? {}) as StoryboardCardPayload;

  // Collect finished writes OUTSIDE the txn (all reads): pending shot = has a child but no image yet.
  const writes: Record<string, string> = {}; // shotId → generationId
  for (const shot of cur.shots) {
    if (!shot.firstFrameCardId || shot.firstFrameGenerationId) continue;
    const job = await doneJobFor(shot.firstFrameCardId, ownerId);
    if (!job) continue;
    const genId = await firstGenerationIdOf(job.id, ownerId);
    if (genId) writes[shot.shotId] = genId;
  }

  // Apply staged writes in ONE transactional RMW (re-read payload, patch only target shots).
  let payload = cur;
  if (Object.keys(writes).length > 0) {
    payload = await prisma.$transaction(async (tx) => {
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
        select: { payload: true },
      });
      const p = (fresh?.payload ?? cur) as StoryboardCardPayload;
      const nextShots = p.shots.map((s) =>
        writes[s.shotId] ? { ...s, firstFrameGenerationId: writes[s.shotId] } : s,
      );
      const next = { ...p, shots: nextShots };
      await tx.chatMessage.update({
        where: { id: card.id },
        data: { payload: next as unknown as Prisma.InputJsonObject },
      });
      return next;
    });
  }

  // frames: resolve a URL for EVERY shot that now has a firstFrameGenerationId (old or just written).
  const genIdByShot = new Map<string, string>();
  for (const shot of payload.shots) {
    if (shot.firstFrameGenerationId) genIdByShot.set(shot.shotId, shot.firstFrameGenerationId);
  }
  const urlByGenId = await resolveFrameUrls(ownerId, [...genIdByShot.values()]);
  const frames: Record<string, string> = {};
  for (const [shotId, genId] of genIdByShot) {
    const url = urlByGenId[genId];
    if (url) frames[shotId] = url; // a deleted generation → omit, don't error
  }

  return { payload, frames };
}
