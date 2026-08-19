-- 平台理解花费的累加计量器,按 UTC 日分桶(#784 判官 delta 裁决)。
--
-- ── 为什么要多一张表 ────────────────────────────────────────────────────────
-- 平台日预算此前读的是 "AssetUnderstanding" 两列 token 的快照 SUM,而每一次落盘都是
-- SET 覆写。同一行跑 N 次付费调用,账面只留最后一次 —— 计量器读数是真实花费的 1/N。
-- 实测(真库,同一行三次调用):记 $0.000104,真实 $0.000673…$0.000312 区间,3.00×。
-- 后果不是「账不好看」,是 cap 在一整段行数区间里**永远不会触发**:读数永远够不到日预算,
-- 于是实际花费由吞吐而不是由预算参数决定。
--
-- 旧实现的注释里恰好写着「一行三次重试数成 1」——它把自己的缺陷说出来了,然后实现逐字
-- 复现了它。钱路守卫不能靠注释声明:这张表存在的理由就是让那句话变成一条会红的断言。
--
-- ── 为什么不复用现成形状 ────────────────────────────────────────────────────
-- 找过了:`ActionEvent` 是带 ownerId 的租户审计流水,金额藏在 JSON 里,SUM 不出可信的钱;
-- `GenJob.spentUsd` / `CreditLedger` 是**商家的钱**的权威,而理解是平台成本、商家一分不付
-- (混进去会污染毛利与账本两条线)。两者都不是「平台今天一共花了多少」的形状。
--
-- ── 形状 ────────────────────────────────────────────────────────────────────
-- 一天一行,只增不减,每一次**付费调用**记一笔(不是每一次状态落盘 —— 那会重复计数)。
-- 加法在数据库里做(INSERT … ON CONFLICT DO UPDATE SET x = 现有 + 新增),所以两个副本
-- 同时记账不会丢更新。
--
-- 零风险:纯新增一张表,不改任何既有列、不动任何既有数据、没有回填。计量器从部署那一刻
-- 开始计数 —— **刻意不回填**:历史行的快照根本推不出当天真实的调用次数,回填只会把一个
-- 猜测写成看起来像事实的数字,而这张表存在的全部理由就是不猜。

BEGIN;

CREATE TABLE "UnderstandingSpendDay" (
  "day"          DATE NOT NULL,
  "inputTokens"  BIGINT NOT NULL DEFAULT 0,
  "outputTokens" BIGINT NOT NULL DEFAULT 0,
  "calls"        INTEGER NOT NULL DEFAULT 0,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UnderstandingSpendDay_pkey" PRIMARY KEY ("day")
);

-- 只增不减,由约束兜住:一次「减少」只可能是漏写或错写,而它会让预算闸重新变瞎。
ALTER TABLE "UnderstandingSpendDay"
  ADD CONSTRAINT "UnderstandingSpendDay_non_negative_check" CHECK (
    "inputTokens" >= 0 AND "outputTokens" >= 0 AND "calls" >= 0
  );

COMMIT;
