/**
 * Pure spend-snapshot helpers (OPT-6 P3a). RECORD-ONLY: the worker calls these at
 * the commit point to freeze GenJob.spentUsd / RefGenJob.spentUsd, exactly when
 * money is committed (like Generation.entitySnapshot). NO prisma, NO LLM — pure
 * functions over the price truth in gen.ts/refgen.ts so the money-critical worker
 * write is one byte-stable call. The USD snapshots never gate or influence spend.
 * EXCEPTION (2026-07-04 宪法 5 margin floor): isFlatPricedVideoModel below IS
 * consulted by the spend gate (model-config.assertSpendableModel) — only video
 * models with a flat, margin-floored price are sellable.
 */
import { costPinValue } from "./cost-pins.js";
import {
  GEN_PRICE_USD_PER_IMAGE,
  GEN_VIDEO_MODELS,
  GEN_VIDEO_MODEL_OPTIONS,
  REFERENCE_VIDEO_COGS_USD,
  SEEDANCE_COGS_USD_PER_SECOND,
  videoPriceUsd,
  videoDefaults,
  type GenVideoModel,
} from "./gen.js";
import { REFGEN_PRICE_USD_PER_IMAGE } from "./refgen.js";
import {
  UNDERSTANDING_KINDS,
  understandingWorstCaseUsd,
  type UnderstandingKind,
} from "./asset-understanding.js";

/** Exactly the GenJob fields the price needs (a subset of the row). */
export interface GenSpendInput {
  kind: "IMAGE" | "VIDEO";
  model: string;
  count: number;
  referenceVideoGenerationId?: string | null;
  /** GenJob.videoOptions Json: { seconds, resolution, aspectRatio, fps, audio }. */
  videoOptions: { seconds?: number; resolution?: string; audio?: boolean } | null;
}

/** Frozen USD for a committed GenJob. Video: videoPriceUsd over the job's resolved
 *  options (fall back to the model's defaults exactly as the worker does at the
 *  provider call — never NaN). Image: flat per-image × count. */
export function genSpentUsd(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    // #644 记账真相:整段参考视频的 COGS 基准搬去 gen.ts 与其它成本基准同住,并按官方
    // token 公式重算($0.85 → $0.78408)。这是**记账**,不是收费 —— 收费仍是下面
    // pricedGenCredits 里的 REFERENCE_VIDEO_CREDITS(16cr),本次一格没动。
    // #769 现值 $0.49896(换 mini 的 v2v 牌价 $2.10/M);上面那个 $0.78408 是 fast 时代的
    // 史注,现值只有一站:gen.ts 的 REFERENCE_VIDEO_COGS_USD ← cost-pins.ts 的钉点。
    if (job.model === "seedance-2-mini" && job.referenceVideoGenerationId) return REFERENCE_VIDEO_COGS_USD;
    const d = videoDefaults(job.model as GenVideoModel);
    return videoPriceUsd(job.model as GenVideoModel, {
      seconds: job.videoOptions?.seconds ?? d.seconds,
      resolution: job.videoOptions?.resolution ?? d.resolution,
      audio: job.videoOptions?.audio ?? d.audio,
      count: job.count,
    });
  }
  return GEN_PRICE_USD_PER_IMAGE * job.count;
}

/** Exactly the RefGenJob fields the price needs. */
export interface RefGenSpendInput {
  model: string;
  count: number;
}

/** Frozen USD for a committed RefGenJob. Uses refgen's OWN per-image constant
 *  (REFGEN_PRICE_USD_PER_IMAGE — same value as GEN_PRICE today but independent). */
export function refgenSpentUsd(job: RefGenSpendInput): number {
  return REFGEN_PRICE_USD_PER_IMAGE * job.count;
}

// ── Credit pricing (closed-beta P2) ─────────────────────────────────────────────
// The CREDIT ledger is the spend cap (M1). Two distinct numbers:
//  - pricedGenCredits / pricedRefgenCredits = the CHARGE we debit the user, deterministic,
//    in INTERNAL credits (1 internal credit = $0.01), with margin. RESERVE and SETTLE both
//    use this exact value → reserve == settle, no variable delta.
//  - genSpentUsd / refgenSpentUsd (above) = the true engine COST, record-only. Margin = the gap.

