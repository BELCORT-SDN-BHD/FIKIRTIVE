/**
 * 北极星 · 收件箱 + 生命周期区(Z6)Wave B 静态口径
 *
 * WHATPASS 二章 63 条候选的种子数据 —— 全部派生自 _mock(NS_PRODUCTS / NS_BRAND /
 * NS_CONTACTS / NS_CONVERSATIONS / NS_SCHEDULED_POSTS),不发明新品牌事实。结构常量
 * (模板/流程/话术/配方/关键词/护栏)是这一区的产品口径,照 crm-inbox/data.ts 先例。
 *
 * 铁律:纯 client、零后台 import;确定性(无 Date.now / 无 Math.random);
 * 图片只从 NS_IMAGES 取(nsImage);coral 只属于 Otto。
 */

import {
  NS_BRAND,
  NS_PRODUCTS,
  NS_CONTACTS,
  nsImage,
  type NsConversation,
} from "@/components/northstar/_mock";
import { matchKnowledge, type NsKnowledgeEntry } from "./data";

/* ── [wave-b] WABA 模板消息库 + 送审状态 ────────────────────────────────────── */
export type NsTemplateStatus = "approved" | "pending" | "rejected" | "draft";
export type NsTemplateCategory = "Marketing" | "Utility" | "Authentication";

export interface NsWabaTemplate {
  id: string;
  name: string;
  category: NsTemplateCategory;
  language: string;
  body: string;
  /** 种子送审状态(可被 store 的 templateStatus 覆盖成审核演出) */
  status: NsTemplateStatus;
  usedThisWeek: number;
}

export const WABA_TEMPLATES: NsWabaTemplate[] = [
  { id: "wt-order", name: "Order confirmation", category: "Utility", language: "English", body: `Hi {{1}}, your ${NS_BRAND.name} order is confirmed — {{2}} for pickup {{3}}. See you then 🥐`, status: "approved", usedThisWeek: 42 },
  { id: "wt-delivery", name: "Out for delivery", category: "Utility", language: "English", body: "Hi {{1}}, your bakes are on the way — arriving around {{2}}. Track: {{3}}", status: "approved", usedThisWeek: 18 },
  { id: "wt-payment", name: "Payment reminder", category: "Utility", language: "English", body: "Hi {{1}}, a friendly reminder — RM{{2}} is due for your order {{3}}. DuitNow QR or transfer both work 🙏", status: "approved", usedThisWeek: 11 },
  { id: "wt-merdeka", name: "Merdeka gift box promo", category: "Marketing", language: "English", body: `Selamat Menyambut Merdeka! Our gift box is back — 12 pieces, RM68. Reply YES to reserve before it sells out.`, status: "pending", usedThisWeek: 0 },
  { id: "wt-winback", name: "We miss you", category: "Marketing", language: "Bahasa Melayu", body: "Hi {{1}}, lama tak jumpa! Here's 10% off your next box — just reply and Otto will sort it out.", status: "approved", usedThisWeek: 6 },
  { id: "wt-review", name: "Review request", category: "Marketing", language: "English", body: "Hope you enjoyed your bakes, {{1}}! Mind leaving us a quick review? It really helps a small shop 💛", status: "draft", usedThisWeek: 0 },
];

/* ── [wave-b] WhatsApp Flow(聊天内互动表单) ──────────────────────────────────── */
export interface NsWaFlow {
  id: string;
  name: string;
  purpose: string;
  fields: string[];
  status: "published" | "draft";
}

export const WA_FLOWS: NsWaFlow[] = [
  { id: "fl-order", name: "Quick order", purpose: "Collect an order without leaving WhatsApp", fields: ["Pickup or delivery", "Which bakes", "Date & time", "Name"], status: "published" },
  { id: "fl-catering", name: "Catering enquiry", purpose: "Qualify a catering lead in one form", fields: ["Event date", "Headcount", "Budget", "Delivery area"], status: "published" },
  { id: "fl-feedback", name: "Post-order feedback", purpose: "One-tap rating after pickup", fields: ["Rating 1–5", "What could be better?"], status: "draft" },
];

