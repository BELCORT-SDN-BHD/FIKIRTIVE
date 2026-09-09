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
// FSE-001 —— 供应商在**建任务之前**就查参考图的尺寸
// ---------------------------------------------------------------------------

/**
 * 一张图能当**视频参考**的最小边长(像素)——**宽与高各要过**。
 *
 * 来源是一手实测,不是文档。两笔:
 *   · 2026-09-08 第二场探针把一张 275×183 的原件当 `role:"reference_image"` 直喂视频端,
 *     供应商在**建任务前**弹回 `expected the width to be at least 300px`(零花费、任务未创建);
 *     放大到 550×366 之后同一趟请求 succeeded。
 *   · 2026-09-09 第三场探针把一张 150×100 放大到 **300×200** 再投,同样在建任务前被弹回,
 *     错误码逐字:`expected the height to be at least 300px, but received a 300x200px image
 *     instead`;同一张源图放大到 450×300 就 succeeded。
 *
 * 第二笔证伪了第一版实现的假设(「300 是宽度下限」)。**高度是同一道闸**,所以判据是
 * `min(width, height) >= 300`——一张 400×200 的图在旧口径下过我们的闸、到供应商才被弹,
 * 而那时钱已经预扣了。证据 `docs/audits/fullstack-staging-2026-09-08/probe-fse-001-two-references/`
 * 与探针第三场报告。
 */
export const MIN_REFERENCE_IMAGE_SIDE = 300;

/**
 * **能自动放大**的最小边长(像素)。短边比这个还小 ⇒ 诚实拒绝,不放大。
 *
 * 依据是同一场探针的两个实测点:150×100 的真实低清网图 3× 放大后出片完全可辨;200×200 的
 * AI 商品照 2× 放大后同样完全可辨。**100 以下没有实证**——那需要 4× 以上的放大,而放大倍数
 * 越高模型拿到的有效信息越少。所以这条线是保守画的,不是测出来的:宁可拒绝一张我们没验过的
 * 图,也不要替商家花一次可能出废片的钱。
 */
export const MIN_UPSCALABLE_REFERENCE_SIDE = 100;

/**
 * 这一张参考图该怎么办:原样送、放大几倍再送、还是花钱前就拒。
 *
 * 四个答案,`unknown` 单独一格,因为它**不是**「太小」:
 *   · `asIs`     —— 短边已经过 300,一个字节都不动;
 *   · `upscale`  —— 短边在 [100, 300),按 `ceil(300 / 短边)` 的**整数倍**同乘宽高
 *                   (不裁剪、不改构图、不改长宽比),放大到刚好过门的最小倍数;
 *   · `refuse`   —— 短边 < 100,拒绝;
 *   · `unknown`  —— 宽或高读不出来。
 *
 * ── `unknown` 为什么不能当成 `refuse`(这一格是钱路)───────────────────────────────
 * 宽高只有 `UPLOAD` 资产才由 ingest 的 ffprobe 填得上(`apps/worker/src/jobs/ingest.ts` 只给
 * UPLOAD 派 ingest);**本站生成的资产那两格一律是 null**(`gen.ts` 出图时不写宽高)。把
 * 「不知道」读成「太小」会拒掉每一张本站生成的商品图,而那正是这条正路最主要的输入。
 * 所以判据只说「读不出来」,由调用方各自决定怎么处理:
 *   · 铸卡侧(付费前)—— 放行,与这条修改之前逐字相同;
 *   · worker 侧 —— 它手里有真字节,量一遍就知道,`unknown` 在那里根本走不到决策。
 *
 * 纯函数:不查库、不读存储、不定价、不碰像素。
 */
export type ReferenceUpscalePlan =
  | { action: "asIs" }
  | { action: "upscale"; factor: number; width: number; height: number }
  | { action: "refuse" }
  | { action: "unknown" };

export function referenceUpscalePlan(size: {
  width?: number | null;
  height?: number | null;
}): ReferenceUpscalePlan {
  const { width, height } = size;
  if (!isPositiveSize(width) || !isPositiveSize(height)) return { action: "unknown" };
  const shortest = Math.min(width, height);
  if (shortest >= MIN_REFERENCE_IMAGE_SIDE) return { action: "asIs" };
  if (shortest < MIN_UPSCALABLE_REFERENCE_SIDE) return { action: "refuse" };
  const factor = Math.ceil(MIN_REFERENCE_IMAGE_SIDE / shortest);
  return { action: "upscale", factor, width: width * factor, height: height * factor };
}

function isPositiveSize(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * FSE-001 —— **这张图的血统里有没有官方演员。**
 *
 * `Generation.entitySnapshot` 是出图那一刻按 `job.entityIds` 冻下来的引用链
 * (`{ entities: [{ id, name, type, variantId, refHashes }] }`,`apps/worker/src/jobs/gen.ts`
 * 出图处构造;上传路由 `apps/web/lib/upload-actions.ts` 的 `buildEntitySnapshot` 写同样的
 * 形状)。演员是 `type === "CHARACTER"` 的 Entity,所以「他从 Library 挑过演员」在库里就是
 * 这一格。
 *
 * 两个读者,所以判据住在这里而不是 worker 本地:
 *   · 拒绝时读哪一句(`personRejectionSentence`,worker);
 *   · **能不能自动放大**(Founder 2026-09-09 裁决「仅限无人像的商品照,演员图与任何含人像
 *     的图一律不动」)。放大是像素级再处理,而规格 §5 2026-08-30「像素完整性铁律」的判定
 *     正是:血统信任的标记在像素里,对已过门的文生图做再处理会被视频端当作真人拒收(实证:
 *     裁剪后提交 = 拒收 `may contain real person`)。所以带演员血统的图一格不动。
 *
 * 形状不对(老行、`{}`、手写脏数据)一律当作**没有演员** —— 与其替一条证不出来的血统编话,
 * 不如回落到安全的那一半。注意这条回落对放大那一格是**不安全的方向**(证不出演员 ⇒ 允许
 * 放大),所以放大侧另有一道 300px 硬闸兜底:真被当成真人拒收时供应商在建任务前就弹回,
 * 那一趟 $0。
 *
 * 只看这一行自己的快照,不递归上溯:Generation 没有指向上一张图的列,追链要另建来源边。
 */
export function lineageCarriesOfficialActor(entitySnapshot: unknown): boolean {
  const entities = (entitySnapshot as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(entities)) return false;
  return entities.some((e) => (e as { type?: unknown } | null)?.type === "CHARACTER");
}
