/**
 * 集中定价配置 —— 价格在这里定义一次,业务与 UI 一律引用(项目铁律:Pricing truth,
 * 「价格集中配置,不散落业务/UI」)。
 *
 * 这个文件收的是**三样此前不在代码里的价格真相**(钱路 M1-c,Founder 2026-08-18 裁决
 * 9/10 + 钱路审计 P1):
 *
 *   §1 FX 钉点   —— USD↔MYR 的换算假设。此前只活在 2026-06 的设计文档里(写 4.7,已过时),
 *                   代码一个字都不知道,于是汇率漂移直接吃毛利而没有任何东西会响。
 *   §2 充值包表   —— 三个 MYR 充值包此前只活在 Stripe 后台。webhook 收到「付了 RM100,
 *                   给 220 credits」时,没有任何东西核对过这两个数字是不是一对。
 *   §3 搜索计价   —— Founder 2026-07-03 裁的 3×(200% margin)从未实现,搜索成本至今零计价。
 *
 * 与已有价格真相的分工:
 *   - `spend.ts`        = 生成动作的收费函数(pricedGenCredits …)。
 *   - `otto-budget.ts`  = 聊天一轮的价格倍数(OTTO_CONVERSATION_TURN_MARGIN)。
 *   - `llm-prices.ts`   = LLM token 牌价 + 生成侧 margin。
 *   - **本文件**        = 上面三者都装不下的定价输入:汇率、充值包、搜索费率。
 *   - `margin-truth.ts` = 把以上全部拉进 45% 毛利地板检查的那张表(闸)。
 */
import { costPinValue } from "./cost-pins.js";
import { CREDITS_PER_USD } from "./spend.js";

/* ───────────────────────── §1 FX 钉点(Founder 裁决 10) ───────────────────────── */

/**
 * 一次汇率钉点的完整声明。四个字段都是必填 —— 缺任何一个,闸直接红。
 * 裸一个数字会退化成一个没人复核、没人知道什么时候该复核的假设,而那正是这次要修的病。
 */
export type FxPin = {
  /** 钉住的换算率:1 USD = 这么多 MYR。定价按这个数假设我们收到多少美元。 */
  myrPerUsd: number;
  /** **复核到期日 YYYY-MM-DD**:过了这天,闸变黄(提醒复核)。这不是缓刑,是闹钟。 */
  nextReviewDate: string;
  /** 定钉点当天可查到的**参考现汇**,连同它是哪天、从哪看来的。 */
  reference: {
    /** 参考现汇:1 USD = 这么多 MYR。 */
    rate: number;
    /** 观察日 YYYY-MM-DD。 */
    observedOn: string;
    /** 来源(人可复核)。 */
    source: string;
  };
};

/**
 * **现行 FX 钉点**(Founder 2026-08-18 裁决 10)。
 *
 * Founder 拍的是**机制**,不是那个数:2026-08-18 现汇 1 USD = 4.062917 MYR,乘 1.10 的安全
 * 缓冲取整到 **4.50**。缓冲的方向是刻意的 —— 钉点比现汇**高**,等于假设我们每卖一个 MYR
 * 充值包收到的美元比实际**少**,毛利算得保守。危险的只有一个方向:令吉走弱到现汇越过钉点
 * (每美元换到更多令吉 = 同样的 RM 售价换回更少美元),那一刻毛利是真的被吃了。
 *
 * 举个商家例子:RM100 的 Standard 包。按钉点 4.50 我们假设收到 $22.22;实际按 4.062917 收到
 * $24.61 —— 多出来的是缓冲。等哪天令吉跌到 1 USD = 4.80,同一张 RM100 只换回 $20.83,比钉点
 * 假设的少 $1.39,而 220 credits 的成本一分没少。所以闸的红线正是「参考现汇 > 钉点」。
 *
 * 复核期 +3 个月 = 2026-11-18。到期闸变黄(提醒复核),不拦 CI —— 汇率复核是 Founder 的
 * 定价动作,不是工程可以自己做完的事;它该被提醒,不该把发布卡死。
 */
