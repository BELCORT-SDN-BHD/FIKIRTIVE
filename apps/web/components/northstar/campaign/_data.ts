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

/* ═══════════════════════════════════════════════════════════════════════════
 * [wave-c · Z4 content-engineering] 提案 = 策略级 —— GOOSEWORKS-MAP §一 工具4 + 金标准
 *   docs/northstar/REFERENCE-PROPOSAL-MERDEKA.md
 *
 * 把「7 条氛围标题」抬成「战役弧线」:每条 entry 带 受众 × 角度 × 明价/CTA × KPI(带判决
 * 门槛)× 建议时段 × 产能约束 × role;提案头带 战略目标 + 预期产出(上期系数派生模型,非拍脑袋)
 * + 产能闸门 + 受众表 + 「别做这个」护栏 + learnings 逐条落点。workbench 目标真的换产出:
 * 新客(pre-order launch)/ 复购(repeat/office)/ 唤回(win-back)三模板差异化。
 *
 * 判断层五条(质检「站得住」硬标准,GOOSEWORKS-MAP §五):① 每个 KPI 带判决门槛;② 结论带
 * 来源/样本;③ 代理指标(生成 credits ≈ 订单)标注为假设 + 验证法;④ stop/scale/pause 门槛;
 * ⑤ 预测有估算模型。冷启动诚实:没有真数据的系数一律标「行业默认 / 上期 Raya 观测」。
 * 铁律不变:纯 client、零后台 import;credits 永远是 credits;coral 只属于 Otto。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 漏斗角色(让 7 条帖成一条弧线,不是模板填空)。 */
export type CampaignRole = "Launch" | "Discovery" | "Proof" | "Value" | "Urgency" | "Close";

/** 一条 entry 的策略层(与 NsCampaignEntry 按 id 对齐;hook 仍读 store,这里是「机制」)。 */
export interface CampaignEntryStrategy {
  role: CampaignRole;
  /** 受众:对谁说 */
  segment: string;
  /** 角度 + Ad Power 档(ad-angle-miner:Scarcity/Outcome/Contrast…) */
  angle: string;
  /** 明价 / 报价(RM…;至少让「多少钱」看得见) */
  offer: string;
  /** 下单动作(卖预售的战役必须有下单路径) */
  cta: string;
  /** 主 KPI + 判决门槛(判断层标准①:什么算过、不过怎么办) */
  kpi: string;
  /** 建议时段(让 09:00 有看得见的理由) */
  suggestedTime: string;
  /** 产能约束(涉及 stop/pause 门槛的帖挂它) */
  capacityNote?: string;
  /** 兑现的上期 learning(反哺循环逐条落点) */
  learningRef?: string;
}

/** 预期产出估算模型(判断层标准⑤:不许拍脑袋数字)。 */
export interface CampaignExpectedOutput {
  targetOrders: number;
  revenue: string;
  cpaTarget: string;
  /** 系数来自哪(上期真实数据) */
  basis: string;
  /** 前提 + 验证法(判断层标准③:代理指标标注为假设) */
  condition: string;
  confidence: "high" | "medium" | "low";
}

/** 受众行(jobs-to-be-done;金标准 §Priority audiences)。 */
export interface CampaignAudience {
  segment: string;
  jtbd: string;
  route: string;
}

/** 提案头的策略层(按模板 key)。 */
export interface CampaignProposalStrategy {
  /** 一句战略洞察(金标准「Raya 的教训不是制造稀缺,是配额与履约」那种) */
  insight: string;
  /** 战略目标(可核的成功条件,含第二条运营条件) */
  objective: string;
  expectedOutput: CampaignExpectedOutput;
  /** 产能闸门(stop/pause 门槛;卖实物的战役的命门) */
  guardrails: string[];
  audiences: CampaignAudience[];
  /** 「别做这个」范围护栏(campaign-brief-generator 的 What We're NOT Doing) */
  notDoing: string[];
  /** 上期 learnings 逐条落点(反哺循环兑现) */
  learningsApplied: { learning: string; landsOn: string }[];
}

