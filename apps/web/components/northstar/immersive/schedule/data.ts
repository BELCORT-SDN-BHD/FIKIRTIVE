/**
 * 排期区(Z5)· 区级静态配置与派生读（纯函数、零后台、确定性）。
 *
 * - Wave B 原型对象的 seed（槽位/频道组/hashtag 组/常青清单）在这里，注入共享 store。
 * - 冷启动最佳发帖时段表（best-time,行业默认）、campaign 归组解析、断链检查、
 *   逐帖轻量表现小结的确定性派生也在这里（分析区拥有真管线，此处只做展示派生）。
 *
 * 铁律:数据从 _mock / 通用常识派生,不新造 Roti Bulan 的品牌事实。
 */

import { NS_CAMPAIGNS, campaignSummaryById } from "@/components/northstar/_mock";

export type SPlatform = "instagram" | "facebook" | "tiktok" | "x";

/* ── Wave B seed（注入 store 的初始值;店主可在页面里增删） ─────────────────── */
export function scheduleExtrasSeed() {
  return {
    // [wave-b] 队列槽位配置:每渠道每周的固定发帖时段（周一起算 0..6）
    slots: [
      { id: "slot-0-09:00-instagram", day: 0, time: "09:00", channel: "instagram" as SPlatform },
      { id: "slot-2-12:30-facebook", day: 2, time: "12:30", channel: "facebook" as SPlatform },
      { id: "slot-4-18:00-tiktok", day: 4, time: "18:00", channel: "tiktok" as SPlatform },
      { id: "slot-5-09:00-instagram", day: 5, time: "09:00", channel: "instagram" as SPlatform },
    ],
    // [wave-b] 常用频道组合一键选
    channelGroups: [
      { id: "cg-seed-launch", name: "Launch day", channels: ["instagram", "facebook", "tiktok"] as SPlatform[] },
      { id: "cg-seed-meta", name: "Meta only", channels: ["instagram", "facebook"] as SPlatform[] },
    ],
    // [wave-b] hashtag 组管理（本地烘焙商家常用标签组）
    hashtagGroups: [
      { id: "hg-seed-bakery", name: "Bakery daily", tags: ["#RotiBulan", "#KLBakery", "#FreshlyBaked"] },
      { id: "hg-seed-merdeka", name: "Merdeka", tags: ["#Merdeka", "#MalaysiaBoleh", "#HariMerdeka", "#GiftBox"] },
    ],
    // [wave-b] 常青内容循环清单（营业时间/招牌菜/好评等,隔段自动重发）
    evergreen: [
      {
        id: "ev-seed-signatures",
        name: "Signature bakes",
        cadenceDays: 7,
        items: ["Pandan gula melaka cake", "Kaya butter croissant", "Kopi-O tiramisu cup"],
        active: true,
      },
    ],
  };
}

/* ── 最佳发帖时间 · 冷启动行业默认时段表（[wave-b] best-time + 行业默认） ──────
 * 无账号数据时也给靠谱建议;按平台维一张可配置表（原型固定 KL 烘焙行业口径）。 */
export interface BestTime {
  /** 0=Mon … 6=Sun */
  day: number;
  time: string;
  reason: string;
}
export const BEST_TIMES: Record<SPlatform, BestTime[]> = {
  instagram: [
    { day: 0, time: "09:00", reason: "Morning commute scroll — KL cafés peak" },
    { day: 5, time: "09:00", reason: "Weekend pre-order window opens" },
    { day: 6, time: "10:00", reason: "Sunday brunch browsing" },
  ],
  facebook: [
    { day: 2, time: "12:30", reason: "Lunch break — office orders check FB" },
    { day: 4, time: "17:00", reason: "Friday wind-down, weekend planning" },
  ],
  tiktok: [
    { day: 4, time: "18:00", reason: "Evening entertainment peak in MY" },
    { day: 6, time: "20:00", reason: "Sunday night food cravings" },
  ],
  x: [{ day: 1, time: "08:00", reason: "Weekday morning news scroll" }],
};

