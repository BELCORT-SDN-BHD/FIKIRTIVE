/**
 * 北极星原型 · 收件箱客服区示例数据(仅 inbox 区页面使用)
 *
 * 全部派生 / 延展自 ../_mock(联系人 = NS_CONTACTS,价格 = NS_PRODUCTS,
 * 帖子 = NS_SCHEDULED_POSTS);零后台 import,全确定性(固定「今天」= 2026-07-07)。
 * 场景:Roti Bulan Bakery 的 WhatsApp-first 客服台。
 */

import { NS_PRODUCTS, NS_SCHEDULED_POSTS, nsPlaceholder } from "../_mock";

export const IB_TODAY = "2026-07-07";

/* ── 渠道口径(与排期区同法:brand 图标不入 Lucide,用 micro-mono 短码) ── */
export type IbChannel = "whatsapp" | "instagram" | "facebook";

export const IB_CHANNELS: Record<IbChannel, { short: string; label: string }> = {
  whatsapp: { short: "WA", label: "WhatsApp" },
  instagram: { short: "IG", label: "Instagram" },
  facebook: { short: "FB", label: "Facebook" },
};

/* ── 知识库(KnowledgeDoc:Otto 对客答案的唯一溯源对象) ─────────────────── */
export interface IbDocVersion {
  v: number;
  date: string;
  note: string;
  by: string;
}

export interface IbKnowledgeDoc {
  id: string;
  title: string;
  status: "published" | "draft";
  updated: string;
  citedCount: number;
  excerpt: string;
  versions: IbDocVersion[];
}

const p = (id: string) => NS_PRODUCTS.find((x) => x.id === id)!;

export const IB_KNOWLEDGE_DOCS: IbKnowledgeDoc[] = [
  {
    id: "kd-01",
    title: "Menu and pricing",
    status: "published",
    updated: "2026-07-02",
    citedCount: 34,
    excerpt: `${p("prod-01").name} RM${p("prod-01").priceMyr} · ${p("prod-02").name} RM${p("prod-02").priceMyr} · ${p("prod-05").name} RM${p("prod-05").priceMyr}. Whole-cake orders need 2 days notice.`,
    versions: [
      { v: 4, date: "2026-07-02", note: "Updated croissant price to RM8.50", by: "Aisyah" },
      { v: 3, date: "2026-06-18", note: "Added kopi-O tiramisu cup", by: "Aisyah" },
      { v: 2, date: "2026-05-30", note: "Added seasonal Raya gift box", by: "Aisyah" },
      { v: 1, date: "2026-05-12", note: "First version from the printed menu", by: "Aisyah" },
    ],
  },
  {
    id: "kd-02",
    title: "Order lead times and pickup",
    status: "published",
    updated: "2026-06-28",
    citedCount: 18,
    excerpt:
      "Same-day pickup for pastries before 11am. Whole cakes need 2 days notice. Office orders of 20+ items need 1 day notice and are confirmed by the owner.",
    versions: [
      { v: 2, date: "2026-06-28", note: "Added 20+ item office-order rule", by: "Aisyah" },
      { v: 1, date: "2026-05-20", note: "First version", by: "Aisyah" },
    ],
  },
  {
    id: "kd-03",
    title: "Delivery areas and fees",
    status: "published",
    updated: "2026-06-30",
    citedCount: 12,
    excerpt:
      "We deliver within KL and Selangor. RM10 within 10km of the shop, RM15 for Petaling Jaya and Subang Jaya. Free delivery for orders above RM150.",
    versions: [
      { v: 3, date: "2026-06-30", note: "Free delivery above RM150", by: "Aisyah" },
      { v: 2, date: "2026-06-10", note: "Added Subang Jaya", by: "Aisyah" },
      { v: 1, date: "2026-05-15", note: "First version", by: "Aisyah" },
    ],
  },
  {
    id: "kd-04",
    title: "Store hours and location",
    status: "published",
    updated: "2026-06-20",
    citedCount: 9,
    excerpt:
      "Open Tuesday to Sunday, 8am to 6pm. Closed Mondays. 12 Jalan Bangsar Utama 3, Kuala Lumpur. Nearest LRT: Bank Rakyat-Bangsar.",
    versions: [
      { v: 1, date: "2026-06-20", note: "First version", by: "Aisyah" },
    ],
  },
  {
    id: "kd-05",
    title: "Refunds and cancellations",
    status: "published",
    updated: "2026-06-25",
    citedCount: 4,
    excerpt:
      "Refunds and cancellations are decided by the owner, case by case. Otto never processes payments or refunds; it hands these conversations to a person.",
    versions: [
      { v: 2, date: "2026-06-25", note: "Clarified the hand-to-owner rule", by: "Aisyah" },
      { v: 1, date: "2026-05-18", note: "First version", by: "Aisyah" },
    ],
  },
];

