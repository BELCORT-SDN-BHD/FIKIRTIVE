/**
 * video-step-handoff —— 两步任务的**接力**:Step 1 出图之后,第二张确认卡由系统自己铸。
 *
 * ── 为什么要有这个模块(Codex 只读 E2E E2E-CRE-PAV-004,2026-09-04)──────────────
 *
 * 商家说「Xinyi 举起 tumbler 喝一口再对镜头笑,5 秒、9:16、无声」,Otto 正确地把它拆成两步
 * (先做 9:16 首帧,再用它出片),却只铸得出第一步的卡,然后说
 * `Once you approve and generate it, bring that image back here`。
 *
 * 那句话是**内部接缝**漏到商家面前:两步计划在这之前只是第一张卡上的一行价格披露
 * (`CardPayload.videoStep.estimatedCredits`,纯展示),系统里没有任何一处会在图出来之后接着
 * 走第二步 —— 于是唯一诚实的下一句就只剩「你自己把图带回来」。商家要重新找图、重新附加、
 * 重新把同一件事再讲一遍。
 *
 * 这里补的正是那一段:Step 1 的卡冻结第二步的规格(`videoStep.next`),Step 1 的 GenJob 走到
 * DONE 且真有产出时,服务端照那份规格 + 刚出的那张图铸出第二张**确认卡**。
 *
 * ── 钱路口径(不许动的那几条)─────────────────────────────────────────────
 *
 *   · 铸卡 $0。这里没有 reserve / settle / refund,一行账本都不写。
 *   · 第二笔钱照旧要商家自己按 `Generate · N credits` —— 卡出现 ≠ 扣费。
 *   · 第二步是**新卡新键**:它自己的 `cowork:<cardId>` 幂等域,与第一步互不相干。
 *   · 报价来自服务端单源:第二张卡整张由 `buildProposeCard` 铸(`suggestModel` →
 *     `pricedGenCredits`),这里一个价格字面量都没有,也不从第一张卡上搬那个预估数字。
 *   · Step 1 没出图(FAILED / CANCELLED / DONE 但零产出)⇒ 一张卡都不铸。
 *
 * 至多一张:调用点(`apps/worker/src/jobs/gen.ts` 的 `appendCoworkResult`)把这张卡与该作业的
 * GEN_RESULT 写在**同一个事务**里,而 GEN_RESULT 有 `ChatMessage(genJobId)` 的部分唯一索引 ——
 * 重投/恢复再跑一次会在那个索引上撞 P2002、整个事务回滚,所以第二张卡不可能出现两张。
 * 顺带也拿到了原子可见性:轮询看得见结果,就一定同时看得见这张卡。
 */
import { prisma } from "@fikirtive/db";
import {
  REFERENCE_IMAGE_EXTS,
  generationReferenceScope,
  type ApprovedEntity,
} from "@fikirtive/core";
import type { OttoContext } from "./context.js";
import { mediaReferenceReceipt } from "./media-reference.js";
import {
  buildProposeCard,
  type CardPayload,
  type VideoStepPlan,
} from "./skills/propose.helpers.js";

/** 第二步的卡在 payload 上留下的**血缘**:它是哪一张 Step 1 卡接力出来的。 */
export type VideoStepCardPayload = CardPayload & { videoStepOf: string };

