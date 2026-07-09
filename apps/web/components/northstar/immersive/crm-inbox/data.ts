/**
 * 北极星 · crm-inbox 组视图数据(全部派生自 _mock,不发明品牌事实)
 *
 * 联系人 = NS_CONTACTS;对话 = NS_CONVERSATIONS;成交金额 = NS_CONTACTS.totalOrdersMyr;
 * 知识库口径 = NS_PRODUCTS + NS_BRAND;评论 = 派生自 NS_SCHEDULED_POSTS 的已发帖。
 * 结构常量(成交阶段、分群规则、试驾脚本、知识条目)是这一组的产品口径,不是新品牌事实 ——
 * 照 account-ops / schedule 派生视图模型的先例。
 *
 * 零后台 import;确定性(无 Date.now / 无 Math.random)。
 */

import {
  NS_BRAND,
  NS_CONTACTS,
  NS_PRODUCTS,
  NS_SCHEDULED_POSTS,
  type NsContact,
} from "@/components/northstar/_mock";
import { dealAmountMyr } from "../_selectors";

/* ── 联系人:deals 卡按 id 取名(身份链的实时读走共享 store) ──────────────── */
export function contactById(id: string): NsContact | undefined {
  return NS_CONTACTS.find((c) => c.id === id);
}

/* ── 成交(pipeline;金额派生自 totalOrdersMyr,不新造品牌事实) ─────────── */
export type NsDealStage = "lead" | "quote" | "confirmed" | "delivered";

export const DEAL_STAGES: { id: NsDealStage; label: string; hint: string }[] = [
  { id: "lead", label: "Lead", hint: "Reached out, no order yet" },
  { id: "quote", label: "Quote sent", hint: "Otto sent a price, waiting" },
  { id: "confirmed", label: "Confirmed", hint: "Order placed, not delivered" },
  { id: "delivered", label: "Delivered", hint: "Fulfilled and paid" },
];

export interface NsDeal {
  id: string;
  contactId: string;
  title: string;
  stage: NsDealStage;
  amountMyr: number;
  updatedAt: string;
}

/**
 * 成交由 mock 对话 + 联系人推出来的产品口径(非新品牌事实):
 * 每个联系人一张最近的成交单,阶段跟着他们最近一次对话/下单情况走。
 * 金额单一源:从脊梁的 totalOrdersMyr 派生(dealAmountMyr),同一客户在 contacts
 * 页与 deals 页显示同一笔钱(蓝图 §3.2 修金额漂移)—— 永不再硬编码。
 */
export const DEALS: NsDeal[] = [
  { id: "deal-01", contactId: "ct-01", title: "Friday office croissants ×20", stage: "confirmed", amountMyr: dealAmountMyr("ct-01"), updatedAt: "2026-07-07" },
  { id: "deal-02", contactId: "ct-02", title: "Wholesale restock ×60 boxes", stage: "quote", amountMyr: dealAmountMyr("ct-02"), updatedAt: "2026-07-05" },
  { id: "deal-03", contactId: "ct-03", title: "Pandan gula melaka cake", stage: "lead", amountMyr: dealAmountMyr("ct-03"), updatedAt: "2026-07-07" },
  { id: "deal-04", contactId: "ct-04", title: "Catering — 4 platters", stage: "delivered", amountMyr: dealAmountMyr("ct-04"), updatedAt: "2026-06-30" },
  { id: "deal-05", contactId: "ct-05", title: "Raya cookie gift boxes ×5", stage: "delivered", amountMyr: dealAmountMyr("ct-05"), updatedAt: "2026-07-04" },
];

export function dealsForContact(contactId: string): NsDeal[] {
  return DEALS.filter((d) => d.contactId === contactId);
}

/* ── 分群(saved segments;计数派生自 NS_CONTACTS,是真的过滤器) ─────────── */
export interface NsSegment {
  id: string;
  name: string;
  desc: string;
  /** 纯函数过滤器 → 计数与列表都从这里推,永不硬编码 */
  match: (c: NsContact) => boolean;
}

