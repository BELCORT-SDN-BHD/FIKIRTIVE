/**
 * storyboard-child-job —— 「一张子卡背后那条作业此刻是什么意思」的**唯一**判定处。
 *
 * [#782 r15,判官 r14 P1] 原址 apps/web/lib/storyboard-gate1-actions.ts,一行不改地搬到这里。
 * 搬家的唯一理由:**编辑动作也必须问同一个问题,而编辑有两面**。判官 r14 钉出的时序里,编辑
 * 把一条正在跑的付费视频作业的指针直接删掉 —— 那笔钱的产出从此对父分镜不可达,而 prepare 见
 * 「没产出」就铸新子卡、开出第二笔账。闸① 的重出路径(regenShotVideoCard)早就有正确判定
 * (`isUnconsumedInFlight`),缺它的是编辑路径。
 *
 * 落在这个包里,是因为编辑有**三个**执行器要问同一个问题:人工 server action
 * (apps/web/lib/storyboard-actions.ts)、Otto skill(./skills/edit-storyboard.ts),以及闸①
 * 自己(apps/web/lib/storyboard-gate1-actions.ts)。判定只能有一份,而 apps/web 里的东西
 * packages/otto 够不着 —— 与 `./storyboard-edit.ts`(纯编辑变换)当初迁进来的理由逐字同一条。
 * 那一份是纯的、这一份读库,所以分两个文件,不把 I/O 混进纯变换。
 *
 * 全部只读(`lockCardTx` 只取锁,不写行);owner-scope 由调用方传入的 ownerId 承担。
 * 一分钱不动:这里没有 reserve / settle / refund,只回答「这张子卡此刻算不算在途」。
 */
import { Prisma } from "@fikirtive/db";
import type { StoryboardCardPayload } from "./skills/propose-storyboard.helpers.js";
// #782 r17(判官 r16 P1-1):「这次编辑真的作废了什么」只有一份答案 —— 闸与陈旧级联共用它。
import { editStaleness, type ShotPromptPatch } from "./storyboard-edit.js";

export type PrismaTx = Prisma.TransactionClient;

/** MONEY-CRITICAL serialization (修复轮 v2, NODE-282①): take the card-scoped pg advisory
 *  transaction lock BEFORE the RMW re-read — the SAME house pattern the money path already
 *  uses (cowork-actions.ts:180, gen-actions.ts:118). Under READ COMMITTED, two concurrent
 *  prepares could BOTH read a shot's empty child pointer and EACH mint a chargeable child
 *  (double-mint → each can be confirmed downstream → double-charge). With the lock, writers
 *  on the SAME card serialize: the later transaction blocks until the earlier one commits,
 *  its in-tx re-read then sees the freshly written pointer, and it takes the REUSE branch —
 *  zero double-mint. xact-scoped (auto-released at commit/rollback); every tx takes exactly
 *  ONE lock before any write → no deadlock surface; zero schema change. */
export async function lockCardTx(tx: PrismaTx, cardId: string): Promise<void> {
  const cardLockKey = `card:${cardId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cardLockKey}, 0::bigint))`;
}


/** Read-only: the GenJob behind a child card, whatever state it is in. Prefer the best-effort
 *  `genJobId` link coworkGenerate stamped (cowork-actions.ts:614); fall back to the
 *  durable `cowork:<childId>` idempotency key (mirrors spentOf's read). Never writes.
 *  v6(R5③): reads via the caller's tx — the in-lock sampling truly runs inside the
 *  locked transaction.
 *
 *  #782 r4(判官 r3 P1-b/P3)—— 以前这里叫 doneJobFor,把「出完了」以外的**每一种**状态都
 *  折叠成 null。于是「跑失败了」和「还在跑」和「根本没有作业」在调用点长得一模一样,而这
 *  三件事对商家的意思完全不同(一个要恢复入口、一个要继续等、一个要按钮)。状态带回来,
 *  折叠交给读它的人做。 */
