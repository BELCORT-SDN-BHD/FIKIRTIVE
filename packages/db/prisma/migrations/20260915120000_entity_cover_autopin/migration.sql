-- 封面一次补齐(规格 docs/specs/brand-product-identity.md §5;Founder 2026-09-15 裁决;
-- 验收 PRODID-A4)。
--
-- ── Founder 2026-09-15 裁决(原话) ──────────────────────────────────────────
-- 「未钉封面时的显示规则:挂上第一张参考图时自动设为封面并写回 `Entity.baseAssetId`,商家随时
--   可换;**存量数据一次补齐迁移**;Library 与 Brand 从此同一张图。」
--
-- 这份文件就是那句「存量数据一次补齐迁移」。裁决的另一半(挂图那一刻就钉)住在写路
-- `packages/db/src/entity-cover.ts:reconcileEntityCover`,从今往后由它保证;这里只负责把裁决
-- **之前**已经挂着图却没钉过封面的那些身份补上。
--
-- ── 为什么非补不可 ──────────────────────────────────────────────────────────
-- 同一个 `baseAssetId IS NULL` 的身份,四条读路从前给出两种答案:Library
-- (`apps/web/lib/library-elements.ts`)、Stuff(`apps/web/lib/stuff-items.ts`)、`@` 菜单
-- (`apps/web/lib/reference-search.ts`、`apps/web/components/MentionInput.tsx`)沿用**第一张**
-- 参考图;Brand(`packages/core/src/brand-records.ts:withProductIdentity`)当作**没有主图**。
-- 商家于是在 Library 看到一张图、在 Brand 页看到一个空位 —— 同一件产品两张脸。
--
-- 本票把四条读路一律改成「只认钉着的那一张」。少了这份回填,存量身份会在改完的那一刻
-- **集体失去封面**(它们的 `baseAssetId` 全是 NULL),商家打开 Library 看到满屏空白格。
-- 所以这份回填与那几处读路的改动**必须同一个 PR 一起上**。
--
-- ── 挑哪一张 ────────────────────────────────────────────────────────────────
-- 「最早挂上的那一张」,排序 (position, createdAt, id) —— 与 `reconcileEntityCover` 里那个
-- ORDER BY **逐字相同**(两处各写一套排序,迟早会挑出两张不同的图)。`position` 排第一是因为
-- 它就是商家在参考图那一排里看到的顺序;`createdAt` 与 `id` 只做打平,保证同一个库跑两次
-- 挑到同一条。
--
-- 只认**基础层**参考图(`variantId IS NULL`):封面是身份的脸,变体的图是那个变体的
-- —— Library 的读路本来就只画基础层,这里同一口径。
--
-- 只认**字节还在**的资产(`Asset.deletedAt IS NULL`):已删的 Asset 是墓碑,它的字节随时会被
-- 30 天清扫真删走。把封面钉在墓碑上,商家得到的是一张永远坏掉的图,而且没有任何入口修得好
-- (判官第 3 轮 P2-b 在 20260910120000 里立的同一条规矩)。整个身份只有墓碑可挑时就**不钉**
-- —— 诚实留空,不编一张图。
--
-- ── 租户 ────────────────────────────────────────────────────────────────────
-- 逐个身份补,不跨身份、更不跨租户:下面那个 JOIN 两边都带 `ownerId`(ADR 0002 第五条),
-- 所以 A 租户的图不可能被钉到 B 租户的身份上。不需要 `ownerId` 条件本身 —— 补的判据是
-- 「这个身份自己的参考图」,与它属于谁无关。
--
-- ── 可重跑 / 全新库 ────────────────────────────────────────────────────────
-- `"baseAssetId" IS NULL` 这一条守卫让它**幂等**:已经钉过的一个字不动(商家亲手挑的封面
-- 尤其动不得),再跑一次影响 0 行。全新库上 `ReferenceImage` 是空表,影响 0 行,照样通过。
--
-- ── 回滚 ────────────────────────────────────────────────────────────────────
-- 同目录 rollback.sql —— 那是一份**有意的空操作**,理由写在文件里。

BEGIN;

UPDATE "Entity" e
SET "baseAssetId" = pick.asset_id
FROM (
  -- 每个身份取一行:它最早挂上的那张活着的基础层参考图。
  SELECT DISTINCT ON (ri."entityId", ri."ownerId")
    ri."entityId" AS entity_id,
    ri."ownerId"  AS owner_id,
    ri."assetId"  AS asset_id
  FROM "ReferenceImage" ri
  JOIN "Asset" a
    ON a."id" = ri."assetId" AND a."ownerId" = ri."ownerId" AND a."deletedAt" IS NULL
  WHERE ri."deletedAt" IS NULL
    AND ri."variantId" IS NULL
  ORDER BY ri."entityId", ri."ownerId", ri."position" ASC, ri."createdAt" ASC, ri."id" ASC
) pick
WHERE e."id" = pick.entity_id
  AND e."ownerId" = pick.owner_id
  AND e."baseAssetId" IS NULL;

COMMIT;