/** 知识飞轮:从已解决对话沉淀出来的 Otto 草稿(待店主过目) */
export interface IbSuggestedDoc {
  id: string;
  title: string;
  fromConversation: string;
  fromLabel: string;
  excerpt: string;
}

export const IB_SUGGESTED_DOCS: IbSuggestedDoc[] = [
  {
    id: "kd-draft-01",
    title: "Halal certification status",
    fromConversation: "cv-02",
    fromLabel: "Priya Nair · Instagram · resolved yesterday",
    excerpt:
      "All ingredients are halal-sourced and the kitchen is pork-free. The shop is not yet JAKIM-certified; certification is in progress. Say this plainly when asked.",
  },
  {
    id: "kd-draft-02",
    title: "Bulk office orders",
    fromConversation: "cv-03",
    fromLabel: "Hafiz Abdullah · WhatsApp · resolved 2 days ago",
    excerpt:
      "Office orders of 20+ croissants get a flat RM8.50 each with 1 day notice. Wholesale standing orders are handled by the owner directly.",
  },
];

/* ── 会话(共享收件箱 + 对话视图共用一份数据) ───────────────────────────── */
export type IbFrom = "customer" | "owner" | "otto" | "note";
export type IbDelivery = "sent" | "delivered" | "read";

export interface IbMessage {
  id: string;
  from: IbFrom;
  text: string;
  day: string;
  time: string;
  media?: string;
  /** 出站(owner/otto)送达态 */
  delivery?: IbDelivery;
  /** Otto 答案溯源:这句来自哪份 KnowledgeDoc */
  sourceDocId?: string;
}

export interface IbConversation {
  id: string;
  contactName: string;
  initials: string;
  channel: IbChannel;
  /** 联系人的全部渠道身份(档案侧栏) */
  channels: IbChannel[];
  tags: string[];
  dnd: boolean;
  totalOrdersMyr: number;
  unread: boolean;
  /** 未答优先:最后一条是客户且无人回 */
  needsReply: boolean;
  assignee: "otto" | "owner" | "none";
  /** Otto 此刻正在敲回复(共享列表的 live 行) */
  ottoLive?: boolean;
  aiOn: boolean;
  messages: IbMessage[];
}

