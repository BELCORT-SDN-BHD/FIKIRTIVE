/**
 * 北极星 · CRM 区结构数据(Z7 endgame;全部派生自 _mock,零新造品牌事实)
 *
 * 这里放 CRM 区专属、inbox 区不碰的结构常量与派生器 —— 独立文件是为了不与 inbox
 * worker 共享的 crm-inbox/data.ts 抢改动面(蓝图铁律:别越区改别人的文件)。
 * 金额永远走 dealAmountMyr(单一源 totalOrdersMyr),阶段/管道/公司都是产品口径。
 *
 * 零后台 import;确定性(无 Date.now / 无 Math.random)。
 */

import {
  NS_CONTACTS,
  NS_PRODUCTS,
  type NsContact,
  type NsLifecycle,
} from "@/components/northstar/_mock";
import { dealAmountMyr } from "../_selectors";
import { DEALS, SEGMENTS, SEGMENT_TODAY, type NsDeal, type NsDealStage, type NsSegment } from "./data";

/* ── 多管道(WHATPASS 一·B「多条管道」)——[wave-b] 多管道 ──────────────────────
 * 老客复购与新客开发是两条节奏不同的生意,分两张看板看。管道归属由联系人生命周期
 * 确定性派生(new/lead → 新客开发;其余 → 老客复购),不新造字段。 */
export interface NsPipeline {
  id: "new" | "repeat";
  label: string;
  hint: string;
}

export const PIPELINES: NsPipeline[] = [
  { id: "new", label: "New business", hint: "First-time buyers finding their way in" },
  { id: "repeat", label: "Repeat orders", hint: "Regulars and wholesale coming back" },
];

const LIFECYCLE_BY_ID: Record<string, NsLifecycle | undefined> = Object.fromEntries(
  NS_CONTACTS.map((c) => [c.id, c.lifecycle]),
);

export function dealPipeline(deal: NsDeal): NsPipeline["id"] {
  const lc = LIFECYCLE_BY_ID[deal.contactId];
  return lc === "new" || lc === "lead" ? "new" : "repeat";
}

/* ── 更密的成交板(endgame 密度:五条种子 + 九条 CRM 侧,覆盖两管道四阶段) ──────
 * 每条金额仍走 dealAmountMyr(同客户在 contacts / profile / deals 三处一致)。 */
const CRM_DEALS: NsDeal[] = [
  { id: "deal-06", contactId: "ct-06", title: "Tower 3pm pickups ×15", stage: "confirmed", amountMyr: dealAmountMyr("ct-06"), updatedAt: "2026-07-07" },
  { id: "deal-07", contactId: "ct-09", title: "Boardroom breakfast platter", stage: "quote", amountMyr: dealAmountMyr("ct-09"), updatedAt: "2026-07-06" },
  { id: "deal-08", contactId: "ct-12", title: "Weekend celebration cake", stage: "delivered", amountMyr: dealAmountMyr("ct-12"), updatedAt: "2026-07-03" },
  { id: "deal-09", contactId: "ct-13", title: "Wholesale restock — revive", stage: "lead", amountMyr: dealAmountMyr("ct-13"), updatedAt: "2026-05-30" },
  { id: "deal-10", contactId: "ct-16", title: "Weekly office croissants", stage: "confirmed", amountMyr: dealAmountMyr("ct-16"), updatedAt: "2026-07-07" },
  { id: "deal-11", contactId: "ct-19", title: "Raya catering — win back", stage: "lead", amountMyr: dealAmountMyr("ct-19"), updatedAt: "2026-06-15" },
  { id: "deal-12", contactId: "ct-20", title: "First office trial order", stage: "quote", amountMyr: dealAmountMyr("ct-20"), updatedAt: "2026-07-07" },
  { id: "deal-13", contactId: "ct-22", title: "Fortnightly family box", stage: "delivered", amountMyr: dealAmountMyr("ct-22"), updatedAt: "2026-07-05" },
  { id: "deal-14", contactId: "ct-10", title: "Catering enquiry follow-up", stage: "quote", amountMyr: dealAmountMyr("ct-10"), updatedAt: "2026-06-22" },
];

/** CRM 页读的完整成交列表(种子 DEALS + CRM 侧);deals / profile 共用,永不各写各的。 */
export const ALL_DEALS: NsDeal[] = [...DEALS, ...CRM_DEALS];

