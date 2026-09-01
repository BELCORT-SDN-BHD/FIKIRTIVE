/**
 * handleUnderstand — 素材理解三件套的后台执行器(#784)。
 *
 * ── 商家永远不点「分析」──────────────────────────────────────────────────────
 * 这个文件里**没有**任何由商家动作触发的入口。生产者只有 `scanAssetsNeedingUnderstanding`
 * (worker 自己的定时扫描),商家的体感是「Otto 好像认识我的店」。这是票面的设计铁律,
 * 不是实现偏好 —— 任何一个「开始分析」的按钮或 skill 都会破坏它。
 *
 * ── 钱(MONEY-A9,规格 docs/specs/money-engine.md §7.3;2026-09-01 起)──────────────
 * 上一版这里写的是「商家一分钱不付,本文件不 import reserveCredits」。那条铁律**已随 S2
 * 正式废止**:Founder 2026-08-31 裁决「就是用户使用照算」,理解三类成了按件计费的 SKU。
 * 现在这条链路是一条真正的钱路,它的**计费不变量**是下面五条 —— 每一条都由
 * understand.test.ts 的 `MONEY-A9` 那一组钉着,不是靠这段注释声明:
 *
 *   ① **reserve-first,按快照价**。先按行上的 `priceInternalSnapshot`(上传那一刻锁的价,
 *      四则①)预扣,再打供应商。绝不许先出片后收钱 —— 那等于把余额不足变成一笔坏账。
 *   ② **settle 与结果落盘同一个事务**。结算和 DONE 一起提交:分成两步写就有一个窗口,
 *      商家的文件读完了而钱没结(或反过来),而这条链路重投是常态。
 *   ③ **三个崩溃窗全部由 `(orgId, refId)` 的终态查询收口**(reserve 后 / provider 后 /
 *      settle 前)。handler 进门先问台账:已 SETTLE = 这一行结清了;已 REFUND = 上一回合退了,
 *      换一个新 refId 重开一回合;有 RESERVE 没 finalizer = **复用那个 hold**,不重复预扣。
 *      恢复靠的是**问台账**,不是靠记住上次做到哪 —— 崩溃不会让台账失忆。
 *   ④ **快照在建行那一刻就写死**。扫描器建 QUEUED 行时把本段价(和 image 的级联第二段价)
 *      一起锁上 —— 那一刻正是商家看过价目披露、按下上传的那一刻。快照为 null 因此**只可能**
 *      是 A9 迁移之前就已经落在库里的老行(迁移零回填),它们商家上传时没见过任何披露,
 *      永不补收:整条钱路跳过,一格都不碰。新上传的素材没有一件走得进这条免费路。
 *   ⑤ **PAUSED_BALANCE 期间零供应商调用**。余额不够就停在那里等充值(充值事件唤醒 +
 *      扫描器按「余额 ≥ 快照价」捞回),不无限重扫、不打供应商。
 *
 * `refId` 是**回合制**的:首回合 `understanding:<行 id>`,退款之后的新回合
 * `understanding:<行 id>:r<8 位>`,当前回合记在行上的 `moneyRefId`。为什么要换键:
 * `reserve:<refId>` 这个幂等键终身唯一,REFUND 之后同一个 refId 再也 reserve 不了,
 * 而「已退款按余额重新 reserve」是规格明写的恢复路径 —— 换键并把它记在行上,恢复协议
 * 才能确定性地重放。漏在半路的 hold 由本文件的 `reapStaleUnderstandingReservations` 兜底。
 *
 * 每日 $5 那道闸**降格为平台侧保险丝**(不再是「兜住花费」的主力 —— 主力现在是商家的
 * 余额):它改成**预扣式**(#1056),付费调用前先把该 kind 的最坏 token 预加进当日桶、
 * 加完仍在预算内才算挤进去,调用回来再按实际用量校正差额。旧的 check-then-act 在并发 2
 * 下可以双双越线,而一条 SQL 的条件 upsert 不能。
 *
 * ── 暂缓 ≠ 丢弃(这条链路最贵的一条纪律)──────────────────────────────────────
 * 扫描器第 ① 段只找**完全没有理解行**的素材,所以任何一行终态都是一道再也开不了的门。
 * 不跑的原因因此必须分四类,终态跟着分:
 *   · **资源 / 还不知道**(开关关、平台预算见底、这个环境签不出 URL、宽高时长还没探测出来)
 *     ⇒ 行退回 QUEUED,下一轮继续。这类事情明天就不成立了,写成终态等于让商家的素材被
 *     永久忘掉。
 *   · **真终局**(这份字节按预算读不动:视频超时长、图片超像素闸)⇒ SKIPPED。它明天也不会变。
 *   · **我方坏了**(模型 id 不存在、key 不对、schema 被拒)⇒ 重试到上限后 **PAUSED**,
 *     并且报警。文件本身好好的,写 FAILED 就是对商家说一句他没办法反驳的谎话 ——
 *     2026-08-18 的事故正是这个形状:一个没核过的模型 id 让每次调用 404,404 被当成
 *     「这份素材读不了」,于是每个商家的每一份好文件被逐个永久判死,零恢复路径。
 *   · **素材没了**(软删)⇒ **删行**,连 SKIPPED 都不写。软删是可逆的 —— 重传会把同一个
 *     Asset 复活(upsert 清 deletedAt),而 Asset 按 (ownerId, contentHash) 复用,所以
 *     一行删除类的终态会让「删掉再重传」这条商家唯一的自救路径也失效。删行是自愈的:
 *     素材还软删着就没人捞它,真复活了它就是一件「没有理解行」的素材,下一轮正常排上。
 *
 * ── 不重复读 ─────────────────────────────────────────────────────────────────
 * 钱不进商家账本,但**重复的产物一样是缺陷**:同一张菜单读两次会让商家的产品目录里
 * 凭空多出一份。所以幂等是双保险:
 *   ① DB 层 `(ownerId, assetId, kind)` 唯一 —— 扫描器重跑、两个副本同时看到、
 *      pg-boss 重投,落到的都是同一行;
 *   ② 行上的 QUEUED→RUNNING CAS —— 重投时 count===0,直接空转,连供应商都不打。
 *
 * ── 三件套之间的那条线 ────────────────────────────────────────────────────────
 * image-caption 读完如果说「这张图基本上是一整页字」(isDocument),才建 doc-extract 那一行。
 * 先花三分之一分钱判一次,再决定要不要花第二次 —— 菜单最常见的形态就是一张照片,
 * 而给每张产品照都跑一遍 doc-extract 是纯浪费。
 */
import { InsufficientCredits, prisma, refundReservation, reserveCredits, settleCredits } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import {
  UNDERSTAND_QUEUE,
  UNDERSTAND_RETRY_LIMIT,
  UNDERSTANDING_BUDGET_REACHED,
  UNDERSTANDING_CAPS,
  UNDERSTANDING_CLIP_TOO_LONG,
  UNDERSTANDING_IMAGE_TOO_LARGE,
  UNDERSTANDING_INTERRUPTED,
  UNDERSTANDING_METADATA_PENDING,
  UNDERSTANDING_NO_MEDIA_URL,
  UNDERSTANDING_PAUSED,
  UNDERSTANDING_PROVIDER_PAUSED,
  UNDERSTANDING_UNREADABLE,
  UNDERSTANDING_USD_PER_MTOKEN_IN,
  UNDERSTANDING_USD_PER_MTOKEN_OUT,
  UNDERSTANDING_WAITING_FOR_CREDITS,
  assetUnderstandingEnabled,
  newId,
  normalizeNameKey,
  parseDocExtract,
  parseImageCaption,
  parseUnderstandingJson,
  parseVideoQa,
  pricedUnderstandingCredits,
  productRecordData,
  storageKey,
  understandingCostUsd,
  understandingDailyBudgetUsd,
  understandingKindForMime,
  understandingPreflight,
  understandingWorstCaseUsd,
  type UnderstandingKind,
} from "@fikirtive/core";
import {
  createUnderstandingProvider,
  isProviderConfigError,
  isUnreadableMediaError,
  providerConfigError,
  understandingErrorUsage,
  type UnderstandingProvider,
} from "@fikirtive/generation";
import * as Sentry from "@sentry/node";
import { storage } from "../storage.js";
import { sanitizeError } from "../redact.js";

/** 一件素材的 presigned GET 活多久。够供应商拉一次,不够拿去当分发链接。 */
const MEDIA_URL_TTL_SECONDS = 15 * 60;

/**
 * 每一轮扫描最多建/发多少行。这是**节奏**闸,不是成本闸:一个刚导入两千张图的商家会分
 * 很多轮被读完(25 件/分钟),而不是一分钟里全部涌进供应商。
 *
 * 「最终全部会被读到」这句话由 understand.test.ts 里那条多轮推进的用例钉住 —— 断言
 * `take <= 50` 只钉得住这行注释的措辞,钉不住它的主张。
 */
export const UNDERSTAND_SCAN_BATCH = 25;

/**
 * 一行 QUEUED 多久没人动就重发。**不是**清道夫 —— 它只补投递,不改状态:
 * 扫描器建了行、`boss.send` 却失败(进程被 SIGKILL、pg-boss 抖动)时,那一行会静静躺着。
 * 比一次投递的过期窗口宽,免得跟还活着的消息抢。
 */
export const UNDERSTAND_REDISPATCH_MIN_AGE_MS = 10 * 60_000;

