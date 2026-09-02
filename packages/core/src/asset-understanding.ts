/**
 * asset-understanding — 素材理解三件套(#784)的**唯一**配置源。
 *
 * 产品承诺(票面):看懂一批素材的钱**不到生成一条视频的 1%**。这一条不是文档里的一句话,
 * 而是这个文件算出来、由 asset-understanding.test.ts 逐个 kind 断言的数字 —— 谁改动
 * token 上限、单价或采样参数,那条断言当场红。散在 worker 里的字面量做不到这件事,
 * 所以每一个成本敏感的旋钮都必须住在这里。
 *
 * ── 三件套(票面第一批)────────────────────────────────────────────────────────
 *   image-caption  商家传产品照 → Otto 自动知道这是什么(品类/颜色/场景)。
 *   doc-extract    菜单(照片或文件)→ 结构化产品行 → BrandRecord。beta:必须有解析失败兜底。
 *   video-qa       门店视频 → 一段可读的店面理解,自动补进品牌记忆。
 *
 * ── 铁律 ────────────────────────────────────────────────────────────────────
 *  1. **商家永远不点「分析」按钮。** 理解在后台自动跑(worker 的 understand 队列),
 *     商家的体感是「Otto 好像认识我的店」。这个模块因此不导出任何「开始分析」的入参形状。
 *  2. ~~**商家一分钱都不付。**~~ **【2026-09-01 S2 §7.3 / MONEY-A9 起废止】** Founder
 *     2026-08-31 裁决原话「不要分开,也不要我们吸收,就是用户使用照算」:理解改为
 *     **商家计费面** —— 三类按 65% 定价法各算出一个按件价(`spend.ts` 的
 *     `pricedUnderstandingCredits`,价从下面 `understandingWorstCaseUsd` 的最坏成本推),
 *     走同一条 reserve→settle 钱路,进 CreditLedger。**披露先于扣费**(上传界面事先可见价目)。
 *     本文件仍然只管**成本与上限**,一格价都不放:定价住 `spend.ts`(推导的单一权威),
 *     计费接线住 worker。**平台级的每日美元预算降级为平台侧保险丝**(不再是唯一的花费兜底),
 *     真正兜住单次花费的仍是每次调用的 token 上限(以及让 token 上限真正成立的两道
 *     pre-flight 闸:视频按时长、图片按像素/字节 —— 没有它们,「每次 token 上限」只是许愿),
 *     因为它同时是**报价的分母**:token 上限一变,售价当场跟着变。
 *  3. **白标。** 这个文件里没有供应商名字;产物里也不许出现(worker 落盘走 redact)。
 *
 * ── 一条纪律:资源闸不许毁数据 ────────────────────────────────────────────────
 * 「今天不跑」「我们还不知道」和「永远不跑」是三件事。开关关掉、平台预算见底、这个环境
 * 签不出 URL、宽高/时长还没探测出来 —— 都不是终局,行退回 QUEUED,明天继续。只有
 * 「这份字节我们按预算读不动」才落 SKIPPED(素材被软删则连 SKIPPED 都不写,直接删行)。
 * 反过来做的代价不是多花钱,是商家的素材被永久地、静悄悄地忘掉。
 *
 * 同一条纪律的另一半在闸门本身:**该知道而不知道 = 不放行**。宽高读不到时按字节兜底
 * 是一道假闸(字节推不出像素),而放行则是没有闸 —— 两者都在 r2 上被实证破掉了 1%。
 */

import { costPinValue } from "./cost-pins.js";
import { SEEDANCE_COGS_USD_PER_SECOND, GEN_VIDEO_SECONDS } from "./gen.js";

type Env = Record<string, string | undefined>;
const getEnv = (env?: Env): Env => env ?? (typeof process !== "undefined" ? process.env : {});

// ── 三件套 ────────────────────────────────────────────────────────────────────

export const UNDERSTANDING_KINDS = ["image-caption", "doc-extract", "video-qa"] as const;
export type UnderstandingKind = (typeof UNDERSTANDING_KINDS)[number];

export function isUnderstandingKind(v: string): v is UnderstandingKind {
  return (UNDERSTANDING_KINDS as readonly string[]).includes(v);
}

