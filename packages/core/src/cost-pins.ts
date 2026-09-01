/**
 * **成本钉点表** —— 供应商牌价在这里定义一次,业务与毛利表一律引用
 * (规格:`docs/specs/money-engine.md` §7.1,S1 冻结的「成本钉点制」)。
 *
 * 与 `pricing-config.ts` 的分工是**一句话**:那边是**价格**(我们收商家多少),
 * 这边是**成本**(供应商收我们多少)。两张表都用同一个成功样式 —— `FX_PIN` 的四要素
 * (数值 / 来源 / 观察日 / 复核到期日),因为裸一个数字会退化成一个没人复核、
 * 没人知道什么时候该复核的假设,而那正是钱路审计反复抓到的病。
 *
 * 四条规矩(规格 §7.1 实现要点 + S1 目标不变量):
 *
 *   ① **本表是成本的单一权威**。`gen.ts` / `refgen.ts` / `asset-understanding.ts` /
 *      `pricing-config.ts` 里的成本常量现在只是**命名出口**,数值一律从这里取;
 *      全仓不留第二份手抄成本(唯一的例外见 ③)。
 *
 *   ② **大图不入表 = 不可售**(fail closed,重申 S1)。$0.09 那档的计价单位从未实证 ——
 *      一个我们说不清按什么计费的东西,不给它钉点,也就不给它上架的路。缺钉点时
 *      `costPinValue` 连编译都过不去,而不是运行时兜一个编出来的数。
 *
 *   ③ **`scripts/check-margin-floor.mjs` 里那份手抄 `COGS_INPUTS` 是刻意留的双证人**
 *      (带 `assertCogsAgreement` 逐档比对):CI 闸拿两份独立抄写互证,任何一边被
 *      悄悄改动都会当场对不上。注意这个机制**只适用成本表** —— 价目侧禁用双证人
 *      (A1:全仓不留第二份手抄价目)。
 *
 *   ④ **变价的唯一路径 = 改钉点 PR + Founder 批**。供应商调价不实时联动商家价格:
 *      改这张表 → 价格按公式重算 → Founder 知情。商家看到的价格平时是稳定的。
 *
 * 首批钉点的复核到期日**全部 = 2026-11-18**,与 `FX_PIN.nextReviewDate` 同日 ——
 * 一次复核管两张表(汇率与成本一起看,省得两张表各响各的)。到期闸变**黄**:
 * 提醒复核,不拦发布 —— 复核牌价是 Founder 的定价动作,不是工程能自己做完的事。
 *
 * 本文件是**叶子模块**:不 import 本包任何其他模块。成本是最底层的输入,
 * 上面的价格/毛利/计费层单向依赖它,方向反过来就会出环。
 */

/* ───────────────────────────── 形状 ───────────────────────────── */

/**
 * 一条成本钉点的完整声明。前五个字段都是必填 —— 缺任何一个,闸直接红。
 *
 * 比 `FX_PIN` 多一个 `unit`:成本的计价单位五花八门(每 M token / 每 K token /
 * 每张 / 每次 / 按笔比例 / 每笔固定仙),而**单位错了比数字错了更贵** ——
 * 把 $/K 当成 $/M 用是一千倍的差。所以单位写进记录,不留在记忆里。
 */
export type CostPin = {
  /** 钉住的成本数值。单位由 `unit` 说死,这里只是个纯数字。 */
  value: number;
  /** 计价单位(人可读,写清楚「每什么」)。 */
  unit: string;
  /** 来源(人可复核):哪个档案、哪个页面、哪次实证。 */
  source: string;
  /** 观察日 YYYY-MM-DD:这个数是哪天亲眼看到的。 */
  observedOn: string;
  /** **复核到期日 YYYY-MM-DD**:过了这天,闸变黄(提醒复核)。这不是缓刑,是闹钟。 */
  nextReviewDate: string;
  /** 备注:复核条款、推导用途、来源性质等,写给下一个复核的人看。 */
  note?: string;
};

/** 首批钉点的复核到期日 —— 与 `FX_PIN.nextReviewDate` 同日,一次复核管两张表。
 *  (故意不 import `FX_PIN`:本文件是叶子模块;两者同日这件事由 `cost-pins.test.ts`
 *  跨表对账守着,而不是靠一条 import。) */
const FIRST_BATCH_REVIEW_DATE = "2026-11-18";

/* ─────────────────────────── 首批钉点 ─────────────────────────── */

/**
 * **现行成本钉点表**(规格 §7.1 首批钉点,数字全有回执)。
 *
 * 键名是稳定契约:`<类目>:<供应商或型号>:<计价口径>`。改键 = 改契约,和改数值一样
 * 要走 PR + Founder 批。
 */
