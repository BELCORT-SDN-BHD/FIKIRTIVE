/**
 * honest-deviation.ts —— 「做不到的那件事」该怎么说,一句,一份。
 *
 * Founder 2026-08-26 深夜第 7 件,取形 Cofounder 对话内语法⑥:助手做不到某件事的时候不
 * 沉默、不含糊、也不写一段免责声明 —— 它一句话说清**哪件事没做成**、以及**它改做了什么**,
 * 就贴在产物旁边。
 *
 * 为什么必须收成一个函数:这句话最容易退化的地方不是措辞,是**只说一半**。
 * 「Video is not switched on yet.」——商家读完不知道刚才那一下到底出了什么;
 * 「I made a still frame.」——商家不知道这是不是他要的东西。两半必须一起出现,而「一起
 * 出现」这件事写成一个函数就再也丢不掉了。
 *
 * 措辞纪律(与全站商家文案同一条):不许出现工程词,不许出现供应商或模型名,主语是 I,
 * 不是「the system」。
 */

/**
 * 「X 还没接上,所以我改做了 Y。」
 *
 * @param missing 没做成的那件事,商家的词(如 "A playable video")。
 * @param instead 改做了什么,以动词起(如 "made a still frame from it")。
 */
export function honestDeviationLine(missing: string, instead: string): string {
  return `${missing} is not switched on yet, so I ${instead} instead.`;
}
