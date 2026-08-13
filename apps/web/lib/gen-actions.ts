"use server";
/**
 * Shot/session generation actions (redesign Gen space). Validate → persist a
 * GenJob → dispatch → poll. The worker resolves conditioning, calls the
 * provider, and writes Generation candidates (optionally bound to a shot).
 */
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { fromPrisma } from "pg-boss";
import { prisma, reserveCredits, InsufficientCredits, SpendCapBlocked } from "@fikirtive/db";
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
  merchantGenFailureMessage,
  videoElementReferencesHonoured,
  approvedEntityDrift,
  parseApprovedEntities,
  type ApprovedEntity,
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
import { outOfCreditsMessage, spendCapBlockedMessage } from "./credit-format";
import { consumeGenerationGate } from "./rate-limit-gates";
// #744 判官 r2 P1 —— 撤销与扣费共用的那把 campaign 锁。它必须由**提交扣费的这笔事务**持有,
// 所以它进到下面的 money transaction 里,而不是包在 startGen 外面(包在外面的话,外层超时先
// 放锁、内层稍后才提交,撤销就能插进中间,落成「已撤销且已扣费」)。
import {
  applyCampaignApprovalGate,
  applyCampaignDispatchVerdict,
  campaignApprovalGateFor,
  campaignApprovalGateRefusal,
} from "./campaign-approval-lock";
import {
  canvasActionKey,
  factoryHistoryDisposition,
  factoryMaterialMatches,
  factoryReusedPrior,
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
  /**
   * #785 判官 r2 P1-a —— 这一趟真正会跑的那个适配器,收不收 @元素的参考照。
   *
   * 界面靠它决定**要不要开口承诺**「Type @ to bring your products and people into the clip」。
   * 这句承诺不能由浏览器自己判断:判据住在服务端(`GENERATION_PROVIDER` 选中的那条路),
   * 浏览器读不到,自己编一个默认值就是又一次「说的与做的失同步」。取不到 ⇒ 界面闭嘴。
   * 与形状菜单、按档价目表同一条规矩:界面只渲染服务端解析出来的事实。
   */
  videoElementReferences: boolean;
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
  // 判据只有一份(#708):`factoryHistoryDisposition` 同时是报价那一侧「这一格会不会收钱」
  // 的依据,所以确认卡说的和这里做的不可能分家。
  const disposition = factoryHistoryDisposition(history, material);
  if (disposition === "conflict") {
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
  // 判据只有一处(#708 修复轮 P2-1):`factoryReusedPrior` 就是 `factoryHistoryDisposition`
  // 里那条「还有一单没结束且没交付」的规则本身,报价那一侧读的也是它 —— 于是「这一趟复用
  // 哪一单」在报价与派发两边不可能给出两个答案。conflict / exact 已在上面返回。
  const stillLive = factoryReusedPrior(history, material);
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
/** #645 T4(判官 r1 P0-2):资产详情页那条付费路的价格绑定,与 Canvas/Otto 同一套
 *  「商家看到的数字是授权的一部分」机制,只是各自的补救话术不同。 */
const TRUSTED_ASSET_REQUESTS = new WeakMap<object, { expectedCredits: number }>();

/** 「你签字的价和现在的价不是同一个」——三条付费路共用这一句的骨架,只有补救动作不同。
 *  price 变更必须在 create/reserve **之前**拒绝,绝不静默按新价扣。 */
function priceChangedError(approved: number, current: number, howToFix: string): string {
  return `The confirmed price changed from ${approved} to ${current} credits. ${howToFix}`;
}
type TrustedCoworkRequest = {
  ownerId: string;
  cardId: string;
  projectId: string;
  threadId: string;
  expectedCredits: number | null;
  /** #774 判官 r4 P1 —— 审批身份的**唯一**来源:服务端刚读出来的那张持久化卡。
   *  与 `expectedCredits` 同一条纪律:商家批准的那份东西由卡说了算,不由调用方说了算。 */
  approvedEntities: ApprovedEntity[];
};
const TRUSTED_COWORK_REQUESTS = new WeakMap<object, TrustedCoworkRequest>();

/** #774 判官 r4 P1 —— 「这一份审批身份就是卡上那一份」的机器判据(逐项逐字,含次序)。
 *  写成函数而不是注释,是因为它是 startGen 唯一放行这个字段的条件。 */
function sameApprovedEntities(a: ApprovedEntity[], b: ApprovedEntity[]): boolean {
  return a.length === b.length
    && a.every((x, i) => x.id === b[i]!.id && x.type === b[i]!.type && x.name === b[i]!.name);
}

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

/**
 * 资产详情页的付费入口(#645 T4,判官 r1 P0-2)。
 *
 * 详情页先把价格显示给商家看,再按那个价扣钱 —— 中间隔着一次网络往返和一个可能开了
 * 很久的面板。价格若在这期间变了(定价调整,或商家自己在同一个面板里把片子从 5 秒改到
 * 12 秒),旧路是「按旧价签字、按新价扣款」。Canvas / Otto / Campaign 三条路都有价格
 * 重核,唯独这条没有,所以这里补上**同一套**绑定:面板把屏幕上那个数字带上,服务端
 * 自己算一遍,不符就在 create/reserve 之前拒绝。
 *
 * 与 Canvas 入口的唯一区别:详情页自己出幂等键(regen-/anim-/edit- 前缀 + 时间戳),
 * 所以这里不代生成键,只做价格绑定。
 */
export async function startAssetGen(raw: unknown): Promise<StartGenResult> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "That generation request is out of bounds." };
  }
  const { expectedCredits, ...request } = raw as Record<string, unknown>;
  if (
    typeof expectedCredits !== "number" ||
    !Number.isFinite(expectedCredits) ||
    expectedCredits <= 0
  ) {
    return { error: "That generation request is out of bounds." };
  }
  const trustedRequest = { ...request };
  TRUSTED_ASSET_REQUESTS.set(trustedRequest, { expectedCredits });
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

  // #774 判官 r4 P1 —— 审批身份与报价同一条纪律:**只从上面这张服务端读出来的卡取**,
  // 调用方随请求提交的同名字段在这里被原样覆盖掉(下面 `startGen` 再核一次身份)。
  //
  // 为什么不能信调用方那一份:这是一个可直接调用的 Server Action。卡上批的是 A,商家
  // 把活行改名成 B,然后直接调这个 Action 交一份写着 B 的「审批快照」—— 漂移闸拿 B 比
  // 活名 B,一路通过,冻进任务行的是 B,worker 照 B 造指令、送去付费引擎,而卡面自始至终
  // 写着 A。「批 A 做 B」就这么经一份伪造快照到达了。卡是商家批准前看过、批准后不可变的
  // 那一份,所以名字只能从它来。
  //
  // 只留这一趟真的 @ 到的那些元素(与 `buildGenRequestFromCard` 同一条口径):卡上有、
  // 这一趟没 @ 的元素不许把名字带进付费提示词。卡上没有这一份(老卡、跨部署)→ 空表 →
  // 字段整个缺席,按既有降级走:worker 照旧编号,只是不写名字。
  const mentioned = new Set(parsed.data.entityIds);
  const cardApprovedEntities = parseApprovedEntities(payload.approvedEntities)
    .filter((e) => mentioned.has(e.id));
  const trustedRequest = {
    ...parsed.data,
    approvedEntities: cardApprovedEntities.length ? cardApprovedEntities : undefined,
  };
  TRUSTED_COWORK_REQUESTS.set(trustedRequest, {
    ownerId: gate.ownerId,
    cardId,
    projectId,
    threadId,
    expectedCredits,
    approvedEntities: cardApprovedEntities,
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
  const trustedAssetRequest = raw !== null && typeof raw === "object"
    ? TRUSTED_ASSET_REQUESTS.get(raw as object)
    : undefined;
  // A caller that owns an approval the merchant can withdraw (campaign confirm) rides one of
  // these on the request. It can only ever REFUSE this dispatch — never authorize one — and it
  // is applied inside the money transaction below, before anything is created or reserved.
  const approvalGate = campaignApprovalGateFor(raw);
  if (raw !== null && typeof raw === "object") {
    TRUSTED_CANVAS_REQUESTS.delete(raw as object);
    TRUSTED_COWORK_REQUESTS.delete(raw as object);
    TRUSTED_ASSET_REQUESTS.delete(raw as object);
  }
  const trustedCanvasKey = trustedCanvasRequest !== undefined;
  const gate = await requireOwner(); if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;
  // #795 — the generation gate, per tenant, per hour. It sits HERE on purpose: after the caller
  // is known (so it counts a tenant and not a shared office address) and before anything is
  // created, reserved or dispatched (so a refusal costs nothing and charges nothing).
  //
  // It is NOT a spend cap — credits are, and they stay the money authority. What credits do not
  // bound is how many jobs, rows and queue messages a stuck client loop can create on its way to
  // running out. See GENERATION_PER_TENANT_PER_HOUR for why the number is what it is.
  if (!(await consumeGenerationGate(ownerId))) {
    // Honest about the wait: the window is an hour, so "a few minutes" would be a promise this
    // cannot keep. It says what happened and that it clears on its own.
    return { error: "You've started a lot of generations in the last hour. Try again a little later." };
  }
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<StartGenResult> => {
    const OWNED = { ownerId, deletedAt: null } as const;
    const parsed = genRequest.safeParse(resolvePublicModelAlias(raw));
    if (!parsed.success) return { error: "That generation request is out of bounds." };
    const { projectId, shotId, sourceGenerationId, tailGenerationId, referenceVideoGenerationId, prompt, entityIds, count, kind, model, durationSeconds, resolution, aspectRatio, fps, audio, idempotencyKey, variantSel, threadId, approvedEntities, coherentSet } = parsed.data;
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

    // #774 判官 r4 P1 —— 审批身份只有一个来源:服务端读出的那张持久化卡。
    // `startCoworkGen` 在把请求交到这里之前,已经用卡上那一份覆盖了调用方提交的字段,
    // 所以走到这里只剩两种合法形状:与卡上那一份逐字相同,或者根本没有这个字段。
    // 剩下的那一种 —— 调用方自带一份没有卡背书的「审批快照」—— 是伪造的审批记录:
    // 画布、资产详情、工厂、Campaign 这些入口没有卡可以背书它,直接调 startGen 更没有。
    // 一律拒,$0(create/reserve/enqueue 都在后面)。
    if (!sameApprovedEntities(approvedEntities ?? [], trustedCoworkRequest?.approvedEntities ?? [])) {
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

    // variantSel picks WHICH reference photos of an @mentioned element this run conditions on
    // (the chosen variant's, or the base ones). It used to be dropped for video, because video
    // was i2v only: the condition lived entirely in the source keyframe and entity photos never
    // rode along. #785 changed that premise — element photos really do reach the video engine —
    // so the map is now kept for both kinds, and the same map feeds the card's disclosure, the
    // guardian and the worker. The shared normalizer only canonicalizes an empty map to absent,
    // matching the worker's `job.variantSel ?? {}` semantics.
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
      // #777:「这几张是一组要连贯的图」是商家授权内容的一部分 —— 批一组图之后再要
      // 一堆散图是**另一个**动作,不是同一个动作的重试。所以它进材料、落快照
      // (`GenJob.imageOptions`),worker 照着快照发请求。收费一格不动。
      coherentSet,
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

    // #785 判官 r2 P1-a —— 商家真 @ 了元素,而这一趟要跑的适配器根本收不了元素照:
    // 在花钱**之前**停住,并说一句他能看懂、能自己解决的话。
    //
    // 为什么必须在这里,而不是只靠适配器那道拒收闸:名额 `conditioningCap` 在这条路上是 0,
    // 于是 worker 一张照片都不会带,适配器看到的是一个普普通通的文生视频请求 —— 它没有理由
    // 拒收,付费请求照发。结果就是商家 @ 了产品与代言人、付了钱,拿回一支跟他的东西毫无关系
    // 的片子,而全程没有一个字提过。适配器那道闸是纵深防御(挡「照片真送出去了」那一路),
    // 挡不住这一路。
    //
    // 判据只有 `videoElementReferencesHonoured` 一处 —— 与界面的承诺、卡面的规格条目、
    // 选片名额同源,所以三者不可能各说各话。
    //
    // 只管 provider 这一维:带首帧/末帧/整段参考视频的那三档名额同样是 0,但那是**场景**
    // 使然,卡面在批准前已经照实说了「一张都不会用上」,商家是知情批准的 —— 那条路不动。
    //
    // 位置:排在所有重放快路之后(与守卫、机型开关同组)。已经受理过的那一单,重放时照旧
    // 拿回它自己的 id —— 配置在中途换了,不该让同一次尝试的答案不再幂等。
    if (kind === "video" && entityIds.length > 0 && !videoElementReferencesHonoured()) {
      return {
        error: "We can't put your products or people into a clip right now — remove the @mentions to make this video, and nothing will be charged.",
      };
    }

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

    // #774 判官 r3 P0 —— 引擎认人那几句机器指令里的名字,只能是商家批准时看到的那个,
    // 而「批准那一刻」永远发生在**这一步之前**。所以这一步一个活名称都不读。
    //
    // 元素名是商家随时能改的自由文本(`updateEntity` 只 trim,不拦句号、换行或整句指令)。
    // 名字若在付费调用前才现读,批准之后改一次名,就能把没过审批的指令送进那次**已经批准
    // 的付费调用** ——「批 A 做 B」。
    //
    // 名字只有一个来源:那张卡上的审批快照(铸卡侧在批准那一刻写在卡上,商家批之前就
    // 看得见;由 `startCoworkGen` 服务端读出、上面那道闸核过身份 —— 走到这里的这一份
    // 不可能是调用方自带的)。这里只做一件事 —— 拿它跟活行**核对**:对不上说明这张卡
    // 承诺的东西已经不是它会做出来的东西,按既有「内容漂移 = 重新批准」语义拒掉,$0
    // (create/reserve 都在后面)。没有快照要核对时,连这一次读都不发生。
    //
    // 没有快照的请求(#774 之前铸的老卡、跨部署、以及不带卡的入口)= 这一趟没有获批的
    // 名字。列保持空,worker 照旧编号、只是不写名字
    // (`Define the product in <Image_1> as <Subject_1>.`)。降级方向是**少一个名字**,
    // 绝不是执行时补一个没人批准过的名字 —— 与 `genRequest.approvedEntities` 的契约
    // (packages/core/src/gen.ts)逐字一致。
    let frozenEntities: ApprovedEntity[] = [];
    if (approvedEntities?.length) {
      const live = await prisma.entity.findMany({
        where: { id: { in: entityIds }, ...OWNED },
        select: { id: true, type: true, name: true },
      });
      const drifted = approvedEntityDrift(approvedEntities, live);
      if (drifted.length > 0) {
        return { error: "One of these elements was renamed since this plan — ask for it again to get a fresh one." };
      }
      frozenEntities = approvedEntities;
    }

    // OPT-6 P2: reject an admin-disabled model BEFORE the spend commit. This is
    // ADDITIVE narrowing — the typed superRefine above stays the authority over
    // which (model,params) may spend; this only subtracts a turned-off model.
    // #647 T6 修复轮 P1-3:开关读不到 ⇒ **不许扣款**。旧版把 DB 故障翻译成空集合
    // (「什么都没关」),于是「库里全禁用 + 查询瞬时失败」这一刻钱照花。结果不明就不前进。
    const registry = await resolveDisabledModels();
    if ("error" in registry) return { error: registry.error };
    if (isModelDisabled(model, registry.disabled)) {
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

    // #645 T4(判官 r1 P0-2):资产详情页那条路带的是普通幂等键,落不进下面 canvas/cowork
    // 的分支,所以它的价格重核在这里 —— 与那两条同一条规矩:**商家看到的数字是授权的
    // 一部分**,对不上就在 create/reserve 之前停住,绝不静默按新价扣。
    if (trustedAssetRequest && trustedAssetRequest.expectedCredits !== displayedCost) {
      return {
        error: priceChangedError(
          trustedAssetRequest.expectedCredits,
          displayedCost,
          "Reopen this image to load the current price, then try again.",
        ),
      };
    }

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
        // FIRST, before the project lock and before anything is created or reserved: the
        // caller's approval gate. Holding it HERE — in the transaction that commits the charge —
        // is what makes "undone but charged" unreachable: the lock is released by the same
        // COMMIT that makes this GenJob visible, so an undo that gets the lock always sees the
        // charge. Any failure throws and rolls this transaction back before create/reserve.
        // Lock order stays campaign → project, so no cycle with the project lock below.
        if (approvalGate) await applyCampaignApprovalGate(tx, approvalGate);
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
          if (locked) {
            // #749 判官 r2 P1 —— 复用也要对签。商家签的若是「这一格新做」,锁内却变成复用,
            // 那已经不是他复核过的那一份交付,停在这里(本来也没扣钱,但结果必须说实话)。
            // `conflict` 那一支不必对签:它零派发零扣费,而交付缩水由上面那道交付面闸负责。
            if (approvalGate && !("error" in locked)) {
              applyCampaignDispatchVerdict(approvalGate, {
                disposition: "reused",
                displayCredits: 0,
                exactReplay: history.some((prior) => prior.idempotencyKey === factoryAttempt.key),
              });
            }
            return locked;
          }
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
              error: priceChangedError(
                trustedCanvasRequest.expectedCredits,
                displayedCost,
                "Refresh Canvas to load the current price, then review and send again.",
              ),
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

        // #749 判官 r2 P1 —— 花钱前最后一道对签,拿的是**上面项目锁里算出的那个判决**:
        // 这一格真是「新做」吗?真会预扣的这个数,不超过商家签名时这一格的数吗?任一不符
        // 就抛出,这笔事务在 create/reserve 之前回滚 —— 零建任务、零预扣、零入队。
        if (approvalGate) {
          applyCampaignDispatchVerdict(approvalGate, {
            disposition: "fresh",
            displayCredits: displayedCost,
            exactReplay: false,
          });
        }

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
            // the right variant — for video too since #785, because its element photos now
            // really reach the engine. Omitted when empty → column stays null (bare gens
            // unchanged).
            ...(material.variantSel ? { variantSel: material.variantSel } : {}),
            // #774:批准那一刻冻结的元素身份。worker 认人只读这一列,不再重读活名称。
            // 不参与幂等材料 —— 改过名的重放不该被判成「换了内容」。空 → 列保持 null,
            // worker 照旧编号,只是不写名字。
            ...(frozenEntities.length ? { approvedEntities: frozenEntities } : {}),
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
      // The approval gate said no (or could not tell). It runs before create/reserve, so this
      // transaction rolled back with nothing created, nothing reserved and nothing queued.
      const gateRefusal = campaignApprovalGateRefusal(e);
      if (gateRefusal) return gateRefusal;
      // #524 — the merchant's own spend cap refused this action inside the reserve, so the
      // tx rolled back with nothing created, reserved or queued. Checked before the
      // out-of-credits arm because SpendCapBlocked is the more specific refusal.
      if (e instanceof SpendCapBlocked) {
        return {
          error: spendCapBlockedMessage(
            displayedCost,
            e.capInternal === null ? null : displayCredits(e.capInternal),
          ),
        };
      }
      // out of credits: the reserve rolled the tx back, so no job was created/queued.
      if (e instanceof InsufficientCredits) {
        return { error: outOfCreditsMessage(displayedCost) };
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
    // #749 判官 r4 —— 钱事务刚落地就让调用方续租(见 CampaignApprovalGate.afterCharge)。
    // 放在这里而不是等下一格:提交之后还有审计写、缓存失效、批次标记、下一格的历史读,
    // 那一段没有硬上限,原本全程拿着一把正在老化的租约。best-effort —— 钱已经落地,这里
    // 再失败也不许把它翻回去。
    if (approvalGate?.afterCharge) {
      try {
        await approvalGate.afterCharge();
      } catch (e) {
        console.warn(
          "startGen: post-charge campaign lease renew failed (non-fatal):",
          e instanceof Error ? e.message : e,
        );
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
    // #785 判官 r2 P1-a:界面承诺 @元素之前先问这一处 —— 与选片名额(`conditioningCap`)
    // 和卡面规格条目读的是**同一个**函数,所以「界面说的」不可能比执行层多说一句。
    videoElementReferences: videoElementReferencesHonoured(),
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
    // #765 — the merchant's own explanation, when this failure has one: what was wrong and
    // what to do about it, in the SAME sentence the conversation posts for the same job.
    // `error` above is an ops string (a provider status line, a reaper's note); this is not a
    // prettier version of it but a separate question — is what the worker persisted one of the
    // sentences this system writes FOR merchants? A whitelist in core answers, so a surface can
    // never turn an internal error into advice by forwarding it.
    guidance: merchantGenFailureMessage(job.error),
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
