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
--    对已经在库里的历史行,下面第一句显式清洗 —— 清洗是必要的,因为 ADD CONSTRAINT
--    会校验存量行,一旦有越集值就会让生产 migrate deploy 直接失败。
--
-- ③ 清洗落到 'unknown' 而不是任何一个像样的状态:一个没人认得的词,唯一诚实的说法
--    就是「不知道」。卡面对 unknown 有自己的脸(不转圈、可「Check again」重读),
--    落成 'pending' 会变成永久转圈,落成 'done'/'missing' 会替商家断言一件没证据的事。
--    这一句不删任何行、不动任何 generationId,只改状态词。
--
-- 上线前自查(founder 可直接跑,期望 0 行):
--   SELECT status, count(*) FROM "CanvasNode"
--    WHERE status NOT IN ('pending','done','failed','cancelled','timeout','missing','deleted','unknown')
--    GROUP BY status;
-- 本地 dev 库(fikirtive)实测:只有 done / pending 两种值。

BEGIN;

-- 清洗:历史越集值 → 'unknown'(不删行,不改绑定,只改状态词)。
UPDATE "CanvasNode"
   SET "status" = 'unknown'
 WHERE "status" NOT IN (
   'pending', 'done', 'failed', 'cancelled', 'timeout', 'missing', 'deleted', 'unknown'
 );

-- 取值检查(同款先例:20260722130000_c7_m1_workflow_carriers 里的六张状态表)。
ALTER TABLE "CanvasNode"
  ADD CONSTRAINT "CanvasNode_status_check" CHECK (
    "status" IN ('pending', 'done', 'failed', 'cancelled', 'timeout', 'missing', 'deleted', 'unknown')
  );

COMMIT;
