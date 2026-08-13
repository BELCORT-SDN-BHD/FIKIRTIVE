/**
 * #775 —— 意图驱动:商家说的人话 → 能力表上的哪一个动作。
 *
 * 三条纪律,缺一条这个模块就会变成一道暗门:
 *
 *   ① **不预判商家**。一个信号都读不出来时,落到这个形状的**中性**动作,而不是猜他想
 *      干嘛。挂了一条片子却什么都没说 ⇒ 「照着它做一条新的」,绝不是「去改他的片子」——
 *      改动是有破坏性的那一边,永远不做默认。
 *   ② **不静默做错**。信号打平、或者他说的那件事这个形状根本做不到(嘴上说改片子、手上
 *      一条片子都没挂),回一个**问题**,不回一个动作。含糊 ≤2 问。
 *   ③ **不拦截**。这里永远只回「一个动作」或「一个问题」,没有第三种出口 —— 政策是能力表,
 *      不是硬拦截。
 *
 * 打分只数**互不相同**的信号(#485 判官 P2:同一个词在两张语言表里各记一次,会给它双倍
 * 权重)。信号表本身也被测试逐条核:同一个词不许属于两个动作,否则永远打平。
 */
import {
  videoActionsFor,
  type VideoAction,
  type VideoInputShape,
} from "./video-capabilities.js";

export type VideoIntentDecision =
  | { kind: "action"; action: VideoAction; matched: string[] }
  | { kind: "ask"; question: string; options: VideoAction[] };

/**
 * 只给**需要辨认**的动作建格。
 *
 * 没建格的三个(fromText / animateStill / stillToStill)不是被漏了 —— 它们由**形状**唯一
 * 决定:没给东西只能从文字做,给一张图只能动那张图,给首尾两张只能在两张之间走一趟。
 * 给它们建信号格等于让措辞去推翻一个已经确定的事实。
 *
 * 需要辨认的只有「拿到一条片子之后要拿它干嘛」这三选一。
 *
 * 马来语与中文按本地商家真会打出来的写法收,不做词形还原 —— `includes` 命中的是子串,
 * 所以 "ubah" 也会命中 "diubah"、"改" 也会命中 "改成"。
 */
export const VIDEO_INTENT_SIGNALS: Record<string, Record<string, readonly string[]>> = {
  editClip: {
    en: ["change the", "change this", "edit this", "edit the", "fix the", "fix this", "replace the", "remove the", "swap the", "make the shirt", "instead of"],
    zh: ["改成", "修改", "改一下", "改掉", "换掉", "换成", "去掉", "修一下", "把这条片子的"],
    ms: ["ubah", "tukar", "betulkan", "buang"],
  },
  extendClip: {
    en: ["keep it going", "keep going", "carry on", "what happens next", "continue", "longer", "extend", "more seconds", "after that"],
    zh: ["接下去", "接着", "延长", "再长一点", "后来呢", "继续"],
    ms: ["sambung", "panjangkan", "teruskan", "lagi sikit"],
  },
  guideFromClip: {
    en: ["like this", "same vibe", "same style", "same feel", "similar to this", "in the style of", "another one like"],
    zh: ["照着", "类似这条", "一样的感觉", "同样的风格", "参考这条", "仿这条"],
    ms: ["macam ni", "macam ini", "seperti ini", "gaya sama"],
  },
};

/** 这个形状下,商家什么都没说时该落到哪一档。破坏性最小的那一个。 */
const NEUTRAL: Record<string, VideoAction> = {
  fromText: "fromText",
  animateStill: "animateStill",
  stillToStill: "stillToStill",
  // 拿到片子却零信号 ⇒ 照着它做一条新的。改他的片子不做默认。
  guideFromClip: "guideFromClip",
};

const QUESTIONS: Record<VideoAction, string> = {
  fromText: "Should I make you a brand-new clip?",
  animateStill: "Should I bring that picture to life?",
  stillToStill: "Should I move from the first picture to the second?",
  editClip: "Do you want me to change that clip you already have?",
  extendClip: "Do you want me to carry that clip on from where it ends?",
  guideFromClip: "Do you want a brand-new clip that follows the feel of that one?",
};

/** 一个动作在这段文字里命中了哪些**互不相同**的信号。 */
function matchedSignals(action: VideoAction, text: string): string[] {
  const langs = VIDEO_INTENT_SIGNALS[action];
  if (!langs) return [];
  const hit = new Set<string>();
  for (const phrases of Object.values(langs)) {
    for (const p of phrases) if (text.includes(p)) hit.add(p);
  }
  return [...hit];
}

export function decideVideoAction(input: { text: string; shape: VideoInputShape }): VideoIntentDecision {
  const text = input.text.toLowerCase();
  const available = videoActionsFor(input.shape);

  // ② 先看**错配**:他说的那件事,这个形状根本做不到。
  // 这一步排在打分前面,因为「说要改片子却没挂片子」如果先去打分,会得到一个语法上合法、
  // 语义上完全不是他要的动作(比如 fromText),而商家永远不会知道自己被换了个动作。
  const wanted = Object.keys(VIDEO_INTENT_SIGNALS).filter(
    (a) => !available.includes(a as VideoAction) && matchedSignals(a as VideoAction, text).length > 0,
  ) as VideoAction[];
  if (wanted.length > 0) {
    const options = wanted.slice(0, 2);
    return {
      kind: "ask",
      question:
        options.length === 1
          ? `${QUESTIONS[options[0]!]} I don't have that clip in front of me — attach it and I'll go ahead.`
          : "Which of those did you mean? I don't have that clip in front of me — attach it and I'll go ahead.",
      options,
    };
  }

  // 打分:只在这个形状真做得到的动作里选。
  const scored = available
    .map((action) => ({ action, matched: matchedSignals(action, text) }))
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);

  // ① 零信号 ⇒ 这个形状的中性动作。不猜。
  if (scored.length === 0) {
    const fallback = available.map((a) => NEUTRAL[a]).find((a): a is VideoAction => !!a) ?? available[0]!;
    return { kind: "action", action: fallback, matched: [] };
  }

  // ② 打平 ⇒ 问一句。选项最多两个。
  const top = scored[0]!;
  const tied = scored.filter((s) => s.matched.length === top.matched.length);
  if (tied.length > 1) {
    const options = tied.slice(0, 2).map((s) => s.action);
    return {
      kind: "ask",
      question: `Two different things there — ${QUESTIONS[options[0]!]} Or ${QUESTIONS[options[1]!].charAt(0).toLowerCase()}${QUESTIONS[options[1]!].slice(1)}`,
      options,
    };
  }

  return { kind: "action", action: top.action, matched: top.matched };
}