/**
 * 一行**被重新排队**的年轻行静置多久就补投(MONEY-A9 判官 P2:唤醒后的入队延迟)。
 *
 * 上面那个 10 分钟窗口按 `createdAt` 算,兜的是「刚建的行,`boss.send` 没成功」。但充值
 * 唤醒走的是另一条形状:Stripe webhook 把 PAUSED_BALANCE 拨回 QUEUED,**没有人发队列消息** ——
 * 于是一个刚上传两分钟就余额不足的商家,充完钱还要再干等到那一行满 10 分钟。同一个形状还有
 * 清道夫退回 QUEUED 的年轻行。
 *
 * 判据换成 `updatedAt`:被拨回 QUEUED 那一刻行就被 touch 过,静置 60 秒(远长于一次正常
 * 投递→消费的往返)还没人动它,就补投一次。重复投递无害 —— QUEUED→RUNNING 的 CAS 让第二条
 * 消息空转,连供应商都不打;而每轮至多 UNDERSTAND_SCAN_BATCH 条,噪声有界。
 * 诚实口径(判官 2026-09-01 复核):扫描器本身 60 秒一轮,唤醒若恰好错过上一轮,下一轮
 * 静置还不满 60 秒 —— 最坏要到再下一轮才命中,≈两个扫描周期(~120 秒),不是字面 60 秒。
 */
export const UNDERSTAND_REQUEUE_MIN_IDLE_MS = 60_000;

/** RUNNING 滞留多久算「worker 崩在半路」。远大于一次请求超时 + 落盘尾巴。 */
export const UNDERSTAND_STALE_MS = 30 * 60_000;

/**
 * 一行 PAUSED(我方配置坏了)多久之后再试一次。
 *
 * 一小时是在两件事之间选的:配置修好之后商家不该等一天,而配置**没**修好时同一行不该
 * 每分钟被反复投出去。
 *
 * 口径说准(判官 P3-1):这是**每一行**的冷却,不是全平台的节流。扫描器每分钟跑一轮,
 * 每轮至多捡 UNDERSTAND_SCAN_BATCH(25)行,所以积压很深时的总量是 25 行/分钟,
 * 而不是「一小时一批 25 行」。真正的花费上限不在这里,在平台日预算那道闸:
 * 404 那类重试是 $0(供应商连图都没看),而 200-空正文那类每次都真的付钱,靠日预算兜住。
 */
export const UNDERSTAND_PAUSED_RETRY_MS = 60 * 60_000;

/** 只理解商家**自己传进来**的东西。GENERATED 是我们自己产的图,读它等于读自己写的字。 */
const UNDERSTOOD_SOURCES = ["UPLOAD", "IMPORT"] as const;

/** 这一刻属于哪个 UTC 日的桶。计量器的分桶键,读写两边共用一个函数。 */
function spendDay(now: Date): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/** 同一个桶键的 SQL 形态(`DATE` 列)。参数化的 `YYYY-MM-DD` + 显式 `::date`,
 *  免得一个 timestamp 参数在 `ON CONFLICT ("day")` 上按别的类型去比。 */
function spendDayKey(now: Date): string {
  return spendDay(now).toISOString().slice(0, 10);
}

/**
 * **预扣一次最坏情况的平台预算**(#1056 的修法,规格 §7.3「预算闸降级+#1056 随修」)。
 *
 * ── 为什么必须是一条语句 ────────────────────────────────────────────────────
 * 上一版是 check-then-act:先 SUM 出「今天花了多少」,再决定打不打供应商。两个副本在同
 * 一刻读到同一个「还没超」,于是**双双**越线 —— 闸门读的是过去,而花钱发生在未来。
 * 这一版把判断和记账压成同一条 `INSERT … ON CONFLICT DO UPDATE … WHERE`:预加之后仍在
 * 预算内才算挤进去,两个副本在同一行上排队,第二个读到的是第一个已经提交的值。
 *
 * ── 记的是最坏情况,不是实际 ──────────────────────────────────────────────────
 * 实际用量要等调用回来才知道,而闸必须在**调用之前**关上。所以先按该 kind 的 token 上限
 * (`UNDERSTANDING_CAPS`)记高,回来再由 {@link correctUnderstandingBudget} 把差额减回去,
 * 没打成供应商的路径由 {@link releaseUnderstandingBudget} 全额退回。净效果和旧的「按实际
 * 记一笔」一样,差别只在**窗口期间**账面是高的 —— 而这正是要的方向:并发时宁可少放行
 * 一件,不可多花一笔。
 *
 * 返回**这一笔记在哪个桶**(`YYYY-MM-DD`),`null` = 没挤进去。返回桶键而不是布尔值,是因
 * 为一趟调用最长 90 秒,跨过 UTC 零点时校正必须回到**当初预扣的那个桶**,否则昨天挂着一笔
 * 最坏情况、今天凭空少一笔。
 *
 * 费率从 `@fikirtive/core` 的钉点传参进来(不在 SQL 里手抄一份数字):改钉点,这道闸当场
 * 跟着变。空日那一支单独判 —— `INSERT` 分支不走 `WHERE`,预算被调到 0(「全停」的合法意图)
 * 时它会放一件进去,而那正是这道闸唯一存在的理由。
 */
export async function tryHoldUnderstandingBudget(
  kind: UnderstandingKind,
  now: Date = new Date(),
): Promise<string | null> {
  const budget = understandingDailyBudgetUsd();
  // 一件都塞不下的预算(含 0 = 全停):空日那条 INSERT 分支没有 WHERE 兜着,只能在这里挡。
  if (understandingWorstCaseUsd(kind) > budget) return null;
  const caps = UNDERSTANDING_CAPS[kind];
  const day = spendDayKey(now);
  const held = await prisma.$executeRaw`
    INSERT INTO "UnderstandingSpendDay" AS d ("day", "inputTokens", "outputTokens", "calls", "updatedAt")
    VALUES (${day}::date, ${caps.maxInputTokens}::bigint, ${caps.maxOutputTokens}::bigint, 0, now())
    ON CONFLICT ("day") DO UPDATE
      SET "inputTokens"  = d."inputTokens"  + EXCLUDED."inputTokens",
          "outputTokens" = d."outputTokens" + EXCLUDED."outputTokens",
          "updatedAt"    = now()
      WHERE ((d."inputTokens"  + EXCLUDED."inputTokens")::float8  * ${UNDERSTANDING_USD_PER_MTOKEN_IN}
           + (d."outputTokens" + EXCLUDED."outputTokens")::float8 * ${UNDERSTANDING_USD_PER_MTOKEN_OUT})
            / 1000000 <= ${budget}`;
  return held > 0 ? day : null;
}

/**
 * 预扣之后的**校正**。`backIn/backOut` 可以是负数(实际比最坏还贵 —— 钉点漂了),
 * 那时这条语句是在**加**,方向是对的:记高不记低。`GREATEST(0, …)` 只为守住表上那条
 * 「不许为负」的 CHECK,正常路径永远碰不到它(减回去的一定不超过刚加进去的)。
 */