/** 行状态。代码校验的 String(house style,不建 PG enum)。
 *  SKIPPED = **真终局**,永远不会再跑:这份字节按我们的预算读不动(视频超时长闸、
 *  图片超像素闸)—— 那是**内容**的属性,重传同样的字节也一样。资源原因(开关关、
 *  平台预算见底、这个环境签不出 URL、宽高/时长还没探测出来)一律**不落 SKIPPED**:
 *  那些行退回 QUEUED,下一轮继续。素材被软删也不落 SKIPPED —— 那一行直接删掉,
 *  否则商家「删掉再重传」这条唯一的自救路径也会失效(worker 的 `drop`)。
 *
 *  PAUSED = **可恢复的暂停**,不是终态:我们自己的请求或配置坏了(模型 id 不存在、
 *  key 不对、schema 被拒),文件本身一点问题都没有。重试用完之后行停在这里等人修,
 *  修好了扫描器把它捡回 QUEUED。它存在的唯一理由是 2026-08-18 那次事故:一个没核过的
 *  模型 id 让每次调用 404,而 404 当时被当成「这份素材读不了」写成 FAILED 终态,于是
 *  每个商家的每一份好文件被逐个永久判死,而且没有任何一条恢复路径。
 *
 *  PAUSED_BALANCE = **「待补余额」暂停**(MONEY-A9 计费四则④,2026-09-01),同样**不是终态**:
 *  商家余额不足,reserve 抛 InsufficientCredits,这一行停在这里等充值。恢复=充值事件唤醒 +
 *  扫描器兜底轮询,捞回条件=余额 ≥ 行上的快照价;暂停期间**不打供应商**(不无限重扫),
 *  素材无限期保留(credits 不过期,同理)。
 *  **和 PAUSED 是两回事,别合并**:PAUSED 是**我方**配置/请求坏了(要人去修代码或配置),
 *  PAUSED_BALANCE 是**商家侧**余额不够(要商家去充值)。合成一个状态就等于把「我们坏了」
 *  和「你没钱了」讲成同一句话:扫描器捞回的判据不同(一个等人修、一个等余额),商家看到的
 *  也该是完全不同的两件事。 */
export const UNDERSTANDING_STATUSES = [
  "QUEUED",
  "RUNNING",
  "DONE",
  "FAILED",
  "SKIPPED",
  "PAUSED",
  "PAUSED_BALANCE",
] as const;
export type UnderstandingStatus = (typeof UNDERSTANDING_STATUSES)[number];

/** 理解模型的**内部**代号。白标:对外(日志、卡面、Otto 的嘴)一律不出现供应商 id;
 *  内部 id → 供应商 id 的映射住在 @fikirtive/generation,和图片/视频引擎同一条纪律。 */
export const UNDERSTANDING_MODEL = "understand-mini";

// ── 单价与 token 上限(成本敏感,全部集中在此)────────────────────────────────

/** 理解模型牌价(USD / 1M token,票面给定)。
 *  数值已收编 `cost-pins.ts`(成本的单一权威),这两行只是命名出口 —— 改价改钉点。 */
export const UNDERSTANDING_USD_PER_MTOKEN_IN = costPinValue("understanding:in-per-mtoken");
export const UNDERSTANDING_USD_PER_MTOKEN_OUT = costPinValue("understanding:out-per-mtoken");

/**
 * 视频理解的采样口径 —— **这一组数字是「视频 token 上限」能成立的全部原因**。
 *
 * 整段 720p 视频按官方口径是每秒两万多 token,一条 5 秒片就能顶掉几十趟图片理解 ——
 * 那样「不到一条视频的 1%」当场不成立。所以视频不整段送:低帧率抽帧 + 低精度,
 * 并且**先按时长把过长的素材挡在门外**(worker 的 pre-flight 闸)。少了那道闸,
 * 下面的 maxInputTokens 就只是一句请求,不是一个上限。
 */
export const UNDERSTANDING_VIDEO_SAMPLE_FPS = 0.5;
/** 超过这个时长的视频**不跑** video-qa(落 SKIPPED,不是失败)。 */
export const UNDERSTANDING_VIDEO_MAX_SECONDS = 60;
/** 一张低精度抽帧的输入 token 记账口径(保守上限;记高不记低,方向永远安全)。 */
export const UNDERSTANDING_LOW_DETAIL_TOKENS_PER_FRAME = 400;

