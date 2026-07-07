/**
 * 北极星原型 — 全城共用示例数据(唯一 mock 模块)
 *
 * 场景:马来西亚 SMB — 吉隆坡家庭烘焙坊「Roti Bulan Bakery」。
 * 规矩(PROGRAM.md §1.1):示例数据要像真的 — 马来西亚商家、MYR、真实尺寸占位图;
 * 全部确定性(固定种子,零 Date.now / 零模块顶层 Math.random);零后台 import。
 *
 * 占位图:内联 SVG data URI(nsPlaceholder)— 不用任何外链图片。
 * SVG 字符串内的 hex 是图片内容(比照 mascot art 豁免),不是 UI token;
 * UI 层永远用 .gb token,不得把这些值当颜色用。
 */

// ── deterministic PRNG(mulberry32,固定种子) ─────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 占位图(inline SVG,零外链) ─────────────────────────────────────────────
const PLACEHOLDER_TONES = {
  /** 烘焙暖调 */
  crust: ["#E8D5B7", "#B98A5A"],
  /** 抹茶 */
  pandan: ["#DDE8CE", "#7F9C6B"],
  /** 咖啡 */
  kopi: ["#D9C3B0", "#6F4E37"],
  /** 中性(界面示意) */
  neutral: ["#EFEFED", "#B6B6B0"],
  /** 视频深色 */
  video: ["#3A3A3E", "#1C1C1F"],
} as const;

export type NsPlaceholderTone = keyof typeof PLACEHOLDER_TONES;

