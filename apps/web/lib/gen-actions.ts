"use server";
/**
 * Shot/session generation actions (redesign Gen space). Validate → persist a
 * GenJob → dispatch → poll. The worker resolves conditioning, calls the
 * provider, and writes Generation candidates (optionally bound to a shot).
 */
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { fromPrisma } from "pg-boss";
import { prisma, reserveCredits, InsufficientCredits } from "@fikirtive/db";
import {
  genRequest,
  newId,
  GEN_QUEUE,
  storageKey,
  storageKeyToSrc,
  isModelDisabled,
  assertSpendableModel,
  displayCredits,
  pricedGenCredits,
  activeImageModel,
  activeVideoModel,
  GEN_MODELS,
  GEN_IMAGE_MODEL_OPTIONS,
  GEN_VIDEO_MODELS,
  GEN_VIDEO_MODEL_OPTIONS,
  videoDefaults,
  imageDefaults,
  genJobEndedWithoutDelivering,
  type GenModel,
  type GenVideoModel,
  type GenJobData,
} from "@fikirtive/core";
import { getBoss } from "./queue";
import { checkCast } from "./cowork-guardian";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { isImpersonating } from "@/lib/better-auth/compat";
import { resolveDisabledModels } from "./model-registry";
import { sanitizeUserError } from "./provider-secrecy";
import {
  canvasActionKey,
  factoryMaterialMatches,
  normalizeFactoryMaterial,
  parseCanvasActionKey,
  parseFactoryAttemptKey,
  FACTORY_HISTORY_SELECT,
  type CanvasActionKey,
  type FactoryAttemptKey,
  type FactoryHistoryRow,
  type FactoryMaterial,
} from "./batch-idempotency";

export type StartGenResult =
  | { id: string; disposition: "fresh" | "reused" }
  /** `conflict` 是一个确定性判决(这个键已经属于别的内容);`retryable` 说的是完全不同的一件事:
   *  **谁也不知道结果**,而且花钱之前就停住了 —— 调用方必须保住同一个逻辑动作身份再试一次,
   *  绝不可以当成拒绝而换一个新动作(#656 P1)。 */
  | { error: string; disposition?: "conflict" | "retryable"; refunded?: true };

export type ActiveGenModels = {
  /** Opaque browser control ids. The real provider-backed model ids remain server-side. */
  image: string;
  video: string;
  imageCredits: number;
  videoCredits: number;
  videoDefaults: ReturnType<typeof videoDefaults>;
  videoAspectRatios: string[];
  /** #645 T4 —— 视频规格菜单(picker 顺序)。UI 只渲染这两份列表,自己不写死任何一档。 */
  videoDurations: number[];
  videoResolutions: string[];
  /** 带首帧(Animate / 分镜首帧接片)时的默认形状 —— Seedance 是 adaptive:引擎跟着首帧走。
   *  与 `videoDefaults.aspectRatio`(t2v 默认)是**两个**值,不许互相顶替。 */
  videoI2vDefaultAspect: string;
  /**
   * 每一档规格的**确切**显示 credits,键 = `${resolution}:${seconds}`。
   *
   * 为什么是一整张表而不是让浏览器自己算:#645 起视频按秒计价,价格随商家选的档位变。
   * 价格只能有一个来源(服务端的 `pricedGenCredits`)—— 浏览器复制一份计价公式,就是
   * 「显示的」与「收的」第二次分家的入口。24 档全表一次带回来,选择器直接查表。
   */
  videoCreditsBySpec: Record<string, number>;
  /** #643 T2 —— 图片形状菜单（default-first）。UI 只渲染这份列表，自己不写死任何一格。 */
  imageAspectRatios: string[];
  /** 商家没选形状时会交付的那一格。UI 的初始选中值取这里，所以「显示的」= 「会交付的」。 */
  imageDefaultAspect: string;
};

class QueuePrepareFailed extends Error {}

function modelMenu(kind: "image" | "video"): readonly string[] {
  return kind === "video" ? GEN_VIDEO_MODELS : GEN_MODELS;
}

function publicModelAlias(kind: "image" | "video", model: string): string {
  const index = modelMenu(kind).indexOf(model);
  if (index < 0) throw new Error("Active generation capability is not configured.");
  return `capability-${kind}-${index + 1}`;
}

/** Translate only our opaque browser ids; legacy/internal model ids keep their exact behavior. */
function resolvePublicModelAlias(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const kind = record.kind === "video" ? "video" : "image";
  const match = typeof record.model === "string"
    ? new RegExp(`^capability-${kind}-(\\d+)$`, "u").exec(record.model)
    : null;
  if (!match) return raw;
  const model = modelMenu(kind)[Number(match[1]) - 1];
  return model ? { ...record, model } : raw;
}

