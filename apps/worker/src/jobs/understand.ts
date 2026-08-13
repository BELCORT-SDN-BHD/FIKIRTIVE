/**
 * handleUnderstand — 素材理解三件套的后台执行器(#784)。
 *
 * ── 商家永远不点「分析」──────────────────────────────────────────────────────
 * 这个文件里**没有**任何由商家动作触发的入口。生产者只有 `scanAssetsNeedingUnderstanding`
 * (worker 自己的定时扫描),商家的体感是「Otto 好像认识我的店」。这是票面的设计铁律,
 * 不是实现偏好 —— 任何一个「开始分析」的按钮或 skill 都会破坏它。
 *
 * ── 钱 ────────────────────────────────────────────────────────────────────────
 * **商家一分钱不付。** 这个文件不 import 也不调用 reserveCredits / settleCredits /
 * refundReservation / withLlmBudget —— understand.test.ts 把这一条钉成断言。
 * 真正兜住花费的三样都在 @fikirtive/core 的 asset-understanding.ts:总开关、
 * **平台每日美元预算**、每次调用的 token 上限(视频配时长闸、图片配像素/字节闸 ——
 * 少了那两道 pre-flight,「token 上限」只是一句请求)。
 *
 * ── 暂缓 ≠ 丢弃(这条链路最贵的一条纪律)──────────────────────────────────────
 * 扫描器第 ① 段只找**完全没有理解行**的素材,所以任何一行终态都是一道再也开不了的门。
 * 不跑的原因因此必须分三类,终态跟着分:
 *   · **资源 / 还不知道**(开关关、平台预算见底、这个环境签不出 URL、宽高时长还没探测出来)
 *     ⇒ 行退回 QUEUED,下一轮继续。这类事情明天就不成立了,写成终态等于让商家的素材被
 *     永久忘掉。
 *   · **真终局**(这份字节按预算读不动:视频超时长、图片超像素闸)⇒ SKIPPED。它明天也不会变。
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
import { prisma } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import {
  UNDERSTAND_QUEUE,
  UNDERSTAND_RETRY_LIMIT,
  UNDERSTANDING_BUDGET_REACHED,
  UNDERSTANDING_CLIP_TOO_LONG,
  UNDERSTANDING_IMAGE_TOO_LARGE,
  UNDERSTANDING_INTERRUPTED,
  UNDERSTANDING_METADATA_PENDING,
  UNDERSTANDING_NO_MEDIA_URL,
  UNDERSTANDING_PAUSED,
  UNDERSTANDING_UNREADABLE,
  assetUnderstandingEnabled,
  newId,
  normalizeNameKey,
  parseDocExtract,
  parseImageCaption,
  parseUnderstandingJson,
  parseVideoQa,
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
  isUnreadableMediaError,
  understandingErrorUsage,
  type UnderstandingProvider,
} from "@fikirtive/generation";
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

/** RUNNING 滞留多久算「worker 崩在半路」。远大于一次请求超时 + 落盘尾巴。 */
export const UNDERSTAND_STALE_MS = 30 * 60_000;

/** 只理解商家**自己传进来**的东西。GENERATED 是我们自己产的图,读它等于读自己写的字。 */
const UNDERSTOOD_SOURCES = ["UPLOAD", "IMPORT"] as const;

/**
 * 今天全平台的理解已经花了多少美元。
 *
 * 数的是**钱**不是行数:两列 token 就在表上,`understandingCostUsd()` 是现成的算式,
 * 而行数在两头都会错(一次已经计费的失败数成 0,一行三次重试数成 1)。
 *
 * 跨租户 —— 「我们一天最多被账单多少钱」本来就是一个 platform-wide 的问题,
 * 所以它在一个具名系统身份下读全表,只读、不写。
 */
