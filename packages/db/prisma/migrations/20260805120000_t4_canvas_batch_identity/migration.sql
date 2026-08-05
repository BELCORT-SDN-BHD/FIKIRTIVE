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
-- 批次序号与批大小的证据来源是 GenJob 行本身(付费作业自己的记录),不是画布现状:
--   - "batchSize"  ← array_length(j."generationIds", 1)   该作业一共产出几张
--   - "batchIndex" ← array_position(j."generationIds", n."generationId") - 1
--
-- 旧「来源」列到底是哪一种意思,**只能看它指着的那张卡是什么**,不能看作业是什么
-- (判官轮 r1 · P1 推翻了上一版按作业分类的写法,反例见下):
--   - 它指的卡与本行**同一个作业** ⇒ 那是同批布局锚点 ⇒ 回填 "layoutAnchorNodeId";
--   - 它指的卡带着本行作业记录的来源产出(j."sourceGenerationId")⇒ 那是真派生源卡
--     ⇒ 回填 "madeFromNodeId";
--   - 两样都验不上 ⇒ 两列都留 NULL,不硬猜。
--
-- 上一版按「作业有没有输入图」分类,被一条**可达的历史输出**推翻:main `a43438d7` 的结算写者
-- 在「衍生批次多图、板上还没有锚点」这一路上(该提交 canvas-settlement.ts:190-211),先建锚点行
-- (它的 sourceNodeId = 真来源卡),再把**刚建好的锚点自己的 id** 写进兄弟行的 sourceNodeId;
-- 而整批的 j."sourceGenerationId" 非空。按作业分类会把兄弟行那个布局锚点读成派生血缘 ——
-- 画布上凭空多一条「兄弟从锚点来」的线,它真正的布局锚点还被丢掉。逐行按被引用卡分类之后,
-- 同一批行两种形状都落对:锚点行拿到真来源卡,兄弟行拿到布局锚点。
--
-- "madeFromNodeId" 另有一条**可验证**的补齐(不是放宽):作业记录了 sourceGenerationId 时,
-- 那张来源卡按结算写者同一条规则(同 owner+project、带该产出、createdAt 最早)解析出来 ——
-- 所以衍生批次的兄弟行既拿到布局锚点,也拿到整批共同的真父卡,与 T4 之后新写入的行一致。
-- 优先仍是本行旧值指着的那张卡(只要它验得上是来源卡),解析只在旧值验不上时兜底。
--
-- **回填不到的,一律留 NULL,不猜**(诚实先例:Q13=B「早期作品,来历不详」)。四类:
--   (a) "genJobId" IS NULL 的卡 —— 商家自己上传/拖上来的图、文字便签。它们本来就没有批次。
--   (b) "genJobId" 指向的 GenJob 行已经不在了 —— 删项目时任务行是物理删除,产出物却宣称
--       永不物删,所以真相源比它记录的事实先死。这类行整行不进本次 UPDATE(JOIN 落空),
--       四列全部留 NULL:宁可少画一条线,也不能画一条错的 —— 错的溯源比没有溯源更危险
--       (会被当成证据)。
--   (e) 旧「来源」值指着的卡既不同批、也不是来源卡(跨批陈旧指针)—— 两个关系列都留 NULL。
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
-- 迁移后(期望 0 行 —— 派生线只指向作业记录的来源卡,绝不指向同批兄弟):
--   SELECT n.id FROM "CanvasNode" n
--     JOIN "CanvasNode" p ON p.id = n."madeFromNodeId" AND p."ownerId" = n."ownerId"
--    WHERE n."madeFromNodeId" IS NOT NULL AND p."genJobId" = n."genJobId";
-- 迁移后(留 NULL 的那部分,期望能逐条对上上面 (a)–(e) 五类):
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
       -- 布局锚点:旧值指着的卡与本行同一个作业。同批 = 一起出来的,不是谁生了谁。
       "layoutAnchorNodeId" = (
         SELECT ref."id" FROM "CanvasNode" ref
          WHERE ref."id" = n."sourceNodeId"
            AND ref."ownerId" = n."ownerId"
            AND ref."projectId" = n."projectId"
            AND ref."genJobId" = n."genJobId"
       ),
       -- 真派生:作业记录了来源产出时才谈得上。先认本行旧值指着的那张卡(只要它确实带着
       -- 那个来源产出),否则按结算写者同一条规则解析出那张来源卡;都不成立就留 NULL。
       "madeFromNodeId" = CASE WHEN j."sourceGenerationId" IS NOT NULL THEN COALESCE(
         (
           SELECT ref."id" FROM "CanvasNode" ref
            WHERE ref."id" = n."sourceNodeId"
              AND ref."ownerId" = n."ownerId"
              AND ref."projectId" = n."projectId"
              AND ref."generationId" = j."sourceGenerationId"
         ),
         (
           SELECT ref."id" FROM "CanvasNode" ref
            WHERE ref."ownerId" = n."ownerId"
              AND ref."projectId" = n."projectId"
              AND ref."generationId" = j."sourceGenerationId"
            ORDER BY ref."createdAt" ASC, ref."id" ASC
            LIMIT 1
         )
       ) END
  FROM "GenJob" j
 WHERE n."genJobId" = j."id"
   AND n."ownerId" = j."ownerId"
   AND n."projectId" = j."projectId";

COMMIT;
