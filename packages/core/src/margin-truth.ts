/**
 * 毛利真相表(#644 T3 记账真相修正)——「说的」与「做的」在毛利上合一的那张表。
 *
 * 一句话:**收费从收费函数来,成本从成本函数来,毛利现算**。这里没有一个手抄的数字,
 * 所以它不可能与真实链路失同步 —— 谁改了收费、谁改了成本,`margin-truth.test.ts`
 * 当场变红,逼一次毛利重审。这就是本片要的「测试即报表」。
 *
 * 两个数的身份(别混):
 *   - chargeUsd = `pricedGenCredits` / `pricedRefgenCredits` —— 商家真被扣的那一笔;
 *   - cogsUsd   = `genSpentUsd` / `refgenSpentUsd` —— 我们真付给引擎那一笔(record-only)。
 *
 * SKU id 与 CI 闸 `scripts/check-margin-floor.mjs` **逐字对齐**,两边说的是同一档。
 */
import {
  CREDITS_PER_USD,
  FLAT_PRICED_VIDEO_MODELS,
  SELLABLE_VIDEO_RESOLUTIONS,
  genSpentUsd,
  pricedGenCredits,
  pricedRefgenCredits,
  pricedUnderstandingCredits,
  refgenSpentUsd,
  type GenSpendInput,
} from "./spend.js";
import { UNDERSTANDING_KINDS, understandingWorstCaseUsd } from "./asset-understanding.js";
import {
  GEN_IMAGE_COST_PIN,
  GEN_MODELS,
  GEN_VIDEO_MODEL_OPTIONS,
  type GenModel,
  type GenVideoModel,
} from "./gen.js";
import { REFGEN_MODELS, type RefGenModel } from "./refgen.js";
import type { CostPinKey } from "./cost-pins.js";
import { OTTO_CONVERSATION_TURN_MARGIN } from "./otto-budget.js";
import { ottoLlmMargin } from "./llm-prices.js";
import { SEARCH_MARGIN_MULTIPLIER } from "./pricing-config.js";

/** 宪法 5 毛利地板:(售价 − 成本) / 售价 ≥ 45%。(docs/BLUEPRINT.md) */
export const MARGIN_FLOOR = 0.45;
/** IEEE754 容差 —— 定价可以精确压在 45.0% 上,浮点里会差最后一位。 */
export const MARGIN_FLOOR_EPSILON = 1e-9;

/**
 * 一条**待 Founder 裁决**的记录。四个字段都是必填 —— 缺任何一个,CI 闸直接红
 * (`evaluateFloorDecisions`,scripts/check-margin-floor.mjs)。裸 id 会退化成永久豁免,
 * 所以这里连「为什么」「谁在裁」「什么时候必须裁完」都是机器强制的。
 */
export type PendingFloorRuling = {
  /** 档位 id,与毛利表 / CI 闸逐字对齐。 */
  tier: string;
  /** 这一档为什么现在跌破 —— 逐档写,不许复制全局套话。 */
  reason: string;
  /** 呈报给 Founder 的那次记录(GitHub issue / PR 链接)。 */
  rulingRef: string;
  /** **到期日 YYYY-MM-DD**:过了这天还没裁,CI 闸变红。这不是缓刑,是闹钟。 */
  reviewBy: string;
};

