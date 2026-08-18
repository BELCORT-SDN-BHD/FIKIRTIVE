-- 素材理解:①状态集合加 PAUSED(可恢复的暂停),②把 2026-08-18 那次配置事故里被
-- 误判成终态的存量行放回队列。
--
-- ── 背景(为什么会有一次数据修复)────────────────────────────────────────────
-- `packages/generation/src/understanding.ts` 里写着一个从没核实过的裸模型别名。它在本账户
-- 不解析,于是生产上每一次理解请求都是 HTTP 404。而当时的失败分类是
-- 「400/415/422 ⇒ 这份素材读不了」,404 掉进了默认分支、耗完两次重试后落 FAILED 终态。
-- 扫描器第 ① 段只找**完全没有理解行**的素材,第 ② 段只找 QUEUED —— 两段都看不见 FAILED,
-- 而 (ownerId, assetId, kind) 唯一约束会一直占着位子。结果:全部合格素材在两天里被逐行
-- 永久判死,商家看不见、修不了,连删掉重传都救不回来。
--
-- 代码侧的根性修复(同一个 PR)是把「我方配置坏了」和「这份文件坏了」分成两类:配置类
-- 不再写终态,重试用完之后停在 PAUSED,由扫描器按节奏捡回。这份迁移做的是那次修复的
-- **存量部分** —— 已经被写死的行,代码再对也不会自己回来。
--
-- ── 为什么按错误签名而不是按租户 ─────────────────────────────────────────────
-- 这不是某一家商家的故障:模型 id 是全平台一份配置,所有租户同病。按 ownerId 圈选既不
-- 完备也没意义;唯一诚实的边界是**那句错误本身**,它是当时那条代码路径逐字写出来的:
--   understanding request failed (404)
-- 所以 WHERE 只认这个签名 + FAILED 状态。别的 FAILED(读不清楚的文件、别的 status code)
-- 一行都不碰 —— 一次「顺手清理」会把真正读不了的文件重新排进队列,永远读不完。
--
-- ── 幂等 ─────────────────────────────────────────────────────────────────────
-- 跑第二遍匹配不到任何行(第一遍已经把 status 与 error 一起改掉了),所以重跑是 no-op。
-- 约束那两句用 IF EXISTS / 完整重建,同样可以重跑。
-- `apps/worker/src/jobs/understand-db.test.ts` 直接读下面 RECOVERY 标记之间的那条语句
-- 打真库执行两遍,断言的就是这两件事:只清签名内的行、跑两遍结果一致。
--
-- 数据风险:只改 status/error 两列,不删任何行、不改任何 Asset。被改的行回到 QUEUED,
-- 也就是它们从一开始就该在的状态。

BEGIN;

-- ① 状态集合加 PAUSED。CHECK 而不是 PG enum(house style:加一个取值是一次迁移)。
ALTER TABLE "AssetUnderstanding" DROP CONSTRAINT IF EXISTS "AssetUnderstanding_status_check";
ALTER TABLE "AssetUnderstanding"
  ADD CONSTRAINT "AssetUnderstanding_status_check" CHECK (
    "status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'PAUSED')
  );

-- ② 存量恢复。error 一并清空 —— 这一行现在真的就是「排着队,还没读」,留着那句
--    白标失败文案会让 Otto 继续对商家说它读不了。
-- >>> RECOVERY (understand-db.test.ts 逐字执行这条语句;签名过滤是它断言的东西)
UPDATE "AssetUnderstanding"
   SET "status" = 'QUEUED', "error" = NULL
 WHERE "status" = 'FAILED'
   AND "error" LIKE '%understanding request failed (404)%';
-- <<< RECOVERY

COMMIT;