/** 视频理解**最坏情况**的输入 token = 满时长 × 采样帧率 × 每帧 token。 */
export const UNDERSTANDING_VIDEO_MAX_INPUT_TOKENS = Math.ceil(
  UNDERSTANDING_VIDEO_MAX_SECONDS * UNDERSTANDING_VIDEO_SAMPLE_FPS * UNDERSTANDING_LOW_DETAIL_TOKENS_PER_FRAME,
);

/**
 * 图片的 pre-flight 闸 —— **和视频那道时长闸一字不差的同一条推理**。
 *
 * 我们请求里带 `detail: "low"`,而那个参数在我们账户上还没实测过。万一它被忽略,输入
 * token 就会跟像素数一起走:一张按 512px 切块计费的照片,每百万像素约 3.8 块。所以图片
 * 侧的输入上限**由这道闸推出来**,不是另抄一个数 —— 闸在,`maxInputTokens` 才是一个上限;
 * 闸不在,它只是一句请求(视频那一段的原话,对图片一字不差地成立)。
 *
 * 16 MP 的取值:手机默认出片是 12 MP(4032×3024),留了三分之一的余量;更大的只有
 * 48 MP 全分辨率模式和 600dpi 扫描件。它们落 SKIPPED —— 与视频超时长同一个终局语义,
 * 行上带得走原因,不是静悄悄地忘掉。
 */
export const UNDERSTANDING_IMAGE_MAX_PIXELS = 16_000_000;
/** 每百万像素的输入 token 记账口径(512px 切块 × 每块 170 token ≈ 649,记高不记低)。 */
export const UNDERSTANDING_IMAGE_TOKENS_PER_MEGAPIXEL = 700;
/**
 * 像素闸之外的第二道上限。**不是**尺寸读不到时的替代品 —— 字节数推不出像素数,
 * 一张 48 MP 的高压缩 JPEG 可以只有几 MB(那正是 r2 那道兜底破掉的方式)。
 * 刻意放得很宽:16 MP 的 JPEG 约 5 MB、PNG 约 30 MB,40 MiB 只拦真正病态的文件。
 */
export const UNDERSTANDING_IMAGE_MAX_BYTES = 40 * 1024 * 1024;

/** 图片理解**最坏情况**的输入 token = 闸门像素数 × 每百万像素 token。 */
export const UNDERSTANDING_IMAGE_MAX_INPUT_TOKENS = Math.ceil(
  (UNDERSTANDING_IMAGE_MAX_PIXELS / 1_000_000) * UNDERSTANDING_IMAGE_TOKENS_PER_MEGAPIXEL,
);

/**
 * pre-flight 的三种答案。
 *
 * `unknown` 是闸门**自己的**答案,不是一个「还没判」的中间态:该知道而不知道 ⇒ 不放行。
 * 上一版是反过来的(尺寸读不到就按 40 MiB 的字节兜底,两个都读不到就放行),而直接上传的
 * Asset 的宽高是 ingest 之后才补上的 —— 一张 48.77 MP 的照片在宽高还是 null 的窗口里
 * 只要字节数低于 40 MiB 就被放行,一次 doc-extract $0.003894 = **一条视频的 2.215%**,
 * 「不到 1%」当场破。字节数根本推不出像素数(JPEG 压缩比差一个量级),所以它不是一道弱一点
 * 的闸,它不是闸。
 *
 * 调用方**必须**把三种答案分开处理:`too-large` 是真终局(这份字节明天也读不动),
 * `unknown` 是资源类暂缓(元数据补齐之后就知道了),两者混在一起写终态就是把商家的素材
 * 永久忘掉 —— 见文件头「资源闸不许毁数据」。
 */
export type UnderstandingPreflight = "ok" | "unknown" | "too-large";

/** pre-flight 读的那几列(Asset 的子集)。 */
export interface UnderstandingMedia {
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | bigint | null;
  durationS?: number | null;
}

/**
 * 这张图跑不跑得起?**纯函数**,worker 在签 URL 之前问一次(问的时候一分钱还没花),
 * 供应商端口在发请求之前再问一次(同一个常量源,belt)。
 *
 * 尺寸读不到 = `unknown`。字节数**不再**是尺寸的替代品(见 {@link UnderstandingPreflight}),
 * 它只是尺寸之外的第二道上限:一张像素数合格但字节数病态的文件同样拦下。
 */
