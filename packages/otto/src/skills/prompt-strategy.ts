/**
 * 场景策略路由（#437）—— 用户意图信号 → 策略族。
 *
 * 纯数据 + 纯函数，无 DB/网络。instructions.ts 载有同一套规则的压缩版给 Otto 执行；
 * 本模块是可测试的权威定义（decideStrategy 即验收要求的「显式可测决策函数」）。
 * 用户可能用英语/华语/马来语或混写（Manglish），意图信号三语都收。
 *
 * 开放性守则：Otto 面向开放场景 —— 全部未命中时走 generalCreative 兜底，
 * 不假设用户是商家、不把个人请求往带货方向掰、不追问用户答不上的风格问题。
 * 商密：本文件所有字符串都可能进入用户可见文本，不得出现引擎供应商或模型商号。
 */
import type { PromptRef } from "./prompt-vocab.js";

export type StrategyFamily =
  | "ecommerce"
  | "dialogueDrama"
  | "fantasyAnimation"
  | "educational"
  | "beatSync"
  | "generalCreative";

export interface StrategyFamilySpec {
  family: StrategyFamily;
  /** Plain-language name, safe to show users. */
  label: string;
  /** Trilingual intent keywords. ASCII entries match on word boundaries; CJK entries match as substrings. */
  signals: { en: readonly string[]; zh: readonly string[]; ms: readonly string[] };
  /** @-reference roles that count as a STRONG signal (weight 2) for this family. */
  roleSignals: readonly PromptRef["role"][];
  /** Up to two plain-language clarifying questions (Otto re-phrases them in the user's language). */
  questions: readonly string[];
}

// 注意跨族词（速查表语义）：story/故事/cerita 同时挂在 短剧对话 与 奇幻动画 —— 单独出现时
// 两族打平且形状远 → 走提问支路（真人还是虚构）；viral/trend/爆款 同挂 电商 与 音乐卡点，同理。
export const STRATEGY_FAMILIES: readonly StrategyFamilySpec[] = [
  {
    family: "ecommerce",
    label: "E-commerce",
    signals: {
      en: ["product video", "ad", "ads", "advert", "promo", "promotion", "launch", "sale", "listing", "unboxing", "restock", "discount", "viral", "trending"],
      zh: ["带货", "上新", "促销", "开箱", "卖点", "详情页", "主图", "直播切片", "清货", "广告", "爆款"],
      ms: ["iklan", "promosi", "jualan", "produk baru", "kedai", "murah", "borong", "penghantaran"],
    },
    roleSignals: ["product", "brandmark"],
    questions: [
      "Is this for one product or a set of products?",
      "Should the price or promo text appear in the visual, or stay clean so you can add it later?",
    ],
  },
  {
    family: "dialogueDrama",
    label: "Dialogue drama",
    signals: {
      en: ["skit", "dialogue", "acting", "drama", "lines", "characters talking", "story", "pov"],
      zh: ["短剧", "剧情", "对话", "台词", "桥段", "反转", "一幕", "故事"],
      ms: ["cerita", "drama", "dialog", "watak", "babak", "lakonan"],
    },
    roleSignals: ["character"],
    questions: [
      "Roughly how many lines of dialogue, and who speaks first?",
      "Which language should the dialogue be in (Malay / Chinese / English / a mix)?",
    ],
  },
  {
    family: "fantasyAnimation",
    label: "Fantasy / animation",
    signals: {
      en: ["anime", "cartoon", "animated", "animation", "fantasy", "magical", "fairy tale", "stylized", "story"],
      zh: ["动画", "二次元", "卡通", "奇幻", "魔法", "仙侠", "水墨", "绘本", "故事"],
      ms: ["animasi", "kartun", "fantasi", "dongeng", "ajaib", "cerita"],
    },
    roleSignals: [],
    questions: [
      "Which art style do you want — 3D cartoon, hand-drawn, or ink-wash?",
      "Is the lead character already designed, or should we design one first?",
    ],
  },
  {
    family: "educational",
    label: "Educational",
    signals: {
      en: ["explainer", "tutorial", "how-to", "how to", "step by step", "educational", "demo", "lesson"],
      zh: ["科普", "教程", "讲解", "演示", "步骤", "原理", "知识点", "教学"],
      ms: ["tutorial", "belajar", "cara buat", "langkah", "penerangan"],
    },
    roleSignals: [],
    questions: [
      "How many steps should it cover, and what does each step say?",
      "Which language should the narration be in?",
    ],
  },
  {
    family: "beatSync",
    label: "Beat-sync",
    signals: {
      en: ["beat sync", "to the beat", "montage", "drop", "trending sound", "transitions", "viral", "trending"],
      zh: ["卡点", "踩点", "节奏", "混剪", "变装", "鼓点", "爆款"],
      ms: ["ikut rentak", "lagu", "rancak"],
    },
    roleSignals: [],
    questions: [
      "How fast should the rhythm feel — rapid-fire cuts or mid-tempo?",
      "What are we cutting between (products, outfits, scenes)?",
    ],
  },
  {
    family: "generalCreative",
    label: "General creative",
    signals: { en: [], zh: [], ms: [] }, // 兜底族：不靠关键词命中
    roleSignals: [],
    questions: [
      "Who is this for and where will it be used (social post / private keepsake)?",
      "Do you want a photo-real look or an illustrated one?",
    ],
  },
];