/** 继承快照**读失败**。这不是一个答案,是「不知道」——`startGen` 把它翻译成一个可重试的
 *  回应,先于任何 create/reserve(#656 P1)。 */
class InheritedAspectUnknown extends Error {}

/**
 * #642 — 「改这张图 / 再来一张」的画幅继承。
 *
 * 商家没另选画幅时,重做一张图不应该悄悄换掉形状。画幅的**唯一**依据是源图那一单入队时
 * 冻结的规格快照(`GenJob.imageOptions`)—— 不去反推像素、不去猜。
 *
 * 这里有两种截然不同的结果,过去被写成了同一个 null,#656 P1 的双扣通道就是这么开的:
 *  - **源头真的没有快照**(迁移前的老图、那一单已不在)→ 返回 null,调用方诚实回落默认画幅;
 *    `EXECUTED_SPEC.image.sourceAspectInheritedFromSnapshot` 把这条口径写成了数据。
 *  - **读的时候出错**(一次 DB 抖动)→ 谁也不知道源图是什么形状。这时候把它当成「没有快照」
 *    就是拿一个**编造出来的默认形状**去和商家上一次真的落库的形状比对 —— 于是一次合法重试
 *    被判成「换了内容」,回执被删,下一次点击变成新动作、第二笔钱。所以它必须原样上抛。
 *
 * 只读、owner 作用域。
 */
async function inheritedImageAspect(
  ownerId: string,
  sourceGenerationId: string,
  model: string,
): Promise<string | null> {
  let source: { imageOptions: unknown } | null;
  try {
    source = await prisma.genJob.findFirst({
      where: { ownerId, kind: "IMAGE", generationIds: { has: sourceGenerationId } },
      orderBy: { createdAt: "desc" },
      select: { imageOptions: true },
    });
  } catch (e) {
    throw new InheritedAspectUnknown(e instanceof Error ? e.message : "inherited aspect read failed");
  }
  const snapshot = source?.imageOptions as { aspectRatio?: unknown } | null | undefined;
  const aspect = typeof snapshot?.aspectRatio === "string" ? snapshot.aspectRatio : null;
  // 快照里的值也要过**这一单要跑的那个模型**的菜单 —— 一个下线了的旧画幅不得靠继承
  // 绕过契约校验,把一个引擎收不下的值送进付费调用。
  return aspect && GEN_IMAGE_MODEL_OPTIONS[model as GenModel]?.aspectRatios.includes(aspect)
    ? aspect
    : null;
}

/** Read-only history verdict. `null` means this attempt may be fresh, so the caller must run the
 * fresh-only gates and repeat this verdict under the project lock before create + reserve. */
function factoryHistoryVerdict(
  history: FactoryHistoryRow[],
  attempt: FactoryAttemptKey,
  material: FactoryMaterial,
): StartGenResult | null {
  if (history.some((prior) => !factoryMaterialMatches(prior, material))) {
    return {
      error: "That batchId is already in use for different content — start a new batch with a fresh id.",
      disposition: "conflict",
    };
  }
  const exact = history.find((prior) => prior.idempotencyKey === attempt.key);
  if (exact) return { id: exact.id, disposition: "reused" };
  // A NEW attempt may only be created once every prior job for this cell has ENDED WITHOUT
  // DELIVERING (#602 T3). This used to be spelled `status !== "FAILED"` — which said, without
  // meaning to, that failing is the ONLY ending that frees the cell. That held exactly as long as
  // cancelling wrote the word FAILED; the moment cancel became its own word, a cancelled job read
  // as still live and the merchant's next press was handed back the dead job. They press
  // Generate, wait, and nothing is ever made. Money is untouched by this line: a cancelled job
  // was refunded when it was cancelled, and the fresh attempt below reserves for itself exactly
  // as any first attempt does.
  const stillLive = history.find((prior) => !genJobEndedWithoutDelivering(prior.status));
  if (stillLive) return { id: stillLive.id, disposition: "reused" };
  return null;
}

function canvasHistoryVerdict(
  history: FactoryHistoryRow[],
  action: CanvasActionKey,
  material: FactoryMaterial,
): StartGenResult | null {
  const prior = history.find((row) => row.idempotencyKey === action.key);
  if (!prior) return null;
  if (!factoryMaterialMatches(prior, material)) {
    return {
      error: "That canvas action is already in use for different content — start a new action.",
      disposition: "conflict",
    };
  }
  // A Canvas UI action is once-ever, including DONE/FAILED/CANCELLED. Retrying an action
  // returns the exact accepted job; an explicit new user action supplies a new actionId.
  return { id: prior.id, disposition: "reused" };
}