export async function childJobFor(tx: PrismaTx, childCardId: string, ownerId: string): Promise<ChildJob | null> {
  const child = await tx.chatMessage.findFirst({
    where: { id: childCardId, ownerId, kind: "GEN_CARD", deletedAt: null },
    select: { genJobId: true },
  });
  // #782: three more READ-ONLY columns come back — the clip's free last-frame asset and the
  // project/thread it belongs to. They are what gate③ needs to hand that frame to the next
  // shot; nothing here writes, and a job without a tail simply reports null.
  //
  // #782 r5(判官 r4 P1-①):再加 `generationIds` —— 这一列是**商家付了钱换到什么**的权威
  // 记录,它在结算事务里与 settle 一起落库(apps/worker/src/jobs/gen.ts 的 commit marker),
  // 早于 DONE。见 firstGenerationIdOf。
  const select = { id: true, status: true, generationIds: true, lastFrameAssetId: true, projectId: true, threadId: true } as const;
  const job = child?.genJobId
    ? await tx.genJob.findFirst({ where: { id: child.genJobId, ownerId }, select })
    : await tx.genJob.findFirst({ where: { ownerId, idempotencyKey: `cowork:${childCardId}` }, select });
  return job ?? null;
}

export type ChildJob = { id: string; status: string; generationIds: string[]; lastFrameAssetId: string | null; projectId: string; threadId: string | null };

/** 作业**这一生结束了、而且什么都没交付**的两种状态。到了这里就不会再有产出,也不会再有
 *  末帧 —— 与「还在跑」必须分开对待:等一条已经死掉的作业,就是把商家永远钉在「等待中」。
 *
 *  钱的事实(r5 实查,见 `isExhausted`):GenJob 走到这两个状态的每一条路,都在写状态的
 *  **同一个事务里**释放了预扣。所以「死作业」永远等于「商家一分钱没花、也什么都没拿到」。 */
export const JOB_DEAD_STATUSES = new Set(["FAILED", "CANCELLED"]);

/** 作业**还在路上**的两种状态。DONE 不在其中:#782 r5 起,一条 DONE 的作业该交的东西这一刻
 *  就已经交得出来(generationIds 在 DONE 之前落库,见 firstGenerationIdOf),所以「出完了」
 *  是终点,不是「还在跑」。以前把 DONE 也算成在跑,是为了兜住「DONE 已写、GEN_RESULT 还没写」
 *  那一瞬 —— 那个兜底现在由权威回退接手,而它兜得住的是**永远**没写成的情况,不只是一瞬。 */
export const JOB_LIVE_STATUSES = new Set(["QUEUED", "GENERATING"]);

/**
 * #782 r5(判官 r4 P1-②)—— 这张子卡**这一生用完了**。
 *
 * 子卡是钱路的幂等域:每张 GEN_CARD 恰好对应一把 `cowork:<cardId>` 的 once-EVER 键
 * (cowork-actions.ts 的 re-spend guard + DB 唯一索引)。作业一旦落到终态,那把键就烧掉了 ——
 * 再对同一张卡按一次生成,拿回的只会是那条死作业的 id,一次新的出片永远不会发生。
 *
 * 所以「已经花过钱」(spent)不足以描述这张卡:它答的是「这张卡还能不能再启动一次」,而
 * 商家问的是「这一镜还能不能再出一次」。作业死了、预扣退了、这一镜什么都没拿到 —— 那就是
 * 能,而且必须能。出路是**换一张卡**(新的幂等域),正是单镜重出按钮走了很久的那条路;
 * 不发明第二套机制,也一格不动 exactly-once:同一张卡依旧只能启动一次。
 *
 * 反过来,「还没结束」(QUEUED/GENERATING/DONE)一律不算用完 —— 那种情形下重铸就是同一镜
 * 付两次钱,是 P1 kill-shot 当初修掉的那条,这里一个字都不许动。
 */
export function isExhausted(job: ChildJob | null): boolean {
  return job !== null && JOB_DEAD_STATUSES.has(job.status);
}

