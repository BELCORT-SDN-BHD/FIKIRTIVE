/**
 * storyboard-shot —— 「这一镜直接出片吗」的**唯一判据**(creation §5 :172⑤)。
 *
 * 判据只有一句:**这一镜 @ 到了至少一个演员(CHARACTER 元素)**。@ 到演员的镜头走
 * 「演员参考照 + 商品照各作一张 reference_image、纯文生视频」那条正路(PR #1273),
 * 首帧那一步整个不存在 —— 不铸卡、不报价、不收钱,那段首帧文字也因此不必写。
 *
 * 为什么住在 core:同一句话有两个消费方,分了家就会出现一种既不直接出片、又没有首帧
 * 文字的镜头合法落库,而它在闸① 会把**整张卡**的首帧一起拒掉。
 *   • `packages/otto/src/skills/propose-storyboard.helpers.ts` 的
 *     `shotsMissingFirstFramePrompt` —— Otto 交稿那一刻判「这一镜要不要写首帧文字」。
 *   • `apps/web/lib/storyboard-card.ts` 的 `shotsDirectToVideo` —— 铸卡侧与卡面判
 *     「这一镜要不要铸首帧子卡」。
 * 判官第 2 轮 P2-⑤:这两处此前各写一遍同一句话。现在两处都 import 这一个函数。
 *
 * 纯函数、无 DB、无 node 内建(卡面是 "use client",所以它只能走 `@fikirtive/core/storyboard-shot`
 * 这个子路径 —— core 的桶文件会把 node:crypto 拖进浏览器包)。
 *
 * 归属由调用方给的 `castEntityIds` 定,而那一份只能来自服务端按 ownerId 读出来的元素
 * (`Entity.type === "CHARACTER"`)—— 别家店的演员 id 根本不会出现在里面,所以跨租户的
 * id 在这里数出 0,那一镜照旧走首帧那条路。
 */

/** 这一镜**直接出片**吗(@ 到了至少一个演员)。 */
export function shotGoesDirectToVideo(
  shot: { entityIds?: string[] },
  castEntityIds: ReadonlySet<string>,
): boolean {
  return (shot.entityIds ?? []).some((id) => castEntityIds.has(id));
}