/** Internal credit accounting unit: 1 internal credit = $0.01. balance/ledger are internal. */
export const CREDITS_PER_USD = 100;
/** Display denomination: 1 user-facing credit = 10 internal = $0.10. Charges are whole
 *  displayed credits (×10 internal) so per-action costs read as small round numbers. */
export const INTERNAL_PER_DISPLAY = 10;

/** 收费用**按秒/按档的价目表**的视频模型(BytePlus Seedance —— 价来自 Founder 已裁的
 *  价目表,不是 record-only 的 COGS)。#647 T6 之后,菜单上只剩这一台;这个集合仍然独立
 *  存在,因为「在菜单上」与「已经有一个清得了毛利地板的价」是两回事 —— 上架一台新引擎
 *  绝不能因为进了菜单就自动可售。不在这个集合里的 = 卖不了,只能落护栏价。
 *
 *  #769:换 fast→mini 走的是**换 key**,正是为了让这条纪律真的执行一次 —— 在同一个
 *  key 底下换后端 id,新引擎就不必进这个集合也能卖,这道闸就只剩一句话。mini 是被
 *  Founder 单独裁过价(价目表一格不动、毛利闸重跑全绿)之后才写进来的。 */
export const FLAT_PRICED_VIDEO_MODELS = new Set<string>(["seedance-2-mini"]);
export function isFlatPricedVideoModel(model: string): boolean { return FLAT_PRICED_VIDEO_MODELS.has(model); }

/* ─────────────────────── 定价推导区(S2 §7.2 / MONEY-A1)───────────────────────
 *
 * 这一段是**全仓唯一的价目来源**。以前这里躺着一张按分辨率手抄的每 10 秒 credits 表
 * —— 数字本身没错(它们就是 Founder 裁的价),错的是**没人知道它们是怎么来的**:
 * 供应商涨价时,没有任何机器会告诉我们「这个价现在卖亏了」。A1 于是把方向反过来 ——
 * 成本(`cost-pins.ts`)是输入,价格是**算出来的输出**,改价的唯一路径是改钉点 + Founder 批。
 *
 * 公式一条:**售价 = 成本 ÷ (1 − 65%)**,再向上取整到收费格(按秒 SKU 取到「每 10 秒
 * 整数显示 credits」,按件 SKU 取到整显示 credit)。允许把结果**上调**到好记数,
 * 绝不许落到公式价之下 —— 由本区末尾的启动断言把守。
 *
 * **两种收费格,不是一种**(S2 §7.3 / MONEY-A9 起):生成侧(图片 / 视频 / 参考视频)取整到
 * **显示 credit**(1 显示 = 10 internal = $0.10),因为一条视频的成本本来就是几毛到几块;
 * 素材理解取整到 **internal credit**(1 internal = $0.01),因为它的最坏成本只有 $0.0013–$0.0016
 * 一件 —— 拿显示格去套会把它卖成 $0.10/件,溢价 25 倍以上,而没有任何一次裁决说过那件事。
 * 格子选哪一档是**定价法的一部分**,理由写在 `deriveUsageInternalCredits` 的头上。
 */

/**
 * **生成侧 SKU 的目标毛利** = 65%(S1 冻结的定价法,规格 §7.2)。
 *
 * 与宪法 5 的 45% 不是一回事,别互相替代:45% 是**地板**(跌破就不许卖),
 * 65% 是**目标**(定价照它算)。后续毛利闸(A2)与这里消费同一个常量,两边不可能漂移。
 */
export const GEN_MARGIN_TARGET = 0.65;

/**
 * 向上取整到收费格 —— `Math.ceil` 之前先减一个**相对量级**的容差。
 *
 * ① **容差只为吞浮点噪声**:IEEE754 里「恰好压在整数上」的除法常常落在整数**之上**
 *    一丁点,实证 `0.035 / 0.35 * 10 = 1.0000000000000002`(相对误差 ~2e-16),裸 `ceil`
 *    会把 1 显示 credit 抬成 2 —— 图片档凭空贵一倍,而没有任何一次裁决说过这件事。
 *    1e-12 的**相对**容差足够盖住这一位噪声,还留了四个数量级的余量。
 * ② **为什么从绝对 1e-9 改成相对量级**:绝对容差是一条固定宽度的漏收带 —— 公式价落在
 *    `(n, n+1e-9]` 里就会被压回 n,少收一格。改相对量级后这条带压到 ~1e-12;而钉点是
 *    十进制人手录入的(最细到 1e-4 位),它经 65% 公式算出来的真实价在数学上不可能落进
 *    这条带里,只有浮点噪声才进得去。
 * ③ 判官 P0-1 的反例(单件成本 $0.0350000000175 → 公式价 1.0000000005cr,规格要求
 *    ceil 到 **2cr**,旧的绝对容差却压成 1cr,启动断言与 65% 闸同时漏过)已入回归测试
 *    (`money-derivation.test.ts` 的「判官 P0-1」两组用例)。
 */