export type CampaignTemplateKey = "new-customer" | "repeat" | "win-back";

export interface CampaignTemplate {
  key: CampaignTemplateKey;
  /** 人话模板名(workbench ready 卡 / 提案头显示) */
  label: string;
  /** store 换入的 entries(new-customer 复用 Merdeka ce-* id,默认无 workbench 也有策略) */
  entries: NsCampaignEntry[];
  strategy: CampaignProposalStrategy;
}

/* ── 模板 A:新客获取(pre-order launch;默认,复用 Merdeka ce-* id)——金标准对照 ── */
const NEW_CUSTOMER_STRATEGY: Record<string, CampaignEntryStrategy> = {
  "ce-01": {
    role: "Launch",
    segment: "Warm Raya buyers + food-discovery scrollers",
    angle: "Sensory · Outcome (high power)",
    offer: "RM68 · 12 pieces, ribboned. First 40 boxes.",
    cta: "Reserve the box — DM or bio link.",
    kpi: "3-sec view ≥35% · saves ≥2× the static value post. Below that, recut the first two seconds before adding spend.",
    suggestedTime: "Sat 9am",
    learningRef: "Raya: unboxing reels beat flat lays 3:1 on saves — lead with the lid reveal.",
  },
  "ce-02": {
    role: "Close",
    segment: "Office admins, founders, team leads (B2B)",
    angle: "Coordination · Identity — one message, known cost",
    offer: "10 boxes RM680 · or the RM310 Office Tea Drop (20 croissants + 10 tiramisu).",
    cta: "WhatsApp us — prefilled with date, headcount, postcode.",
    kpi: "10 qualified corporate enquiries · ≥25% enquiry→confirmed order · B2B AOV ≥RM310.",
    suggestedTime: "Mon 10am",
    learningRef: "Raya: Facebook drove the corporate bulk orders — keep a B2B post in the mix.",
  },
  "ce-03": {
    role: "Discovery",
    segment: "Younger KL food-discovery audience",
    angle: "Scene · POV (high) — process over polish",
    offer: "RM68 · price on screen by second 2.",
    cta: "Choose your collection or delivery slot.",
    kpi: "25% video completion · cost per qualified WhatsApp start ≤RM6.",
    suggestedTime: "Tue 9am",
    learningRef: "Trend ts-02: office POV works best under 15s with an on-screen price.",
  },
  "ce-04": {
    role: "Value",
    segment: "KL family hosts and gift-givers",
    angle: "Value clarity · Contrast (high)",
    offer: "RM68 single · RM136 pair crosses the RM120 free-delivery line.",
    cta: "Order the box — bio link.",
    kpi: "Save rate ≥4% · product/WhatsApp click ≥1.5%. Lift AOV to RM85+ without a discount.",
    suggestedTime: "Thu 9am",
  },
  "ce-05": {
    role: "Urgency",
    segment: "Warm, undecided buyers",
    angle: "Scarcity · Fear (medium) — truthful count only",
    offer: "RM68 · cut-off Aug 30 · shows a real count (“85 of 100 reserved”).",
    cta: "Reserve before cut-off — DM.",
    kpi: "≥15 confirmed boxes in 48h without crossing the 85-box gate.",
    suggestedTime: "Fri 9am",
    capacityNote: "If the 85-box pause gate is active, switch this CTA to a waitlist — never run “last chance” against the quality buffer.",
  },
  "ce-06": {
    role: "Proof",
    segment: "Cold discovery + warm retargeting",
    angle: "Process · Trust (high)",
    offer: "RM68 · remaining slots pinned on screen.",
    cta: "Reserve the remaining slots — bio link.",
    kpi: "Confirmed-box CPA ≤RM12.",
    suggestedTime: "Sat 9am",
    learningRef: "Raya: process video out-saved flat lays — front-load the packing reel.",
  },
  "ce-07": {
    role: "Close",
    segment: "Customers, followers, future buyers",
    angle: "Occasion · Community (medium)",
    offer: "Final same-day slots if stock holds · otherwise a next-drop waitlist.",
    cta: "Grab today's last slots, or join the next-drop list.",
    kpi: "≥95% of orders fulfilled in the promised slot · 10 usable UGC permissions for the next campaign.",
    suggestedTime: "Mon 8am",
  },
};

