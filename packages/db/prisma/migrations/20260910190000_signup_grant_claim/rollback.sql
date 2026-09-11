-- 回滚 20260910190000_signup_grant_claim（SIGNIN-A17）。
--
-- 手工执行，不由 prisma 跑。丢掉的是「哪些真实收件箱已经领过开户赠金」这份记录，代价说清楚：
-- 回滚之后，同一个收件箱的另一个地址变体再开一个号，会**再领一笔** `SIGNUP_GRANT_CREDITS`
-- （因为 CreditLedger 的唯一约束是 (orgId, idempotencyKey)，两个 org 之间它不去重）。
-- 既有工作区自己那一笔不受影响 —— 那条键没有动。
--
-- 只在「这张表本身出问题」时才用；正常回退功能开关不需要动它（表留着是惰性的）。
DROP TABLE IF EXISTS "signup_grant_claim";