/* ── [wave-b] 快捷话术库 / 宏(Snippets / Macros) ─────────────────────────────── */
export interface NsSnippet {
  id: string;
  shortcut: string;
  title: string;
  text: string;
  usedThisWeek: number;
}

export const SNIPPETS: NsSnippet[] = [
  { id: "sn-hours", shortcut: "/hours", title: "Pickup hours", text: "We're open 9am–6pm daily. Fresh bakes are out by 8am and popular items sell out by noon 🥐", usedThisWeek: 23 },
  { id: "sn-deliver", shortcut: "/deliver", title: "Delivery info", text: `We deliver across ${NS_BRAND.city} — RM8 flat within 10km, free over RM120. Pickup is free from the shop.`, usedThisWeek: 19 },
  { id: "sn-pay", shortcut: "/pay", title: "How to pay", text: "We take DuitNow QR, bank transfer, and cash on pickup. For orders over RM200 we ask for a 50% deposit.", usedThisWeek: 14 },
  { id: "sn-halal", shortcut: "/halal", title: "Halal", text: "Our bakes are pork-free and alcohol-free. We're not JAKIM-certified yet — for strict certified-halal requirements, please confirm before ordering.", usedThisWeek: 12 },
  { id: "sn-thanks", shortcut: "/thanks", title: "Thank you", text: "Terima kasih for your order! We'll have it fresh and ready for you 💛", usedThisWeek: 31 },
  { id: "sn-deposit", shortcut: "/deposit", title: "Deposit ask", text: "To lock in this order we take a 50% deposit — DuitNow QR works great. I'll confirm the moment it's in 🙏", usedThisWeek: 8 },
];

/* ── [wave-b] 关键词/规则自动回复(触发词→回复,file-system 风格,非画布) ───────── */
export interface NsKeywordRule {
  id: string;
  keyword: string;
  reply: string;
  defaultOn: boolean;
}

export const KEYWORD_RULES: NsKeywordRule[] = [
  { id: "kr-price", keyword: "price / how much", reply: "Sends the price list snippet", defaultOn: true },
  { id: "kr-hours", keyword: "open / hours", reply: "Replies with pickup hours", defaultOn: true },
  { id: "kr-deliver", keyword: "deliver / postage", reply: "Replies with delivery info", defaultOn: true },
  { id: "kr-location", keyword: "where / location", reply: "Sends the shop location pin", defaultOn: false },
];

/* ── [wave-b] Comment-to-DM 增长钩子(评论/Story/关注/直播 → 私信) ─────────────── */
export interface NsCommentHook {
  id: string;
  event: "comment" | "story" | "follow" | "share" | "live";
  label: string;
  detail: string;
  defaultOn: boolean;
}

export const COMMENT_HOOKS: NsCommentHook[] = [
  { id: "hk-comment", event: "comment", label: "Comment keyword → DM", detail: "When someone comments “LINK”, Otto DMs them the order link and replies publicly", defaultOn: true },
  { id: "hk-story", event: "story", label: "Story reply → DM", detail: "A reply or @mention on your Story kicks off a welcome DM with today's specials", defaultOn: false },
  { id: "hk-follow", event: "follow", label: "New follow → welcome DM", detail: "New followers get a hello + first-order treat within a minute", defaultOn: false },
  { id: "hk-live", event: "live", label: "Live comment → DM", detail: "During a live, comments with your keyword get an auto DM so nobody's missed", defaultOn: false },
];

/* ── [wave-b] 生命周期配方库(Klaviyo flows — 本区核心) ──────────────────────────
 * 预建配方:选开关即上线,默认文案配好。usesCredits 会挂 coral「Uses credits」小徽。 */
export interface NsRecipe {
  id: string;
  name: string;
  trigger: string;
  steps: string[];
  category: "Welcome" | "Recover" | "Retain" | "Grow";
  defaultOn: boolean;
  /** 依赖订单/行为数据源(未接则灰,提示先连) */
  needsData?: boolean;
}