function ceilToPriceGrid(x: number): number {
  return Math.ceil(x - Math.max(Math.abs(x) * 1e-12, Number.EPSILON));
}

/** 按秒 SKU:每秒成本(USD)→ **每 10 秒的整数显示 credits**(§7.2 的按秒取整格)。 */
export function deriveVideoDisplayPer10s(cogsPerSecondUsd: number): number {
  const priceUsdPer10s = (cogsPerSecondUsd * 10) / (1 - GEN_MARGIN_TARGET);
  return ceilToPriceGrid((priceUsdPer10s * CREDITS_PER_USD) / INTERNAL_PER_DISPLAY);
}

/** 按件 SKU(图片 / 参考图 / 整段参考视频):单件成本(USD)→ 整数显示 credits。 */
export function deriveImageDisplayCredits(costUsd: number): number {
  const priceUsd = costUsd / (1 - GEN_MARGIN_TARGET);
  return ceilToPriceGrid((priceUsd * CREDITS_PER_USD) / INTERNAL_PER_DISPLAY);
}

/**
 * **小额按件 SKU(素材理解)**:单件成本(USD)→ 整数 **internal** credits(1 internal = $0.01)。
 *
 * 同一条 65% 公式,**换了收费格**,而换格这件事必须在这里说清楚,否则下一个人只会看到
 * 「为什么理解不用 deriveImageDisplayCredits」:
 *
 * 理解一件的最坏成本是 **$0.00128 / $0.0016 / $0.0014**(看图 / 读文档 / 看视频),公式价
 * 分别是 $0.00366 / $0.00457 / $0.0040。取到**显示格**($0.10)会把这三个数一律抬到
 * **$0.10 一件 —— 相对公式价溢价 22–27 倍**,而 Founder 裁的是「就是用户使用照算」
 * (2026-08-31),不是「按最小收费格收」。取到 internal 格($0.01)则一律落在 **1 internal**,
 * 溢价 2.2–2.7 倍,毛利率 84–87%(仍高于 65% 目标线,那是向上取整的必然结果,不是加价)。
 *
 * 换句话说:格子越粗,小额 SKU 被取整抬得越狠。生成侧一条视频成本几毛,显示格的取整噪声
 * 只有几个百分点;理解一件成本一分钱都不到,显示格的取整噪声就是价格本身。
 * **加价要 Founder 裁,取整格不该替他裁。**
 */
export function deriveUsageInternalCredits(costUsd: number): number {
  const priceUsd = costUsd / (1 - GEN_MARGIN_TARGET);
  return ceilToPriceGrid(priceUsd * CREDITS_PER_USD);
}

/**
 * 1080p 档的每秒成本 = **$0.3773385/s**,由**两条钉点**推导(单价 × 实测 token 数):
 * $0.0077/K × 245,025 tokens / 5 秒。今日的成本函数对 1080p 是回退 720p 档的
 * (`videoRateUsdPerSec`),那个回退值比真值便宜五倍,拿它定价就是卖一单亏一单 ——
 * 所以 1080p 的价必须走自己的钉点,不许借 720p 的。
 * 导出是给后续毛利闸(A2)复算用的:价与成本必须是同一个数说了算。
 */
export const SEEDANCE_1080P_COGS_USD_PER_SECOND =
  (costPinValue("video:seedance-2.0:1080p-per-ktoken") *
    costPinValue("video:seedance-2.0:1080p-tokens-per-5s")) /
  1000 /
  5;

/** 每档的每秒成本(推导输入)。480p/720p 来自 gen.ts 的按档最差比例基准,1080p 来自上面两条钉点。 */
const VIDEO_COGS_USD_PER_SECOND: Record<string, number> = {
  "480p": SEEDANCE_COGS_USD_PER_SECOND["480p"],
  "720p": SEEDANCE_COGS_USD_PER_SECOND["720p"],
  "1080p": SEEDANCE_1080P_COGS_USD_PER_SECOND,
};

