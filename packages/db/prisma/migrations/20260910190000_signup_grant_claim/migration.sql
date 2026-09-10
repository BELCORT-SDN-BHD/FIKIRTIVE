-- SIGNIN-A17 —— 开户赠金「一个真实收件箱一次」的唯一约束
-- （docs/specs/sign-in.md 已冻结 · v1 §1.5；执行票 #1317）。
--
-- 纯新增：一张新表 ＋ 一段只读既有表的 INSERT 回填（文件末尾）。没有 DDL 触及任何既有表，
-- 没有数据转换，一行既有数据都不改。既有工作区的赠金一行不动——它们的去重仍然由 CreditLedger
-- 的 (orgId, "signup:<orgId>") 唯一约束负责，那条键刻意不变（换键会让每一个既有 org 在下次
-- 登录时**再领一笔**）。这张表加的是另一维：同一个真实收件箱的多个地址变体（me+001@ / m.e@ /
-- @googlemail.com）之间只允许一笔——而回填让这一维对**存量**收件箱也成立。
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

-- ── 回填（判官 r1 P1，2026-09-11）──────────────────────────────────────────────
-- 上面那张表是新的，升级那一刻它是**空的**。于是每一个已经领过开户赠金的真实收件箱，都还可以
-- 拿一个变体地址（`me+new@gmail.com`）在**另一个**工作区再领一笔：新 org 的 claim 主键是空的，
-- `CreditLedger` 的 `signup:<orgId>` 那条键在另一个 org 上也拦不住。A17 那句「一个真实收件箱
-- 只领一次」于是只对新库成立、对存量数据不成立 —— 所以这份迁移必须自己把历史补齐。
--
-- 事实来源是 `CreditLedger` 自己：一个 org 领过开户赠金 <=> 它有一行
-- `idempotencyKey = 'signup:' || orgId`（这条键从 #543 起一个字没变）。org 与人的对应是确定的：
-- `bootstrapPersonalOrg` 写下的 orgId 恒为 `'org_' || User.id`。
--
-- 下面这段算的就是 `packages/core` 的 `canonicalGrantEmail`，逐条对齐（改一边就要改另一边，
-- packages/db/src/__tests__/signup-grant-claim-backfill.test.ts 把这份 SQL 原样读出来执行）：
--   ① trim + lowercase；② 最后一个 '@' 之前是 local、之后是 domain，'@' 在 0 位或不存在则原样
--   返回；③ local 去掉 '+' 及其后；④ domain 是 gmail.com / googlemail.com 时 local 去点、
--   domain 一律折成 gmail.com；⑤ local 去完为空则原样返回（宁可少归一，也不要把一群互不相干的
--   地址合并成同一个键）。
--
-- 同一个收件箱在存量里可能已经有好几个 org（正是这条缺陷造出来的那些）：主键只容得下一行，
-- `DISTINCT ON` 取**最早**领的那一次 —— 早的那个才是真正的「第一次领」。
-- 纯 INSERT：不改任何既有行，不删任何东西，跑第二次也只会 ON CONFLICT DO NOTHING。
INSERT INTO "signup_grant_claim" ("canonicalEmail", "orgId", "createdAt")
SELECT DISTINCT ON (s.canonical) s.canonical, s."orgId", s."createdAt"
FROM (
  SELECT
    l."orgId"     AS "orgId",
    l."createdAt" AS "createdAt",
    CASE
      WHEN p.at <= 0     THEN p.norm
      WHEN p.local = ''  THEN p.norm
      ELSE p.local || '@' || p.domain
    END AS canonical
  FROM "CreditLedger" l
  JOIN "User" u ON l."orgId" = 'org_' || u."id"
  CROSS JOIN LATERAL (
    SELECT
      b.norm,
      b.at,
      CASE WHEN b.dom IN ('gmail.com', 'googlemail.com')
           THEN replace(split_part(b.loc, '+', 1), '.', '')
           ELSE split_part(b.loc, '+', 1) END AS local,
      CASE WHEN b.dom IN ('gmail.com', 'googlemail.com')
           THEN 'gmail.com'
           ELSE b.dom END AS domain
    FROM (
      SELECT
        t.norm,
        t.dom,
        length(t.norm) - length(t.dom) - 1                  AS at,   -- == lastIndexOf('@')
        left(t.norm, length(t.norm) - length(t.dom) - 1)     AS loc
      FROM (
        SELECT
          lower(btrim(u."email"))                             AS norm,
          substring(lower(btrim(u."email")) from '[^@]*$')     AS dom
      ) t
    ) b
  ) p
  WHERE l."idempotencyKey" = 'signup:' || l."orgId"
) s
ORDER BY s.canonical, s."createdAt" ASC, s."orgId" ASC
ON CONFLICT ("canonicalEmail") DO NOTHING;