/* ── 模板 B:复购/办公室(repeat)—— 防守一个已验证的基本盘 ── */
const REPEAT_ENTRIES: NsCampaignEntry[] = [
  { id: "rp-01", date: "2026-08-24", platform: "instagram", format: "video", hook: "Your 3pm office pickup is back on", status: "proposed", estCredits: 40 },
  { id: "rp-02", date: "2026-08-25", platform: "facebook", format: "image", hook: "Standing order? We remember yours.", status: "proposed", estCredits: 12 },
  { id: "rp-03", date: "2026-08-26", platform: "instagram", format: "carousel", hook: "This week's tray, same faces", status: "proposed", estCredits: 24 },
  { id: "rp-04", date: "2026-08-27", platform: "instagram", format: "image", hook: "Cut-off is Thursday noon", status: "proposed", estCredits: 12 },
];
const REPEAT_STRATEGY: Record<string, CampaignEntryStrategy> = {
  "rp-01": {
    role: "Launch",
    segment: "Weekday office regulars within 2km",
    angle: "Routine · Convenience — one tap back into the rhythm",
    offer: "RM310 Office Tea Drop (serves the team).",
    cta: "Reply “OFFICE” to lock your usual slot.",
    kpi: "20 slot confirmations in the first 48h.",
    suggestedTime: "Mon 9am",
    learningRef: "Trend ts-04 (your own Meta export): weekday pre-order posts convert best 9–10am.",
  },
  "rp-02": {
    role: "Proof",
    segment: "Lapsed regulars (ordered before, gone quiet)",
    angle: "Recognition · Identity — “we remember yours”",
    offer: "Same box, one-tap reorder — no re-deciding.",
    cta: "WhatsApp “USUAL” and we pencil it in.",
    kpi: "Reactivate ≥15 dormant regulars.",
    suggestedTime: "Tue 9am",
  },
  "rp-03": {
    role: "Value",
    segment: "Active regulars",
    angle: "Freshness · Value clarity",
    offer: "RM170 croissant tray (20 × RM8.50).",
    cta: "Order the tray — bio link.",
    kpi: "Tray-order AOV ≥RM170.",
    suggestedTime: "Wed 9am",
  },
  "rp-04": {
    role: "Urgency",
    segment: "Undecided regulars",
    angle: "Deadline · Convenience (truthful)",
    offer: "Order by Thu 12pm for Friday delivery.",
    cta: "Reply to lock Friday.",
    kpi: "≥25 confirmed Friday orders.",
    suggestedTime: "Thu 10am",
    capacityNote: "When Friday delivery slots fill, remove them rather than accept an unbounded queue.",
  },
};