export const SEGMENTS: NsSegment[] = [
  {
    id: "seg-regulars",
    name: "Regulars",
    desc: "Tagged regular or office orders",
    match: (c) => c.tags.includes("regular") || c.tags.includes("office orders"),
  },
  {
    id: "seg-wholesale",
    name: "Wholesale & catering",
    desc: "Bulk buyers — wholesale or catering",
    match: (c) => c.tags.includes("wholesale") || c.tags.includes("catering"),
  },
  {
    id: "seg-vip",
    name: "Top spenders",
    desc: "Over RM1,000 in lifetime orders",
    match: (c) => c.totalOrdersMyr >= 1000,
  },
  {
    id: "seg-new",
    name: "New this week",
    desc: "First seen recently, room to nurture",
    match: (c) => c.tags.includes("new"),
  },
  {
    id: "seg-whatsapp",
    name: "On WhatsApp",
    desc: "Reachable on WhatsApp for order nudges",
    match: (c) => c.channels.includes("whatsapp") && !c.doNotDisturb,
  },
];

export function contactsInSegment(seg: NsSegment, source: NsContact[] = NS_CONTACTS): NsContact[] {
  return source.filter(seg.match);
}

/* ── 自建分群:人话 → 确定性规则(判决核心「用人话描述→规则编译」的原型体现) ───
 * 店主用一句人话描述这群人(「wholesale buyers who spent over RM1,000 on WhatsApp」),
 * 这里用纯关键词匹配把它编译成一串确定性规则 chip。零 LLM、零后台、可预期 —— 同一句
 * 话永远编出同一串规则。规则再喂进 contactMatchesRules 过滤联系人(与内建分群同口径)。 */
export type NsSegmentRule =
  | { kind: "spend_over"; value: number }
  | { kind: "channel"; value: NsContact["channels"][number] }
  | { kind: "tag"; value: string }
  | { kind: "active_within"; days: number }
  | { kind: "contactable" };

/** 相对锚点:mock 联系人 lastSeen 最新到 2026-07-07,品牌「今天」= 2026-07-08(确定性)。 */
export const SEGMENT_TODAY = "2026-07-08";

/** 分群规则可识别的标签词表(与 NS_CONTACTS.tags 口径一致)。 */
const SEGMENT_TAG_VOCAB = ["office orders", "wholesale", "catering", "regular", "vip", "new"];

const CHANNEL_LABEL: Record<NsContact["channels"][number], string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

/** 把一条规则翻成人话 chip 文案(新建预览与已存分群列表共用一句)。 */
export function ruleLabel(rule: NsSegmentRule): string {
  switch (rule.kind) {
    case "spend_over":
      return `Spent over RM${rule.value.toLocaleString("en-MY")}`;
    case "channel":
      return `Reaches on ${CHANNEL_LABEL[rule.value]}`;
    case "tag":
      return `Tagged “${rule.value}”`;
    case "active_within":
      return `Active in last ${rule.days} days`;
    case "contactable":
      return "Okay to message";
  }
}

function pushUnique(rules: NsSegmentRule[], rule: NsSegmentRule) {
  const key = JSON.stringify(rule);
  if (!rules.some((r) => JSON.stringify(r) === key)) rules.push(rule);
}