export const RECIPES: NsRecipe[] = [
  { id: "rc-welcome", name: "Welcome new customer", trigger: "First message or first order", steps: ["Send a warm hello + best sellers", "Wait 2 days", "Nudge with a first-order treat"], category: "Welcome", defaultOn: true },
  { id: "rc-abandoned", name: "Abandoned cart recovery", trigger: "Asked for a price, no order in 24h", steps: ["Wait 24h", "Send a gentle “still want this?” with the item", "Offer to hold it till end of day"], category: "Recover", defaultOn: false, needsData: true },
  { id: "rc-postpurchase", name: "Post-purchase thank you", trigger: "Order marked delivered", steps: ["Thank them + care tips", "Wait 3 days", "Recommend the next best bake"], category: "Retain", defaultOn: true },
  { id: "rc-winback", name: "Win back sleeping customers", trigger: "No order in 90 days", steps: ["Send a “we miss you” with 10% off", "Wait 5 days", "Last nudge before we rest it"], category: "Recover", defaultOn: false },
  { id: "rc-backinstock", name: "Back in stock", trigger: "A sold-out item is baked again", steps: ["Notify everyone who asked", "First 50 get an early window"], category: "Grow", defaultOn: false, needsData: true },
  { id: "rc-pricedrop", name: "Price drop / weekend deal", trigger: "You mark a weekend special", steps: ["Send the deal to the right segment", "Follow up with anyone who replied"], category: "Grow", defaultOn: false },
];

/* ── [wave-b] 触发数据源接入(订单/行为事件 —— SEA marketplace 空位) ─────────────── */
export interface NsDataSource {
  id: string;
  name: string;
  connected: boolean;
  note: string;
}

export const DATA_SOURCES: NsDataSource[] = [
  { id: "ds-manual", name: "Manual orders (WhatsApp)", connected: true, note: "Orders you confirm in chat already feed your flows" },
  { id: "ds-shopee", name: "Shopee", connected: false, note: "Sync orders & abandoned carts for recovery flows" },
  { id: "ds-lazada", name: "Lazada", connected: false, note: "Sync orders for post-purchase & win-back" },
  { id: "ds-tiktok", name: "TikTok Shop", connected: false, note: "Sync orders from your TikTok storefront" },
];

/* ── [wave-b] 客户打分:规则式加减分(热/温/冷) ───────────────────────────────── */
export interface NsLeadScoreRule {
  id: string;
  behavior: string;
  points: number;
}

export const LEAD_SCORE_RULES: NsLeadScoreRule[] = [
  { id: "ls-order", behavior: "Placed an order", points: 20 },
  { id: "ls-reply", behavior: "Replied within a day", points: 8 },
  { id: "ls-repeat", behavior: "Ordered 3+ times", points: 25 },
  { id: "ls-quiet", behavior: "No reply in 30 days", points: -15 },
  { id: "ls-optout", behavior: "Turned on do not disturb", points: -30 },
];

/* ── [wave-b] 同行对标 Benchmark(行业公开基准替代跨租户池) ────────────────────── */
export const INBOX_BENCHMARKS: { label: string; you: string; peers: string; ahead: boolean }[] = [
  { label: "First-reply time", you: "3 min", peers: "18 min", ahead: true },
  { label: "Resolution rate", you: "94%", peers: "81%", ahead: true },
  { label: "Broadcast open rate", you: "62%", peers: "58%", ahead: true },
  { label: "Win-back conversion", you: "9%", peers: "12%", ahead: false },
];

/* ── [wave-b] 商品目录卡片(聊天内发商品;图片取自 NS_IMAGES 经 NS_PRODUCTS) ─────── */
export interface NsCatalogCard {
  productId: string;
  name: string;
  priceMyr: number;
  image: string;
}

export const CATALOG_CARDS: NsCatalogCard[] = NS_PRODUCTS.map((p) => ({
  productId: p.id,
  name: p.name,
  priceMyr: p.priceMyr,
  image: p.image,
}));

/* ── [wave-b] AI 客服护栏配置(话题白名单 + 动作范围声明) ─────────────────────── */
export interface NsGuardrail {
  id: string;
  label: string;
  detail: string;
  defaultOn: boolean;
}