export async function understandingSpentTodayUsd(now: Date = new Date()): Promise<number> {
  return runAsSystem("understanding-budget", async () => {
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sum = await prisma.assetUnderstanding.aggregate({
      where: { updatedAt: { gte: startOfDay } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return understandingCostUsd({
      inputTokens: sum._sum.inputTokens ?? 0,
      outputTokens: sum._sum.outputTokens ?? 0,
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

/** 上一次报出来的暂缓原因。只在状态**变化**时打日志 —— 每分钟一行同样的话不是可观测性。 */
let pauseNotice: string | null = null;
function noticePause(reason: string | null): void {
  if (reason === pauseNotice) return;
  pauseNotice = reason;
  if (reason) console.log(`[understand] paused — ${reason}. Queued files stay queued.`);
  else console.log("[understand] resumed — reading files again");
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
            data: { id, ownerId: asset.ownerId, assetId: asset.id, kind, status: "QUEUED" },
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
    const stranded = await prisma.assetUnderstanding.findMany({
      where: { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - UNDERSTAND_REDISPATCH_MIN_AGE_MS) } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: UNDERSTAND_SCAN_BATCH,
    });
    for (const row of stranded) if (!ids.includes(row.id)) ids.push(row.id);

    return ids;
  });
}

type Row = {
  id: string;
  ownerId: string;
  assetId: string;
  kind: string;
};

/**
 * 落一个**真终局**:这份素材我们永远不会再读。只有一种情况配得上它 ——
 * 这份字节按我们的预算读不动(视频超时长、图片超像素闸)。这个条件是**内容**的属性,
 * 明天不会变、重传同样的字节也不会变,所以写死它不丢任何东西。
 *
 * 「素材没了」不走这里(它可逆,见 {@link drop});「我们还不知道」也不走这里(见 {@link hold})。
 */
async function skip(row: Row, reason: string): Promise<void> {
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
 * 一条产品行落进 BrandRecord。**按 nameKey 合并,不新建重复行** —— 同一张菜单被读第二次
 * (或者商家自己已经录过同名产品)时,合并而不是再造一份。
 *
 * `source: "otto"` —— 这是 Otto 自己读出来的,和商家亲手录的要分得清(Memory.source 同语义)。
 * 价格是**展示文本**,永不进任何计价逻辑(productRecordData.price 的既有纪律)。
 */
async function upsertProductRecord(
  ownerId: string,
  product: { name: string; description?: string; price?: string; category?: string },
): Promise<boolean> {
  const nameKey = normalizeNameKey(product.name);
  if (!nameKey) return false;

  const existing = await prisma.brandRecord.findFirst({
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
    await prisma.brandRecord.update({ where: { id: existing.id }, data: { data: data as never, source: "otto" } });
    return true;
  }
  try {
    await prisma.brandRecord.create({
      data: {
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
    });
    return true;
  } catch {
    // 部分唯一索引撞车(同一轮里菜单出现两次同名)—— 赢家已经写好了,跳过。
    return false;
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
}

/**
 * 门店视频读出来的那几句事实 → 品牌记忆(票面:「自动补进品牌记忆」)。
 * category 用 "about"(rememberBrandFact 的三档之一),source "otto"。
 * 同内容不重复写:一行理解只跑一次,所以这里不需要额外去重,但同一句话商家可能自己也写过,
 * 于是仍然按内容查一次 —— 商家的记忆面板里出现两句一模一样的话是很显眼的缺陷。
 */
async function rememberVideoFacts(ownerId: string, facts: string[]): Promise<number> {
  let written = 0;
  for (const fact of facts) {
    const content = fact.trim().slice(0, 600);
    if (!content) continue;
    const dup = await prisma.memory.findFirst({
      where: { ownerId, brandId: null, category: "about", content, deletedAt: null },
      select: { id: true },
    });
    if (dup) continue;
    await prisma.memory.create({
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
 * `provider` 参数存在的唯一理由是测试:生产调用不传,拿到 env 决定的端口(未配 key = mock,
 * 和 createGenerationProvider 同一条安全默认)。**测试一律传 mock,绝不真调。**
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

    // 平台日预算 —— **付费调用之前再查一次**。扫描器那一道拦的是「还没派出去的活」,
    // 拦不住已经排在队列里的那一批:预算在半路见底时,积压的消息会继续一条条消费掉,
    // 最坏情况超支远不止一轮(队列里可能躺着上一轮建的、还没跑的全部行)。
    // 这一查是每次付费调用一次的全表 SUM;这条队列一分钟至多 25 件,那点读的代价
    // 换的是「日预算真的是一天的上限」。
    const budget = understandingDailyBudgetUsd();
    const spentSoFar = await understandingSpentTodayUsd();
    if (spentSoFar >= budget) {
      await hold(row, UNDERSTANDING_BUDGET_REACHED);
      console.log(
        `[understand] ${row.id}: platform budget reached ($${spentSoFar.toFixed(4)} of $${budget.toFixed(2)}) — held for tomorrow`,
      );
      return null;
    }

    const mediaUrl = await storage.presignedGet(
      storageKey(row.ownerId, asset.contentHash, asset.ext),
      MEDIA_URL_TTL_SECONDS,
    );
    if (!mediaUrl) {
      // 本地磁盘驱动(开发)签不出 URL,或者存储抖了一下 —— 这是**环境**不是素材:
      // 行退回 QUEUED,换个环境/下一轮照样读得到。
      await hold(row, UNDERSTANDING_NO_MEDIA_URL);
      return null;
    }

    const port = provider ?? createUnderstandingProvider();
    let result;
    try {
      // `media` 让端口在发请求之前用**同一个** pre-flight 再判一次(belt)。
      result = await port.understand({ kind, mediaUrl, mime: asset.mime, media: asset });
    } catch (e) {
      // 读不了这份字节 ⇒ 重试永远同一个答案 ⇒ 终止,不占重试预算。
      // 用量跟着错误走时(200 + 空正文:钱已经花了)一并落库,不然日预算对那一类是瞎的。
      if (isUnreadableMediaError(e)) {
        await fail(row, UNDERSTANDING_UNREADABLE, understandingErrorUsage(e) ?? undefined);
        return null;
      }
      const message = sanitizeError(e);
      console.warn(`[understand] ${row.id} (${kind}) failed:`, message);
      // 还有重试额度 ⇒ 退回 QUEUED 让 pg-boss 再送一次(CAS 才能再赢一次);
      // 用完了 ⇒ 落 FAILED。这条队列不碰商家余额,所以重试是安全的。
      if (retryCount < UNDERSTAND_RETRY_LIMIT) {
        await prisma.assetUnderstanding.updateMany({
          where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
          data: { status: "QUEUED", error: message.slice(0, 300) },
        });
        throw e; // pg-boss 记账 + 退避重投
      }
      await fail(row, message);
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
      if (!caption) {
        // 供应商回过话了 ⇒ 这一趟**已经计费**。带上用量落盘,不然平台日预算对这一整类
        // 失败是瞎的(而「读回来的是散文」正是本票自陈未实测的那个失效模式)。
        await fail(row, UNDERSTANDING_UNREADABLE, tokens);
        return null;
      }
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
      const followUpId = caption.isDocument ? newId() : null;
      const queued = await prisma.$transaction(async (tx) => {
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
      // 票面要求的解析失败兜底:**一行 BrandRecord 都不写**,落一句商家读得懂的话。
      // 半份产品目录比没有产品目录糟得多 —— 商家会以为 Otto 已经认识他的菜单了。
      if (!doc) {
        await fail(row, UNDERSTANDING_UNREADABLE, tokens);
        return null;
      }
      let saved = 0;
      for (const product of doc.products) {
        if (await upsertProductRecord(row.ownerId, product)) saved++;
      }
      const summary =
        saved > 0 ? `Read ${saved} item${saved === 1 ? "" : "s"} from this menu.` : "No readable items on this page.";
      await prisma.assetUnderstanding.updateMany({
        where: { id: row.id, ownerId: row.ownerId },
        data: { status: "DONE", summary, data: { ...doc, saved } as never, error: null, ...tokens },
      });
      console.log(`[understand] ${row.id}: doc-extract saved ${saved}/${doc.products.length} product row(s)`);
      return null;
    }

    // video-qa
    const video = parseVideoQa(parsedJson);
    if (!video) {
      await fail(row, UNDERSTANDING_UNREADABLE, tokens);
      return null;
    }
    const remembered = await rememberVideoFacts(row.ownerId, video.facts);
    await prisma.assetUnderstanding.updateMany({
      where: { id: row.id, ownerId: row.ownerId },
      data: { status: "DONE", summary: video.summary, data: { ...video, remembered } as never, error: null, ...tokens },
    });
    console.log(`[understand] ${row.id}: video-qa remembered ${remembered} new brand fact(s)`);
    return null;
  });
}

/**
 * 清道夫:worker 崩在半路留下的 RUNNING 行。
 *
 * 纯 UX + 纯 $0 —— 这条链路没有任何预扣要退。它做的只是把行退回 QUEUED,让下一轮扫描
 * 重新投递:一件读到一半的素材应该被读完,而不是永远停在「Otto 好像认识我的店,除了这一件」。
 * 条件式 updateMany 就是认领:一个刚好在这一刻跑完的行会把状态改走 ⇒ count===0 ⇒ 跳过,
 * 完成的行永远不会被这个清道夫踩掉。
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

/** 队列名的再导出 —— index.ts 只从这里读这条链路的东西。 */
export { UNDERSTAND_QUEUE };