/** 形状差异大的族对 → 打平时提问（≤2 问）；不在表内的打平 → 直接取更具体的一族。 */
export const DISTANT_PAIRS: ReadonlyArray<{
  pair: readonly [StrategyFamily, StrategyFamily];
  questions: readonly string[];
}> = [
  { pair: ["ecommerce", "beatSync"], questions: ["Should this showcase the product itself, or be a fast beat-synced montage?"] },
  { pair: ["dialogueDrama", "fantasyAnimation"], questions: ["Is the lead a real person acting, or a fictional/animated character?"] },
  { pair: ["ecommerce", "dialogueDrama"], questions: ["Do you want a straightforward product ad, or a short acted story with dialogue?"] },
  { pair: ["ecommerce", "fantasyAnimation"], questions: ["Should the product appear photo-real, or inside an animated/stylized world?"] },
];

/** 打平裁决顺序：形状越受限越具体，具体者胜（generalCreative 永远垫底）。 */
export const SPECIFICITY: readonly StrategyFamily[] = [
  "beatSync",
  "educational",
  "fantasyAnimation",
  "dialogueDrama",
  "ecommerce",
  "generalCreative",
];

export interface IntentSignals {
  /** The user's request text, any language or mix. */
  text: string;
  /** Roles of @-referenced entities in the request (strong signals). */
  referenceRoles?: readonly PromptRef["role"][];
  /** The user pasted a product/shop link (strong e-commerce signal — can decide alone). */
  hasProductLink?: boolean;
}

export type StrategyDecision =
  | { kind: "route"; family: StrategyFamily; matched: readonly string[] }
  | { kind: "ask"; candidates: readonly [StrategyFamily, StrategyFamily]; questions: readonly string[] };

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
/** ASCII 关键词按词边界命中（防 "ad" 命中 "made"）；CJK 关键词按子串命中。 */
const hits = (text: string, kw: string): boolean =>
  /^[a-z0-9 '&-]+$/i.test(kw) ? new RegExp(`\\b${esc(kw)}\\b`, "i").test(text) : text.includes(kw);

/**
 * 纯：意图信号 → 策略族决策。
 * 计分：关键词命中各 +1；roleSignals 命中的 @引用各 +2；商品链接给电商 +2。
 * 0 分 → generalCreative 直接路由（不提问）；唯一最高分 → 该族；
 * 两族打平：形状远（DISTANT_PAIRS）→ ask（≤2 问），形状近 → 取 SPECIFICITY 更靠前者。
 */
export function decideStrategy(input: IntentSignals): StrategyDecision {
  const text = input.text.toLowerCase();
  const roles = new Set(input.referenceRoles ?? []);

  const scored = STRATEGY_FAMILIES.filter((f) => f.family !== "generalCreative")
    .map((f) => {
      const matched: string[] = [];
      // 词面去重（复审 P2）："tutorial" 同挂 en 与 ms 表 —— 不去重则一词计两分。
      const kws = new Set([...f.signals.en, ...f.signals.zh, ...f.signals.ms].map((k) => k.toLowerCase()));
      for (const kw of kws) {
        if (hits(text, kw)) matched.push(kw);
      }
      let score = matched.length;
      for (const role of f.roleSignals) {
        if (roles.has(role)) {
          score += 2;
          matched.push(`@${role}`);
        }
      }
      if (f.family === "ecommerce" && input.hasProductLink) {
        score += 2;
        matched.push("product-link");
      }
      return { family: f.family, score, matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || SPECIFICITY.indexOf(a.family) - SPECIFICITY.indexOf(b.family));

  const top = scored[0];
  if (!top) return { kind: "route", family: "generalCreative", matched: [] };

  const second = scored[1];
  if (!second || second.score < top.score) {
    return { kind: "route", family: top.family, matched: top.matched };
  }
  const distant = DISTANT_PAIRS.find(
    ({ pair }) =>
      (pair[0] === top.family && pair[1] === second.family) ||
      (pair[1] === top.family && pair[0] === second.family),
  );
  if (distant) {
    return { kind: "ask", candidates: [top.family, second.family], questions: distant.questions.slice(0, 2) };
  }
  // 形状近的打平：SPECIFICITY 排序已把更具体者排前，直接路由，不打扰用户。
  return { kind: "route", family: top.family, matched: top.matched };
}
