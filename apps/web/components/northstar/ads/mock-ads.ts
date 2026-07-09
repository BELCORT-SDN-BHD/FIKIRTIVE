/**
 * 北极星原型 — 广告区示例数据(基于共享 _mock 的场景:Roti Bulan Bakery,KL)
 *
 * 共享 mock 模块(components/northstar/_mock.ts)没有 per-ad / 平台 adapter 数据,
 * 本文件是广告区的补充口径:同一家店、同一批产品、确定性数值、缩略图走 NS_IMAGES 真图。
 * 图片纪律(ENDGAME §一):全城只从 NS_IMAGES 取图 —— 每条 ad 缩略图对到它所描绘的真实产品/主视觉。
 * 规矩不变:诊断不捏造 — 每条诊断证据均可指回下方数字;引用带来源(O-10 判决)。
 */

import { nsImage } from "@/components/northstar/_mock";

/* ── 账户口径(赢家 / 输家用账户自身均值切,PAGE-INVENTORY 广告表现页行) ── */

export const NS_AD_ACCOUNT = {
  id: "act_29401877",
  name: "Roti Bulan Bakery",
  /** 币种前缀来自数据(§D2 不写死货币符号) */
  currencyPrefix: "RM",
  period: "2026-06-09 to 2026-07-06",
  avgCtr: 1.8,
  avgCpcMyr: 0.62,
  kpis: {
    spendMyr: 1284.6,
    impressions: 96400,
    clicks: 2210,
    results: 214,
  },
} as const;

/* ── 逐条 ad ── */

export interface NsAdCitation {
  /** 引用内容(结论或数字) */
  label: string;
  /**
   * 真实 KB 条目 id(→ NS_META_KB)。挂了它 = 可点开验证的第一方 Meta 官方来源(O-10 不捏造)。
   * 与 `source` 二选一:KB 条目走这条,live 数字走 `source`。
   */
  knowledgeId?: string;
  /** live 数据出处(数字从 Meta 读回,不是 KB 文档)—— 渲染成不可点的 provenance pill */
  source?: string;
}

export interface NsAdDiagnosis {
  /** Otto 的一句话人话判读 */
  summary: string;
  /** 数据证据(全部可指回本条 ad 的数字) */
  evidence: string[];
  /** KB 引用(不捏造 — 有出处才说) */
  citations: NsAdCitation[];
  /** 诊断 → 创作链动作文案(O-10) */
  action: string;
}

export interface NsAd {
  id: string;
  name: string;
  format: "video" | "image" | "carousel";
  thumb: string;
  daysRunning: number;
  spendMyr: number;
  impressions: number;
  clicks: number;
  /** % */
  ctr: number;
  cpcMyr: number;
  results: number;
  resultLabel: string;
  diagnosis: NsAdDiagnosis;
}