export function allDealsForContact(contactId: string): NsDeal[] {
  return ALL_DEALS.filter((d) => d.contactId === contactId);
}

/* ── 简版预测(WHATPASS 一·B「一行数字」)——[wave-b] 简版预测一行数字 ──────────
 * 不是复杂销售预测表,只把每个开口成交按阶段概率加权,给一句「预计能进账多少」。 */
export const STAGE_PROBABILITY: Record<NsDealStage, number> = {
  lead: 0.2,
  quote: 0.5,
  confirmed: 0.85,
  delivered: 1,
};

/** 开口成交(未交付)的概率加权预期总额,四舍五入到整 RM。 */
export function expectedRevenue(deals: { stage: NsDealStage; amountMyr: number }[]): number {
  return Math.round(
    deals
      .filter((d) => d.stage !== "delivered")
      .reduce((sum, d) => sum + d.amountMyr * STAGE_PROBABILITY[d.stage], 0),
  );
}

/* ── B2B 公司轻量档案(WHATPASS 一·A)——[wave-b] B2B 公司轻量档案 ────────────────
 * 一家公司挂多个对接人;做批发/代理的老板看「这家公司」整体往来,不散在各联系人里。
 * 轻量版:名称 + 行业 + 联系人列表,不做母子公司层级。contactIds 全部是真联系人。 */
export interface NsCompany {
  id: string;
  name: string;
  industry: string;
  contactIds: string[];
}

export const COMPANIES: NsCompany[] = [
  { id: "co-01", name: "Nadi Coffee Co.", industry: "Café wholesale", contactIds: ["ct-02", "ct-13"] },
  { id: "co-02", name: "Menara Prima offices", industry: "Corporate catering", contactIds: ["ct-04", "ct-09", "ct-16"] },
  { id: "co-03", name: "Suria Events", industry: "Events & catering", contactIds: ["ct-10", "ct-19"] },
];

export function companyForContact(contactId: string): NsCompany | undefined {
  return COMPANIES.find((co) => co.contactIds.includes(contactId));
}

/** 公司整体往来额(旗下联系人 totalOrdersMyr 求和;公司卡副行显示)。 */
export function companyOrdersMyr(company: NsCompany): number {
  return company.contactIds.reduce((sum, id) => sum + (dealAmountMyr(id) || 0), 0);
}

/* ── 查重候选(WHATPASS 一·A「查重去重」)——[wave-b] 查重合并提示 ────────────────
 * 名字规整后首词相同、或整名互为子串,视作可能重复。用于:CSV 导入预览打「可能重复」标、
 * 联系人列表顶部「N 个可能重复」提示。确定性,纯字符串比较。 */
function normName(name: string): string {
  return name.replace(/^@/, "").trim().toLowerCase();
}

export function firstToken(name: string): string {
  return normName(name).split(/\s+/)[0] ?? "";
}

/** 一条(新)名字是否与现有某联系人可能是同一人(首词相同即命中,轻量口径)。 */
export function findDuplicate(name: string, pool: NsContact[]): NsContact | undefined {
  const n = normName(name);
  const ft = firstToken(name);
  if (!ft) return undefined;
  return pool.find((c) => {
    const cn = normName(c.name);
    return cn === n || (firstToken(c.name) === ft && (cn.includes(n) || n.includes(cn) || cn.split(/\s+/)[0] === n.split(/\s+/)[0]));
  });
}

/** 联系人簿内互为可能重复的成对(列表顶部提示读它;同首词分组,组内两两成对)。 */
export function duplicatePairs(pool: NsContact[]): { a: NsContact; b: NsContact }[] {
  const byFirst = new Map<string, NsContact[]>();
  for (const c of pool) {
    const ft = firstToken(c.name);
    if (!ft) continue;
    byFirst.set(ft, [...(byFirst.get(ft) ?? []), c]);
  }
  const pairs: { a: NsContact; b: NsContact }[] = [];
  for (const group of byFirst.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        pairs.push({ a: group[i], b: group[j] });
      }
    }
  }
  return pairs;
}

/* ── 生命周期配方库(WHATPASS 一·F「预建生命周期自动化配方库」,Klaviyo 偷设计 #1)──
 * [wave-b] lifecycle 阶段+流失唤回(配方侧):老板不用自己想要不要发欢迎语,装现成配方,
 * 开关一开就在跑。这里是人看得懂的规则文件(非拖拽画布);toggle 落进共享 store 的 rules。 */
