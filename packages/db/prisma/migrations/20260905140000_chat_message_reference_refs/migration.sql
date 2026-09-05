-- FRONT-A10(规格 docs/specs/frontend-baseline.md §7.3③ 第③刀「消息落引用 ID 与回链」):
-- 给 ChatMessage 加一列类型化引用 `referenceRefs`。
--
-- ── 为什么要这一列,而不是继续用 payload.entityIds ─────────────────────────────
-- 今天一条消息只带裸 entity id(`payload.entityIds`)。裸 id 说不出它是哪一个源的 id ——
-- Entity、Generation、Asset 三张表的 id 长得一样,所以「这条消息提到的那个对象是谁」
-- 在读的时候没有答案,回链也就无从谈起(验收 FRONT-A10 明写「消息记录保存该对象的真实
-- ID,可回链」)。这一列存的是**类型加 id**的线形 `"<type>:<id>"`,单一权威在
-- `packages/core/src/reference-ref.ts`(formatReferenceRef / parseReferenceRef)。
--
-- ── 存量数据:零回填、零转换、零删除 ──────────────────────────────────────────
-- 纯新增一列,默认空数组;既有行一行不动,`payload.entityIds` 原样留着(它仍然是生成
-- 条件的那条路,本次迁移不碰)。这次迁移之前发出的消息没有类型化引用 —— 补不出来:
-- 那时客户端上报的就只有裸 id,谁也不知道它是哪一类。旧消息因此没有引用小片,这是一个
-- 正常状态,不是缺陷:读路径对空数组画的是「没有引用」,不是假造一行。
--
-- 因此本次迁移不需要备份/恢复预案;回滚见同目录 rollback.sql,它丢掉的只有这一列本身,
-- 商家的消息正文、钱、租户边界都不经过它。
--
-- (本文件不含任何数据丢失级 DDL:一句 ADD COLUMN。所以这里**没有** DESTRUCTIVE-OK 标记
--  —— 那行字是给真的会删数据的迁移用的。)
--
-- ── 三处承重的选择 ──────────────────────────────────────────────────────────
-- ① 列名叫 `referenceRefs`,不叫 `references`。`REFERENCES` 是 SQL 关键字;Prisma 会
--    加引号,手打的运维 SQL 不一定会 —— 一个只在别人手写查询时才炸的名字不值得省那几个字母。
-- ② `TEXT[]` 而不是 JSONB:值是一串封闭形状的短字符串,永远整份写、整份读,没有按字段
--    查询的读面。今天不建索引:唯一的读面是「按 id 取这条消息,再解析它自己的这一列」。
-- ③ NOT NULL DEFAULT '{}':空数组与 NULL 在这里是同一个意思(这条消息没提到任何对象),
--    留两种写法就等于让每个读点各猜一次。这个默认值在 schema 里也必须写出来
--    (`referenceRefs String[] @default([])`,与 `Entity.aliases`／`OrgHomeLayout.componentIds`
--    同一写法)—— 漏掉它,`prisma migrate diff` 会把库里这个默认值判成漂移,quality 的
--    `prisma schema drift` 那一腿当场红。
--
-- 租户边界不在这一列上,而在写入口:`apps/web/lib/reference-refs.ts` 的
-- `resolveOwnedReferenceRefs` 在落库前把每一个 id 按当前 principal 的 ownerId 解析一遍,
-- 解不出来的那一轮整轮不发(与媒体引用同一条纪律)。双租户测试在
-- `apps/web/lib/__tests__/message-reference-refs.test.ts`。
--
-- 语句带 IF NOT EXISTS,整份迁移可重跑。
--
-- 上线后自查(期望是 0):形状不合 `<type>:<id>` 的值
--   SELECT count(*) FROM "ChatMessage" m, unnest(m."referenceRefs") AS r
--     WHERE r !~ '^[a-z-]+:.+$';

BEGIN;

ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "referenceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMIT;