/* ── 模板 C:唤回(win-back)—— 按 (价值 × 近期) 排序的个人化序列,不是群发 ── */
const WINBACK_ENTRIES: NsCampaignEntry[] = [
  { id: "wb-01", date: "2026-08-24", platform: "instagram", format: "video", hook: "Your Tuesday slot is open again", status: "proposed", estCredits: 40 },
  { id: "wb-02", date: "2026-08-25", platform: "instagram", format: "image", hook: "Long time no bake?", status: "proposed", estCredits: 12 },
  { id: "wb-03", date: "2026-08-26", platform: "instagram", format: "video", hook: "What you've been missing this week", status: "proposed", estCredits: 40 },
  { id: "wb-04", date: "2026-08-27", platform: "facebook", format: "image", hook: "One message and you're back in the rhythm", status: "proposed", estCredits: 12 },
];
const WINBACK_STRATEGY: Record<string, CampaignEntryStrategy> = {
  "wb-01": {
    role: "Launch",
    segment: "Top dormant account (Muthu · wholesale · RM3,120 lifetime · silent 39d)",
    angle: "Open slot · Personal — never “we noticed you left”",
    offer: "Your Tuesday delivery slot is open again this week.",
    cta: "Reply to pencil in your usual 60 boxes.",
    kpi: "Reactivate the 3 highest-value dormant accounts (RM5,510 lifetime at risk).",
    suggestedTime: "Tue 9am",
    learningRef: "Win-back method: rank by (value × recency) — the biggest silent buyer goes first.",
  },
  "wb-02": {
    role: "Proof",
    segment: "Mid dormant (Firdaus · RM2,260 · silent 23d)",
    angle: "Warmth · Low-pressure — a door, not a countdown",
    offer: "A little welcome-back on your next box.",
    cta: "Reply “BACK” and we'll sort it.",
    kpi: "≥20% of messaged dormant contacts reply.",
    suggestedTime: "Wed 9am",
  },
  "wb-03": {
    role: "Value",
    segment: "Cooling regulars (drifting past their normal rhythm)",
    angle: "Freshness · FOMO-lite (truthful)",
    offer: "This week's fresh line — the bakes you used to order.",
    cta: "Order — bio link.",
    kpi: "Reactivate ≥8 orders from cooling regulars.",
    suggestedTime: "Thu 9am",
  },
  "wb-04": {
    role: "Close",
    segment: "All remaining dormant",
    angle: "Effortless return · Convenience",
    offer: "Reorder your usual in one tap.",
    cta: "WhatsApp “USUAL”.",
    kpi: "Cost per reactivated order ≤RM6.",
    suggestedTime: "Fri 10am",
    capacityNote: "Stop the sequence the moment someone replies — hand the conversation to a person.",
  },
};

/** 全模板 entry 策略拍平(按 id 查;proposal/calendar/pack 逐条渲染读它)。 */
const ENTRY_STRATEGY: Record<string, CampaignEntryStrategy> = {
  ...NEW_CUSTOMER_STRATEGY,
  ...REPEAT_STRATEGY,
  ...WINBACK_STRATEGY,
};

export function entryStrategy(id: string): CampaignEntryStrategy | undefined {
  return ENTRY_STRATEGY[id];
}

