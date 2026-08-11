-- #803 联系人身份的可信度分级(Founder 2026-08-08 裁决 产品⑧)。
--
-- 商家从此可以自己把客人的电话录进来。录进来的号码是真记录,但它跟「渠道确认过的号码」
-- 不是同一件事 —— 前者只是商家打的字,后者有渠道回执。两者混成一列,产品迟早会朝一个
-- 打错的数字群发。所以等级写在行上,由约束守着:
--
--   merchant_unverified —— 商家录入。存得下、搜得到、界面上带标注;不进任何受众。
--   channel_verified    —— 渠道确认过。必须同时留下 verifiedAt(何时)与
--                          verifiedSourceKind(由什么确认),否则写不进去。
--
-- ── 三段安全说明,逐段可复核 ────────────────────────────────────────────────
--
-- ① 只加列、只加约束,不删任何数据、不改任何既有列。
--
-- ② 存量行一律判为 channel_verified,并补上回执。
--    理由:今天生产代码里**没有任何** ContactIdentity 写入路径(2026-08-09 全仓扫描:
--    `contactIdentity.create/upsert` 只出现在测试里),这张表的行只可能来自渠道侧记录。
--    把它们改判成 merchant_unverified 才是无中生有的降级 —— 那会把既有行悄悄踢出受众。
--    回执落成 'channel_record' + 该行自己的 createdAt:说的是「这是渠道侧记录,时间就是
--    它落库的时间」,不假造一个更好听的来源。
--
-- ③ 三列都给了默认值,而且默认值自洽(channel_verified + now() + 'channel_record')。
--    这是刻意的:约束两个方向都收紧(verified 必须有回执、unverified 必须没有回执),
--    如果不给默认值,任何一句不写这三列的 INSERT 都会当场被拒。手工录入路径三列全部
--    显式写(merchant_unverified, NULL, NULL),渠道回写路径也三列全部显式写 —— 默认值
--    只兜住「没人明确表态」的裸插入,而裸插入在今天的含义正是「渠道侧记录」。
--
-- 上线前自查(founder 可直接跑,期望两个数字对得上):
--   SELECT "verificationStatus", count(*) FROM "ContactIdentity" GROUP BY 1;
--   SELECT count(*) FROM "ContactIdentity"
--    WHERE ("verificationStatus" = 'channel_verified') <> ("verifiedAt" IS NOT NULL);  -- 期望 0

BEGIN;

ALTER TABLE "ContactIdentity"
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'channel_verified',
  ADD COLUMN "verifiedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "verifiedSourceKind" TEXT DEFAULT 'channel_record';

-- 存量行补回执(ADD COLUMN 的默认值已经填过新列,这一句只把时间校正成该行自己的 createdAt:
-- 「这条渠道记录是什么时候有的」比「迁移是什么时候跑的」更接近事实)。
UPDATE "ContactIdentity"
   SET "verifiedAt" = "createdAt",
       "verifiedSourceKind" = 'channel_record'
 WHERE "verificationStatus" = 'channel_verified';

-- 封闭取值:越集的词写不进来。
ALTER TABLE "ContactIdentity"
  ADD CONSTRAINT "ContactIdentity_verification_status_check" CHECK (
    "verificationStatus" IN ('merchant_unverified', 'channel_verified')
  );

-- 回执配对:说 verified 就必须拿得出何时、由什么确认;说 unverified 就不许挂着回执。
-- 「已验证但说不出为什么」正是这张票要消灭的形状,所以它是约束,不是约定。
ALTER TABLE "ContactIdentity"
  ADD CONSTRAINT "ContactIdentity_verification_evidence_check" CHECK (
    (
      "verificationStatus" = 'channel_verified'
      AND "verifiedAt" IS NOT NULL
      AND "verifiedSourceKind" IS NOT NULL
    )
    OR (
      "verificationStatus" = 'merchant_unverified'
      AND "verifiedAt" IS NULL
      AND "verifiedSourceKind" IS NULL
    )
  );

COMMIT;
