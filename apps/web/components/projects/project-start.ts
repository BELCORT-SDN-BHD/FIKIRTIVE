/**
 * project-start.ts —— 「建一个项目」这件事的**产品判断**,一个 React 节点都没有。
 *
 * 病灶(Founder 2026-08-26 亲验):按下 Create project 弹出来的是一张七格表单
 * (标题 / 目标 / 品牌语气 / 受众 / 语言 / 默认比例 / 上下文)。Founder 原话:
 * 「就只是 create 而已」。一个刚开门的商家在这里被要求先把自己的品牌说清楚,
 * 而他此刻想做的只有一件事 —— 开工。
 *
 * 换过来的形状照 Stitch 的开局:Otto 问一句「What are we making?」,商家说一句人话,
 * 项目就建好了。所以这个文件里只剩两条判断:
 *   ① **这句话够不够开工**(`projectStartQuestion`)—— 不够就问**一样**,而且可以跳过。
 *      含糊词族与 Library 快产车间共用同一份(`isVagueCreationRequest`):两处各写一份
 *      正则,同一句「make something nice」迟早在一面被拦、在另一面直接开跑。
 *   ② **项目叫什么**(`projectNameFromSentence`)—— 从他那句话派生一个短名。名字不问,
 *      因为名字改得起;问一句「项目叫什么」换来的多半是「Untitled」。
 *
 * 品牌语气、受众、语言、默认比例一个都不问:它们要么 Otto 侧有默认值,要么以后在项目里
 * 改。开工那一刻问这些,等于把商家的第一句话换成一张表。
 */

import { isVagueCreationRequest } from "@/components/library/library-fixture";

/** Otto 开局那一句。对话框标题就是它 —— 屏幕上不再有第二句寒暄。 */
export const PROJECT_START_GREETING = "What are we making?";

/** 输入框里那句提示。它给的是**一句话的样子**,不是一道作文题。 */
export const PROJECT_START_PLACEHOLDER = "A Raya gift set launch for Instagram";

export type ProjectStartQuestion = {
  header: string;
  question: string;
  help: string;
  options: Array<{ label: string; description: string }>;
};

/**
 * 这句话够不够直接开一个项目。
 *
 * 判词两条,都机械可判(与 Quick create 同一条纪律,只是这里问的是**项目**是干什么的,
 * 不是这一张图怎么拍):
 *   ① 实词少于三个 —— 「a launch」这种,缺的是内容不是措辞;
 *   ② 命中含糊词族 —— 「something / nice / surprise me …」,句子再长也没说要做什么。
 * 两条都不中就直接建:商家已经说清楚了,再问一句就是拦路。
 *
 * 只问**一样**,而且可以跳过:建项目这一步一分钱都不花,问第二句就纯粹是拖时间。
 */
export function projectStartQuestion(sentence: string): ProjectStartQuestion | null {
  const words = sentence.trim().split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  if (words.length >= 3 && !isVagueCreationRequest(sentence)) return null;
  return {
    header: "One thing first",
    question: "What is this project for?",
    help: "Pick one so the project opens with the right start. You can skip this and change your mind on the canvas.",
    options: [
      { label: "A launch", description: "A new product or a new range going out" },
      { label: "Everyday posts", description: "The regular posting you keep up week to week" },
      { label: "A promotion", description: "One offer, one festive push, one event" },
    ],
  };
}

/**
 * 「Create a Raya gift set launch for Instagram」→「Raya gift set launch for」。
 *
 * 只做三件事:去掉开头那一串客套与祈使动词、取前五个词、首字母立起来。太长的截断 ——
 * 项目名是列表里那一行,不是一整段。改得起,所以不问;派生得出,所以不留空。
 */
const NAME_LEAD_FILLER = /^(?:please|can you|could you|i want to|i want|i need to|i need|help me|let'?s|make|create|build|do|start|design|generate|a|an|the|some|me|us)\s+/i;

export function projectNameFromSentence(sentence: string): string {
  let cleaned = sentence.trim().replace(/\s+/g, " ");
  // 一层一层剥:「Create a Raya…」要剥两次(`create` 与 `a`)才见到真正的那几个词。
  for (let round = 0; round < 4; round += 1) {
    const next = cleaned.replace(NAME_LEAD_FILLER, "");
    if (next === cleaned) break;
    cleaned = next;
  }
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5).join(" ");
  const short = words.length > 40 ? `${words.slice(0, 40).trim()}…` : words;
  if (!short) return "New project";
  return short.charAt(0).toUpperCase() + short.slice(1);
}