export const NS_ADS: NsAd[] = [
  {
    id: "ad-01",
    name: "Merdeka gift box · unboxing 15s",
    format: "video",
    thumb: nsImage("campaign", 0),
    daysRunning: 14,
    spendMyr: 310.4,
    impressions: 28200,
    clicks: 958,
    ctr: 3.4,
    cpcMyr: 0.32,
    results: 86,
    resultLabel: "purchases",
    diagnosis: {
      summary:
        "Your strongest ad this period. The box opens in the first two seconds and people stay for the reveal.",
      evidence: [
        "CTR 3.4% vs account average 1.8%",
        "CPC RM 0.32 vs account average RM 0.62",
        "86 purchases over 14 days",
      ],
      citations: [
        { label: "The hook lands in the first seconds", knowledgeId: "creative-reels-hook-first-seconds" },
        { label: "CTR and CPC read from this period", source: "Meta insights · read-only" },
      ],
      action: "Make 3 more hooks in this style",
    },
  },
  {
    id: "ad-02",
    name: "Kaya croissant morning reel",
    format: "video",
    thumb: nsImage("bakery", 1),
    daysRunning: 10,
    spendMyr: 186.2,
    impressions: 19800,
    clicks: 515,
    ctr: 2.6,
    cpcMyr: 0.36,
    results: 41,
    resultLabel: "purchases",
    diagnosis: {
      summary: "The steam shot is doing the work. Morning slots carry most of the clicks.",
      evidence: ["CTR 2.6% vs account average 1.8%", "41 purchases at RM 0.36 per click"],
      citations: [{ label: "Clicks by hour, this period", source: "Meta insights · read-only" }],
      action: "Make a lunch-slot variant",
    },
  },
  {
    id: "ad-03",
    name: "Office order teaser · carousel",
    format: "carousel",
    thumb: nsImage("bakery", 12),
    daysRunning: 8,
    spendMyr: 142.8,
    impressions: 14600,
    clicks: 321,
    ctr: 2.2,
    cpcMyr: 0.44,
    results: 38,
    resultLabel: "messages",
    diagnosis: {
      summary: "Card 2 gets the most swipes. The bulk-order angle lands with office crowds.",
      evidence: ["CTR 2.2% vs account average 1.8%", "38 order messages started"],
      citations: [
        { label: "Per-card engagement, this period", source: "Meta insights · read-only" },
        { label: "Break performance down by card and placement", knowledgeId: "diagnosis-breakdowns-analysis" },
      ],
      action: "Lead with card 2 in a new version",
    },
  },
  {
    id: "ad-04",
    name: "Pandan cake close-up",
    format: "image",
    thumb: nsImage("bakery", 5),
    daysRunning: 12,
    spendMyr: 168.0,
    impressions: 15200,
    clicks: 290,
    ctr: 1.9,
    cpcMyr: 0.58,
    results: 22,
    resultLabel: "purchases",
    diagnosis: {
      summary: "Just above your average and steady. Nothing to fix, worth a fresh angle to keep it fresh.",
      evidence: ["CTR 1.9% vs account average 1.8%", "Steady clicks across 12 days"],
      citations: [
        { label: "Refresh creative before fatigue sets in", knowledgeId: "diagnosis-creative-fatigue-frequency" },
      ],
      action: "Make a seasonal variant",
    },
  },
  {
    id: "ad-05",
    name: "Croissant fold timelapse 30s",
    format: "video",
    thumb: nsImage("bakery", 8),
    daysRunning: 9,
    spendMyr: 156.4,
    impressions: 9800,
    clicks: 108,
    ctr: 1.1,
    cpcMyr: 1.45,
    results: 6,
    resultLabel: "purchases",
    diagnosis: {
      summary: "Beautiful but slow. The first 5 seconds show dough, not the croissant, and most viewers leave there.",
      evidence: [
        "CTR 1.1% vs account average 1.8%",
        "CPC RM 1.45 vs account average RM 0.62",
        "Most drop-off in the first 5 seconds",
      ],
      citations: [
        { label: "Front-load the payoff in the first seconds", knowledgeId: "creative-reels-hook-first-seconds" },
        { label: "Video drop-off curve, this period", source: "Meta insights · read-only" },
      ],
      action: "Recut with the payoff first",
    },
  },
  {
    id: "ad-06",
    name: "Raya cookie box · static",
    format: "image",
    thumb: nsImage("bakery", 20),
    daysRunning: 16,
    spendMyr: 148.6,
    impressions: 11400,
    clicks: 103,
    ctr: 0.9,
    cpcMyr: 1.44,
    results: 8,
    resultLabel: "purchases",
    diagnosis: {
      summary: "This one has gone stale. It ran 16 days and clicks fell by half in week 2.",
      evidence: ["CTR 0.9% vs account average 1.8%", "Week 2 clicks down 52% vs week 1", "16 days running"],
      citations: [
        { label: "CTR falling as frequency rises = creative fatigue", knowledgeId: "diagnosis-creative-fatigue-frequency" },
      ],
      action: "Make a fresh version of this offer",
    },
  },
  {
    id: "ad-07",
    name: "Kopi tiramisu menu card",
    format: "image",
    thumb: nsImage("bakery", 10),
    daysRunning: 7,
    spendMyr: 96.2,
    impressions: 8600,
    clicks: 60,
    ctr: 0.7,
    cpcMyr: 1.6,
    results: 3,
    resultLabel: "purchases",
    diagnosis: {
      summary: "Too much text on the image. It reads like a menu, not a treat, and people scroll past.",
      evidence: ["CTR 0.7% vs account average 1.8%", "Lowest thumb-stop rate in the account this period"],
      citations: [
        { label: "Cluttered creative can lower quality ranking and raise cost", knowledgeId: "diagnosis-quality-ranking-impact" },
        { label: "Thumb-stop rate, this period", source: "Meta insights · read-only" },
      ],
      action: "Rebuild around a product close-up",
    },
  },
  {
    id: "ad-08",
    name: "Weekend promo · storyboard cut",
    format: "video",
    thumb: nsImage("campaign", 4),
    daysRunning: 5,
    spendMyr: 76.0,
    impressions: 7800,
    clicks: 39,
    ctr: 0.5,
    cpcMyr: 1.95,
    results: 2,
    resultLabel: "purchases",
    diagnosis: {
      summary: "The audience is off. It reaches mostly outside KL, far from pickup range.",
      evidence: [
        "CTR 0.5% vs account average 1.8%",
        "71% of reach outside Kuala Lumpur",
        "2 purchases from 7,800 impressions",
      ],
      citations: [
        { label: "Reach by region, this period", source: "Meta insights · read-only" },
        { label: "Location is a hard targeting constraint you can pin", knowledgeId: "targeting-advantage-plus-constraints" },
      ],
      action: "Retarget to KL and remake the opener",
    },
  },
];

