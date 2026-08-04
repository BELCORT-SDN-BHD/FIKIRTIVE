-- T3 状态代数落库(#602 · spec #599 D4)。画布卡状态列加取值检查,只加约束,不改结构。
--
-- 为什么安全 —— 三段证据,逐段可复核:
--
-- ① 写入者已穷举(#613 T2d 之后只剩五个,全在 CanvasNode.status 上):
--      createCanvasNode / placeCanvasJobNode  → 'pending' | 'done'
--      resolveCanvasNode                      → 'done' | 'failed' | 'cancelled' | 'timeout' | 'missing'
--                                               (动作本身白名单拒收其它词)
--      settleCanvasCardsForGenJob             → 'done' | 'failed' | 'cancelled'
--      tombstoneCanvasNode                    → 'deleted'
--    Git 全史对这些文件的字面量扫描没有第六个词(见 PR 正文的取证命令)。
--
-- ② 但「写入者规矩」不等于「库里干净」:createCanvasNode 是 server action,
--    input.status 一直是浏览器给的字符串且从未校验过,所以理论上可以存进任意词。
--    本次同批把那道校验补上(apps/web/lib/canvas-actions.ts),从此写不进越集值;
--    对已经在库里的历史行,下面显式清洗。
--
-- ③ 清洗落到 'unknown' 而不是任何一个像样的状态:一个没人认得的词,唯一诚实的说法
--    就是「不知道」。卡面对 unknown 有自己的脸(不转圈、可「Check again」重读),
--    落成 'pending' 会变成永久转圈,落成 'done'/'missing' 会替商家断言一件没证据的事。
--    这一句不删任何行、不动任何 generationId,只改状态词。
--
-- 语句顺序是 NOT VALID → 清洗 → VALIDATE,不是「先清洗再加约束」(#602 r2 复审 P2)。
-- 差别只在滚动发布那一小段窗口里,而那一段恰恰危险:推 main 会自动对生产跑 migrate deploy,
-- 此刻旧版本的 web 实例还活着,它的 createCanvasNode 仍然不校验入参。
--   先清洗再 ADD CONSTRAINT:清洗与加约束之间只要旧实例插进一行越集值,ADD CONSTRAINT
--   的存量校验就会失败 —— 生产迁移当场挂掉。
--   NOT VALID 先行:约束一存在就对**所有新写入**生效(旧实例那条脏写当场被拒,fail closed,
--   正是我们要的),存量行不扫;清洗只需处理它之前就有的行;VALIDATE 再扫时已不可能有新脏行。
-- 附带好处:VALIDATE CONSTRAINT 只取 SHARE UPDATE EXCLUSIVE 锁,不长时间挡住读写。
-- 三句仍在同一个事务里,所以要么整批生效、要么整批回滚。
--
-- 上线前自查(founder 可直接跑,期望 0 行):
--   SELECT status, count(*) FROM "CanvasNode"
--    WHERE status NOT IN ('pending','done','failed','cancelled','timeout','missing','deleted','unknown')
--    GROUP BY status;
-- 本地 dev 库(fikirtive)实测:只有 done / pending 两种值。

BEGIN;

-- 1) 先立约束(不校验存量):从这一刻起,任何新写入都必须落在集合内。
--    同款先例:20260722130000_c7_m1_workflow_carriers 里的六张状态表。
ALTER TABLE "CanvasNode"
  ADD CONSTRAINT "CanvasNode_status_check" CHECK (
    "status" IN ('pending', 'done', 'failed', 'cancelled', 'timeout', 'missing', 'deleted', 'unknown')
  ) NOT VALID;

-- 2) 清洗:历史越集值 → 'unknown'(不删行,不改绑定,只改状态词)。
UPDATE "CanvasNode"
   SET "status" = 'unknown'
 WHERE "status" NOT IN (
   'pending', 'done', 'failed', 'cancelled', 'timeout', 'missing', 'deleted', 'unknown'
 );

-- 3) 校验存量:第 1 句之后进不来新脏行,第 2 句清掉了旧脏行,所以这一句不可能失败。
ALTER TABLE "CanvasNode" VALIDATE CONSTRAINT "CanvasNode_status_check";

COMMIT;