async function adjustUnderstandingBudget(
  day: string,
  backIn: number,
  backOut: number,
  callsDelta: 0 | 1,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "UnderstandingSpendDay"
       SET "inputTokens"  = GREATEST(0, "inputTokens"  - ${Math.trunc(backIn)}::bigint),
           "outputTokens" = GREATEST(0, "outputTokens" - ${Math.trunc(backOut)}::bigint),
           "calls"        = "calls" + ${callsDelta},
           "updatedAt"    = now()
     WHERE "day" = ${day}::date`;
}

/**
 * **供应商回过话了** —— 把预扣的最坏情况校正成实际用量,并记上这一笔调用。
 *
 * `usage` 为 null = 调用发出去了但拿不到用量(超时、连接断)。那一笔**不减**:
 * 我们不知道对面有没有开始算钱,而记高只会让今天少读一件,记低会让预算闸对一整类失败变瞎。
 * `calls` 照加 —— 这一趟确实打出去过。
 */
async function correctUnderstandingBudget(
  kind: UnderstandingKind,
  day: string,
  usage: { inputTokens: number; outputTokens: number } | null,
): Promise<void> {
  const caps = UNDERSTANDING_CAPS[kind];
  const actualIn = usage ? Math.max(0, Math.trunc(Number(usage.inputTokens) || 0)) : caps.maxInputTokens;
  const actualOut = usage ? Math.max(0, Math.trunc(Number(usage.outputTokens) || 0)) : caps.maxOutputTokens;
  await adjustUnderstandingBudget(day, caps.maxInputTokens - actualIn, caps.maxOutputTokens - actualOut, 1);
}

/**
 * **一个字都没打出去** —— 预扣全额退回,`calls` 不动。
 *
 * 预扣和供应商调用之间还有几步会中途折返(签不出 URL、余额不足、这一回合被别人接管)。
 * 少一条这样的退回,今天的预算就会被从未发生的调用一点点吃光,而那是所有商家共用的一格。
 */
async function releaseUnderstandingBudget(kind: UnderstandingKind, day: string): Promise<void> {
  const caps = UNDERSTANDING_CAPS[kind];
  await adjustUnderstandingBudget(day, caps.maxInputTokens, caps.maxOutputTokens, 0);
}

/**
 * 今天全平台的理解已经花了多少美元。
 *
 * 预扣式之后这个读数**包含还在飞的那几笔最坏情况**(见 {@link tryHoldUnderstandingBudget}):
 * 窗口期间它偏高,调用一回来就被校正回实际用量。偏高是要的方向 —— 这个读数只被扫描器当
 * 「今天还值不值得派新活」的便宜早退用,而真正的闸是那条条件 upsert。
 *
 * 读的是累加计量器,不是行上那两列的快照 SUM。
 * 数的是**钱**不是行数:`understandingCostUsd()` 是现成的算式,而行数在两头都会错
 * (一次已经计费的失败数成 0,一行三次重试数成 1)。
 *
 * 跨租户 —— 「我们一天最多被账单多少钱」本来就是一个 platform-wide 的问题,
 * 所以它在一个具名系统身份下读,只读、不写。
 */
export async function understandingSpentTodayUsd(now: Date = new Date()): Promise<number> {
  return runAsSystem("understanding-budget", async () => {
    const bucket = await prisma.understandingSpendDay.findUnique({ where: { day: spendDay(now) } });
    return understandingCostUsd({
      inputTokens: Number(bucket?.inputTokens ?? 0),
      outputTokens: Number(bucket?.outputTokens ?? 0),
    });
  });
}

/**
 * 「这件素材的元数据齐了吗」——**扫描器**那一侧的问法(Prisma where 片段)。
 *
 * 和 `understandingPreflight` 是同一条判断的两面:那个是纯函数,回答手上这一行;
 * 这个是查询条件,回答「这一轮该不该把它捞出来」。元数据不齐的素材**根本不进这一轮** ——
 * 不建行、不写任何终态,ingest 的 ffprobe 补上宽高/时长之后的下一轮自然就捞得到。
 * (拦在 handler 里也行,但那要先建一行、再把它退回 QUEUED,每分钟空转一次;
 * 不捞进来是同一个 fail-closed,代价是零。)
 *
 * 已知的饿死口,写明处置:直接上传的元数据由 `redispatchLostIngest` 补投,而那个补投窗口
 * 是 15 分钟到 24 小时(`INGEST_REDISPATCH_MIN/MAX_AGE_MS`)。ffprobe 对某份字节始终失败、
 * 或者 24 小时之内一次都没成功的素材,宽高会永远是 null,于是**永远不会被理解**。
 * 这是刻意选的那一边:那份素材本身完好、商家的任何其它功能都不受影响,损失只是 Otto 不认识
 * 这一件;反过来放行,损失是每一件这样的素材都可能是一次破 1% 的账单,而且我们事前不知道。
 * 要根治得让 ingest 把「探测过但读不出尺寸」和「还没探测过」分开记(Asset 上多一列),
 * 那是 ingest 那一侧的票,不在本票范围内。
 */
const METADATA_READY_FOR_UNDERSTANDING = [
  // 图片:像素闸要宽 × 高。ingest 之前两列都是 null —— 那正是 r2 让 48 MP 图过闸的窗口。
  { mime: { startsWith: "image/" }, width: { not: null }, height: { not: null } },
  // 视频:时长闸要 durationS。null 曾被读成 0 秒,于是任意长度的片都过闸。
  { mime: { startsWith: "video/" }, durationS: { not: null } },
] as const;

/**
 * 上一次报出来的暂缓原因。只在状态**变化**时说话 —— 每分钟一行同样的话不是可观测性。
 *
 * 边沿触发也是**报警**的形状(判官 delta:cap 命中不许运维侧静默)。商家侧安静是对的,
 * 他什么都不用做;但「今天的预算烧完了」是一件必须有人知道的事 —— 上一版它只进 stdout,
 * 而没有人读 worker 的 stdout。日志留着,另外补一条 Sentry:一次暂缓一条,不是每分钟一条。
 */
let pauseNotice: string | null = null;
function noticePause(reason: string | null): void {
  if (reason === pauseNotice) return;
  pauseNotice = reason;
  if (!reason) {
    console.log("[understand] resumed — reading files again");
    return;
  }
  console.log(`[understand] paused — ${reason}. Queued files stay queued.`);
  if (!process.env.SENTRY_DSN) return;
  // 标题按**原因**聚合,金额进 payload:把美元数写进标题,Sentry 会把同一个故障每变一次
  // 数字就开一个新 issue,alert rule 跟着重复轰炸(和 dead-letters 那条同一个理由)。
  Sentry.captureException(new Error("Asset understanding is paused"), {
    tags: { area: "asset-understanding", outcome: "paused-scan" },
    extra: { reason },
  });
}

/**
 * 扫描:哪些素材还没被读过,哪些行还躺在队列外面。
 *
 * 建行**就是**认领:唯一约束让「两个副本同时扫到同一件素材」只可能有一个赢家,输的那个
 * 拿到 P2002 并跳过。所以这个函数返回的行 id 可以直接发进队列,不必再去重。
 *
 * **两道暂缓闸在这一层**:扫描器拦下来的是「还没派出去的活」,行原样留着,下一轮照旧,
 * 连认领都不必发生。总开关每轮读一次(不是启动时读一次)—— 不然「暂停」就是「销毁」:
 * 关掉开关那一小时进来的素材会被逐一写死,再打开也回不来。
 *
 * 但这一层**不是唯一一层**:这里拦不住已经排在队列里的那一批。预算在半路见底时,积压的
 * 消息会继续一条条消费掉,所以 handler 在每一次付费调用之前**再查一次** SUM。两处都要,
 * 少哪一处都有一整类超支跑掉。
 *
 * 跨租户扫描 —— 具名系统身份;逐行的写入各自带自己的租户(两段式,同 #463 其它清道夫)。
 */
export async function scanAssetsNeedingUnderstanding(now: Date = new Date()): Promise<string[]> {
  // 总开关:这一轮不派新活。已经排着的行原样留在 QUEUED,开关打开就继续。
  if (!assetUnderstandingEnabled()) {
    noticePause("the switch is off");
    return [];
  }

  // 平台日预算:今天全平台已经花掉的真实美元。超线 ⇒ 这一轮不派新活,次日自动复位。
  // 已经在队列里的那一批仍会跑完(至多 UNDERSTAND_SCAN_BATCH 件),这是刻意的:
  // 用一次扫描的粒度换掉每一趟都做一次全表 SUM。
  const budget = understandingDailyBudgetUsd();
  const spent = await understandingSpentTodayUsd(now);
  if (spent >= budget) {
    noticePause(`today's platform understanding budget is used up ($${spent.toFixed(4)} of $${budget.toFixed(2)})`);
    return [];
  }
  noticePause(null);

  return runAsSystem("understanding-scan", async () => {
    const ids: string[] = [];

    // ① 还没有任何理解行的素材 —— 建 QUEUED 行。
    const fresh = await prisma.asset.findMany({
      where: {
        ownerId: { not: "" },
        deletedAt: null,
        source: { in: [...UNDERSTOOD_SOURCES] },
        understandings: { none: {} },
        // 只捞我们真的会读的类型。少了这一条,配乐会把队头堵死:音频建不出行,于是它永远
        // 留在候选集里,某个租户最新的 25 件都是音频时,比它们旧的图片一轮都排不上。
        //
        // 同一个 OR 还兼着**闸门的前半段**:元数据没齐的素材这一轮根本不捞
        // (见 METADATA_READY_FOR_UNDERSTANDING —— 那里也写明了已知的饿死口与处置)。
        OR: [...METADATA_READY_FOR_UNDERSTANDING],
      },
      select: { id: true, ownerId: true, mime: true },
      orderBy: { createdAt: "desc" }, // 新传的先认识 —— 商家刚放进来的东西是他此刻在想的
      take: UNDERSTAND_SCAN_BATCH,
    });
    for (const asset of fresh) {
      const kind = understandingKindForMime(asset.mime);
      if (!kind) continue; // 上面的 where 已经滤过一道;这里是第二把锁,不猜、不花钱
      const id = newId();
      const created = await runAsTenant(asset.ownerId, async () => {
        try {
          await prisma.assetUnderstanding.create({
            data: {
              id,
              ownerId: asset.ownerId,
              assetId: asset.id,
              kind,
              status: "QUEUED",
              // ── 锁价就在这一行(MONEY-A9 计费四则①②)────────────────────────────────
              // ① **上传时刻锁价**。这一段是「上传时刻」在代码里的落点:商家把文件放进来,
              //    下一轮扫描就建行,建行**同时**把价写死。结算按这一格,不按结算那一刻现算 ——
              //    积压的队列隔日才跑到、期间调了价,商家付的仍是他上传时看见的那个数
              //    (调价不追溯,A7)。
              //    少了这两列 = 每一行新素材的快照都是 null = 走免费祖父 = **整条收费链路
              //    在生产上一分钱都收不到**,而所有钱路用例照样绿(它们各自喂显式带价的行)。
              // ② **级联第二段一并锁**。看图读完才知道这是一份文档、要再读一次;而那两段价
              //    在上传界面是一次性披露的,所以第二段的价必须冻在同一刻,不按 doc-extract
              //    行建出来的那一刻重新报价。只有 image-caption 会级联,其余两类填 null。
              priceInternalSnapshot: pricedUnderstandingCredits(kind),
              cascadePriceInternal:
                kind === "image-caption" ? pricedUnderstandingCredits("doc-extract") : null,
            },
          });
          return true;
        } catch {
          // 唯一约束:另一个副本/上一轮已经认领过。不是错误。
          return false;
        }
      });
      if (created) ids.push(id);
    }

    // ② 躺着没被投递出去的 QUEUED 行(含 caption 刚刚为菜单建出来的 doc-extract 行)。
    //    `understandings: { none: {} }` 那一段永远看不见它们 —— 素材上已经有行了。
    //
    //    **两条臂,兜的是两种「躺着」**:
    //      · 老行(createdAt 满 10 分钟)—— 扫描器建了行、`boss.send` 却失败的那一类;
    //      · **被重新排队的年轻行**(createdAt 还没满 10 分钟,但 updatedAt 静置够 60 秒)——
    //        充值 webhook 把 PAUSED_BALANCE 拨回 QUEUED、或清道夫把 RUNNING 退回 QUEUED
    //        的那一类。这两条路都**只改状态、不发队列消息**,少了这条臂,一个刚上传就余额
    //        不足的商家充完钱要干等最多 10 分钟才被读到。
    //    重复投递无害:QUEUED→RUNNING 的 CAS 让多余的那条消息空转,一个供应商请求都不发。
    const redispatchCutoff = new Date(now.getTime() - UNDERSTAND_REDISPATCH_MIN_AGE_MS);
    const stranded = await prisma.assetUnderstanding.findMany({
      where: {
        status: "QUEUED",
        OR: [
          { createdAt: { lt: redispatchCutoff } },
          {
            createdAt: { gte: redispatchCutoff },
            updatedAt: { lt: new Date(now.getTime() - UNDERSTAND_REQUEUE_MIN_IDLE_MS) },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: UNDERSTAND_SCAN_BATCH,
    });
    for (const row of stranded) if (!ids.includes(row.id)) ids.push(row.id);

    // ③ 我方配置坏掉时停下来的行 —— **这一段就是那条恢复路径**。
    //    在它之前,配置类失败落的是 FAILED 终态,而扫描器第 ① 段只找「完全没有理解行」的
    //    素材、第 ② 段只找 QUEUED:两段都看不见它,于是一次配置错误 = 商家的素材被永久
    //    忘掉,连重传都救不回来(唯一约束还占着)。配置修好之后这些行必须自己回来。
    const paused = await prisma.assetUnderstanding.findMany({
      where: { status: "PAUSED", updatedAt: { lt: new Date(now.getTime() - UNDERSTAND_PAUSED_RETRY_MS) } },
      select: { id: true, ownerId: true },
      orderBy: { updatedAt: "asc" },
      take: UNDERSTAND_SCAN_BATCH,
    });
    for (const row of paused) {
      // 逐行写入带自己的租户(两段式,同 reapStaleUnderstanding);条件里带 PAUSED,
      // 所以一行刚被别的副本捡走就 count===0,不会被派两次。
      const { count } = await runAsTenant(row.ownerId, async () =>
        prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "PAUSED" },
          data: { status: "QUEUED" },
        }),
      );
      if (count > 0 && !ids.includes(row.id)) ids.push(row.id);
    }

    // ④ **等余额**的行(MONEY-A9 计费四则④)。捞回的判据只有一条:**余额 ≥ 行上的快照价**。
    //    充值那一侧已经有一条即时唤醒(Stripe webhook 把这个租户的 PAUSED_BALANCE 行拨回
    //    QUEUED),这一段是它的兜底 —— 唤醒漏了一次、或者余额是被别的方式补上的(人工发放、
    //    退款回冲),商家的素材照样会自己回到队列。
    //
    //    为什么必须带余额条件而不是像第 ③ 段那样按时间捞:没有它,一个余额为 0 的租户的每
    //    一件素材都会每分钟被捞起来一次、CAS 成 RUNNING、reserve 再失败、再写回
    //    PAUSED_BALANCE —— 规格明写「暂停期间不打供应商、不无限重扫」,而这句 SQL 就是那
    //    句话的执行形态。快照为 null 的老行(免费祖父)根本进不了这个状态,顺手排除掉。
    //
    //    原生 SQL 是因为条件跨了两张表(行上的快照价 vs 账户余额),Prisma 的 where 表达不了
    //    「一列 ≥ 另一张表的一列」。跨租户扫描,逐行写入照旧各自带自己的租户。
    const waitingForCredits = await prisma.$queryRaw<{ id: string; ownerId: string }[]>`
      SELECT u."id", u."ownerId"
      FROM "AssetUnderstanding" u
      JOIN "CreditAccount" a ON a."orgId" = u."ownerId"
      WHERE u."status" = 'PAUSED_BALANCE'
        AND u."priceInternalSnapshot" IS NOT NULL
        AND a."balance" >= u."priceInternalSnapshot"
      ORDER BY u."updatedAt" ASC
      LIMIT ${UNDERSTAND_SCAN_BATCH}`;
    for (const row of waitingForCredits) {
      const { count } = await runAsTenant(row.ownerId, async () =>
        prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "PAUSED_BALANCE" },
          // error 清掉:那句「等 credits」已经不再是真的,而商家读得到它。
          data: { status: "QUEUED", error: null },
        }),
      );
      if (count > 0 && !ids.includes(row.id)) ids.push(row.id);
    }

    return ids;
  });
}