export interface NsLifecycleRecipe {
  id: string;
  name: string;
  when: string;
  then: string;
}

export const LIFECYCLE_RECIPES: NsLifecycleRecipe[] = [
  { id: "rec-welcome", name: "Welcome new customers", when: "A new contact says hello", then: "Otto sends a warm welcome + best-seller picks" },
  { id: "rec-winback", name: "Win back quiet customers", when: "A regular goes 30 days quiet", then: "Otto drafts a gentle we-miss-you nudge" },
  { id: "rec-reorder", name: "Reorder reminder", when: "A repeat buyer is due to reorder", then: "Otto suggests their usual order" },
  { id: "rec-birthday", name: "Birthday treat", when: "It's a customer's birthday", then: "Otto sends a birthday discount" },
];

/* ── CSV 导入样例(WHATPASS 一·A「CSV 批量导入」)——[wave-b] CSV 导入向导 ───────────
 * 原型层没有真文件系统:向导用一段样例 CSV 演示「贴表 → 映射 → 预览查重 → 确认」四步。
 * 故意混入一行与现有 Mei Ling Tan 同名 → 预览打「可能重复」,让查重合并当场看得见。 */
export const SAMPLE_CSV = `name,phone,channel,tags
Zamir Osman,+60 12-778 3345,whatsapp,catering
Lena Koh,+60 16-220 9987,instagram,new
Mei Ling Tan,+60 12-334 8821,whatsapp,office orders
Ravi Chandran,+60 13-556 1122,whatsapp,wholesale
Farah Idris,+60 17-889 2200,facebook,new`;

export interface NsCsvRow {
  name: string;
  phone: string;
  channel: NsContact["channels"][number];
  tags: string[];
}

/** 极简 CSV 解析(逗号分隔、首行表头;渠道回落 whatsapp)。确定性,零依赖。 */
export function parseCsv(text: string): NsCsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col("name");
  const iPhone = col("phone");
  const iChannel = col("channel");
  const iTags = col("tags");
  const validChannels: NsContact["channels"][number][] = ["whatsapp", "instagram", "facebook"];
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const rawCh = (cells[iChannel] ?? "").toLowerCase() as NsContact["channels"][number];
    return {
      name: cells[iName] ?? "",
      phone: cells[iPhone] ?? "",
      channel: validChannels.includes(rawCh) ? rawCh : "whatsapp",
      tags: (cells[iTags] ?? "").split(/[;|]/).map((t) => t.trim()).filter(Boolean),
    };
  }).filter((r) => r.name);
}

/* ── 额外内建分群(lifecycle 侧):流失唤回 + 热门线索 ─────────────────────────────
 * [wave-b] lifecycle 阶段+流失唤回 / Otto 热度标签:把生命周期做成分群一等公民。 */
export const CRM_EXTRA_SEGMENTS: NsSegment[] = [
  {
    id: "seg-winback",
    name: "Win-back (quiet)",
    desc: "Gone quiet — worth a gentle nudge",
    match: (c) => c.lifecycle === "dormant",
  },
  {
    id: "seg-hot",
    name: "Hot right now",
    desc: "Otto's warmest leads this week",
    match: (c) => c.heat === "hot",
  },
];

/* ── 价值分离分群(治 ledger「高终身价值/高近期价值/季节大宗分开」)——[wave-c] ──────
 * 三个群按不同的钱分开,不再一个「Top spenders」糊在一起。各带经营读数(segmentValueRead)。 */
export const VALUE_SEGMENTS: NsSegment[] = [
  {
    id: "seg-ltv",
    name: "High lifetime value",
    desc: "Your biggest earners over all time — protect these",
    match: (c) => c.totalOrdersMyr >= 1500,
  },
  {
    id: "seg-recent",
    name: "High recent value",
    desc: "Hot right now and spending big — strike while warm",
    match: (c) => c.heat === "hot" && (c.predictedNextMyr ?? 0) >= 200,
  },
  {
    id: "seg-seasonal",
    name: "Seasonal bulk buyers",
    desc: "Wholesale & catering — big periodic orders (Raya, events)",
    match: (c) => c.tags.includes("wholesale") || c.tags.includes("catering"),
  },
];

/** 分群页读的完整分群(价值分离 + lifecycle 侧 + 通用内建;自建分群仍来自 store)。
 * 通用 SEGMENTS 里被 VALUE_SEGMENTS 更利索取代的两个(seg-vip / seg-wholesale)去重,
 * 避免「Top spenders」和「High lifetime value」并列的冗余(不改共享 data.ts)。 */
