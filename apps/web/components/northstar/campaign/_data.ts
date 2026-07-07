/**
 * 北极星原型 — Campaign 区专用示例数据(扩展层)
 *
 * 只做共享 mock(components/northstar/_mock.ts)覆盖不到的 Campaign 区形态:
 * 完全体列表页的多 campaign、TrendSnapshot 存档行、备选点子。
 * 与共享 mock 同规矩:全确定性、零后台 import、马来西亚商家场景、MYR/credits。
 * 若日后其他区也要用,应升格进共享 _mock.ts(报告里已注记)。
 */

import {
  NS_ASSETS,
  NS_CAMPAIGN,
  NS_CAMPAIGN_ENTRIES,
  NS_SCHEDULED_POSTS,
  nsPlaceholder,
  type NsCampaignEntry,
} from "../_mock";

export const CAMPAIGN_TOTAL_EST = NS_CAMPAIGN_ENTRIES.reduce((sum, e) => sum + e.estCredits, 0);

// ── 平台/形式显示口径(现有产品用文字标签,不用品牌图标) ────────────────────
export const PLATFORM_META: Record<NsCampaignEntry["platform"], { label: string; short: string }> = {
  instagram: { label: "Instagram", short: "IG" },
  facebook: { label: "Facebook", short: "FB" },
  tiktok: { label: "TikTok", short: "TT" },
  x: { label: "X", short: "X" },
};

export const FORMAT_META: Record<NsCampaignEntry["format"], { label: string }> = {
  image: { label: "Image" },
  video: { label: "Video" },
  carousel: { label: "Carousel" },
};

// ── 提案卡的 trend 依据(rationale 带来源引用,spec §2.2) ─────────────────────
export const PROPOSAL_RATIONALE = {
  text: "Merdeka gifting content peaks in the last week of August. Short bakery process videos and office order POVs are outperforming static menu shots on your platforms right now.",
  sourceIds: ["ts-01", "ts-02"],
  cadence: "About one post a day, with a rest day on Aug 29",
};

// ── 备选点子(没选进日历 → 想法清单,spec §一.3) ────────────────────────────
export interface BackupIdea {
  id: string;
  text: string;
}

export const BACKUP_IDEAS: BackupIdea[] = [
  { id: "idea-01", text: "Staff picks: everyone at the bakery names their favourite bake" },
  { id: "idea-02", text: "Merdeka morning queue timelapse from the shopfront" },
];

// ── TrendSnapshot 存档(spec §5.2:结论 + 来源引用 + 日期 + 关联 campaign) ────
export interface TrendSnapshot {
  id: string;
  capturedAt: string; // ISO date
  summary: string;
  detail: string;
  sources: { title: string; domain: string }[];
  campaignId?: string;
  campaignName?: string;
  via: "Deep research" | "Quick search";
}

