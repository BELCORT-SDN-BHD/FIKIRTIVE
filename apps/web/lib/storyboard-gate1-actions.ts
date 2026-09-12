"use server";
/**
 * storyboard-gate1-actions — 闸②(视频子卡)的 $0 铸卡层 + sync 权威状态回执。
 *
 * FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 闸①(首帧图那一步:
 * `prepareStoryboardFirstFrames` / `regenShotFirstFrameCard` / `mintChild`)已随「首帧合成
 * 全退场」整段报废删除。文件仍叫 gate1-actions 只是历史文件名(见 PR #1394 的报废物清单);
 * 现在文件里剩的只有闸②(视频子卡铸卡)与 sync —— 每一镜从此**只有一步**:@ 到的元素(演员
 * /商品)各作一张 `reference_image`,直接铸视频子卡、直接出片,不再为任何镜头合成首帧图。
 *
 * 为 STORYBOARD_CARD 的每个"缺视频"镜头铸一张子 GEN_CARD(定价走 buildProposeCard,
 * 与普通 propose 同一条路),并把子卡 id 登记回父卡的 shot.videoCardId。
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
 * 并发防线(修复轮 v2, NODE-282①):本文件三个 RMW 事务(prepare / regen / sync)在事务内
 * 第一步先取卡级 pg_advisory_xact_lock(cowork-actions.ts:180 与 gen-actions.ts:118 的同款
 * 家法),同一张父卡的写者严格串行 —— 两个并发 prepare 不可能都看到空指针而各铸一张可扣费
 * 子卡;后到者锁后重读到新指针,走复用分支,零双铸。
 *
 * 数据流规则(微修轮 v5, NODE-282-R4①):锁前计算的任何值不得流入写路径 —— 模型配置
 * (resolveDisabledModels)、owned-entity 集、threadId、OttoContext 一律在取锁之后按锁内
 * 重读的 fresh payload 重新派生(完备对照表见 PR #282 v5 说明)。锁前读仅剩三类:身份
 * (session ownerId / 不可变主键 card.id=锁主体;行活性**含 thread 活性**由锁内 fresh
 * guard 复核 —— fresh 查询带 live-thread 关系过滤,thread 在等锁期间失活=与卡消失同形
 * fail-closed,v6/R5①)、zod 入参、只读预检(其拒绝路径零写)。
 *
 * 锁后读经 tx(v6, R5③):childJobFor / ownedEntitiesFor / firstGenerationIdOf
 * 均接收调用方的 tx,锁内读真正跑在被锁事务里。resolveDisabledModels 是跨文件的全局
 * 配置读(非卡状态,不受卡锁覆盖)——按锁后时点调用,连接归属与其一致性无关,如实陈述。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { newId, storageKey, storageKeyToSrc, suggestModel, generationUnavailableMessage, cardQuoteVersion, generationReferenceScope, REFERENCE_IMAGE_EXTS, GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel, type ApprovedEntity } from "@fikirtive/core";
import { buildProposeCard, ProposeRefusal, mediaReferenceReceipt } from "@fikirtive/otto";
import type { OttoContext, StoryboardCardPayload } from "@fikirtive/otto";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { resolveDisabledModels } from "./model-registry";
// #782 r11(判官 r10):卡面的状态词表就是**这里**回传的那一份 —— 两侧共用同一组类型,
// 客户端不再有第二套「从 payload 形状推断服务端真相」的规则。类型只在编译期存在,
// 不构成 "use server" 的运行时导出(严禁再导出子句 —— 见 #741 的构建事故)。
import type { MediaRef, ShotMediaReport, ShotMediaSyncReport } from "./storyboard-card";
// #782 r15(判官 r14 P1):子卡作业的判定与卡锁搬进 @fikirtive/otto —— 编辑的三个执行器
// (人工 server action、Otto skill、这里的 prepare/regen)问的必须是**同一个**问题,而
// packages/otto 够不着 apps/web。语义一格未动,这里只是改成从共同权威导入。
import {
  lockCardTx,
  childJobFor,
  firstGenerationIdOf,
  isExhausted,
  isUnconsumedInFlight,
  JOB_DEAD_STATUSES,
  JOB_LIVE_STATUSES,
} from "@fikirtive/otto";
import type { PrismaTx } from "@fikirtive/otto";

export type ChildFrameCard = {
  shotId: string;
  childCardId: string;
  estimatedCredits: number;
  structuredPrompt: string;
  entityIds: string[];
  /** FSE-012(creation-engine.md §5 :170)—— 这张子卡此刻那份报价的版本(`cardQuoteVersion`)。
   *  分镜确认框也是一张确认卡:商家按下 "Generate all" 时把它交回去,服务端拿库里那张卡再算
   *  一次,对不上就拒绝并交回新报价。子卡的完整 payload 从不下发给浏览器(型号是供应商机密),
   *  所以这一串只能在**服务端铸卡的这一刻**算好、随子卡一起交上去。 */
  quoteVersion: string;
  /** 子卡是否已"花过钱":已有 genJobId,或已存在其 cowork:<id> 幂等 job。UI 据此跳过已扣费的。 */
  spent: boolean;
};

type Err = { error: string };
type Shot = StoryboardCardPayload["shots"][number];

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

/** 该 owner 拥有的 entity id(对齐 buildOttoContext / propose-pack 的取法)。空输入不查库。
 *  v6(R5③):经调用方 tx 读,锁内调用真正跑在被锁事务里。 */
async function ownedEntitiesFor(tx: PrismaTx, ownerId: string, entityIds: string[]): Promise<ApprovedEntity[]> {
  if (entityIds.length === 0) return [];
  // #774 判官 r2 P1:名字与类型跟归属**同一趟**读出来 —— 子卡上冻结的就是这一刻的身份,
  // 引擎认人那几句机器指令以后只认它,不会在付费调用前再读一次活名称。
  return tx.entity.findMany({
    where: { id: { in: entityIds }, ownerId, deletedAt: null },
    select: { id: true, type: true, name: true },
  });
}

// PR #1417 判官 P1-C / P3-1 —— 「这一张分镜卡上哪几镜直接出片」的 `directToVideoShotIds`
// 整段报废删除:它上面 PR #1394 登记过的两个用途(驱动接续/continuity 传帧、把
// `directToVideo` 答案报给卡面)都已在这一轮同 PR 收敛 —— 前者是判官 P1-C 判定的数学上
// 不可达代码(下面 `syncStoryboardMedia` 的接续段整段删除),后者是判官 P1-B 判定的死
// 用途(卡面不再等服务端确认「这一镜直不直接出片」,FSE-208 之后这本来就是一个恒真的
// 客户端已知常量,见 `StoryboardCard.tsx` 的 `isDirectToVideo`)。
//
// 它读的 `shotsDirectToVideo`(`apps/web/lib/storyboard-card.ts`)/`shotGoesDirectToVideo`
// (`@fikirtive/core/storyboard-shot`)这条链子本身**没有**在这个 PR 里进一步收敛(判官
// P3-1「无参真值或直接内联删除」那一半仍然成立,未落地)——两个函数眼下零生产调用方,
// 但各自还有测试文件专门钉着它们的行为(`storyboard-card.test.ts`、
// `storyboard-direct-to-video-source.test.ts`),P3 优先级,登记为这个 PR 未做完的收尾,
// 留给下一轮。

