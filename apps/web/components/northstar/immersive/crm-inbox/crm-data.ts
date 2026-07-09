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

/** 分群页读的完整分群(内建 + lifecycle 侧;自建分群仍来自 store)。 */
export const ALL_SEGMENTS: NsSegment[] = [...CRM_EXTRA_SEGMENTS, ...SEGMENTS];

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
