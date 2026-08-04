-- T4 批次身份与派生事实落盘(#603 · spec #599 D5 · 根因地图 根 3 / 根 4)。
-- 只新增四列 + 一次性回填。不删列、不改列型、不加约束、不加索引。
--
-- 为什么要落盘 —— 三件事本来就在服务端手里,却从来没写下来:
--   ① 「这是这批里的第几张」:后台按引擎输出顺序逐张写 GenJob.generationIds,顺序就是事实;
--      浏览器却按「先比 y 坐标、再比 x 坐标」重新推。商家把 B 拖到 A 上面 → 标签当场互换。
--   ② 「这一批一共几张」:靠数画布上还剩几张卡。一批 4 张删掉 2 张,剩下 2 张凭空长出 A/B
--      角标并解锁「对比」—— 商家从没做过 A/B。
--   ③ 「真正从谁派生」:CanvasNode."sourceNodeId" 一列装了三件事(真派生 / 同批布局锚点 /
--      纯文生图批次里被伪造的兄弟血缘),读的人只能各按一种解释。
--
-- 落盘之后:A/B 标签读 "batchIndex",组框读 "batchSize",连线只读 "madeFromNodeId",
-- 摆放读 "layoutAnchorNodeId"。坐标只管摆放,永不定义身份。
--
-- ───────────────────────── 回填能回填什么、不能回填什么 ─────────────────────────
--
-- 回填的唯一证据来源是 GenJob 行本身(付费作业自己的记录),不是画布现状:
--   - "batchSize"          ← array_length(j."generationIds", 1)   该作业一共产出几张
--   - "batchIndex"         ← array_position(j."generationIds", n."generationId") - 1
--   - "madeFromNodeId"     ← n."sourceNodeId",且仅当 j."sourceGenerationId" IS NOT NULL
--                            (作业确实是以另一张产出为输入跑的 → 那一列当时装的就是真派生)
--   - "layoutAnchorNodeId" ← n."sourceNodeId",且仅当 j."sourceGenerationId" IS NULL
--                            (作业没有输入图 → 那一列当时装的只可能是同批布局锚点)
-- 这个分法不是猜:两条写入路径(placeCanvasJobNode / settleCanvasCardsForGenJob)历史上
-- 都只按 j."sourceGenerationId" 有没有值来决定往那一列写哪种东西,所以同一个判据能把旧值
-- 无歧义地劈开。
--
-- **回填不到的,一律留 NULL,不猜**(诚实先例:Q13=B「早期作品,来历不详」)。四类:
--   (a) "genJobId" IS NULL 的卡 —— 商家自己上传/拖上来的图、文字便签。它们本来就没有批次。
--   (b) "genJobId" 指向的 GenJob 行已经不在了 —— 删项目时任务行是物理删除,产出物却宣称
--       永不物删,所以真相源比它记录的事实先死。这类行连「那一列当时是哪种意思」都判不了,
--       所以 "madeFromNodeId" 与 "layoutAnchorNodeId" 双双留 NULL:宁可少画一条线,也不能
--       画一条错的 —— 错的溯源比没有溯源更危险(会被当成证据)。
--   (c) "generationId" IS NULL 的卡(在途锚点卡、终态失败卡)—— 还没绑上任何一张产出,
--       序号无从谈起,"batchIndex" 留 NULL;但 "batchSize" 是作业级事实,照填。
--   (d) "generationId" 不在该作业的产出列表里的行(历史错绑)—— array_position 返回 NULL,
--       "batchIndex" 就留 NULL,不硬凑一个位置出来。
-- NULL 在读取端一律读作「不知道」:不显示 A/B、不显示组框、不画派生线。
--
-- ───────────────────────────── 锁,如实说 ─────────────────────────────
--
-- 第 1 步的四个 ADD COLUMN:全部可空、**不带 DEFAULT**,所以是纯目录改动,不重写表;
-- 取的仍是 ACCESS EXCLUSIVE,但只按住写目录那一瞬,以毫秒计。
-- 第 2 步的 UPDATE:按行取 ROW EXCLUSIVE,不挡读;它会把命中的每一行重写一遍(MVCC 新版本),
-- 所以代价随 CanvasNode 行数线性增长,并会撑大表与后续 autovacuum 的工作量。
-- 两步同处一个事务(整批生效或整批回滚),所以 UPDATE 跑多久,第 1 步那把 ACCESS EXCLUSIVE
-- 就按住多久 —— 这是本迁移真正的挡人窗口,不是 ADD COLUMN 本身。
-- 为什么现在可接受:**产品尚未公测、零正式用户**(Founder 纠正 2026-08-01),本地 dev 库
-- CanvasNode 只有几十行,这段窗口以毫秒计。等到真有商家在用,同样的形状要拆成两次部署
-- (先发列、代码双读,再单独一个事务分批回填)才谈得上不打扰人。
--
-- 为什么不在本次加「一个作业只能有一张未绑定锚点卡」的唯一索引(#613 T2d 留给本票的那条):
--   ① 本票验收第一条写死「migration 仅新增列」,唯一索引不是列;
--   ② 它是 partial unique index,对**存量**行做校验 —— 库里只要已经有一对重复锚点(那正是
--      它要防的异常),CREATE UNIQUE INDEX 当场失败,而推 main 会自动对生产跑 migrate deploy,
--      失败的就是生产迁移;要安全上它得先决定「重复的那张卡怎么处置」,那是一个产品决定,
--      不是一次索引。所以它需要自己一片:先清点、Founder 定处置、再 CONCURRENTLY 建索引。
--   ③ 眼下并非无防线:结算投影已经识别出重复锚点并拒绝把同一张付费图绑到第二张卡上,只是
--      出声告警而不改行(canvas-settlement.ts 的 duplicateAnchorIds)。
--
-- ─────────────────────── 上线前自查(Founder 可直接跑)───────────────────────
-- 迁移前(现状清点,期望:两个数相等或差得出解释):
--   SELECT count(*) AS 有作业的卡,
--          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "GenJob" j WHERE j.id = n."genJobId"
--                                           AND j."ownerId" = n."ownerId")) AS 作业还在的卡
--     FROM "CanvasNode" n WHERE n."genJobId" IS NOT NULL;
-- 迁移后(期望 0 行 —— 每一行的落盘序号都与该作业的产出列表一致):
--   SELECT n.id, n."batchIndex", array_position(j."generationIds", n."generationId") - 1 AS 应为
--     FROM "CanvasNode" n JOIN "GenJob" j
--       ON j.id = n."genJobId" AND j."ownerId" = n."ownerId" AND j."projectId" = n."projectId"
--    WHERE n."generationId" IS NOT NULL
--      AND n."batchIndex" IS DISTINCT FROM array_position(j."generationIds", n."generationId") - 1;
-- 迁移后(留 NULL 的那部分,期望能逐条对上上面 (a)–(d) 四类):
--   SELECT count(*) FILTER (WHERE "genJobId" IS NULL)                        AS 无作业,
--          count(*) FILTER (WHERE "genJobId" IS NOT NULL AND "batchSize" IS NULL) AS 作业已不在,
--          count(*) FILTER (WHERE "generationId" IS NULL)                    AS 未绑产出
--     FROM "CanvasNode";

