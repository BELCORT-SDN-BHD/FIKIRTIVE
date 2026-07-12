# 数据库夜间备份(P0-1②,判决 7-1 = ③)

## 跑什么、什么时候跑
- worker 的 5 分钟定时循环(`apps/worker/src/db-backup.ts`)每次 tick 检查:
  吉隆坡时间 ≥ 03:00 且当天的 R2 key 不存在 → 跑 `pg_dump --format=custom
  --no-owner --no-privileges` → gzip → 上传。key 存在 = 当晚已备份(exactly-once
  闸,无新增 DB 状态);某晚失败会在下一个 tick 自愈重试。失败只记日志 + Sentry,
  永不弄崩 worker。
- 只在 `STORAGE_DRIVER=r2` 时生效;本地开发(local driver)自动跳过。

## 备份放在哪
- 与内容同一个 R2 bucket,key:`backups/db/fikirtive-<YYYY-MM-DD>.dump.gz`
  (吉隆坡日期)。`backups/` 前缀在 `u/<ownerId>/` 内容寻址方案之外,
  `/files` 路由只认 `u/` key —— 备份对浏览器永远不可达。

## 保留策略
- 上传成功后清理:`backups/db/` 下 key 里日期早于 30 天前的对象删除。
  只按 key 命名匹配删,不认识的对象一律不碰。

## 完整恢复步骤(⚠️ 没有恢复演练的备份不算备份)
先在本地 docker Postgres 演练一遍,确认 dump 可用,再考虑动真库:

```bash
# 1. 从 R2 下载最近一晚的备份(Cloudflare 控制台或任意 S3 客户端)
# 2. 本地起库并建一个干净的恢复目标库
docker compose up -d postgres
docker compose exec postgres psql -U fikirtive -c 'CREATE DATABASE restore_drill;'
# 3. 解压并恢复(custom 格式用 pg_restore,不是 psql)
gunzip -k fikirtive-<YYYY-MM-DD>.dump.gz
pg_restore --no-owner --no-privileges \
  -d 'postgres://fikirtive:fikirtive@localhost:5432/restore_drill' \
  fikirtive-<YYYY-MM-DD>.dump
# 4. 对账:行数要和 prod 当晚对得上(重点看钱的真相)
docker compose exec postgres psql -U fikirtive -d restore_drill \
  -c 'select count(*) from "CreditLedger";'
```

真要恢复 prod:在 Neon 新建一个空库/分支,用同样的 `pg_restore` 命令指向新库,
对账通过后再把应用的 `DATABASE_URL` 切过去。**不要直接 restore 进现网库**。

## 和 Neon PITR 的关系(双层保险)
- 判决 7-1 选了 ③(两者都做):Neon Launch 档 PITR 是平台级秒级回退(founder
  在 Neon 控制台操作);本备份是独立于 Neon 的异地副本 —— Neon 账号/平台出事
  时仍有可恢复的数据。两层互不依赖。
- P0-1 验收(MASTERPLAN):一次真实恢复演练 + 备份连续 7 天绿。

## 两个恢复窗口(Neon window 文档化)
两层的"能回到多久以前"是两个不同的窗口,合起来覆盖不同故障:

| 层 | 窗口 | 粒度 | 谁设定 | 出处/护栏 |
|---|---|---|---|---|
| Neon PITR(热) | **founder 在 Neon 控制台配置的 history retention**(Launch 档支持,按天设;具体天数以控制台实配为准,需 founder 确认/设置) | 秒级、任意时间点 | founder(平台侧) | costing-model §5b(Launch 档);Neon 控制台 |
| R2 异地副本(冷) | **30 天**(`RETENTION_DAYS`,`apps/worker/src/db-backup.ts:35`) | 每 KL 日一份夜间快照 | 代码常数(改动=工程 PR) | 本 runbook「保留策略」 |

- **为什么两个窗口**:Neon PITR 窗口短但粒度细,应对"刚才那条 prod 写错了"——秒级回到任意时间点;
  R2 冷副本窗口长(30 天)但每天一份,应对"Neon 账号/平台整个不可用"——异地仍有可恢复数据。
- **Neon 窗口是 founder 平台侧执行项**:agent 不碰 Neon 控制台。工程侧只把关系与口径写清(本节),
  实际 retention 天数由 founder 在控制台设定/确认后回填本表。
- **别让两个窗口都失守**:若 founder 把 Neon retention 设得比 R2 的 30 天短很多,则 30 天前~Neon 窗口起点
  这段只有"每日冷副本"可恢复(可接受,已知)。两窗口重叠期内任意时点都可秒级回退。

## 工具(本仓,零 prod 触碰)
- **备份计划 dry-run**:`pnpm backup:plan`(或 `node scripts/db-backup-plan.mjs`,需先 build worker)。
  纯 dry-run,无 DB/R2/网络——复用 `apps/worker/src/db-backup.ts` 的真实纯函数打印:今晚目标 key、
  窗口是否已开、保留裁剪演示、以及 `pgEnvFromUrl` 的口令脱敏证明(口令只进 PG* env,永不进 pg_dump argv)。
  翻 `STORAGE_DRIVER=r2` 前跑一遍看计划对不对。
- **恢复演练**:`scripts/db-restore-drill.sh <dump[.gz]>`。默认 DRY RUN(只打印将执行的命令,不动任何库);
  `--apply` 才真跑,且**硬拒绝任何非本地 host 与非 drill/test 库**(prod/Neon 恢复=founder 带外操作,脚本永不碰)。
  真跑会把 dump 恢复进本地一次性库并对账 `CreditLedger`/`CreditAccount` 行数(钱的真相)。

## 工程侧已备 vs 等 founder 执行(P0-1 收口清单)
**✅ 工程侧已备(代码/文档,已入仓)**:
- 夜间 `pg_dump→gzip→R2` 备份逻辑 + exactly-once/失败自愈/口令不落 argv(`apps/worker/src/db-backup.ts`)。
- 备份纯逻辑单测 18 例(`apps/worker/src/db-backup.test.ts`)。
- 恢复步骤 + 双层保险 + 两个恢复窗口(本 runbook)。
- 备份计划 dry-run 工具 + 恢复演练脚本(见「工具」节)。

**⏳ 等 founder 执行(平台/生产侧,agent 不做)**:
- 在 worker 生产环境置 `STORAGE_DRIVER=r2` + `R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET`
  (与内容存储同一族 env、同一 bucket,备份走 `backups/` 前缀,无需另开 bucket)——置齐后夜间备份才真正生效。
- 在 Neon 控制台设定/确认 PITR history retention 天数,并回填上「两个恢复窗口」表。
- 跑一次真实恢复演练(用 `--apply` 指向本地 docker 库,dump 取自 R2 当晚快照)+ 观察备份连续 7 天绿
  = P0-1 验收(MASTERPLAN)。
- prod R2 bucket `artlio→fikirtive` 对象迁移(B0-84,founder 排期,与本备份独立)。
