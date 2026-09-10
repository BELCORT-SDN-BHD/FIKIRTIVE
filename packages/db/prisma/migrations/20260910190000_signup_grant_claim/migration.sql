-- SIGNIN-A17 —— 开户赠金「一个真实收件箱一次」的唯一约束
-- （docs/specs/sign-in.md 已冻结 · v1 §1.5；执行票 #1317）。
--
-- 纯新增：一张新表，没有 DDL 触及任何既有表，没有数据转换，没有回填。既有工作区的赠金一行不动
-- ——它们的去重仍然由 CreditLedger 的 (orgId, "signup:<orgId>") 唯一约束负责，那条键刻意不变
-- （换键会让每一个既有 org 在下次登录时**再领一笔**）。这张表加的是另一维：同一个真实收件箱
-- 的多个地址变体（me+001@ / m.e@）之间只允许一笔。
--
-- canonicalEmail 由 @fikirtive/core 的 `canonicalGrantEmail` 计算（去 +tag；gmail/googlemail
-- 去点），在 bootstrapPersonalOrg 的那笔事务里 INSERT ... ON CONFLICT DO NOTHING —— 抢到这一行
-- 的 org 发赠金，没抢到的不发。主键就是去重键，所以并发两个变体同时开户也只可能有一个赢。
--
-- 为什么不能写进 CreditLedger 的 idempotencyKey：那条唯一约束是 (orgId, idempotencyKey)，而两个
-- 变体是两个 org，键写什么都拦不住第二笔。
--
-- 不新增外键：这一行要比它记录的那个 org 活得久（org 删掉之后，那个收件箱仍然领过一次）。
CREATE TABLE "signup_grant_claim" (
    "canonicalEmail" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_grant_claim_pkey" PRIMARY KEY ("canonicalEmail")
);