export const TREND_SNAPSHOTS: TrendSnapshot[] = [
  {
    id: "ts-01",
    capturedAt: "2026-07-06",
    summary: "Merdeka gifting content peaks Aug 24-31; gift box unboxings outperform product shots",
    detail:
      "Across Malaysian food and gifting accounts, Merdeka-themed posts concentrate in the final week of August. Unboxing and packing-day formats drew 2 to 3 times the saves of static product photos last year. Recommended window for a pre-order push: Aug 24 to 31.",
    sources: [
      { title: "TikTok Creative Center · MY trending week 34", domain: "ads.tiktok.com" },
      { title: "Google Trends · \"merdeka gift\" Malaysia, 5-year view", domain: "trends.google.com" },
      { title: "Deep research report · Merdeka gifting 2026", domain: "fikirtive research" },
    ],
    campaignId: "camp-merdeka-01",
    campaignName: "Merdeka week bakes",
    via: "Deep research",
  },
  {
    id: "ts-02",
    capturedAt: "2026-07-06",
    summary: "Office order POV videos are the strongest food format on TikTok MY this month",
    detail:
      "POV-style clips of office deliveries and 3pm pickups are the top-performing food format for small F&B accounts in Malaysia this month. Median watch-through beats recipe content. Works best under 15 seconds with an on-screen price.",
    sources: [
      { title: "TikTok Creative Center · food category, MY", domain: "ads.tiktok.com" },
      { title: "Deep research report · SEA short-video food formats", domain: "fikirtive research" },
    ],
    campaignId: "camp-merdeka-01",
    campaignName: "Merdeka week bakes",
    via: "Deep research",
  },
  {
    id: "ts-03",
    capturedAt: "2026-06-28",
    summary: "Kopitiam nostalgia aesthetics keep rising in KL cafe content",
    detail:
      "Marble tables, enamel cups and hand-written menu boards continue to gain in KL cafe content. Accounts leaning into kopitiam styling see steadier follower growth than minimal-modern styling. Fits the Kopi-O tiramisu line.",
    sources: [
      { title: "Instagram hashtag velocity · #kopitiam #klcafe", domain: "instagram.com" },
      { title: "Quick search digest · 2026-06-28", domain: "fikirtive research" },
    ],
    via: "Quick search",
  },
  {
    id: "ts-04",
    capturedAt: "2026-06-14",
    summary: "Weekday lunch pre-order posts convert best published 9 to 10am",
    detail:
      "For KL office-area food businesses, pre-order call-to-action posts published between 9 and 10am on weekdays drive the most same-day orders. Weekend mornings favour lifestyle content over direct offers.",
    sources: [
      { title: "Meta insights export · Roti Bulan page, 90 days", domain: "facebook.com" },
      { title: "Quick search digest · 2026-06-14", domain: "fikirtive research" },
    ],
    campaignId: "camp-office-01",
    campaignName: "Weekday office orders",
    via: "Quick search",
  },
  {
    id: "ts-05",
    capturedAt: "2026-05-20",
    summary: "Raya cookie gifting searches start 6 weeks before Hari Raya",
    detail:
      "Search interest for festive cookie gifting builds around 6 weeks ahead of Hari Raya and collapses the week after. Early-bird pre-order framing captured most of the volume for bakery accounts in 2026.",
    sources: [
      { title: "Google Trends · \"kuih raya gift\" Malaysia", domain: "trends.google.com" },
      { title: "Deep research report · Raya gifting window", domain: "fikirtive research" },
    ],
    campaignId: "camp-raya-01",
    campaignName: "Raya cookie drop",
    via: "Deep research",
  },
];

// ── Campaign 完全体列表(红旗六 / P3-1 / GM-03) ──────────────────────────────
export type CampaignStatus = "DRAFT" | "ACTIVE" | "DONE" | "CANCELLED";

export interface CampaignOutputItem {
  id: string;
  title: string;
  meta: string;
  thumb?: string;
}

export interface CampaignFull {
  id: string;
  name: string;
  status: CampaignStatus;
  goal: string;
  goalProgress: { label: string; current: number; target: number };
  period: string;
  budgetCredits: number;
  spentCredits: number;
  platforms: NsCampaignEntry["platform"][];
  utmBase: string;
  outputs: {
    content: CampaignOutputItem[];
    posts: CampaignOutputItem[];
    ads: CampaignOutputItem[];
    conversations: CampaignOutputItem[];
  };
}