export const IB_CONVERSATIONS: IbConversation[] = [
  {
    id: "cv-01",
    contactName: "Mei Ling Tan",
    initials: "MT",
    channel: "whatsapp",
    channels: ["whatsapp", "instagram"],
    tags: ["regular", "office orders"],
    dnd: false,
    totalOrdersMyr: 640,
    unread: true,
    needsReply: false,
    assignee: "otto",
    aiOn: true,
    messages: [
      { id: "m-01", from: "customer", text: "Hi, can I order 20 croissants for Friday 9am pickup?", day: "2026-07-07", time: "08:12" },
      { id: "m-02", from: "otto", text: "Yes we can do 20 kaya butter croissants for Friday 9am. That comes to RM170. Shall I confirm the order?", day: "2026-07-07", time: "08:12", delivery: "read", sourceDocId: "kd-02" },
      { id: "m-03", from: "customer", text: "Confirm please, thank you!", day: "2026-07-07", time: "08:15" },
      { id: "m-04", from: "otto", text: "Done. 20 kaya butter croissants, Friday 9am pickup, RM170. See you then!", day: "2026-07-07", time: "08:15", delivery: "read", sourceDocId: "kd-02" },
    ],
  },
  {
    id: "cv-02",
    contactName: "Priya Nair",
    initials: "PN",
    channel: "instagram",
    channels: ["instagram"],
    tags: ["new"],
    dnd: false,
    totalOrdersMyr: 88,
    unread: true,
    needsReply: true,
    assignee: "owner",
    aiOn: false,
    messages: [
      { id: "m-05", from: "customer", text: "Is the pandan gula melaka cake halal certified?", day: "2026-07-07", time: "10:02" },
      { id: "m-06", from: "note", text: "Otto handed this conversation to you · no knowledge doc covers halal certification", day: "2026-07-07", time: "10:02" },
    ],
  },
  {
    id: "cv-03",
    contactName: "Hafiz Abdullah",
    initials: "HA",
    channel: "whatsapp",
    channels: ["whatsapp"],
    tags: ["wholesale"],
    dnd: false,
    totalOrdersMyr: 2180,
    unread: false,
    needsReply: false,
    assignee: "owner",
    aiOn: false,
    messages: [
      { id: "m-07", from: "customer", text: "Boss, next week same order, 60 boxes.", day: "2026-07-05", time: "14:20" },
      { id: "m-08", from: "owner", text: "Can do. Delivery Tuesday morning as usual.", day: "2026-07-05", time: "14:45", delivery: "read" },
    ],
  },
  {
    id: "cv-04",
    contactName: "Nurul Izzah",
    initials: "NI",
    channel: "whatsapp",
    channels: ["whatsapp"],
    tags: ["regular"],
    dnd: false,
    totalOrdersMyr: 320,
    unread: true,
    needsReply: false,
    assignee: "otto",
    ottoLive: true,
    aiOn: true,
    messages: [
      { id: "m-09", from: "customer", text: "Do you deliver to Petaling Jaya? Ordering the Raya cookie gift box for my in-laws.", day: "2026-07-07", time: "11:36" },
      { id: "m-10", from: "customer", text: "", media: nsPlaceholder("Customer photo", 480, 360, "crust"), day: "2026-07-07", time: "11:36" },
    ],
  },
  {
    id: "cv-05",
    contactName: "Jason Wong",
    initials: "JW",
    channel: "facebook",
    channels: ["facebook", "whatsapp"],
    tags: ["catering"],
    dnd: true,
    totalOrdersMyr: 1450,
    unread: false,
    needsReply: true,
    assignee: "none",
    aiOn: false,
    messages: [
      { id: "m-11", from: "customer", text: "Hi, quoting for a 40 pax office event on 18 July. Can you do a pastry platter?", day: "2026-07-06", time: "16:40" },
    ],
  },
  {
    id: "cv-06",
    contactName: "Siti Aminah",
    initials: "SA",
    channel: "instagram",
    channels: ["instagram"],
    tags: [],
    dnd: false,
    totalOrdersMyr: 0,
    unread: false,
    needsReply: false,
    assignee: "otto",
    aiOn: true,
    messages: [
      { id: "m-12", from: "customer", text: "What time do you close today?", day: "2026-07-06", time: "17:05" },
      { id: "m-13", from: "otto", text: "We're open until 6pm today. We're at 12 Jalan Bangsar Utama 3, nearest LRT Bank Rakyat-Bangsar.", day: "2026-07-06", time: "17:05", delivery: "read", sourceDocId: "kd-04" },
    ],
  },
];

/** 对话视图的演示脚本:「来一条新消息」→ Otto 读库 → 回复(带溯源) */
export const IB_DEMO_INCOMING = {
  customer: "One more thing, can I add 5 Milo dinosaur cookies to the Friday order?",
  ottoReply: `Of course. 5 Milo dinosaur cookies at RM${p("prod-03").priceMyr} each adds RM30, so the Friday pickup total is RM200. All set!`,
  sourceDocId: "kd-01",
  narration: ["Reading the knowledge base…", "Checking menu and pricing…", "Writing a reply…"],
} as const;

/* ── 公开评论收件箱 ─────────────────────────────────────────────────────── */
export interface IbComment {
  id: string;
  postId: string;
  author: string;
  initials: string;
  text: string;
  day: string;
  time: string;
  reply?: { text: string; day: string; time: string };
}

export interface IbCommentPost {
  id: string;
  platform: IbChannel;
  caption: string;
  media: string;
  postedDay: string;
}