export const FX_PIN: FxPin = {
  myrPerUsd: 4.5,
  nextReviewDate: "2026-11-18",
  reference: {
    rate: 4.062917,
    observedOn: "2026-08-18",
    source: "2026-08-18 现汇(Founder 裁决 10 当天记录的参考值);复核时把这三项一起更新",
  },
};

/** 便捷常量:业务代码要换算就引这一个,不要再写汇率字面量。 */
export const MYR_PER_USD_PIN = FX_PIN.myrPerUsd;

/** MYR(以「仙」为单位的整数金额)→ USD,按钉点换算。纯函数。 */
export function myrMinorToUsd(amountMinor: number): number {
  return amountMinor / 100 / MYR_PER_USD_PIN;
}

/** 闸的一条判词。`red` 必须让 CI 红;`yellow` 只提醒,不拦。 */
export type FxPinProblem = { level: "red" | "yellow"; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 纯函数:把 FX 钉点的全部规则跑一遍。`today` 注入,所以「到期」这条是可测的。
 *
 * 规则:
 *   F1 钉点或参考现汇不是正有限数        → 红(声明烂掉了,不许当成没事)
 *   F2 日期不是 YYYY-MM-DD              → 红(同上)
 *   F3 参考现汇 **>** 钉点               → 红(令吉弱过钉点 = 毛利被吃,请 Founder 重定价)
 *   F4 today ≥ nextReviewDate           → 黄(复核到期,提醒)
 *
 * F3 用严格大于:现汇正好等于钉点时缓冲刚好用尽,还没亏,但离红线只差一步 —— 那一步由
 * F4 的复核闹钟接手,不在这里提前拦。
 */
export function evaluateFxPin(pin: FxPin, today: string): FxPinProblem[] {
  const out: FxPinProblem[] = [];
  const pinRate = pin?.myrPerUsd;
  const refRate = pin?.reference?.rate;

  if (!Number.isFinite(pinRate) || !(pinRate > 0)) {
    out.push({ level: "red", message: `FX 钉点 myrPerUsd 不是正有限数(${String(pinRate)})—— 定价换算没有基准 (F1)` });
  }
  if (!Number.isFinite(refRate) || !(refRate > 0)) {
    out.push({ level: "red", message: `FX 参考现汇 reference.rate 不是正有限数(${String(refRate)})—— 钉点无从复核 (F1)` });
  }
  for (const [field, value] of [
    ["nextReviewDate", pin?.nextReviewDate],
    ["reference.observedOn", pin?.reference?.observedOn],
  ] as const) {
    if (typeof value !== "string" || !ISO_DATE.test(value)) {
      out.push({ level: "red", message: `FX 钉点的 ${field} 不是 YYYY-MM-DD(${String(value)}) (F2)` });
    }
  }
  if (typeof pin?.reference?.source !== "string" || !pin.reference.source.trim()) {
    out.push({ level: "red", message: "FX 参考现汇缺 source —— 一个查不到出处的汇率不是证据 (F1)" });
  }

  if (Number.isFinite(pinRate) && Number.isFinite(refRate) && pinRate > 0 && refRate > 0 && refRate > pinRate) {
    out.push({
      level: "red",
      message:
        `FX 参考现汇 1 USD = ${refRate} MYR 已经**弱过**钉点 ${pinRate} —— ` +
        `同样的 MYR 售价换回的美元比定价假设的少,毛利正在被吃。这是定价决定:请 Founder 重定钉点或重定包价 (F3)`,
    });
  }

  if (typeof pin?.nextReviewDate === "string" && ISO_DATE.test(pin.nextReviewDate) && today >= pin.nextReviewDate) {
    out.push({
      level: "yellow",
      message:
        `FX 钉点的复核期到了(nextReviewDate ${pin.nextReviewDate},今天 ${today})—— ` +
        `请核一次现汇并更新 FX_PIN(钉点 / 参考现汇 / 观察日 / 下次复核日一起更新) (F4)`,
    });
  }

  return out;
}

/* ─────────────────────── §2 充值包表(钱路审计:金额无核对) ─────────────────────── */

/** 一个在售充值包。`amountMinor` = MYR 的「仙」(Stripe unit_amount 的单位)。 */
export type CreditPack = {
  /** Stripe Product 名 —— 与后台逐字对齐。 */
  name: string;
  /** 售价,单位「仙」(RM25 = 2500)。 */
  amountMinor: number;
  /** 到账的**显示** credits(webhook 拿它 × INTERNAL_PER_DISPLAY 入账)。 */
  credits: number;
};

/** 充值包的计价币种(Stripe 的小写币种码)。 */
export const CREDIT_PACK_CURRENCY = "myr";

/**
 * **在售充值包表**。
 *
 * 来源:`apps/web/scripts/create-credit-packs.mjs` —— 生产 Stripe 里这三个 Product/Price
 * 就是那个脚本建的,它此前是这三行数字在仓库里的唯一副本。这张表现在是**唯一权威**,
 * 建包脚本改为引用它(不再各存一份),webhook 入账时按它核对。
 *
 * ⚠️ 这张表与生产 Stripe 的一致性是**运维前提**:webhook 对不上就不入账(见
 * `verifyCreditPackPurchase`)。在 Stripe 后台加一个包而不更新这张表并部署,那个包的买家
 * 会付了钱拿不到 credits —— 报警会响,但商家已经受影响。加包 = 改这张表 + 部署。
 */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { name: "Starter — 50 credits", amountMinor: 2500, credits: 50 },
  { name: "Standard — 220 credits", amountMinor: 10000, credits: 220 },
  { name: "Pro — 600 credits", amountMinor: 25000, credits: 600 },
];

