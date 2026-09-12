/**
 * storyboard-shot —— 「这一镜直接出片吗」的**唯一判据**(creation §5 FSE-208,S5 批量裁决
 * 2026-09-12 #1358)。
 *
 * 判据现在只有一句:**永远是**。2026-09-08 Founder 那句「合成 first frame 的 idea 可以移除了,
 * 没有必要」原先只落地到「@ 到演员(CHARACTER 元素)的镜头」(PR #1273/#1277),纯商品镜头仍
 * 走「先出一张付费首帧图,再拿它做 i2v」的两步路。2026-09-12 S5 批量裁决把那句话的范围定成
 * **所有镜头**:分镜从此不再为任何镜头合成首帧 —— 每一镜都走「@ 到的元素(演员/商品)各作一张
 * reference_image、纯文生视频」那条正路,首帧那一步对每一镜都不存在。
 *
 * 为什么这个判词还留着(没有直接内联成字面 `true`)、还住在 core:同一句话有两个消费方,
 * 单一源头能让「卡面判『这一镜要不要铸首帧子卡』」与「铸卡侧判同一件事」不可能分家 ——
 *   • `apps/web/lib/storyboard-card.ts` 的 `shotsDirectToVideo` —— 铸卡侧与卡面判
 *     「这一镜要不要铸首帧子卡」(FSE-208 之后:恒为否)。
 *   • `apps/web/lib/storyboard-gate1-actions.ts` 的 `directToVideoShotIds` —— 闸②
 *     铸视频子卡时判「这一镜的视频要不要带上元素参考(reference_image)」。
 *
 * 纯函数、无 DB、无 node 内建(卡面是 "use client",所以它只能走 `@fikirtive/core/storyboard-shot`
 * 这个子路径 —— core 的桶文件会把 node:crypto 拖进浏览器包)。
 *
 * `shot` / `castEntityIds` 两个参数留着不删:调用方(锁内按 ownerId 读出来的元素)不必跟着
 * 改形状,而这个判词的落点仍然只有这一处 —— 判词日后若再变(比如按镜头形状细分),两个入参
 * 已经摆在这里,不必再动一遍全部调用点。
 */

/** 这一镜**直接出片**吗。FSE-208(2026-09-12 S5 批量裁决 #1358):所有镜头都直接出片,
 *  首帧合成对任何镜头都不再存在 —— 参数保留只是为了单一判词的落点不必再挪。 */
export function shotGoesDirectToVideo(
  _shot: { entityIds?: string[] },
  _castEntityIds: ReadonlySet<string>,
): boolean {
  return true;
}
