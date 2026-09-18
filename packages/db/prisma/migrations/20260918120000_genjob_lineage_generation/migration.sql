-- 派生图的谱系来源落盘(R3-F30,规格 `docs/specs/brand-product-identity.md` §5 2026-09-18 行)。
--
-- ── 为什么需要这一列 ──────────────────────────────────────────────────────────
-- 派生图有两条路,今天只有一条在库里留下了「从哪张图来的」:
--   · 画布 Create variations —— 源图真的被送进引擎当底图,所以它落在 `sourceGenerationId`;
--   · Library Regenerate —— 照同一句提示词重新出一张,引擎手上**没有**那张照片
--     (`apps/web/lib/gen-actions.ts` 的 `ASSET_REGEN_UPLOAD_REFUSAL` 注释写明这条路不送
--     `sourceGenerationId`),于是这条路一个来源字都没有记过。
-- 后果就是 R3-F30:派生图的 `Generation.entitySnapshot` 是空数组,「这张图用了哪个商品」
-- 在一跳之后断链。要让 worker 那一个快照写入点把源图的记录继承下来,它先得知道源图是谁。
--
-- ── 这一列里写什么、不写什么 ──────────────────────────────────────────────────
-- 写:服务端自己核过归属的那个锚点(资产动作族在算幂等键**之前**已按 ownerId 查过库)。
-- 不写:任何客户端说法 —— 它不是 `genRequest` 的字段,浏览器连提交的机会都没有。
-- 绝不参与定价、幂等材料与引擎输入:写进这一列不改变这一单发给引擎的任何一个字节。
--
-- ── 为什么可空、零回填 ────────────────────────────────────────────────────────
-- NULL 有两种来路,语义相同:①这一单不是从某张图派生的(首生图);②这一行早于本列存在。
-- 存量行一行不动 —— 回填只能靠推断,而推断出来的谱系会被当成事实读(与 `routeReason`、
-- `sentPromptText` 两列同一条纪律)。所以这份迁移不 UPDATE 任何一行、不删任何数据、
-- 不改任何约束,只有一个可重跑的 ADD COLUMN IF NOT EXISTS。

BEGIN;

ALTER TABLE "GenJob" ADD COLUMN IF NOT EXISTS "lineageGenerationId" TEXT;

COMMIT;