/**
 * 核对结论。**三态,不是两态** —— 「对不上」和「没法核」不是同一件事(仓库既有口径,
 * 见 billing-actions.ts 的货架 `{packs}` / `{unreadable}`,#786):
 *
 *   `match`        账目对得上:金额、币种、credits 三样与表里同一个包一致 → 照常入账。
 *   `mismatch`     账目**对不上**:我们看到了数字,而它不是任何一个在售包 → 报警,不入账
 *                  (Founder 2026-08-18:金额或 credits 不匹配 → 不静默入账)。
 *   `unverifiable` 我们**没看到**金额或币种(Stripe 这次没报)→ 报警,但照常入账。
 *                  「没法核」不等于「不匹配」,拿一个我们自己读不到的字段去坑掉一个真付了钱的
 *                  商家,是在用错误的方向 fail closed。已付款的 Checkout session 一定带
 *                  amount_total,所以这一支是安全阀,不是常规路径。
 */
export type CreditPackCheck =
  | { verdict: "match"; pack: CreditPack }
  | { verdict: "mismatch"; reason: string }
  | { verdict: "unverifiable"; reason: string };

/**
 * 纯函数:一笔 Stripe 充值到底是不是我们在售的那个包?
 *
 * 只读、只判断 —— 它不入账、不报警、不碰幂等键。调用方(webhook)拿它的结论决定做什么。
 */