/**
 * **跌破毛利地板、等 Founder 裁决的档位**(#644,2026-08-05)。
 *
 * 这不是豁免簿,是一张**带闹钟的待办**。名单被四头钉死,烂不掉 ——
 *   1. 真跌破却不在名单上 → 红(新的违规藏不住);
 *   2. 在名单上却已经不跌破了 → 红(定价修好后,名单必须清掉);
 *   3. 条目缺字段、日期格式不对、或指向一个根本不可售的档位 → 红;
 *   4. 过了 `reviewBy` 还在名单上 → 红(裁决被拖着不做,CI 就停下来等)。
 * 另外任何档位只要**收费 ≤ 成本**,名单一律救不了 —— 恒红。
 *
 * **现在是空的。** 上一批(#644,2026-08-05)挂着视频 720p 5s / 10s 两档 —— 记账基准从
 * 2026-06 资源包折后价($3.564/M)回到官方牌价($5.60/M)后,成本 +57% 而收费没动,毛利
 * 掉到 24.4% / 13.6%。Founder 于 2026-08-06 裁决**调价**(8→11cr、14→22cr,留档于
 * PR #655 评论),两档回到 45.0%,名单按第 2 条规则清空。
 */
export const BELOW_FLOOR_PENDING_FOUNDER_RULING: readonly PendingFloorRuling[] = [];

/** 取某一档的待裁决记录;不在名单上返回 undefined。纯函数。 */
export function pendingRulingFor(tier: string): PendingFloorRuling | undefined {
  return BELOW_FLOOR_PENDING_FOUNDER_RULING.find((p) => p.tier === tier);
}

/**
 * 一条**Founder 已裁、明示接受**的地板豁免。与上面那张「待裁决」名单是两件事:
 * 待裁决 = 还没人拍板,带闹钟催;这里 = **已经拍过板了**,裁决内容是「接受」。
 * 所以它没有 `reviewBy`(没有什么在等),取而代之的是 `ruledOn` + `source`:
 * 哪一天、由谁在哪里裁的,机器强制写全。
 */
export type AcceptedFloorException = {
  /** 档位 id,与毛利表 / CI 闸逐字对齐。 */
  tier: string;
  /** 具体是**哪几个比例**把这一档压到地板下(同档其余比例是过的)。 */
  ratios: readonly string[];
  /** 裁决当天这一档的毛利率(留档用;真值仍然是现算的,对不上会红)。 */
  margin: number;
  /** 为什么接受 —— 逐档写。 */
  reason: string;
  /** 裁决日期 YYYY-MM-DD。 */
  ruledOn: string;
  /** 裁决留档链接。 */
  source: string;
};

/**
 * **Founder 已裁接受的地板豁免**。
 *
 * 这张名单同样被两头钉死(闸里的 A1–A4 规则):跌破却不在名单上 → 红;在名单上却已经
 * 清了地板 → 红;条目缺字段或指向不存在的档位 → 红;同一档同时出现在两张名单上 → 红。
 *
 * **现在是空的。** 上一批(#645,2026-08-06,留档
 * https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/645#issuecomment-5202464378)挂着 720p 的 5 / 10 / 15 秒
 * 三档:2.2cr/秒在这三个整点上不产生进位余量(收费正好 11 / 22 / 33cr),而按**最差比例**
 * (4:3 / 3:4,927,408px)建模的成本让它们落到 44.67%,差地板 0.33 个点,Founder 明示接受。
 *
 * #769(2026-08-08)换引擎之后这三档**不再跌破**:牌价从 fast 的 $5.60/M 降到 mini 的
 * $3.50/M,同样的收费(11 / 22 / 33cr,一格没动)对上的成本变成 $0.3804 / $0.7608 /
 * $1.1411,毛利率 65.42%。缺口不是被豁免掉的,是被成本降没的 —— 按规则 2(「在名单上却
 * 已经清了地板 → 红」)这三条必须清掉,留着就是让一条不再成立的豁免继续挂在账上。
 * 清空之后**没有任何一个生成档需要豁免**:生成侧最低毛利率是 65.0%(图片与参考图),
 * 离 45% 地板还有 20 个点。
 *
 * **现在名单上只有一条,而且不是生成档:`otto:chat`**(Founder 2026-08-18 裁决 9,钱路
 * M1-c)。聊天改按量计价 = API 成本 × 1.05,毛利率 4.76%,与 45% 地板令直接冲突;Founder
 * 的裁决是接受,理由「聊天是销售员、生成是商品」。把它写成一条**显式豁免行**而不是让它
 * 继续待在闸外,是这次要修的病本身:一个从来没被闸看过的付费面,不叫「清了地板」,叫
 * 「没人量过」。现在每次 CI 都会把这一行以 `RULED` 打印出来 —— 豁免不许褪成背景。
 */
