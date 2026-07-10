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

/* ── [wave-c · Z6-inbox] 客服内容工程:可直发级草稿 + 真语气重写 + 绑定式翻译 ───────
 * 判决口径:草稿要「可直发」——带客户名 + 这条对话的具体上下文(数量/价格/日期),缺知识时
 * 问尖锐的澄清问题,而不是「我查查再回你」。语气三档是真语域重写(不是贴前后缀),翻译绑到
 * Otto 起草的那条草稿的马来版孪生(不凭空造)。全部确定性:无 Date.now / 无 Math.random。 */
export type NsTone = "casual" | "semi" | "formal";

export const TONES: { id: NsTone; label: string }[] = [
  { id: "casual", label: "Casual" },
  { id: "semi", label: "Semi-formal" },
  { id: "formal", label: "Formal" },
];

/** 双语草稿:en/bm 一对孪生(翻译按钮在两者间切换,真有马来版,不假造)。 */
export interface NsBilingualDraft {
  en: string;
  bm: string;
  /** answer=有把握直答 · confirm=确认订单 · clarify=先问清楚(尖锐澄清,不硬答) */
  kind: "answer" | "confirm" | "clarify";
}

function firstNameOf(name?: string): string {
  if (!name) return "there";
  return name.replace(/^@/, "").split(/\s+/)[0] || "there";
}

function priceOf(id: string, fallback: number): number {
  return NS_PRODUCTS.find((p) => p.id === id)?.priceMyr ?? fallback;
}

/**
 * 可直发级草稿库(按对话 id;每条都是带上下文的完整答复,专业顾问看了会点头)。
 * 覆盖所有「最后一句是客户在等回复」的对话:直答 / 确认订单 / 尖锐澄清三型。
 * 没有键中的对话回落到 clarifyFallback —— 依旧是问尖锐问题,绝不「我查查」。
 */
