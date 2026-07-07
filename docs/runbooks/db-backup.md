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