const SUPERSEDED = new Set(["seg-vip", "seg-wholesale"]);
export const ALL_SEGMENTS: NsSegment[] = [
  ...VALUE_SEGMENTS,
  ...CRM_EXTRA_SEGMENTS,
  ...SEGMENTS.filter((s) => !SUPERSEDED.has(s.id)),
];

/* ── 报价单可选商品(WHATPASS 一·G)——[wave-b] 极简报价单+收款链接 ─────────────── */
export function quoteProducts() {
  return NS_PRODUCTS.map((p) => ({ id: p.id, name: p.name, priceMyr: p.priceMyr }));
}

/* ── 流失天数(win-back 文案:距今多久没下单;确定性,锚 SEGMENT_TODAY) ─────────── */
export function daysSince(iso: string): number {
  const then = Date.parse(`${iso.slice(0, 10)}T00:00:00+08:00`);
  const now = Date.parse(`${SEGMENT_TODAY}T00:00:00+08:00`);
  if (Number.isNaN(then) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [wave-c] CRM 内容工程 · Z7-crm —— 三套加权打分 + 诚实预测(GOOSEWORKS-MAP §一·工具2)
 *
 * 把「智能层」从死查表升级成可解释的加权打分:每个结论都由真实字段现算,带得出算式,
 * 顾问抽查能问「为什么」。全部确定性、纯函数、零 Math.random / 零 Date.now。
 *
 * 冷启动诚实(founder 铁律):我们还没有每单的日期历史,所以「正常复购节律」用一条
 * 全店默认线 QUIET_THRESHOLD_DAYS,并在 UI 明说是行业默认 —— 等 Otto 见过一个账号
 * 几张单后再收紧到它自己的节律。绝不谎报还不存在的 per-account 节律。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 平均客单价(totalOrdersMyr / orderCount;无单则 0)。本地算,自足不外借。 */
function avgOrder(c: NsContact): number {
  const n = c.orderCount ?? 0;
  return n > 0 ? Math.round(c.totalOrdersMyr / n) : 0;
}

/** 全店默认「静默线」——单一自洽阈值(治 ledger gap#5「三套 dormant 定义」)。
 * 三处(名册唤回条 / 热度理由 / 档案预测)共用它;「静默」由 daysSince 现算,不再看
 * 硬编码 lifecycle。21 天是一家面包店的默认线,标注为行业默认,学到账号节律后收紧。 */
export const QUIET_THRESHOLD_DAYS = 21;

/** 诚实提示语:凡显示节律/静默线处附上它(冷启动标注)。 */
export const CADENCE_NOTE =
  "The quiet line below is a bakery default until Otto has seen a few of each account's orders — then it tightens to their real rhythm.";

/** 某客是否「该被唤回」= 有过订单 + 静默超过默认线(自洽,不看 lifecycle 硬标)。 */
export function isQuiet(c: NsContact): boolean {
  return (c.orderCount ?? 0) > 0 && daysSince(c.lastSeen) > QUIET_THRESHOLD_DAYS;
}

/* ── 公式一 · 流失风险(churn)= Σ(signal_weight × signal_present) ────────────────
 * 权重 Critical=25 / High=15 / Medium=8 / Low=3;分档 Red 70-100 / Orange 40-69 /
 * Yellow 20-39 / Green 0-19,每档配行动窗。每条信号是一句能解释「为什么在险」的人话。 */
const CHURN_WEIGHT = { critical: 25, high: 15, medium: 8, low: 3 } as const;

export interface NsChurnSignal {
  id: string;
  label: string;
  weight: number;
}
export interface NsChurnResult {
  score: number;
  band: "green" | "yellow" | "orange" | "red";
  bandLabel: string;
  /** 行动窗一句人话(每档配截止节奏) */
  actionBy: string;
  /** 命中的信号(带权重;顺序 = 权重降序) */
  signals: NsChurnSignal[];
  /** 在险金额:该客的生涯往来(丢了要重新赚回的钱) */
  atRiskMyr: number;
}

export function churnResult(c: NsContact): NsChurnResult {
  const days = daysSince(c.lastSeen);
  const quiet = days > QUIET_THRESHOLD_DAYS;
  const longQuiet = days > QUIET_THRESHOLD_DAYS * 2;
  const bigValue = c.totalOrdersMyr >= 1500 || c.tags.includes("wholesale");
  const value = c.totalOrdersMyr.toLocaleString("en-MY");
  const signals: NsChurnSignal[] = [];

  if (longQuiet) {
    signals.push({ id: "long-quiet", label: `No order in ${days} days — well past the ${QUIET_THRESHOLD_DAYS}-day line`, weight: CHURN_WEIGHT.high });
  } else if (quiet) {
    signals.push({ id: "quiet", label: `Quiet ${days} days — past the ${QUIET_THRESHOLD_DAYS}-day line`, weight: CHURN_WEIGHT.medium });
  }
  if (quiet && bigValue) {
    signals.push({ id: "big-at-stake", label: `RM${value} account at stake — costly to replace`, weight: CHURN_WEIGHT.critical });
  }
  if (quiet && (c.tags.includes("wholesale") || c.lifecycle === "vip")) {
    signals.push({ id: "anchor", label: "Anchor account — wholesale/VIP you'd rather not lose", weight: CHURN_WEIGHT.high });
  }
  if (c.heat === "cold") {
    signals.push({ id: "cold", label: "Gone cold — no recent messages", weight: CHURN_WEIGHT.medium });
  } else if (c.heat === "warm" && quiet) {
    signals.push({ id: "cooling", label: "Cooling off — quieter than their usual", weight: CHURN_WEIGHT.low });
  }
  if ((c.orderCount ?? 0) === 1 && quiet) {
    signals.push({ id: "fragile", label: "Only one order so far — the habit hasn't formed", weight: CHURN_WEIGHT.low });
  }

  signals.sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));

  let band: NsChurnResult["band"];
  let bandLabel: string;
  let actionBy: string;
  if (score >= 70) { band = "red"; bandLabel = "High risk"; actionBy = "Reach out this week"; }
  else if (score >= 40) { band = "orange"; bandLabel = "At risk"; actionBy = "Reach out in the next few days"; }
  else if (score >= 20) { band = "yellow"; bandLabel = "Watch"; actionBy = "Keep an eye on them"; }
  else { band = "green"; bandLabel = "Healthy"; actionBy = "No action needed"; }

  return { score, band, bandLabel, actionBy, signals, atRiskMyr: quiet ? c.totalOrdersMyr : 0 };
}