export const BELOW_FLOOR_FOUNDER_ACCEPTED: readonly AcceptedFloorException[] = [
  {
    tier: "otto:chat",
    // 按量计价的档没有「比例」这一轴 —— 毛利率对任何 token 数都一样,见 USAGE_PRICED_SURFACES。
    ratios: ["全部对话(按量计价,毛利率与用量无关)"],
    // 1.05 ⇒ 4.76%。刻意写成**和 marginRow 一模一样的算式**「(收费 − 成本) / 收费」,
    // 而不是代数上等价的 `1 − 1/k` —— 两者在 IEEE754 里差最后几位,而 margin-truth.test.ts
    // 对按量计价面要求**逐位**相等(判官 P3-3,防活读被改抄一份)。代数等价 ≠ 浮点相等。
    // (成本单位恒 $1,见 USAGE_PRICED_COGS_UNIT_USD;乘 1 在浮点里是恒等,所以这里省掉它
    //  既不改变一个比特,又避开了那个常量在本行之后才声明的 TDZ。)
    margin: (OTTO_CONVERSATION_TURN_MARGIN - 1) / OTTO_CONVERSATION_TURN_MARGIN,
    // Founder 2026-08-18 裁决 9 的理由,原话留档:
    reason:
      "聊天是销售员、生成是商品 —— Founder 2026-08-18 裁决9。聊天按 API 成本 × 1.05 计价" +
      "(OTTO_CONVERSATION_TURN_MARGIN),毛利率 4.76%,远在 45% 地板之下,Founder 明示接受:" +
      "对话不是这个产品赚钱的地方,它是让商家不用省着用的入口;真正要守住 45% 的是生成。" +
      "注意这一条豁免的是**地板**,不是「收费 > 成本」—— 1.05 > 1,聊天仍然不许亏着卖," +
      "R1 规则照旧管着它。" +
      "【2026-09-01 S2 口径注记】同一压力实收口径(面值 × 最深包折扣 × 实测手续费,汇率按钉点 4.5)下," +
      "聊天 1.05× 实收为 −6.48%;按参考现汇 4.062917 则 +3.86%。「不许亏着卖」不变量维持**面值口径**" +
      "评估(1.05 > 1 成立);压力实收为负是汇率钉点刻意保守缓冲的账面现象,不是现金已损" +
      "(docs/specs/money-engine.md §7.0)。本注记只是把这个事实写明,不改费率 —— " +
      "S1「不做」节禁止本规格重裁聊天费率,要重议走 §5 变更登记。" +
      "【口径边界】本行建模的是聊天的 **LLM 成本**,这是它的全部量程,不是一个缺口:聊天里的" +
      "搜索(researchWeb)自 2026-09-02 起是**独立计价的第二条钱腿**(3×,与深研同源同函数," +
      "MONEY-A10),按次单独向商家收,不摊进这条 1.05× 的曲线。两条腿各自入闸:搜索那条清地板" +
      "(66.7%),这条按裁决豁免。",
    ruledOn: "2026-08-18",
    source:
      "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/970 —— Founder 裁决 9(2026-08-18," +
      "聊天按量计价 = API 成本 +5%)落地的那次改动,OTTO_CONVERSATION_TURN_MARGIN 就是在这里定的",
  },
];

/** 取某一档的已裁豁免;不在名单上返回 undefined。纯函数。 */
export function acceptedExceptionFor(tier: string): AcceptedFloorException | undefined {
  return BELOW_FLOOR_FOUNDER_ACCEPTED.find((e) => e.tier === tier);
}