export const GUARDRAILS: NsGuardrail[] = [
  { id: "gr-orders", label: "Answer order & product questions", detail: "Prices, availability, pickup, delivery — from your knowledge base", defaultOn: true },
  { id: "gr-faq", label: "Answer FAQs", detail: "Halal, hours, payment, location", defaultOn: true },
  { id: "gr-reserve", label: "Take reservations & confirm orders", detail: "Otto can confirm an order and log it", defaultOn: true },
  { id: "gr-discount", label: "Offer discounts on its own", detail: "Off by default — Otto asks you before promising any price off", defaultOn: false },
  { id: "gr-refund", label: "Handle refunds & complaints", detail: "Off by default — these always go to you", defaultOn: false },
];

/* ── [wave-b] 三档语气 + AI 帮写/翻译(确定性文本变换,非真 LLM) ───────────────── */
export type NsTone = "casual" | "semi" | "formal";

export const TONES: { id: NsTone; label: string }[] = [
  { id: "casual", label: "Casual" },
  { id: "semi", label: "Semi-formal" },
  { id: "formal", label: "Formal" },
];

/** 给一段草稿套语气(原型:确定性前后缀 + 收尾,不动核心句意)。 */
export function applyTone(text: string, tone: NsTone): string {
  const core = text.replace(/\s+$/,"");
  if (!core) return core;
  switch (tone) {
    case "casual":
      return `Hey! ${core} 🥐`;
    case "semi":
      return `Hi there — ${core} Let me know if that works!`;
    case "formal":
      return `Dear customer, ${core} Thank you for choosing ${NS_BRAND.name}.`;
  }
}

/** AI 帮写:从最近一条客户问题起草一句(命中知识库取答案,否则给稳妥占位)。 */
export function draftReplyFor(question: string): string {
  const hit = matchKnowledge(question);
  if (hit) return hit.answer;
  return "Thanks for your message! Let me check on that and get right back to you 🙏";
}

/** 翻译(原型:英⇄马来的固定对照演示,证明按钮真的做事)。 */
export function translateDraft(text: string): string {
  const t = text.toLowerCase();
  const looksMalay = /\b(saya|boleh|terima kasih|ada|nak|bila|berapa)\b/.test(t);
  if (looksMalay) {
    return "Sure! We're open 9am–6pm daily. Would you like to place an order?";
  }
  return "Baik! Kami buka 9 pagi–6 petang setiap hari. Nak buat tempahan?";
}

/** 语言检测(原型:关键词 → 展示 chip;支持马来/英/Manglish 口语)。 */
export function detectLanguage(text: string): string {
  const t = text.toLowerCase();
  if (/\b(bole|dh|nak|bila|ke|lah|eh)\b/.test(t)) return "Manglish";
  if (/\b(saya|boleh|terima kasih|nak|berapa|bila)\b/.test(t)) return "Bahasa Melayu";
  return "English";
}

/* ── [wave-b] 连续轮次 + 置信度双闸 · 三类人在环升级(确定性信号,非真 LLM) ───────
 * 从一条对话的消息流派生升级信号:任一命中即建议转人工。护栏行为的原型体现。 */
export type NsEscalationKind = "confidence" | "rounds" | "sentiment" | "authority";
export interface NsEscalationSignal {
  tripped: boolean;
  kind: NsEscalationKind | null;
  reason: string;
}

const NEGATIVE_CUES = ["refund", "angry", "terrible", "complaint", "cancel", "wrong", "late", "disappointed", "bad"];
const AUTHORITY_CUES = ["discount", "refund", "cancel", "wholesale price", "special price", "cheaper"];

