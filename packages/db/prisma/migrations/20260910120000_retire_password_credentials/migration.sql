-- DESTRUCTIVE-OK: SIGNIN-A9 —— 密码凭据退役（docs/specs/sign-in.md §1.4「密码凭据退役」，
-- 冻结 v1 / issue #1260；执行票 #1316）。Founder 2026-08-01「未公测零用户」：这些行只可能属于
-- 测试账号，正式商家一个都没有。
--
-- 删的是什么：`ba_account` 里 `providerId = 'credential'` 的行。这是 better-auth 给邮箱密码凭据
-- 的固定标记（better-auth 1.6.20 `dist/api/routes/password.mjs`），一行 = 一份密码哈希。Google
-- 那些行的 providerId 是 'google'，不在这条语句的范围内。
--
-- 为什么是删行而不是删 `password` 列：列还留着，是因为 better-auth 的 adapter 仍然按它自己的
-- 模型读写 `ba_account`；删列会让库和它的模型对不上，而这次退役要的是「一份密码凭据都不存在」，
-- 不是「表结构里没有密码这个概念」。schema.prisma 因此不动，这是一条纯数据迁移。
--
-- 不可逆：删掉的密码哈希无法从任何地方重建。生产执行前须由 Founder 另行确认备份与恢复方案
-- （见同目录 rollback.sql）。

DELETE FROM "ba_account" WHERE "providerId" = 'credential';