export type MarginRow = {
  /** 与 CI 闸对齐的档位 id。 */
  id: string;
  /** 人话档位名(报表用)。 */
  label: string;
  /** 商家付的钱(USD)。 */
  chargeUsd: number;
  /** 我们付给引擎的钱(USD,record-only)。 */
  cogsUsd: number;
  /** 毛利额(USD)。 */
  grossUsd: number;
  /** 毛利率 = grossUsd / chargeUsd。 */
  margin: number;
  /** 是否清过 45% 地板。 */
  clearsFloor: boolean;
};

/** 纯计算:一档的收费 + 成本 → 毛利行。 */
export function marginRow(id: string, label: string, chargeUsd: number, cogsUsd: number): MarginRow {
  const grossUsd = chargeUsd - cogsUsd;
  const margin = grossUsd / chargeUsd;
  return { id, label, chargeUsd, cogsUsd, grossUsd, margin, clearsFloor: margin >= MARGIN_FLOOR - MARGIN_FLOOR_EPSILON };
}

const videoJob = (seconds: number, resolution: string): GenSpendInput => ({
  kind: "VIDEO",
  model: "seedance-2-mini",
  count: 1,
  videoOptions: { seconds, resolution, audio: true },
});

type MarginSku = { id: string; label: string; charge: () => number; cogs: () => number };

/**
 * **按量计价的付费面**(钱路 M1-c,2026-08-18)—— 聊天与深研,此前三个都在毛利闸**外面**。
 *
 * 为什么它们进不了上面那种「一档一个价」的表:生成是定价的(11cr 一条 5 秒视频,成本是
 * provider 的牌价),而这三个面收的是**乘数** —— 收费 = 这一次真实的 provider 成本 × 倍数。
 * 一次对话烧了多少 token 事前没人知道,所以它没有「一档」。
 *
 * 但正因为收费是成本的固定倍数,**毛利率与用量完全无关**:
 *
 *   margin = (cost × k − cost) / (cost × k) = 1 − 1/k
 *
 * 于是这三行的正确建模单位就是「**每 $1 的 provider 成本**」:成本恒 $1.00(这是**定义的
 * 计量单位**,不是抄来的牌价),收费 = $1.00 × 倍数。烧 $0.03 还是 $30 的一轮,毛利率一样。
 *
 * 倍数一律**现取**,不抄:改 OTTO_CONVERSATION_TURN_MARGIN、改 OTTO_LLM_MARGIN、改
 * SEARCH_MARGIN_MULTIPLIER,这张表当场跟着动,毛利闸当场重判。这正是「测试即报表」在
 * 按量计价面上的形状。
 *
 * 三行分别是:
 *   otto:chat            聊天一轮的 LLM 成本 × 1.05  → 4.76%,**跌破地板**,Founder 已裁接受(裁决 9)。
 *   otto:research:llm    深研的 LLM 成本 × ottoLlmMargin() → 默认 **2.06 ⇒ 51.46%**,清地板。
 *   otto:research:search **全部**搜索成本 × 3.0     → 66.7%,清地板(裁决 9b 落地的 3× 判决)。
 *                        深研与聊天两条搜索腿走同一个费率、同一个 `searchChargeInternal`,所以
 *                        它们是**同一行**,不是两行 —— 复制一份数字一模一样的行,只会多一个
 *                        将来会漂移的地方(MONEY-A10 起,聊天搜索并入这一行)。
 *
 * **这张表的毛利率是面值口径**(商家账面),而宪法 5 的 45% 地板在 CI 闸那边按**最坏实收口径**
 * 复判一次(面值 × 最坏包实收系数 0.8944,见 `pricing-config.ts` 的 `worstPackReceiptCoefficient`)。
 * 两个口径的差是汇率钉点的保守缓冲,不是两份真相:深研 LLM 面值 51.46% / 实收 45.73%(本地卡带)
 * / 45.16%(国际卡带,只备案不入闸)—— 2.06× 是 Founder 2026-09-01 为了**三条带全部清线**裁的费率
 * (前值 2.0× 的实收是 44.10%,破线)。详见 docs/specs/money-engine.md §7.0。
 */