export const CAMPAIGNS: CampaignFull[] = [
  {
    id: NS_CAMPAIGN.id,
    name: NS_CAMPAIGN.name,
    status: "DRAFT",
    goal: NS_CAMPAIGN.goal,
    goalProgress: { label: "Gift box pre-orders", current: 12, target: 100 },
    period: "Aug 24 to Aug 31, 2026",
    budgetCredits: NS_CAMPAIGN.budgetCredits,
    spentCredits: 0,
    platforms: ["instagram", "facebook", "tiktok"],
    utmBase: "utm_source={platform}&utm_medium=social&utm_campaign=merdeka-week-bakes",
    outputs: {
      content: NS_ASSETS.slice(0, 3).map((a) => ({ id: a.id, title: a.title, meta: `${a.kind} · ${a.createdAt}`, thumb: a.thumb })),
      posts: NS_CAMPAIGN_ENTRIES.slice(0, 4).map((e) => ({ id: e.id, title: e.hook, meta: `${PLATFORM_META[e.platform].label} · ${e.date} · draft` })),
      ads: [],
      conversations: [],
    },
  },
  {
    id: "camp-office-01",
    name: "Weekday office orders",
    status: "ACTIVE",
    goal: "Grow repeat weekday office orders from nearby towers",
    goalProgress: { label: "Office orders this month", current: 46, target: 60 },
    period: "Jul 1 to Jul 31, 2026",
    budgetCredits: 220,
    spentCredits: 148,
    platforms: ["instagram", "facebook"],
    utmBase: "utm_source={platform}&utm_medium=social&utm_campaign=weekday-office-orders",
    outputs: {
      content: NS_ASSETS.slice(2, 5).map((a) => ({ id: `of-${a.id}`, title: a.title, meta: `${a.kind} · ${a.createdAt}`, thumb: a.thumb })),
      posts: NS_SCHEDULED_POSTS.slice(0, 3).map((p) => ({ id: `of-${p.id}`, title: p.caption, meta: `${PLATFORM_META[p.platform].label} · ${p.scheduledAt.slice(0, 10)} · ${p.status}` })),
      ads: [
        { id: "ad-01", title: "Office lunch box · reach ad", meta: "Meta · PAUSED draft · RM12/day cap" },
        { id: "ad-02", title: "3pm pickup teaser · traffic ad", meta: "Meta · ACTIVE · RM8/day" },
      ],
      conversations: [
        { id: "cv-01", title: "Mei Ling Tan · office order for Friday", meta: "WhatsApp · handled by Otto" },
        { id: "cv-03", title: "Hafiz Abdullah · wholesale restock", meta: "WhatsApp · handled by you" },
      ],
    },
  },
  {
    id: "camp-raya-01",
    name: "Raya cookie drop",
    status: "DONE",
    goal: "Sell out 300 Raya cookie gift boxes before Hari Raya",
    goalProgress: { label: "Gift boxes sold", current: 300, target: 300 },
    period: "Feb 24 to Mar 20, 2026",
    budgetCredits: 380,
    spentCredits: 362,
    platforms: ["instagram", "facebook"],
    utmBase: "utm_source={platform}&utm_medium=social&utm_campaign=raya-cookie-drop",
    outputs: {
      content: [
        { id: "raya-c1", title: "Raya box lid reveal", meta: "video · 2026-03-02", thumb: nsPlaceholder("Raya reveal", 360, 640, "crust") },
        { id: "raya-c2", title: "Cookie assortment flat lay", meta: "image · 2026-02-26", thumb: nsPlaceholder("Flat lay", 640, 640, "crust") },
      ],
      posts: [
        { id: "raya-p1", title: "Early bird pre-orders open", meta: "Instagram · 2026-02-24 · published" },
        { id: "raya-p2", title: "Last call: 20 boxes left", meta: "Facebook · 2026-03-18 · published" },
      ],
      ads: [{ id: "raya-a1", title: "Raya gifting · conversions", meta: "Meta · ENDED · RM540 total" }],
      conversations: [{ id: "raya-cv1", title: "Jason Wong · 40-box corporate order", meta: "WhatsApp · handled by you" }],
    },
  },
  {
    id: "camp-moon-01",
    name: "Mooncake pre-launch",
    status: "CANCELLED",
    goal: "Test demand for a snowskin mooncake line",
    goalProgress: { label: "Waitlist signups", current: 9, target: 80 },
    period: "Sep 1 to Sep 25, 2026",
    budgetCredits: 160,
    spentCredits: 18,
    platforms: ["instagram"],
    utmBase: "utm_source={platform}&utm_medium=social&utm_campaign=mooncake-prelaunch",
    outputs: {
      content: [{ id: "moon-c1", title: "Snowskin concept shot", meta: "image · 2026-06-20", thumb: nsPlaceholder("Snowskin", 640, 640, "pandan") }],
      posts: [],
      ads: [],
      conversations: [],
    },
  },
];

export function trendById(id: string): TrendSnapshot | undefined {
  return TREND_SNAPSHOTS.find((t) => t.id === id);
}