/** FSE-208 —— 这一镜的视频要带上路的元素:@ 到的演员与商品各作一张 `role:"reference_image"`。 */
type ShotVideoCast = { entityIds: string[]; owned: ApprovedEntity[] };

/** 拒绝那句话里的**镜头名**。`index` 是 0 基的内部序号,商家数的是第几个镜头,所以 +1。 */
function shotLabel(shot: Pick<Shot, "index" | "title">): string {
  return shot.title ? `Shot ${shot.index + 1} "${shot.title}"` : `Shot ${shot.index + 1}`;
}

/**
 * creation §5 :172④ —— 直接出片这一镜 @ 到的元素**不是这家店活着的元素**时的那句话。
 *
 * 钱一直是安全的:`buildProposeCard` 见到对不上的 id 就抛(FSE-002 口径),异常在事务里抛
 * ⇒ 整份回滚 ⇒ 零子卡、零 GenJob、零账本行。缺的是**说清楚是哪一镜** —— 一张分镜卡上八个
 * 镜头,通用那一句「有一个引用对不上」让商家没法知道该去改哪一格,而整卡 fail closed 的
 * 代价正是其余镜头也一起铸不出来。
 *
 * 点名那件元素只点**这家店自己的**:多读的那一趟仍然带 `ownerId`,所以别人家的行读不出来,
 * 这句话不会变成存在性问答机(同 `EntityReferenceUnavailableError` 的注释)。商家自己删掉的
 * 那件元素名字还在,点出来他才知道该去改哪一格;跨租户/不存在的 id 回落到「一件元素」。
 * 这一趟读**只发生在拒绝那一路**,正路一次多余的查询都没有。
 */
async function assertShotCastResolvable(
  tx: PrismaTx,
  ownerId: string,
  shot: Shot,
  owned: ApprovedEntity[],
): Promise<void> {
  const ownedIds = new Set(owned.map((e) => e.id));
  const missing = (shot.entityIds ?? []).filter((id) => !ownedIds.has(id));
  if (missing.length === 0) return;
  const named = await tx.entity.findMany({ where: { id: { in: missing }, ownerId }, select: { name: true } });
  const what = named.length
    ? `${named.map((e) => `"${e.name}"`).join(", ")}, which isn't in your Library any more`
    : "an element that isn't in your Library any more";
  throw new ProposeRefusal(
    `${shotLabel(shot)} uses ${what} — take it out of that shot, or pick another one. ` +
      "Nothing was made and nothing was charged.",
  );
}

/**
 * creation §5 :178 —— 这一镜挂了哪几张 Library 图(去掉空值、去重,次序即引擎收到的次序)。
 *
 * 老卡没有这一格 ⇒ 空表 ⇒ 下面每一处与这条修改之前逐字相同。
 */
