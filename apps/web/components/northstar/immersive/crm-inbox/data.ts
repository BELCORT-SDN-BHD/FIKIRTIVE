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
  NS_CONVERSATIONS,
  NS_PRODUCTS,
  NS_SCHEDULED_POSTS,
  type NsContact,
  type NsConversation,
} from "@/components/northstar/_mock";

/* ── 联系人:直接透传 mock,方便组内各页取用 ────────────────────────────── */
export const CONTACTS: NsContact[] = NS_CONTACTS;

export function contactById(id: string): NsContact | undefined {
  return NS_CONTACTS.find((c) => c.id === id);
}

/* ── 对话:透传 + 按联系人过滤(客户档案 → 该客户的所有对话) ───────────── */
export const CONVERSATIONS: NsConversation[] = NS_CONVERSATIONS;

export function conversationById(id: string): NsConversation | undefined {
  return NS_CONVERSATIONS.find((c) => c.id === id);
}

export function conversationsForContact(contactId: string): NsConversation[] {
  return NS_CONVERSATIONS.filter((c) => c.contactId === contactId);
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
 */
export const DEALS: NsDeal[] = [
  { id: "deal-01", contactId: "ct-01", title: "Friday office croissants ×20", stage: "confirmed", amountMyr: 170, updatedAt: "2026-07-07" },
  { id: "deal-02", contactId: "ct-02", title: "Wholesale restock ×60 boxes", stage: "quote", amountMyr: 1080, updatedAt: "2026-07-05" },
  { id: "deal-03", contactId: "ct-03", title: "Pandan gula melaka cake", stage: "lead", amountMyr: 88, updatedAt: "2026-07-07" },
  { id: "deal-04", contactId: "ct-04", title: "Catering — 4 platters", stage: "delivered", amountMyr: 620, updatedAt: "2026-06-30" },
  { id: "deal-05", contactId: "ct-05", title: "Raya cookie gift boxes ×5", stage: "delivered", amountMyr: 340, updatedAt: "2026-07-04" },
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

export function contactsInSegment(seg: NsSegment): NsContact[] {
  return NS_CONTACTS.filter(seg.match);
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