/** 全书在险总额:静默客生涯往来求和 + 占全书百分比(卡头「Total at-risk = RM X (Y%)」)。 */
export function atRiskSummary(contacts: NsContact[]): { count: number; totalMyr: number; pctOfBook: number } {
  const book = contacts.reduce((s, c) => s + c.totalOrdersMyr, 0);
  const atRisk = contacts.filter(isQuiet);
  const totalMyr = atRisk.reduce((s, c) => s + c.totalOrdersMyr, 0);
  return { count: atRisk.length, totalMyr, pctOfBook: book > 0 ? Math.round((totalMyr / book) * 100) : 0 };
}

/* ── 公式二 · 唤回排序(win-back)= Account Value × Addressability / Time Decay ──────
 * 借 expansion-signal-spotter 的乘法排序 + win-back-sequencer 的时间衰减:让最大值 ×
 * 最可触达 × 离得最近的客户浮到最顶,治 ledger gap#3(唤回不按在险金额排,散客乱入)。 */
function timeDecay(days: number): number {
  if (days <= 45) return 1.0;   // 甜区:刚静默,最好救
  if (days <= 90) return 1.2;
  if (days <= 180) return 1.5;
  return 2.0;                    // 走太久,救回概率低
}

export function winBackScore(c: NsContact): number {
  const days = daysSince(c.lastSeen);
  const addressability = c.doNotDisturb ? 0.5 : 1.0; // 勿扰名单更难触达
  return Math.round((c.totalOrdersMyr * addressability) / timeDecay(days));
}

/** 该被唤回的客户,按 winBackScore 降序(最大在险浮顶;散客沉底)。 */
export function winBackList(contacts: NsContact[]): NsContact[] {
  return contacts.filter(isQuiet).sort((a, b) => winBackScore(b) - winBackScore(a));
}