type Row = {
  id: string;
  ownerId: string;
  assetId: string;
  kind: string;
  /** 本行当前计费回合的 refId(`understanding:<id>[:r<n>]`)。null = 还没进过钱路。 */
  moneyRefId?: string | null;
  /** 上传(建行)时刻锁的价(internal credits)。扫描器建行时必写 ——
   *  null **只可能**是 A9 迁移之前就在库里的老行 ⇒ 免费祖父,整条钱路跳过。 */
  priceInternalSnapshot?: number | null;
};

/**
 * 落一个**真终局**:这份素材我们永远不会再读。只有一种情况配得上它 ——
 * 这份字节按我们的预算读不动(视频超时长、图片超像素闸)。这个条件是**内容**的属性,
 * 明天不会变、重传同样的字节也不会变,所以写死它不丢任何东西。
 *
 * 「素材没了」不走这里(它可逆,见 {@link drop});「我们还不知道」也不走这里(见 {@link hold})。
 */
async function skip(row: Row, reason: string): Promise<void> {
  // 终态 ⇒ 上一回合可能还挂着的 hold 必须现在还给商家(MONEY-A9 不变量②的另一半:
  // 没读成的东西不收钱)。正常路径上这里没有 hold —— pre-flight 判在钱步之前;
  // 会有的形状是「上一回合预扣了、暂时性失败退回 QUEUED、素材的字节这一轮变得读不动了」。
  await refundUnderstandingHold(row, row.moneyRefId ?? null, UNDERSTANDING_REFUND_REASON);
  await prisma.assetUnderstanding.updateMany({
    where: { id: row.id, ownerId: row.ownerId },
    data: { status: "SKIPPED", error: reason },
  });
}

/**
 * **暂缓**:这一趟不跑,行退回 QUEUED,下一轮继续。资源类原因专用(开关关、平台预算见底、
 * 这个环境签不出 URL、元数据还没补齐)。写终态才是缺陷 —— 见文件头「暂缓 ≠ 丢弃」。
 */
async function hold(row: Row, reason: string): Promise<void> {
  await prisma.assetUnderstanding.updateMany({
    where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
    data: { status: "QUEUED", error: reason },
  });
}

/**
 * **把这一行删掉** —— 素材已经不在了(软删)。
 *
 * 为什么不是 SKIPPED(r2 就是这么写的,这是一个数据丢失缺陷):Asset 按
 * `(ownerId, contentHash)` 复用,而 upload 的 upsert 在重传时会把 `deletedAt` 清掉
 * **复活同一行**(apps/web/lib/upload-actions.ts)。一行删除类的 SKIPPED 会一直占着
 * `(ownerId, assetId, kind)` 那个唯一键,而扫描器第 ① 段找的是「完全没有理解行」的素材 ——
 * 于是商家删掉再重传,那件素材**永远**不会被读到,而且他看不见、修不了、申诉不了。
 *
 * 删掉行反过来是自愈的:素材还是软删的时候扫描器不捞它(`deletedAt: null`),所以不会
 * 立刻重建;真被重传复活了,它就是一件「完全没有理解行」的素材,下一轮正常排上。
 * 复活那一侧因此**不需要**任何补偿性清理代码。
 *
 * 只删自己刚 CAS 认领的这一行:DONE 的行不经过这里(handler 只处理 QUEUED→RUNNING 赢家),
 * 所以一件素材已经读懂的产物不会被这条路径碰到。
 */
async function drop(row: Row, why: string): Promise<void> {
  // 删行之前先把可能还挂着的 hold 退掉。行没了之后钱侧的兜底清道夫仍然会退它(它扫的是台账
  // 不是行),但那要等一小时;素材已经不在了,商家的 credits 没有任何理由再被锁一小时。
  await refundUnderstandingHold(row, row.moneyRefId ?? null, UNDERSTANDING_REFUND_REASON);
  await prisma.assetUnderstanding.deleteMany({ where: { id: row.id, ownerId: row.ownerId } });
  console.log(`[understand] ${row.id}: ${why} — row removed (re-upload will be read normally)`);
}

/**
 * 落失败。措辞白标(sanitizeError 已经过 provider-secrecy),商家读得懂。
 *
 * `usage` 在供应商已经回过话(200 + 读不出来的产物)时带上 —— 那一趟**钱已经花了**,
 * 不记账,平台日预算就会对一整类失败视而不见。
 */
async function fail(row: Row, message: string, usage?: { inputTokens: number; outputTokens: number }): Promise<void> {
  await prisma.assetUnderstanding.updateMany({
    where: { id: row.id, ownerId: row.ownerId },
    data: { status: "FAILED", error: message.slice(0, 300), ...(usage ?? {}) },
  });
}

/**
 * **可恢复的暂停**:我们自己的请求/配置坏了(模型 id 不存在、key 不对、schema 被拒)。
 * 文件本身没有任何问题,所以这里**不写 FAILED** —— 那是在说文件的坏话,而且是一句谎话。
 *
 * 和 {@link hold} 的差别是那句谎话的另一面:hold 退回 QUEUED,下一分钟就再试一次,配置
 * 坏着的时候那是每分钟一次的无效砸门;PAUSED 停下来等人修,由扫描器第 ③ 段按
 * {@link UNDERSTAND_PAUSED_RETRY_MS} 的节奏捡回来。两者都不是终态,商家的素材一件不丢。
 */
async function pauseForConfig(row: Row, usage?: { inputTokens: number; outputTokens: number }): Promise<void> {
  await prisma.assetUnderstanding.updateMany({
    where: { id: row.id, ownerId: row.ownerId },
    data: { status: "PAUSED", error: UNDERSTANDING_PROVIDER_PAUSED, ...(usage ?? {}) },
  });
}

// ── 钱路(MONEY-A9)────────────────────────────────────────────────────────────

