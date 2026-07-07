/**
 * 北极星原型 · 住户服务中心(account)— 区内示例数据(唯一真源:_mock.ts + 本文件)
 *
 * 场景延续 _mock.ts:吉隆坡「Roti Bulan Bakery」。全部确定性,零后台 import。
 *
 * 铁律①(V5 money law):Otto 燃料 = credits，界面永远显示 credits，永不显示 $。
 *   → creditsLabel / formatCredits 本地复刻自 lib/credit-format.ts（保持零 lib import,
 *     纯格式化函数,和产品实现同规则）。
 * 第二账道(宪法 5 / harmony-05):通道费(channel fee)是真法币 MYR 直传给平台,
 *   永不混入 credits。钱包页显示 MYR;fmtMyr 是这一条账道专用,和 credits 分行列示。
 *   MYR 是这条账道的数据本身(数据级豁免),不是 UI token。
 */

// ── credits 格式化(复刻 lib/credit-format.ts,保持自足) ─────────────────────
export function formatCredits(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function creditsLabel(n: number): string {
  return `${formatCredits(n)} ${n === 1 ? "credit" : "credits"}`;
}

// ── 通道费账道专用:MYR 格式化(仅钱包页,和 credits 永不混用) ──────────────
export function fmtMyr(n: number): string {
  return `RM ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 相对时间显示(确定性:锚定 "now" = 2026-07-07T18:00 +08:00) */
const NOW_MS = Date.UTC(2026, 6, 7, 10, 0); // 18:00 KL = 10:00 UTC
export function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((NOW_MS - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ISO datetime → "7 Jul, 9:14 am"(KL 展示串,确定性) */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })
    .toLowerCase();
  return `${date}, ${time}`;
}

/* ════════════════════════════════════════════════════════════════════════
 * Credits 与消费明细(credits/page.tsx)
 * 分类:Otto chat / Image / Video / Search / Top up(铁律① 只显示 credits)。
 * 单笔可展开:每类下挂真实单笔,展开看到时间 + 描述 + 该笔 credits。
 * ════════════════════════════════════════════════════════════════════════ */

export type CreditCategory = "Otto chat" | "Image" | "Video" | "Search" | "Top up";

export interface CreditLine {
  id: string;
  at: string; // ISO
  title: string;
  detail: string;
  credits: number; // 负 = 消费,正 = 充值
  surface?: { label: string; href: string }; // 追到产物的门
}

export interface CreditGroup {
  category: CreditCategory;
  /** 该类本期净额(消费为负);Top up 为正 */
  netCredits: number;
  lines: CreditLine[];
}

/** 本期 = 2026-07-01 → 07-07(和 header 的 period 一致) */
export const CREDIT_PERIOD = "1–7 Jul 2026";

export const CREDIT_GROUPS: CreditGroup[] = [
  {
    category: "Video",
    netCredits: -120,
    lines: [
      { id: "cv-01", at: "2026-07-07T09:14:00+08:00", title: "Croissant fold reel", detail: "6s · 720p · 9:16", credits: -40, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
      { id: "cv-02", at: "2026-07-06T08:30:00+08:00", title: "Packing day teaser", detail: "6s · 720p · 9:16", credits: -40, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
      { id: "cv-03", at: "2026-07-03T14:10:00+08:00", title: "Office order teaser", detail: "8s · 720p · 9:16", credits: -40, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
    ],
  },
  {
    category: "Image",
    netCredits: -52,
    lines: [
      { id: "ci-01", at: "2026-07-07T09:02:00+08:00", title: "Merdeka box hero shot", detail: "4 variants · 1:1", credits: -12, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
      { id: "ci-02", at: "2026-07-05T11:40:00+08:00", title: "Kaya croissant close-up", detail: "4 variants · 1:1", credits: -12, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
      { id: "ci-03", at: "2026-07-04T15:30:00+08:00", title: "Kopi tiramisu menu card", detail: "2 variants · 4:5", credits: -8, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
      { id: "ci-04", at: "2026-07-02T10:05:00+08:00", title: "Pandan cake hero", detail: "4 variants · 1:1", credits: -12, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
      { id: "ci-05", at: "2026-07-01T09:20:00+08:00", title: "Weekend promo banner", detail: "2 variants · 16:9", credits: -8, surface: { label: "Open in Library", href: "/northstar/assets/library" } },
    ],
  },
  {
    category: "Otto chat",
    netCredits: -14.6,
    lines: [
      { id: "co-01", at: "2026-07-06T16:40:00+08:00", title: "Campaign planning session", detail: "Merdeka week bakes", credits: -6.2, surface: { label: "Open chat", href: "/northstar/global/otto-chat" } },
      { id: "co-02", at: "2026-07-05T10:12:00+08:00", title: "Caption rewrites", detail: "3 posts reworded", credits: -3.4, surface: { label: "Open chat", href: "/northstar/global/otto-chat" } },
      { id: "co-03", at: "2026-07-02T13:55:00+08:00", title: "Order reply drafting", detail: "Answered 4 questions", credits: -5, surface: { label: "Open chat", href: "/northstar/global/otto-chat" } },
    ],
  },
  {
    category: "Search",
    netCredits: -8,
    lines: [
      { id: "cs-01", at: "2026-07-06T11:20:00+08:00", title: "Merdeka trends research", detail: "12 sources read", credits: -4, surface: { label: "Open in Campaign", href: "/northstar/campaign/trends" } },
      { id: "cs-02", at: "2026-07-03T09:45:00+08:00", title: "Competitor bakes scan", detail: "8 sources read", credits: -4, surface: { label: "Open in Campaign", href: "/northstar/campaign/trends" } },
    ],
  },
  {
    category: "Top up",
    netCredits: 1200,
    lines: [
      { id: "ct-01", at: "2026-07-05T10:00:00+08:00", title: "Baker pack", detail: "Paid · card ending 4242", credits: 1200, surface: { label: "View receipt", href: "/northstar/account/top-up" } },
    ],
  },
];

export const CREDIT_BALANCE = 1240;
/** 本期净消费(不含 top up),用于 header 摘要 */
export const CREDIT_SPENT_PERIOD = 194.6;

/* ════════════════════════════════════════════════════════════════════════
 * 充值 / 购买页(top-up/page.tsx)
 * money-in(宪法 7 豁免):显示当地法币 MYR 作为价格,买到的是 credits。
 * Otto 永不代办充值(O3:此页无 Otto avatar,dock only)。
 * ════════════════════════════════════════════════════════════════════════ */

export interface TopUpPack {
  id: string;
  name: string;
  credits: number;
  priceMyr: number;
  /** 赠送 credits(0 = 无) */
  bonusCredits: number;
  blurb: string;
  popular: boolean;
}

export const TOP_UP_PACKS: TopUpPack[] = [
  { id: "pack-starter", name: "Starter pack", credits: 300, priceMyr: 30, bonusCredits: 0, blurb: "A week of images and a few short videos.", popular: false },
  { id: "pack-baker", name: "Baker pack", credits: 1200, priceMyr: 108, bonusCredits: 120, blurb: "A full campaign with room to spare.", popular: true },
  { id: "pack-market", name: "Market pack", credits: 3000, priceMyr: 250, bonusCredits: 450, blurb: "Best value for busy months and ads.", popular: false },
];

/** 单笔生成大致耗用(充值页的「够用吗」说明,估算,永远 ~) */
export const CREDIT_GUIDE = [
  { label: "One image (4 variants)", est: "~12 credits" },
  { label: "One short video (6s)", est: "~40 credits" },
  { label: "A week of posts", est: "~150 credits" },
];

/** 滚存上限提示(G-03 以 costing 为准,原型示意) */
export const ROLLOVER_NOTE = "Credits roll over for 12 months. Top-ups never expire while your account is active.";

/** 订阅层占位(席位双档,未建) */
export interface PlanTier {
  id: string;
  name: string;
  seats: string;
  priceMyr: number;
  perks: string[];
  current: boolean;
}

export const PLAN_TIERS: PlanTier[] = [
  { id: "plan-solo", name: "Solo", seats: "1 seat", priceMyr: 0, perks: ["Pay as you go", "All makers", "Meta and X connections"], current: true },
  { id: "plan-team", name: "Team", seats: "Up to 5 seats", priceMyr: 149, perks: ["Everything in Solo", "Shared inbox", "Monthly credit allowance"], current: false },
];

/* ════════════════════════════════════════════════════════════════════════
 * Connections 渠道连接页(connections/page.tsx)
 * registry 驱动:每个渠道一张卡,零 per-channel 分叉。
 * Meta = live(连接 / 重连 / 自治开关 / kill-switch);X = 用户 OAuth,零 API key 感;
 * 未来平台 = 卡位(TikTok/Shopee/Lazada/WhatsApp)。
 * ════════════════════════════════════════════════════════════════════════ */

export type ConnStatus = "connected" | "needs_reconnect" | "disconnected" | "coming_soon";

export interface ChannelAccount {
  id: string;
  handle: string;
  kind: string; // "Instagram" / "Facebook Page" / …
}

export interface Channel {
  id: string;
  name: string;
  status: ConnStatus;
  /** 已连接的具体账号(可多个:Meta = IG + FB Page) */
  accounts: ChannelAccount[];
  /** 授权范围(用户可读,零技术泄漏) */
  grants: string[];
  connectedAt?: string; // ISO
  /** Otto 自治开关:开 = Otto 可自动回复/发帖;关 = 只草拟待批 */
  autonomy?: boolean;
  /** 该渠道是否支持 Otto 自治(未来平台无) */
  supportsAutonomy: boolean;
  note?: string; // coming_soon 说明
}

export const CHANNELS: Channel[] = [
  {
    id: "meta",
    name: "Meta",
    status: "connected",
    accounts: [
      { id: "ig", handle: "@rotibulan.kl", kind: "Instagram" },
      { id: "fb", handle: "Roti Bulan Bakery", kind: "Facebook Page" },
    ],
    grants: ["Read messages and comments", "Publish posts you approve", "Read reach and engagement"],
    connectedAt: "2026-05-14T09:00:00+08:00",
    autonomy: true,
    supportsAutonomy: true,
  },
  {
    id: "x",
    name: "X",
    status: "needs_reconnect",
    accounts: [{ id: "x1", handle: "@rotibulankl", kind: "X account" }],
    grants: ["Read replies", "Publish posts you approve"],
    connectedAt: "2026-06-02T11:30:00+08:00",
    autonomy: false,
    supportsAutonomy: true,
    note: "X asks you to sign in again every 90 days.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    status: "coming_soon",
    accounts: [],
    grants: [],
    supportsAutonomy: false,
    note: "Coming soon. We'll let you know the day it opens.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    status: "coming_soon",
    accounts: [],
    grants: [],
    supportsAutonomy: false,
    note: "Coming soon for order replies and broadcasts.",
  },
  {
    id: "shopee",
    name: "Shopee",
    status: "coming_soon",
    accounts: [],
    grants: [],
    supportsAutonomy: false,
    note: "Coming soon for storefront sync.",
  },
  {
    id: "lazada",
    name: "Lazada",
    status: "coming_soon",
    accounts: [],
    grants: [],
    supportsAutonomy: false,
    note: "Coming soon for storefront sync.",
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * 通道费钱包页(channel-wallet/page.tsx)— 第二账道
 * 通道费 = 真法币 MYR 直传平台(如 Meta/X 广告投放的平台代收费),永不混 credits。
 * 与 credits 分行列示;这里的 RM 是账道数据本身。
 * ════════════════════════════════════════════════════════════════════════ */

export const WALLET_BALANCE_MYR = 184.5;
export const WALLET_LOW_THRESHOLD_MYR = 50;

export interface WalletTxn {
  id: string;
  at: string; // ISO
  kind: "top_up" | "pass_through";
  /** pass_through 的去向平台;top_up 为 undefined */
  channel?: "Meta" | "X";
  title: string;
  detail: string;
  amountMyr: number; // 正 = 充值,负 = 直传支出
  /** pass_through 关联的投放/帖子 */
  ref?: { label: string; href: string };
}

export const WALLET_TXNS: WalletTxn[] = [
  { id: "wt-01", at: "2026-07-07T08:20:00+08:00", kind: "pass_through", channel: "Meta", title: "Boosted post · Merdeka box", detail: "Passed to Meta Ads", amountMyr: -35, ref: { label: "View post", href: "/northstar/schedule/plan" } },
  { id: "wt-02", at: "2026-07-06T19:00:00+08:00", kind: "pass_through", channel: "Meta", title: "Boosted reel · Croissant fold", detail: "Passed to Meta Ads", amountMyr: -20, ref: { label: "View post", href: "/northstar/schedule/plan" } },
  { id: "wt-03", at: "2026-07-05T10:05:00+08:00", kind: "top_up", title: "Wallet top up", detail: "Paid · card ending 4242", amountMyr: 200 },
  { id: "wt-04", at: "2026-07-02T14:30:00+08:00", kind: "pass_through", channel: "X", title: "Promoted post · Weekend bakes", detail: "Passed to X Ads", amountMyr: -18, ref: { label: "View post", href: "/northstar/schedule/plan" } },
  { id: "wt-05", at: "2026-06-28T09:00:00+08:00", kind: "top_up", title: "Wallet top up", detail: "Paid · FPX", amountMyr: 100 },
];

export const WALLET_TOPUP_AMOUNTS_MYR = [50, 100, 200, 500];

/* ════════════════════════════════════════════════════════════════════════
 * Account 设置页(settings/page.tsx)
 * 资料 + Otto 行为设置。
 * ════════════════════════════════════════════════════════════════════════ */

export interface OttoBehaviour {
  id: string;
  title: string;
  help: string;
  /** paid/destructive?(此处均安全切换,即时生效) */
  value: boolean;
}

export const OTTO_BEHAVIOURS: OttoBehaviour[] = [
  { id: "auto_reply", title: "Let Otto reply to customers", help: "Otto answers common order questions on its own. You still see every reply.", value: true },
  { id: "auto_draft", title: "Draft posts ahead of me", help: "Otto plans a week of posts and leaves them for your review. Nothing goes out without your approval.", value: true },
  { id: "notify_done", title: "Tell me when work finishes", help: "A quiet note when Otto finishes a video or a plan.", value: true },
  { id: "weekend_quiet", title: "Quiet on weekends", help: "Otto holds non-urgent work until Monday morning.", value: false },
];

export const PROFILE = {
  brandName: "Roti Bulan Bakery",
  ownerName: "Aisyah Rahman",
  email: "aisyah@rotibulan.my",
  phone: "+60 12 345 6789",
  city: "Kuala Lumpur",
  timezone: "Kuala Lumpur (GMT+8)",
  avatarTone: "crust" as const,
};