export const USAGE_PRICED_SURFACES: readonly { id: string; label: string; multiplier: () => number }[] = [
  // 这一行建模的是**聊天的 LLM 成本**,而那就是它的全部量程。聊天里的搜索腿
  // (researchWeb,packages/otto/src/skills/research-web.ts)从 MONEY-A10 起按 3× 单独计价,
  // 落在下面 otto:research:search 那一行里 —— 两条腿分别入闸,这里的 4.76% 不再偏乐观。
  { id: "otto:chat", label: "Otto 聊天 LLM(每 $1 provider 成本)", multiplier: () => OTTO_CONVERSATION_TURN_MARGIN },
  { id: "otto:research:llm", label: "深研 LLM(每 $1 provider 成本)", multiplier: () => ottoLlmMargin() },
  // 深研搜索 + 聊天搜索:同一个费率、同一个收费函数,所以是同一行(见上面的表)。
  { id: "otto:research:search", label: "搜索(深研+聊天,每 $1 provider 成本)", multiplier: () => SEARCH_MARGIN_MULTIPLIER },
];

/** 按量计价面的成本计量单位:**$1 的 provider 成本**。这是单位的定义,不是一个抄来的价格
 *  —— 所以毛利闸那边手抄的 COGS_INPUTS 对这三行填的也只能是 1.0,两边不可能漂移。 */
export const USAGE_PRICED_COGS_UNIT_USD = 1;

function usagePricedSkus(): MarginSku[] {
  return USAGE_PRICED_SURFACES.map((s) => ({
    id: s.id,
    label: s.label,
    charge: () => USAGE_PRICED_COGS_UNIT_USD * s.multiplier(),
    cogs: () => USAGE_PRICED_COGS_UNIT_USD,
  }));
}

/**
 * **图片 model → 成本钉点** 的结构映射(MONEY-A2 第三判定,规格 §7.2「图片 SKU 结构枚举」)。
 *
 * 类型写成 `Record<GenModel, CostPinKey>` 是这条围栏的**全部内容**:`GenModel` 是 `GEN_MODELS`
 * 的完整联合,所以在图片菜单上架一个新 model 而不在这里给它配一条成本钉点,**编译期就红**——
 * 不是 CI 红,不是运行时红,是根本编译不过。这正是要的东西:此前图片档在毛利表里是两行**手写
 * 字面量**,加一个 model 只会让它安静地不出现在毛利表上,而视频档早在 #645 T4 就改成枚举了。
 * 一个量了一半却看起来像量全了的闸,比没有闸更危险。
 *
 * 值是 `CostPinKey`(cost-pins.ts 的键联合),所以「配了钉点」也不能是随口写的字符串:
 * 钉点表里没有的键同样编译不过(fail closed,cost-pins.ts 规矩 ②)。
 *
 * Creation S2 §8.1①:真正的表搬去 `gen.ts`(`GEN_IMAGE_COST_PIN`)与成本函数同住 ——
 * `genSpentUsd` 现在也要按槽位取成本钉点,两个地方各存一份就会漂移。这里是**别名**,
 * 不是第二份手抄:CI 闸(`scripts/check-margin-floor.mjs`)读的是这个名字,而围栏
 * (`Record<GenModel, CostPinKey>`,菜单加一格不配钉点就编译不过)在那边一字不变。
 */
export const IMAGE_MODEL_COST_PIN: Record<GenModel, CostPinKey> = GEN_IMAGE_COST_PIN;