/** 本文件的 REFUND 行上写的标签。台账里一眼能认出「这笔是理解退的」,和 Otto 那条链路
 *  的 `llm-reservation-reaper` 分得开(两条链路的 refId 前缀不同,标签只是第二层可读性)。 */
const UNDERSTANDING_REFUND_REASON = "understanding-terminal-failure";
const UNDERSTANDING_REAPER_REFUND_REASON = "understanding-reservation-reaper";

/** 一行**多久**没 finalize 就算漏了。远大于一次请求超时(90s)+ 重试退避 + 落盘尾巴,
 *  和 Otto 那条链路取同一个数量级 —— 它兜的是同一类事故:进程死在预扣和结算之间。 */
export const UNDERSTAND_RESERVATION_STALE_MS = 60 * 60_000;

/** 这一行现在认哪一个计费回合。免费祖父行(快照为 null)永远返回 null。 */
type MoneyStep =
  /** 预扣拿到了(新扣的,或者复用上一回合还挂着的那个 hold)⇒ 可以打供应商。 */
  | { verdict: "held"; refId: string }
  /** 计费前的老行 ⇒ 整条钱路跳过,照常读完(四则④的免费祖父)。 */
  | { verdict: "free"; refId: null }
  /** 台账说这一行已经结清了 ⇒ 这是一次重投,不许再打供应商、也不许再收一次钱。 */
  | { verdict: "settled"; refId: string }
  /** 这一回合被别人接管了(条件写 0 行)⇒ 让位,什么都别做。 */
  | { verdict: "raced"; refId: string | null }
  /** 余额不够 ⇒ PAUSED_BALANCE,等充值。 */
  | { verdict: "no-credits"; refId: string };

/** 并发撞上 `reserve:<refId>` 那个终身唯一键。**不是错误**:它证明 hold 已经在了。 */
function isDuplicateReserve(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * **进门第一件钱事**:让这一行处在「有一个属于它的、还没 finalize 的 hold」的状态。
 *
 * 这个函数就是规格 §7.3 那段**重投恢复协议**的实现。它不记住上一次做到哪 —— 它**问台账**,
 * 因为崩溃会让任何一份「我做到哪了」的笔记失真,而 `(orgId, refId)` 上的终态查询不会:
 *
 *   · 已 SETTLE  ⇒ 这一行结清了(结算和 DONE 是同一个事务,所以钱结了产物就一定也落了)。
 *   · 已 REFUND  ⇒ 上一回合退过了。同一个 refId 再也 reserve 不了(`reserve:<refId>` 终身
 *                  唯一),所以**换一个新回合的 refId** 并把它写回行上,再按现在的余额重扣。
 *   · 有 RESERVE 没 finalizer ⇒ **复用**那个 hold,一格都不再动。这是三个崩溃窗里最常见的
 *                  一个(预扣之后、结算之前进程死了),重复预扣会让商家为一件东西付两次。
 *   · 什么都没有 ⇒ 这一行第一次进钱路(或者上次死在「写了 refId、还没 reserve」那一瞬)。
 *
 * 写 refId 用的是**条件写**(where 带旧值),所以它自己也是一次 CAS:count===0 只可能是别
 * 的东西已经把这一行的回合改掉了,那就让位 —— 抢着 reserve 会造出一个没人认领的 hold。
 */
async function ensureUnderstandingHold(row: Row): Promise<MoneyStep> {
  const price = row.priceInternalSnapshot ?? null;
  // 四则④ 免费祖父。**这条分支只服务迁移前的存量行**:扫描器建行时必写快照价(见
  // scanAssetsNeedingUnderstanding 第 ① 段),所以 A9 之后新上传的素材一件都进不来。
  // 那些老行商家上传时没见过任何价目披露 —— 永不补收。
  // 判在最前面,所以这类行连一次台账查询都不做。
  if (price === null) return { verdict: "free", refId: null };

  let current = row.moneyRefId ?? null;

  if (current) {
    const finalizer = await prisma.creditLedger.findFirst({
      where: { orgId: row.ownerId, refId: current, kind: { in: ["SETTLE", "REFUND"] } },
      select: { kind: true },
    });
    if (finalizer?.kind === "SETTLE") return { verdict: "settled", refId: current };
    if (finalizer?.kind === "REFUND") {
      // 新回合。后缀取新 id 的前 8 位而不是一个计数器:计数器要先读再写,而这一步本身就是
      // 在处理「上一次没写完」,再引进一个读后写的窗口是同一种病。
      const nextRefId = `understanding:${row.id}:r${newId().slice(0, 8)}`;
      const { count } = await prisma.assetUnderstanding.updateMany({
        where: { id: row.id, ownerId: row.ownerId, moneyRefId: current },
        data: { moneyRefId: nextRefId },
      });
      if (count === 0) return { verdict: "raced", refId: current };
      current = nextRefId;
    } else {
      const existing = await prisma.creditLedger.findFirst({
        where: { orgId: row.ownerId, refId: current, kind: "RESERVE" },
        select: { id: true },
      });
      // hold 已经在 ⇒ 直接用它。再 reserve 一次只会撞唯一键(或者更糟:换个键扣第二笔)。
      if (existing) return { verdict: "held", refId: current };
      // 台账上什么都没有:上一次死在「写了 refId、还没 reserve」那一瞬。用同一个 refId 补扣。
    }
  } else {
    const refId = `understanding:${row.id}`;
    const { count } = await prisma.assetUnderstanding.updateMany({
      where: { id: row.id, ownerId: row.ownerId, moneyRefId: null },
      data: { moneyRefId: refId },
    });
    if (count === 0) return { verdict: "raced", refId: null };
    current = refId;
  }

  try {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: row.ownerId, refId: current, cost: price }));
    return { verdict: "held", refId: current };
  } catch (e) {
    // 余额不够 ⇒ 不是错误,是一个**可恢复的状态**。这一行停下来等充值,一个请求都不发。
    if (e instanceof InsufficientCredits) return { verdict: "no-credits", refId: current };
    // 并发下同一个 refId 已经被扣过了 —— 规格明写「不视为错误,视为 hold 已在」。
    if (isDuplicateReserve(e)) return { verdict: "held", refId: current };
    // 其余(含商家自己的消费上限 SpendCapBlocked)照原样抛出去:没打供应商、没写终态,
    // 行留在 RUNNING 由清道夫收口。理解一件是 1 internal credit,上限低到挡住它的账号
    // 是配置本身出了事,那要人看见,不该被悄悄写成一个商家读得懂的状态。
    throw e;
  }
}

/**
 * 把某一个回合的 hold 还回去。`refId` 为 null(免费祖父行 / 还没进过钱路)是 no-op。
 *
 * **refId 必须由调用方点名**,不许在这里读 `row.moneyRefId`:退款发生在钱步**之后**时,
 * 内存里那一份 row 已经是旧的了(新回合刚把行上的 refId 换掉),照着它退等于退一个上一
 * 回合早已 REFUND 掉的键 —— 一次静默的 no-op,而商家的钱还锁着。
 *
 * `refundReservation` 自己幂等、且与 SETTLE 互斥(finalizer 唯一索引),所以重复调用、
 * 或者和一次结算撞在一起,都不会多退一分。
 */
async function refundUnderstandingHold(row: Row, refId: string | null, reason: string): Promise<void> {
  if (!refId) return;
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: row.ownerId, refId, reason }));
}

/**
 * **200 回来了,但正文用不了** —— 空正文,或者这个 kind 的产物解析不出来。
 *
 * 走**配置类**(重试 → PAUSED),不写终态。理由和 404 那一条是同一条:同一时刻全平台
 * 一起吐不出可用正文,几乎必然是我方/供应商的档位问题,而不是每个商家的每份文件同时坏掉。
 * 最具体的形状:`thinking` 被重新打开 ⇒ 思考 token 吃满 `max_tokens` ⇒ `content` 空 ⇒
 * 按上一版每一份文件都落 FAILED 终态、零恢复路径。
 *
 * **用量必须落库**:这一趟供应商已经回过话,钱花掉了。不记账,平台日预算对这一整类是瞎的 ——
 * 而那道预算闸正是这条路唯一的花费上限(和 404 不同,这里每次重试都真的付钱)。
 */
async function holdUnusableResponse(
  row: Row,
  retryCount: number,
  usage: { inputTokens: number; outputTokens: number },
  refId: string | null,
): Promise<null> {
  if (retryCount < UNDERSTAND_RETRY_LIMIT) {
    await prisma.assetUnderstanding.updateMany({
      where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
      data: { status: "QUEUED", error: UNDERSTANDING_PROVIDER_PAUSED, ...usage },
    });
    // **hold 留着**(MONEY-A9):行退回 QUEUED,下一轮同一个 refId 复用它。中途退再重扣
    // 只会让商家在台账上看见一串来回,而这一行的钱从头到尾就是那一笔。
    // 抛给 pg-boss 记账 + 退避重投(和端口抛出来的配置类错误走同一条路)。
    throw providerConfigError("understanding response had nothing usable in it");
  }
  // 重试用完 ⇒ 停在 PAUSED 等人修配置。**这一笔必须退**:配置坏着的这段时间不该占着
  // 商家的钱,而修好之后扫描器把行捞回 QUEUED,那时按规格开一个新回合重新扣。
  await refundUnderstandingHold(row, refId, UNDERSTANDING_REFUND_REASON);
  await pauseForConfig(row, usage);
  reportUnderstandingFailure(row, "paused-config", "the response had nothing usable in it");
  return null;
}