/**
 * **好记数上调表** —— 这张表里的数字是本文件唯一允许的人工价格,语义只有一个:
 * 「公式价太难记,往**上**调到一个整数」。
 *
 * 今天只有一格:1080p 公式价 10.7811cr/秒 → Founder 已裁 **11cr/秒**(= 每 10 秒 110),
 * S1 定死。允许上调到好记数,**绝不落到公式价之下** —— 由 `assertDerivedPricing` 把守:
 * 供应商哪天涨价把公式价顶过 110,启动就炸,而不是继续静静卖亏。
 */
export const MEMORABLE_PER_10S_OVERRIDES: Record<string, number> = { "1080p": 110 };

/**
 * **现役视频引擎的按秒价目表**(每档「每 10 秒多少显示 credits」的整数分子)。
 *
 * 数字来源变了,数字本身没变:480p=11 / 720p=22 仍是 Founder 2026-08-06 裁的价
 * (留档 https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/645#issuecomment-5202464378),
 * 只是现在由 65% 公式从成本钉点**算出来**而不是抄进来 —— 复算逐格相等,
 * `video-tiers.test.ts` 的 24 格与 `money-anchor.test.ts` 的价格锚都是这次重构的回归钉板。
 *
 * 为什么存「每 10 秒」的整数而不是 1.1 / 2.2:后者在 IEEE754 里都不是精确值,直接乘
 * 会让某些时长差一格 credit,而差一格 credit 就是 quote / reserve / settle 三处对不上。
 */
export const SEEDANCE_DISPLAY_CREDITS_PER_10S: Record<string, number> = Object.fromEntries(
  Object.entries(VIDEO_COGS_USD_PER_SECOND).map(([resolution, cogsPerSecondUsd]) => [
    resolution,
    MEMORABLE_PER_10S_OVERRIDES[resolution] ?? deriveVideoDisplayPer10s(cogsPerSecondUsd),
  ]),
);

/** 在售的图片档 = seedream lite,**1 显示 credit/张**(公式价恰好 1.0000,进位余量 $0.00)。
 *  「恰好」是设计意图:供应商图价任何上涨都会把公式价顶过 1,启动断言当场炸 = 等 Founder 重定价。 */
export const IMAGE_DISPLAY_CREDITS_PER_IMAGE = deriveImageDisplayCredits(
  costPinValue("image:seedream-lite:per-image"),
);

/** pro 图档 = **2 显示 credits/张**(S1 已定死的两个回填数字之一)。
 *  数字随本稿落地,**上架**归 Creation 施工线 —— 今天 `GEN_MODELS` 的图片菜单只有 seedream(=lite),
 *  所以这个常量今天没有调用方,它先把价钉在推导上,免得上架那天又手抄一个数。 */
export const PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE = deriveImageDisplayCredits(
  costPinValue("image:seedream-pro:per-image"),
);

/**
 * 整段参考视频的定额价 = **16 显示 credits/条**,是一个好记数上调:
 * 公式价 = ceil($0.49896 ÷ 0.35 × 10) = **15**,现价 16 高于它一格,不动
 * (#644/#645/#769 三次改成本都没动过这个收费,这次也不动)。
 */
export const REFERENCE_VIDEO_CREDITS = 16;

/**
 * **素材理解三类的按件价目**(S2 §7.3 / MONEY-A9,Founder 2026-08-31 裁决「就是用户使用照算」)。
 *
 * 单位是 **internal credits**(1 internal = $0.01),不是显示 credits —— 理由在
 * `deriveUsageInternalCredits` 的头上,一句话:显示格会把 $0.0016 的成本卖成 $0.10。
 *
 * 表**从 `UNDERSTANDING_KINDS` 枚举出来**,不是三行手抄:理解三件套哪天加第四类
 * (票面第二批),这张表当场多一格、毛利闸当场要它的成本 —— 而手抄一份的话,新 kind 只会
 * 安静地没有价,然后在 worker 里落成 undefined。成本一律现取 `understandingWorstCaseUsd`
 * (token 上限 × 成本钉点),所以改 token 上限或改钉点,价当场跟着动。
 *
 * 现值:三类各 **1 internal = 0.1 显示 credit / 件**(公式价 0.366 / 0.457 / 0.400,全部进位到 1)。
 */