export const CAMPAIGN_TEMPLATES: Record<CampaignTemplateKey, CampaignTemplate> = {
  "new-customer": {
    key: "new-customer",
    label: "New-customer launch",
    entries: NS_CAMPAIGN_ENTRIES,
    strategy: {
      insight:
        "Raya proved demand exceeds supply, so the Merdeka problem is allocation and fulfilment, not price. Start earlier, show the unboxing, retain B2B, and pace demand.",
      objective:
        "Secure 100 confirmed pre-orders by Aug 30 — about RM6,800 in hero-box revenue — at a paid cost per confirmed box of RM12 or less. Second success condition: no oversell and no missed fulfilment slot.",
      expectedOutput: {
        targetOrders: 100,
        revenue: "~RM6,800 hero revenue",
        cpaTarget: "≤RM12 / confirmed box",
        basis: "Raya sold 312 boxes and sold out 3 days early — the ceiling is capacity, not reach.",
        condition:
          "Fill 100 slots and pace. Assumes warm past buyers convert ~2× cold traffic (Raya-derived proxy — verify with a 10% no-message holdout on the opt-in list).",
        confidence: "medium",
      },
      guardrails: [
        "Launch 100 paid slots; ring-fence 30 for corporate enquiries through Aug 25.",
        "At 85 confirmed boxes, pause broad acquisition and switch every CTA to a waitlist until the bakery lead signs off on stock, labour and delivery slots.",
        "Open at most 20 more boxes only after that check — never infer capacity from Raya's 312-box result.",
        "Scarcity copy must report a real state (“85 of 100 reserved”), never “almost gone” without a count.",
        "Stop paid media the moment ingredients, packaging or delivery slip — existing orders outrank growth.",
      ],
      audiences: [
        { segment: "Warm Raya buyers", jtbd: "Secure a proven festive gift before it sells out again", route: "Early WhatsApp access to the RM68 box — a better slot, not a cheaper box" },
        { segment: "KL family hosts", jtbd: "A polished, shareable Merdeka gift under RM70", route: "12-piece ribboned box RM68; show the lid reveal and every piece" },
        { segment: "Office admins (B2B)", jtbd: "Arrange a festive office treat in one message at a known cost", route: "10 boxes RM680 or RM310 Office Tea Drop; click-to-WhatsApp" },
        { segment: "Younger food-discovery", jtbd: "A local-flavour drop worth sharing", route: "Under-15s packing POV with RM68 on screen" },
      ],
      notDoing: [
        "No blanket early-bird discount — Raya proved the problem is allocation, not price resistance.",
        "No unlimited corporate orders — every bulk ask is a WhatsApp capacity check first.",
        "No flat-lay hero — static assets support value and ordering, they never lead.",
      ],
      learningsApplied: [
        { learning: "Unboxing reels beat flat lays 3:1 on saves", landsOn: "Posts 1 & 6 lead with the lid reveal and packing" },
        { learning: "Facebook drove corporate bulk orders", landsOn: "Post 2 is the Facebook B2B / Office Tea Drop post" },
        { learning: "Early-bird framing 6 weeks out captured most volume", landsOn: "Window opens Aug 24; early access buys a better slot, not a discount" },
      ],
    },
  },
  repeat: {
    key: "repeat",
    label: "Repeat / office orders",
    entries: REPEAT_ENTRIES,
    strategy: {
      insight:
        "This is defence, not acquisition. The weekday office rhythm already works (camp-office-01 is pacing 46/60) — the job is to remove friction from reordering, not to win strangers.",
      objective:
        "Bring back the weekday office-order rhythm: 60 confirmed orders this month from towers within 2km, at RM8 or less per order. Second condition: no over-messaging.",
      expectedOutput: {
        targetOrders: 60,
        revenue: "~RM2,400",
        cpaTarget: "≤RM8 / order",
        basis: "camp-office-01 is already pacing 46 of 60 at RM88 spent — the rhythm converts.",
        condition:
          "Assumes the 9–10am weekday window holds (cold-start: using your own 90-day Meta export; refresh against your last 4 weekday posts once fresh metrics land).",
        confidence: "medium",
      },
      guardrails: [
        "Push the standing order only to regulars who ordered in the last 60 days — never a cold blast.",
        "One reminder per person per week (respect the message cap).",
        "When Friday delivery slots fill, remove them rather than queue unbounded orders.",
      ],
      audiences: [
        { segment: "Active office regulars", jtbd: "Reorder the usual without re-deciding", route: "One-tap standing order; RM310 Office Tea Drop" },
        { segment: "Lapsed regulars", jtbd: "Come back without friction", route: "“We remember yours” one-tap reorder" },
        { segment: "Team leads", jtbd: "A reliable Friday delivery slot", route: "Reply to lock Friday before the Thursday cut-off" },
      ],
      notDoing: [
        "No new-customer acquisition spend — this campaign defends a proven base.",
        "No discount on the standing order — the value is convenience, not price.",
      ],
      learningsApplied: [
        { learning: "9–10am weekday posts drive same-day orders (ts-04, your own data)", landsOn: "Every post publishes in the 9–10am window" },
      ],
    },
  },
  "win-back": {
    key: "win-back",
    label: "Win-back sequence",
    entries: WINBACK_ENTRIES,
    strategy: {
      insight:
        "A win-back is a ranked personal sequence, not a blast. RM5,510 of dormant lifetime value is at risk; recover it by leading with the biggest silent buyer and an open slot — never guilt.",
      objective:
        "Recover lapsed buyers before they churn for good: re-engage RM5,510 of dormant lifetime value and land 12 reactivated orders at RM6 or less each.",
      expectedOutput: {
        targetOrders: 12,
        revenue: "~RM2,000",
        cpaTarget: "≤RM6 / reactivated order",
        basis: "3 dormant accounts hold RM5,510 lifetime; win-back math ranks them by (value × recency) / time-decay.",
        condition:
          "Assumes ~1 in 5 lapsed buyers recover (category rule of thumb — flag as an assumption; measure the actual reply rate on wave 1 before scaling).",
        confidence: "low",
      },
      guardrails: [
        "Message opted-in contacts only; one win-back message plus one reminder, no more.",
        "Never say “we noticed you might be leaving” — lead with the open slot, not the absence.",
        "Rank by value × recency — the RM3,120 wholesaler outranks a RM130 walk-in.",
        "Stop the sequence the moment someone replies — hand off to a person.",
      ],
      audiences: [
        { segment: "Top dormant (wholesale)", jtbd: "Restart the standing order with zero friction", route: "“Your Tuesday slot is open again” — reply to pencil in the usual 60 boxes" },
        { segment: "Mid dormant", jtbd: "A low-pressure reason to return", route: "A small welcome-back on the next box" },
        { segment: "Cooling regulars", jtbd: "Remember why they used to order", route: "This week's fresh line — bio link" },
      ],
      notDoing: [
        "No blanket blast to the whole book — this is a ranked, personal sequence.",
        "No guilt or fake urgency — the offer is a saved slot, not a countdown.",
      ],
      learningsApplied: [
        { learning: "Rank dormant accounts by value × recency", landsOn: "Post 1 leads with the top dormant account by lifetime value" },
      ],
    },
  },
};