/**
 * 最终失败的**报警留痕**。
 *
 * 为什么不能只靠 throw:这个 handler 在最后一次失败时是 `return null` 的 —— 不抛,所以
 * index.ts 的 `runHandler` 捕不到、pg-boss 认为这份活成功了、死信队列永远收不到它。
 * 2026-08-18 那次事故的静默就是这么来的:SENTRY_DSN 在生产是配着的,前两次重试的 throw
 * 大概率也进过 Sentry,但最终那一次被吞掉,而且没有任何一条告警路由指着它 —— 于是全平台
 * 的理解在两天里逐行死光,面板上一片安静。
 *
 * 措辞按**分类**分组,不带行 id(Sentry 按标题聚合;把 id 写进标题会让同一个故障每行开一个
 * issue,alert rule 跟着重复轰炸)。行 id / kind 进 payload。
 */
function reportUnderstandingFailure(
  row: Row,
  outcome: "paused-config" | "failed",
  message: string,
): void {
  const title =
    outcome === "paused-config"
      ? "Asset understanding is paused: the provider refused our request"
      : "Asset understanding gave up on a file";
  console.error(`[understand] ${row.id} (${row.kind}) ${outcome}: ${message}`);
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(new Error(title), {
    tags: { area: "asset-understanding", outcome },
    extra: { understandingId: row.id, kind: row.kind, detail: message },
  });
}

/**
 * 事务客户端。从 `settleCredits` 的签名反推,不在这里另抄一个 Prisma 类型别名 ——
 * 结算和业务结果落盘必须是**同一个** tx,类型同源才保证不会有人传进来一个裸 prisma。
 */
type Tx = Parameters<typeof settleCredits>[0];

/**
 * 一条产品行落进 BrandRecord。**按 nameKey 合并,不新建重复行** —— 同一张菜单被读第二次
 * (或者商家自己已经录过同名产品)时,合并而不是再造一份。
 *
 * `source: "otto"` —— 这是 Otto 自己读出来的,和商家亲手录的要分得清(Memory.source 同语义)。
 * 价格是**展示文本**,永不进任何计价逻辑(productRecordData.price 的既有纪律)。
 *
 * **必须收 tx**:这些行和 settle 在同一个事务里(MONEY-A9 不变量②)。拿裸 prisma 写就
 * 又回到「产品行已经落了,settle 还没跑,进程死在中间 ⇒ 商家白拿一张读好的菜单」。
 */
