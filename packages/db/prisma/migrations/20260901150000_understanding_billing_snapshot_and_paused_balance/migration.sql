-- 素材理解改商家计费面(MONEY-A9,规格 docs/specs/money-engine.md §7.3):
-- ①三列计费快照,②状态集合加 PAUSED_BALANCE(「待补余额」暂停)。
--
-- ── 背景(为什么一个后台功能忽然需要钱的列)──────────────────────────────────
-- 理解链路原本是**平台自费**:商家不点按钮、不进 CreditLedger、只由一个平台级的每日 $5
-- 预算兜着。Founder 2026-08-31 裁决原话「不要分开,也不要我们吸收,就是用户使用照算」,
-- 于是它变成一个真正的计费面:三类各一个按件价(@fikirtive/core 的
-- pricedUnderstandingCredits,由 65% 定价法从成本钉点推出来),走同一条 reserve→settle。
--
-- 一个后台自动跑的东西开始收钱,最容易踩的雷是「商家没点按钮却被扣款」。规格因此把
-- **披露先于扣费**写成硬要求,而披露要能兑现,价就必须在**上传那一刻**定死——不是扫描器
-- 隔天真的去读它的那一刻。下面三列都是为这一件事存在的。
--
-- ── 三列各自是什么 ──────────────────────────────────────────────────────────
-- priceInternalSnapshot  建行(上传)时刻锁住的本行报价,单位 internal credits(1 = $0.01)。
--                        结算读它,不重新算价 —— 计费四则①,也是「调价不追溯」(MONEY-A7)
--                        在这条链路上的落点。
-- cascadePriceInternal   同一上刻的 doc-extract 报价,只有 image-caption 行填。级联理解
--                        (看图读完才发现这是一份菜单、要再读一次)的第二段价必须在上传界面
--                        一次性披露、一并锁价(四则②);级联出来的那一行继承这一格,
--                        而不是按它自己建行的那一刻重新报价。
-- moneyRefId             当前计费回合的 ledger refId(understanding:<rowId> 或 …:r<n>)。
--                        reserve 的幂等键 reserve:<refId> 终身唯一,所以 REFUND 之后同一个
--                        refId 再也 reserve 不了 —— 重扣必须换一个新回合号,这一列记的就是
--                        「这一行现在认哪一个」。
--
-- ── 为什么三列全部可空、零回填 ──────────────────────────────────────────────
-- A9 上线之前落下的存量行是**免费祖父**:它们当时按「商家一分钱不付」的规矩跑完,事后补收
-- 是我们说话不算数。priceInternalSnapshot IS NULL 就是那个身份标记(不是「忘了写」),
-- 后续 worker 据此判定不计费。所以这份迁移不 UPDATE 任何一行,不删任何数据,
-- 也不需要备份/恢复预案:三个 ADD COLUMN + 一次 CHECK 重建,全部可重跑。
--
-- ── PAUSED_BALANCE 为什么是新状态而不是复用 PAUSED ─────────────────────────
-- PAUSED = **我方**配置/请求坏了(2026-08-18 那次没核过的模型 id),要人去修代码;
-- PAUSED_BALANCE = **商家**余额不足(reserve 抛 InsufficientCredits),要商家去充值。
-- 两者的恢复判据完全不同(一个等人修,一个等余额 ≥ 快照价),扫描器捞回的查询也不同 ——
-- 合成一个状态就等于把「我们坏了」和「你没钱了」讲成同一句话。两者都**不是终态**:
-- 不判死门、暂停期间不打供应商、素材无限期保留(credits 不过期,同理)。

BEGIN;

-- ① 计费快照三列。全部可空 = 存量行零回填(免费祖父,见上)。
ALTER TABLE "AssetUnderstanding" ADD COLUMN IF NOT EXISTS "priceInternalSnapshot" INTEGER;
ALTER TABLE "AssetUnderstanding" ADD COLUMN IF NOT EXISTS "cascadePriceInternal" INTEGER;
ALTER TABLE "AssetUnderstanding" ADD COLUMN IF NOT EXISTS "moneyRefId" TEXT;

-- ② 状态集合加 PAUSED_BALANCE。CHECK 而不是 PG enum(house style:加一个取值是一次迁移),
--    重建形状逐字照 20260818140000 那次 —— DROP IF EXISTS + 完整重建,所以可重跑。
ALTER TABLE "AssetUnderstanding" DROP CONSTRAINT IF EXISTS "AssetUnderstanding_status_check";
ALTER TABLE "AssetUnderstanding"
  ADD CONSTRAINT "AssetUnderstanding_status_check" CHECK (
    "status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'PAUSED', 'PAUSED_BALANCE')
  );

COMMIT;
