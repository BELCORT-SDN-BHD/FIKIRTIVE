/**
 * 机械检查注册表（`docs/specs/otto-engine.md` §7.3 给 Creation 批 III 的三件接口之一）。
 *
 * 一个检查 = **一个纯函数**：产物 → 通过/不通过 + 理由。零成本、零模型、确定性。
 * runner 不认得任何业务，它只按题目 front-matter 里的名字来这张表取函数。
 *
 * 名字可以带参数：`名字:参数1,参数2`。参数就是题目的那一份配置，
 * 所以 front-matter 的五个字段（id/line/prompt/checks/rubric）一个都不用加。
 *
 * 要加一个检查：在下面的 `CHECKS` 里加一行；别在这里抄任何一份别处已有的词表
 * （镜头术语表的唯一真相源是 `knowledge/craft/seedance.md`，见 `./glossary.ts`）。
 */
import type { CheckResult } from "../core.js";
import { shotGlossary } from "./glossary.js";

export type CheckFn = (artifact: string, args: string[]) => { pass: boolean; reason: string };

const has = (artifact: string, term: string) => artifact.toLowerCase().includes(term.toLowerCase());

/**
 * 禁词专用：**按词边界**匹配，不是裸子串。
 *
 * 裸子串会冤枉人：`forbids:extend` 会被 “the extended cut” 命中，`forbids:Inbox` 会被
 * “inboxes” 命中——那不是编造页面，却照样扣一分。禁词判的是「说没说出这个词」，
 * 所以词的左右两边不许再接字母、数字或下划线。词组（`already researched`）同理，
 * 只看整段词组的两端。
 */
const hasWord = (artifact: string, term: string): boolean => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(artifact);
};

export const CHECKS: Record<string, CheckFn> = {
  /** 逐条都要出现。`mentions-all:seedreamPrompt,propose` */
  "mentions-all": (artifact, args) => {
    const missing = args.filter((t) => !has(artifact, t));
    return missing.length === 0
      ? { pass: true, reason: `都提到了：${args.join(", ")}` }
      : { pass: false, reason: `没提到：${missing.join(", ")}` };
  },

  /** 至少出现一条。`mentions-any:actor library,Xinyi` */
  "mentions-any": (artifact, args) => {
    const hit = args.filter((t) => has(artifact, t));
    return hit.length > 0
      ? { pass: true, reason: `命中：${hit.join(", ")}` }
      : { pass: false, reason: `一条都没提到：${args.join(", ")}` };
  },

  /** 一条都不许出现，**按词边界**判（`extended` 不算命中 `extend`）。`forbids:reference,Campaigns` */
  forbids: (artifact, args) => {
    const hit = args.filter((t) => hasWord(artifact, t));
    return hit.length === 0
      ? { pass: true, reason: `禁词零命中：${args.join(", ")}` }
      : { pass: false, reason: `出现了禁词：${hit.join(", ")}` };
  },

  /** 字数上限（按空白切词）。`max-words:220` */
  "max-words": (artifact, args) => {
    const cap = Number(args[0]);
    if (!Number.isFinite(cap) || cap <= 0) return { pass: false, reason: `max-words 的参数不是正数：${args[0]}` };
    const words = artifact.trim().split(/\s+/u).filter(Boolean).length;
    return words <= cap
      ? { pass: true, reason: `${words} 词 ≤ ${cap}` }
      : { pass: false, reason: `${words} 词 > ${cap}` };
  },

  /**
   * 镜头语言取自术语表：至少一个镜头运动 + 一个景别，全部来自
   * `knowledge/craft/seedance.md`（不在本文件里抄词）。
   */
  "uses-shot-vocabulary": (artifact) => {
    const g = shotGlossary();
    const moves = (g["camera-move"] ?? []).filter((t) => has(artifact, t));
    const framings = (g["shot-framing"] ?? []).filter((t) => has(artifact, t));
    if (moves.length > 0 && framings.length > 0) {
      return { pass: true, reason: `镜头运动 ${moves.join("/")}；景别 ${framings.join("/")}` };
    }
    return {
      pass: false,
      reason: `术语表里的镜头运动命中 ${moves.length} 个、景别命中 ${framings.length} 个（各需 ≥1）`,
    };
  },
};

/** 纯：跑一条 `名字[:参数]`。名字不在表里＝当场炸（拼错题目不该静默变成满分）。 */
export function runCheck(spec: string, artifact: string): CheckResult {
  const i = spec.indexOf(":");
  const name = i < 0 ? spec : spec.slice(0, i);
  const args = i < 0 ? [] : spec.slice(i + 1).split(",").map((s) => s.trim()).filter(Boolean);
  const fn = CHECKS[name];
  if (!fn) throw new Error(`checks 注册表里没有 "${name}"（可用：${Object.keys(CHECKS).join(", ")}）`);
  const { pass, reason } = fn(artifact, args);
  return { name: spec, pass, reason };
}