async function upsertProductRecord(
  tx: Tx,
  ownerId: string,
  product: { name: string; description?: string; price?: string; category?: string },
): Promise<boolean> {
  const nameKey = normalizeNameKey(product.name);
  if (!nameKey) return false;

  const existing = await tx.brandRecord.findFirst({
    where: { ownerId, brandId: null, kind: "product", nameKey, deletedAt: null },
    select: { id: true, data: true },
  });
  const merged = existing
    ? { ...(existing.data as Record<string, unknown>), ...stripUndefined(product) }
    : stripUndefined(product);
  const parsed = productRecordData.safeParse(merged);
  if (!parsed.success) return false; // 形状不对就不落 —— 模型不是可信输入

  const data = parsed.data as unknown as Record<string, unknown>;
  if (existing) {
    await tx.brandRecord.update({ where: { id: existing.id }, data: { data: data as never, source: "otto" } });
    return true;
  }
  // `createMany({ skipDuplicates })` 而不是 create+catch —— 和 caption 那一步同一个理由:
  // 在交互式事务里捕获 P2002 是**假的**保护,唯一冲突已经让 Postgres 把整个事务标成 aborted,
  // 之后连 settle 都提交不了。ON CONFLICT DO NOTHING 让「同一轮里菜单出现两次同名」不产生
  // 错误(赢家已经写好了),而其它任何 DB 错误照常抛出去回滚 + 让队列重试。
  const { count } = await tx.brandRecord.createMany({
    data: [
      {
        id: newId(),
        ownerId,
        brandId: null,
        kind: "product",
        nameKey,
        data: data as never,
        status: "active",
        source: "otto",
        pinned: false,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
}

/**
 * 门店视频读出来的那几句事实 → 品牌记忆(票面:「自动补进品牌记忆」)。
 * category 用 "about"(rememberBrandFact 的三档之一),source "otto"。
 * 同内容不重复写:一行理解只跑一次,所以这里不需要额外去重,但同一句话商家可能自己也写过,
 * 于是仍然按内容查一次 —— 商家的记忆面板里出现两句一模一样的话是很显眼的缺陷。
 *
 * **必须收 tx**:和 settle 同一个事务(MONEY-A9 不变量②),同 {@link upsertProductRecord}。
 */
async function rememberVideoFacts(tx: Tx, ownerId: string, facts: string[]): Promise<number> {
  let written = 0;
  for (const fact of facts) {
    const content = fact.trim().slice(0, 600);
    if (!content) continue;
    const dup = await tx.memory.findFirst({
      where: { ownerId, brandId: null, category: "about", content, deletedAt: null },
      select: { id: true },
    });
    if (dup) continue;
    await tx.memory.create({
      data: { id: newId(), ownerId, brandId: null, category: "about", content, source: "otto", pinned: false },
    });
    written++;
  }
  return written;
}

/**
 * 主处理器。
 *
 * **返回值**是一条要立刻接着跑的理解行的 id(今天只有一种:caption 判定这张图是菜单之后建出来
 * 的 doc-extract 行)。为什么不在这里自己发队列:这个模块不认识 pg-boss,而 index.ts 才是持有
 * boss 的地方 —— 让它去发,这一份代码就不必为了排一条消息去依赖整个队列层。
 * 返回而不是等下一轮扫描,是因为差别是商家的十分钟:菜单应该在几秒内被读成产品行。
 * 万一那次 send 失败,行仍然是 QUEUED,扫描器的重投窗口照样兜住它。
 *
 * `provider` 参数存在的唯一理由是测试:生产调用不传,拿到 env 决定的端口(未配 key = mock)。
 * **测试一律传 mock,绝不真调。**
 */
export async function handleUnderstand(
  data: { understandingId: string },
  retryCount = 0,
  provider?: UnderstandingProvider,
): Promise<string | null> {
  // #463:载荷里只有行 id,所以这一次读必须在具名系统身份下做 —— 和 gen/refgen/caption/render
  // 四个 handler 一字不差的两段式开头(`worker-job-dispatch`)。
  const row = await runAsSystem("worker-job-dispatch", async () =>
    prisma.assetUnderstanding.findUnique({ where: { id: data.understandingId } }),
  );
  if (!row) {
    console.warn(`[understand] row ${data.understandingId} not found — dropping`);
    return null;
  }

  // #463:载荷里只有行 id,租户只有读到行之后才知道。作用域从这里开始,在第一次写之前。
  return runAsTenant(row.ownerId, async (): Promise<string | null> => {
    // 幂等 ②:QUEUED→RUNNING 的 CAS。重投/并发时 count===0 —— 在打供应商之前就返回。
    const { count } = await prisma.assetUnderstanding.updateMany({
      where: { id: row.id, ownerId: row.ownerId, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
    if (count === 0) {
      console.log(`[understand] ${row.id}: not QUEUED (already handled/redelivery) — no-op`);
      return null;
    }

    // 总开关。**暂停键,不是销毁键** —— 已经排进来的行退回 QUEUED,开关打开就继续。
    if (!assetUnderstandingEnabled()) {
      await hold(row, UNDERSTANDING_PAUSED);
      return null;
    }

    const kind = row.kind as UnderstandingKind;

    const asset = await prisma.asset.findFirst({
      where: { id: row.assetId, ownerId: row.ownerId },
      select: {
        contentHash: true,
        ext: true,
        mime: true,
        durationS: true,
        width: true,
        height: true,
        sizeBytes: true,
        deletedAt: true,
      },
    });
    // 素材没了 ⇒ **删行**,不写终态。软删是可逆的(重传会复活同一个 Asset),
    // 而一行终态会把那件素材永久挡在扫描器外面 —— 见 {@link drop}。
    if (!asset || asset.deletedAt) {
      await drop(row, "the file is no longer there");
      return null;
    }

    // pre-flight 闸。**三种答案要分三条路走**,这是 r2 最贵的一处错:
    //   · too-large ⇒ 真终局(这份字节明天也读不动)⇒ SKIPPED;
    //   · unknown  ⇒ 元数据还没补齐(ingest 的 ffprobe 还没跑到这一件)⇒ **暂缓**,
    //     退回 QUEUED。写成 SKIPPED 等于因为「我们还不知道」而永久忘掉商家的素材;
    //     放行则等于没有闸 —— 一张宽高为 null 的 48.77 MP 图一次 doc-extract 就是
    //     一条视频的 2.2%,「不到 1%」当场破。
    // 判在**签 URL 之前**:一分钱没花,一个请求没发。
    const verdict = understandingPreflight(kind, asset);
    if (verdict === "too-large") {
      await skip(row, kind === "video-qa" ? UNDERSTANDING_CLIP_TOO_LONG : UNDERSTANDING_IMAGE_TOO_LARGE);
      return null;
    }
    if (verdict === "unknown") {
      // 正常情况下扫描器就不会把它捞出来(METADATA_READY_FOR_UNDERSTANDING);走到这里
      // 说明是一行躺着的旧 QUEUED,或者素材在两次之间被换过 —— 同样暂缓,不判死。
      await hold(row, UNDERSTANDING_METADATA_PENDING);
      return null;
    }

    // 平台日预算 —— **付费调用之前预扣一笔最坏情况**(#1056)。扫描器那一道拦的是「还没派
    // 出去的活」,拦不住已经排在队列里的那一批:预算在半路见底时,积压的消息会继续一条条
    // 消费掉。上一版这里是「先读 SUM 再决定」,两个副本可以读到同一个「还没超」双双越线;
    // 现在判断和记账是同一条 SQL,挤不进去就直接暂缓。见 tryHoldUnderstandingBudget。
    const budgetDay = await tryHoldUnderstandingBudget(kind);
    if (!budgetDay) {
      await hold(row, UNDERSTANDING_BUDGET_REACHED);
      console.log(
        `[understand] ${row.id}: platform budget reached ($${understandingDailyBudgetUsd().toFixed(2)}/day) — held for tomorrow`,
      );
      return null;
    }

    const mediaUrl = await storage.presignedGet(
      storageKey(row.ownerId, asset.contentHash, asset.ext),
      MEDIA_URL_TTL_SECONDS,
    );
    if (!mediaUrl) {
      // 本地磁盘驱动(开发)签不出 URL,或者存储抖了一下 —— 这是**环境**不是素材:
      // 行退回 QUEUED,换个环境/下一轮照样读得到。一个请求都没发出去 ⇒ 预扣全额退回。
      await releaseUnderstandingBudget(kind, budgetDay);
      await hold(row, UNDERSTANDING_NO_MEDIA_URL);
      return null;
    }

    // ── 钱步(MONEY-A9 不变量①:reserve-first)。在签完 URL 之后、打供应商之前。 ─────────
    // 位置是刻意的:签不出 URL 是**环境**的事,不该先动商家的钱;而供应商一旦被调起来,
    // 钱就必须已经锁住 —— 反过来就是先出片后收钱,余额不足当场变成一笔坏账。
    let money: MoneyStep;
    try {
      money = await ensureUnderstandingHold(row);
    } catch (e) {
      // 钱步自己炸了(DB 抖动、消费上限不可读)⇒ 供应商一个字都没打,预扣退回,原样抛出去。
      await releaseUnderstandingBudget(kind, budgetDay);
      throw e;
    }
    if (money.verdict !== "held" && money.verdict !== "free") {
      // 三条不打供应商的出口,共用同一句预扣退回。
      await releaseUnderstandingBudget(kind, budgetDay);
      if (money.verdict === "settled") {
        // 台账说这一行已经结清 —— 结算和 DONE 是同一个事务,所以正常路径上这一行早就是
        // DONE、CAS 在函数开头就输了。走到这里只可能是一个撕裂的状态,把行收口到 DONE
        // (**不碰 summary/data**:那是上一趟真的读出来的产物,这里没有更好的版本)。
        await prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
          data: { status: "DONE" },
        });
        console.log(`[understand] ${row.id}: already settled (${money.refId}) — no second charge, no provider call`);
        return null;
      }
      if (money.verdict === "no-credits") {
        // 四则④:停在这里等充值。**不是终态**,素材无限期保留,一个请求都不发。
        await prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
          data: { status: "PAUSED_BALANCE", error: UNDERSTANDING_WAITING_FOR_CREDITS },
        });
        console.log(`[understand] ${row.id}: not enough credits — waiting for a top-up`);
        return null;
      }
      // raced:这一回合被别人接管了。行留在 RUNNING 不动 —— 抢着改状态只会把对方的活踩掉;
      // 真的没人接手,30 分钟后清道夫把它退回 QUEUED。
      console.log(`[understand] ${row.id}: another round claimed this row — standing down`);
      return null;
    }
    const moneyRefId = money.refId;

    const port = provider ?? createUnderstandingProvider();
    let result;
    try {
      // `media` 让端口在发请求之前用**同一个** pre-flight 再判一次(belt)。
      result = await port.understand({ kind, mediaUrl, mime: asset.mime, media: asset });
      // **校正点(成功侧)。** 一次调用一笔:把预扣的最坏情况换成实际用量。记在这里而不是
      // 在下面各个落盘分支里 —— 一趟调用会写好几次行,在那些地方记就会重复计数。
      await correctUnderstandingBudget(kind, budgetDay, result.usage);
    } catch (e) {
      // 用量跟着错误走出来 = 供应商回过话了 = **这一趟钱已经花了**。两处都要用它:
      //   · 计量器(平台今天一共花了多少)—— **校正点(失败侧)**,一次调用一笔;
      //   · 行上那两列(这一行最后一次读花了多少)—— 下面每条落盘分支都带着它。
      // 校正放在 catch 的第一行:下面每一条分支都可能落盘,它不能挂在其中任何一条上。
      // 拿不到用量时**不减**(见 correctUnderstandingBudget):对面可能已经开始算钱了。
      const spentUsage = understandingErrorUsage(e) ?? undefined;
      await correctUnderstandingBudget(kind, budgetDay, spentUsage ?? null);
      // 读不了这份字节 ⇒ 重试永远同一个答案 ⇒ 终止,不占重试预算。
      // **终局失败 ⇒ 退款**(MONEY-A9):没读成的东西不收钱,供应商那一趟的成本平台自己吞。
      if (isUnreadableMediaError(e)) {
        await refundUnderstandingHold(row, moneyRefId, UNDERSTANDING_REFUND_REASON);
        await fail(row, UNDERSTANDING_UNREADABLE, spentUsage);
        return null;
      }
      // **我方的请求/配置坏了**(模型 id 不存在、key 不对、schema 被拒)。文件没问题,
      // 所以它永远不许落 FAILED —— 判据在 @fikirtive/generation 的
      // classifyUnderstandingFailure,这里只按结论分路。
      const configProblem = isProviderConfigError(e);
      const message = sanitizeError(e);
      console.warn(`[understand] ${row.id} (${kind}) failed:`, message);
      // 还有重试额度 ⇒ 退回 QUEUED 让 pg-boss 再送一次(CAS 才能再赢一次)。
      // **hold 留着**(MONEY-A9):下一轮进门时台账上是「有 RESERVE 没 finalizer」,
      // 恢复协议会复用它 —— 一件素材从头到尾就扣那一笔,不会在台账上留下一串来回。
      // 配置类和暂时性走同一条重试路,它们的差别只在**用完之后**落什么。
      if (retryCount < UNDERSTAND_RETRY_LIMIT) {
        await prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
          data: {
            status: "QUEUED",
            error: configProblem ? UNDERSTANDING_PROVIDER_PAUSED : message.slice(0, 300),
            ...(spentUsage ?? {}),
          },
        });
        throw e; // pg-boss 记账 + 退避重投
      }
      // 重试用完。**这里是那个吞点** —— 不抛,所以 pg-boss 认为这份活成功了,死信队列
      // 永远收不到它。两条路都必须自己把话说出去(reportUnderstandingFailure)。
      // 两条都退款:一条是配置坏着(等人修,期间不该占着商家的钱),一条是真失败。
      await refundUnderstandingHold(row, moneyRefId, UNDERSTANDING_REFUND_REASON);
      if (configProblem) {
        await pauseForConfig(row, spentUsage);
        reportUnderstandingFailure(row, "paused-config", message);
        return null;
      }
      await fail(row, message, spentUsage);
      reportUnderstandingFailure(row, "failed", message);
      return null;
    }

    const parsedJson = parseUnderstandingJson(result.text);
    // 记账:真实用量 vs 这一档的最坏情况。超了不拦(钱已经花了),但**必须响** ——
    // 这是「成本 < 一条视频的 1%」在生产上唯一的漂移探测器。
    const actualUsd = understandingCostUsd(result.usage);
    if (actualUsd > understandingWorstCaseUsd(kind)) {
      console.warn(
        `[understand] BUDGET DRIFT ${row.id} (${kind}): actual $${actualUsd.toFixed(6)} exceeds the worst case ` +
          `$${understandingWorstCaseUsd(kind).toFixed(6)} — re-check the caps in @fikirtive/core asset-understanding.ts`,
      );
    }
    const tokens = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

    if (kind === "image-caption") {
      const caption = parseImageCaption(parsedJson);
      // 200 但产物解析不出来 ⇒ **不写终态**,走配置类(见 holdUnusableResponse):
      // 「读回来的不是我们要的形状」在全平台一起发生时是档位问题,不是每个商家的文件同时坏。
      if (!caption) return holdUnusableResponse(row, retryCount, tokens, moneyRefId);
      // 三件套之间那条线:这张图基本上是一整页字 ⇒ 值得再花一次去读它的产品行。
      //
      // **caption 落 DONE 与 doc-extract 建行在同一个事务里。** 分成两步写(r2)有一个
      // 永久丢数据的窗口:两步之间进程被杀、或者第二步撞上一个普通 DB 错误,结果就是
      // 「caption 已 DONE + 零 doc 行」—— 而扫描器第 ① 段只找**完全没有理解行**的素材,
      // 那张菜单于是永远不会被读成产品目录,连重传都救不回来。同一个事务里,第二步没成
      // 就连 DONE 都不落,下一轮从头再来。
      //
      // `createMany({ skipDuplicates: true })` 而不是 create+catch:在一个交互式事务里
      // 捕获 P2002 是**假的**保护 —— 唯一冲突已经让 Postgres 把整个事务标成 aborted,
      // 之后什么都提交不了。ON CONFLICT DO NOTHING 让「已经有这一行」不产生错误,
      // 而其它任何 DB 错误照常抛出去回滚 + 让队列重试(r2 那个 `catch {}` 把它们全吞了)。
      //
      // **结算也在这同一个事务里**(MONEY-A9 不变量②)。理由和上面那两步是同一个:分开写
      // 就多一个窗口 —— 文件读完了钱没结(平台白送一件),或者钱结了产物没落(商家付了钱
      // 却什么都没得到)。同一个事务里,三件事要么一起成立,要么一起不成立,而重投时
      // 「已 SETTLE」正是恢复协议认得的那个终态。
      const followUpId = caption.isDocument ? newId() : null;
      const queued = await prisma.$transaction(async (tx) => {
        if (moneyRefId) await settleCredits(tx, { orgId: row.ownerId, refId: moneyRefId });
        await tx.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId },
          data: { status: "DONE", summary: caption.summary, data: caption as never, error: null, ...tokens },
        });
        if (!followUpId) return null;
        const { count } = await tx.assetUnderstanding.createMany({
          data: [
            {
              id: followUpId,
              ownerId: row.ownerId,
              assetId: row.assetId,
              kind: "doc-extract" satisfies UnderstandingKind,
              status: "QUEUED",
              // 计费四则②:级联出来的第二段**继承上传时刻的那一格报价**,不按它建行的这一刻
              // 重新报价。两段价在上传界面是一次性披露、一并锁价的,所以它们必须一起冻在
              // 上传那一刻。父行没有快照(免费祖父)⇒ 子行也没有 ⇒ 同样免费。
              priceInternalSnapshot: row.cascadePriceInternal ?? null,
            },
          ],
          skipDuplicates: true, // 已经有了(重投/并发)—— 本来就不该有第二行
        });
        return count === 1 ? followUpId : null;
      });
      // 建好的行 id 原样返回给 index.ts 去发队列(见函数头:差别是商家的十分钟)。
      if (queued) console.log(`[understand] ${row.id}: looks like a document — queued doc-extract ${queued}`);
      return queued;
    }

    if (kind === "doc-extract") {
      const doc = parseDocExtract(parsedJson);
      // 票面要求的解析失败兜底:**一行 BrandRecord 都不写**。半份产品目录比没有产品目录
      // 糟得多 —— 商家会以为 Otto 已经认识他的菜单了。落什么状态见 holdUnusableResponse:
      // 不写终态,这样档位修好之后这张菜单还会被读到。
      if (!doc) return holdUnusableResponse(row, retryCount, tokens, moneyRefId);
      // **产品行、settle、DONE 三件事在同一个事务里**(MONEY-A9 不变量②)。
      //
      // 上一版把产品行写在事务**外面**,理由写的是「它们各自幂等,重跑不会多出一份」——
      // 那句话是真的,但它答的不是这里的问题。真问题是**中断的方向**:产品行先落、settle
      // 在后,进程死在中间就是「商家的产品目录已经多出这一页,而这一笔钱一格没收」,
      // 而且行还停在 RUNNING、清道夫会把它退回 QUEUED 重跑一遍(那一趟平台再吃一次供应商
      // 成本)。幂等保证的是不重复,保证不了不白送。同一个事务里,菜单读进目录和这笔钱结清
      // 要么一起成立,要么一起不成立。
      let saved = 0;
      const summaryOf = (n: number) =>
        n > 0 ? `Read ${n} item${n === 1 ? "" : "s"} from this menu.` : "No readable items on this page.";
      // 显式 timeout(判官 2026-09-01 复核 P1):40 项菜单 × 每项一查一写 ≈ 80 次往返,
      // Prisma 交互事务默认 5s 在生产延迟下可能超时 → 整批回滚 → 重投再打一次供应商。
      // 30s 给足余量;真超时仍是 fail closed(settle 同滚,商家零扣费)。
      await prisma.$transaction(async (tx) => {
        saved = 0; // 事务重试时从零数起 —— 半个上一轮的计数写进 summary 就是一句假话
        for (const product of doc.products) {
          if (await upsertProductRecord(tx, row.ownerId, product)) saved++;
        }
        if (moneyRefId) await settleCredits(tx, { orgId: row.ownerId, refId: moneyRefId });
        await tx.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId },
          data: { status: "DONE", summary: summaryOf(saved), data: { ...doc, saved } as never, error: null, ...tokens },
        });
      }, { timeout: 30_000 });
      console.log(`[understand] ${row.id}: doc-extract saved ${saved}/${doc.products.length} product row(s)`);
      return null;
    }

    // video-qa
    const video = parseVideoQa(parsedJson);
    if (!video) return holdUnusableResponse(row, retryCount, tokens, moneyRefId);
    // 品牌记忆 + settle + DONE 同一个事务(MONEY-A9 不变量②),同 doc-extract 的理由:
    // 记忆先落、结算在后,中断一次就是商家白得一条读好的门店事实而平台零收入。
    let remembered = 0;
    await prisma.$transaction(async (tx) => {
      remembered = await rememberVideoFacts(tx, row.ownerId, video.facts);
      if (moneyRefId) await settleCredits(tx, { orgId: row.ownerId, refId: moneyRefId });
      await tx.assetUnderstanding.updateMany({
        where: { id: row.id, ownerId: row.ownerId },
        data: { status: "DONE", summary: video.summary, data: { ...video, remembered } as never, error: null, ...tokens },
      });
    });
    console.log(`[understand] ${row.id}: video-qa remembered ${remembered} new brand fact(s)`);
    return null;
  });
}

