/**
 * 北极星原型 — 同行广告透视(Competitor Ad X-ray)示例数据
 * GOOSEWORKS-MAP §二 B1:抄方法(按 hook 聚类 + 用「跑了多久」当赢家信号 + 找白空间),
 * 不抄爬取管线。数据源形态 = Meta Ad Library 官方公开广告透明工具(合法公开数据)。
 *
 * ── 诚实红线(冷启动 / 不捏造)────────────────────────────────────────────────
 * Meta 的 Ad Library 对**非政治类商业广告**只公开:广告主、创意(图/文/视频)、
 * 起投日期、投放中/已停、投放平台 —— **不公开花费,也不公开触达**。所以本模块**绝不**
 * 给同行广告编造 spend/reach 数字。唯一诚实的赢家信号 = 「这条跑了多久」(长跑 = 广告主
 * 一直在为它付费 = 市场用钱投票)。hook 聚类是**我们对每条广告开场白的判读**,不是 Meta
 * 的官方标签 —— UI 必须照实说。白空间是相对「本次抓到的这批广告」而言,不是整个市场。
 *
 * 图片纪律(ENDGAME §一):缩略图全部走 NS_IMAGES(真图),对到广告所描绘的品类主视觉。
 * 零后台 import;确定性(无 Date.now / 无 Math.random)。
 */

import { nsImage } from "@/components/northstar/_mock";

/* ── 搜索口径(商家搜「同城同类」;演示锁定 Aisyah 的场景:KL 烘焙同行)────────── */
export const NS_COMPETITOR_SEARCH = {
  /** 演示预填的查询(商家可改;真接通后 = Ad Library search 参数) */
  query: "Bakeries · Kuala Lumpur",
  businessType: "Bakery",
  location: "Kuala Lumpur",
  country: "MY",
  /** 「今天」口径(daysRunning 已按它算好,确定性;真接通后由起投日期实时算) */
  asOf: "2026-07-10",
} as const;

/**
 * 每条 hook 角度的定义(聚类桶)。id 稳定,label 祈使/人话,question 是「这条广告在问观众什么」。
 * 顺序 = 展示顺序;craft 放最后,演示里它是白空间(同城同行没人打)。
 */
export interface NsHookAngle {
  id: string;
  label: string;
  /** 一句话定义:这个角度靠什么钩住人 */
  gist: string;
}

export const NS_HOOK_ANGLES: NsHookAngle[] = [
  { id: "outcome", label: "Treat yourself", gist: "Leads with the reward — you deserve this, it feels good." },
  { id: "question", label: "Curiosity question", gist: "Opens with a question that makes you stop and wonder." },
  { id: "social-proof", label: "Everyone's ordering", gist: "Sold-out counts, waitlists, numbers — proof the crowd already chose it." },
  { id: "scarcity", label: "Limited / seasonal", gist: "A closing window — festive drop, pre-order deadline, last week." },
  { id: "craft", label: "How it's made", gist: "The hands, the hours, the process behind the bake." },
];

export type NsHookId = (typeof NS_HOOK_ANGLES)[number]["id"];

/* ── 逐条同行广告(Ad Library 形态:无 spend / 无 reach,只有公开创意 + 起投 + 平台)── */
export interface NsCompetitorAd {
  id: string;
  /** 广告主(公开页名) */
  advertiser: string;
  /** 我们判读的 hook 角度桶(不是 Meta 标签) */
  hookId: NsHookId;
  /** 缩略图(NS_IMAGES 真图) */
  thumb: string;
  /** 公开广告文案(Ad Library 的 ad_creative_body) */
  primaryText: string;
  format: "video" | "image" | "carousel";
  /** 投放平台(Ad Library 的 publisher_platforms) */
  platforms: string[];
  /** 起投日期(Ad Library 的 ad_delivery_start_time) */
  firstSeen: string;
  /** 已跑天数(唯一诚实赢家信号;由起投日期 → asOf 算出) */
  daysRunning: number;
  /** 仍在投(Ad Library 的 active_status) */
  active: boolean;
  /** 深链回真 Ad Library 该广告主的搜索结果(真域名,可自证) */
  libraryUrl: string;
}