/** 参考图 model → 成本钉点。同一条围栏,盯的是 `REFGEN_MODELS`(今天与图片同价同钉点)。 */
export const REFGEN_MODEL_COST_PIN: Record<RefGenModel, CostPinKey> = {
  seedream: "image:seedream-lite:per-image",
};

/**
 * 现役可售图片档 = **从 `GEN_MODELS` 枚举**(MONEY-A2),镜像下面视频档的做法。
 * 收费走 `pricedGenCredits`、成本走 `genSpentUsd` —— 与视频档逐字同源,这张表里
 * 没有一个手抄的数字。
 */
function sellableImageSkus(): MarginSku[] {
  return GEN_MODELS.map((model) => {
    const job: GenSpendInput = { kind: "IMAGE", model, count: 1, videoOptions: null };
    return {
      id: `image:${model}`,
      label: `图片 ${model} ×1`,
      charge: () => pricedGenCredits(job) / CREDITS_PER_USD,
      cogs: () => genSpentUsd(job),
    };
  });
}

/**
 * 现役可售**素材理解**档 = 从 `UNDERSTANDING_KINDS` 枚举(MONEY-A9,规格 §7.3)。
 *
 * 为什么进的是这条**按件枚举**路线而不是上面的 `USAGE_PRICED_SURFACES`:按量计价面收的是
 * 「这一次真实成本 × 倍数」,毛利率与用量无关、连「一档」都没有;理解**有档位价** ——
 * 三类各一个按件的整数 internal 价(`pricedUnderstandingCredits`),成本是各类的**最坏**
 * token 上限成本。它和图片档是同一种东西(一件多少钱),所以量法也该一样。
 *
 * 收费走 `pricedUnderstandingCredits`、成本走 `understandingWorstCaseUsd` —— 与定价推导
 * 逐字同源,这里一个手抄的数字都没有。
 */
function sellableUnderstandingSkus(): MarginSku[] {
  const label: Record<(typeof UNDERSTANDING_KINDS)[number], string> = {
    "image-caption": "素材理解 看图(每件)",
    "doc-extract": "素材理解 读文档(每件)",
    "video-qa": "素材理解 看视频(每件)",
  };
  return UNDERSTANDING_KINDS.map((kind) => ({
    id: `understanding:${kind}`,
    label: label[kind],
    charge: () => pricedUnderstandingCredits(kind) / CREDITS_PER_USD,
    cogs: () => understandingWorstCaseUsd(kind),
  }));
}

/** 现役可售参考图档 = 从 `REFGEN_MODELS` 枚举。同上。 */
function sellableRefgenSkus(): MarginSku[] {
  return REFGEN_MODELS.map((model) => ({
    id: `refgen:${model}`,
    label: `参考图 ${model} ×1`,
    charge: () => pricedRefgenCredits({ model, count: 1 }) / CREDITS_PER_USD,
    cogs: () => refgenSpentUsd({ model, count: 1 }),
  }));
}

/**
 * 现役可售视频档 = **从能力表现枚举**(#645 T4),不是手抄清单。
 *
 * 为什么改成枚举:扩容后是 2 分辨率 × 12 时长 = 24 档。手抄一份就等于把菜单抄了第二遍,
 * 而这个仓库反复栽在「说的」与「做的」是两份副本上 —— 菜单加一档、报表忘一档,毛利闸
 * 就再也看不见那一档。现在菜单是唯一来源:加一档,报表当场多一行,CI 闸当场要它的成本
 * 输入(没有就红)。
 */