export const UNDERSTANDING_PRICED_INTERNAL: Record<UnderstandingKind, number> = Object.fromEntries(
  UNDERSTANDING_KINDS.map((kind) => [kind, deriveUsageInternalCredits(understandingWorstCaseUsd(kind))]),
) as Record<UnderstandingKind, number>;

/**
 * 一件素材理解收多少 **internal credits**。比照 `pricedGenCredits` 的身份:这是
 * **商家真被扣的那一笔**,reserve 与 settle 用的是同一个值(理解没有可变用量档,
 * 所以 reserve == settle 恒成立,不存在差额)。
 *
 * 计费四则①:结算按**上传时刻**的价目 —— 那份快照由 `AssetUnderstanding.priceInternalSnapshot`
 * 落行时锁住,worker 结算读快照而不是重新调本函数。本函数是**报价**(上传那一刻、披露那一刻),
 * 不是结算;调价不追溯(MONEY-A7)靠的就是这个分工。
 */
export function pricedUnderstandingCredits(kind: UnderstandingKind): number {
  return UNDERSTANDING_PRICED_INTERNAL[kind];
}

/** 一条可复算的价目行:现价 vs 公式价。启动断言逐行查。 */
export type DerivedPriceRow = { tier: string; charged: number; formula: number };

/**
 * **启动断言**(A1 的守门人)。纯函数、接受注入的行,所以可以单独测「override 低于公式价
 * 就该炸」而不必真去改钉点。
 *
 * 两条判据:① 现价必须是正整数显示 credit(0 或负数 = 免费出片);② 现价**绝不许低于
 * 公式价** —— 低了就是成本涨穿了定价,继续卖就是每单亏钱。判词写成人话是故意的:
 * 收到这条报错的人要能直接看懂下一步是「停售等 Founder 重定价」,而不是先去读代码。
 */
export function assertDerivedPricing(rows: readonly DerivedPriceRow[]): void {
  for (const row of rows) {
    if (!Number.isInteger(row.charged) || row.charged <= 0) {
      throw new Error(
        `定价断言失败:${row.tier} 现价 ${row.charged} 不是正整数显示 credit —— 价目表坏了,先停售再修。`,
      );
    }
    if (row.charged < row.formula) {
      throw new Error(
        `定价断言失败:${row.tier} 现价 ${row.charged}cr 低于公式价 ${row.formula}cr —— 供应商成本已涨穿定价,停售等 Founder 重定价。`,
      );
    }
  }
}

/**
 * 本模块推导出来的全部在售价目行(视频逐档 + 图片两档 + 整段参考视频 + 理解三类)。
 *
 * **一行之内单位自洽,行与行之间不必同格**:`assertDerivedPricing` 只把同一行的
 * `charged` 与 `formula` 相比,两者都是那一行自己的格(生成侧=显示 credit,理解=internal
 * credit),所以混在一张表里不会算错。行名里写明格子,是为了让断言炸出来的那句话
 * 不用读代码也能看懂是哪一格的多少钱。
 */
export function derivedPriceRows(): DerivedPriceRow[] {
  return [
    ...Object.entries(SEEDANCE_DISPLAY_CREDITS_PER_10S).map(([resolution, charged]) => ({
      tier: `视频 ${resolution}(每 10 秒)`,
      charged,
      formula: deriveVideoDisplayPer10s(VIDEO_COGS_USD_PER_SECOND[resolution]!),
    })),
    {
      tier: "图片 seedream-lite(每张)",
      charged: IMAGE_DISPLAY_CREDITS_PER_IMAGE,
      formula: deriveImageDisplayCredits(costPinValue("image:seedream-lite:per-image")),
    },
    {
      tier: "图片 seedream-pro(每张)",
      charged: PRO_IMAGE_DISPLAY_CREDITS_PER_IMAGE,
      formula: deriveImageDisplayCredits(costPinValue("image:seedream-pro:per-image")),
    },
    {
      tier: "整段参考视频(每条)",
      charged: REFERENCE_VIDEO_CREDITS,
      formula: deriveImageDisplayCredits(REFERENCE_VIDEO_COGS_USD),
    },
    // 理解三类(MONEY-A9)。charged 与 formula 同源同值 —— 理解**没有好记数上调**,
    // 价就是公式价。两边都写出来不是重复:上调表哪天要加理解格,断言当场按同一条规矩管它。
    ...UNDERSTANDING_KINDS.map((kind) => ({
      tier: `理解 ${kind}(每件,internal 格)`,
      charged: UNDERSTANDING_PRICED_INTERNAL[kind],
      formula: deriveUsageInternalCredits(understandingWorstCaseUsd(kind)),
    })),
  ];
}