const REPLY_LIBRARY: Record<string, NsBilingualDraft> = {
  // cv-01 Mei Ling — 确认 20 个可颂,周五 9am(20×RM8.50=RM170,一眼可核对)。
  // 定金政策(kb-06 / sn-pay)= 只对 >RM200 的单收 50%;RM170 在门槛之下,且 Mei Ling 是每周
  // 下办公室单的常客 —— 不索订金、到店结账才与本店自有政策一致,否则常客一句「不是超 RM200 才要订金?」即拆台。
  "cv-01": {
    kind: "confirm",
    en: "Confirmed, Mei Ling! 🥐 20 kaya butter croissants (20 × RM8.50 = RM170), Friday 9am pickup — I'll have them boxed and waiting at the counter. Just settle by DuitNow QR or cash when you collect, same as every week. See you Friday!",
    bm: "Confirmed, Mei Ling! 🥐 20 kaya butter croissant (20 × RM8.50 = RM170), ambil Jumaat 9 pagi — saya siapkan dalam kotak, tunggu di kaunter. Bayar guna DuitNow QR atau tunai masa ambil, macam biasa tiap minggu. Jumpa Jumaat!",
  },
  // cv-02 Priya — halal 认证(合规诚实版:不冒充 JAKIM,附价格与下一步)
  "cv-02": {
    kind: "answer",
    en: "Thanks for checking, Priya! 🙏 All our ingredients are halal-sourced and our kitchen is completely pork- and alcohol-free. To be upfront: we're not JAKIM-certified yet, so if you need certified-halal for an event, I want you to know that before you order. Happy to share our supplier list if it helps — and the pandan gula melaka cake is RM88, serves 8–10.",
    bm: "Terima kasih sebab tanya, Priya! 🙏 Semua bahan kami dari sumber halal dan dapur kami bebas khinzir serta alkohol sepenuhnya. Nak berterus terang: kami belum ada sijil JAKIM lagi, jadi kalau perlu halal bersijil untuk majlis, elok tahu dulu sebelum tempah. Boleh kongsi senarai pembekal kalau membantu — kek pandan gula melaka RM88, untuk 8–10 orang.",
  },
  // cv-05 Farah — 会议室早餐 15 pax / RM300 / 周三(尖锐澄清:要哪种组合 + 送达时间)
  "cv-05": {
    kind: "clarify",
    en: "Morning Farah! A spread like this for 15 pax sits comfortably within RM300 — we'd usually mix kaya croissants, onde-onde puffs and a pandan cake centrepiece. Two quick things so I quote exactly: do you want it mostly pastries, or a fuller breakfast with savouries too — and should we deliver to your office for 8am, or earlier? Tell me and I'll send the itemised quote today.",
    bm: "Selamat pagi Farah! Hidangan macam ni untuk 15 orang muat elok dalam RM300 — biasanya kami campur kaya croissant, onde-onde puff dan kek pandan sebagai centrepiece. Dua perkara supaya saya boleh quote tepat: nak lebih pastri, atau breakfast penuh dengan savoury sekali — dan nak hantar ke pejabat pukul 8 pagi atau lebih awal? Beritahu saya dan saya hantar quote berperincian hari ni.",
  },
  // cv-06 Zulaikha — 「Perfect thanks」收尾
  "cv-06": {
    kind: "answer",
    en: "Anytime, Zulaikha! 🙌 Thursday 8:30am, 24 kaya butter croissants — all set. I'll message you the moment they're boxed. Have a good week!",
    bm: "Sama-sama, Zulaikha! 🙌 Khamis 8:30 pagi, 24 kaya butter croissant — semua dah set. Saya mesej sebaik saja siap dalam kotak. Selamat menjalani minggu!",
  },
  // cv-07 Muthu — 沉睡 6 周大批发户回头(热情 + 尖锐:几箱/哪周,不乱报价)
  "cv-07": {
    kind: "clarify",
    en: "Muthu! Good to hear from you 🙌 Yes — wholesale cookie boxes are very much still on, and I can hold your usual Tuesday delivery. How many boxes this round, and which week? I'll keep the same rate as your last order and get it scheduled straight away.",
    bm: "Muthu! Gembira dengar khabar 🙌 Ya — kotak biskut borong masih ada, dan saya boleh simpan slot hantar Selasa macam biasa. Berapa kotak kali ni, dan minggu mana? Saya kekalkan kadar sama macam tempahan lepas dan terus jadualkan.",
  },
  // cv-09 Jason — catering「Approved」收尾
  "cv-09": {
    kind: "confirm",
    en: "Perfect, Jason — 4 assorted platters, RM1,450, delivered 9am on the 30th. It's locked in and I'll send a reminder the day before. Thank you! 🙏",
    bm: "Baik, Jason — 4 platter campuran, RM1,450, hantar 9 pagi pada 30hb. Dah disahkan dan saya akan hantar peringatan sehari sebelum. Terima kasih! 🙏",
  },
  // cv-12 Aisyah — 生日蛋糕照片 / 10 人 / 周六(尖锐:口味 + 字样 + 自取或送)
  "cv-12": {
    kind: "clarify",
    en: "Love this, Aisyah! 🎂 We can absolutely make a cake like this for Saturday, serving 10. Our closest match is the pandan gula melaka (RM88, serves 8–10); a fully custom design to match the photo, I'd quote once I know the details. Two quick things so I confirm today: what flavour would you like, and should we write a name or message on top? And is this pickup or delivery?",
    bm: "Suka betul, Aisyah! 🎂 Kami boleh buat kek macam ni untuk Sabtu, untuk 10 orang. Paling hampir ialah pandan gula melaka (RM88, untuk 8–10 orang); untuk reka bentuk custom ikut gambar, saya quote bila dah tahu butiran. Dua perkara supaya boleh sahkan hari ni: perisa apa yang dinak, dan nak tulis nama atau mesej atas kek? Ambil sendiri atau hantar?",
  },
  // cv-13 Kavitha — catering 报价跟进(逾期 5 天:道歉 + 报价仍有效 + 尖锐确认)
  "cv-13": {
    kind: "clarify",
    en: "Hi Kavitha — apologies for the wait 🙏 Yes, your June-event quote is still valid. To pick it back up: are the date and headcount still the same as before? Send me any changes and I'll refresh the quote and hold your slot today.",
    bm: "Hi Kavitha — maaf lambat balas 🙏 Ya, quote untuk majlis Jun masih sah. Untuk sambung semula: tarikh dan bilangan tetamu masih sama? Beritahu jika ada perubahan, saya kemas kini quote dan simpan slot hari ni.",
  },
};