const CANVAS_ACTION_ID_MAX_LENGTH = 128;
const TRUSTED_CANVAS_REQUESTS = new WeakMap<object, { expectedCredits: number }>();
type TrustedCoworkRequest = {
  ownerId: string;
  cardId: string;
  projectId: string;
  threadId: string;
  expectedCredits: number | null;
};
const TRUSTED_COWORK_REQUESTS = new WeakMap<object, TrustedCoworkRequest>();

/** Canvas's paid entrypoint. The browser supplies a stable logical actionId, never an
 * idempotency key; the reserved durable key is derived here on the server. */
export async function startCanvasGen(raw: unknown): Promise<StartGenResult> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "That generation request is out of bounds." };
  }
  const record = raw as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "idempotencyKey")) {
    return { error: "That generation request is out of bounds." };
  }
  const { actionId, expectedCredits, ...request } = record;
  if (
    typeof actionId !== "string" ||
    actionId.trim().length === 0 ||
    actionId.length > CANVAS_ACTION_ID_MAX_LENGTH ||
    typeof expectedCredits !== "number" ||
    !Number.isFinite(expectedCredits) ||
    expectedCredits < 0
  ) {
    return { error: "That generation request is out of bounds." };
  }
  const trustedRequest = { ...request, idempotencyKey: canvasActionKey(actionId).key };
  TRUSTED_CANVAS_REQUESTS.set(trustedRequest, { expectedCredits });
  return startGen(trustedRequest);
}

/** Otto/GEN_CARD's paid entrypoint. The durable card — not the browser or model — supplies
 * the approved displayed-credit quote and binds it to this owner, thread, project, and key. */
export async function startCoworkGen(raw: unknown): Promise<StartGenResult> {
  const parsed = genRequest.safeParse(resolvePublicModelAlias(raw));
  if (!parsed.success) return { error: "That generation request is out of bounds." };
  const { idempotencyKey, projectId, threadId } = parsed.data;
  if (!idempotencyKey?.startsWith("cowork:") || idempotencyKey.length <= "cowork:".length || !threadId) {
    return { error: "That generation request is out of bounds." };
  }

  const gate = await requireOwner(); if ("error" in gate) return gate;
  const cardId = idempotencyKey.slice("cowork:".length);
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId: gate.ownerId, kind: "GEN_CARD", deletedAt: null },
    select: {
      threadId: true,
      payload: true,
      thread: { select: { projectId: true, ownerId: true, deletedAt: true } },
    },
  });
  if (
    !card ||
    card.thread.deletedAt ||
    card.thread.ownerId !== gate.ownerId ||
    card.threadId !== threadId ||
    card.thread.projectId !== projectId
  ) {
    return { error: "Generation card not found." };
  }

  const payload = (card.payload ?? {}) as Record<string, unknown>;
  const quote = payload.estimatedCredits;
  const expectedCredits = typeof quote === "number" && Number.isSafeInteger(quote) && quote > 0
    ? quote
    : null;
  const trustedRequest = { ...parsed.data };
  TRUSTED_COWORK_REQUESTS.set(trustedRequest, {
    ownerId: gate.ownerId,
    cardId,
    projectId,
    threadId,
    expectedCredits,
  });
  return startGen(trustedRequest);
}