// 模块加载即断言:生产 fail closed(进程起不来好过静静卖亏),CI 里任何 import 本模块的
// 测试都会先炸 —— 于是「成本涨穿定价」这件事不可能悄悄过去。
assertDerivedPricing(derivedPriceRows());

/**
 * 一档视频的显示 credits。**返回 null = 这一档不按秒计价**,调用方必须落到护栏价,
 * 有两种情形:
 *   ① 分辨率不在按秒表上(未知分辨率;1080p 自 S2 起**在**表上,见推导区);
 *   ② 秒数**不属于这个模型开出来的档位**。
 *
 * ② 的判据是**档位归属**,不是「正整数」——
 * **价格只定义在 Founder 裁过的那些格上;格外不 round、不外推,只有护栏。**
 * 三种错法都被这一条挡住:
 *   - `0.4s` 若 round 成 0 ⇒ 0 credits,而 `reserveCredits` 对 cost<=0 直接跳过
 *     (packages/db/src/credits.ts),那是一条**免费**的付费任务;
 *   - `4.4s` 若 round 成 4 ⇒ 9cr,一个从没被裁过的价;
 *   - `3s` / `16s` 是**正整数**,但同样不在已裁的十二格里,按公式外推会得到
 *     7cr / 36cr —— 同样是替 Founder 发明价格。
 * 档位归属一次覆盖三者:非整数、0、负数、NaN、∞ 都不可能命中 durations 表。
 *
 * 判据的**单一事实来源**是能力表 `GEN_VIDEO_MODEL_OPTIONS[model].durations` ——
 * 菜单上开了哪几档,就只有那几档有价。这里刻意不抄一份 [4..15] 字面量:抄一份,
 * T6 或未来任何一次改档就会让「卖什么」和「收多少」分家。
 *
 * 为什么防线必须长在钱函数自己身上:新请求那一侧有 zod `.int()` 与档位校验拦着,
 * 但 `GenJob.videoOptions` 是**无约束 JSON**,worker 结算后重算展示价的两条路
 * (apps/worker/src/jobs/gen.ts 的 GEN_RESULT 两处)直达这里,那条路上没有 zod。
 *
 * 纯整数运算:seconds 与 per10s 都是整数,+9 再整除 10 就是向上取整,不经过任何小数 ——
 * 浮点差一格 credit 的路在这里根本不存在。
 */
export function seedanceDisplayCredits(model: string, resolution: string, seconds: number): number | null {
  const per10s = SEEDANCE_DISPLAY_CREDITS_PER_10S[resolution];
  if (per10s === undefined) return null;
  const ruledDurations = GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel]?.durations;
  if (!ruledDurations?.includes(seconds)) return null;
  return Math.floor((seconds * per10s + 9) / 10);
}

/** 护栏用的「最贵可售档按秒价」= 价目表里最大的每 10 秒费率(今天 = 1080p 的 110)。
 *  未知分辨率按它计:不知道卖的是哪一档,就按最贵的那档收。 */
const MAX_DISPLAY_CREDITS_PER_10S = Math.max(...Object.values(SEEDANCE_DISPLAY_CREDITS_PER_10S));

/** 护栏用的「最长可售时长」——从能力表**现算**,不抄 15 这个字面量(菜单改档,护栏跟着改)。 */
const MAX_GUARDRAIL_SECONDS = Math.max(
  ...Object.values(GEN_VIDEO_MODEL_OPTIONS).flatMap((o) => [...o.durations]),
);