/** 尖锐澄清回落(未键中的对话):依旧问具体细节,绝不「我查查再回你」。 */
function clarifyFallback(first: string): NsBilingualDraft {
  return {
    kind: "clarify",
    en: `Thanks, ${first}! I want to get this right rather than guess — could you share a couple of details: which item, how many, and when you need it? Once I have that, I'll confirm and send a price straight away.`,
    bm: `Terima kasih, ${first}! Saya nak buat betul-betul, bukan teka — boleh kongsi sikit butiran: item mana, berapa banyak, dan bila perlu? Bila dah tahu, saya sahkan dan hantar harga terus.`,
  };
}

/** 可直发级草稿:先查对话专属库,回落到尖锐澄清(带客户名)。 */
export function composeReply(cv: NsConversation, contactName?: string): NsBilingualDraft {
  return REPLY_LIBRARY[cv.id] ?? clarifyFallback(firstNameOf(contactName));
}

/** 报价草稿(OttoAssist「报个价」):用真实产品价,不凭空造。 */
export function composeQuote(contactName?: string): NsBilingualDraft {
  const first = firstNameOf(contactName);
  const cake = priceOf("prod-01", 88);
  const crois = priceOf("prod-02", 8.5);
  const tira = priceOf("prod-05", 14);
  const box = priceOf("prod-06", 68);
  return {
    kind: "answer",
    en: `Here are our most-loved bakes, ${first}: pandan gula melaka cake RM${cake} (serves 8–10), kaya butter croissant RM${crois}, kopi-O tiramisu cup RM${tira}, and the 12-piece gift box RM${box}. Delivery is RM8 flat across ${NS_BRAND.city}, free over RM120. Want me to put a box together for you?`,
    bm: `Ni antara bakes paling popular, ${first}: kek pandan gula melaka RM${cake} (untuk 8–10 orang), kaya butter croissant RM${crois}, kopi-O tiramisu cup RM${tira}, dan kotak hadiah 12 biji RM${box}. Penghantaran RM8 rata seluruh ${NS_BRAND.city}, percuma jika lebih RM120. Nak saya sediakan satu kotak untuk anda?`,
  };
}

/** 确认订单草稿(OttoAssist「确认订单」):对话有专属确认词就用它,否则给稳妥确认框架。 */
export function composeConfirm(cv: NsConversation, contactName?: string): NsBilingualDraft {
  const keyed = REPLY_LIBRARY[cv.id];
  if (keyed && keyed.kind === "confirm") return keyed;
  const first = firstNameOf(contactName);
  return {
    kind: "confirm",
    en: `Just to confirm, ${first}: I've noted your order and I'll have it ready as we discussed. A 50% deposit locks it in — DuitNow QR or transfer both work. Shall I go ahead?`,
    bm: `Sekadar sahkan, ${first}: tempahan dah saya catat dan akan disiapkan seperti dibincang. Deposit 50% untuk sahkan — DuitNow QR atau transfer boleh. Nak saya teruskan?`,
  };
}

/** #56 挽回提醒:按对话上下文拼出具体一句(客户名 + 他们问的东西),预览=真发,一眼可核对。 */
export function composeNudge(cv: NsConversation, contactName?: string): string {
  const first = firstNameOf(contactName);
  const item = nudgeItemFor(cv);
  return `Hi ${first}! Just following up on ${item} — I can still hold it for you and get it ready whenever suits. Want me to lock it in? 🙂`;
}