export function understandingImagePreflight(meta: UnderstandingMedia): UnderstandingPreflight {
  const w = Number(meta.width ?? Number.NaN);
  const h = Number(meta.height ?? Number.NaN);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "unknown";
  if (w * h > UNDERSTANDING_IMAGE_MAX_PIXELS) return "too-large";
  const bytes = Number(meta.sizeBytes ?? Number.NaN);
  if (Number.isFinite(bytes) && bytes > UNDERSTANDING_IMAGE_MAX_BYTES) return "too-large";
  return "ok";
}

/**
 * 这段视频跑不跑得起?时长由 ingest 的 ffprobe 补上,所以它和图片的宽高一样会有一段
 * 「还不知道」的窗口 —— 上一版把 null 当 0 秒读,于是**任意长度**的视频都过闸。
 */
export function understandingVideoPreflight(meta: UnderstandingMedia): UnderstandingPreflight {
  const seconds = Number(meta.durationS ?? Number.NaN);
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  if (seconds > UNDERSTANDING_VIDEO_MAX_SECONDS) return "too-large";
  return "ok";
}

/** 按 kind 分派到对应的那道闸。worker 与供应商端口共用这一个入口(同一常量源)。 */
export function understandingPreflight(
  kind: UnderstandingKind,
  meta: UnderstandingMedia,
): UnderstandingPreflight {
  return kind === "video-qa" ? understandingVideoPreflight(meta) : understandingImagePreflight(meta);
}

export interface UnderstandingCaps {
  /** 一次调用最坏情况的输入 token(记账用;真正的闸门见各 kind 的 pre-flight)。 */
  maxInputTokens: number;
  /** 一次调用允许的输出 token —— 这一条是**真闸门**,直接作为请求参数发出去。 */
  maxOutputTokens: number;
}

/**
 * 每个 kind 的 token 预算。改这里的任何一个数字,`understandingCostShare` 会跟着变,
 * 而 1% 断言就在那个函数上 —— 这就是「集中配置」在这个票里的具体含义。
 */
export const UNDERSTANDING_CAPS: Record<UnderstandingKind, UnderstandingCaps> = {
  // 一张产品照 + 一段简短的结构化描述。输入上限由图片 pre-flight 闸推出来(见上)。
  "image-caption": { maxInputTokens: UNDERSTANDING_IMAGE_MAX_INPUT_TOKENS, maxOutputTokens: 400 },
  // 一张菜单/价目表要读满整页文字,并吐出一串产品行 —— **同一张图**,所以输入闸门一样,
  // 只有输出比 caption 宽。
  "doc-extract": { maxInputTokens: UNDERSTANDING_IMAGE_MAX_INPUT_TOKENS, maxOutputTokens: 1_200 },
  // 抽帧后的门店视频 + 一段可读的店面理解。
  "video-qa": { maxInputTokens: UNDERSTANDING_VIDEO_MAX_INPUT_TOKENS, maxOutputTokens: 500 },
};

/** 一次理解调用的 USD 成本。纯函数,记账与预算共用同一条算式。 */
export function understandingCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  return (input * UNDERSTANDING_USD_PER_MTOKEN_IN + output * UNDERSTANDING_USD_PER_MTOKEN_OUT) / 1_000_000;
}

/** 一个 kind 最坏情况下花多少钱(全部吃满 token 上限)。 */
export function understandingWorstCaseUsd(kind: UnderstandingKind): number {
  const caps = UNDERSTANDING_CAPS[kind];
  return understandingCostUsd({ inputTokens: caps.maxInputTokens, outputTokens: caps.maxOutputTokens });
}

// ── 「不到一条视频的 1%」──────────────────────────────────────────────────────

/**
 * 对照基准:**我们卖得最便宜的那一条视频**的记账成本(480p × 引擎默认时长)。
 *
 * 取最便宜的一档而不是平均或最贵的一档,是因为承诺要在最不利的比较下也成立 ——
 * 拿 720p 当分母会让同一份 token 预算显得便宜一倍。
 */