export const COST_PINS = {
  /* ── 视频:seedance-2-mini(在产引擎,#769 起) ── */

  /**
   * 无视频输入(t2v / i2v)那一档的牌价。现役 `gen.ts` COGS 基准收编。
   * **抄牌价不抄折后价**:同一条记录上折后价是 $1.40/M,不抄它 —— 折扣既不保证续、
   * 也可能静默失效,成本按牌价记才安全。
   */
  "video:seedance-2-mini:t2v-per-mtoken": {
    value: 3.5,
    unit: "USD/M tokens(文生,无视频输入档)",
    source:
      "2026-08-29 arkcli 实查 ModelArk 模型档案 dreamina-seedance-2-0-mini-260615:" +
      "pricing.charge_items 的 NV2VCompletion.original_price = 0.0035/K tokens" +
      "(抄牌价不抄折后价;同记录 price = 0.0014/K = $1.40/M 折后,不采)",
    observedOn: "2026-08-29",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "现役 COGS 基准收编(原 gen.ts:429 的字面量)",
  },

  /** 含视频输入(整段参考视频)那一档的牌价 —— 比无视频输入更便宜。 */
  "video:seedance-2-mini:v2v-per-mtoken": {
    value: 2.1,
    unit: "USD/M tokens(含视频输入档)",
    source:
      "2026-08-29 arkcli 实查同一份 mini 档案:V2VCompletion.original_price = 0.0021/K tokens" +
      "(折后价 $0.84/M 同样不抄)",
    observedOn: "2026-08-29",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "整段参考视频 $0.49896 由此推导(原 gen.ts:436 的字面量)",
  },

  /* ── 视频:seedance 2.0 的 1080p 档(建表新增,今日代码没有这个条目) ── */

  /**
   * **来源性质 = 实测账单值**,不是公式推导值。
   *
   * 官方 token 公式推导 5s 1080p = 243,000 tokens,实测账单是 245,025(+0.83%),
   * 差异未解释 —— 取**实测**的那个(记高不记低,方向永远是我们吃亏那边)。
   *
   * 今日代码里没有 1080p 成本条目:成本函数对未知分辨率**回退 720p 档**。本钉点是
   * 建表新增,**不得沿用那个回退值** —— 回退值比真实成本低,沿用它等于把毛利算错。
   */
  "video:seedance-2.0:1080p-per-ktoken": {
    value: 0.0077,
    unit: "USD/K tokens(1080p 档)",
    source:
      "2026-08-29 arkcli 实查牌价 + 实测账单(回执档案 preserved/creation-probe-2026-08-29/)",
    observedOn: "2026-08-29",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note:
      "来源性质=实测账单值;官方 token 公式推导 5s=243,000(−0.83%),差异未解释,取实测保守值。" +
      "今日代码无 1080p 成本条目(未知分辨率回退 720p),本钉点为建表新增,不沿用回退值",
  },

  /**
   * 1080p 5 秒的实测 token 数 —— 与上一条配对,让 1080p 成本**可机器推导**:
   * 0.0077 × 245.025 = $1.8867 / 5s。两条分开钉,是因为单价与 token 数各有各的
   * 复核路径(单价看档案,token 数看账单)。
   */
  "video:seedance-2.0:1080p-tokens-per-5s": {
    value: 245_025,
    unit: "tokens/5s(实测)",
    source:
      "2026-08-29 arkcli 实查 + 实测账单(回执档案 preserved/creation-probe-2026-08-29/)",
    observedOn: "2026-08-29",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "与 1080p 单价配对:0.0077 × 245.025 = $1.8867/5s;官方公式 243,000 未采,取实测",
  },

  /* ── 图片:seedream ── */

  /** 正片图与参考图共用同一张账单基数(按张计价,不分尺寸与比例)。 */
  "image:seedream-lite:per-image": {
    value: 0.035,
    unit: "USD/张(按张计价,不分尺寸比例)",
    source:
      "现役 gen.ts:162 / refgen.ts:47 收编;" +
      "https://docs.byteplus.com/en/docs/ModelArk/Pricing(2026-08-05 核)+ 2026-06 真实账单佐证",
    observedOn: "2026-08-29",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "生成侧两条链路(正片图 / 参考图)今天同价,共用本钉点;将来换不同模型时再分钉点",
  },

  /** pro 图 —— 代码今日**没有**这个条目,建表新增(上架归 Creation 施工线)。 */
  "image:seedream-pro:per-image": {
    value: 0.045,
    unit: "USD/张",
    source: "2026-08-29 arkcli 实查(代码今日无此条目,建表新增)",
    observedOn: "2026-08-29",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "pro 图 2cr/张 由此推导;上架仍随 Creation 施工线",
  },

  /* ── 素材理解(三类:看图 / 读文档 / 看视频,同价按用量) ── */

  "understanding:in-per-mtoken": {
    value: 0.1,
    unit: "USD/M tokens",
    source: "现役 asset-understanding.ts:69 收编(理解模型票面牌价)",
    observedOn: "2026-08-18",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "看图 / 读文档 / 看视频三类同价,按用量算",
  },

  "understanding:out-per-mtoken": {
    value: 0.4,
    unit: "USD/M tokens",
    source: "现役 asset-understanding.ts:70 收编(理解模型票面牌价)",
    observedOn: "2026-08-18",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "看图 / 读文档 / 看视频三类同价,按用量算",
  },

  /* ── 搜索 ── */

  "search:tavily:basic-per-call": {
    value: 0.008,
    unit: "USD/次",
    source: "现役 pricing-config.ts:255 收编(Founder 2026-07-03 裁决内逐字记录的牌价)",
    observedOn: "2026-07-03",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note: "现役 research 走 basic 档(tavilySearch 不传 search_depth,Tavily 默认 basic)",
  },

  "search:tavily:advanced-per-call": {
    value: 0.016,
    unit: "USD/次",
    source: "现役 pricing-config.ts:255 收编(Founder 2026-07-03 裁决内逐字记录的牌价)",
    observedOn: "2026-07-03",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
  },

  /**
   * 回退通道 Brave。**计价锚不动** —— 收费仍按主通道 Tavily basic 算;
   * Brave 成本更低,所以走回退通道时毛利只会更高,不会更低。本钉点的作用是
   * 让毛利表能**证明**这句话,而不是让人相信它。
   */
  "search:brave:per-call": {
    value: 0.005,
    unit: "USD/次($5 / 1,000 次,Search plan)",
    source: "官方 API 定价页 brave.com/search/api(2026-09-01 当日核对)",
    observedOn: "2026-09-01",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note:
      "复核条款=首笔真实账单复核(公示价还没有账单佐证);" +
      "计价锚维持主通道 Tavily basic × 3,Brave 成本更低 = 回退通道毛利只高不低",
  },

  /* ── Stripe 手续费(实收系数闸消费这几行) ── */

  /**
   * 本地卡:3% + RM1.00/笔。两个数分两条钉点(比例一条、固定一条),因为它们
   * 在实收算术里是两个不同的项 —— 固定费对小额包咬得最狠。
   */
  "stripe:fee:local-card-percent": {
    value: 0.03,
    unit: "比例(本地卡,按笔金额)",
    source:
      "官方公示价页 stripe.com/en-my/pricing(2026-09-01 当日核对)+ 本账户沙盒 " +
      "balance_transaction 逐仙实证:RM25.00 → fee RM2.00(= 4% + RM1,即本地 3% + 国际 1%);" +
      "RM121.83 → 处理费 587 仙(= 4% + RM1,精确)",
    observedOn: "2026-09-01",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note:
      "复核条款=live 生产账户首笔真实付款后以 balance_transaction 复核一次" +
      "(沙盒证的是费率结构,不是 live 账户的合同费率);实收系数闸消费本行(Pro 包 ≈3.4%)",
  },

  /** 本地卡的每笔固定费,单位 **MYR 仙**(整数,与 Stripe `amount` 同单位,不引入浮点)。 */
  "stripe:fee:local-card-fixed-myr-minor": {
    value: 100,
    unit: "MYR 仙/笔(RM1.00)",
    source:
      "官方公示价页 stripe.com/en-my/pricing(2026-09-01 当日核对)+ 本账户沙盒 " +
      "balance_transaction 逐仙实证:RM25.00 → fee RM2.00(= 4% + RM1);" +
      "RM121.83 → 处理费 587 仙(= 4% + RM1,精确)",
    observedOn: "2026-09-01",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note:
      "复核条款=live 生产账户首笔真实付款后以 balance_transaction 复核一次;" +
      "单位是仙不是令吉 —— 与 Stripe amount 同单位,避免小数漂移",
  },

  /** 国际卡加成:在本地卡之上再 +1%(合 4% + RM1)。 */
  "stripe:fee:international-card-percent-surcharge": {
    value: 0.01,
    unit: "比例(国际卡加成;与本地卡叠加后 = 4% + RM1)",
    source:
      "本账户沙盒 balance_transaction 逐仙实证(与本地卡同两笔:RM25.00 → fee RM2.00;" +
      "RM121.83 → 处理费 587 仙)+ 官方公示价页 stripe.com/en-my/pricing(2026-09-01 当日核对)",
    observedOn: "2026-09-01",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note:
      "备案带:国际卡买 Pro 包系数 0.8852;研究档 2.06× 在该带实收 45.16%,已清线" +
      "(见 docs/specs/money-engine.md §7.9 注记)",
  },

  /** 货币转换加成:+2%。**当前不适用** —— 充值包 MYR 计价 + MYR 结算,没有转换。 */
  "stripe:fee:currency-conversion-percent": {
    value: 0.02,
    unit: "比例(货币转换加成)",
    source: "本账户沙盒 balance_transaction 逐仙实证:RM121.83 → 转换费 244 仙(= 2%,精确)",
    observedOn: "2026-09-01",
    nextReviewDate: FIRST_BATCH_REVIEW_DATE,
    note:
      "充值包 MYR 计价 + MYR 结算,当前不适用;" +
      "任何改币种的提案必须重过实收算术(这一行那时会真的咬到毛利)",
  },
} as const satisfies Record<string, CostPin>;