/** 唤回「为什么现在」一句(现读字段,带金额/单数/天数,不露馅)。 */
export function winBackWhy(c: NsContact): string {
  const days = daysSince(c.lastSeen);
  const value = c.totalOrdersMyr.toLocaleString("en-MY");
  const orders = c.orderCount ?? 0;
  if (c.totalOrdersMyr >= 1500) {
    return `One of your biggest accounts — RM${value} across ${orders} orders, quiet ${days} days.`;
  }
  return `RM${value} across ${orders} order${orders === 1 ? "" : "s"}, quiet ${days} days.`;
}

/** 唤回预填草稿(金额/节律/渠道全从真字段拼;店主改一句就能发)。治 ledger gap#4(空待办)。
 * 冷启动诚实:只用真知道的(分群类型 + 平均客单),不编造「60 箱/周二」这类没有的细节。 */
export function winBackDraft(c: NsContact): string {
  const first = c.name.replace(/^@/, "").split(/\s+/)[0];
  const avg = avgOrder(c);
  const avgPhrase = avg > 0 ? ` (your last few ran about RM${avg})` : "";
  if (c.tags.includes("wholesale")) {
    return `Hi ${first}! It's been a while — your wholesale slot is open again this week. Want me to line up your usual restock${avgPhrase}? 🥐`;
  }
  if (c.tags.includes("catering")) {
    return `Hi ${first}! Anything coming up we can cater? Happy to hold a slot for you${avgPhrase} — just say the date. 🎉`;
  }
  if (c.tags.includes("office orders") || c.tags.includes("regular")) {
    return `Hi ${first}! We've missed your orders lately — should I set up your usual for this week${avgPhrase}? 🥐`;
  }
  return `Hi ${first}! It's been a little while — anything I can bake for you this week${avgPhrase}? 😊`;
}

/* ── 公式三 · 增购潜力(expansion)= Signal Strength × Account Value × Timing ────────
 * 借 expansion-signal-spotter 的乘法:哪些活跃客值得先推一单更大的。驱动热度理由的
 * 「为什么是热 / 该补货了」判断,治 ledger gap#2(热度理由死查表)。 */
export function expansionScore(c: NsContact): number {
  const strength = c.heat === "hot" ? 1.0 : c.heat === "warm" ? 0.6 : 0.2;
  const accountValue = c.totalOrdersMyr >= 1500 ? 2.0 : c.totalOrdersMyr >= 500 ? 1.5 : 1.0;
  const days = daysSince(c.lastSeen);
  // Timing:离上次越近、且订过多次 = 复购窗口正开着,现在推最省力
  const timing = days <= QUIET_THRESHOLD_DAYS && (c.orderCount ?? 0) >= 2 ? 2.0 : days <= QUIET_THRESHOLD_DAYS ? 1.5 : 1.0;
  return Math.round(strength * accountValue * timing * 10) / 10;
}

/* ── 诚实的「预计下次」——治 ledger gap#1(最大批发户 RM3,120 被标预测 RM0 的矛盾) ─────
 * 活跃客用脊梁的 predictedNextMyr;静默客该字段是 0(还没排下一单)→ 改显示「复购潜力」
 * = 平均客单价。永不对最大客户显示 RM0。basis 让 UI 说清这数字是怎么来的。 */
export type NsPredictBasis = "scheduled" | "repeat-potential" | "first-order" | "unknown";

export function predictedNext(c: NsContact): { amountMyr: number; basis: NsPredictBasis } {
  const raw = c.predictedNextMyr ?? 0;
  if (raw > 0) return { amountMyr: raw, basis: (c.orderCount ?? 0) <= 1 ? "first-order" : "scheduled" };
  const avg = avgOrder(c);
  if (avg > 0) return { amountMyr: avg, basis: "repeat-potential" };
  return { amountMyr: 0, basis: "unknown" };
}

/** 「预计下次」的人话依据(档案 stat 副行 / tooltip)。 */
export function predictBasisLabel(basis: NsPredictBasis): string {
  switch (basis) {
    case "scheduled": return "next order due";
    case "repeat-potential": return "repeat potential";
    case "first-order": return "first order pending";
    case "unknown": return "no history yet";
  }
}

/** 一个分群的经营读数:生涯往来 + 预计下一轮总额(分群头显示,列表可按它排)。 */
export function segmentValueRead(members: NsContact[]): { lifetimeMyr: number; nextMyr: number } {
  const lifetimeMyr = members.reduce((s, c) => s + c.totalOrdersMyr, 0);
  const nextMyr = members.reduce((s, c) => s + predictedNext(c).amountMyr, 0);
  return { lifetimeMyr, nextMyr };
}