/** 人话 → 确定性规则串(关键词匹配;同输入永远同输出)。 */
export function compileSegmentPhrase(phrase: string): NsSegmentRule[] {
  const t = ` ${phrase.toLowerCase()} `;
  const rules: NsSegmentRule[] = [];

  // 消费门槛:出现 spend/spent/over RM/big spender/top/vip/high value 等 → 取句中数字(默认 1,000)
  if (/(spent|spend|spender|over rm|above rm|more than|rm\s*\d|ringgit|big buyer|high[- ]?value|top spender|\bvip\b)/.test(t)) {
    const m = t.match(/(?:rm|over|above|than)\s*rm?\s*([\d,]{2,})/) ?? t.match(/([\d,]{3,})/);
    const value = m ? parseInt(m[1].replace(/,/g, ""), 10) : 1000;
    if (!Number.isNaN(value) && value > 0) pushUnique(rules, { kind: "spend_over", value });
  }

  // 来源渠道
  if (/(instagram|insta|\big\b)/.test(t)) pushUnique(rules, { kind: "channel", value: "instagram" });
  if (/(whatsapp|whats app|\bwa\b)/.test(t)) pushUnique(rules, { kind: "channel", value: "whatsapp" });
  if (/(facebook|messenger|\bfb\b)/.test(t)) pushUnique(rules, { kind: "channel", value: "facebook" });

  // N 天活跃:出现 active/recent/engaged/lately/seen → 取「N day(s)」(默认 30)
  if (/(active|recent|engaged|lately|seen|this week|this month)/.test(t)) {
    const d = t.match(/(\d{1,3})\s*day/);
    pushUnique(rules, { kind: "active_within", days: d ? parseInt(d[1], 10) : 30 });
  }

  // 标签词表(长词优先,避免 "office orders" 被 "regular" 抢先)
  for (const tag of SEGMENT_TAG_VOCAB) {
    if (t.includes(tag)) pushUnique(rules, { kind: "tag", value: tag });
  }

  // 可联系(排除勿扰名单)
  if (/(contactable|reachable|can message|okay to message|not dnd|opt[- ]?in|marketing)/.test(t)) {
    pushUnique(rules, { kind: "contactable" });
  }

  return rules;
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00+08:00`);
  const db = Date.parse(`${b}T00:00:00+08:00`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(db - da) / 86_400_000;
}

/** 联系人是否命中一串规则(全部满足;空规则视为不命中,避免「新建空群」误收全体)。 */
export function contactMatchesRules(c: NsContact, rules: NsSegmentRule[]): boolean {
  if (rules.length === 0) return false;
  return rules.every((r) => {
    switch (r.kind) {
      case "spend_over":
        return c.totalOrdersMyr > r.value;
      case "channel":
        return c.channels.includes(r.value);
      case "tag":
        return c.tags.includes(r.value);
      case "active_within":
        return daysBetween(c.lastSeen, SEGMENT_TODAY) <= r.days;
      case "contactable":
        return !c.doNotDisturb;
    }
  });
}

/* ── 多渠道身份:把一个联系人在各渠道上的锚点摊开(身份合并卡读它) ───────────
 * channels 数组就是这个人的多渠道身份。handle 是为原型派生的展示串(社媒取名字首词,
 * WhatsApp 取显示名)—— 不新造后台事实,只把已有 channels 渲染成可读的身份行。 */
export interface NsIdentity {
  channel: NsContact["channels"][number];
  label: string;
  handle: string;
}

export function contactIdentities(c: NsContact): NsIdentity[] {
  const bare = c.name.replace(/^@/, "");
  const first = bare.split(/\s+/)[0]?.toLowerCase() ?? bare.toLowerCase();
  return c.channels.map((ch) => ({
    channel: ch,
    label: CHANNEL_LABEL[ch],
    handle:
      ch === "whatsapp"
        ? bare
        : c.name.startsWith("@")
          ? c.name
          : `@${first}`,
  }));
}

/* ── 评论(社媒帖子下的公开评论;派生自 NS_SCHEDULED_POSTS 已发帖) ──────── */
export interface NsComment {
  id: string;
  postId: string;
  postCaption: string;
  author: string;
  text: string;
  at: string;
  status: "new" | "replied";
  suggested: string;
}

const PUBLISHED = NS_SCHEDULED_POSTS.filter((p) => p.status === "published");

export const COMMENTS: NsComment[] = [
  {
    id: "cm-01",
    postId: PUBLISHED[0]?.id ?? "post-05",
    postCaption: PUBLISHED[0]?.caption ?? "Thank you KL, sold out by noon again.",
    author: "faridah.kl",
    text: "Do you deliver to Bangsar? 🥐",
    at: "2026-07-06T10:20:00+08:00",
    status: "new",
    suggested: "Hi Faridah! Yes we deliver to Bangsar — RM8 flat. Want me to set up an order?",
  },
  {
    id: "cm-02",
    postId: PUBLISHED[0]?.id ?? "post-05",
    postCaption: PUBLISHED[0]?.caption ?? "Thank you KL, sold out by noon again.",
    author: "danish_eats",
    text: "The kaya croissant is unreal. Back tomorrow!",
    at: "2026-07-06T11:05:00+08:00",
    status: "replied",
    suggested: "Terima kasih Danish! See you tomorrow 🙌",
  },
  {
    id: "cm-03",
    postId: PUBLISHED[1]?.id ?? "post-06",
    postCaption: PUBLISHED[1]?.caption ?? "New week, new bakes. What should we bring back?",
    author: "syaz.makan",
    text: "Bring back the onde-onde cream puff please 🙏",
    at: "2026-07-05T18:40:00+08:00",
    status: "new",
    suggested: "Noted Syaz! Onde-onde cream puff is on the list for next week 🥥",
  },
];

/* ── 知识库(Otto 回答客服问题时的依据;派生自 NS_PRODUCTS + NS_BRAND) ──── */
export interface NsKnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  category: "Products" | "Pickup & delivery" | "Payment" | "Brand";
  usedThisWeek: number;
}

export const KNOWLEDGE: NsKnowledgeEntry[] = [
  {
    id: "kb-01",
    question: "Is everything halal?",
    answer: `Yes — everything at ${NS_BRAND.name} is halal. Our kitchen is pork- and alcohol-free.`,
    category: "Brand",
    usedThisWeek: 12,
  },
  {
    id: "kb-02",
    question: "What's your best seller?",
    answer: `Our best sellers are the ${NS_PRODUCTS.filter((p) => p.bestSeller).map((p) => p.name).slice(0, 3).join(", ")}.`,
    category: "Products",
    usedThisWeek: 9,
  },
  {
    id: "kb-03",
    question: "How much is the pandan gula melaka cake?",
    answer: `The pandan gula melaka cake is RM${NS_PRODUCTS.find((p) => p.id === "prod-01")?.priceMyr ?? 88}. Whole cake, serves 8–10.`,
    category: "Products",
    usedThisWeek: 7,
  },
  {
    id: "kb-04",
    question: "Do you deliver?",
    answer: `We deliver across ${NS_BRAND.city} — RM8 flat within 10km, free over RM120. Pickup is free from the shop.`,
    category: "Pickup & delivery",
    usedThisWeek: 15,
  },
  {
    id: "kb-05",
    question: "What are your pickup hours?",
    answer: "Pickup is 9am–6pm daily. Fresh bakes are out by 8am; popular items sell out by noon.",
    category: "Pickup & delivery",
    usedThisWeek: 6,
  },
  {
    id: "kb-06",
    question: "How do I pay?",
    answer: "We take DuitNow QR, bank transfer, and cash on pickup. For orders over RM200 we ask for a 50% deposit.",
    category: "Payment",
    usedThisWeek: 5,
  },
];

export function knowledgeCategories(): NsKnowledgeEntry["category"][] {
  return ["Products", "Pickup & delivery", "Payment", "Brand"];
}

/* ── 试驾(让店主先扮客户,看 Otto 会怎么答;脚本派生自 KNOWLEDGE) ──────── */
export interface NsTestPrompt {
  id: string;
  label: string;
  /** 命中的知识条目 id → 回答从 KNOWLEDGE 取,保持一致口径 */
  knowledgeId: string;
}

export const TEST_PROMPTS: NsTestPrompt[] = [
  { id: "tp-halal", label: "Is your food halal?", knowledgeId: "kb-01" },
  { id: "tp-best", label: "What should I try first?", knowledgeId: "kb-02" },
  { id: "tp-deliver", label: "Do you deliver to my area?", knowledgeId: "kb-04" },
  { id: "tp-pay", label: "How can I pay?", knowledgeId: "kb-06" },
];

export function knowledgeAnswer(knowledgeId: string): string {
  return KNOWLEDGE.find((k) => k.id === knowledgeId)?.answer ?? "";
}

/**
 * 答案溯源(O-06):把一句客户问题匹配到知识库里的一条依据。
 * 命中 → 返回该条(Otto 的建议回复从它取答案、卡上挂可点「依据」);
 * 未命中 → undefined(调用方显示「无把握,请人工」,不捏造)。
 * 极简确定性关键词匹配(无 Date.now / 无 Math.random),口径与 test-drive 一致。
 */
const KNOWLEDGE_CUES: { id: string; cues: string[] }[] = [
  { id: "kb-01", cues: ["halal", "pork", "alcohol"] },
  { id: "kb-02", cues: ["best seller", "best-seller", "recommend", "try first", "popular", "favourite", "favorite"] },
  { id: "kb-03", cues: ["pandan", "gula melaka", "cake price", "how much"] },
  { id: "kb-04", cues: ["deliver", "delivery", "postage", "shipping", "bangsar", "area"] },
  { id: "kb-05", cues: ["pickup", "pick up", "hours", "open", "collect"] },
  { id: "kb-06", cues: ["pay", "payment", "duitnow", "deposit", "transfer", "cash"] },
];

export function matchKnowledge(question: string): NsKnowledgeEntry | undefined {
  const q = question.toLowerCase();
  const hit = KNOWLEDGE_CUES.find((k) => k.cues.some((c) => q.includes(c)));
  if (!hit) return undefined;
  return KNOWLEDGE.find((k) => k.id === hit.id);
}