/**
 * 清道夫(**行**那一侧):worker 崩在半路留下的 RUNNING 行。
 *
 * 它只把行退回 QUEUED,让下一轮扫描重新投递:一件读到一半的素材应该被读完,而不是永远停在
 * 「Otto 好像认识我的店,除了这一件」。条件式 updateMany 就是认领:一个刚好在这一刻跑完的行
 * 会把状态改走 ⇒ count===0 ⇒ 跳过,完成的行永远不会被这个清道夫踩掉。
 *
 * **钱那一侧由 {@link reapStaleUnderstandingReservations} 兜**(A9 之前这条链路不碰钱,
 * 所以这里曾经写着「纯 $0,没有预扣要退」——那句话已经不成立了)。两个清道夫的窗口不同是
 * 刻意的:行 30 分钟(一次读的量级),钱 60 分钟(远大于重试退避,免得把还活着的回合退掉)。
 */
export async function reapStaleUnderstanding(now: Date = new Date()): Promise<number> {
  return runAsSystem("understanding-reaper", async () => {
    const cutoff = new Date(now.getTime() - UNDERSTAND_STALE_MS);
    const stuck = await prisma.assetUnderstanding.findMany({
      where: { status: "RUNNING", updatedAt: { lt: cutoff } },
      select: { id: true, ownerId: true },
      take: 100,
    });
    let reaped = 0;
    for (const row of stuck) {
      // #463 逐行阶段:上面的扫描跨租户,这一笔写入不跨。`await` 必须在回调**里面**
      // (裸 PrismaPromise 会在租户帧弹出之后才被派发)。
      const { count } = await runAsTenant(row.ownerId, async () => {
        return await prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "RUNNING", updatedAt: { lt: cutoff } },
          data: { status: "QUEUED", error: UNDERSTANDING_INTERRUPTED },
        });
      });
      if (count > 0) reaped++;
    }
    return reaped;
  });
}

/**
 * 清道夫(**钱**那一侧,MONEY-A9):漏在半路的理解预扣。
 *
 * 形状照抄 `llm-reservation-reaper` 的第 1 遍 —— 它兜的是同一类事故:进程死在 reserve 和
 * settle 之间(部署 SIGKILL、OOM),留下一个没有 finalizer 的 RESERVE,商家的 credits 就
 * 那么锁着,没有任何一条路径会再回来看它。
 *
 * **为什么不并进 LLM 那个清道夫的名单**:那个清道夫的退款还带着 approval-card 的收口语义
 * (退完要去把那张卡片改成 failed),而理解这条链路根本没有卡片。借它的 LIKE 名单等于借它
 * 的第 2、3 遍,那是一次错误的耦合;前缀覆盖守卫(llm-reservation-reaper.test.ts)因此把
 * `understanding:` 登记成「由专属清道夫覆盖」,并且会去这个文件里核实这句 SQL 真的存在。
 *
 * 退完款之后**顺手把行也收口**:只动「还挂着这个回合、并且还停在 RUNNING」的行。
 * QUEUED / PAUSED* 的行一律不碰 —— 它们下次进 handler 时,恢复协议看到台账上的 REFUND
 * 会自己开一个新回合,那比这里猜一个状态更准。
 *
 * 返回**真的由这一轮退掉**的笔数(`refundReservation` 报的是哪个 finalizer 赢了):扫描和
 * 退款是两条语句,中间一次正常结算落地就该记 0,把它算进去只会让「今天漏了多少」虚高。
 */
export async function reapStaleUnderstandingReservations(now: Date = new Date()): Promise<number> {
  return runAsSystem("understanding-reaper", async () => {
    const cutoff = new Date(now.getTime() - UNDERSTAND_RESERVATION_STALE_MS);
    const leaked = await prisma.$queryRaw<{ orgId: string; refId: string }[]>`
      SELECT r."orgId", r."refId"
      FROM "CreditLedger" r
      WHERE r."kind" = 'RESERVE'
        AND r."createdAt" < ${cutoff}
        AND r."refId" LIKE 'understanding:%'
        AND NOT EXISTS (
          SELECT 1 FROM "CreditLedger" f
          WHERE f."orgId" = r."orgId" AND f."refId" = r."refId"
            AND f."kind" IN ('SETTLE', 'REFUND')
        )
      LIMIT 100`;
    let reaped = 0;
    for (const { orgId, refId } of leaked) {
      // #463 两段式:扫描跨租户(台账上没有一个租户可以收口这句话),退款各自回到自己的租户。
      const refunded = await runAsTenant(orgId, async () => {
        const outcome = await prisma.$transaction((tx) =>
          refundReservation(tx, { orgId, refId, reason: UNDERSTANDING_REAPER_REFUND_REASON }),
        );
        // 只有**我们自己退成了**才动行:`already-settled` 是一次正常成功(扫描之后落的),
        // 去改它的行等于把商家读完的东西改回队列。
        if (outcome !== "refunded") return false;
        await prisma.assetUnderstanding.updateMany({
          where: { ownerId: orgId, moneyRefId: refId, status: "RUNNING" },
          data: { status: "QUEUED", error: UNDERSTANDING_INTERRUPTED },
        });
        return true;
      });
      if (refunded) reaped++;
    }
    return reaped;
  });
}

/** 队列名的再导出 —— index.ts 只从这里读这条链路的东西。 */
export { UNDERSTAND_QUEUE };