/**
 * **护栏价**(MONEY-A3):算不出正规档位价时收多少。血统还是那一句「宁可贵,不许贱卖」,
 * 但判据从「一个定额」改成「**按档**」。
 *
 * 为什么必须改:旧写法是一律 16cr。16cr = $1.60,而 1080p 5 秒的成本就是 $1.89 ——
 * 毛利 −17.9%,15 秒档更是 −253.8%。**一个定额挡不住长档**:时长越长越亏,而护栏
 * 本来就是给「不知道这是什么」的行兜底的,它必须随时长走。
 *
 * 四条规矩:
 *   ① 费率取**这一档自己的**每 10 秒价;分辨率不认识就取全表最贵的那档(宁可贵)。
 *   ② 秒数畸形(0 / 负数 / NaN / ∞ / 空串 / 垃圾串 / 根本不是数)→ 按**最长可售档**计。
 *      畸形不等于免费:`reserveCredits` 对 cost<=0 直接跳过,那就是一条真的免费付费任务。
 *   ③ **数字长相的字符串秒数(`"16"`)按它的实秒收**,不按最长可售档封顶 —— 判官 P0-2:
 *      不能把安全性寄托在供应商一定拒绝字符串上。`GenJob.videoOptions` 是无约束 JSON,
 *      worker 那条路只做 TS 强转就把它原样发给付费供应商(apps/worker/src/jobs/gen.ts:1227
 *      的 cast → :1241 的 durationSeconds → packages/generation/src/byteplus.ts),供应商真把
 *      `"16"` 当 16 秒执行时,公式护栏价是 1760 而封顶只收 1650 —— **少收 11cr**。
 *      数字长相的坏数据按它可能被执行的实秒收:收多不收少,方向和这条护栏的血统一致。
 *   ④ 正的非整数秒向上取整(4.5s 按 5s 收),同样是「宁可贵」的方向。
 *
 * 与「价格只定义在已裁格上」那条纪律不冲突:护栏价**不是**一个 Founder 裁过的菜单价,
 * 它是这一档的**毛利地板**(≥ 65% 公式价)。菜单价只在 `seedanceDisplayCredits` 里,
 * 那里照旧只认已裁的档位,一格不外推。
 *
 * 取整走**纯整数**(`+9` 再整除 10 = 向上取整,与 `seedanceDisplayCredits` 同一个写法):
 * 秒数与费率到这里都已是整数,不经过小数就没有浮点容差这回事 —— 上面 `ceilToPriceGrid`
 * 的相对容差是给「成本 ÷ 0.35」那种真除法准备的,这里不需要,也不该借。
 */
export function videoGuardrailInternal(resolution: string, seconds: unknown): number {
  const ratePer10s = SEEDANCE_DISPLAY_CREDITS_PER_10S[resolution] ?? MAX_DISPLAY_CREDITS_PER_10S;
  const billedSeconds = guardrailBilledSeconds(seconds);
  const displayCreditsCharged = Math.floor((billedSeconds * ratePer10s + 9) / 10);
  return displayCreditsCharged * INTERNAL_PER_DISPLAY;
}

/** 护栏计费秒数(规矩 ②③④ 的实现):正的有限数 → 向上取整;数字长相的字符串 → 先转数
 *  再向上取整(判官 P0-2);其余一切 → 最长可售档。 */
function guardrailBilledSeconds(seconds: unknown): number {
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  if (typeof seconds === "string" && seconds.trim()) {
    const parsed = Number(seconds);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }
  return MAX_GUARDRAIL_SECONDS;
}

export function pricedGenCredits(job: GenSpendInput): number {
  if (job.kind === "VIDEO") {
    if (isFlatPricedVideoModel(job.model)) {
      if (job.referenceVideoGenerationId) return REFERENCE_VIDEO_CREDITS * INTERNAL_PER_DISPLAY;
      const d = videoDefaults(job.model as GenVideoModel);
      const r = job.videoOptions?.resolution ?? d.resolution;
      const seconds = job.videoOptions?.seconds ?? d.seconds;
      const perSecond = seedanceDisplayCredits(job.model, r, seconds); // #645 T4: 按秒计价的档
      if (perSecond !== null) return perSecond * INTERNAL_PER_DISPLAY;
      return videoGuardrailInternal(r, seconds); // 未知分辨率 / 档外秒数 → 按档护栏价(A3)
    }
    // #647 T6:走到这里的只可能是**菜单外的模型** —— 下架前存下的历史行。
    // 旧写法是 `displayedFromUsd(genSpentUsd(job))`,靠那 12 台假引擎各自抄来的费率反推价;
    // 引擎下架、费率随之作废(videoRateUsdPerSec 回 0),那条路会算出 1cr —— 一条视频卖
    // 一毛钱。同一条护栏语义(「宁可贵,不许贱卖」)在这里也必须成立:算不出价就落护栏价。
    // 新的付费请求永远到不了这一行(契约闸 + assertSpendableModel 只放行在产那一台),
    // 所以这只是历史行读价时的兜底 —— A3 起兜底也按档走,长档不再被一个定额贱卖。
    return videoGuardrailInternal(job.videoOptions?.resolution ?? "", job.videoOptions?.seconds);
  }
  return job.count * IMAGE_DISPLAY_CREDITS_PER_IMAGE * INTERNAL_PER_DISPLAY;
}

