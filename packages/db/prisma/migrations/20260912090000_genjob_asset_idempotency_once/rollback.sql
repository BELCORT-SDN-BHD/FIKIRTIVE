-- 回滚 20260912090000_genjob_asset_idempotency_once（ASSET-A6 / ASSET-A10）。
--
-- 手工执行，不由 prisma 跑。丢掉的是 `asset:` 键「一辈子只生成一次」的数据库兜底：回滚之后
-- startAssetGen 的应用层复用读仍在，但它与写入不是原子的，所以 TOCTOU 竞态（两次提交都读过、
-- 第一单已进终态、第二单才插入）会再造出一单并**再扣一次钱**。一般路径与 cowork 路径不受影响
-- （那条通用的 `GenJob_active_idempotency_key` 没有动）。
DROP INDEX IF EXISTS "GenJob_asset_idempotency_once";