function str(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * 从一张 Step 1 卡的 durable payload 里读出冻结的第二步计划。
 *
 * 读不出来就是 null,而 null 的意思永远是「没有接力」——老卡(冻结计划存在之前铸的)、
 * 普通图片卡、以及 Otto 没给片子提示词的两步卡,全都落在这里。宁可不接力,不许猜一份规格:
 * 猜出来的规格会变成一张商家从没看过、却点得下去的付费卡。
 */
export function videoStepPlanOf(payload: unknown): VideoStepPlan | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const step = (payload as Record<string, unknown>).videoStep;
  if (!step || typeof step !== "object" || Array.isArray(step)) return null;
  const next = (step as Record<string, unknown>).next;
  if (!next || typeof next !== "object" || Array.isArray(next)) return null;
  const n = next as Record<string, unknown>;
  if (!str(n.structuredPrompt)) return null;
  return {
    structuredPrompt: n.structuredPrompt,
    ...(str(n.desiredAspect) ? { desiredAspect: n.desiredAspect } : {}),
    ...(typeof n.desiredDuration === "number" && Number.isFinite(n.desiredDuration)
      ? { desiredDuration: n.desiredDuration }
      : {}),
    ...(str(n.desiredResolution) ? { desiredResolution: n.desiredResolution } : {}),
    ...(typeof n.desiredAudio === "boolean" ? { desiredAudio: n.desiredAudio } : {}),
  };
}

/**
 * 纯:冻结计划 + Step 1 真正交付的那张图 ⇒ 第二步的卡 payload。
 *
 * 整张卡走 `buildProposeCard` —— 与商家自己发起的任何一张 i2v 卡**同一条路**:同一次选型、
 * 同一份规格条目、同一个价目源。这里不自己拼 payload,也就不可能拼出一张与真实执行不一样的卡。
 *
 * `mediaReferences` 必须带上那张首帧的回执:`planCardGate` 把「卡上有 `sourceGenerationId`
 * 却没有对应回执」判成不可批准 —— 少了它,这张自动出现的卡商家根本按不下去。
 *
 * 造不出诚实的卡时照旧抛 `ProposeRefusal`(引擎被关掉、提示词撑不起这个形状),由调用方
 * 翻成「不接力」。
 */
export function buildVideoStepCardPayload(input: {
  plan: VideoStepPlan;
  /** 接力自哪一张卡 —— 血缘,写进 payload。 */
  step1CardId: string;
  /** Step 1 真正交付的那张图,成为第二步的 i2v 首帧。 */
  sourceGenerationId: string;
  /** 那张图的回执(名字 / 缩略图 / 来源画布),商家在按下按钮之前读的就是它。 */
  receipt: OttoContext["mediaReferences"];
  scope: { orgId: string; projectId: string; threadId: string; disabledModels: string[] };
  ownedEntities?: ApprovedEntity[];
}): VideoStepCardPayload {
  const ctx: OttoContext = {
    orgId: input.scope.orgId,
    userId: input.scope.orgId,
    projectId: input.scope.projectId,
    threadId: input.scope.threadId,
    disabledModels: input.scope.disabledModels,
    sourceGenerationId: input.sourceGenerationId,
    sourceGenerationIds: [input.sourceGenerationId],
    mediaReferences: input.receipt,
    // `turnText` 刻意不设:第二步的动作来自商家在第一张卡上已经批准的那份计划,
    // 没有第二次转述可以对表(与 clip-actions 的「他按的那个键」同一条理由)。
  };
  const { cardPayload } = buildProposeCard(
    {
      kind: "video",
      structuredPrompt: input.plan.structuredPrompt,
      // 首帧那一档引擎只认首帧,@元素照旧被清空 —— 这里干脆不带,卡面也就不会承诺
      // 一件不会发生的事(与 `buildProposeCard` 的 i2v 清空逐字同一个结果)。
      entityIds: [],
      variantSel: {},
      count: 1,
      ...(input.plan.desiredAspect ? { desiredAspect: input.plan.desiredAspect } : {}),
      ...(typeof input.plan.desiredDuration === "number"
        ? { desiredDuration: input.plan.desiredDuration }
        : {}),
      ...(input.plan.desiredResolution ? { desiredResolution: input.plan.desiredResolution } : {}),
      ...(typeof input.plan.desiredAudio === "boolean" ? { desiredAudio: input.plan.desiredAudio } : {}),
    },
    ctx,
    input.ownedEntities ?? [],
  );
  return { ...cardPayload, videoStepOf: input.step1CardId };
}

/** 接力准备好了 —— 调用方在自己的事务里把这张卡写下去。 */
export type PreparedVideoStep = {
  /** 接力自哪一张 Step 1 卡。 */
  step1CardId: string;
  payload: VideoStepCardPayload;
};