/**
 * #782 r11(判官 r10 P1 的 kill-shot)—— **一次替换只许收一次钱**。
 *
 * r6 核销过「在途子卡不许再铸新卡」,但那条守卫只覆盖了整包 prepare 的形状。单镜重出走的是
 * 另一条:它把「这张卡已经花过钱」直接读作「商家在显式再做一次」,于是照铸新卡。判官 r10
 * 钉出的时序里,卡面因为旧产出还在而把 Remake 按钮放了回来 —— 商家按下去,同一次替换被收
 * 第二笔钱,而第一笔的产出落地之后没有任何指针指着它(孤儿)。
 *
 * 「在途」在这里是**钱的口径**,不是作业的口径:
 *   • QUEUED / GENERATING —— 显然在途。
 *   • DONE 但产出还没被 payload 消费 —— 也在途:那笔钱已经收了、产出即将落地,这一刻铸新卡
 *     恰好就是把它变成孤儿的那一下。
 *   • FAILED / CANCELLED —— 不在途(预扣已退、什么都没交付),照旧铸新卡救这一镜(r5/r7 资产)。
 *   • DONE 且产出已经落在 payload 上 —— 不在途:那是商家看着一件成品说「再做一个」,
 *     正是重出按钮该做的事,一格不动。
 *
 * 命中时调用方**零写入**,把那张在途子卡原样端回去(spent: true)—— 与 r6 的「返回既有在途
 * 作业」同一条原则,只是扩到了替换这个形状。
 */
export function isUnconsumedInFlight(job: ChildJob | null, producedGenerationId: string | null, landedGenerationId?: string): boolean {
  if (!job) return false;
  if (JOB_LIVE_STATUSES.has(job.status)) return true;
  if (job.status !== "DONE") return false;
  // #782 r13(判官 r12 P1-F1)—— DONE 却指不出任何产出。
  //
  // r11 在这里读作 false = 「不在途」,于是守卫放行、铸新卡、商家再确认一次 = 同一件事收第二
  // 笔钱。可这一格的意思恰恰相反:钱**已经**收了(结算与 generationIds 同一笔事务),而产出
  // 不在 payload 上,所以它一定还没被任何人消费。这是四种情形里最不该开收费入口的那一种。
  //
  // 走到这里本身就说明有一行不该存在的数据(worker 的写入点已经让它不可能再产生),所以这条
  // 分支的职责只有一件:在 reaper 把它翻成 FAILED 之前,一分钱都不许再动。翻成 FAILED 之后
  // `isExhausted` 会照旧放行铸新卡 —— 单镜救援那条路一格没少。
  if (producedGenerationId === null) return true;
  return producedGenerationId !== landedGenerationId;
}

/**
 * Read-only: the first Generation id this DONE job produced. Returns null when the job truly
 * produced nothing this side can point at.
 *
 * #782 r5(判官 r4 P1-①)—— **权威是作业行,不是那条聊天消息**。
 *
 * 判官钉出的时序:worker 在结算事务里写下 generationIds(与 settle 原子,所以
 * 「有 generationIds」⟺「钱已经收了」)→ 写 DONE → 才 best-effort 追加 GEN_RESULT。最后
 * 那一步是投递,不是记账:它吞掉任何持久化错误(gen.ts 的 appendCoworkResult),而之后的
 * 任何一次重投看到 DONE 会直接返回,没有补写后盾。于是一条消息写失败,分镜就永远读不到
 * 那张图 —— 商家付了钱、Generation 行就在库里、firstFrameGenerationId 永远不写、卡面
 * 转到轮询上限为止。整条接续链断在这里,而这一切没有任何一处出错日志会被商家看见。
 *
 * 所以先读投递(它是商家在对话里真的看见的那一条,两处若不一致以它为准),读不到就回到
 * 作业自己落库的那一行。「付过钱的事实」因此永远可达:投递丢失只影响时延,不影响终局。
 *
 * 调用点已经确认 `job.status === "DONE"` —— 只有到了终点才谈得上「它交出了什么」。
 */
export async function firstGenerationIdOf(tx: PrismaTx, job: ChildJob, ownerId: string): Promise<string | null> {
  const result = await tx.chatMessage.findFirst({
    where: { genJobId: job.id, ownerId, kind: "GEN_RESULT", deletedAt: null },
    select: { payload: true },
  });
  const ids = (result?.payload as { generationIds?: unknown } | null)?.generationIds;
  const delivered = Array.isArray(ids) ? ids[0] : undefined;
  if (typeof delivered === "string" && delivered.length > 0) return delivered;
  // 投递缺席 → 结算时落库的那一行。owner-scoped:这条作业行本身就是按 ownerId 读出来的。
  const committed = Array.isArray(job.generationIds) ? job.generationIds[0] : undefined;
  return typeof committed === "string" && committed.length > 0 ? committed : null;
}


