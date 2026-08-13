-- #795 限流落库:两张新表,零既有数据改动。
--
-- 为什么必须落库。今天所有的限流计数都活在**进程内存**里。这有两个后果,而且都是静默的:
--   ① 开第二个实例 = 每个实例各有一份计数 = 每一道闸的实际额度凭空翻倍,没有任何东西会
--      报错,面板上闸门看起来还在。
--   ② 每次部署重启 = 计数清零,窗口从头再来。
-- beta 是**公开注册**(任何人都能注册),这两条各自都够让「有闸」变成「说有闸」。
--
-- ── 两张表,不合并 ────────────────────────────────────────────────────────────
-- ba_rate_limit      —— Better Auth 自己那套(它的 database storage,形状由它定:
--                       key / count / lastRequest,lastRequest 是 epoch 毫秒)。
-- rate_limit_counter —— 我们自己那几道闸(登录链接门、密码门、生成、上传、外链)。
--                       固定窗口:count = 本窗口内已放行次数,expiresAt = 窗口结束时刻。
-- 两套算法与语义不同(BA 是滑动 lastRequest,我们是固定窗口且**拒绝不计数**),合表等于
-- 把两套规则绑死在一次 schema 变更上。
--
-- ── 安全性 ────────────────────────────────────────────────────────────────────
-- 只 CREATE TABLE,不动任何既有表、任何既有列、任何既有行。回滚 = DROP 这两张表。
-- 表里没有任何商家内容:key 是「出口地址/租户 id + 哪道门」的字符串,没有邮箱明文以外的
-- 身份信息,没有令牌、没有金额。
--
-- expiresAt 用 bigint 存毫秒而不是 timestamp:判断「还有没有额度」就成了纯整数比较,
-- 时区、精度、会话 TZ 一个都不参与。

BEGIN;

CREATE TABLE "ba_rate_limit" (
  "id"          TEXT   NOT NULL,
  "key"         TEXT   NOT NULL,
  "count"       INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL,
  CONSTRAINT "ba_rate_limit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ba_rate_limit_key_key" ON "ba_rate_limit"("key");

CREATE TABLE "rate_limit_counter" (
  "key"       TEXT    NOT NULL,
  "count"     INTEGER NOT NULL,
  "expiresAt" BIGINT  NOT NULL,
  CONSTRAINT "rate_limit_counter_pkey" PRIMARY KEY ("key")
);

-- 过期行清理按这个索引扫(限流表的行数 = 窗口内活跃 key 数,不清理会一直涨)。
CREATE INDEX "rate_limit_counter_expiresAt_idx" ON "rate_limit_counter"("expiresAt");

-- 计数不许为负:一次写错方向的 UPDATE 会把「已经用掉 5 次」变成「还剩额度」,
-- 而限流表出错的方向永远应该是「更严」。
ALTER TABLE "rate_limit_counter"
  ADD CONSTRAINT "rate_limit_counter_count_non_negative" CHECK ("count" >= 0);

ALTER TABLE "ba_rate_limit"
  ADD CONSTRAINT "ba_rate_limit_count_non_negative" CHECK ("count" >= 0);

COMMIT;