/**
 * Step 1 的作业刚刚交付 ⇒ 第二步的卡该不该出、长什么样。
 *
 * 全部只读、$0:读作业、读 Step 1 的卡、读刚出的那张图。任何一格答不上来就返回 null ——
 * 「不接力」永远是安全的降级(商家照旧可以自己接着说下一句),而一张猜出来的卡不是。
 *
 * 永不抛:接力是交付路径上的**尾巴**,它不该有能力把一次已经付过钱、已经交付的生成写坏。
 */
export async function planVideoStepHandoff(input: {
  jobId: string;
  ownerId: string;
  threadId: string;
  /** 这一单真正交付的产出(权威列 `GenJob.generationIds`)。空 = 没交付,不接力。 */
  generationIds: string[];
  disabledModels: string[];
}): Promise<PreparedVideoStep | null> {
  try {
    const sourceGenerationId = input.generationIds[0];
    if (!sourceGenerationId) return null;

    // ① 这一单是从哪张卡来的。权威链是 `cowork:<cardId>` 幂等键(与卡的 $0 铸卡域同一把键);
    //    `ChatMessage.genJobId` 那条链是 best-effort 的标记,只当回退。
    const job = await prisma.genJob.findFirst({
      where: { id: input.jobId, ownerId: input.ownerId },
      select: { idempotencyKey: true, projectId: true, kind: true },
    });
    if (!job || job.kind !== "IMAGE") return null;
    const keyed = job.idempotencyKey?.startsWith("cowork:")
      ? job.idempotencyKey.slice("cowork:".length)
      : null;
    const card = keyed
      ? await prisma.chatMessage.findFirst({
          where: { id: keyed, ownerId: input.ownerId, kind: "GEN_CARD", deletedAt: null },
          select: { id: true, payload: true },
        })
      : await prisma.chatMessage.findFirst({
          where: { genJobId: input.jobId, ownerId: input.ownerId, kind: "GEN_CARD", deletedAt: null },
          select: { id: true, payload: true },
        });
    if (!card) return null;

    // ② 这张卡有没有冻结的第二步。没有 ⇒ 普通图片卡,什么都不做。
    const plan = videoStepPlanOf(card.payload);
    if (!plan) return null;

    // ③ 刚交付的那张图 —— 判据走 `generationReferenceScope`(引用范围的唯一那一份:
    //    同租户、活着、扩展名对得上;**不加 projectId**,画布只是出处)。
    const gen = await prisma.generation.findFirst({
      where: { id: sourceGenerationId, ...generationReferenceScope(input.ownerId, REFERENCE_IMAGE_EXTS) },
      select: {
        id: true,
        projectId: true,
        promptText: true,
        asset: { select: { ownerId: true, contentHash: true, ext: true } },
      },
    });
    if (!gen) return null;
    const project = await prisma.project.findFirst({
      where: { id: gen.projectId, ownerId: input.ownerId },
      select: { name: true },
    });

    const receipt = mediaReferenceReceipt({
      generationId: gen.id,
      kind: "image",
      prompt: gen.promptText ?? "",
      sourceProjectId: gen.projectId,
      sourceProjectName: project?.name ?? null,
      sameCanvas: gen.projectId === job.projectId,
      asset: gen.asset,
    });

    const payload = buildVideoStepCardPayload({
      plan,
      step1CardId: card.id,
      sourceGenerationId: gen.id,
      receipt: [receipt],
      scope: {
        orgId: input.ownerId,
        projectId: job.projectId,
        threadId: input.threadId,
        disabledModels: input.disabledModels,
      },
    });
    return { step1CardId: card.id, payload };
  } catch (e) {
    // 接力失败 = 少一张卡,商家照旧可以自己说下一句;接力失败绝不许变成「交付被写坏」。
    console.warn(
      `[video-step] ${input.jobId}: handoff skipped (non-fatal):`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