/** 真实尺寸的内联 SVG 占位图(data URI)。label 显示在图中央。 */
export function nsPlaceholder(
  label: string,
  w: number,
  h: number,
  tone: NsPlaceholderTone = "neutral",
): string {
  const [bg, fg] = PLACEHOLDER_TONES[tone];
  const fontSize = Math.max(11, Math.min(18, Math.round(Math.min(w, h) / 10)));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${fg}" stroke-opacity="0.35"/>` +
    `<circle cx="${w / 2}" cy="${h / 2 - fontSize}" r="${fontSize * 0.9}" fill="${fg}" fill-opacity="0.3"/>` +
    `<text x="${w / 2}" y="${h / 2 + fontSize}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="${fontSize}" fill="${fg}">${label} · ${w}×${h}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── 品牌 ────────────────────────────────────────────────────────────────────
export const NS_BRAND = {
  name: "Roti Bulan Bakery",
  tagline: "Fresh bakes, KL heart",
  city: "Kuala Lumpur",
  owner: "Aisyah Rahman",
  email: "aisyah@rotibulan.my",
  languages: ["English", "Bahasa Melayu", "中文"],
  voice: "Warm, neighbourly, a little playful. Never salesy.",
  currency: "MYR",
  creditBalance: 1240,
} as const;

// ── 产品 ────────────────────────────────────────────────────────────────────
export interface NsProduct {
  id: string;
  name: string;
  category: string;
  priceMyr: number;
  description: string;
  image: string;
  bestSeller: boolean;
}

export const NS_PRODUCTS: NsProduct[] = [
  { id: "prod-01", name: "Pandan gula melaka cake", category: "Cakes", priceMyr: 88, description: "Signature pandan sponge layered with gula melaka cream.", image: nsPlaceholder("Pandan cake", 640, 640, "pandan"), bestSeller: true },
  { id: "prod-02", name: "Kaya butter croissant", category: "Pastries", priceMyr: 8.5, description: "Flaky croissant with house-made kaya and cold butter.", image: nsPlaceholder("Kaya croissant", 640, 640, "crust"), bestSeller: true },
  { id: "prod-03", name: "Milo dinosaur cookie", category: "Cookies", priceMyr: 6, description: "Chewy cookie loaded with Milo crunch.", image: nsPlaceholder("Milo cookie", 640, 640, "kopi"), bestSeller: false },
  { id: "prod-04", name: "Onde-onde cream puff", category: "Pastries", priceMyr: 7.5, description: "Choux puff with pandan cream and coconut flakes.", image: nsPlaceholder("Onde-onde puff", 640, 640, "pandan"), bestSeller: false },
  { id: "prod-05", name: "Kopi-O tiramisu cup", category: "Desserts", priceMyr: 14, description: "Local twist on tiramisu with kopitiam-brew espresso.", image: nsPlaceholder("Kopi tiramisu", 640, 640, "kopi"), bestSeller: true },
  { id: "prod-06", name: "Raya cookie gift box", category: "Seasonal", priceMyr: 68, description: "12-piece assorted festive box, ribbon included.", image: nsPlaceholder("Raya gift box", 640, 640, "crust"), bestSeller: false },
];

// ── Campaign 日历条目 ──────────────────────────────────────────────────────
export interface NsCampaignEntry {
  id: string;
  date: string; // ISO date
  platform: "instagram" | "facebook" | "tiktok" | "x";
  format: "image" | "video" | "carousel";
  hook: string;
  status: "proposed" | "approved" | "scheduled" | "published";
  estCredits: number;
}

export const NS_CAMPAIGN = {
  id: "camp-merdeka-01",
  name: "Merdeka week bakes",
  goal: "Drive pre-orders for the Merdeka gift box",
  period: "2026-08-24 to 2026-08-31",
  budgetCredits: 320,
  platforms: ["instagram", "facebook", "tiktok"],
  status: "proposed" as const,
};

export const NS_CAMPAIGN_ENTRIES: NsCampaignEntry[] = [
  { id: "ce-01", date: "2026-08-24", platform: "instagram", format: "video", hook: "The box that sells out every Merdeka", status: "approved", estCredits: 40 },
  { id: "ce-02", date: "2026-08-25", platform: "facebook", format: "image", hook: "Pandan and gula melaka, made for sharing", status: "approved", estCredits: 12 },
  { id: "ce-03", date: "2026-08-26", platform: "tiktok", format: "video", hook: "POV: your office order arrives at 3pm", status: "proposed", estCredits: 40 },
  { id: "ce-04", date: "2026-08-27", platform: "instagram", format: "carousel", hook: "6 bakes, 1 box, zero regrets", status: "proposed", estCredits: 24 },
  { id: "ce-05", date: "2026-08-28", platform: "facebook", format: "image", hook: "Last 3 days for pre-orders", status: "proposed", estCredits: 12 },
  { id: "ce-06", date: "2026-08-30", platform: "instagram", format: "video", hook: "Packing day at the bakery", status: "proposed", estCredits: 40 },
  { id: "ce-07", date: "2026-08-31", platform: "instagram", format: "image", hook: "Selamat Hari Merdeka from Roti Bulan", status: "proposed", estCredits: 12 },
];

// ── 排期帖子 ────────────────────────────────────────────────────────────────
export interface NsScheduledPost {
  id: string;
  scheduledAt: string; // ISO datetime, Asia/Kuala_Lumpur
  platform: "instagram" | "facebook" | "tiktok" | "x";
  caption: string;
  media: string;
  status: "draft" | "scheduled" | "published" | "failed";
  campaignId?: string;
  firstComment?: string;
}

export const NS_SCHEDULED_POSTS: NsScheduledPost[] = [
  { id: "post-01", scheduledAt: "2026-07-08T09:00:00+08:00", platform: "instagram", caption: "Fresh out of the oven: kaya butter croissants till 11am only.", media: nsPlaceholder("IG post", 1080, 1080, "crust"), status: "scheduled" },
  { id: "post-02", scheduledAt: "2026-07-08T12:30:00+08:00", platform: "facebook", caption: "Lunch treat idea: kopi-O tiramisu cups, RM14 each.", media: nsPlaceholder("FB post", 1200, 630, "kopi"), status: "scheduled" },
  { id: "post-03", scheduledAt: "2026-07-09T10:00:00+08:00", platform: "tiktok", caption: "How we fold 200 croissants before sunrise.", media: nsPlaceholder("TikTok video", 1080, 1920, "video"), status: "draft" },
  { id: "post-04", scheduledAt: "2026-07-10T09:00:00+08:00", platform: "instagram", caption: "Weekend pre-orders open now. Link in bio.", media: nsPlaceholder("IG post", 1080, 1080, "pandan"), status: "draft", firstComment: "Pre-order closes Friday 6pm!" },
  { id: "post-05", scheduledAt: "2026-07-06T09:00:00+08:00", platform: "instagram", caption: "Thank you KL, sold out by noon again.", media: nsPlaceholder("IG post", 1080, 1080, "crust"), status: "published" },
  { id: "post-06", scheduledAt: "2026-07-05T18:00:00+08:00", platform: "facebook", caption: "New week, new bakes. What should we bring back?", media: nsPlaceholder("FB post", 1200, 630, "neutral"), status: "published" },
];

// ── 联系人 ──────────────────────────────────────────────────────────────────
export interface NsContact {
  id: string;
  name: string;
  channels: ("whatsapp" | "instagram" | "facebook")[];
  lastSeen: string;
  tags: string[];
  doNotDisturb: boolean;
  totalOrdersMyr: number;
}

export const NS_CONTACTS: NsContact[] = [
  { id: "ct-01", name: "Mei Ling Tan", channels: ["whatsapp", "instagram"], lastSeen: "2026-07-06", tags: ["regular", "office orders"], doNotDisturb: false, totalOrdersMyr: 640 },
  { id: "ct-02", name: "Hafiz Abdullah", channels: ["whatsapp"], lastSeen: "2026-07-05", tags: ["wholesale"], doNotDisturb: false, totalOrdersMyr: 2180 },
  { id: "ct-03", name: "Priya Nair", channels: ["instagram"], lastSeen: "2026-07-07", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 88 },
  { id: "ct-04", name: "Jason Wong", channels: ["facebook", "whatsapp"], lastSeen: "2026-06-30", tags: ["catering"], doNotDisturb: true, totalOrdersMyr: 1450 },
  { id: "ct-05", name: "Nurul Izzah", channels: ["whatsapp"], lastSeen: "2026-07-04", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 320 },
];

// ── 对话 ────────────────────────────────────────────────────────────────────
export interface NsMessage {
  id: string;
  from: "customer" | "owner" | "otto";
  text: string;
  at: string;
}

export interface NsConversation {
  id: string;
  contactId: string;
  channel: "whatsapp" | "instagram" | "facebook";
  subject: string;
  unread: boolean;
  aiHandled: boolean;
  messages: NsMessage[];
}

export const NS_CONVERSATIONS: NsConversation[] = [
  {
    id: "cv-01", contactId: "ct-01", channel: "whatsapp", subject: "Office order for Friday", unread: true, aiHandled: true,
    messages: [
      { id: "m-01", from: "customer", text: "Hi, can I order 20 croissants for Friday 9am pickup?", at: "2026-07-07T08:12:00+08:00" },
      { id: "m-02", from: "otto", text: "Yes we can do 20 kaya butter croissants for Friday 9am. That comes to RM170. Shall I confirm the order?", at: "2026-07-07T08:12:40+08:00" },
      { id: "m-03", from: "customer", text: "Confirm please, thank you!", at: "2026-07-07T08:15:00+08:00" },
    ],
  },
  {
    id: "cv-02", contactId: "ct-03", channel: "instagram", subject: "Pandan cake availability", unread: true, aiHandled: false,
    messages: [
      { id: "m-04", from: "customer", text: "Is the pandan gula melaka cake halal certified?", at: "2026-07-07T10:02:00+08:00" },
    ],
  },
  {
    id: "cv-03", contactId: "ct-02", channel: "whatsapp", subject: "Wholesale restock", unread: false, aiHandled: false,
    messages: [
      { id: "m-05", from: "customer", text: "Boss, next week same order, 60 boxes.", at: "2026-07-05T14:20:00+08:00" },
      { id: "m-06", from: "owner", text: "Can do. Delivery Tuesday morning as usual.", at: "2026-07-05T14:45:00+08:00" },
    ],
  },
];

// ── 分析序列(28 天,固定种子确定性生成) ──────────────────────────────────
export interface NsSeriesPoint {
  date: string;
  value: number;
}

function genSeries(seed: number, days: number, base: number, swing: number, trend: number): NsSeriesPoint[] {
  const rand = mulberry32(seed);
  const out: NsSeriesPoint[] = [];
  // fixed anchor: 2026-06-09 + i days → ends 2026-07-06
  const anchor = Date.UTC(2026, 5, 9);
  for (let i = 0; i < days; i++) {
    const d = new Date(anchor + i * 86400000);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 1.25 : 1;
    const value = Math.round((base + i * trend + (rand() - 0.5) * swing) * weekend);
    out.push({ date: d.toISOString().slice(0, 10), value: Math.max(0, value) });
  }
  return out;
}

export const NS_ANALYTICS = {
  period: "2026-06-09 to 2026-07-06",
  reach: genSeries(1101, 28, 1850, 700, 22),
  engagement: genSeries(1102, 28, 240, 120, 3),
  adSpendMyr: genSeries(1103, 28, 45, 20, 0.4),
  kpis: [
    { label: "Reach", value: "68.4K", delta: { dir: "up" as const, text: "▲ 18%" } },
    { label: "Engagement", value: "7,920", delta: { dir: "up" as const, text: "▲ 6%" } },
    { label: "Link clicks", value: "1,240", delta: { dir: "down" as const, text: "▼ 4%" } },
    { label: "New followers", value: "486", delta: { dir: "flat" as const, text: "· flat" } },
  ],
  insight: "Reach climbed 18% this period. Your Sunday croissant reels drove most of it.",
};

// ── Credit 流水 ─────────────────────────────────────────────────────────────
export interface NsCreditRow {
  id: string;
  at: string;
  category: "Otto chat" | "Image" | "Video" | "Search" | "Top up";
  description: string;
  credits: number; // 负 = 消费,正 = 充值
}

export const NS_CREDIT_LEDGER: NsCreditRow[] = [
  { id: "cl-01", at: "2026-07-07T09:14:00+08:00", category: "Video", description: "Croissant fold reel · 6s 720p", credits: -40 },
  { id: "cl-02", at: "2026-07-07T09:02:00+08:00", category: "Image", description: "Merdeka box hero shot · 4 variants", credits: -12 },
  { id: "cl-03", at: "2026-07-06T16:40:00+08:00", category: "Otto chat", description: "Campaign planning session", credits: -6 },
  { id: "cl-04", at: "2026-07-06T11:20:00+08:00", category: "Search", description: "Merdeka trends research", credits: -4 },
  { id: "cl-05", at: "2026-07-05T10:00:00+08:00", category: "Top up", description: "Top up · RM120", credits: 1200 },
  { id: "cl-06", at: "2026-07-04T15:30:00+08:00", category: "Image", description: "Kopi tiramisu menu card", credits: -8 },
];

// ── 生成产物卡(Library / My Stuff / Canvas 共用) ──────────────────────────
export interface NsAsset {
  id: string;
  title: string;
  kind: "image" | "video" | "storyboard";
  createdAt: string;
  thumb: string;
  credits: number;
  byOtto: boolean;
  status: "ready" | "generating" | "failed";
}

export const NS_ASSETS: NsAsset[] = [
  { id: "as-01", title: "Merdeka box hero shot", kind: "image", createdAt: "2026-07-07", thumb: nsPlaceholder("Hero shot", 640, 640, "crust"), credits: 12, byOtto: true, status: "ready" },
  { id: "as-02", title: "Croissant fold reel", kind: "video", createdAt: "2026-07-07", thumb: nsPlaceholder("Reel 9:16", 360, 640, "video"), credits: 40, byOtto: true, status: "ready" },
  { id: "as-03", title: "Pandan cake close-up", kind: "image", createdAt: "2026-07-06", thumb: nsPlaceholder("Close-up", 640, 640, "pandan"), credits: 8, byOtto: false, status: "ready" },
  { id: "as-04", title: "Weekend promo storyboard", kind: "storyboard", createdAt: "2026-07-06", thumb: nsPlaceholder("Storyboard", 640, 360, "neutral"), credits: 0, byOtto: true, status: "ready" },
  { id: "as-05", title: "Kopi tiramisu menu card", kind: "image", createdAt: "2026-07-04", thumb: nsPlaceholder("Menu card", 640, 800, "kopi"), credits: 8, byOtto: false, status: "ready" },
  { id: "as-06", title: "Office order teaser", kind: "video", createdAt: "2026-07-08", thumb: nsPlaceholder("Generating", 360, 640, "video"), credits: 40, byOtto: true, status: "generating" },
];

// ── Otto 动作历史(dock 共用) ──────────────────────────────────────────────
export interface NsOttoAction {
  id: string;
  text: string;
  at: string; // 显示用相对时间
  href?: string;
}

export const NS_OTTO_ACTIONS: NsOttoAction[] = [
  { id: "oa-01", text: "Generated Merdeka box hero shot", at: "2m ago", href: "/northstar/assets/library" },
  { id: "oa-02", text: "Drafted 7 campaign posts for review", at: "18m ago", href: "/northstar/campaign/calendar" },
  { id: "oa-03", text: "Answered Mei Ling's order question", at: "1h ago", href: "/northstar/inbox/shared" },
  { id: "oa-04", text: "Pulled Merdeka trend research", at: "3h ago", href: "/northstar/campaign/trends" },
  { id: "oa-05", text: "Scheduled Tuesday croissant post", at: "yesterday", href: "/northstar/schedule/plan" },
];

// ── 常用叙述条步骤(演示用) ────────────────────────────────────────────────
export const NS_NARRATION_STEPS = [
  "Reading your brand memory…",
  "Drafting campaign posts…",
  "Estimating credits…",
  "Laying out the calendar…",
] as const;