export function verifyCreditPackPurchase(input: {
  credits: unknown;
  amountTotal: unknown;
  currency: unknown;
}): CreditPackCheck {
  const credits = Number(input.credits);
  if (!Number.isInteger(credits) || credits <= 0) {
    return { verdict: "mismatch", reason: `credits ${String(input.credits)} 不是正整数` };
  }

  const pack = CREDIT_PACKS.find((p) => p.credits === credits);
  if (!pack) {
    return {
      verdict: "mismatch",
      reason:
        `credits ${credits} 不在 CREDIT_PACKS 里 —— 要么 Stripe 后台加了包而代码没更新(加包 = 改表 + 部署),` +
        `要么这笔 metadata 是错的`,
    };
  }

  const amountTotal = input.amountTotal;
  if (typeof amountTotal !== "number" || !Number.isFinite(amountTotal)) {
    return { verdict: "unverifiable", reason: `Stripe 没报这次的 amount_total(${String(amountTotal)})—— 金额无从核对` };
  }
  const currency = input.currency;
  if (typeof currency !== "string" || !currency.trim()) {
    return { verdict: "unverifiable", reason: `Stripe 没报这次的 currency(${String(currency)})—— 币种无从核对` };
  }

  if (currency.toLowerCase() !== CREDIT_PACK_CURRENCY) {
    return {
      verdict: "mismatch",
      reason: `币种 ${currency} ≠ 在售包的 ${CREDIT_PACK_CURRENCY}(${pack.name})`,
    };
  }
  if (amountTotal !== pack.amountMinor) {
    return {
      verdict: "mismatch",
      reason: `金额 ${amountTotal} ≠ 「${pack.name}」的 ${pack.amountMinor}(同为最小货币单位)—— 付的钱与给的 credits 不是一对`,
    };
  }
  return { verdict: "match", pack };
}

/* ───────────── §3 搜索计价(Founder 2026-07-03 裁决 3×,2026-08-18 裁决 9b 落地) ───────────── */

/**
 * 搜索 API 的价格倍数:**3×(200% margin)**。
 *
 * Founder 2026-07-03 原话:「那么便宜,可以 200% 的 margin」。这条裁决在代码里**从未实现**
 * (钱路审计:搜索成本至今零计价),裁决 9b(2026-08-18)把它落地并把 research 整体拉进
 * 45% 毛利地板检查。3× ⇒ 毛利率 (3−1)/3 = 66.7%,离地板 20 多个点。
 *
 * 与生成侧 2.0×、聊天 1.05× 各走各的率 —— 这是裁决明写的:「独立费率不并进」。
 */
export const SEARCH_MARGIN_MULTIPLIER = 3.0;

/**
 * 搜索 provider 的**每次搜索**成本(USD),按 depth 分档。
 * Tavily 牌价:basic $0.008 / advanced $0.016(Founder 2026-07-03 裁决内逐字记录的两个数)。
 * 现役 research 走 basic —— `tavilySearch` 不传 `search_depth`,Tavily 默认 basic。
 *
 * 数值已收编 `cost-pins.ts`(成本的单一权威),这张表只是命名出口 —— 改价改钉点。
 */
export const SEARCH_PROVIDER_COST_USD = {
  basic: costPinValue("search:tavily:basic-per-call"),
  advanced: costPinValue("search:tavily:advanced-per-call"),
} as const;
export type SearchDepth = keyof typeof SEARCH_PROVIDER_COST_USD;

/**
 * 一次搜索的收费,单位 internal credits(1 internal = $0.01),**整数**。
 *
 * = ceil(单次成本 × 3 × 100)。basic ⇒ ceil(2.4) = 3;advanced ⇒ ceil(4.8) = 5 ——
 * 与 Founder 裁决里写的「basic → ~3 internal / advanced → ~5 internal」逐字对上。
 *
 * 逐次进位(而不是先乘次数再进位):进位余量归我们,方向永远是收得多一点点,
 * 不会出现「搜了 N 次却因为浮点少收一格」。
 */
export function searchUnitChargeInternal(depth: SearchDepth = "basic"): number {
  return Math.ceil(SEARCH_PROVIDER_COST_USD[depth] * SEARCH_MARGIN_MULTIPLIER * CREDITS_PER_USD);
}

/**
 * N 次搜索的收费,单位 internal credits。非有限/负数/小数一律按 0 处理 ——
 * 计数器坏掉时的方向是**不收费**,而不是收一个编出来的数。
 */
export function searchChargeInternal(searches: number, depth: SearchDepth = "basic"): number {
  const n = Number(searches);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n * searchUnitChargeInternal(depth);
}
