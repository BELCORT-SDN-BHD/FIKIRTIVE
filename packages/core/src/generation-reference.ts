/**
 * generation-reference —— 「这一件素材,能不能当这一轮的参考」的**唯一**判据。
 *
 * ── 为什么要有这个模块(Codex 只读 E2E QA-CRE-FE9-013,2026-09-04)────────────
 *
 * 同一条规矩此前被抄成了六份 where 子句(composer 校验器、Otto 视觉、付费前守卫、
 * worker 的首帧/末帧/参考片/编辑底图),而且六份都多写了一格 `projectId`。于是:
 * 商家在画布 B 的「Choose from Library」里选中画布 A 生成的那张蓝杯子(选单读的是
 * **全店**历史 —— Founder 2026-08-30 裁决 Library 是 owner 级的),composer 上出现
 * `Image ref`,服务端却把它悄悄过滤掉 —— USER 消息落库时 `sourceGenerationIds: []`,
 * Otto 看不见杯子、确认卡不列杯子、GenJob 不带杯子,而商家仍然为这张「没有他指定
 * 产品」的素材付了钱。
 *
 * 所以判据在这里定,一次:
 *
 *   **引用范围 = 同一 owner(租户)内的任意画布。**
 *   画布(projectId)是这件素材的**出处**,不是权限边界。
 *
 * 租户边界一格没松:`ownerId` 永远只能来自已认证的 server principal(`requireOwner()`
 * 或 `job.ownerId`),绝不从客户端收。软删的读不出来,扩展名不对的读不出来 ——
 * 少掉的只有那一格「必须是同一块画布」。
 *
 * 本模块不查库、不读存储、不定价:它只产出一份 where 片段,所以六个读者结构上不可能
 * 再各写一套。
 */

/** 能当**图片参考**(编辑底图 / i2v 首帧 / 元素条件图)的扩展名。 */
export const REFERENCE_IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"] as const;

/** 能当**整段视频参考**的扩展名。 */
export const REFERENCE_VIDEO_EXTS = ["mp4", "mov", "webm"] as const;

/** 一份 Prisma where 片段:这一租户名下、活着的、扩展名对得上的 Generation。 */
export type GenerationReferenceScope = {
  ownerId: string;
  deletedAt: null;
  asset: { ext: { in: string[] } };
};

/**
 * 「这件素材属于这个租户、还活着、是这一档参考认得的类型」——
 * 调用方自己再补 `id` / `id: { in: [...] }`,别的一格都不要加。
 *
 * 特别是:**不要再加 `projectId`**。加了就回到 QA-CRE-FE9-013 那一天。
 */
export function generationReferenceScope(
  ownerId: string,
  exts: readonly string[],
): GenerationReferenceScope {
  return { ownerId, deletedAt: null, asset: { ext: { in: [...exts] } } };
}