function shotLibraryImageIds(shot: Shot): string[] {
  const raw = Array.isArray(shot.referenceGenerationIds) ? shot.referenceGenerationIds : [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * creation §5 :178(判官 r1 P1-②③⑤)—— 挂的图**没能全部上车**时,停在这里。
 *
 * 引擎的 `image_url` 名额一共只有 9 个(`MAX_VIDEO_IMAGE_PARTS`),而这一镜 @ 到的每个元素先
 * 占 1 格(`videoAttachedCap`)。于是 @ 一位演员 + 一件商品的镜头挂到第 8 张起,`buildProposeCard`
 * 会**默默切掉**多出来的那几张(propose.helpers.ts 的 `cardVideoReferenceIds`)。
 *
 * 聊天那一面这一刀是**说出来**的:`buildReferenceBudgetNotes` 在批准前逐字讲「你挂了 N 张,
 * 只有前 M 张会上路」,而那句话由 `propose.ts` 经 `withReferenceBudget` 并进卡面。分镜铸卡这条
 * 路从不经过那一层 —— 商家在镜头上看着 8 个缩略图、按下 Confirm、付了钱,引擎收到 7 张,卡面
 * 与确认框一个字都没说。那正是 FSE-001/002 那条静默丢弃的形状,只是换了个入口。
 *
 * 分镜这一面没有「卡面披露」这一格可用(子卡的 notes 不下发到分镜卡上),所以诚实的出路只剩
 * 一条:**花钱之前点名拒绝**(CREATE-A2),并说清可以怎么改。判据不在这里另算一份 —— 读的就是
 * `buildProposeCard` 铸出来的那张卡自己那一列(`referenceGenerationIds`),所以「卡上说的」与
 * 「引擎真收的」不可能分家。整卡 fail closed:异常在事务里抛 ⇒ 整份回滚 ⇒ 零子卡、零 GenJob、
 * 零账本行。
 */
function assertShotLibraryImagesAllRide(
  shot: Shot,
  attached: readonly string[],
  riding: readonly string[],
): void {
  if (attached.length === 0 || riding.length >= attached.length) return;
  const extra = attached.length - riding.length;
  const images = attached.length === 1 ? "1 Library image" : `${attached.length} Library images`;
  const fit =
    riding.length === 0
      ? "none of them fit"
      : riding.length === 1
        ? "only 1 of them fits"
        : `only ${riding.length} of them fit`;
  throw new ProposeRefusal(
    `${shotLabel(shot)} has ${images} on it, but ${fit} alongside the cast and products you @mentioned on it. ` +
      `Take ${extra === 1 ? "one" : extra} off that shot, or @mention fewer people and products on it. ` +
      "Nothing was made and nothing was charged.",
  );
}

/**
 * creation §5 :178 —— 把这一镜挂的 Library 图装进这一趟的 ctx(**锁内、按 ownerId 重读**)。
 *
 * 为什么要在这里再读一次:写入那一刻(`setShotReferences`)确实按 ownerId 解析过,但那是过去
 * 的一次判定。图可以在两次之间被删掉、被换主,而这一趟马上就要报价、马上就要花钱 —— 付费前
 * 的每一个事实都必须是**此刻**的事实。判据只有一份 `generationReferenceScope`(同一 owner、
 * 活着、扩展名对得上;画布不是权限边界),六个读者共用它。
 *
 * 跨租户:这一趟 where 带 ownerId ⇒ 别家店的那一行读不出来 ⇒ 走「有一件取不到 ⇒ 点名拒绝、
 * 零写入」,与元素那一条(`assertShotCastResolvable`)同一条口径,而回答不区分「别人家的」
 * 与「你自己删掉的」,所以它当不了存在性问答机。
 *
 * 回执与 id 同一趟读出来:`planCardGate` 把「卡上有 id 却没有回执」判成不可批准,所以铸卡
 * 入口必须两样都造。造回执的口径只有一份(`mediaReferenceReceipt`,@fikirtive/otto)。
 */
async function attachShotLibraryImages(
  tx: PrismaTx,
  ownerId: string,
  shot: Shot,
  ctx: OttoContext,
): Promise<void> {
  const ids = shotLibraryImageIds(shot);
  if (ids.length === 0) return;
  const rows = await tx.generation.findMany({
    where: { id: { in: ids }, ...generationReferenceScope(ownerId, [...REFERENCE_IMAGE_EXTS]) },
    select: {
      id: true,
      projectId: true,
      promptText: true,
      asset: { select: { ownerId: true, contentHash: true, ext: true } },
      project: { select: { name: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (byId.size !== ids.length) {
    throw new ProposeRefusal(
      `${shotLabel(shot)} uses an image that isn't in your Library any more — take it off that shot, or pick another one. ` +
        "Nothing was made and nothing was charged.",
    );
  }
  // 次序照商家挂的次序(`ids`),不是数据库回行的次序 —— 那就是引擎收到参考图的次序。
  const ordered = ids.map((id) => byId.get(id)!);
  ctx.sourceGenerationIds = ordered.map((r) => r.id);
  ctx.mediaReferences = ordered.map((r) =>
    mediaReferenceReceipt({
      generationId: r.id,
      kind: "image",
      prompt: r.promptText ?? "",
      sourceProjectId: r.projectId,
      sourceProjectName: r.project?.name ?? null,
      // 分镜子卡没有「商家此刻这一块画布」这回事(`minimalCtx` 的 projectId 是空的),所以
      // 回执一律**点名它出生的那块画布**,而不是说一句「就是这一块」。少一句方便话,不多
      // 一句可能不成立的话。
      sameCanvas: r.projectId === ctx.projectId,
      asset: r.asset,
    }),
  );
}

/** buildProposeCard 需要的最小 OttoContext(它只读 orgId/threadId/disabledModels 及两个 source 字段)。
 *  source/referenceVideo 留 undefined —— 缺省形状不带起始帧/参考视频。FSE-208 之后每一镜都
 *  直接出片:调用方写 `sourceGenerationIds` + `mediaReferences`(creation §5 :178 的 Library 图,
 *  见 `attachShotLibraryImages`),`sourceGenerationId`(i2v 首帧)那一档不再有人写。
 *
 *  PR #1417 判官 P1-A —— `alwaysVideoReference: true` 是这一格结构性成立的原因:没有它,
 *  零 @ 演员却挂了 Library 图的镜头(纯商品镜头)会被 `videoAttachmentRole` 判成 i2v 首帧
 *  (`startFrame`),而分镜世界里首帧这条路已经整段退场 —— 那一镜会被
 *  `assertShotLibraryImagesAllRide` 拒绝,整张卡铸不出一条视频。挂图在分镜里一律是参考图,
 *  不论这一镜有没有 @ 演员。 */
function minimalCtx(ownerId: string, threadId: string, disabledModels: string[]): OttoContext {
  return {
    orgId: ownerId,
    userId: ownerId,
    projectId: "",
    threadId,
    disabledModels,
    alwaysVideoReference: true,
    sourceGenerationId: undefined,
    referenceVideoGenerationId: undefined,
  };
}

/** The stored fields of an existing video child card, shaped for the reuse comparison. */
type ExistingVideoChild = {
  structuredPrompt?: unknown;
  sourceGenerationId?: unknown;
  model?: unknown;
  params?: { durationSeconds?: unknown };
  entityIds?: string[];
  /** creation §5 :178 —— 这张卡冻结的挂图(`buildProposeCard` 写的那一列)。 */
  referenceGenerationIds?: unknown;
  estimatedCredits?: number;
};

/** 两串 id 逐位相同吗(次序算数 —— 它就是引擎收到参考图的次序)。 */
function sameRefIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** MONEY-CRITICAL reuse rule (SINGLE SOURCE for prepare AND regen): an existing video child
 *  matches the would-be-minted card iff ALL of structuredPrompt + sourceGenerationId +
 *  params.durationSeconds (snapped-vs-snapped) + model agree. A full match means a fresh mint
 *  would produce an identical spend, so reusing the child is exact. `wouldBe` is the pure
 *  buildProposeCard output minting uses (its durationSeconds is the SNAPPED value), so the
 *  comparison never touches the raw shot field (P2: no snap-mismatch churn). */
function videoChildMatches(
  existing: ExistingVideoChild,
  wouldBe: { structuredPrompt: string; sourceGenerationId?: string; model: string; params: { durationSeconds?: number }; referenceGenerationIds?: string[] },
): boolean {
  return (
    existing.structuredPrompt === wouldBe.structuredPrompt &&
    existing.sourceGenerationId === wouldBe.sourceGenerationId &&
    existing.params?.durationSeconds === wouldBe.params?.durationSeconds &&
    existing.model === wouldBe.model &&
    // creation §5 :178 —— 挂图也是这一单的**材料**:换了它,引擎收到的东西就变了,而价钱、
    // 提示词、时长、模型可以一格没动。漏在比对外面,换完挂图再 prepare 一次就会复用那张按
    // 旧图铸的卡 —— 卡面写着新的一组参考,批准之后送出去的是旧的一组。纵深第二道(第一道是
    // `applyEditShotPrompt` 的陈旧级联:换挂图直接把视频子卡指针清掉)。
    sameRefIds(
      Array.isArray(existing.referenceGenerationIds)
        ? existing.referenceGenerationIds.filter((id): id is string => typeof id === "string")
        : [],
      wouldBe.referenceGenerationIds ?? [],
    )
  );
}

/** #647 T6:唯一那台引擎被后台关掉时,分镜给商家的那句人话。
 *  措辞的**单一来源**在 @fikirtive/core(`generationUnavailableMessage`)—— 修复轮 P1-1 起,
 *  四个铸卡入口(Otto propose / proposePack / 分镜闸①② / Make another)共用同一份,
 *  否则同一件事迟早在四个地方说出四种话。 */
const VIDEO_UNAVAILABLE: Err = { error: generationUnavailableMessage("video") };

/**
 * FSE-002 复修轮(判官 2026-09-08 P1-3)—— 铸卡层的**拒绝**在这条路上有人接。
 *
 * `buildProposeCard` 的拒绝一族(`ProposeRefusal`:引擎被关、画幅做不到、镜头点名的元素
 * 对不上这家店)从前在闸① 里没有任何接住它的地方:一个镜头引用了已被删除／已不属于本店的
 * 元素,server action 直接把异常扔出去,商家读到的是一个通用崩溃,而不是这一轮口径承诺的
 * 「显式报错」。
 *
 * 钱一直是安全的(异常在 `prisma.$transaction` 内抛出 ⇒ 整份回滚 ⇒ 零写入、零预扣),缺的
 * 只是那句话。这里把它翻成商家读得懂的一句;措辞的产地仍在 `packages/otto`(每一族拒绝自带
 * 自己的那句),这里一个字都不改写。
 *
 * 别的异常**原样抛出去** —— 吞掉一个不认识的错误只是把静默丢弃搬了个家。
 */
function proposeRefusalAsError(e: unknown): Err {
  if (e instanceof ProposeRefusal) return { error: e.message };
  throw e;
}

/**
 * #647 T6:视频引擎现在还有没有(FSE-208 之后闸① 退场,这里只剩闸② 一种创作)。
 * null = 有,照常走;Err = 没有,调用方原样返回。
 *
 * 判据走的是**铸卡内部同一条** `suggestModel` —— 所以「面板说能做」与「铸卡真做得了」
 * 不可能分家。没有这道闸时,后台关掉引擎之后分镜照旧把子卡落进对话里:每一张都写着
 * credits、点得下去,而点下去必然被 spend 闸打回。卡是 $0 铸的,承诺不是。
 */
function unavailableFor(disabledModels: string[]): Err | null {
  if (suggestModel({ kind: "video", disabled: new Set(disabledModels) })) return null;
  return VIDEO_UNAVAILABLE;
}

/** 闸② 铸卡会选定的视频模型 —— 与 buildProposeCard 内部同一条 selectModel 路径
 *  (suggestModel({ kind:"video", disabled }) → activeVideoModel)。这里复用它,保证
 *  "选项面板给的时长" 与 "铸卡吸附的时长" 出自同一模型,零硬编码。
 *  null = 那台引擎被关掉了(#647 T6)—— 调用方必须给空态,不许接着铸卡。 */
function selectedVideoModel(disabledModels: string[]): GenVideoModel | null {
  const sm = suggestModel({ kind: "video", disabled: new Set(disabledModels) });
  return sm ? (sm.model as GenVideoModel) : null;
}

// ---------------------------------------------------------------------------
// getStoryboardVideoOptions — $0 read: the selected video capability's durations
// ---------------------------------------------------------------------------
//
// Model-driven, zero hardcoding: derive the video model the SAME way minting will
// (suggestModel — the activeVideoModel lock), then return only its durations from
// the shared GEN_VIDEO_MODEL_OPTIONS capability table. A future model swap (activeVideoModel
// change) flows through automatically — no values copied here.

export async function getStoryboardVideoOptions(): Promise<
  { durations: number[] } | Err
> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<
    { durations: number[] } | Err
  > => {

    // #647 T6 修复轮 P1-3:开关读不到 ⇒ 同样不报档位表(不知道能不能做,就别端出一份菜单)。
    const registry = await resolveDisabledModels();
    if ("error" in registry) return registry;
    const disabledModels = Array.from(registry.disabled);
    const model = selectedVideoModel(disabledModels);
    // #647 T6:引擎关掉时不许再报一份根本交付不了的档位表 —— 那是拿一份真的能力表
    // 去装点一个做不到的功能。明说不可用。
    if (!model) return VIDEO_UNAVAILABLE;
    const durations = GEN_VIDEO_MODEL_OPTIONS[model].durations;
    return { durations };
  });
}

/** 铸一张"视频子 GEN_CARD"($0):定价走 buildProposeCard(与普通 t2v propose 同一条路)。
 *  payload 加 storyboardCardId+shotId 回链;genJobId 不写(null)。
 *
 *  FSE-208(creation §5,S5 批量裁决 #1358):每一镜都直接出片 —— 演员与商品的参考照各作
 *  一张 `role:"reference_image"`(`cast`)走纯文生视频,不再有「首帧 i2v」那一档。 */
async function mintVideoChild(
  tx: PrismaTx,
  parent: { id: string; threadId: string },
  shot: Shot,
  ownerId: string,
  ctx: OttoContext,
  cast: ShotVideoCast,
): Promise<ChildFrameCard> {
  const { cardPayload } = buildProposeCard(
    {
      kind: "video",
      structuredPrompt: shot.videoPrompt,
      entityIds: cast.entityIds,
      variantSel: {},
      count: 1,
      desiredDuration: shot.durationSeconds,
    },
    ctx,
    cast.owned,
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
    // FSE-012 —— 交上去的是**刚写进库的这一份 payload** 的版本,不是别处重算的一份。
    quoteVersion: cardQuoteVersion(payload),
    spent: false,
  };
}

// ---------------------------------------------------------------------------
// syncStoryboardMedia — $0 reconcile: write finished gen ids back by shotId
// (frames AND videos), apply the frame-replace cascade, return frame + video urls
// ---------------------------------------------------------------------------


// PR #1417 判官 P1-C —— `FRAME_IMAGE_EXTS` + `inheritFrameFromClip`(#782 闸③ 的接续传帧:
// 把上一镜真实停住的末帧变成下一镜的首帧)整段报废删除。唯一的调用点是下面
// `syncStoryboardMedia` 里 `if (p.continuity === true) {...}` 那一段,而那一段本身随这个
// PR 一起删除(判官原话:`directIds.has(to.shotId)` 恒真让它数学上不可达 —— FSE-208 之后
// 「直接出片」对每一镜都恒为真,接续判据里唯一会跳过的那一支吞掉了全部镜头)。后端不可达
// 数据(`GenJob.lastFrameAssetId`、worker 的 `storeLastFrameBestEffort`、`continuity`
// schema 字段本身)不在这个 PR 删除范围 —— 见 PR 描述「残留缺口」一节登记的独立 heavy 任务。

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

/** 一张子卡此刻的采样:那条作业的状态,以及(DONE 时)它交出来的权威产出。
 *  `childCardId` 一起记下来,是为了在事务外用**最终 payload 的指针**复核这份采样还算不算数
 *  (级联把视频键删掉、或指针在同一次事务里换了新的 → 这份采样不属于它,一律不采用)。 */
type ChildJobSample = {
  childCardId: string;
  /** null = 这张子卡背后**没有任何作业**(准备卡从未启动:准备→取消→重开)。 */
  status: string | null;
  producedGenerationId: string | null;
};

/** sync 的返回形状(#782 r11,判官 r10 P1)。
 *
 *  r10 之前这里回的是三格**有损信号**(url 表 + liveFrameShotIds + deadVideoShotIds),客户端
 *  必须拿它们去猜每一格媒体此刻到底怎么了 —— 「作业根本不存在」和「作业活着」长得一模一样
 *  (判官 r10 P2),而重出在途这件事服务端压根没表达过,客户端只能自己拿一个布尔集合记着
 *  (判官 r10 P1 的病根)。
 *
 *  现在每个镜头的每一格媒体各回一个**权威状态**,由 GenJob 状态 + 产出直接算出,替换语义
 *  显式(`previous`)。客户端只做「状态 × 轮询相位」的合成,不再有第二套真相。 */
type SyncResult = {
  payload: StoryboardCardPayload;
  shots: ShotMediaSyncReport[];
};

export async function syncStoryboardMedia(raw: unknown): Promise<SyncResult | Err> {
  const parsed = syncInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<SyncResult | Err> => {
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
    //
    // #782 r11 (判官 r10): 采样时把每张子卡背后那条作业的**状态与产出**原样记下来 —— 这就是
    // 回传给卡面的权威状态的原料。赋值(不是累加)—— 事务体重跑一次也只会得到那一次采样的
    // 结果,不会叠加出幽灵。
    //
    // PR #1417 判官 P1-C / P2-2 —— 首帧对账整段报废之后,「首帧那一格的作业采样」永远没有
    // 数据来源了(见下面 videoWrites 附近的说明);`frame:` 报告对每一镜都只按 payload 上
    // 已有的 `firstFrameGenerationId`/`firstFrameCardId` 直接降级(不带 live 采样),
    // 与「这张子卡背后作业还没起步」的既有降级路径同形 —— 不再需要一个恒为空的 Map。
    let videoSamples = new Map<string, ChildJobSample>();
    const payload = await prisma.$transaction(async (tx) => {
      // Same card-writer serialization: a sync (frame-replace CASCADE drops video keys)
      // racing a prepare/regen RMW could clobber a just-written — possibly already
      // CONFIRMED — child pointer, orphaning a charged card; the next prepare would then
      // mint (and charge) AGAIN for the same shot. Locking makes race == serial semantics.
      await lockCardTx(tx, card.id);
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null, thread: { deletedAt: null, ownerId } },
        select: { payload: true },
      });
      // R3①+R5① fail-closed: the card vanished (deleted / kind changed / payload gone) OR its
      // THREAD died (live-thread relation filter above) between the outer load and the lock →
      // return the null sentinel (ZERO writes); NO fallback to the pre-lock `cur` snapshot.
      // The caller surfaces "Card not found.".
      if (!fresh?.payload) return null;
      const p = fresh.payload as unknown as StoryboardCardPayload;

      // Collect finished VIDEO writes from the FRESH (post-lock) payload: a shot with a
      // videoCardId → resolve its child's DONE generationId; stage a write iff that id exists AND
      // DIFFERS from the shot's current videoGenerationId. FAILED/queued/generating/missing
      // children resolve to null → inert (no write). A write only ever REPLACES the genId value;
      // it never deletes the key. ≤8 shots, so the per-shot lookups are bounded; child/job/result
      // reads are worker-written rows — a job flipping DONE mid-sync is simply picked up by the
      // next sync, inert here.
      //
      // PR #1417 判官 P1-C / P2-2 —— 首帧那一支(`firstFrameCardId` 对账、cascade 级联清视频
      // 指针、#782 闸③ 接续传帧、`inheritBlockWrites` 判词)整段随判官裁定报废删除:闸①
      // (首帧铸造)已经报废,没有任何活路径还会**新写**一个 `firstFrameCardId`,这几段能
      // 碰到的只剩 FSE-208 部署前就已在途的老首帧作业 —— 而这个产品还没有公测用户
      // (founder-launch-status-no-users,2026-08-01),没有真实在途作业需要兜底,留着只会
      // 让「首帧还活着」这句假话继续在代码里说下去。随之一并删除的还有它们仅剩的调用方
      // `directToVideoShotIds`(判官 P3-1,死用途收敛 —— 它剩下的两个用途,驱动接续判据、
      // 报 `directToVideo` 答案给卡面,都已随这一轮收敛掉)与 `inheritFrameFromClip`
      // (#782 闸③本体)。后端不可达数据本身(`GenJob.lastFrameAssetId`、
      // `continuity` schema 字段)不在这个 PR 删除范围,见 PR 描述「残留缺口」登记。
      const videoWrites: Record<string, string> = {}; // shotId → new videoGenerationId
      const videos = new Map<string, ChildJobSample>();
      for (const shot of p.shots) {
        if (shot.videoCardId) {
          const job = await childJobFor(tx, shot.videoCardId, ownerId);
          const genId = job?.status === "DONE" ? await firstGenerationIdOf(tx, job, ownerId) : null;
          videos.set(shot.shotId, {
            childCardId: shot.videoCardId,
            status: job?.status ?? null,
            producedGenerationId: genId,
          });
          if (genId && genId !== shot.videoGenerationId) videoWrites[shot.shotId] = genId;
        }
      }
      videoSamples = videos;

      // Nothing staged → pure read: return the fresh payload, no DB write.
      const hasStaged = Object.keys(videoWrites).length > 0;
      if (!hasStaged) return p;

      const nextShots = p.shots.map((s) => {
        const videoGen = videoWrites[s.shotId];
        if (!videoGen) return s;
        return { ...s, videoGenerationId: videoGen };
      });
      const next = { ...p, shots: nextShots };
      await tx.chatMessage.update({
        where: { id: card.id },
        data: { payload: next as unknown as Prisma.InputJsonObject },
      });
      return next;
    });

    if (payload === null) return { error: "Card not found." }; // R3① fail-closed surface

    // Resolve URLs for EVERY generation this answer could mention — the genIds the FINAL payload
    // holds (old or just written) plus anything a sampled DONE job produced — via the SAME
    // owner-scoped Generation→asset→storage mechanism. Cascade-dropped video keys are already
    // gone from `payload`, so they naturally contribute no video url.
    const genIds: string[] = [];
    for (const shot of payload.shots) {
      if (shot.firstFrameGenerationId) genIds.push(shot.firstFrameGenerationId);
      if (shot.videoGenerationId) genIds.push(shot.videoGenerationId);
      // creation §5 :178 —— 挂图走同一趟 owner-scoped 解析:同一条 where(ownerId + 活着),
      // 所以卡面画得出来的那几张,一定是这家店此刻真的还有的那几张。
      for (const id of shotLibraryImageIds(shot)) genIds.push(id);
    }
    for (const sample of videoSamples.values()) {
      if (sample.producedGenerationId) genIds.push(sample.producedGenerationId);
    }
    const urlByGenId = await resolveMediaUrls(ownerId, genIds);
    const refOf = (generationId: string): MediaRef => {
      const url = urlByGenId[generationId];
      // a deleted / unresolvable generation → the ref stands, the url is simply absent
      return url ? { generationId, url } : { generationId };
    };

    // #782 r11 (判官 r10) —— 每一格媒体的权威状态,由**最终 payload 的指针**配上这一轮的
    // 作业采样算出。卡面不再需要(也不许)从指针形状去猜任何一件事。
    const shots: ShotMediaSyncReport[] = payload.shots.map((shot) => ({
      shotId: shot.shotId,
      frame: mediaReport(shot.firstFrameGenerationId, shot.firstFrameCardId, undefined, refOf),
      video: mediaReport(shot.videoGenerationId, shot.videoCardId, videoSamples.get(shot.shotId), refOf),
      // PR #1417 判官 P1-B / P1-C —— `directToVideo` 字段整段删除:FSE-208 之后「这一镜
      // 直接出片吗」对每一镜都恒为真,是卡面一眼就知道的编译期常量,不必再等服务端这一趟
      // 才敢确认(旧判据要读 `Entity.type` 才答得出;新世界不必再读)。卡面那一侧的
      // `isDirectToVideo` 已改成同一个恒真常量,见 `StoryboardCard.tsx`。
      // creation §5 :178 —— 这一镜挂着的 Library 图。地址取不到就只回 id(与 `refOf` 同一条
      // 降级:那一件仍然是商家挂上去的,卡面欠他一格可以取下它的入口,不是一句「没有」)。
      libraryImages: shotLibraryImageIds(shot).map(refOf),
    }));

    return { payload, shots };
  });
}

/**
 * #782 r11(判官 r10 的 P1 + P2)—— 一格媒体的权威状态。
 *
 * 输入只有三样:这一镜此刻**落地的产出**、它此刻**指着的子卡**、以及那张子卡背后作业的采样。
 * 输出是一个具名状态 + (替换形状下)商家仍然拥有的旧产出。这里回答的每一件事,以前都是
 * 卡面自己猜的,而每一次猜错都是判官抓到的一条:
 *
 *   • 子卡在、作业**根本不存在**(准备→取消→重开)→ `absent`,不是「生成中」(判官 r10 P2)。
 *   • 新子卡在途、旧产出还在 → 状态是**新作业**的,`previous` 明说旧的还在(判官 r10 P1:
 *     以前这一格回的是旧的 landed,替换全靠客户端一个枚举外的布尔集合记着)。
 *   • DONE 却指不出任何产出 → **过渡态**,见下面那一段(判官 r12 P1-F1;r11 在这里答
 *     `absent`/旧 `done`,两句都是关于钱的假话)。
 */
function mediaReport(
  landedGenerationId: string | undefined,
  childCardId: string | undefined,
  sample: ChildJobSample | undefined,
  refOf: (generationId: string) => MediaRef,
): ShotMediaReport {
  const landed = landedGenerationId ? refOf(landedGenerationId) : undefined;
  // 采样必须属于**现在这张**子卡:级联删掉视频键、或指针在同一次事务里换了新的,旧采样一律作废。
  const current = sample && childCardId && sample.childCardId === childCardId ? sample : undefined;

  if (!current || current.status === null) {
    // 没有子卡,或那张子卡从未启动过任何作业。落地的东西照旧是商家的。
    return landed ? { status: { kind: "done", ...landed } } : { status: { kind: "absent" } };
  }
  if (JOB_LIVE_STATUSES.has(current.status)) {
    const status = current.status === "QUEUED" ? ({ kind: "queued" } as const) : ({ kind: "generating" } as const);
    return landed ? { status, previous: landed } : { status };
  }
  if (JOB_DEAD_STATUSES.has(current.status)) {
    return landed ? { status: { kind: "dead" }, previous: landed } : { status: { kind: "dead" } };
  }
  // DONE。产出就在这一刻写进了 payload(见上面的 frameWrites/videoWrites),所以两者一致。
  const produced = current.producedGenerationId;
  if (produced) return { status: { kind: "done", ...refOf(produced) } };
  // #782 r13(判官 r12 P1-F1)—— DONE 却指不出任何产出。
  //
  // 这是一行**不该存在**的数据:`generationIds` 与结算是同一笔事务、写在 DONE 之前,所以
  // 「说 DONE」本该蕴含「拿得出东西」(worker 的写入点从 r13 起把它变成不变量,见
  // apps/worker/src/jobs/gen.ts 的零产出闸)。r11 把它折叠成 `absent` 或旧的 `done`,而这四个
  // 词里没有一个能诚实描述它:
  //   • `absent` 在类型里写着「从未启动、一分钱没花」—— 这一格恰恰是钱已经收了;
  //   • 旧的 `done` 说的是「替换成功了」—— 替换其实什么都没交出来;
  //   • `dead` 在卡面上带着「你没有被扣钱」那句话 —— 那是关于商家的钱的假话。
  //
  // 剩下唯一诚实的答复是**过渡态**:我们还没有这一格的答案。它对钱不做任何主张,让卡面继续
  // 问(轮询本来就有上限,到顶会诚实降级成 stale-unknown 并给出手动入口),而 worker 的自愈
  // 巡检会在宽限期内把这一行翻成 FAILED + 退款 —— 那之后这里回的就是如实的 `dead`,单镜救援
  // 入口跟着回来。替换形状下 `previous` 照旧带上:商家此刻仍然拥有旧的那一件,那是真的。
  return landed ? { status: { kind: "generating" }, previous: landed } : { status: { kind: "generating" } };
}

// ---------------------------------------------------------------------------
// prepareStoryboardVideos — 闸②:idempotent $0 mint of missing video children
// ---------------------------------------------------------------------------
//
// FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 闸①(首帧图)已整段报废(见 PR
// #1394 的报废物清单),每一镜都直接出片:owner-scoping, $transaction RMW, reuse-if-fresh,
// seq allocation, ChildFrameCard shape, totalCredits = unspent only, plus:
//  • Eligible = !videoGenerationId(还没出过片的镜头,没有别的前置条件)。
//  • Mint via buildProposeCard kind:"video" —— @ 到的演员/商品各作一张 `role:"reference_image"`
//    (cast),纯文生视频,没有 i2v 起始帧那一档。desiredDuration = shot.durationSeconds。
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
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ children: ChildFrameCard[]; totalCredits: number } | Err> => {
    const { ownerId } = gate;

    const card = await loadCard(parsed.data.cardId, ownerId);
    if (!card) return { error: "Card not found." };

    const children: ChildFrameCard[] = [];
    let cardVanished = false; // R3①: set when the in-lock re-read finds the card gone
    let unavailable: Err | null = null; // #647 T6: 引擎被关 → 零写入 + 诚实空态

    // FSE-001 同族:直接出片那一档带元素上路,所以铸卡层的拒绝(点名的元素对不上这家店)
    // 现在在这扇门后面也可能发生 —— 与闸① 同一条接法:一句人话,零写入(抛出时整份回滚)。
    const refusal = await prisma.$transaction(async (tx) => {
      await lockCardTx(tx, card.id); // NODE-282①: serialize concurrent prepares/regens on this card
      // Re-read the parent payload INSIDE the tx (RMW) so a concurrent edit can't be clobbered.
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null, thread: { deletedAt: null, ownerId } },
        select: { payload: true, threadId: true },
      });
      // R3①+R5① fail-closed: the card vanished (deleted / kind changed / payload gone) OR its
      // THREAD died (soft-deleted / re-owned — the where above carries the live-thread relation
      // filter) between the outer load and the lock → ZERO writes, and NO fallback to the
      // pre-lock `cur` snapshot — a stale snapshot must never drive writes. Caller surfaces
      // "Card not found.".
      if (!fresh?.payload) {
        cardVanished = true;
        return;
      }
      const payload = fresh.payload as unknown as StoryboardCardPayload;

      // R4① dataflow rule: model config derived AFTER the lock (nothing computed pre-lock
      // flows into a write). The per-shot ctx below is built from the FRESH thread id + this
      // in-lock config; the owned-entity read (FSE-001 同族) runs in-lock too.
      // #647 T6 修复轮 P1-3:锁内读开关 —— **读不到就当场退出**(零写入)。
      // 旧版把 DB 故障翻译成空集合(「什么都没关」),于是开关成了一个查询一抖就自动打开的锁。
      const registry = await resolveDisabledModels();
      if ("error" in registry) { unavailable = registry; return; }
      const disabledModels = Array.from(registry.disabled);
      // #647 T6:读到了,接着问这一类创作还有没有引擎。没有同样当场退出:零子卡、一句人话。
      unavailable = unavailableFor(disabledModels);
      if (unavailable) return;
      const parent = { id: card.id, threadId: fresh.threadId };
      // FSE-208 —— 每一镜的视频参考都是 @ 到的元素(演员/商品)。一趟 owner-scoped 读,锁内。
      const allEntityIds = [...new Set(payload.shots.flatMap((s) => s.entityIds ?? []))];
      const ownedEntities = await ownedEntitiesFor(tx, ownerId, allEntityIds);

      // Build the next shots array, mutating ONLY videoCardId on target shots.
      const nextShots: Shot[] = [];
      let changed = false;

      for (const shot of payload.shots) {
        // Not eligible: already has a video.
        if (shot.videoGenerationId) {
          nextShots.push(shot);
          continue;
        }

        // Per-shot ctx: no i2v source — every shot goes straight to video (FSE-208).
        const ctx = minimalCtx(ownerId, parent.threadId, disabledModels);
        const cast: ShotVideoCast = {
          entityIds: shot.entityIds ?? [],
          owned: ownedEntities.filter((e) => (shot.entityIds ?? []).includes(e.id)),
        };
        // creation §5 :172④ —— 这一镜带元素上路,而它 @ 到的东西里有一件不是这家店活着的
        // 元素:整卡 fail closed(异常 ⇒ 整份回滚),那句话点名是哪一镜。判在铸卡之前,所以
        // 连暂存写都不会发生。
        await assertShotCastResolvable(tx, ownerId, shot, cast.owned);
        // creation §5 :178 —— 这一镜挂的 Library 图,装进 ctx(它们与演员照坐在同一批
        // `image_url` 名额里,名额与计价沿 `videoAttachedCap` / `referenceBudget` 那份既有口径)。
        await attachShotLibraryImages(tx, ownerId, shot, ctx);

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
            entityIds: cast.entityIds,
            variantSel: {},
            count: 1,
            desiredDuration: shot.durationSeconds,
          },
          ctx,
          cast.owned,
        );
        // creation §5 :178 —— 卡上真会上路的那几张少于商家挂的那几张 ⇒ 花钱之前点名拒绝。
        // 判在**复用比对之前**:比对读的是同一张被截过的卡,放在后面就会复用一张悄悄少带
        // 图的旧卡,而拒绝一次都不会发生。
        assertShotLibraryImagesAllRide(shot, ctx.sourceGenerationIds ?? [], wouldBe.referenceGenerationIds ?? []);

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
          //
          // #782 r5 (判官 r4 P1-②) —— 但**用完了的卡不许复用**。走到这里的镜头一定没有片子
          // (上面的资格闸:`shot.videoGenerationId` 存在就跳过了),所以「作业死了」在这里
          // 的完整含义是:商家为这一镜发起过一次,那一次什么都没交付,预扣也已经退回。把这
          // 张卡当「已交付」端回去,客户端会把它过滤掉、一次生成都不会发;真发了也只会拿回
          // 那条死作业的 id。于是上一镜永远没有片子,下一镜按守卫永远等下去 —— 判官 r4 的
          // 第二条 P1。出路是往下走去铸一张新卡(新幂等域),与单镜重出按钮同一条路。
          if (existing && videoChildMatches(ep, wouldBe)) {
            const job = await childJobFor(tx, existing.id, ownerId);
            if (!isExhausted(job)) {
              const spent = existing.genJobId != null || job !== null;
              children.push({
                shotId: shot.shotId,
                childCardId: existing.id,
                estimatedCredits: typeof ep.estimatedCredits === "number" ? ep.estimatedCredits : 0,
                structuredPrompt: typeof ep.structuredPrompt === "string" ? ep.structuredPrompt : shot.videoPrompt,
                entityIds: Array.isArray(ep.entityIds) ? ep.entityIds : [],
                // FSE-012 —— 同上。
                quoteVersion: cardQuoteVersion(existing.payload),
                spent,
              });
              nextShots.push(shot);
              continue;
            }
          }
          // Missing, any mismatch (genuinely stale inputs), or EXHAUSTED (r5) → mint a
          // replacement (pointer swap below).
        }

        // Mint a fresh video child for this shot (no child, or a real mismatch).
        const child = await mintVideoChild(tx, parent, shot, ownerId, ctx, cast);
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
    }).then((): Err | null => null).catch(proposeRefusalAsError);

    if (refusal) return refusal; // FSE-001 同族:铸卡层拒绝 ⇒ 零写入 + 那一族自己的那句话
    if (cardVanished) return { error: "Card not found." }; // R3① fail-closed surface
    if (unavailable) return unavailable; // #647 T6 fail-closed surface
    const totalCredits = children.filter((c) => !c.spent).reduce((sum, c) => sum + c.estimatedCredits, 0);
    return { children, totalCredits };
  });
}