export const CHEAPEST_VIDEO_COGS_USD = SEEDANCE_COGS_USD_PER_SECOND["480p"] * GEN_VIDEO_SECONDS;

/** 票面承诺的天花板:一次理解 < 一条视频成本的 1%。 */
export const UNDERSTANDING_VIDEO_COST_SHARE_CEILING = 0.01;

/** 一次理解最坏情况占一条视频成本的比例。测试对每个 kind 断言它 < 1%。 */
export function understandingCostShare(kind: UnderstandingKind): number {
  return understandingWorstCaseUsd(kind) / CHEAPEST_VIDEO_COGS_USD;
}

// ── 开关与预算(真正兜住花费的三样东西之二、之三)──────────────────────────────

/**
 * 总开关。`ASSET_UNDERSTANDING=off` 关掉;缺省 = 开。
 *
 * **它是暂停键,不是销毁键。** 扫描器每一轮都读它:关着就这一轮不派新活,已经排在
 * 队列里的行退回 QUEUED。开关打开,昨天那些素材照样会被读到。
 */
export const ASSET_UNDERSTANDING_ENV = "ASSET_UNDERSTANDING";
export function assetUnderstandingEnabled(env?: Env): boolean {
  const raw = (getEnv(env)[ASSET_UNDERSTANDING_ENV] ?? "").trim().toLowerCase();
  return raw !== "off" && raw !== "0" && raw !== "false";
}

/**
 * **平台**一天的理解花费**报警阈值**(USD)。回答的是「我们一天被账单多少钱之后要叫人」——
 * 那是一个 platform-wide 的问题,所以答案也必须是 platform-wide 的。
 *
 * 计量用的是**真实美元**,不是行数:`AssetUnderstanding` 上已经有 inputTokens /
 * outputTokens 两列,`understandingCostUsd()` 是现成的算式。数行数会在两头都错 ——
 * 一行失败但已经计费的读图数成 0,一行三次重试数成 1。
 *
 * ── 它不再是一道闸(Founder 2026-09-02 裁决,规格 §5 变更登记)────────────────────
 * $5/天是**平台自付时代**的止损线。MONEY-A9 之后理解是商家付费的 SKU,同一个数字就变成了
 * 一道**限制收入**的闸,而且是全平台先到先得:一个商家批量导入两千张图,当天所有商家的
 * 素材都被标成「明天再读」。所以裁决是两件事一起做 —— 默认抬到 $50/天,并且**只报警不拦**:
 * 超线时照记账、照读文件,发一条 founderAlert 三通道(每天最多一次),让人来看一眼是不是
 * 供应商那边出了异常烧钱的事。真正的花费上限现在是**商家自己的余额**(reserve-first)。
 *
 * 随之作废的一句话:`0` 曾经是「全停」的合法意图。现在 `0` 只是「每天都报警」——
 * 停掉理解的唯一开关是 {@link assetUnderstandingEnabled}(`ASSET_UNDERSTANDING=off`)。
 */
export const UNDERSTANDING_DAILY_BUDGET_USD_DEFAULT = 50;
export const UNDERSTANDING_DAILY_BUDGET_ENV = "ASSET_UNDERSTANDING_DAILY_BUDGET_USD";
export function understandingDailyBudgetUsd(env?: Env): number {
  // 空串/全空白算「没设」—— `Number("")` 是 0,而 0 是一个合法值(自 2026-09-02 起它的
  // 意思是「每天都越线、每天报警一次」,**不是**暂停;暂停走 ASSET_UNDERSTANDING=off)。
  // 不先挑出来,一个空环境变量就会被读成 Founder 亲自把线调到了 0。
  const raw = (getEnv(env)[UNDERSTANDING_DAILY_BUDGET_ENV] ?? "").trim();
  if (raw === "") return UNDERSTANDING_DAILY_BUDGET_USD_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : UNDERSTANDING_DAILY_BUDGET_USD_DEFAULT;
}

// ── 素材 → kind 的路由 ────────────────────────────────────────────────────────

/**
 * 一件素材**进门时**跑哪一个 kind。图片先跑 caption,视频跑 video-qa,其它一律不跑。
 *
 * doc-extract 刻意**不**在这里:菜单最常见的形态就是一张照片,而「这张图是不是一份
 * 菜单/价目表」要看过才知道。所以它由 caption 的结构化结果里那一位 `isDocument` 触发
 * (worker 建第二行)—— 先花三分之一分钱判一次,再决定要不要花第二次。
 */