/** 从对话推出「要提醒的是哪一单」(不硬编码「your order」)。 */
function nudgeItemFor(cv: NsConversation): string {
  const hay = `${cv.subject} ${cv.messages.map((m) => m.text).join(" ")}`.toLowerCase();
  if (/wholesale|boxes|borong/.test(hay)) return "your wholesale cookie boxes";
  if (/cater|platter|event|breakfast|boardroom/.test(hay)) return "your catering order";
  const prod = NS_PRODUCTS.find((p) => hay.includes(p.name.toLowerCase()));
  if (prod) return `the ${prod.name.toLowerCase()}`;
  return "the order you were asking about";
}

/* ── 语气三档:真语域重写(先剥掉旧问候/尾 emoji,再按语域重建;§EFFECTIVENESS gap 3) ───
 * casual=保留缩写 + 一颗 emoji;semi=Hi + 友好收尾;formal=展开缩写、去 emoji、句号收尾 + Thank you。
 * 不再贴「Dear customer」,不再叠出重复问候/emoji。确定性,同输入同输出。
 * 随草稿语言走:马来/Manglish 草稿(翻译后再调语气)收尾/问候用马来语,不把英文
 * 「Let me know if that works」「Thank you.」胶到马来正文上(否则产出夹生 Manglish)。 */
const EMOJI_TEST = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2764}]/u;
const EMOJI_ALL = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2764}]/gu;
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwe're\b/gi, "we are"], [/\bwe'll\b/gi, "we will"], [/\bwe've\b/gi, "we have"], [/\bwe'd\b/gi, "we would"],
  [/\bI'll\b/g, "I will"], [/\bI'm\b/g, "I am"], [/\bI'd\b/g, "I would"], [/\bI've\b/g, "I have"],
  [/\byou're\b/gi, "you are"], [/\byou'll\b/gi, "you will"], [/\byou've\b/gi, "you have"],
  [/\bdon't\b/gi, "do not"], [/\bcan't\b/gi, "cannot"], [/\bwon't\b/gi, "will not"], [/\bisn't\b/gi, "is not"],
  [/\bit's\b/gi, "it is"], [/\bthat's\b/gi, "that is"], [/\bhere's\b/gi, "here is"], [/\blet's\b/gi, "let us"],
];

