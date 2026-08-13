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
 *  2. **商家一分钱都不付。** 理解是平台成本,不进 CreditLedger,不 reserve/settle。
 *     真正兜住花费的是三样都在这个文件里的东西:总开关、每租户每日次数上限、每次调用的
 *     token 上限(以及 video 的时长闸门 —— 没有它,「每次 token 上限」只是许愿)。
 *  3. **白标。** 这个文件里没有供应商名字;产物里也不许出现(worker 落盘走 redact)。
 */

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
 *  SKIPPED = 决定不跑(开关关、超日额、素材太长/已删)—— 与 FAILED 不同,它不是故障。 */
export const UNDERSTANDING_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "SKIPPED"] as const;
export type UnderstandingStatus = (typeof UNDERSTANDING_STATUSES)[number];

/** 理解模型的**内部**代号。白标:对外(日志、卡面、Otto 的嘴)一律不出现供应商 id;
 *  内部 id → 供应商 id 的映射住在 @fikirtive/generation,和图片/视频引擎同一条纪律。 */
export const UNDERSTANDING_MODEL = "understand-mini";

// ── 单价与 token 上限(成本敏感,全部集中在此)────────────────────────────────

/** 理解模型牌价(USD / 1M token,票面给定)。 */
export const UNDERSTANDING_USD_PER_MTOKEN_IN = 0.1;
export const UNDERSTANDING_USD_PER_MTOKEN_OUT = 0.4;

/** 每个模型未动用的免费额度(token)。票面:「先烧免费额度」。
 *  它不是一道闸(供应商侧的账我们读不到),而是 `understandingRunsWithinFreeGrant()`
 *  的分子 —— 开机日志报一次「这份免费额度够跑多少趟」,运维据此决定要不要动真钱。 */
export const UNDERSTANDING_FREE_GRANT_TOKENS = 500_000;

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
  // 一张产品照 + 一段简短的结构化描述。
  "image-caption": { maxInputTokens: 4_000, maxOutputTokens: 400 },
  // 一张菜单/价目表要读满整页文字,并吐出一串产品行 —— 进出都比 caption 宽。
  "doc-extract": { maxInputTokens: 8_000, maxOutputTokens: 1_200 },
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

/** 一份免费额度够跑多少趟这个 kind(向下取整)。开机日志报它。 */
export function understandingRunsWithinFreeGrant(kind: UnderstandingKind): number {
  const caps = UNDERSTANDING_CAPS[kind];
  return Math.floor(UNDERSTANDING_FREE_GRANT_TOKENS / (caps.maxInputTokens + caps.maxOutputTokens));
}

// ── 开关与限额(真正兜住花费的三样东西之二、之三)──────────────────────────────

/** 总开关。`ASSET_UNDERSTANDING=off` 关掉;缺省 = 开。关掉后新行落 SKIPPED,不排队、不花钱。 */
export const ASSET_UNDERSTANDING_ENV = "ASSET_UNDERSTANDING";
export function assetUnderstandingEnabled(env?: Env): boolean {
  const raw = (getEnv(env)[ASSET_UNDERSTANDING_ENV] ?? "").trim().toLowerCase();
  return raw !== "off" && raw !== "0" && raw !== "false";
}

/** 每租户每日理解次数上限(默认 50)。这是**每个商家**的花费天花板:
 *  50 × 最贵 kind 的最坏情况 ≈ `understandingDailyCeilingUsdPerOwner()`。 */
export const UNDERSTANDING_DAILY_CAP_DEFAULT = 50;
export const UNDERSTANDING_DAILY_CAP_ENV = "ASSET_UNDERSTANDING_DAILY_CAP";
export function understandingDailyCap(env?: Env): number {
  // 空串/全空白算「没设」—— `Number("")` 是 0,而 0 在这里是「全停」这个合法意图。
  // 不先挑出来,一个空环境变量就会被读成 Founder 亲自把理解关了。
  const raw = (getEnv(env)[UNDERSTANDING_DAILY_CAP_ENV] ?? "").trim();
  if (raw === "") return UNDERSTANDING_DAILY_CAP_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : UNDERSTANDING_DAILY_CAP_DEFAULT;
}

/** 一个商家一天最多能让我们花多少钱(按最贵的 kind 全吃满算)。纯函数,供开机日志与测试。 */
export function understandingDailyCeilingUsdPerOwner(env?: Env): number {
  const worst = Math.max(...UNDERSTANDING_KINDS.map(understandingWorstCaseUsd));
  return understandingDailyCap(env) * worst;
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

/** 商家读得到的失败措辞。白标,不带任何供应商/技术细节。 */
export const UNDERSTANDING_UNREADABLE = "That file couldn't be read clearly enough to use.";
export const UNDERSTANDING_INTERRUPTED = "That file wasn't finished being read — it will be picked up again.";
