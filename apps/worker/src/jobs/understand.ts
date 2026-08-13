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
 * 不跑的原因分两类,终态**必须**跟着分:
 *   · **资源**(开关关、平台预算见底、这个环境签不出 URL)⇒ 行退回 QUEUED,下一轮继续。
 *     这类事情明天就不成立了,把它写成终态等于让商家的素材被永久忘掉 —— 而扫描器第 ① 段
 *     只找「完全没有理解行」的素材,一行终态就是一道再也开不了的门,连重传都救不回来
 *     (Asset 按 (ownerId, contentHash) 复用,重传拿到的是同一行)。
 *   · **真终局**(素材没了、这份字节按预算读不动)⇒ SKIPPED。它明天也不会变。
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
  UNDERSTANDING_INTERRUPTED,
  UNDERSTANDING_UNREADABLE,
  UNDERSTANDING_VIDEO_MAX_SECONDS,
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
  understandingImageWithinPreflight,
  understandingKindForMime,
  understandingWorstCaseUsd,
  type UnderstandingKind,
} from "@fikirtive/core";
import { createUnderstandingProvider, isUnreadableMediaError, type UnderstandingProvider } from "@fikirtive/generation";
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
 * **两道暂缓闸在这一层,而不是在 handler 里**:handler 拦到的行已经被认领过了,把它拦下来
 * 只能写状态;扫描器拦下来的是「还没派出去的活」,行原样留着,下一轮照旧。总开关每轮读一次
 * (不是启动时读一次)—— 不然「暂停」就是「销毁」:关掉开关那一小时进来的素材会被逐一
 * 写死,再打开也回不来。
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
        OR: [{ mime: { startsWith: "image/" } }, { mime: { startsWith: "video/" } }],
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

/**
 * caption 刚建出来的 doc-extract 行要立刻能跑,不必等到下一轮 redispatch 窗口。
 * 单独一个函数是因为它跑在**已经**属于某个租户的调用栈里(handleUnderstand 内),
 * 而上面那个扫描是跨租户的。
 */
async function queueDocExtract(ownerId: string, assetId: string): Promise<string | null> {
  const id = newId();
  try {
    await prisma.assetUnderstanding.create({
      data: { id, ownerId, assetId, kind: "doc-extract" satisfies UnderstandingKind, status: "QUEUED" },
    });
    return id;
  } catch {
    return null; // 已经有了(重投/并发)——本来就不该有第二行
  }
}

type Row = {
  id: string;
  ownerId: string;
  assetId: string;
  kind: string;
};

/**
 * 落一个**真终局**:这份素材我们永远不会再读。只有两种情况配得上它 ——
 * 素材已经没了,或者这份字节按我们的预算读不动(视频超时长、图片超 pre-flight)。
 * 两个条件明天都不会变,所以写死它不丢任何东西。
 */
async function skip(row: Row, reason: string): Promise<void> {
  await prisma.assetUnderstanding.updateMany({
    where: { id: row.id, ownerId: row.ownerId },
    data: { status: "SKIPPED", error: reason },
  });
}

/**
 * **暂缓**:这一趟不跑,行退回 QUEUED,下一轮继续。资源类原因专用(开关关、这个环境
 * 签不出 URL)。写终态才是缺陷 —— 见文件头「暂缓 ≠ 丢弃」。
 */
async function hold(row: Row, reason: string): Promise<void> {
  await prisma.assetUnderstanding.updateMany({
    where: { id: row.id, ownerId: row.ownerId, status: "RUNNING" },
    data: { status: "QUEUED", error: reason },
  });
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
    // (平台日预算那道闸在扫描器一层:它拦的是还没派出去的活,连认领都不必发生。)
    if (!assetUnderstandingEnabled()) {
      await hold(row, "reading is paused right now");
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
    if (!asset || asset.deletedAt) {
      await skip(row, "the file is no longer there");
      return null;
    }

    // 视频的时长闸 —— 少了它,「每次 token 上限」只是一句请求而不是一个上限
    // (整段长视频的输入 token 会把「不到一条视频 1%」直接顶破)。
    if (kind === "video-qa" && (asset.durationS ?? 0) > UNDERSTANDING_VIDEO_MAX_SECONDS) {
      await skip(row, "the clip is longer than the understanding budget covers");
      return null;
    }

    // 图片的 pre-flight 闸 —— 上面那句话对图片一字不差地成立。我们请求里带 `detail: "low"`,
    // 而那个参数还没实测过;万一它被忽略,输入 token 就跟着像素数走。判在**签 URL 之前**:
    // 一分钱没花,一个请求没发。
    if (kind !== "video-qa" && !understandingImageWithinPreflight(asset)) {
      await skip(row, "the picture is larger than the understanding budget covers");
      return null;
    }

    const mediaUrl = await storage.presignedGet(
      storageKey(row.ownerId, asset.contentHash, asset.ext),
      MEDIA_URL_TTL_SECONDS,
    );
    if (!mediaUrl) {
      // 本地磁盘驱动(开发)签不出 URL,或者存储抖了一下 —— 这是**环境**不是素材:
      // 行退回 QUEUED,换个环境/下一轮照样读得到。
      await hold(row, "this environment can't hand the file to the reader yet");
      return null;
    }

    const port = provider ?? createUnderstandingProvider();
    let result;
    try {
      result = await port.understand({ kind, mediaUrl, mime: asset.mime });
    } catch (e) {
      // 读不了这份字节 ⇒ 重试永远同一个答案 ⇒ 终止,不占重试预算。
      if (isUnreadableMediaError(e)) {
        await fail(row, UNDERSTANDING_UNREADABLE);
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
      await prisma.assetUnderstanding.updateMany({
        where: { id: row.id, ownerId: row.ownerId },
        data: { status: "DONE", summary: caption.summary, data: caption as never, error: null, ...tokens },
      });
      // 三件套之间那条线:这张图基本上是一整页字 ⇒ 值得再花一次去读它的产品行。
      // 建好的行 id 原样返回给 index.ts 去发队列(见函数头:差别是商家的十分钟)。
      if (!caption.isDocument) return null;
      const queued = await queueDocExtract(row.ownerId, row.assetId);
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
