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
 *
 * 并发防线(修复轮 v2, NODE-282①):本文件全部五个 RMW 事务(两个 prepare / 两个 regen /
 * sync)在事务内第一步先取卡级 pg_advisory_xact_lock(cowork-actions.ts:180 与
 * gen-actions.ts:118 的同款家法),同一张父卡的写者严格串行 —— 两个并发 prepare 不可能
 * 都看到空指针而各铸一张可扣费子卡;后到者锁后重读到新指针,走复用分支,零双铸。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { newId, storageKey, storageKeyToSrc, suggestModel, GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "@fikirtive/core";
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

/** MONEY-CRITICAL serialization (修复轮 v2, NODE-282①): take the card-scoped pg advisory
 *  transaction lock BEFORE the RMW re-read — the SAME house pattern the money path already
 *  uses (cowork-actions.ts:180, gen-actions.ts:118). Under READ COMMITTED, two concurrent
 *  prepares could BOTH read a shot's empty child pointer and EACH mint a chargeable child
 *  (double-mint → each can be confirmed downstream → double-charge). With the lock, writers
 *  on the SAME card serialize: the later transaction blocks until the earlier one commits,
 *  its in-tx re-read then sees the freshly written pointer, and it takes the REUSE branch —
 *  zero double-mint. xact-scoped (auto-released at commit/rollback); every tx takes exactly
 *  ONE lock before any write → no deadlock surface; zero schema change. */
async function lockCardTx(tx: PrismaTx, cardId: string): Promise<void> {
  const cardLockKey = `card:${cardId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cardLockKey}, 0::bigint))`;
}

/** The stored fields of an existing video child card, shaped for the reuse comparison. */
type ExistingVideoChild = {
  structuredPrompt?: unknown;
  sourceGenerationId?: unknown;
  model?: unknown;
  params?: { durationSeconds?: unknown };
  entityIds?: string[];
  estimatedCredits?: number;
};

/** MONEY-CRITICAL reuse rule (SINGLE SOURCE for prepare AND regen): an existing video child
 *  matches the would-be-minted card iff ALL of structuredPrompt + sourceGenerationId +
 *  params.durationSeconds (snapped-vs-snapped) + model agree. A full match means a fresh mint
 *  would produce an identical spend, so reusing the child is exact. `wouldBe` is the pure
 *  buildProposeCard output minting uses (its durationSeconds is the SNAPPED value), so the
 *  comparison never touches the raw shot field (P2: no snap-mismatch churn). */
function videoChildMatches(
  existing: ExistingVideoChild,
  wouldBe: { structuredPrompt: string; sourceGenerationId?: string; model: string; params: { durationSeconds?: number } },
): boolean {
  return (
    existing.structuredPrompt === wouldBe.structuredPrompt &&
    existing.sourceGenerationId === wouldBe.sourceGenerationId &&
    existing.params?.durationSeconds === wouldBe.params?.durationSeconds &&
    existing.model === wouldBe.model
  );
}

/** 闸② 铸卡会选定的视频模型 —— 与 buildProposeCard 内部同一条 selectModel 路径
 *  (suggestModel({ kind:"video", disabled }) → activeVideoModel)。这里复用它,保证
 *  "选项面板给的时长" 与 "铸卡吸附的时长" 出自同一模型,零硬编码。 */
function selectedVideoModel(disabledModels: string[]): GenVideoModel {
  const sm = suggestModel({ kind: "video", disabled: new Set(disabledModels) });
  return sm.model as GenVideoModel;
}

// ---------------------------------------------------------------------------
// getStoryboardVideoOptions — $0 read: the SELECTED video model + its durations
// ---------------------------------------------------------------------------
//
// Model-driven, zero hardcoding: derive the video model the SAME way minting will
// (suggestModel — the activeVideoModel lock), then return THAT model's durations from
// the shared GEN_VIDEO_MODEL_OPTIONS capability table. A future model swap (activeVideoModel
// change) flows through automatically — no values copied here.

export async function getStoryboardVideoOptions(): Promise<
  { model: string; durations: number[] } | Err
> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const disabledModels = Array.from(await resolveDisabledModels());
  const model = selectedVideoModel(disabledModels);
  const durations = GEN_VIDEO_MODEL_OPTIONS[model].durations;
  return { model, durations };
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

/** 铸一张"视频子 GEN_CARD"($0):镜像 mintChild,但走 kind:"video" —— 定价/模型/时长吸附
 *  全交给 buildProposeCard(与普通 i2v propose 同一条路)。ctx 带 per-shot sourceGenerationId
 *  = 该镜头首帧 generationId(i2v 起始帧);desiredDuration = shot.durationSeconds。
 *  payload 加 storyboardCardId+shotId 回链;genJobId 不写(null)。 */
async function mintVideoChild(
  tx: PrismaTx,
  parent: { id: string; threadId: string },
  shot: Shot,
  ownerId: string,
  ctx: OttoContext,
): Promise<ChildFrameCard> {
  const { cardPayload } = buildProposeCard(
    {
      kind: "video",
      structuredPrompt: shot.videoPrompt,
      entityIds: [],
      variantSel: {},
      count: 1,
      desiredDuration: shot.durationSeconds,
    },
    ctx,
    [],
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
  let cardVanished = false; // R3①: set when the in-lock re-read finds the card gone

  await prisma.$transaction(async (tx) => {
    await lockCardTx(tx, card.id); // NODE-282①: serialize concurrent prepares/regens on this card
    // Re-read the parent payload INSIDE the tx (RMW) so a concurrent edit can't be clobbered.
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    // R3① fail-closed: the card vanished (deleted / kind changed / payload gone) between
    // the outer load and the lock → ZERO writes, and NO fallback to the pre-lock `cur`
    // snapshot — a stale snapshot must never drive writes. Caller surfaces "Card not found.".
    if (!fresh?.payload) {
      cardVanished = true;
      return;
    }
    const payload = fresh.payload as unknown as StoryboardCardPayload;

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

  if (cardVanished) return { error: "Card not found." }; // R3① fail-closed surface
  const totalCredits = children.filter((c) => !c.spent).reduce((sum, c) => sum + c.estimatedCredits, 0);
  return { children, totalCredits };
}

// ---------------------------------------------------------------------------
// regenShotFirstFrameCard — stage a replacement first-frame child for one shot ($0)
// ---------------------------------------------------------------------------
//
// New semantics (Fable): the OLD frame stays valid until the NEW one actually
// lands. This action ONLY swaps `firstFrameCardId` to the replacement child and
// NEVER touches `firstFrameGenerationId` — the old image survives until sync
// overwrites the genId when the new frame is DONE. Cancel (client-side) is a true
// no-op. Reuse-if-fresh (same rule as prepare) prevents $0 orphan accumulation
// from repeated open/cancel.

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
  let cardVanished = false; // R3①: set when the in-lock re-read finds the card gone

  await prisma.$transaction(async (tx) => {
    await lockCardTx(tx, card.id); // NODE-282①: serialize concurrent prepares/regens on this card
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    // R3① fail-closed: the card vanished (deleted / kind changed / payload gone) between
    // the outer load and the lock → ZERO writes, and NO fallback to the pre-lock `cur`
    // snapshot — a stale snapshot must never drive writes. Caller surfaces "Card not found.".
    if (!fresh?.payload) {
      cardVanished = true;
      return;
    }
    const payload = fresh.payload as unknown as StoryboardCardPayload;

    const target = payload.shots.find((s) => s.shotId === parsed.data.shotId);
    if (!target) return; // vanished mid-flight → no writes; caller returns error below.

    // Reuse-if-fresh: an existing child that still matches the CURRENT prompt AND is
    // unspent → reuse it, do NOT mint (repeated open/cancel would otherwise orphan $0
    // cards). A spent or stale (prompt-drifted / missing) child → mint fresh.
    if (target.firstFrameCardId) {
      const existing = await tx.chatMessage.findFirst({
        where: { id: target.firstFrameCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
        select: { id: true, payload: true, genJobId: true },
      });
      const existingPrompt =
        existing && ((existing.payload ?? {}) as { structuredPrompt?: unknown }).structuredPrompt;
      if (existing && existingPrompt === target.firstFramePrompt) {
        const spent = existing.genJobId != null || (await spentOf(existing.id, ownerId));
        if (!spent) {
          const p = (existing.payload ?? {}) as {
            structuredPrompt?: string;
            entityIds?: string[];
            estimatedCredits?: number;
          };
          child = {
            shotId: target.shotId,
            childCardId: existing.id,
            estimatedCredits: typeof p.estimatedCredits === "number" ? p.estimatedCredits : 0,
            structuredPrompt:
              typeof p.structuredPrompt === "string" ? p.structuredPrompt : target.firstFramePrompt,
            entityIds: Array.isArray(p.entityIds) ? p.entityIds : (target.entityIds ?? []),
            spent: false,
          };
          // Child already registered on the shot; nothing to write. No genId touch.
          return;
        }
        // spent → fall through to mint a fresh replacement.
      }
      // missing / stale prompt → fall through to mint.
    }

    const ownedAll = await ownedEntityIdsFor(ownerId, target.entityIds ?? []);
    child = await mintChild(tx, card, target, ownerId, ctx, ownedAll);
    const newChildId = child.childCardId;

    const nextShots = payload.shots.map((s) => {
      if (s.shotId !== parsed.data.shotId) return s;
      // Replace firstFrameCardId ONLY. NEVER touch firstFrameGenerationId — the old
      // image stays valid until sync overwrites the genId when the new frame lands.
      return { ...s, firstFrameCardId: newChildId };
    });

    await tx.chatMessage.update({
      where: { id: card.id },
      data: { payload: { ...payload, shots: nextShots } as unknown as Prisma.InputJsonObject },
    });
  });

  if (cardVanished) return { error: "Card not found." }; // R3① fail-closed surface
  if (!child) return { error: "That shot no longer exists." };
  return { child };
}

// ---------------------------------------------------------------------------
// syncStoryboardMedia — $0 reconcile: write finished gen ids back by shotId
// (frames AND videos), apply the frame-replace cascade, return frame + video urls
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

/** Owner-scoped Generation id → media URL (mirrors data.ts getGenerationThumbs /
 *  getGenerationMedia: Generation → asset → storageKey → src). Media-type-agnostic:
 *  the URL is derived from the asset's OWN ext (png/mp4/mov/webm/…), so the exact
 *  same helper resolves both frame (image) and video generations — a video asset's
 *  ext yields its video URL with zero image bias. A generation whose row is gone is
 *  omitted (not an error). */
async function resolveMediaUrls(ownerId: string, generationIds: string[]): Promise<Record<string, string>> {
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

export async function syncStoryboardMedia(
  raw: unknown,
): Promise<
  { payload: StoryboardCardPayload; frames: Record<string, string>; videos: Record<string, string> } | Err
> {
  const parsed = syncInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };

  // 修复轮 v3 (NODE-282-R2①): the ENTIRE read half — candidate sampling + write-set
  // derivation — runs INSIDE the card lock, derived from the freshly re-read payload.
  // v2 sampled against the pre-lock `cur` snapshot and only applied the (stale) write-set
  // after locking, so a racing regen could swap a shot's pointer A→B between sample and
  // apply — sync would then write A's generation onto (or cascade-drop) a shot that now
  // points at B. Post-lock derivation makes that impossible: sync only ever acts on the
  // children the FRESH pointers reference. A no-op sync stages nothing and writes nothing.
  // fresh 为 null（卡在锁前被删/变更）即 fail-closed 零写返回 "Card not found."，无 cur 回落（R3①）。
  const payload = await prisma.$transaction(async (tx) => {
    // Same card-writer serialization: a sync (frame-replace CASCADE drops video keys)
    // racing a prepare/regen RMW could clobber a just-written — possibly already
    // CONFIRMED — child pointer, orphaning a charged card; the next prepare would then
    // mint (and charge) AGAIN for the same shot. Locking makes race == serial semantics.
    await lockCardTx(tx, card.id);
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    // R3① fail-closed: the card vanished (deleted / kind changed / payload gone) between
    // the outer load and the lock → return the null sentinel (ZERO writes); NO fallback to
    // the pre-lock `cur` snapshot. The caller surfaces "Card not found.".
    if (!fresh?.payload) return null;
    const p = fresh.payload as unknown as StoryboardCardPayload;

    // Collect finished writes from the FRESH (post-lock) payload. Candidate rules are
    // identical in shape for the two media classes (≤8 shots, so the per-shot lookups are
    // bounded; child/job/result reads are worker-written rows — a job flipping DONE
    // mid-sync is simply picked up by the next sync, inert here):
    //  • FRAME: a shot with a firstFrameCardId. Resolve its child's DONE generationId; stage a
    //    frame write iff that id exists AND DIFFERS from the shot's current firstFrameGenerationId.
    //    Covers first landing (no genId yet → write) and replace-overwrite (a regen's new frame
    //    lands → overwrites the old genId).
    //  • VIDEO: a shot with a videoCardId. Resolve its child's DONE generationId; stage a video
    //    write iff that id exists AND DIFFERS from the shot's current videoGenerationId.
    // FAILED/queued/generating/missing children resolve to null → inert (no write). A write only
    // ever REPLACES the genId value; it never deletes the key.
    const frameWrites: Record<string, string> = {}; // shotId → new firstFrameGenerationId
    const videoWrites: Record<string, string> = {}; // shotId → new videoGenerationId
    // CASCADE set (spec §3c): shots whose staged frame write REPLACES an existing DIFFERENT
    // firstFrameGenerationId (the shot HAD a genId and the new one differs — NOT a first-ever
    // write). The source frame changed, so the old video no longer represents the shot → its
    // videoCardId + videoGenerationId are dropped (key-omission) in the same transaction. A
    // first-ever frame write (no prior genId) does NOT cascade.
    const cascadeShots = new Set<string>();
    for (const shot of p.shots) {
      if (shot.firstFrameCardId) {
        const job = await doneJobFor(shot.firstFrameCardId, ownerId);
        if (job) {
          const genId = await firstGenerationIdOf(job.id, ownerId);
          if (genId && genId !== shot.firstFrameGenerationId) {
            frameWrites[shot.shotId] = genId;
            // Cascade only when REPLACING a prior genId — never on the first-ever frame write.
            if (shot.firstFrameGenerationId) cascadeShots.add(shot.shotId);
          }
        }
      }
      if (shot.videoCardId) {
        const job = await doneJobFor(shot.videoCardId, ownerId);
        if (job) {
          const genId = await firstGenerationIdOf(job.id, ownerId);
          if (genId && genId !== shot.videoGenerationId) videoWrites[shot.shotId] = genId;
        }
      }
    }

    // Nothing staged → pure read: return the fresh payload, no DB write.
    const hasStaged =
      Object.keys(frameWrites).length > 0 ||
      Object.keys(videoWrites).length > 0 ||
      cascadeShots.size > 0;
    if (!hasStaged) return p;

    const nextShots = p.shots.map((s) => {
      const frameGen = frameWrites[s.shotId];
      const videoGen = videoWrites[s.shotId];
      if (!frameGen && !videoGen) return s;
      // CASCADE PRECEDENCE (spec §3c): when a shot's frame is REPLACED, drop its video keys —
      // and this WINS over any video write staged for the SAME shot in this pass. A video that
      // just landed for the OLD source frame is dropped too: it was built off the outdated
      // frame, so it no longer represents the shot. So: cascade ⇒ omit videoCardId +
      // videoGenerationId (key-omission), and do NOT apply the staged video write.
      if (cascadeShots.has(s.shotId)) {
        const rest = { ...s };
        delete rest.videoCardId;
        delete rest.videoGenerationId;
        return { ...rest, firstFrameGenerationId: frameGen! };
      }
      const next = { ...s };
      if (frameGen) next.firstFrameGenerationId = frameGen;
      if (videoGen) next.videoGenerationId = videoGen;
      return next;
    });
    const next = { ...p, shots: nextShots };
    await tx.chatMessage.update({
      where: { id: card.id },
      data: { payload: next as unknown as Prisma.InputJsonObject },
    });
    return next;
  });

  if (payload === null) return { error: "Card not found." }; // R3① fail-closed surface

  // Resolve URLs for EVERY shot that now has a genId (old or just written), for both media
  // classes, via the SAME owner-scoped Generation→asset→storage mechanism. Cascade-dropped
  // video keys are already gone from `payload`, so they naturally contribute no video url.
  const frameGenByShot = new Map<string, string>();
  const videoGenByShot = new Map<string, string>();
  for (const shot of payload.shots) {
    if (shot.firstFrameGenerationId) frameGenByShot.set(shot.shotId, shot.firstFrameGenerationId);
    if (shot.videoGenerationId) videoGenByShot.set(shot.shotId, shot.videoGenerationId);
  }
  const urlByGenId = await resolveMediaUrls(ownerId, [
    ...frameGenByShot.values(),
    ...videoGenByShot.values(),
  ]);
  const frames: Record<string, string> = {};
  for (const [shotId, genId] of frameGenByShot) {
    const url = urlByGenId[genId];
    if (url) frames[shotId] = url; // a deleted generation → omit, don't error
  }
  const videos: Record<string, string> = {};
  for (const [shotId, genId] of videoGenByShot) {
    const url = urlByGenId[genId];
    if (url) videos[shotId] = url; // a deleted generation → omit, don't error
  }

  return { payload, frames, videos };
}

// ---------------------------------------------------------------------------
// prepareStoryboardVideos — 闸②:idempotent $0 mint of missing video children
// ---------------------------------------------------------------------------
//
// Mirrors prepareStoryboardFirstFrames exactly (owner-scoping, $transaction RMW,
// reuse-if-fresh, seq allocation, ChildFrameCard shape, totalCredits = unspent only),
// with the video-gate differences:
//  • Eligible = firstFrameGenerationId && !videoGenerationId (partial execution:
//    frameless shots are silently skipped — the UI hints why).
//  • Mint via buildProposeCard kind:"video" with a PER-SHOT ctx whose sourceGenerationId
//    = the shot's first frame (i2v source), and desiredDuration = shot.durationSeconds.
//  • Parent write swaps ONLY shot.videoCardId (transactional RMW).
//  • Reuse-if-matches (MONEY-CRITICAL): compute the WOULD-BE-MINTED card via the same pure
//    buildProposeCard call minting uses, then REUSE the existing videoCardId child REGARDLESS
//    of spent iff it matches on structuredPrompt + sourceGenerationId + params.durationSeconds
//    (snapped-vs-snapped) + model. Matching+spent → surfaced with spent:true (excluded from
//    totalCredits, UI skips), NO mint / NO pointer swap / NO parent write for that shot — so
//    aggregate-prepare is idempotent under double-click / mid-flight re-entry (a video is SPENT
//    but pending for minutes before videoGenerationId lands; the old spent→mint arm double-paid
//    the same shot). Fresh mint + pointer swap ONLY when there is no child or the match fails
//    (genuinely stale inputs); videoGenerationId is NEVER touched (I1 semantics — old video
//    survives until the new one lands via sync).

export async function prepareStoryboardVideos(
  raw: unknown,
): Promise<{ children: ChildFrameCard[]; totalCredits: number } | Err> {
  const parsed = prepareInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };

  // Source disabledModels ONCE (same sourcing as buildOttoContext). Video children are
  // i2v (no entity refs), so no owned-entity lookup is needed.
  const disabledModels = Array.from(await resolveDisabledModels());

  const children: ChildFrameCard[] = [];
  let cardVanished = false; // R3①: set when the in-lock re-read finds the card gone

  await prisma.$transaction(async (tx) => {
    await lockCardTx(tx, card.id); // NODE-282①: serialize concurrent prepares/regens on this card
    // Re-read the parent payload INSIDE the tx (RMW) so a concurrent edit can't be clobbered.
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    // R3① fail-closed: the card vanished (deleted / kind changed / payload gone) between
    // the outer load and the lock → ZERO writes, and NO fallback to the pre-lock `cur`
    // snapshot — a stale snapshot must never drive writes. Caller surfaces "Card not found.".
    if (!fresh?.payload) {
      cardVanished = true;
      return;
    }
    const payload = fresh.payload as unknown as StoryboardCardPayload;

    // Build the next shots array, mutating ONLY videoCardId on target shots.
    const nextShots: Shot[] = [];
    let changed = false;

    for (const shot of payload.shots) {
      // Not eligible: no first frame (frameless — skip silently), or already has a video.
      if (!shot.firstFrameGenerationId || shot.videoGenerationId) {
        nextShots.push(shot);
        continue;
      }

      // Per-shot ctx: the shot's first frame is the i2v source for THIS video.
      const ctx = minimalCtx(ownerId, card.threadId, disabledModels);
      ctx.sourceGenerationId = shot.firstFrameGenerationId;

      // The WOULD-BE-MINTED card for THIS shot — computed via the SAME pure buildProposeCard
      // call minting uses (mintVideoChild). This is the single source of truth for the reuse
      // comparison: we compare an existing child against what a fresh mint would produce, NOT
      // against the raw shot fields. Crucially, wouldBe.params.durationSeconds is the SNAPPED
      // value (suggestModel snaps shot.durationSeconds to the model's option list), so a child
      // minted at the snapped duration matches even when shot.durationSeconds is off-menu (P2:
      // no snap-mismatch churn). buildProposeCard is pure ($0) — this adds no I/O.
      const { cardPayload: wouldBe } = buildProposeCard(
        {
          kind: "video",
          structuredPrompt: shot.videoPrompt,
          entityIds: [],
          variantSel: {},
          count: 1,
          desiredDuration: shot.durationSeconds,
        },
        ctx,
        [],
      );

      // Already points at a video child → try to reuse it.
      if (shot.videoCardId) {
        const existing = await tx.chatMessage.findFirst({
          where: { id: shot.videoCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
          select: { id: true, payload: true, genJobId: true },
        });
        const ep = (existing?.payload ?? {}) as ExistingVideoChild;
        // Match the existing child against the would-be card on ALL of: structuredPrompt,
        // sourceGenerationId, params.durationSeconds (snapped-vs-snapped), and model (shared
        // videoChildMatches helper — same rule regen uses). A full match means a fresh mint
        // would produce an identical spend — so reusing it is exact.
        // MONEY CORRECTION (P1 kill-shot): reuse a fully-matching child REGARDLESS of spent.
        // Videos take minutes; videoGenerationId lands only when DONE, so a mid-flight re-entry
        // (double-click / re-open) sees a SPENT-but-pending child. The OLD code minted a fresh
        // child on spent → confirm charged it → the SAME shot got two children and two charges.
        // Now: matching+spent → surface it with spent:true (excluded from totalCredits, UI skips)
        // and DO NOT mint, DO NOT swap the pointer, DO NOT write the parent for this shot. This
        // makes aggregate-prepare idempotent under double-click / mid-flight re-entry. We mint a
        // fresh replacement ONLY when there is no child or the match fails (genuinely stale inputs).
        if (existing && videoChildMatches(ep, wouldBe)) {
          const spent = existing.genJobId != null || (await spentOf(existing.id, ownerId));
          children.push({
            shotId: shot.shotId,
            childCardId: existing.id,
            estimatedCredits: typeof ep.estimatedCredits === "number" ? ep.estimatedCredits : 0,
            structuredPrompt: typeof ep.structuredPrompt === "string" ? ep.structuredPrompt : shot.videoPrompt,
            entityIds: Array.isArray(ep.entityIds) ? ep.entityIds : [],
            spent,
          });
          nextShots.push(shot);
          continue;
        }
        // Missing or any mismatch (genuinely stale inputs) → mint a replacement (pointer swap below).
      }

      // Mint a fresh video child for this shot (no child, or a real mismatch).
      const child = await mintVideoChild(tx, card, shot, ownerId, ctx);
      children.push(child);
      // Replace videoCardId ONLY. NEVER touch videoGenerationId — the old video (if any)
      // stays valid until sync overwrites the genId when the new clip is DONE.
      nextShots.push({ ...shot, videoCardId: child.childCardId });
      changed = true;
    }

    if (changed) {
      await tx.chatMessage.update({
        where: { id: card.id },
        data: { payload: { ...payload, shots: nextShots } as unknown as Prisma.InputJsonObject },
      });
    }
  });

  if (cardVanished) return { error: "Card not found." }; // R3① fail-closed surface
  const totalCredits = children.filter((c) => !c.spent).reduce((sum, c) => sum + c.estimatedCredits, 0);
  return { children, totalCredits };
}

// ---------------------------------------------------------------------------
// regenShotVideoCard — stage a replacement video child for one shot ($0)
// ---------------------------------------------------------------------------
//
// The video analogue of regenShotFirstFrameCard, with I1 semantics: the OLD video
// stays valid until the NEW one actually lands. This action ONLY swaps `videoCardId`
// to the replacement child and NEVER touches `videoGenerationId` — the old video
// survives until sync overwrites the genId when the new clip is DONE. Cancel
// (client-side) is a true no-op.
//
// The target shot MUST already have a first frame (`firstFrameGenerationId`) — the
// i2v source; a frameless shot → {error}, no write. Mint via the SAME mintVideoChild
// path prepare uses (ctx.sourceGenerationId = the shot's current frame genId,
// desiredDuration = shot.durationSeconds). Reuse-if-fresh (shared videoChildMatches
// rule) reuses an UNSPENT matching child so repeated open/cancel can't orphan $0
// cards; a SPENT child → mint fresh (explicit user redo — gate① regen precedent).

export async function regenShotVideoCard(
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
  const target0 = cur.shots.find((s) => s.shotId === parsed.data.shotId);
  if (!target0) return { error: "That shot no longer exists." };
  // A video needs a source frame — refuse a frameless shot (no i2v source), no write.
  if (!target0.firstFrameGenerationId) {
    return { error: "This shot needs a first frame before you can make a video." };
  }

  const disabledModels = Array.from(await resolveDisabledModels());

  let child: ChildFrameCard | null = null;
  let cardVanished = false; // R3①: set when the in-lock re-read finds the card gone

  await prisma.$transaction(async (tx) => {
    await lockCardTx(tx, card.id); // NODE-282①: serialize concurrent prepares/regens on this card
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    // R3① fail-closed: the card vanished (deleted / kind changed / payload gone) between
    // the outer load and the lock → ZERO writes, and NO fallback to the pre-lock `cur`
    // snapshot — a stale snapshot must never drive writes. Caller surfaces "Card not found.".
    if (!fresh?.payload) {
      cardVanished = true;
      return;
    }
    const payload = fresh.payload as unknown as StoryboardCardPayload;

    const target = payload.shots.find((s) => s.shotId === parsed.data.shotId);
    // Vanished OR lost its frame mid-flight → no writes; caller returns error below.
    if (!target || !target.firstFrameGenerationId) return;

    // Per-shot ctx: the shot's first frame is the i2v source for THIS video.
    const ctx = minimalCtx(ownerId, card.threadId, disabledModels);
    ctx.sourceGenerationId = target.firstFrameGenerationId;

    // The WOULD-BE-MINTED card — computed via the SAME pure buildProposeCard call minting
    // uses (mintVideoChild). Single source of truth for the reuse comparison; its
    // params.durationSeconds is the SNAPPED value (never the raw shot field).
    const { cardPayload: wouldBe } = buildProposeCard(
      {
        kind: "video",
        structuredPrompt: target.videoPrompt,
        entityIds: [],
        variantSel: {},
        count: 1,
        desiredDuration: target.durationSeconds,
      },
      ctx,
      [],
    );

    // Reuse-if-fresh: an existing UNSPENT child that still matches the would-be card → reuse
    // it, do NOT mint (repeated open/cancel would otherwise orphan $0 cards). A spent or
    // mismatched (stale/missing) child → mint fresh (explicit user redo).
    if (target.videoCardId) {
      const existing = await tx.chatMessage.findFirst({
        where: { id: target.videoCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
        select: { id: true, payload: true, genJobId: true },
      });
      const ep = (existing?.payload ?? {}) as ExistingVideoChild;
      if (existing && videoChildMatches(ep, wouldBe)) {
        const spent = existing.genJobId != null || (await spentOf(existing.id, ownerId));
        if (!spent) {
          child = {
            shotId: target.shotId,
            childCardId: existing.id,
            estimatedCredits: typeof ep.estimatedCredits === "number" ? ep.estimatedCredits : 0,
            structuredPrompt:
              typeof ep.structuredPrompt === "string" ? ep.structuredPrompt : target.videoPrompt,
            entityIds: Array.isArray(ep.entityIds) ? ep.entityIds : [],
            spent: false,
          };
          // Child already registered on the shot; nothing to write. No genId touch.
          return;
        }
        // spent → fall through to mint a fresh replacement.
      }
      // missing / mismatch → fall through to mint.
    }

    child = await mintVideoChild(tx, card, target, ownerId, ctx);
    const newChildId = child.childCardId;

    const nextShots = payload.shots.map((s) => {
      if (s.shotId !== parsed.data.shotId) return s;
      // Replace videoCardId ONLY. NEVER touch videoGenerationId — the old video stays
      // valid until sync overwrites the genId when the new clip lands.
      return { ...s, videoCardId: newChildId };
    });

    await tx.chatMessage.update({
      where: { id: card.id },
      data: { payload: { ...payload, shots: nextShots } as unknown as Prisma.InputJsonObject },
    });
  });

  if (cardVanished) return { error: "Card not found." }; // R3① fail-closed surface
  if (!child) return { error: "That shot no longer exists." };
  return { child };
}
