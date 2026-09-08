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

// ---------------------------------------------------------------------------
// FSE-001 —— 供应商在**建任务之前**就查参考图的宽度
// ---------------------------------------------------------------------------

/**
 * 一张图能当**视频参考**的最小宽度(像素)。
 *
 * 来源是一手实测,不是文档:2026-09-08 第二场探针把一张 275×183 的原件当
 * `role:"reference_image"` 直喂视频端,供应商在**建任务前**就弹回
 * `expected the width to be at least 300px`(零花费、任务未创建);同一张图放大到
 * 550×366 之后同一趟请求 succeeded。证据
 * `docs/audits/fullstack-staging-2026-09-08/probe-fse-001-two-references/probe-real-photo-2026-09-08.md`。
 *
 * 为什么我方也要查一遍:那道闸在供应商那边确实不花钱,但它发生在我们**预扣之后** ——
 * 预扣、失败、退款走一遍,商家读到的只是一句「没成功」,而真正能修好它的动作
 * (换一张大一点的图)一个字都没说。查在预扣之前 ⇒ $0、零 GenJob、账本零新增行,
 * 并且说出那个真能修好它的动作。
 *
 * **不自动放大**:放大是像素级再处理,而规格 §5 2026-08-30「像素完整性铁律」把一切
 * 未实测的像素再处理判为「未验先禁」。放大留作登记项。
 */
export const MIN_REFERENCE_IMAGE_WIDTH = 300;

/**
 * 这张图的宽度撑不撑得起一次视频参考。
 *
 * **不知道就放行**(`null` / 非有限数 ⇒ false)。宽度只有 `UPLOAD` 资产才由 ingest 的
 * ffprobe 填得上(`apps/worker/src/jobs/ingest.ts` 只给 UPLOAD 派 ingest),本站生成的
 * 资产那一格一律是空的 —— 把「不知道」当成「太小」会拒掉每一张本站生成的商品图,而那
 * 正是这条正路最主要的输入。同一条降级纪律在参考视频时长那一格已经用着
 * (`apps/worker/src/jobs/gen.ts` 的 `refDur != null && …`)。
 */
export function referenceImageTooSmall(width: number | null | undefined): boolean {
  return typeof width === "number" && Number.isFinite(width) && width < MIN_REFERENCE_IMAGE_WIDTH;
}