// ---------------------------------------------------------------------------
// regenShotVideoCard — stage a replacement video child for one shot ($0)
// ---------------------------------------------------------------------------
//
// I1 semantics: the OLD video stays valid until the NEW one actually lands. This
// action ONLY swaps `videoCardId` to the replacement child and NEVER touches
// `videoGenerationId` — the old video survives until sync overwrites the genId
// when the new clip is DONE. Cancel (client-side) is a true no-op.
//
// FSE-208(creation §5,S5 批量裁决 #1358)—— 没有首帧这个前置条件了:每一镜都直接出片,
// @ 到的演员/商品各作一张 `role:"reference_image"`。Mint via the SAME mintVideoChild
// path prepare uses, desiredDuration = shot.durationSeconds. Reuse-if-fresh (shared
// videoChildMatches rule) reuses an UNSPENT matching child so repeated open/cancel
// can't orphan $0 cards; a SPENT child → mint fresh (explicit user redo).

export async function regenShotVideoCard(
  raw: unknown,
): Promise<{ child: ChildFrameCard } | Err> {
  const parsed = regenInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ child: ChildFrameCard } | Err> => {
    const { ownerId } = gate;

    const card = await loadCard(parsed.data.cardId, ownerId);
    if (!card) return { error: "Card not found." };

    // Read-only pre-check (rejection path writes nothing); the mint path re-finds and
    // re-validates the target on the FRESH payload inside the lock.
    const cur = (card.payload ?? {}) as StoryboardCardPayload;
    const target0 = cur.shots.find((s) => s.shotId === parsed.data.shotId);
    if (!target0) return { error: "That shot no longer exists." };

    let child: ChildFrameCard | null = null;
    let cardVanished = false; // R3①: set when the in-lock re-read finds the card gone
    let unavailable: Err | null = null; // #647 T6: 引擎被关 → 零写入 + 诚实空态

    const refusal = await prisma.$transaction(async (tx) => {
      await lockCardTx(tx, card.id); // NODE-282①: serialize concurrent prepares/regens on this card
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "STORYBOARD_CARD", deletedAt: null, thread: { deletedAt: null, ownerId } },
        select: { payload: true, threadId: true },
      });
      // R3①+R5① fail-closed: the card vanished (deleted / kind changed / payload gone) OR its
      // THREAD died (soft-deleted / re-owned — the where above carries the live-thread relation
      // filter) between the outer load and the lock → ZERO writes, and NO fallback to the
      // pre-lock `cur` snapshot — a stale snapshot must never drive writes. Caller surfaces
      // "Card not found.".
      if (!fresh?.payload) {
        cardVanished = true;
        return;
      }
      const payload = fresh.payload as unknown as StoryboardCardPayload;

      // R4① dataflow rule: model config + thread id derived AFTER the lock (nothing computed
      // pre-lock flows into a write).
      // #647 T6 修复轮 P1-3:锁内读开关 —— **读不到就当场退出**(零写入)。
      // 旧版把 DB 故障翻译成空集合(「什么都没关」),于是开关成了一个查询一抖就自动打开的锁。
      const registry = await resolveDisabledModels();
      if ("error" in registry) { unavailable = registry; return; }
      const disabledModels = Array.from(registry.disabled);
      // #647 T6:读到了,接着问这一类创作还有没有引擎。没有同样当场退出:零子卡、一句人话。
      unavailable = unavailableFor(disabledModels);
      if (unavailable) return;
      const parent = { id: card.id, threadId: fresh.threadId };

      const target = payload.shots.find((s) => s.shotId === parsed.data.shotId);
      // Vanished mid-flight → no writes; caller returns error below.
      if (!target) return;

      // FSE-208 —— 这一镜的视频参考 = @ 到的元素(演员/商品)。owner-scoped、锁内,与 prepare
      // 同一个判据。
      const ownedAll = await ownedEntitiesFor(tx, ownerId, target.entityIds ?? []);
      const ctx = minimalCtx(ownerId, parent.threadId, disabledModels);
      const cast: ShotVideoCast = { entityIds: target.entityIds ?? [], owned: ownedAll };
      // creation §5 :172④ —— 同 prepare 那条:点名的元素对不上 ⇒ 零写入 + 点名是哪一镜。
      await assertShotCastResolvable(tx, ownerId, target, cast.owned);
      // creation §5 :178 —— 同 prepare 那条:这一镜挂的 Library 图装进 ctx。
      await attachShotLibraryImages(tx, ownerId, target, ctx);

      // The WOULD-BE-MINTED card — computed via the SAME pure buildProposeCard call minting
      // uses (mintVideoChild). Single source of truth for the reuse comparison; its
      // params.durationSeconds is the SNAPPED value (never the raw shot field).
      const { cardPayload: wouldBe } = buildProposeCard(
        {
          kind: "video",
          structuredPrompt: target.videoPrompt,
          entityIds: cast.entityIds,
          variantSel: {},
          count: 1,
          desiredDuration: target.durationSeconds,
        },
        ctx,
        cast.owned,
      );
      // creation §5 :178 —— 同 prepare 那条:带不全就不铸卡,理由与出路一起说出来。
      assertShotLibraryImagesAllRide(target, ctx.sourceGenerationIds ?? [], wouldBe.referenceGenerationIds ?? []);

      // Reuse-if-fresh: an existing UNSPENT child that still matches the would-be card → reuse
      // it, do NOT mint (repeated open/cancel would otherwise orphan $0 cards). A spent or
      // mismatched (stale/missing) child → mint fresh (explicit user redo).
      if (target.videoCardId) {
        const existing = await tx.chatMessage.findFirst({
          where: { id: target.videoCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
          select: { id: true, payload: true, genJobId: true },
        });
        const ep = (existing?.payload ?? {}) as ExistingVideoChild;
        if (existing) {
          const reuse = (spent: boolean): ChildFrameCard => ({
            shotId: target.shotId,
            childCardId: existing.id,
            estimatedCredits: typeof ep.estimatedCredits === "number" ? ep.estimatedCredits : 0,
            structuredPrompt:
              typeof ep.structuredPrompt === "string" ? ep.structuredPrompt : target.videoPrompt,
            entityIds: Array.isArray(ep.entityIds) ? ep.entityIds : [],
            // FSE-012 —— 同上:复用那一张的版本也只从库里那份 payload 算。
            quoteVersion: cardQuoteVersion(existing.payload),
            spent,
          });
          const job = await childJobFor(tx, existing.id, ownerId);
          const produced = job?.status === "DONE" ? await firstGenerationIdOf(tx, job, ownerId) : null;
          // #782 r11 (判官 r10 P1 的 kill-shot): 同一次替换只许收一次钱 —— 在途就把在途那一张
          // 端回去,零写入、零新卡。判官钉出的时序(旧片仍在 → Remake 按钮回来 → 再确认一次)
          // 到这里断掉:第二次点击拿回的是第一笔作业,不是第二笔账单。
          if (isUnconsumedInFlight(job, produced, target.videoGenerationId)) {
            child = reuse(true);
            return;
          }
          if (videoChildMatches(ep, wouldBe)) {
            const spent = existing.genJobId != null || job !== null;
            if (!spent) {
              // Child already registered on the shot; nothing to write. No genId touch.
              child = reuse(false);
              return;
            }
            // spent (且不在途:作业已死 / 产出已消费) → fall through to mint a fresh replacement.
          }
        }
        // missing / mismatch → fall through to mint.
      }

      child = await mintVideoChild(tx, parent, target, ownerId, ctx, cast);
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
    }).then((): Err | null => null).catch(proposeRefusalAsError);

    if (refusal) return refusal; // FSE-001 同族:铸卡层拒绝 ⇒ 零写入 + 那一族自己的那句话
    if (cardVanished) return { error: "Card not found." }; // R3① fail-closed surface
    if (unavailable) return unavailable; // #647 T6 fail-closed surface
    if (!child) return { error: "That shot no longer exists." };
    return { child };
  });
}