export function understandingKindForMime(mime: string): UnderstandingKind | null {
  const base = (mime || "").trim().toLowerCase().split(";")[0]!.trim();
  if (base.startsWith("image/")) return "image-caption";
  if (base.startsWith("video/")) return "video-qa";
  return null;
}

// ── 结构化产物的形状(json_schema)───────────────────────────────────────────

/**
 * image-caption 的结构化产物。`isDocument` 是三件套之间唯一的连接线(见上)。
 * 每个字段都短,并且在 worker 落盘前再裁一次 —— 模型不是可信输入。
 */
export interface ImageCaptionData {
  /** 一句人话:商家会在「Otto 认识我的店」里读到的那句。 */
  summary: string;
  /** 品类(自由文本,商家自己的词汇;不做枚举,不替商家预判)。 */
  category?: string;
  /** 主色(自由文本,如 "warm terracotta")。 */
  colors?: string[];
  /** 场景/环境。 */
  scene?: string;
  /** 这张图是不是一份写满字的菜单/价目表/传单 —— 触发 doc-extract。 */
  isDocument: boolean;
}

/** doc-extract 的结构化产物 —— 直接对着 productRecordData 的形状收敛。 */
export interface DocExtractProduct {
  name: string;
  description?: string;
  /** 展示用文本("RM 12.90")。**永远不进任何计价/扣费逻辑**(同 productRecordData.price)。 */
  price?: string;
  category?: string;
}
export interface DocExtractData {
  products: DocExtractProduct[];
}

/** video-qa 的结构化产物。 */
export interface VideoQaData {
  summary: string;
  /** 落进品牌记忆的那几句(每句一条 Memory)。 */
  facts: string[];
}

/** 每个 kind 一次调用最多接受多少条数组项 —— 模型多吐的部分在 worker 侧截断。 */
export const UNDERSTANDING_MAX_PRODUCTS_PER_DOC = 40;
export const UNDERSTANDING_MAX_FACTS_PER_VIDEO = 5;
export const UNDERSTANDING_MAX_COLORS = 4;

/**
 * 供应商 `json_schema` 响应格式要用的原始 JSON Schema。刻意**不**从 zod 生成:
 * 这是发给供应商的线上契约,读者是那一端,写成什么样就该看得见什么样。
 * 校验仍然在 worker 侧用 zod 再做一遍(模型不是可信输入)。
 */
export const UNDERSTANDING_JSON_SCHEMAS: Record<UnderstandingKind, { name: string; schema: Record<string, unknown> } | null> = {
  "image-caption": {
    name: "image_caption",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "isDocument"],
      properties: {
        summary: { type: "string", maxLength: 300 },
        category: { type: "string", maxLength: 40 },
        colors: { type: "array", maxItems: UNDERSTANDING_MAX_COLORS, items: { type: "string", maxLength: 40 } },
        scene: { type: "string", maxLength: 120 },
        isDocument: { type: "boolean" },
      },
    },
  },
  "doc-extract": {
    name: "doc_products",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["products"],
      properties: {
        products: {
          type: "array",
          maxItems: UNDERSTANDING_MAX_PRODUCTS_PER_DOC,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: {
              name: { type: "string", maxLength: 120 },
              description: { type: "string", maxLength: 500 },
              price: { type: "string", maxLength: 60 },
              category: { type: "string", maxLength: 40 },
            },
          },
        },
      },
    },
  },
  "video-qa": {
    name: "video_store_read",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "facts"],
      properties: {
        summary: { type: "string", maxLength: 600 },
        facts: {
          type: "array",
          maxItems: UNDERSTANDING_MAX_FACTS_PER_VIDEO,
          items: { type: "string", maxLength: 300 },
        },
      },
    },
  },
};

/**
 * 每个 kind 的任务说明。写在 core 是因为它同时决定成本(输出长度)与产物形状 ——
 * 和 token 上限、json_schema 是同一件事的三面,分家就会各改各的。
 *
 * 措辞纪律:不替商家预判(Otto 开放式原则),不猜没看见的东西,看不出来就留空。
 */