// ---------------------------------------------------------------------------
// #782 r15(判官 r14 P1)—— 编辑不许把付过钱的在途作业变成孤儿
// ---------------------------------------------------------------------------

/** 商家看得懂、而且能照做的那两句(白标、English sentence case)。两个执行器共用同一句话。 */
export const VIDEO_IN_FLIGHT_EDIT_BLOCK =
  "That video is still being made — wait for it to finish, then edit this shot.";
export const FRAME_IN_FLIGHT_EDIT_BLOCK =
  "That first frame is still being made — wait for it to finish, then edit this shot.";

/**
 * 这次编辑要删掉的指针里,有没有一条正指着**付过钱、还没被消费**的作业。有 → 返回该说的
 * 那句话,调用方零写入地退出;没有 → null,编辑照常。
 *
 * 判官 r14 钉出的时序:商家为这一镜的视频付了钱 → 作业在跑(慢相解锁了编辑)→ 商家改一句
 * videoPrompt → 纯变换把 `videoCardId` 删掉。那个指针是这条付费作业与父分镜之间的**唯一**
 * 连线:sync 只沿当前 videoCardId 找作业,所以作业 settle 之后的产出对这一镜永久不可达;
 * 而 prepare 见「没产出、也没指针」就铸一张新子卡 = 新的 `cowork:<childId>` 幂等域,商家
 * 再确认一次 = 同一次替换的第二笔账。
 *
 * 「编辑与 spend 互斥」这句话在两边的注释里写了很久,但服务端从来没有让它成真过。这道闸就是
 * 让它成真的那一格,而且两个执行器(人工动作 / Otto skill)必须共用它 —— 只关一扇门等于没关。
 *
 * 判定复用闸① 的 `isUnconsumedInFlight`,不写第二份:QUEUED/GENERATING 在途;DONE 但产出
 * 还没落到 payload 上(含 DONE-却指不出任何产出)也在途;FAILED/CANCELLED(预扣已退、什么都
 * 没交付)与产出已消费一律放行 —— 单镜救援、以及「看着成品说再做一个」两条路一格没少。
 *
 * 两格媒体各按**这次真的会被删的键**来问 —— 而「真的会被删」这件事由 `editStaleness` 一家说了
 * 算(#782 r17,判官 r16 P1-1)。这一点是承重的:真实 UI 保存时两句 prompt 无条件同发,若把
 * 「字段出现」当「改了」,一次只改视频文字的编辑会去检查、并删掉一张与它无关的付费首帧。
 * 闸问的那一格,必须与级联删的那一格逐字节是同一格 —— 所以两边读同一个函数,不各判各的。
 *
 * 调用方纪律:必须在**同一笔事务**里先取 `lockCardTx`、锁内重读父卡、再调它,最后写。判定与
 * 删指针分成两步跑,就等于给「作业在两步之间落账」留一个窗口。传进来的 shot 必须是**锁内重读**
 * 的那一份 —— 「改没改」是拿父卡当前值比出来的,比错了对象就等于没比。
 */
export async function inFlightPointerBlock(
  tx: PrismaTx,
  ownerId: string,
  shot: StoryboardCardPayload["shots"][number],
  patch: ShotPromptPatch,
): Promise<string | null> {
  const stale = editStaleness(shot, patch);
  if (stale.video && shot.videoCardId) {
    const job = await childJobFor(tx, shot.videoCardId, ownerId);
    const produced = job?.status === "DONE" ? await firstGenerationIdOf(tx, job, ownerId) : null;
    if (isUnconsumedInFlight(job, produced, shot.videoGenerationId)) return VIDEO_IN_FLIGHT_EDIT_BLOCK;
  }
  if (stale.frame && shot.firstFrameCardId) {
    const job = await childJobFor(tx, shot.firstFrameCardId, ownerId);
    const produced = job?.status === "DONE" ? await firstGenerationIdOf(tx, job, ownerId) : null;
    if (isUnconsumedInFlight(job, produced, shot.firstFrameGenerationId)) return FRAME_IN_FLIGHT_EDIT_BLOCK;
  }
  return null;
}