export function escalationSignal(cv: NsConversation): NsEscalationSignal {
  const msgs = cv.messages;
  const lastCustomer = [...msgs].reverse().find((m) => m.from === "customer");
  const lastText = lastCustomer?.text.toLowerCase() ?? "";

  // 情绪闸:负面词命中 → 立即转人工
  if (NEGATIVE_CUES.some((c) => lastText.includes(c))) {
    return { tripped: true, kind: "sentiment", reason: "This customer sounds unhappy — Otto flagged it for you" };
  }
  // 高授权闸:折扣/退款类请求 → 转人工
  if (AUTHORITY_CUES.some((c) => lastText.includes(c))) {
    return { tripped: true, kind: "authority", reason: "They're asking about pricing Otto can't promise on its own" };
  }
  // 能力边界 + 置信度闸:最后一句客户问题无知识依据 → 转人工
  if (lastCustomer && !matchKnowledge(lastText)) {
    return { tripped: true, kind: "confidence", reason: "Nothing in Knowledge covers this — best answered by you" };
  }
  // 连续轮次闸:客户连发 3+ 条 Otto 都没解决 → 转人工
  const customerRun = countTrailingCustomer(msgs);
  if (customerRun >= 2) {
    return { tripped: true, kind: "rounds", reason: "A few messages in and still going — time for a human touch" };
  }
  return { tripped: false, kind: null, reason: "" };
}

function countTrailingCustomer(msgs: NsConversation["messages"]): number {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].from === "customer") n++;
    else break;
  }
  return n;
}

/* ── [wave-b] 自愈知识库:从已解决对话起草待审批补丁(HubSpot KB Agent 反向回路) ───
 * 派生自对话里无知识依据、店主亲手答掉的问答;店主一键 approve/reject。 */
export interface NsKbPatch {
  id: string;
  question: string;
  answer: string;
  category: NsKnowledgeEntry["category"];
  sourceLabel: string;
  sourceConversationId: string;
}

export const KB_PATCHES: NsKbPatch[] = [
  { id: "kp-01", question: "Do you cater for weddings?", answer: `Yes — ${NS_BRAND.name} does wedding dessert tables and gift favours. Tell us the date and headcount and we'll quote.`, category: "Products", sourceLabel: "Corporate catering follow-up", sourceConversationId: "cv-13" },
  { id: "kp-02", question: "Can I freeze the cakes?", answer: "Our cakes keep 3 days chilled. You can freeze slices up to 2 weeks — thaw in the fridge overnight.", category: "Products", sourceLabel: "Birthday cake photo", sourceConversationId: "cv-12" },
  { id: "kp-03", question: "Do you do same-day delivery?", answer: "Same-day delivery is possible before 2pm within 10km, subject to the day's orders. Message us early to lock it in.", category: "Pickup & delivery", sourceLabel: "Boardroom breakfast", sourceConversationId: "cv-05" },
];

/* ── [wave-b] 未答问题:从对话流派生 Otto 答不上的问题清单 ─────────────────────── */
export interface NsUnanswered {
  conversationId: string;
  question: string;
  subject: string;
}

export function unansweredFrom(conversations: NsConversation[]): NsUnanswered[] {
  const out: NsUnanswered[] = [];
  for (const cv of conversations) {
    const lastCustomer = [...cv.messages].reverse().find((m) => m.from === "customer");
    if (!lastCustomer) continue;
    // 最后一句是客户问的、且知识库没依据 → 归入未答清单
    const isLast = cv.messages[cv.messages.length - 1]?.from === "customer";
    if (isLast && !matchKnowledge(lastCustomer.text)) {
      out.push({ conversationId: cv.id, question: lastCustomer.text, subject: cv.subject });
    }
  }
  return out;
}

/* ── 群发过路成本演示(号码质量 / 送审拦截口径;透传不加价) ─────────────────────── */
export const NUMBER_QUALITY = {
  rating: "High" as const,
  tier: "Tier 2 · up to 10,000 business-initiated / 24h",
  note: "Otto paces marketing sends so you never trip Meta's limits or hurt your quality rating.",
};

/* ── 冷启动导入:把粘贴的号码解析成受众计数(确定性,无副作用) ───────────────────── */
export function parseImportedNumbers(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => /\d/.test(s));
}

/** 联系人里带该来源(CTWA 广告)的进线,用于「来源打标」演示计数。 */
export function ctwaContacts() {
  return NS_CONTACTS.filter((c) => (c.source ?? "").toLowerCase().includes("ctwa"));
}

export { nsImage };