export const UNDERSTANDING_PROMPTS: Record<UnderstandingKind, string> = {
  "image-caption":
    "You are looking at one photo from a small business owner's own library. " +
    "Describe what is actually visible so a marketing assistant can recognise it later: what the subject is, " +
    "the product category in the owner's own everyday words, the dominant colours, and the setting. " +
    "Never guess a brand, a price, or a claim you cannot see. Leave a field out when it is not visible. " +
    "Set isDocument to true only when the photo is mostly readable text — a menu, a price list, a flyer or a poster.",
  "doc-extract":
    "This picture is a menu, price list or product flyer from a small business. " +
    "Read every item you can see and return one row per item. " +
    "Copy names and prices exactly as printed, including the currency as printed. " +
    "Never invent an item, a price or a description that is not printed. " +
    "If the text is unreadable, return an empty products list rather than guessing.",
  "video-qa":
    "These frames are sampled from a short video of a small business's own premises or products. " +
    "Write a short read of the place a marketing assistant could use later: what the business appears to sell, " +
    "what the space and styling look like, and who seems to be there. " +
    "Then list the few durable facts worth remembering. " +
    "Only state what is visible in the frames — no guessed brand, location, price or claim.",
};

// ── 队列 ──────────────────────────────────────────────────────────────────────

/** 后台理解队列。生产者只有 worker 自己的扫描器(商家点不到「分析」——票面铁律)。 */
export const UNDERSTAND_QUEUE = "understand";
export const UNDERSTAND_DLQ = `${UNDERSTAND_QUEUE}.dlq`;

/** 一次理解调用的墙钟上限 —— 供应商请求的硬超时,也是队列过期链条的第一环。 */
export const UNDERSTANDING_REQUEST_TIMEOUT_MS = 90_000;

export const UNDERSTAND_RETRY_LIMIT = 2;

/**
 * UNDERSTAND_QUEUE_POLICY —— 与钱路队列的形状**刻意不同**,原因只有一个:
 * 这条队列不碰商家的余额。一次重试的代价是我们自己那不到千分之几的一分钱,
 * 而不是商家被扣第二次,所以它可以像 ingest 一样正常重试。
 * 真正防重复的是 AssetUnderstanding 行上的 `(ownerId, assetId, kind)` 唯一约束
 * 加 QUEUED→RUNNING 的 CAS:重投落在同一行上,第二次直接空转。
 *
 * expire 覆盖得住一次请求超时 + 落盘尾巴,并且严格大于它(clock 链条)。
 */
export const UNDERSTAND_QUEUE_POLICY = {
  retryLimit: UNDERSTAND_RETRY_LIMIT,
  retryBackoff: true,
  retryDelay: 60,
  expireInSeconds: 5 * 60,
  deadLetter: UNDERSTAND_DLQ,
} as const;

/** 队列载荷:只有行 id。租户从行上读,绝不从载荷里读。 */
export interface UnderstandJobData {
  understandingId: string;
}

// ── 产物清洗(模型不是可信输入)────────────────────────────────────────────────

function trimTo(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

/** 把模型吐出来的 JSON 收敛成 ImageCaptionData,或 null(形状不对 = 解析失败)。 */
export function parseImageCaption(raw: unknown): ImageCaptionData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = trimTo(o.summary, 300);
  if (!summary) return null;
  const colors = Array.isArray(o.colors)
    ? o.colors.map((c) => trimTo(c, 40)).filter((c): c is string => !!c).slice(0, UNDERSTANDING_MAX_COLORS)
    : undefined;
  return {
    summary,
    category: trimTo(o.category, 40),
    colors: colors && colors.length > 0 ? colors : undefined,
    scene: trimTo(o.scene, 120),
    isDocument: o.isDocument === true,
  };
}

/** 把模型吐出来的 JSON 收敛成 DocExtractData,或 null。空 products 是**合法**结果
 *  (票面:读不出来就不要猜)—— 不是解析失败。 */
export function parseDocExtract(raw: unknown): DocExtractData | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as Record<string, unknown>).products;
  if (!Array.isArray(list)) return null;
  const products: DocExtractProduct[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = trimTo(o.name, 120);
    if (!name) continue;
    products.push({
      name,
      description: trimTo(o.description, 500),
      price: trimTo(o.price, 60),
      category: trimTo(o.category, 40),
    });
    if (products.length >= UNDERSTANDING_MAX_PRODUCTS_PER_DOC) break;
  }
  return { products };
}