/** 钉点键 —— 收死的联合类型。表里没有的东西**编译期**就取不到值(fail closed)。 */
export type CostPinKey = keyof typeof COST_PINS;

/**
 * 取一条钉点的数值。键类型收死 —— 不存在「运行时缺键」这条路径,
 * 所以这里没有兜底值可编:大图那种不入表的东西,连写都写不出来。
 */
export function costPinValue(key: CostPinKey): number {
  return COST_PINS[key].value;
}

/* ─────────────────────────── 闸 ─────────────────────────── */

/** 闸的一条判词。`red` 必须让 CI 红;`yellow` 只提醒,不拦。 */
export type CostPinProblem = { level: "red" | "yellow"; pin: string; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 纯函数:把一条成本钉点的全部规则跑一遍。`today` 注入,所以「到期」这条是可测的。
 *
 * 规则(判词样式照抄 `evaluateFxPin`):
 *   C1 数值不是正有限数            → 红(声明烂掉了,不许当成没事)
 *   C2 日期不是 YYYY-MM-DD        → 红(同上:复核闹钟本身坏了)
 *   C3 缺 source                  → 红(**没出处的成本不是证据**)
 *   C4 today ≥ nextReviewDate     → 黄(复核到期,提醒;不拦发布)
 *
 * 红黄的分界与汇率钉点一致:**声明本身坏掉 = 红**(那是 bug,不是决定);
 * **该复核了 = 黄**(那是 Founder 的定价动作,提醒到位就够,不该把发布卡死)。
 */
export function evaluateCostPin(key: string, pin: CostPin, today: string): CostPinProblem[] {
  const out: CostPinProblem[] = [];
  const value = pin?.value;

  if (!Number.isFinite(value) || !(value > 0)) {
    out.push({
      level: "red",
      pin: key,
      message: `成本钉点 ${key} 的 value 不是正有限数(${String(value)})—— 成本没有基准,这条上面的每一次定价推导都是编的 (C1)`,
    });
  }

  for (const [field, dateValue] of [
    ["observedOn", pin?.observedOn],
    ["nextReviewDate", pin?.nextReviewDate],
  ] as const) {
    if (typeof dateValue !== "string" || !ISO_DATE.test(dateValue)) {
      out.push({
        level: "red",
        pin: key,
        message: `成本钉点 ${key} 的 ${field} 不是 YYYY-MM-DD(${String(dateValue)})—— 复核闹钟本身坏了 (C2)`,
      });
    }
  }

  if (typeof pin?.source !== "string" || !pin.source.trim()) {
    out.push({
      level: "red",
      pin: key,
      message: `成本钉点 ${key} 缺 source —— 一个查不到出处的成本不是证据 (C3)`,
    });
  }

  if (typeof pin?.nextReviewDate === "string" && ISO_DATE.test(pin.nextReviewDate) && today >= pin.nextReviewDate) {
    out.push({
      level: "yellow",
      pin: key,
      message:
        `成本钉点 ${key} 的复核期到了(nextReviewDate ${pin.nextReviewDate},今天 ${today})—— ` +
        `请核一次供应商牌价并更新这条钉点(数值 / 来源 / 观察日三项一起更新,并顺延 nextReviewDate) (C4)`,
    });
  }

  return out;
}

/** 纯函数:把整张钉点表跑一遍。CI 闸拿这个的返回值决定红/黄。 */
export function evaluateAllCostPins(today: string): CostPinProblem[] {
  const out: CostPinProblem[] = [];
  for (const [key, pin] of Object.entries(COST_PINS)) {
    out.push(...evaluateCostPin(key, pin, today));
  }
  return out;
}