/** 某天某平台是否命中推荐时段(日历/composer 打光角标用)。 */
export function bestTimeHit(platform: SPlatform, day: number, time: string): boolean {
  return BEST_TIMES[platform]?.some((b) => b.day === day && b.time === time) ?? false;
}
/** 某平台最近的推荐时段列表(composer 建议面用)。 */
export function bestTimesFor(platform: SPlatform): BestTime[] {
  return BEST_TIMES[platform] ?? [];
}

/* ── 按内容类型分时段 · 冷启动诚实标注（[wave-c] Z5-schedule）───────────────────
 * 病根(EFFECTIVENESS #174):best-time 是一张冻结的行业默认表,从不读账号自己的表现,
 * 「Sunday brunch browsing」任何店都能贴。冷启动态现在能诚实做的两件事:
 *   ① 诚实标注来源——这是「KL 烘焙行业默认」,不是你的数据;个人化态等分析区真管线上线
 *      (line 253:mock 里编个人化假数字=自欺,故此处只做诚实的冷启动态)。
 *   ② 按内容类型分时段——老板真正在想的是「我这条促销该几点发」,不是抽象的平台均值。
 * 每个窗口 day(0=Mon..6=Sun)+ time + 一句能站住的理由(KL 面包店社媒常识,非品牌事实)。 */
export type PostType = "fresh" | "promo" | "behind" | "weekend";

export interface PostTypeMeta {
  id: PostType;
  /** chip 文案(人话,sentence case) */
  label: string;
  /** 一句解释这类内容是什么 */
  hint: string;
}

export const POST_TYPES: PostTypeMeta[] = [
  { id: "fresh", label: "Fresh bake", hint: "Daily drops — what is out of the oven now" },
  { id: "promo", label: "Promo", hint: "Sales, discounts, pre-order pushes" },
  { id: "behind", label: "Behind the scenes", hint: "Team, process, story-style posts" },
  { id: "weekend", label: "Weekend special", hint: "Weekend menus and pre-orders" },
];

/** 冷启动行业默认时段表,按内容类型切(而非只按平台)。理由挂来源口径「KL bakery」。 */
export const BEST_TIMES_BY_TYPE: Record<PostType, BestTime[]> = {
  fresh: [
    { day: 0, time: "07:00", reason: "Monday commute scroll — start the week's pre-orders" },
    { day: 3, time: "08:00", reason: "Thursday top-up, before the weekend rush" },
    { day: 4, time: "07:00", reason: "Friday morning — people plan the weekend's treats" },
  ],
  promo: [
    { day: 1, time: "12:00", reason: "Tuesday lunch break — office orders get placed" },
    { day: 4, time: "17:00", reason: "Friday payday wind-down, weekend planning" },
    { day: 6, time: "20:00", reason: "Sunday night cravings — next-day pickup" },
  ],
  behind: [
    { day: 2, time: "20:00", reason: "Midweek evening scroll — story content lands" },
    { day: 5, time: "10:00", reason: "Saturday slow morning — people browse, not buy" },
    { day: 6, time: "21:00", reason: "Sunday wind-down — higher watch-through on process clips" },
  ],
  weekend: [
    { day: 4, time: "17:00", reason: "Friday evening — open the weekend pre-order window" },
    { day: 5, time: "09:00", reason: "Saturday brunch browsing" },
    { day: 6, time: "10:00", reason: "Sunday brunch — walk-in and same-day orders" },
  ],
};

/** 某内容类型的推荐窗口(composer 建议面用;冷启动行业默认,非个人化)。 */
export function bestTimesForType(type: PostType): BestTime[] {
  return BEST_TIMES_BY_TYPE[type] ?? [];
}

/* ── campaign 归组解析(角标 + 深链回容器) ──────────────────────────────────
 * 帖卡上的 campaign 角标点进 campaign 容器(D1:Campaign 是唯一「事」容器)。 */