/** 把模型吐出来的 JSON 收敛成 VideoQaData,或 null。 */
export function parseVideoQa(raw: unknown): VideoQaData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = trimTo(o.summary, 600);
  if (!summary) return null;
  const facts = Array.isArray(o.facts)
    ? o.facts.map((f) => trimTo(f, 300)).filter((f): f is string => !!f).slice(0, UNDERSTANDING_MAX_FACTS_PER_VIDEO)
    : [];
  return { summary, facts };
}

/**
 * 解析供应商回来的那段文字为 JSON。`json_schema` 应该保证它就是一个对象,但
 * 「应该」不是契约的一部分 —— 票面要求 doc-extract 必须有解析失败兜底,而兜底
 * 只有在解析真的会失败时才有意义。围栏代码块与前后废话都在这里剥掉。
 */
export function parseUnderstandingJson(text: string): unknown | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  try {
    const parsed: unknown = JSON.parse(candidate);
    // 顶层必须是对象:每个 kind 的 schema 都是对象,一个裸数组是形状不对,不是「产物只是没包起来」。
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 商家读得到的措辞。白标,不带任何供应商/技术细节,English sentence case。
 *
 * 全部住在这里而不是散在 worker 里,是因为它们有**两个**读者:落进 `AssetUnderstanding.error`
 * 的那一次,和 Otto 把「这几件我没读」讲给商家听的那一次(recallStoreKnowledge)。
 * 两边各写一份,迟早有一边说的是另一回事。
 */
export const UNDERSTANDING_UNREADABLE = "That file couldn't be read clearly enough to use.";
export const UNDERSTANDING_INTERRUPTED = "That file wasn't finished being read — it will be picked up again.";
/** 真终局:这份字节按我们的预算读不动。明天也不会变,所以它配得上一个终态。 */
export const UNDERSTANDING_CLIP_TOO_LONG = "That clip is longer than the reading budget covers, so it was left unread.";
export const UNDERSTANDING_IMAGE_TOO_LARGE =
  "That picture is larger than the reading budget covers, so it was left unread.";
/** 资源类暂缓的措辞 —— 行退回 QUEUED,下一轮继续(不是终态)。 */
export const UNDERSTANDING_PAUSED = "Reading is paused right now.";
export const UNDERSTANDING_NO_MEDIA_URL = "This environment can't hand the file to the reader yet.";
export const UNDERSTANDING_METADATA_PENDING = "That file's dimensions aren't known yet — it will be read once they are.";
// `UNDERSTANDING_BUDGET_REACHED`(「今天的预算用完了,明天再读这份文件」)随 Founder
// 2026-09-02 的「只报警不拦」裁决一并删除:没有任何一条路径会再把一行退回队列说这句话,
// 留着一句永不出现的商家文案只会让下一个人以为那道闸还在。
/**
 * **PAUSED_BALANCE 的措辞**(MONEY-A9 计费四则④)。
 *
 * 和上面那句「今天的预算用完了」说的是两回事,商家要做的事也相反:那一句是**平台**侧的
 * 保险丝,商家什么都不用做、明天自己会读;这一句是**商家**余额不够,只有充值能让它继续。
 * 所以它必须点名 credits,并且说清楚文件还在(不是被丢掉了)—— 素材无限期保留,
 * credits 也不过期,商家隔多久回来充值都读得到。
 */
export const UNDERSTANDING_WAITING_FOR_CREDITS =
  "That file is waiting for credits — it will be read as soon as your balance covers it.";
/**
 * **PAUSED 的措辞** —— 这一句必须和 FAILED 那一句说的是两回事,因为它们要商家做的事相反。
 * 「读不清楚」的正确建议是传一份更清楚的;而这一行的文件本来就好好的,商家做什么都没用,
 * 也不该被叫去重传。所以它只说两件事:还没读到、会自己再来。
 */
export const UNDERSTANDING_PROVIDER_PAUSED =
  "That file hasn't been read yet — something on our side needs fixing first. It stays in line and will be read once that's sorted.";