const GREETING_LEAD = /^\s*(hey there|hi there|hey|hi|hello|dear customer|dear|good (morning|afternoon|evening)|morning|afternoon|evening)\b[^.!?—-]*?[!,—–-]+\s*/i;
/** 剥掉开头的问候子句(含跟在后面的人名),避免叠出「Hey Mei Ling! Mei Ling! …」。 */
function stripLeadGreeting(s: string): string {
  const clause = s.replace(GREETING_LEAD, "");
  if (clause !== s) return clause;
  // 无分隔符的裸问候词兜底(如「Hi」独立开头)
  return s.replace(/^\s*(hey there|hi there|hey|hi|hello)\b[\s,]*/i, "");
}
function stripEmoji(s: string): string {
  return s.replace(EMOJI_ALL, "").replace(/\s+([.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
/** 句首及句号后重新大写(修缩写展开把「We're→we are」降格的小病)。 */
function recapitalize(s: string): string {
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

/** 草稿开场句(首个句末标点/破折号前)是否已直呼客户名 —— 是则不再叠一层问候。
 * 逐字符转义人名后按词界匹配,只看开场那一句(避免正文深处偶现同名误判)。 */
function addressesByName(text: string, name: string): boolean {
  const opener = text.split(/[.!?—–]/)[0] ?? text;
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${safe}\\b`, "i").test(opener);
}

/** 给一段草稿套语气 —— 真语域重写(不是贴前后缀)。firstName 让问候带上人名。
 * 草稿开场若已直呼客户名(如「Confirmed, Mei Ling!」「Muthu! …」「Thanks for checking, Priya!」),
 * 就地重塑语域、不再前置问候 —— 否则会叠出「Hey Priya! Thanks for checking, Priya! …」的重复挂名,
 * 或「Hi, Confirmed, Mei Ling! …」这类逗号拼接的别扭开场;开场是通用问候(Hi/Hey/Morning)时才
 * 剥掉并按语域重挂一个带名问候。确定性,同输入同输出。 */
export function applyTone(text: string, tone: NsTone, firstName?: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const named = firstName && firstName !== "there" ? firstName : "";
  // 开场已直呼其名 → 保留草稿自带的问候/称呼,只重塑语域,不再前置一层问候
  const addressed = !!named && addressesByName(trimmed, named);
  const body = addressed ? trimmed : stripLeadGreeting(trimmed).trim();
  if (!body) return trimmed;
  // 剥掉通用问候后,正文若仍以该名开头,问候也不重复挂名
  const who = !addressed && named && !addressesByName(body, named) ? ` ${named}` : "";
  // 语域收尾/问候随草稿语言走(马来/Manglish → 马来语;否则英文),避免夹生 Manglish
  const ms = detectLanguage(body) !== "English";
  switch (tone) {
    case "casual": {
      const out = addressed ? body : `${ms ? "Hai" : "Hey"}${who}! ${body}`;
      return EMOJI_TEST.test(out) ? out : `${out} 🥐`;
    }
    case "semi": {
      const out = addressed ? body : `Hi${who}, ${body}`;
      // 已带问句/邀约/道谢/收尾 emoji 即视为已收束,不再叠一句收尾(收束线索按语言)
      const closedCues = ms
        ? /beritahu saya|nak saya|boleh saya|terima kasih|jumpa|sama-sama|selamat/i
        : /let me know|happy to|shall i|want me to|thank/i;
      const signedOff = /[?]\s*$/.test(out) || closedCues.test(out) || EMOJI_TEST.test(out.slice(-2));
      if (signedOff) return out;
      return `${out} ${ms ? "Beritahu saya kalau sesuai ya 🙂" : "Let me know if that works 🙂"}`;
    }
    case "formal": {
      let b = stripEmoji(body);
      for (const [re, rep] of CONTRACTIONS) b = b.replace(re, rep);
      b = recapitalize(b);
      let out = addressed ? b : `Hi${who}, ${b}`;
      if (!/[.!?]$/.test(out)) out += ".";
      // 草稿结尾若已道谢,就不再叠一句道谢(道谢语按语言)
      const thanked = ms ? /(terima kasih)[.!]?\s*$/i.test(out) : /(thank you|thanks)[.!]?\s*$/i.test(out);
      if (thanked) return out;
      return `${out} ${ms ? "Terima kasih." : "Thank you."}`;
    }
  }
}

/** 语言检测(原型:关键词 → 展示 chip;支持马来/英/Manglish 口语)。 */
export function detectLanguage(text: string): string {
  const t = text.toLowerCase();
  if (/\b(bole|dh|nak|bila|ke|lah|eh)\b/.test(t)) return "Manglish";
  if (/\b(saya|boleh|terima kasih|nak|berapa|bila)\b/.test(t)) return "Bahasa Melayu";
  return "English";
}

/* ── [wave-b→c] 情绪 / 授权升级(确定性信号,非真 LLM;Otto 整块交人、不再起草的两类) ───────
 * 从一条对话的消息流派生升级信号:命中即 Otto 退场、把整条线交回人类(渲染层随之藏起草稿卡)。
 * 详见 escalationSignal:置信度闸 / 连续轮次闸 已于 wave-c 退役(与可直发澄清草稿信号相矛盾)。 */
export type NsEscalationKind = "sentiment" | "authority";
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
  // [wave-c 退役] 「置信度闸」(无知识命中)与「连续轮次闸」(客户连发)都已移除:两者只会在「末句是客户
  // 在等回复」的线程上触发 —— 而那种线程 Otto 一定已起草一条可直发的澄清草稿(问而不猜)。再挂一条
  // 「转人工/最好你来答」黄条,与其下『Use this draft』信号自相矛盾(商家困惑「它都写好了为什么还叫我接手」)。
  // 升级信号自此只保留「Otto 整块交人、不再起草」的两类:情绪(客户不高兴)与授权(Otto 无权答应的价格),
  // 这两类恰好也是渲染层唯一会藏起草稿卡的两类 —— 于是黄条与草稿卡天然互斥,不再并列自打脸。
  return { tripped: false, kind: null, reason: "" };
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