const OFFICE_FALLBACK: Record<string, string> = {
  "camp-office-01": "Office lunch orders",
};
export function campaignName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return campaignSummaryById(id)?.name ?? OFFICE_FALLBACK[id];
}
/** campaign 容器深链(归组 → 回到那件事的日历)。路由稳定,查询参数不读也无害。 */
export function campaignHref(id: string, base: string): string {
  return `${base}/campaign/calendar?campaign=${id}`;
}
export function allCampaignIds(): string[] {
  // camp-office-01 现已是 NS_CAMPAIGNS 的正式成员,无需再手动补挂(避免重复)。
  return NS_CAMPAIGNS.map((c) => c.id);
}

/* ── 断链检查([wave-b] 相邻/链接健康;WHATPASS「断链检查」) ────────────────
 * 原型层确定性假规则:抓 caption/first comment/UTM 里的 URL,标出明显坏链。 */
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
export interface LinkIssue {
  url: string;
  problem: string;
}
export function checkLinks(...texts: (string | undefined)[]): { urls: string[]; issues: LinkIssue[] } {
  const urls: string[] = [];
  const issues: LinkIssue[] = [];
  for (const t of texts) {
    if (!t) continue;
    const found = t.match(URL_RE) ?? [];
    for (const raw of found) {
      const url = raw.replace(/[.,)]+$/, "");
      urls.push(url);
      if (/\s/.test(url)) issues.push({ url, problem: "Has a space — the link will break" });
      else if (/^www\./i.test(url)) issues.push({ url, problem: "Missing https:// — some apps won't make it clickable" });
      else if (/\.\.|\/\/$/.test(url.replace(/^https?:\/\//, ""))) issues.push({ url, problem: "Looks malformed" });
      else if (/example\.com|test\.test|localhost/i.test(url)) issues.push({ url, problem: "Placeholder link — swap for the real one" });
    }
  }
  return { urls, issues };
}

/* ── UTM 生成([wave-b] 内容标签 + UTM 追踪) ────────────────────────────────
 * 轻量 Tags,不建重型 Campaign 实体;链接自动带追踪参数。 */
export function buildUtm(baseUrl: string, source: SPlatform, tags: string[]): string {
  const campaign = tags[0] ? tags[0].replace(/^#/, "").toLowerCase().replace(/\s+/g, "-") : "social";
  const params = `utm_source=${source}&utm_medium=social&utm_campaign=${campaign}`;
  if (!baseUrl) return `rotibulan.my/order?${params}`;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}${params}`;
}

/* ── 逐帖表现 · 冷启动只给「行业基准」不编个人战绩（[wave-c] Z5-schedule）─────────
 * 病根(EFFECTIVENESS #174 / #253):旧 postMetrics 用帖 id 做 hash 编出每帖 reach/互动
 * (「12.3K reach · 5.2% eng」),摆在 Sent 卡上真商家会当自己帖子的真实战绩读——正是
 * 「报界面数字不报生意数字」,且与同区 best-time『not tuned to you yet』的诚实标注自相矛盾。
 * 冷启动能诚实做的只有:给平台级行业互动率区间(锚点=平台;区间=对不确定性诚实)+ 明标
 * 「不是你的数据」;个人化战绩(这条帖到底多少 reach)等分析区真管线接上已发帖表现再做,
 * 否则是自欺。互动「率」与受众规模无关,故平台级 F&B 区间可站住;reach 依赖粉丝数(我们
 * 没有),故不编 reach。数字为社媒 F&B 常识区间,非品牌事实、非个人战绩。 */
export interface EngBenchmark {
  /** 该平台 F&B 常见互动率下界(%) */
  low: number;
  /** 上界(%) */
  high: number;
}
export const ENGAGEMENT_BENCHMARKS: Record<SPlatform, EngBenchmark> = {
  instagram: { low: 1.0, high: 3.0 },
  facebook: { low: 0.5, high: 1.5 },
  tiktok: { low: 4.0, high: 8.0 },
  x: { low: 0.3, high: 1.0 },
};
export function engBenchmark(platform: SPlatform): EngBenchmark {
  return ENGAGEMENT_BENCHMARKS[platform];
}