/**
 * 这一单**走了护栏价**吗?(A3 的结算路径报警判据)
 *
 * 护栏价按定义只该给「历史行 / 畸形 JSON」兜底。一条**新**的付费任务走到护栏上,
 * 意思是菜单闸被绕过去了 —— 那是要人看一眼的事,不是静静收一笔更贵的钱就算了。
 * 纯函数,判据与 `pricedGenCredits` 同一条(同源可查):不是参考视频、且按秒表算不出价。
 */
export function isGuardrailPricedVideo(job: GenSpendInput): boolean {
  if (job.kind !== "VIDEO") return false;
  if (job.referenceVideoGenerationId) return false;
  if (!isFlatPricedVideoModel(job.model)) return true; // 菜单外的历史 id:整条路只有护栏
  const d = videoDefaults(job.model as GenVideoModel);
  const r = job.videoOptions?.resolution ?? d.resolution;
  const seconds = job.videoOptions?.seconds ?? d.seconds;
  return seedanceDisplayCredits(job.model, r, seconds) === null;
}

/** DETERMINISTIC charge in INTERNAL credits for a refgen job. 参考图与生成图同一张钉点
 *  (seedream lite,每张 $0.035)⇒ 同一个推导价,不再各抄一份「1 显示 credit」。 */
export function pricedRefgenCredits(job: RefGenSpendInput): number {
  return job.count * IMAGE_DISPLAY_CREDITS_PER_IMAGE * INTERNAL_PER_DISPLAY;
}
/** Internal credits → user-facing displayed credits (view seam only — never feed this
 *  back into the ledger/balance, which are always internal). */
export function displayCredits(internal: number): number {
  return internal / INTERNAL_PER_DISPLAY;
}

/** A new org's one-time welcome grant (internal credits, 1 = $0.01).
 *
 *  25 DISPLAYED credits = 25 × INTERNAL_PER_DISPLAY internal — the #791 Founder decision
 *  (2026-08-08). It lands only AFTER the merchant verifies their email.
 *
 *  Why 25 and not 20: the signup page promises "a full run: a conversation with Otto, an
 *  image, and a short video". #543 sized the grant at 20 when that run cost ≈ 9.5 (a full
 *  conversation) + 8 (a 5s video). #644 then repriced 5s video 8 → 11 displayed credits,
 *  and the promise quietly stopped being buyable: 9.5 + 1 + 11 ≈ 21.5 > 20. The #543 note
 *  said so in this very comment and left the grant alone, so the page kept promising a run
 *  the balance could not pay for. 25 makes the sentence on the signup page true again, with
 *  room for the run to cost a little more than the measured average.
 *  (spend.test.ts asserts exactly this: grant ≥ conversation + image + 5s video.)
 *
 *  Supersedes the closed-beta seed (1000 → 100 in #66 → 20 in #543 → 25 here). It is granted
 *  idempotently in the org-bootstrap path under the stable key "signup:<orgId>"; the key
 *  is deliberately UNCHANGED, because a new key would re-grant to every org that already
 *  received the old amount — existing workspaces keep what they were given. */
export const SIGNUP_GRANT_CREDITS = 25 * INTERNAL_PER_DISPLAY;

/**
 * 一条「默认视频」的显示 credits —— 商家不改任何选项、开口就说「做条视频」时的价钱
 * (菜单上的视频引擎 + 它自己声明的默认时长/分辨率)。
 *
 * #791-7 需要它:余额低于这个数就该提前提醒,而不是等商家撞墙。刻意**算**出来而不是
 * 写死 11 —— 抄一份数字,就是下一次改价时「说的」与「收的」再次分家。
 */
export function defaultVideoDisplayCredits(): number {
  const model = GEN_VIDEO_MODELS[0];
  const d = videoDefaults(model);
  return displayCredits(
    pricedGenCredits({
      kind: "VIDEO",
      model,
      count: 1,
      videoOptions: { seconds: d.seconds, resolution: d.resolution },
    }),
  );
}