const TEMPLATE_KEYWORDS: { key: CampaignTemplateKey; words: string[] }[] = [
  { key: "win-back", words: ["win back", "win-back", "winback", "dormant", "lapsed", "haven't ordered", "havent ordered", "reactivate", "silent", "gone quiet"] },
  { key: "repeat", words: ["repeat", "again", "office", "weekday", "reorder", "standing order", "regulars", "usual"] },
];

/** 从 campaign goal 派生模板(命中唤回/复购关键词优先,否则新客获取)。 */
export function resolveCampaignTemplate(goal: string | undefined): CampaignTemplate {
  const g = (goal ?? "").toLowerCase();
  for (const { key, words } of TEMPLATE_KEYWORDS) {
    if (words.some((w) => g.includes(w))) return CAMPAIGN_TEMPLATES[key];
  }
  return CAMPAIGN_TEMPLATES["new-customer"];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * [wave-c · Z4] 趋势资料库升级 —— GOOSEWORKS-MAP §一 工具7(证据句 + 置信度 + 落地桥)
 *
 * 把「营销101摘要」抬成「专属情报」:每条趋势带 ① 带基线/样本/日期的证据句;② confidence
 * (High/Watch/Cooling,来自多源印证 + recency 衰减);③ freshness(建议复核日);④「别追这个」
 * (本地反例 / 可反驳,不追通用最佳实践);⑤ appliedAs 落地桥(这条 → 计划里的哪个动作);
 * ⑥ method 脚注(自研来源诚实标注,不装外部权威)。按 NS_TRENDS 的 id(ts-01..ts-06)对齐。
 * ═══════════════════════════════════════════════════════════════════════════ */

export type TrendConfidence = "High" | "Watch" | "Cooling";

export interface TrendIntel {
  /** 带基线 + 样本 + 时间窗的证据句(替裸「2–3×」) */
  evidence: string;
  confidence: TrendConfidence;
  /** 建议复核(freshness,让「Otto 会先检查」从口号变状态) */
  recheck: string;
  /** 「别追这个」—— 本地反例 / 可反驳的边界(情报溢价所在) */
  dontChase: string;
  /** 洞察 → 动作桥(这条趋势改了计划里的什么) */
  appliedAs: string;
  /** 自研来源的方法脚注(诚实:不是官方数字) */
  method?: string;
}

export const TREND_INTEL: Record<string, TrendIntel> = {
  "ts-01": {
    evidence:
      "Across 40 KL F&B accounts we tracked last Merdeka, unboxing reels saved a median 210 vs 68 for flat lays — 3.1×. Demand window: Aug 24–31 (Google Trends “merdeka gift box” MY, 2023–2025).",
    confidence: "High",
    recheck: "Recheck by Aug 17 — a week before launch.",
    dontChase:
      "Don't copy generic “Merdeka sale 50% off” creative — the saves come from the unboxing, not a discount.",
    appliedAs: "Pre-order window set Aug 24–31; Posts 1 & 6 front-load the lid reveal.",
    method: "Panel = accounts we tracked last Merdeka, not a Meta-official figure.",
  },
  "ts-02": {
    evidence:
      "Office-delivery POV clips under 15s with an on-screen price led food-format completion for small MY F&B accounts this month (~120 clips sampled 2026-06-01 to 07-06).",
    confidence: "Watch",
    recheck: "Signal is one month old — recheck by Aug 17 before spending behind it.",
    dontChase:
      "Outside KL the same POV loses to storefront shots (62% vs 38% completion flips in-CBD) — don't blanket it nationally.",
    appliedAs: "Post 3 is a sub-15s office POV with RM68 on screen by second 2.",
    method: "TikTok Creative Center category sample — not your own account yet.",
  },
  "ts-03": {
    evidence:
      "Croissant-waffle hybrids and matcha pastries kept climbing in #croffle #klcafe velocity through late June; launch teasers with a countdown + first-50 incentive convert best for new SKUs.",
    confidence: "Watch",
    recheck: "Aesthetic trend, slow-moving — recheck monthly.",
    dontChase:
      "The “first-50 + countdown” tactic is generic playbook, not edge — lean on your own croffle, not the format hype.",
    appliedAs: "Feeds the Matcha croffle launch draft (camp-croffle-01).",
  },
  "ts-04": {
    evidence:
      "For KL office-area F&B, pre-order CTA posts published 9–10am on weekdays drove the most same-day orders (Meta insights export · Roti Bulan page · 90 days).",
    confidence: "High",
    recheck: "From your own 90-day export — still current; refresh after Merdeka.",
    dontChase:
      "Weekend mornings favour lifestyle over direct offers — don't force a 9am hard-sell on Saturday.",
    appliedAs: "Every weekday campaign post publishes in the 9–10am window.",
    method: "Your own Meta export — the highest-confidence source in this archive.",
  },
  "ts-05": {
    evidence:
      "Festive cookie-gifting search interest builds ~6 weeks before Hari Raya and collapses the week after (Google Trends “kuih raya gift” MY, 5-year view). Early-bird framing captured most bakery volume in 2026.",
    confidence: "High",
    recheck: "Seasonal — reactivate ~6 weeks before the next Raya.",
    dontChase: "Don't run it off-season — the window is tight and collapses fast.",
    appliedAs: "Set the Raya open-house timing; reuse the 6-week lead for the next festive drop.",
  },
  "ts-06": {
    evidence:
      "Marble tables, enamel cups and hand-written boards keep gaining in #kopitiam KL cafe content; kopitiam-styled accounts show steadier follower growth than minimal-modern styling.",
    confidence: "Cooling",
    recheck: "A slow brand-look cue, not a spike — no rush; revisit next quarter.",
    dontChase:
      "It's a styling direction, not a sales lever — don't build a campaign around it, borrow it for props.",
    appliedAs: "No campaign — a standing brand-look cue for prop and styling choices.",
    method: "Single-source hashtag velocity — directional, not a hard number.",
  },
};

export function trendIntel(id: string): TrendIntel | undefined {
  return TREND_INTEL[id];
}
