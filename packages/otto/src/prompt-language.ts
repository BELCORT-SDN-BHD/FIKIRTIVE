/**
 * 引擎 prompt 语言的单一权威 + 非阻断的语言建议（#437 R4）。
 *
 * 语言是「质量优选」，不是「正确性属性」——所以它不属于 schema 闸门。R1–R3 三轮
 * 试过把「主体文字系统」做成硬性语言门，三轮都不成立（日文汉字/假名计数、平票、
 * 数字前缀与 emoji 绕过），且第三轮实证它会拒掉 "a product photo 辣椒酱" 这类
 * 合法商家输入。R4 起：任何输入都不会因文字系统被拒；不匹配只回一句
 * languageAdvice（永不抛、永不拦），执法搬到写作端 —— skill description 与
 * Otto instructions 明写语言要求。
 *
 * 物理定义放这个叶子模块（只依赖 prompt-vocab），是因为 prompt-skills.ts 会 import
 * 两个 skill 模块，而 skill 的 description 在模块顶层就要读语言：定义留在
 * prompt-skills.ts 会形成 import 环并在模块初始化期抛 TDZ。对外权威表面仍是
 * prompt-skills.ts（原样 re-export），既有 import 点一个不动。
 *
 * 改一条 language 需要新的实测证据在先，且同一个 PR 里同步装配器与 description ——
 * 不许静默换语言。
 */
import type { ModelFamily } from "@fikirtive/core";
import { majorityScript } from "./skills/prompt-vocab.js";

export type PromptLanguage = "zh" | "en";

/**
 * Per-engine prompt LANGUAGE (Blueprint v2.13 relocated this out of the constitution:
 * prompt language is decided per engine by its prompt-authority module — this table —
 * following measured best practice).
 *
 * - seedance → "zh": the video engine measurably performs best with a CHINESE prompt
 *   body; industry camera/framing terms stay in English.
 * - seedream → "en": current measurements show no Chinese advantage for the image
 *   engine; prompts stay English (front-loaded token weighting).
 */
export const PROMPT_LANGUAGES: ReadonlyArray<{ family: ModelFamily; language: PromptLanguage }> = [
  { family: "seedream", language: "en" },
  { family: "seedance", language: "zh" },
];

/** The tuned prompt language for a family, or undefined when it has no dedicated prompt skill. */
export function promptLanguageFor(family: ModelFamily | undefined): PromptLanguage | undefined {
  return PROMPT_LANGUAGES.find((p) => p.family === family)?.language;
}

/** 大写语言名 —— 写进 skill description，模型一眼看到（description 从此表读，不另写字面）。 */
export const LANGUAGE_LABEL: Readonly<Record<PromptLanguage, string>> = { zh: "CHINESE", en: "ENGLISH" };

/** 一行理由 —— description 里跟在语言要求后面（为什么这么写，不解释内部机制）。 */
export const LANGUAGE_REASON: Readonly<Record<PromptLanguage, string>> = {
  zh: "measured: this engine renders a Chinese prompt body more faithfully",
  en: "measured: this engine renders an English prompt body more faithfully",
};

/** 非阻断建议文案（可能进入用户可见回复 —— 不出现供应商/模型商号）。 */
export const LANGUAGE_ADVICE: Readonly<Record<PromptLanguage, string>> = {
  zh:
    "the video engine performs best with a Chinese prompt body; consider rewriting the subject/action " +
    "in Chinese (industry camera and framing terms may stay in English)",
  en:
    "the image engine performs best with an English prompt body; consider rewriting the subject and " +
    "scene wording in English (text to be rendered inside the image may stay in any language)",
};

/**
 * 纯：自由文本的主体文字系统与引擎偏好不符 → 一句建议；相符或整段无字母 → undefined。
 * 永不抛、永不拦 —— 这是提示，不是闸门。判定用的 majorityScript 是启发式，判错的代价
 * 只是多一句或少一句建议。
 */
export function languageAdvice(
  language: PromptLanguage,
  texts: ReadonlyArray<string | undefined>,
): string | undefined {
  const joined = texts.filter((t): t is string => !!t && t.trim().length > 0).join(" ");
  if (joined.trim().length === 0) return undefined;
  const want = language === "zh" ? "cjk" : "latin";
  return majorityScript(joined) === want ? undefined : LANGUAGE_ADVICE[language];
}