export async function startGen(raw: unknown): Promise<StartGenResult> {
  // Server provenance only: a serialized caller object cannot be a member of this module-local
  // WeakSet. startCanvasGen adds the exact in-process object before delegating here, keeping
  // startGen as the one genRequest validator/create/reserve/dispatch authority.
  const trustedCanvasRequest = raw !== null && typeof raw === "object"
    ? TRUSTED_CANVAS_REQUESTS.get(raw as object)
    : undefined;
  const trustedCoworkRequest = raw !== null && typeof raw === "object"
    ? TRUSTED_COWORK_REQUESTS.get(raw as object)
    : undefined;
  if (raw !== null && typeof raw === "object") {
    TRUSTED_CANVAS_REQUESTS.delete(raw as object);
    TRUSTED_COWORK_REQUESTS.delete(raw as object);
  }
  const trustedCanvasKey = trustedCanvasRequest !== undefined;
  const gate = await requireOwner(); if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<StartGenResult> => {
    const OWNED = { ownerId, deletedAt: null } as const;
    const parsed = genRequest.safeParse(resolvePublicModelAlias(raw));
    if (!parsed.success) return { error: "That generation request is out of bounds." };
    const { projectId, shotId, sourceGenerationId, tailGenerationId, referenceVideoGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio, idempotencyKey, variantSel, threadId } = parsed.data;
    const parsedCanvasAction = parseCanvasActionKey(idempotencyKey);
    if (parsedCanvasAction && !trustedCanvasKey) {
      return { error: "That generation request is out of bounds." };
    }
    const canvasAction = trustedCanvasKey ? parsedCanvasAction : null;
    if (trustedCanvasKey && !canvasAction) {
      return { error: "That generation request is out of bounds." };
    }
    const coworkCardId = idempotencyKey?.startsWith("cowork:")
      ? idempotencyKey.slice("cowork:".length)
      : null;
    if (coworkCardId !== null && !trustedCoworkRequest) {
      return { error: "That generation request is out of bounds." };
    }
    if (
      trustedCoworkRequest &&
      (
        !coworkCardId ||
        coworkCardId !== trustedCoworkRequest.cardId ||
        ownerId !== trustedCoworkRequest.ownerId ||
        projectId !== trustedCoworkRequest.projectId ||
        threadId !== trustedCoworkRequest.threadId
      )
    ) {
      return { error: "That generation request is out of bounds." };
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
    if (!project) return { error: "Project not found." };

    // #642 图片画幅:商家没明说时,带底图的请求(详情页 edit / 再来一张)继承源图的画幅,
    // 让「改这张图」不改形状。源头真的没有快照就是 null,由 normalizeFactoryMaterial 落默认。
    // 解析在材料成形之前完成,所以快照、幂等材料、worker 三处看到的是同一个值。
    //
    // #656 P1:读**出错**时这里必须停住。继承出来的形状是幂等材料的一部分,而这一段跑在精确
    // 键重放核对之前 —— 拿一个编造的默认形状继续走下去,就等于让一次瞬时读错把商家的合法重试
    // 判成「换了内容」。停在这里花不出任何钱:create/reserve 都在后面。
    let effectiveAspectRatio: string | null | undefined;
    try {
      effectiveAspectRatio = kind === "image" && !aspectRatio && sourceGenerationId
        ? await inheritedImageAspect(ownerId, sourceGenerationId, model)
        : aspectRatio;
    } catch (e) {
      if (!(e instanceof InheritedAspectUnknown)) throw e;
      return {
        error: "We couldn't confirm the shape of the image you're editing — nothing was charged. Retry this same action.",
        disposition: "retryable",
      };
    }

    // variantSel conditions IMAGE generation (which keyframe to anchor on). Video (i2v)
    // conditions on the source keyframe, not entity refs — the chosen variant is already
    // baked into that keyframe — so it's not meaningful for video and the worker ignores
    // it. The shared material normalizer drops video maps and canonicalizes an empty image
    // map to absent, matching the worker's `job.variantSel ?? {}` semantics.
    const material = normalizeFactoryMaterial({
      prompt,
      model,
      kind,
      count,
      entityIds,
      variantSel,
      sourceGenerationId,
      tailGenerationId,
      referenceVideoGenerationId,
      shotId,
      threadId,
      durationSeconds,
      resolution,
      aspectRatio: effectiveAspectRatio,
      fps,
      audio,
    });
    const effectiveVariantSel = material.variantSel ?? undefined;
    const factoryAttempt = parseFactoryAttemptKey(idempotencyKey);

    // Durable factory replay fast path. Dynamic fresh-only gates (guardian/model switches/pricing)
    // may legitimately change after a job was accepted, but they must not make the same attempt's
    // response stop being idempotent. This owner+project-scoped read can only reuse/refuse — never
    // create or reserve. A miss still runs every gate, then repeats the verdict under the project
    // advisory lock before the only create + reserve authority.
    if (factoryAttempt) {
      const history = await prisma.genJob.findMany({
        where: {
          ownerId,
          projectId,
          idempotencyKey: { startsWith: factoryAttempt.logicalPrefix },
        },
        orderBy: { createdAt: "desc" },
        select: FACTORY_HISTORY_SELECT,
      });
      const early = factoryHistoryVerdict(history, factoryAttempt, material);
      if (early) return early;
    }

    if (canvasAction) {
      const history = await prisma.genJob.findMany({
        where: { ownerId, projectId, idempotencyKey: canvasAction.key },
        orderBy: { createdAt: "desc" },
        select: FACTORY_HISTORY_SELECT,
      });
      const early = canvasHistoryVerdict(history, canvasAction, material);
      if (early) return early;
    }

    // A GEN_CARD is once-ever. Replay any accepted job (including terminal states) before
    // fresh-only thread, model, guardian, and pricing gates so later drift cannot break the
    // idempotent answer. The same lookup is repeated under the project lock below.
    if (trustedCoworkRequest) {
      const existing = await prisma.genJob.findFirst({
        where: { ownerId, projectId, idempotencyKey: `cowork:${trustedCoworkRequest.cardId}` },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (existing) return { id: existing.id, disposition: "reused" };
      if (trustedCoworkRequest.expectedCredits === null) {
        return { error: "This generation card needs a current price. Ask Otto to propose it again, then review the new card." };
      }
    }

    // Fresh thread-attributed work must name a live thread in the authenticated owner+project.
    // Durable exact replays above intentionally return their already-accepted job even if that
    // thread is later archived; they do not create or reserve anything.
    if (threadId) {
      const thread = await prisma.chatThread.findFirst({
        where: { id: threadId, ownerId, projectId, deletedAt: null },
        select: { id: true },
      });
      if (!thread) return { error: "Thread not found." };
    }

    // double-submit guard (fast path): a reload re-sends the same stable key, so
    // reuse the in-flight job instead of starting (and paying for) a 2nd one. The
    // partial-unique index on the create below is the race-proof backstop. Factory keys
    // deliberately skip this shortcut: their full material + attempt decision belongs
    // under the existing project advisory transaction lock below.
    if (idempotencyKey && !factoryAttempt && !canvasAction && !trustedCoworkRequest) {
      const active = await prisma.genJob.findFirst({
        where: { ownerId, projectId, idempotencyKey, status: { in: ["QUEUED", "GENERATING"] } },
        orderBy: { createdAt: "desc" }, select: { id: true },
      });
      if (active) return { id: active.id, disposition: "reused" };
    }

    // The shared material normalizer resolves the exact five video controls persisted below.
    const videoOptions = material.videoOptions ?? undefined;
    // …and the image shape (#642), from the same normalizer, persisted the same way.
    const imageOptions = material.imageOptions ?? undefined;

    // consistencyGuardian (Phase 2): block obvious money-wasters BEFORE the spend
    // commit (a CHARACTER with no refs, a deleted @mention, a cross-project i2v
    // frame). Fail-OPEN — checkCast returns null on its own faults — and additive
    // only: it never loosens the existing gate.
    const block = await checkCast({ ownerId, projectId, entityIds, variantSel: effectiveVariantSel, sourceGenerationId, tailGenerationId, model, kind });
    if (block) {
      try {
        await prisma.actionEvent.create({ data: { id: newId(), ownerId, projectId, type: "gen.guardian-block", payload: { findings: block.report.findings } } });
      } catch { /* audit best-effort — a log hiccup must not swallow the block */ }
      return { error: sanitizeUserError(block.error) };
    }

    // OPT-6 P2: reject an admin-disabled model BEFORE the spend commit. This is
    // ADDITIVE narrowing — the typed superRefine above stays the authority over
    // which (model,params) may spend; this only subtracts a turned-off model.
    // Fail-closed-to-typed-menu on a DB fault (resolveDisabledModels → empty set).
    const disabled = await resolveDisabledModels();
    if (isModelDisabled(model, disabled)) {
      return { error: "That model is currently turned off — pick another." };
    }

    const kindForModel = kind === "image" ? "image" : "video";
    const spendable = assertSpendableModel(model, kindForModel);
    if (!spendable.ok) return { error: sanitizeUserError(spendable.error) };

    // P2: the deterministic CHARGE in internal credits — reserved atomically with the
    // job insert below, settled at commit, refunded on terminal failure (the worker).
    // Same value the worker recomputes from the frozen job row → reserve == settle.
    const cost = pricedGenCredits({
      kind: kind === "video" ? "VIDEO" : "IMAGE",
      model,
      count: kind === "video" ? 1 : count,
      referenceVideoGenerationId: referenceVideoGenerationId ?? null,
      videoOptions: videoOptions ?? null,
    });
    const displayedCost = displayCredits(cost);

    // Prepare pg-boss before opening the money transaction, but do not return early on failure:
    // a concurrent same-action winner may already exist by the time we acquire the project lock.
    // The locked replay checks below get first say; only a genuinely fresh attempt is refused.
    let boss: Awaited<ReturnType<typeof getBoss>> | null = null;
    try {
      boss = await getBoss();
    } catch {
      // Kept as a known pre-send state. No GenJob or reservation exists yet.
    }

    // GenJob keeps the project's sortable ULID. pg-boss stores custom job ids in a PostgreSQL UUID
    // column, so it needs a separate UUID; persisting that UUID on GenJob binds the two rows. Commit
    // ACK recovery remains anchored to the owner/project-scoped GenJob id.
    const jobId = newId();
    const queueJobId = randomUUID();

    let decision: StartGenResult;
    try {
      // CREATE + RESERVE + ENQUEUE are one PostgreSQL transaction. Any failure rolls back all
      // three, so there is no post-commit dispatch/refund compensation window and no possibility
      // of a worker running a job whose reservation was separately refunded.
      decision = await prisma.$transaction(async (tx): Promise<StartGenResult> => {
        const projectLockKey = `project:${projectId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectLockKey}, 0::bigint))`;
        const liveProject = await tx.project.findFirst({
          where: { id: projectId, ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!liveProject) throw new Error("PROJECT_DELETED_DURING_GENERATION_START");

        if (factoryAttempt) {
          // Factory's exact attempt + logical-cell content binding is decided under the SAME
          // owner/project advisory lock as create+reserve. No time window and no all-status index:
          // an exact attempt is reused forever; a new attempt may create only after every prior
          // logical-cell job ENDED WITHOUT DELIVERING (failed OR cancelled — #602 T3);
          // content never changes across attempts (a prior ending included).
          const history = await tx.genJob.findMany({
            where: {
              ownerId,
              projectId,
              idempotencyKey: { startsWith: factoryAttempt.logicalPrefix },
            },
            orderBy: { createdAt: "desc" },
            select: FACTORY_HISTORY_SELECT,
          });
          const locked = factoryHistoryVerdict(history, factoryAttempt, material);
          if (locked) return locked;
        }

        if (trustedCoworkRequest) {
          const existing = await tx.genJob.findFirst({
            where: { ownerId, projectId, idempotencyKey: `cowork:${trustedCoworkRequest.cardId}` },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (existing) return { id: existing.id, disposition: "reused" };
          if (trustedCoworkRequest.expectedCredits !== displayedCost) {
            return {
              error: `The approved price changed from ${trustedCoworkRequest.expectedCredits} to ${displayedCost} credits. Ask Otto for an updated proposal, then review it again.`,
            };
          }
        }

        if (canvasAction) {
          const history = await tx.genJob.findMany({
            where: { ownerId, projectId, idempotencyKey: canvasAction.key },
            orderBy: { createdAt: "desc" },
            select: FACTORY_HISTORY_SELECT,
          });
          const locked = canvasHistoryVerdict(history, canvasAction, material);
          if (locked) return locked;
          // The number the owner saw is part of the authorization. A stale tab may submit
          // after pricing changes; fail before create/reserve. Exact replays above still reuse
          // their already-authorized job regardless of later price changes.
          if (trustedCanvasRequest && trustedCanvasRequest.expectedCredits !== displayedCost) {
            return {
              error: `The confirmed price changed from ${trustedCanvasRequest.expectedCredits} to ${displayedCost} credits. Refresh Canvas to load the current price, then review and send again.`,
            };
          }
        }

        // The lock-free active-key lookup above is only a fast path. Re-read ordinary keys under
        // the same project lock as create + reserve + enqueue so a concurrent winner is reused even
        // when this request could not prepare pg-boss. Without this, the loser could incorrectly
        // report "Nothing was charged" after the winner had already committed.
        if (idempotencyKey && !factoryAttempt && !canvasAction && !trustedCoworkRequest) {
          const active = await tx.genJob.findFirst({
            where: { ownerId, projectId, idempotencyKey, status: { in: ["QUEUED", "GENERATING"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (active) return { id: active.id, disposition: "reused" };
        }

        // The preflight read is not a lock. Repeat attribution under the same project advisory
        // transaction that owns create+reserve so a concurrently archived thread cannot be
        // stamped onto newly paid work.
        if (threadId) {
          const liveThread = await tx.chatThread.findFirst({
            where: { id: threadId, ownerId, projectId, deletedAt: null },
            select: { id: true },
          });
          if (!liveThread) throw new Error("THREAD_DELETED_DURING_GENERATION_START");
        }

        // All locked replay/conflict verdicts have returned above. A prepare failure therefore
        // rejects only a fresh attempt, before create/reserve, while preserving concurrent reuse.
        if (!boss) throw new QueuePrepareFailed();

        const created = await tx.genJob.create({
          data: {
            id: jobId, ownerId, projectId, shotId: shotId ?? null,
            sourceGenerationId: sourceGenerationId ?? null,
            tailGenerationId: tailGenerationId ?? null,
            referenceVideoGenerationId: referenceVideoGenerationId ?? null,
            prompt, entityIds, count: kind === "video" ? 1 : count, model,
            kind: kind === "video" ? "VIDEO" : "IMAGE",
            idempotencyKey: idempotencyKey ?? null,
            threadId: threadId ?? null, // cowork tag — keeps this job out of the GenSpace/Assets/Editor views
            queueJobId,
            ...(videoOptions ? { videoOptions } : {}),
            // #642: the frozen image shape — the worker reads it back, and a later
            // "edit this image" inherits from it. Video jobs get null (normalizer drops it).
            ...(imageOptions ? { imageOptions } : {}),
            // Phase C: persist the @mention→variant bindings so the worker conditions on
            // the right variant. Image-only (the shared material normalizer drops it for video).
            // Omitted when empty → column stays null (old/bare/video gens unchanged).
            ...(material.variantSel ? { variantSel: material.variantSel } : {}),
          },
          select: { id: true },
        });
        await reserveCredits(tx, { orgId: ownerId, refId: created.id, cost });
        const sentQueueJobId = await boss.send(
          GEN_QUEUE,
          { genJobId: created.id } satisfies GenJobData,
          { id: queueJobId, db: fromPrisma(tx) },
        );
        if (sentQueueJobId !== queueJobId) {
          throw new Error("GEN_QUEUE_INSERT_NOT_CONFIRMED");
        }
        return { id: created.id, disposition: "fresh" };
      });
    } catch (e) {
      // out of credits: the reserve rolled the tx back, so no job was created/queued.
      if (e instanceof InsufficientCredits) {
        return { error: "You've used up your beta credits — reply and we'll top you up." };
      }
      if (e instanceof Error && e.message === "PROJECT_DELETED_DURING_GENERATION_START") {
        return { error: "Project not found." };
      }
      if (e instanceof Error && e.message === "THREAD_DELETED_DURING_GENERATION_START") {
        return { error: "Thread not found." };
      }
      if (e instanceof QueuePrepareFailed) {
        return {
          error: "Generation could not start because the queue was unavailable. Nothing was charged — retry when it is available.",
        };
      }
      // partial-unique index race: a concurrent same-key submit won the insert → return
      // ITS job instead of creating (and paying for) a duplicate. The tx rolled back, so
      // no reserve happened for this attempt. Scope the lookup to mirror each key's index:
      // a general (shot-frame) key conflicts only while ACTIVE (active-only index), so match
      // active — keeping the original behavior and not masking a future unrelated unique
      // conflict; a cowork:<cardId> key is exactly-once-ever (GenJob_cowork_idempotency_once
      // is all-status), so match ANY status — a re-insert after the first job is DONE/FAILED
      // must also return that job, never spend again, never re-throw P2002 to the caller.
      if (idempotencyKey && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        if (canvasAction) {
          const existing = await prisma.genJob.findFirst({
            where: { ownerId, projectId, idempotencyKey: canvasAction.key },
            orderBy: { createdAt: "desc" },
            select: FACTORY_HISTORY_SELECT,
          });
          if (existing) {
            const recovered = canvasHistoryVerdict([existing], canvasAction, material);
            if (recovered) return recovered;
          }
          return { error: "That canvas action could not be safely deduplicated — retry it." };
        }
        if (factoryAttempt) {
          const existing = await prisma.genJob.findFirst({
            where: { ownerId, projectId, idempotencyKey: factoryAttempt.key },
            orderBy: { createdAt: "desc" },
            select: FACTORY_HISTORY_SELECT,
          });
          if (existing) {
            if (!factoryMaterialMatches(existing, material)) {
              return {
                error: "That batchId is already in use for different content — start a new batch with a fresh id.",
                disposition: "conflict",
              };
            }
            return { id: existing.id, disposition: "reused" };
          }
          // A factory recovery must never fall through to the generic id-only lookup below: doing
          // so would reuse a late-visible winner without verifying its full material binding.
          // PostgreSQL unique conflicts normally make the winner visible before this catch; if an
          // unrelated P2002 reaches here, refuse safely instead of guessing.
          return { error: "That batch request could not be safely deduplicated — retry it." };
        }
        const coworkKey = idempotencyKey.startsWith("cowork:");
        const existing = await prisma.genJob.findFirst({
          where: { ownerId, projectId, idempotencyKey, ...(coworkKey ? {} : { status: { in: ["QUEUED", "GENERATING"] } }) },
          orderBy: { createdAt: "desc" }, select: { id: true },
        });
        if (existing) return { id: existing.id, disposition: "reused" };
      }

      // The transaction callback completed or failed, but its final outcome may be unknown (for
      // example, a connection/ACK loss). Query the pre-generated identity in the authenticated
      // owner+project scope. A visible row proves create + reserve + enqueue committed atomically.
      // Missing/unqueryable state stays unknown and is thrown so keyed callers retain the same
      // logical action identity for a safe retry.
      let committed: { id: string } | null;
      try {
        committed = await prisma.genJob.findFirst({
          where: { id: jobId, ownerId, projectId },
          select: { id: true },
        });
      } catch {
        throw e;
      }
      if (committed) {
        decision = { id: committed.id, disposition: "fresh" };
      } else {
        throw e;
      }
    }
    if ("error" in decision) return decision;
    if (decision.disposition === "reused") return decision;
    const job = { id: decision.id };
    // BEST-EFFORT: the GenJob is already created + queued (paid path committed) above, so
    // an audit-write failure must NOT throw past here — else the caller returns an error
    // and a retry (esp. a keyless GenSpace direct gen) could enqueue a SECOND paid job.
    // Log + swallow. (Keyed callers dedupe on retry; keyless ones must not even reach here.)
    try {
      await prisma.actionEvent.create({
        data: { id: newId(), ownerId, projectId, type: "gen.start", payload: { jobId: job.id, shotId: shotId ?? null, count } },
      });
    } catch (e) {
      console.warn(`startGen: gen.start audit write failed for job ${job.id} (non-fatal):`, e instanceof Error ? e.message : e);
    }
    revalidatePath("/", "layout");
    return { id: job.id, disposition: "fresh" };
  });
}

/** Resolve active capabilities and exact quote metadata server-side. The browser receives
 * opaque control ids; startGen translates them back before the existing validation/price path. */
export async function getActiveGenModels(): Promise<ActiveGenModels> {
  const imageModel = activeImageModel();
  const videoModel = activeVideoModel();
  const defaults = videoDefaults(videoModel as GenVideoModel);
  const videoOpts = GEN_VIDEO_MODEL_OPTIONS[videoModel as GenVideoModel];
  // #645 T4:整张按秒价目表,由**收费函数本人**逐档算出来 —— 选择器显示的每一个数字都
  // 是 startGen 到时会预扣的那个数字,不是界面另算的一份。
  const videoCreditsBySpec: Record<string, number> = {};
  for (const resolution of videoOpts.resolutions) {
    for (const seconds of videoOpts.durations) {
      videoCreditsBySpec[`${resolution}:${seconds}`] = displayCredits(pricedGenCredits({
        kind: "VIDEO",
        model: videoModel,
        count: 1,
        videoOptions: { seconds, resolution },
      }));
    }
  }
  return {
    videoDurations: [...videoOpts.durations],
    videoResolutions: [...videoOpts.resolutions],
    videoI2vDefaultAspect: videoDefaults(videoModel as GenVideoModel, { hasSourceImage: true }).aspectRatio,
    videoCreditsBySpec,
    image: publicModelAlias("image", imageModel),
    video: publicModelAlias("video", videoModel),
    imageCredits: displayCredits(pricedGenCredits({
      kind: "IMAGE",
      model: imageModel,
      count: 1,
      videoOptions: null,
    })),
    videoCredits: displayCredits(pricedGenCredits({
      kind: "VIDEO",
      model: videoModel,
      count: 1,
      videoOptions: null,
    })),
    videoDefaults: defaults,
    videoAspectRatios: [...GEN_VIDEO_MODEL_OPTIONS[videoModel as GenVideoModel].aspectRatios],
    imageAspectRatios: [...GEN_IMAGE_MODEL_OPTIONS[imageModel as GenModel].aspectRatios],
    imageDefaultAspect: imageDefaults(imageModel as GenModel).aspectRatio,
  };
}

/** Poll a gen job + return its produced generations' image URLs when DONE. */
export async function getGenJob(jobId: string, projectId?: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const job = await prisma.genJob.findFirst({
    where: { id: jobId, ownerId, ...(projectId ? { projectId } : {}) },
  });
  if (!job) return null;
  let urls: string[] = [];
  if (job.generationIds.length) {
    const gens = await prisma.generation.findMany({
      where: { id: { in: job.generationIds }, ownerId, ...(projectId ? { projectId } : {}) },
      include: { asset: true },
    });
    // return urls in the order the worker produced them — findMany order is the
    // DB's, so a multi-image batch would otherwise come back shuffled
    const byId = new Map(gens.map((g) => [g.id, g]));
    urls = job.generationIds
      .map((gid) => byId.get(gid))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext)));
  }
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: sanitizeUserError(job.error),
    urls,
    generationIds: job.generationIds,
    spent: job.spent,
  };
}

/** Recent gen results for a project, newest first. Gen space rehydrates its result
 *  list from this on mount — the panel is client-state, so navigating to another
 *  surface (or a reload) would otherwise lose finished generations from view (they
 *  stay in Assets, but the user expects them in the gen panel too). */
export async function getRecentGenResults(projectId: string, limit = 12) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) return [];
  const jobs = await prisma.genJob.findMany({
    where: { projectId, ownerId, threadId: null },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, status: true, prompt: true, kind: true, error: true, generationIds: true },
  });
  const ids = jobs.flatMap((j) => j.generationIds);
  const gens = ids.length ? await prisma.generation.findMany({ where: { id: { in: ids }, ownerId, deletedAt: null }, include: { asset: true } }) : [];
  const byId = new Map(gens.map((g) => [g.id, g]));
  return jobs.map((j) => ({
    jobId: j.id,
    status: j.status,
    prompt: j.prompt,
    kind: j.kind === "VIDEO" ? ("video" as const) : ("image" as const),
    error: sanitizeUserError(j.error),
    urls: j.generationIds
      .map((gid) => byId.get(gid))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext))),
  }));
}