const post05 = NS_SCHEDULED_POSTS.find((x) => x.id === "post-05")!;
const post06 = NS_SCHEDULED_POSTS.find((x) => x.id === "post-06")!;

export const IB_COMMENT_POSTS: IbCommentPost[] = [
  { id: post06.id, platform: "facebook", caption: post06.caption, media: post06.media, postedDay: "2026-07-05" },
  { id: post05.id, platform: "instagram", caption: post05.caption, media: post05.media, postedDay: "2026-07-06" },
];

export const IB_COMMENTS: IbComment[] = [
  { id: "cm-01", postId: post06.id, author: "Farah Musa", initials: "FM", text: "Bring back the onde-onde cream puffs please!", day: "2026-07-06", time: "09:14" },
  {
    id: "cm-02", postId: post06.id, author: "Kevin Lim", initials: "KL", text: "Milo dinosaur cookie, always. My kids finish a box in one sitting.", day: "2026-07-06", time: "10:31",
    reply: { text: "Noted! Baking a double batch this week just for you.", day: "2026-07-06", time: "11:02" },
  },
  { id: "cm-03", postId: post06.id, author: "Devi Krishnan", initials: "DK", text: "Do you take orders for this Saturday? Need a birthday cake.", day: "2026-07-07", time: "08:47" },
  {
    id: "cm-04", postId: post05.id, author: "Amirul Hakim", initials: "AH", text: "Congrats! The pandan cake deserves the sellout, best in Bangsar.", day: "2026-07-06", time: "13:20",
    reply: { text: "Terima kasih Amirul! Fresh batch tomorrow morning.", day: "2026-07-06", time: "14:05" },
  },
  { id: "cm-05", postId: post05.id, author: "Grace Foo", initials: "GF", text: "What time do you open tomorrow? Want to grab croissants before work.", day: "2026-07-07", time: "07:58" },
];

/* ── 试驾场(对客 AI 上线前的硬前置测试) ────────────────────────────────── */
export interface IbScenario {
  id: string;
  chip: string;
  /** 该场景验证的护栏 */
  check: string;
  customer: string;
  otto: string;
  sourceDocId?: string;
  guardrail?: "handoff" | "money";
  narration: readonly string[];
}

export const IB_SCENARIOS: IbScenario[] = [
  {
    id: "ts-01",
    chip: "Ask a menu question",
    check: "Answers come from your knowledge base",
    customer: "How much is the pandan gula melaka cake?",
    otto: `The pandan gula melaka cake is RM${p("prod-01").priceMyr} for the whole cake. Whole cakes need 2 days notice. Want me to note an order for you?`,
    sourceDocId: "kd-01",
    narration: ["Reading the knowledge base…", "Checking menu and pricing…"],
  },
  {
    id: "ts-02",
    chip: "Ask for a refund",
    check: "Money stays with you, always",
    customer: "I want a refund for my order from yesterday.",
    otto: "I can't process refunds myself, that's a decision for the owner. I've flagged this conversation for Aisyah and she'll get back to you today.",
    sourceDocId: "kd-05",
    guardrail: "money",
    narration: ["Reading the knowledge base…", "Checking the refund rules…"],
  },
  {
    id: "ts-03",
    chip: "Ask something it can't know",
    check: "Hands off to a person when unsure",
    customer: "Can you make a 3-tier wedding cake for 200 guests in August?",
    otto: "That's outside what I know, so I've handed this conversation to the owner. You'll hear back from a real person soon.",
    guardrail: "handoff",
    narration: ["Reading the knowledge base…", "No doc covers this…"],
  },
  {
    id: "ts-04",
    chip: "Ask in Bahasa Melayu",
    check: "Replies in the customer's language",
    customer: "Ada penghantaran ke Subang Jaya tak?",
    otto: "Ya, kami hantar ke Subang Jaya. Bayaran penghantaran RM15, dan percuma untuk pesanan melebihi RM150.",
    sourceDocId: "kd-03",
    narration: ["Reading the knowledge base…", "Checking delivery areas…"],
  },
];

export function ibDoc(id: string): IbKnowledgeDoc | undefined {
  return IB_KNOWLEDGE_DOCS.find((d) => d.id === id);
}