/** 真 Ad Library 搜索深链(按广告主/查询;真域名 facebook.com/ads/library)。 */
function libUrl(q: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=MY&q=${encodeURIComponent(
    q,
  )}&media_type=all`;
}

export const NS_COMPETITOR_ADS: NsCompetitorAd[] = [
  // ── Treat yourself(outcome)──
  {
    id: "cad-01",
    advertiser: "Tigerlily Bakehouse",
    hookId: "outcome",
    thumb: nsImage("bakery", 1),
    primaryText: "You deserve the good croissant. All butter, all flake, gone by 11am.",
    format: "image",
    platforms: ["Facebook", "Instagram"],
    firstSeen: "2026-06-02",
    daysRunning: 38,
    active: true,
    libraryUrl: libUrl("Tigerlily Bakehouse"),
  },
  {
    id: "cad-02",
    advertiser: "Wondermilk",
    hookId: "outcome",
    thumb: nsImage("bakery", 11),
    primaryText: "Turn any Tuesday into a treat — cupcakes delivered across KL.",
    format: "image",
    platforms: ["Facebook", "Instagram"],
    firstSeen: "2026-06-19",
    daysRunning: 21,
    active: true,
    libraryUrl: libUrl("Wondermilk"),
  },

  // ── Curiosity question(question)── 含全场跑最久的一条(赢家信号最强)
  {
    id: "cad-03",
    advertiser: "Kenny Hills Bakers",
    hookId: "question",
    thumb: nsImage("bakery", 14),
    primaryText: "Ever had a kouign-amann still warm from the oven? Consider this your sign.",
    format: "video",
    platforms: ["Facebook", "Instagram"],
    firstSeen: "2026-05-19",
    daysRunning: 52,
    active: true,
    libraryUrl: libUrl("Kenny Hills Bakers"),
  },
  {
    id: "cad-04",
    advertiser: "Ø Bakery KL",
    hookId: "question",
    thumb: nsImage("storefront", 4),
    primaryText: "What makes a sourdough worth queuing for? 48 hours and zero shortcuts.",
    format: "video",
    platforms: ["Instagram"],
    firstSeen: "2026-06-28",
    daysRunning: 12,
    active: true,
    libraryUrl: libUrl("Ø Bakery"),
  },

  // ── Everyone's ordering(social-proof)──
  {
    id: "cad-05",
    advertiser: "Tigerlily Bakehouse",
    hookId: "social-proof",
    thumb: nsImage("bakery", 20),
    primaryText: "Sold out three weekends running. Pre-order this week before they're gone.",
    format: "image",
    platforms: ["Facebook", "Instagram"],
    firstSeen: "2026-05-27",
    daysRunning: 44,
    active: true,
    libraryUrl: libUrl("Tigerlily Bakehouse"),
  },
  {
    id: "cad-06",
    advertiser: "Baker's Brew Studio",
    hookId: "social-proof",
    thumb: nsImage("campaign", 0),
    primaryText: "4,000 boxes shipped last Raya. Join the list for the next drop.",
    format: "carousel",
    platforms: ["Facebook", "Instagram"],
    firstSeen: "2026-06-11",
    daysRunning: 29,
    active: true,
    libraryUrl: libUrl("Baker's Brew Studio"),
  },

  // ── Limited / seasonal(scarcity)──
  {
    id: "cad-07",
    advertiser: "Kenny Hills Bakers",
    hookId: "scarcity",
    thumb: nsImage("campaign", 4),
    primaryText: "Merdeka gift boxes — 200 only. Pre-orders close 25 Aug.",
    format: "image",
    platforms: ["Facebook", "Instagram"],
    firstSeen: "2026-07-01",
    daysRunning: 9,
    active: true,
    libraryUrl: libUrl("Kenny Hills Bakers"),
  },
  {
    id: "cad-08",
    advertiser: "Wondermilk",
    hookId: "scarcity",
    thumb: nsImage("bakery", 5),
    primaryText: "Last week for the pandan gula melaka season special.",
    format: "image",
    platforms: ["Instagram"],
    firstSeen: "2026-06-24",
    daysRunning: 16,
    active: true,
    libraryUrl: libUrl("Wondermilk"),
  },
  // ── craft(how it's made)= 演示白空间:同城同行没人打这个角度(0 条)──
];

/* ── 聚类 + 赢家信号 + 白空间(方法在这层,UI 只渲染)────────────────────────── */

export interface NsHookCluster {
  angle: NsHookAngle;
  ads: NsCompetitorAd[];
  /** 桶内广告数 */
  count: number;
  /** 桶内跑最久的天数(赢家信号:长跑 = 被市场验证过) */
  longestDays: number;
  /** 桶内独立广告主数(角度有多拥挤) */
  advertisers: number;
}

/** 按 hook 角度聚类(保 NS_HOOK_ANGLES 顺序;空桶也返回 = 白空间靠它现形)。 */
export function clusterByHook(ads: NsCompetitorAd[] = NS_COMPETITOR_ADS): NsHookCluster[] {
  return NS_HOOK_ANGLES.map((angle) => {
    const inBucket = ads
      .filter((a) => a.hookId === angle.id)
      .sort((a, b) => b.daysRunning - a.daysRunning);
    return {
      angle,
      ads: inBucket,
      count: inBucket.length,
      longestDays: inBucket.reduce((m, a) => Math.max(m, a.daysRunning), 0),
      advertisers: new Set(inBucket.map((a) => a.advertiser)).size,
    };
  });
}

/**
 * 白空间 = 同城同行没人(或几乎没人)打的角度 = 你的机会。
 * 判据:桶内 0 条 → 完全没人打(最强白空间)。返回第一个空桶的角度,没有则 null。
 */
export function whiteSpaceAngle(clusters: NsHookCluster[]): NsHookAngle | null {
  const empty = clusters.find((c) => c.count === 0);
  return empty ? empty.angle : null;
}

/** 全场跑最久的一条(整页的「最强赢家信号」标注用)。 */
export function longestRunning(ads: NsCompetitorAd[] = NS_COMPETITOR_ADS): NsCompetitorAd | null {
  return ads.reduce<NsCompetitorAd | null>((best, a) => (!best || a.daysRunning > best.daysRunning ? a : best), null);
}

/** 概览计数(答案先行:N 条来自 M 个广告主,聚成 K 个角度)。 */
export function competitorOverview(ads: NsCompetitorAd[] = NS_COMPETITOR_ADS) {
  const clusters = clusterByHook(ads);
  return {
    adCount: ads.length,
    advertiserCount: new Set(ads.map((a) => a.advertiser)).size,
    /** 有广告的角度数(非空桶) */
    usedAngles: clusters.filter((c) => c.count > 0).length,
    totalAngles: NS_HOOK_ANGLES.length,
  };
}
