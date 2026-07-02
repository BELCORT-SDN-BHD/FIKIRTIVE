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

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    const payload = (fresh?.payload ?? cur) as StoryboardCardPayload;

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

  // Collect finished writes OUTSIDE the txn (all reads). Candidate = EVERY shot that
  // points at a child card (≤8 shots, so the extra per-shot lookups are bounded). For
  // each, resolve its child's DONE generationId; stage a write iff that id exists AND
  // DIFFERS from the shot's current firstFrameGenerationId. This covers both:
  //  • first landing (no genId yet → write), and
  //  • replace-overwrite (a regen's new frame lands → overwrites the old genId).
  // FAILED/queued/generating/missing children resolve to null → inert (no write). A
  // write only ever REPLACES the genId value; it never deletes the key.
  const writes: Record<string, string> = {}; // shotId → generationId
  for (const shot of cur.shots) {
    if (!shot.firstFrameCardId) continue;
    const job = await doneJobFor(shot.firstFrameCardId, ownerId);
    if (!job) continue;
    const genId = await firstGenerationIdOf(job.id, ownerId);
    if (genId && genId !== shot.firstFrameGenerationId) writes[shot.shotId] = genId;
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

  const cur = (card.payload ?? {}) as StoryboardCardPayload;

  // Source disabledModels ONCE (same sourcing as buildOttoContext). Video children are
  // i2v (no entity refs), so no owned-entity lookup is needed.
  const disabledModels = Array.from(await resolveDisabledModels());

  const children: ChildFrameCard[] = [];

  await prisma.$transaction(async (tx) => {
    // Re-read the parent payload INSIDE the tx (RMW) so a concurrent edit can't be clobbered.
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
      select: { payload: true },
    });
    const payload = (fresh?.payload ?? cur) as StoryboardCardPayload;

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
        const ep = (existing?.payload ?? {}) as {
          structuredPrompt?: unknown;
          sourceGenerationId?: unknown;
          model?: unknown;
          params?: { durationSeconds?: unknown };
          entityIds?: string[];
          estimatedCredits?: number;
        };
        // Match the existing child against the would-be card on ALL of: structuredPrompt,
        // sourceGenerationId, params.durationSeconds (snapped-vs-snapped), and model. A full
        // match means a fresh mint would produce an identical spend — so reusing it is exact.
        const promptMatch = ep.structuredPrompt === wouldBe.structuredPrompt;
        const sourceMatch = ep.sourceGenerationId === wouldBe.sourceGenerationId;
        const durationMatch = ep.params?.durationSeconds === wouldBe.params?.durationSeconds;
        const modelMatch = ep.model === wouldBe.model;
        // MONEY CORRECTION (P1 kill-shot): reuse a fully-matching child REGARDLESS of spent.
        // Videos take minutes; videoGenerationId lands only when DONE, so a mid-flight re-entry
        // (double-click / re-open) sees a SPENT-but-pending child. The OLD code minted a fresh
        // child on spent → confirm charged it → the SAME shot got two children and two charges.
        // Now: matching+spent → surface it with spent:true (excluded from totalCredits, UI skips)
        // and DO NOT mint, DO NOT swap the pointer, DO NOT write the parent for this shot. This
        // makes aggregate-prepare idempotent under double-click / mid-flight re-entry. We mint a
        // fresh replacement ONLY when there is no child or the match fails (genuinely stale inputs).
        if (existing && promptMatch && sourceMatch && durationMatch && modelMatch) {
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

  const totalCredits = children.filter((c) => !c.spent).reduce((sum, c) => sum + c.estimatedCredits, 0);
  return { children, totalCredits };
}
