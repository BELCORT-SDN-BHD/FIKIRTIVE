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

BEGIN;

DROP TABLE IF EXISTS "CollectionItem";
DROP TABLE IF EXISTS "Collection";
DROP TABLE IF EXISTS "Favorite";

COMMIT;
