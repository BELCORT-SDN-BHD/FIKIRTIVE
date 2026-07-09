/**
 * 北极星原型 — 广告诊断卡的「真引用」知识库(O-10:不捏造,引用带来源)
 *
 * 这是从 repo 的第一方 Meta 官方知识库
 * `packages/otto/src/knowledge/meta-expertise.data.ts`(2026-07-03 build,63 源全 Meta 官方,
 * 逐条对抗核实)里逐字节选的 11 条真实条目,做成 northstar 静态模块(不跨 package import
 * 后台 —— 保持 check-northstar-imports 绿)。每条 claim / source.url 与源库一致,可点开验证。
 * 要更新:重跑那份研究并从源库重新节选,不要手写 claim(避免漂移)。
 *
 * 零后台 import;确定性(无 Date.now / 无 Math.random)。
 */

export type NsMetaKbDomain = "creative" | "diagnosis" | "measurement" | "targeting";

export interface NsMetaKbSource {
  /** Meta 官方页面标题(第一方) */
  title: string;
  /** 真实 URL — 诊断卡引用点开即到 */
  url: string;
  /** 采集日期(源库口径) */
  retrievedAt: string;
}

export interface NsMetaKbEntry {
  id: string;
  domain: NsMetaKbDomain;
  /** 提炼的专家原则(非逐字复制) */
  claim: string;
  detail?: string;
  /** 有量化基准时的人话数字 */
  benchmark?: string;
  source: NsMetaKbSource;
}

