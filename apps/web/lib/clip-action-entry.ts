/**
 * #922 缺口 A —— 「改这条片子 / 把这条片子接下去」的**商家自己那一面**。
 *
 * #775(PR #921)把这两个动作的措辞层与批准前的形状做完了,但今天要用它们只有一条路:
 * 在对话框里挂一条 2–6 秒的片子,再用自己的话告诉 Otto 要改什么。素材库/画布上一个可以
 * 点的入口都没有 —— 按 Founder 双面铁律(每个能力 = 商家自己可操作的面 + Otto 协助面),
 * 那是一条缺口。
 *
 * 这个模块只放**两面共用的纯东西**:动作的名字、屏幕上的字、商家措辞的长度闸。
 * 服务端那一半在 `clip-actions.ts`(铸卡),界面那一半在 `components/asset/ClipActions.tsx`。
 * 分开是因为 `"use server"` 文件只导得出 async 函数 —— 常量与纯函数留在那里会被 Next
 * 当成运行时绑定处理(#741 的构建事故就是这么来的)。
 *
 * 钱路一个字节都不碰:这一整条入口到「确认」为止都是 $0,扣费仍然只发生在既有的
 * `coworkGenerate(cardId)` 上,幂等域仍然是 `cowork:<cardId>`。
 */

/** 锚在商家自己那条片子上的两个动作,在界面这一侧的名字。 */
export type ClipEntryAction = "edit" | "extend";

/**
 * 屏幕上的字。English sentence case,白标 —— 一处供应商名字都没有。
 *
 * `cta` 是入口键;`heading` 是展开后那一小块的抬头;`placeholder` 是那个文本框里的例子。
 * 例子写成「续接在官方句式后面读得通」的形状(官方句式是 "Strictly edit the clip, and
 * modify …" / "Extend the clip forward, …"),因为商家打的这句话就是接在那后面的那一段。
 */
export const CLIP_ENTRY_COPY: Record<ClipEntryAction, {
  cta: string;
  heading: string;
  placeholder: string;
  /** 铸卡后那一行确认语的前半句 —— 与分镜卡的确认语同一个形状。 */
  confirmLead: string;
}> = {
  edit: {
    cta: "Edit this clip",
    heading: "What should change?",
    placeholder: "the shirt to red",
    confirmLead: "Edit this clip",
  },
  extend: {
    cta: "Continue this clip",
    heading: "What happens next?",
    placeholder: "she walks out of frame",
    confirmLead: "Continue this clip",
  },
};

/** 商家措辞的长度闸。上限与卡上冻结的提示词同量级,不是一个新发明的数。 */
export const CLIP_ENTRY_WORDING_MAX = 600;

/**
 * 商家打的那句话 → 送进装配器的那一段。
 *
 * **一个字节都不动**(判官 r1 P2-1)。这里只**判**,不改:空不空、长不长。判的时候看的是
 * 去掉首尾空白之后的样子(首尾空白不是内容,不该让「只打了几个空格」通过、也不该让长度
 * 因为空格而超限),但**返回的是原文**。
 *
 * 上一版在这里做了两件改写:去首尾空白、删句末句号。删句号是为了避开装配器补的那个点
 * 造成的 "…red..",而代价是商家看到的与真发生的分了家 —— #917 一整票为的就是这件事:
 * 卡上冻结的那一段是批准后**原样**送到引擎的同一份,机器在这里动一个字,证词就不成立了。
 * 衔接问题现在归装配层(`anchoredClipLines`):它只在句号/空格**还不在那里**时才补一个,
 * 从不删、从不改。
 */
export function clipEntrySegment(raw: string): { segment: string } | { error: string } {
  const measured = raw.trim();
  if (measured.length === 0) return { error: "Tell us what to change first." };
  if (measured.length > CLIP_ENTRY_WORDING_MAX) {
    return { error: `Keep it under ${CLIP_ENTRY_WORDING_MAX} characters.` };
  }
  return { segment: raw };
}