BEGIN;

-- 1) 四列全部可空、无 DEFAULT:目录改动,不重写表。
ALTER TABLE "CanvasNode" ADD COLUMN "batchIndex" INTEGER;
ALTER TABLE "CanvasNode" ADD COLUMN "batchSize" INTEGER;
ALTER TABLE "CanvasNode" ADD COLUMN "layoutAnchorNodeId" TEXT;
ALTER TABLE "CanvasNode" ADD COLUMN "madeFromNodeId" TEXT;

-- 2) 一次性回填。证据只来自付费作业自己的行;JOIN 三件套(id + ownerId + projectId)一个
--    都不能少 —— CanvasNode."genJobId" 没有外键,别的工作区的行也可以叫出同一个作业号。
--    只写这四个新列,一个既有列都不动(所以整段可逆:删掉四列即回到迁移前)。
UPDATE "CanvasNode" n
   SET "batchSize" = NULLIF(COALESCE(array_length(j."generationIds", 1), 0), 0),
       "batchIndex" = CASE
         WHEN n."generationId" IS NULL THEN NULL
         ELSE array_position(j."generationIds", n."generationId") - 1
       END,
       -- 作业有输入图 ⇒ 那一列当时装的是真派生;没有 ⇒ 装的只可能是同批布局锚点。
       "madeFromNodeId" = CASE WHEN j."sourceGenerationId" IS NOT NULL THEN n."sourceNodeId" END,
       "layoutAnchorNodeId" = CASE WHEN j."sourceGenerationId" IS NULL THEN n."sourceNodeId" END
  FROM "GenJob" j
 WHERE n."genJobId" = j."id"
   AND n."ownerId" = j."ownerId"
   AND n."projectId" = j."projectId";

COMMIT;