// ---------------------------------------------------------------------------
// #925 —— 父卡不指着的子卡不许开销
// ---------------------------------------------------------------------------

/** 商家看得懂、而且能照做的那句话(白标、English sentence case)。confirm 侧唯一的拒绝话术。 */
export const PARENT_POINTER_STALE_MESSAGE =
  "This shot has changed since you opened it — refresh the storyboard and try again. Nothing was charged.";

/**
 * #925 —— 一张分镜子卡(GEN_CARD,payload 带 storyboardCardId+shotId 回链)此刻还有没有父卡
 * 指着它。有 → null,confirm 照常;没有 → 该说的那句话,调用方零写入地退出。
 *
 * 形状:一张 $0、已 prepare 但从未 confirm 的子卡,其父卡指针被任何路径换掉之后(闸①/闸②
 * 的 prepare 撞见 stale 而铸替换卡、单镜 regen 铸替换卡、编辑因为这张子卡还没起任何作业而
 * 放行删指针——`inFlightPointerBlock` 只挡得住「在途」,挡不住「压根没起过」),一张陈旧
 * 标签页仍然摸得到这张子卡的 id。它自己的结构仍然合法(GEN_CARD、ownerId 对、payload 能过
 * `coworkProposalSchema`),而 `coworkGenerate`→`startGen` 原本只认这一件事,从不回头看父卡
 * 现在还认不认它 —— 这个函数就是补上那一问的**唯一**入口。
 *
 * 判据只有一条,不理会走到这一步的是哪条替换路径:父卡**此刻**的 shots 里,有没有任何一镜
 * 的 firstFrameCardId 或 videoCardId 仍然等于这张子卡的 id。三条已知路径都会让它变否:
 *   • prepare 撞见 mismatch/EXHAUSTED → 铸替换卡,指针换成新子卡的 id;
 *   • 单镜 regen → 同上,指针换成新子卡的 id;
 *   • 编辑放行(#888 的那一格,子卡还没起过任何作业)→ 指针键被整个删掉(不是换,是没了)。
 *   不管指针是被换掉还是被删掉,「现在还指不指着这张子卡」的答案都是「不」,判据统一。
 *
 * 非分镜子卡(普通 propose/canvas/asset 的 GEN_CARD,payload 没有 storyboardCardId)不适用
 * 这条闸 —— 调用方只在读到 storyboardCardId 时才调用,零行为改变。
 *
 * 调用方纪律:必须在**同一笔事务**里(create+reserve 的那一笔 money tx)、在 create 之前调用。
 * 内部先取父卡的卡级 advisory lock(`lockCardTx`,与闸①/编辑的其它父卡写者同一把锁),所以这
 * 次核对与任何并发的指针替换严格串行——核对时看到的就是这笔事务提交时仍然为真的那份指针,
 * 不存在核对与创建之间被插入一次替换的窗口。
 *
 * 只读:不改父卡、不改子卡,一分钱不动。父卡不存在(被删、kind 变了、跨租户)与「有父卡但
 * 指针换了」是同一个答案——都当作「不指着」,fail closed。
 *
 * 单一函数(#925 范围注记):这是父卡指针校验的唯一入口——往后把指针从 payload 提升为数据库
 * 列+约束(#925 范围注记提到的第二步)时,只需要改这一处的实现,不必满仓库找调用点。
 */
export async function assertStoryboardParentPointer(
  tx: PrismaTx,
  ownerId: string,
  storyboardCardId: string,
  childCardId: string,
): Promise<string | null> {
  await lockCardTx(tx, storyboardCardId); // 同一把卡级锁——与 prepare/regen/edit 严格串行
  const parent = await tx.chatMessage.findFirst({
    where: { id: storyboardCardId, ownerId, kind: "STORYBOARD_CARD", deletedAt: null },
    select: { payload: true },
  });
  const payload = parent?.payload as unknown as StoryboardCardPayload | null;
  const stillPointed =
    payload?.shots.some((s) => s.firstFrameCardId === childCardId || s.videoCardId === childCardId) ?? false;
  return stillPointed ? null : PARENT_POINTER_STALE_MESSAGE;
}