export const NS_META_KB: Record<string, NsMetaKbEntry> = {
  "creative-reels-hook-first-seconds": {
    id: "creative-reels-hook-first-seconds",
    domain: "creative",
    claim:
      "Effective Reels ads win viewer attention by nailing the hook within the first few seconds, the critical moment when viewers instinctively decide whether to continue watching.",
    detail:
      "Three proven hook types are Value Promise (leading with viewer benefits), Statement of Intent (being direct about what viewers will see), and Question/Invitation (sparking curiosity).",
    source: {
      title: "The Science of the Hook: How to Supercharge Your Reels Performance",
      url: "https://www.facebook.com/business/news/the-science-of-the-hook-how-to-supercharge-your-reels-performance",
      retrievedAt: "2026-07-03",
    },
  },
  "creative-reels-vertical-9-16-aspect-ratio": {
    id: "creative-reels-vertical-9-16-aspect-ratio",
    domain: "creative",
    claim:
      "Reels ads built in 9:16 vertical aspect ratio with audio and key creative elements in the safe zone deliver 34.5% lower cost per result compared to image ads.",
    detail: "The 9:16 vertical format is the native orientation for Reels, delivering 2x higher delivery versus other aspect ratios.",
    benchmark: "34.5% lower cost per result vs image ads",
    source: {
      title: "Instagram & Facebook Reels: Create Short Video Ads",
      url: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
      retrievedAt: "2026-07-03",
    },
  },
  "creative-audio-quality-reels-conversion": {
    id: "creative-audio-quality-reels-conversion",
    domain: "creative",
    claim:
      "Reels ads featuring both music and voiceover demonstrate 15 percentage points higher positive consumer response scores compared to ads without sound, with vertical sound-on video showing 4.8% lower cost per action.",
    detail:
      "Advertisers can source, select, and add music to single image Reels ads during campaign creation using royalty-free music libraries or Meta's Sound Collection.",
    benchmark: "4.8% lower cost per action with vertical sound-on video",
    source: {
      title: "Reels Ads updates: new performance features, automated creative and suitability solutions",
      url: "https://www.facebook.com/business/news/reels-ads-updates-performance-features-automated-creative-suitability-solutions",
      retrievedAt: "2026-07-03",
    },
  },
  "creative-ab-testing-single-variable": {
    id: "creative-ab-testing-single-variable",
    domain: "creative",
    claim:
      "A/B test ad variants by isolating a single variable at a time while keeping other campaign elements consistent, enabling accurate attribution of performance changes to specific creative modifications.",
    detail:
      "Test up to five ad variants. Variables include campaign settings, audience targeting, and creative elements (colors, fonts, Reels-style video, imagery). Divide audience into non-overlapping random groups with sufficient budget for statistical confidence.",
    source: {
      title: "Ad Measurement: A/B Testing Ads on Facebook & Instagram",
      url: "https://www.facebook.com/business/measurement/ab-testing",
      retrievedAt: "2026-07-03",
    },
  },
  "measurement-click-attribution-change": {
    id: "measurement-click-attribution-change",
    domain: "measurement",
    claim:
      "Meta changed click-through attribution to exclusively include link clicks, bringing Meta reporting into closer alignment with third-party measurement tools like Google Analytics.",
    source: {
      title: "Simplifying Ad Measurement for a Social-First World | Meta for Business",
      url: "https://www.facebook.com/business/news/click-attribution",
      retrievedAt: "2026-07-03",
    },
  },
  "diagnosis-quality-ranking-impact": {
    id: "diagnosis-quality-ranking-impact",
    domain: "diagnosis",
    claim:
      "Quality ranking rates an ad's perceived quality relative to ads competing for the same audience as Below Average, Average or Above Average, based on signals like user feedback (e.g. hiding or reporting the ad) and low-quality attributes such as engagement bait, sensationalized language or withholding information. A Below Average quality ranking is associated with higher delivery costs (higher CPM/CPC), making the creative a candidate for improvement.",
    source: {
      title: "About Quality Ranking | Meta Business Help Center",
      url: "https://www.facebook.com/business/help/303639570334185",
      retrievedAt: "2026-07-03",
    },
  },
  "diagnosis-ad-relevance-diagnostics": {
    id: "diagnosis-ad-relevance-diagnostics",
    domain: "diagnosis",
    claim:
      "Ad relevance diagnostics measures three dimensions of ad relevance to diagnose underperformance: quality ranking (user feedback and attribute assessment), engagement rate ranking (expected engagement vs. competing ads), and conversion rate ranking (expected conversion rate vs. competing ads). Low scores in any dimension indicate need for creative, targeting, or landing page improvements.",
    source: {
      title: "About Ad Relevance Diagnostics | Meta Business Help Center",
      url: "https://www.facebook.com/business/help/403110480493160",
      retrievedAt: "2026-07-03",
    },
  },
  "diagnosis-creative-fatigue-frequency": {
    id: "diagnosis-creative-fatigue-frequency",
    domain: "diagnosis",
    claim:
      "Creative fatigue occurs when the same audience sees the same ad creative too frequently, causing CTR to decline and CPA to increase as the audience becomes desensitized. Frequency itself is not harmful, but when CTR drops noticeably as frequency rises, it signals audience saturation requiring creative refresh.",
    source: {
      title: "Creative fatigue recommendations in Meta Ads Manager | Meta Business Help Centre",
      url: "https://www.facebook.com/business/help/1346816142327858",
      retrievedAt: "2026-07-03",
    },
  },
  "diagnosis-breakdowns-analysis": {
    id: "diagnosis-breakdowns-analysis",
    domain: "diagnosis",
    claim:
      "Use breakdowns in Ads Manager to segment performance by platform, placement, device, demographics, and date range. This reveals where cost is being incurred and which segments underperform, enabling targeted optimization of underperforming placements or demographics rather than broad campaign-level changes.",
    source: {
      title: "About breakdowns, metrics and filtering in Meta Ads Manager | Meta Business Help Center",
      url: "https://www.facebook.com/business/help/264160060861852",
      retrievedAt: "2026-07-03",
    },
  },
  "diagnosis-landing-page-relevance": {
    id: "diagnosis-landing-page-relevance",
    domain: "diagnosis",
    claim:
      "Post-click experience quality (landing page design, message relevance, loading speed, mobile optimization) directly impacts relevance diagnostics scoring and delivery cost. Poor landing page experience increases CPC even if ad creative is strong. Ad relevance diagnostics flag landing page issues as a cause of underperformance.",
    source: {
      title: "About landing page view optimization | Meta Business Help Center",
      url: "https://www.facebook.com/business/help/417293491972212",
      retrievedAt: "2026-07-03",
    },
  },
  "targeting-advantage-plus-constraints": {
    id: "targeting-advantage-plus-constraints",
    domain: "targeting",
    claim:
      "Advantage+ Audience provides four types of hard constraints where Meta will not expand beyond: minimum age, specific locations, languages, and custom audience exclusions. All other targeting inputs (like age maximum and gender) function as suggestions.",
    source: {
      title: "About Audience controls and Audience suggestions | Meta Business Help Center",
      url: "https://www.facebook.com/business/help/938372127764391",
      retrievedAt: "2026-07-03",
    },
  },
};

/** 按 id 取真实条目;缺 id 返回 undefined(调用端渲染诚实空态,不捏造) */
export function metaKbEntry(id: string): NsMetaKbEntry | undefined {
  return NS_META_KB[id];
}
