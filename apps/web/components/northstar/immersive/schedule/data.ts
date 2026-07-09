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

/* ── 逐帖轻量表现小结([wave-b] published 卡叠加 reach/互动小字) ────────────
 * 分析区拥有真管线;此处只做确定性展示派生(同一帖每次一致),不重建 pipeline。 */
export function postMetrics(id: string): { reach: number; engagementPct: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const reach = 1800 + (h % 13600); // 1.8K–15.4K
  const engagementPct = 2 + ((h >> 8) % 70) / 10; // 2.0%–8.9%
  return { reach, engagementPct: Math.round(engagementPct * 10) / 10 };
}
export function fmtReach(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
