/**
 * creation-templates.ts —— 起手模板的**唯一出处**,画布空态与 Library 快产车间共用这一份。
 *
 * 为什么要有这一排:一块空板加一个「Describe what to make…」的输入框,对一个刚开门的
 * 商家来说是一道作文题。他知道自己想要什么(一张能发的产品图),不知道该怎么把它说成
 * 一句话。模板给的正是那句话本身 —— 点一下,句子就落进输入框,他在上面改自己的字。
 *
 * 三条纪律:
 *   ① **点击只预填,不发送**。发送是花钱的那一下,那一下必须由商家自己按。所以点模板
 *      零 cr、零请求,句子还能改 —— 「点一下就开跑」是替商家做决定,也是替他花钱。
 *   ② **句子是成句,不是关键词**。"Product shot" 是标签,填进输入框的是
 *      「Clean product shot of my candle on a neutral table, soft daylight」——
 *      关键词填进去等于把作文题换了个位置,商家照样得自己写。
 *   ③ **只有这一处**。两面各写一份,措辞立刻分家:同一个「Product shot」在画布上说一句、
 *      在仓库里说另一句,商家读到的是两个产品。
 *
 * 缩略图用的是仓库里已经有的那四张样张(`FIXTURE_ART_SOURCES`)—— 不新增一个二进制资产,
 * 也不去编一张「我们没有的图」。
 */

import { FIXTURE_ART_SOURCES } from "@/components/library/library-fixture";

export type CreationTemplate = {
  id: string;
  /** 商家读到的短名 —— 卡上就这一个词组。 */
  name: string;
  /** 点下去落进输入框的那一整句。 */
  prompt: string;
  /** 卡上那一小张。 */
  thumb: string;
};

export const CREATION_TEMPLATES: readonly CreationTemplate[] = [
  {
    id: "product-shot",
    name: "Product shot",
    prompt: "Clean product shot of my candle on a neutral table, soft daylight",
    thumb: FIXTURE_ART_SOURCES[0]!,
  },
  {
    id: "flat-lay",
    name: "Flat-lay",
    prompt: "Flat-lay of my candle with dried flowers on a linen cloth, shot from above",
    thumb: FIXTURE_ART_SOURCES[1]!,
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    prompt: "My candle lit on a side table in a living room, warm evening light",
    thumb: FIXTURE_ART_SOURCES[2]!,
  },
  {
    id: "festive-promo",
    name: "Festive promo",
    prompt: "Festive Raya picture of my candle with plain space at the top for a price",
    thumb: FIXTURE_ART_SOURCES[3]!,
  },
];

/** 一个模板的成句 prompt。找不到就返回空串 —— 空串填不进输入框,不会悄悄填错一句。 */
export function creationTemplatePrompt(id: string): string {
  return CREATION_TEMPLATES.find((template) => template.id === id)?.prompt ?? "";
}
