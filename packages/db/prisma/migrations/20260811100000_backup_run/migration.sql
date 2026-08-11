-- #794 备份可信化(工程评估债 #2):备份新鲜度落成一行可查的事实。
--
-- 在这条迁移之前,「昨晚的备份成功了吗」在系统里没有答案 —— 成功只写进 worker 的 stdout,
-- 失败只进 Sentry。两者都读不到,所以 /api/health 与 admin 都无法回答这个问题,而一个
-- 没人看得见新鲜度的备份,和没有备份的区别只在出事那天才知道。
--
-- ── 三段安全说明 ──────────────────────────────────────────────────────────────
--
-- ① 纯新增:一张新表,不碰任何既有表、不删任何数据、不改任何既有列。
--
-- ② append-only:每次备份尝试落一行(成功与失败都落),没有 UPDATE 路径、没有删除路径。
--    新鲜度读的是「最近一条 succeeded 行的 finishedAt」,所以一次失败永远不会把上一次
--    成功的记录抹掉 —— 失败行只会让面板同时看到「最近一次成功在什么时候」和「之后失败过」。
--
-- ③ 两个封闭集用 CHECK 约束守着,不靠约定:status 只能是 succeeded/failed,
--    credentialMode 只能是 isolated/shared。写错的词写不进来。
--    succeeded 必须带 finishedAt 与 key —— 「成功了但说不出成功的是哪个对象/什么时候」
--    正是这张票要消灭的形状,所以它也是约束。
--
-- 上线后自查(founder 可直接跑,期望第二个数字为 0):
--   SELECT status, count(*) FROM "BackupRun" GROUP BY 1;
--   SELECT count(*) FROM "BackupRun" WHERE status = 'succeeded' AND ("finishedAt" IS NULL OR "key" IS NULL);

BEGIN;

CREATE TABLE "BackupRun" (
    "id"             TEXT NOT NULL,
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"     TIMESTAMP(3),
    "status"         TEXT NOT NULL,
    "trigger"        TEXT NOT NULL,
    "credentialMode" TEXT NOT NULL,
    "key"            TEXT,
    "sizeBytes"      BIGINT,
    "durationMs"     INTEGER,
    "error"          TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- 封闭取值:越集的词写不进来。
ALTER TABLE "BackupRun"
  ADD CONSTRAINT "BackupRun_status_check" CHECK ("status" IN ('succeeded', 'failed'));

ALTER TABLE "BackupRun"
  ADD CONSTRAINT "BackupRun_credential_mode_check" CHECK ("credentialMode" IN ('isolated', 'shared'));

-- 说成功就必须拿得出「什么时候完成」与「传的是哪个对象」。
ALTER TABLE "BackupRun"
  ADD CONSTRAINT "BackupRun_succeeded_evidence_check" CHECK (
    "status" <> 'succeeded' OR ("finishedAt" IS NOT NULL AND "key" IS NOT NULL)
  );

-- 新鲜度查询走这条:最近一条 succeeded 行。
CREATE INDEX "BackupRun_status_finishedAt_idx" ON "BackupRun"("status", "finishedAt");
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

COMMIT;