/* ── 构建工作台草稿(campaign / adset / ad 三层,G7 v2:build=$0,PAUSED) ── */

export interface NsDraftAd {
  id: string;
  name: string;
  assetId: string; // 指向共享 NS_ASSETS
  primaryText: string;
  headline: string;
  cta: string;
}

export interface NsDraftAdset {
  id: string;
  name: string;
  location: string;
  ageRange: string;
  placement: string;
  ads: NsDraftAd[];
}

export interface NsDraftCampaign {
  name: string;
  objective: string;
  dailyBudgetMyr: number;
  startDate: string;
  status: "PAUSED";
  adsets: NsDraftAdset[];
}

export const NS_AD_DRAFT: NsDraftCampaign = {
  name: "Merdeka gift box pre-orders",
  objective: "sales",
  dailyBudgetMyr: 80,
  startDate: "2026-08-24",
  status: "PAUSED",
  adsets: [
    {
      id: "as-draft-01",
      name: "KL food lovers 25-45",
      location: "Kuala Lumpur + 25 km",
      ageRange: "25-45",
      placement: "advantage",
      ads: [
        {
          id: "ad-draft-01",
          name: "Unboxing hook A",
          assetId: "as-02",
          primaryText:
            "The gift box that sells out every Merdeka. 6 bakes, 1 box, pre-orders close 20 Aug.",
          headline: "Merdeka gift box · RM 68",
          cta: "order_now",
        },
        {
          id: "ad-draft-02",
          name: "Hero shot B",
          assetId: "as-01",
          primaryText: "Pandan, gula melaka and kaya in one box. Made in KL, gone by Merdeka.",
          headline: "Pre-order the Merdeka box",
          cta: "shop_now",
        },
      ],
    },
  ],
};

export const NS_AD_OBJECTIVES = [
  { value: "sales", label: "Sales" },
  { value: "traffic", label: "Traffic" },
  { value: "awareness", label: "Awareness" },
  { value: "engagement", label: "Engagement" },
  { value: "leads", label: "Leads" },
] as const;

export const NS_AD_PLACEMENTS = [
  { value: "advantage", label: "Advantage+ placements" },
  { value: "feeds", label: "Manual · Feeds only" },
  { value: "reels", label: "Manual · Reels + Stories" },
] as const;

export const NS_AD_CTAS = [
  { value: "order_now", label: "Order now" },
  { value: "shop_now", label: "Shop now" },
  { value: "learn_more", label: "Learn more" },
  { value: "message_page", label: "Message page" },
] as const;

/* ── 多平台投放扩展(红旗一:全要 + 可插拔;顺序 TikTok → Lazada → Shopee) ── */

export interface NsAdPlatformParam {
  key: string;
  /** 未连接平台 = undefined,渲染为 "—"(§D2 honest gaps) */
  value?: string;
}

export interface NsAdPlatform {
  id: string;
  label: string;
  status: "connected" | "next" | "planned";
  statusLabel: string;
  note: string;
  /** 平台专属参数位(同页型复用,加平台 = 加 adapter) */
  params: NsAdPlatformParam[];
}

export const NS_AD_PLATFORMS: NsAdPlatform[] = [
  {
    id: "meta",
    label: "Meta",
    status: "connected",
    statusLabel: "Connected",
    note: "Facebook + Instagram ads run from the same workbench today.",
    params: [
      { key: "Ad account", value: "act_29401877" },
      { key: "Page", value: "Roti Bulan Bakery" },
      { key: "Pixel", value: "RB pixel · active" },
    ],
  },
  {
    id: "tiktok",
    label: "TikTok Ads",
    status: "next",
    statusLabel: "Next up",
    note: "Same workbench, one new adapter. Connect once TikTok approves the app.",
    params: [{ key: "Advertiser ID" }, { key: "Identity" }, { key: "Pixel" }],
  },
  {
    id: "lazada",
    label: "Lazada Sponsored",
    status: "planned",
    statusLabel: "Planned",
    note: "Sponsored products for your Lazada store, planned after TikTok.",
    params: [{ key: "Store ID" }, { key: "Product feed" }],
  },
  {
    id: "shopee",
    label: "Shopee Ads",
    status: "planned",
    statusLabel: "Planned",
    note: "Search and discovery ads for your Shopee shop, planned after Lazada.",
    params: [{ key: "Shop ID" }, { key: "Product feed" }, { key: "Campaign type" }],
  },
];
