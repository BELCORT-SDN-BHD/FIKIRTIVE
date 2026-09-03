-- 反向脚本:撤掉本次迁移建的三张表(Favorite / Collection / CollectionItem)。
--
-- 为什么撤得干净:这份迁移是**纯新增** —— 没有改任何既有列、没有删任何既有数据。
-- 存量收藏的权威在回灌之前和之后都还在 "Generation".favorite 那一列上(回灌只**读**
-- 它,一个字节都没有写回),所以三张表 DROP 掉之后,商家的收藏在旧路径上原样还在,
-- 只是「跨素材类型的收藏」与「合集」这两件事回到不存在的状态。
--
-- 会丢的东西(说清楚,不粉饰):迁移之后新建的合集、合集成员,以及**回滚窗口内新点的
-- 收藏** —— 新收藏只写进 "Favorite",没有写回 "Generation".favorite(那正是「单一权威」
-- 的意思),所以 DROP 之后它们不会自己回到旧列上。这是回滚的正常代价,不是缺陷:
-- 回滚要撤的就是这段时间里这三张表上发生的事;迁移之前就有的收藏一条不少。
--
-- 顺序:先删子表(CollectionItem 的外键指着 Collection),再删父表。
-- 三句都带 IF EXISTS,可重跑。
--
-- 最后那一句删的是**迁移台账行**,它和三个 DROP 一样是回滚的一部分,不是收尾清扫。
-- Prisma 把「这条迁移已经跑过」记在 "_prisma_migrations" 里。只 DROP 表、不删这一行,
-- 下一次 `prisma migrate deploy` 会回答「No pending migrations to apply」,应用于是连上
-- 一个**没有这三张表**的库,Library 的每一次读都炸 relation does not exist。
-- 也就是说:少了这一句,回滚脚本自己跑完是绿的,恢复却做不到 —— 而恢复走的正是
-- deploy 这条路(生产上没有人会手动重跑 migration.sql)。所以删行与删表同一个事务,
-- 要么一起成立,要么一起不成立。

BEGIN;

DROP TABLE IF EXISTS "CollectionItem";
DROP TABLE IF EXISTS "Collection";
DROP TABLE IF EXISTS "Favorite";

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260903120000_library_favorites_and_collections';

COMMIT;