function sellableVideoSkus(): MarginSku[] {
  const out: MarginSku[] = [];
  for (const model of FLAT_PRICED_VIDEO_MODELS) {
    // Creation S2 §8.1①:枚举源从**能力表**换成**已定价白名单** ——
    // 「可售」的定义是「有一个 Founder 裁过的价」,不是「引擎做得出来」。高清槽位的
    // 720p/480p 是能力而不是 SKU(没有属于它的成本钉点),把它们放进毛利表只会得到
    // 一行拿别档成本冒充出来的假毛利。白名单空/未知 ⇒ 这个槽位一行都不出,与
    // `assertSpendableModel` 同一条判据、同一个来源(`isSellableVideoSku`)。
    const resolutions = SELLABLE_VIDEO_RESOLUTIONS[model as GenVideoModel] ?? [];
    const durations = GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel]?.durations ?? [];
    for (const seconds of durations) {
      for (const resolution of resolutions) {
        const job = { kind: "VIDEO" as const, model, count: 1, videoOptions: { seconds, resolution, audio: true } };
        out.push({
          id: `video:${model}:${seconds}:${resolution}`,
          label: `视频 ${resolution || "默认档"} ${seconds} 秒`,
          charge: () => pricedGenCredits(job) / CREDITS_PER_USD,
          cogs: () => genSpentUsd(job),
        });
      }
    }
  }
  return out;
}

/**
 * 报表覆盖的档位。**现役可售的每一档都在这里**:图片、参考图(MONEY-A2 起同样**从
 * `GEN_MODELS` / `REFGEN_MODELS` 枚举**,不再是两行手写字面量),现役视频模型的
 * 全部时长 × 分辨率(#645 T4 起 24 档),整段参考视频,(MONEY-A9 起)素材理解三类,
 * 以及(钱路 M1-c 起)三个**按量计价的付费面** —— 聊天 LLM、深研 LLM、搜索(深研+聊天)。
 * (MONEY-A10 起,聊天的搜索腿并入既有的搜索行:同费率同函数,不另立一行。)
 * (视频任务恒 count=1 —— gen-actions 强制。)
 *
 * 「可售」= 会向商家收钱。按量计价面此前不在这张表上,于是毛利闸从来没量过它们:
 * 聊天 4.76% 没人知道,深研的搜索干脆零计价。补上它们不是扩大范围,是把范围补成
 * 它本来声称的那个 —— **每一个收钱的面**。
 */
export const MARGIN_TRUTH_SKUS: readonly MarginSku[] = [
  ...sellableImageSkus(),
  ...sellableRefgenSkus(),
  ...sellableVideoSkus(),
  // MONEY-A9(2026-09-01):素材理解从「平台自费、商家零触点」改成商家计费面,于是它第一次
  // 需要被量。三类各一行,按件枚举(不是按量计价),见 sellableUnderstandingSkus。
  ...sellableUnderstandingSkus(),
  {
    id: "video:seedance-2-mini:ref",
    label: "整段参考视频(6 秒参考上限 + 5 秒出片)",
    charge: () => pricedGenCredits({ ...videoJob(5, "720p"), referenceVideoGenerationId: "ref" }) / CREDITS_PER_USD,
    cogs: () => genSpentUsd({ ...videoJob(5, "720p"), referenceVideoGenerationId: "ref" }),
  },
  ...usagePricedSkus(),
];

/** 现算整张毛利真相表。 */
export function marginTruthTable(): MarginRow[] {
  return MARGIN_TRUTH_SKUS.map((s) => marginRow(s.id, s.label, s.charge(), s.cogs()));
}

/** 把毛利表排成人看的文本(测试跑起来会打印它 —— 报表就是这个)。 */
export function formatMarginTruthTable(rows: readonly MarginRow[]): string {
  const usd = (n: number) => `$${n.toFixed(4)}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const width = Math.max(...rows.map((r) => [...r.label].length));
  const lines = rows.map(
    (r) =>
      `  ${r.clearsFloor ? "OK " : "地板 ↓"} ${r.label.padEnd(width)}  收费 ${usd(r.chargeUsd)}  成本 ${usd(r.cogsUsd)}  毛利 ${usd(r.grossUsd)}  毛利率 ${pct(r.margin)}`,
  );
  return [`毛利真相表(#644,地板 ${pct(MARGIN_FLOOR)})`, ...lines].join("\n");
}
