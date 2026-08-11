# 数据库夜间备份(P0-1②,判决 7-1 = ③;#794 备份可信化)

## 谁触发(#794 ②:定时器 → Railway cron)
`BACKUP_TRIGGER` 一个变量决定,永远只有一个触发方在跑:

| `BACKUP_TRIGGER` | 谁跑 | 什么时候 |
|---|---|---|
| `cron`(**目标形态**) | Railway cron 服务,启动命令 `node apps/worker/dist/backup-cron.js` | cron 表达式说了算(见下) |
| 未设 / 其它值(旧形态) | worker 自己的 5 分钟循环 | 吉隆坡时间 ≥ 03:00 的第一个 tick |

**为什么要搬**:定时器把整个系统里最重要的一张安全网,挂在了最不可靠的一根钉子上 ——
一个同时在跑生成、发布、渲染的长驻进程。它在 03:00 那一刻正好在崩溃重启、被 OOM 杀掉
或者正在部署,当晚的备份就不会发生,而且**没有任何东西会说这件事**。cron 是独立调度器,
有自己的运行历史:漏跑会在 Railway 的运行列表里留下一条红的,而定时器漏跑不留任何痕迹。

**Founder 侧配置(Railway 控制台,agent 不碰)**:
1. 在 worker 服务上置 `BACKUP_TRIGGER=cron` —— 这会让 worker 的定时器路径变成 no-op。
2. 新建一个服务,**用同一个 worker 镜像/同一份仓库**,环境变量与 worker 一致
   (`DATABASE_URL` / `STORAGE_DRIVER=r2` / `R2_*` / `SENTRY_DSN` / `BACKUP_TRIGGER=cron`)。
3. 该服务的 Start Command 改成 `node apps/worker/dist/backup-cron.js`。
4. Cron Schedule 填 `0 19 * * *` —— UTC 19:00 = 吉隆坡 03:00(KL 是 UTC+8,无夏令时)。
   Railway 的 cron 按 UTC 解释,别填 `0 3 * * *`。
5. 手动跑一次确认:该服务运行一次应当退出码 0,日志出现 `[backup-cron] ok: backups/db/…`。

cron 入口的行为:**不再检查 03:00 窗口**(cron 表达式本身就是窗口,再检查一次会把
founder 的手动补跑悄悄吞掉),但**保留当天 key 已存在就跳过**的 exactly-once 闸,
所以同一天重复跑是廉价的 no-op,不会产生第二份 dump。真失败才退出码 1 ——
Railway 上一条红的 cron run 就一定意味着「备份坏了」,而不是「这不是生产环境」。

## 跑什么
- `pg_dump --format=custom --no-owner --no-privileges` → gzip → 上传
  (`apps/worker/src/db-backup.ts`)。连接串只经 PG* 环境变量传,永不进 argv,
  所以任何日志/异常里都不会带出口令。
- 只在 `STORAGE_DRIVER=r2` 时生效;本地开发(local driver)自动跳过。

## 备份放在哪 + 用哪把钥匙(#794 ④)
- key:`backups/db/fikirtive-<YYYY-MM-DD>.dump.gz`(吉隆坡日期)。
  `backups/` 前缀在 `u/<ownerId>/` 内容寻址方案之外,`/files` 路由只认 `u/` key
  —— 备份对浏览器永远不可达。
- **凭据**:默认与内容存储共用 `R2_ACCESS_KEY_ID`。这是债 #2 点名的一半问题 ——
  偷到应用那把钥匙的人,同时也拿到了那些本来用来在内容丢了之后救命的备份。
  置上 `R2_BACKUP_ACCESS_KEY_ID` + `R2_BACKUP_SECRET_ACCESS_KEY`(必须成对,
  半套是硬启动错误、绝不静默回退到共用钥匙)后,备份改用单独铸的 token 写。
  `R2_BACKUP_BUCKET` / `R2_BACKUP_ENDPOINT` 可选,默认沿用内容的。
- 用了哪一族凭据**记在每一行 `BackupRun` 上**,admin 面板报的是「上一次真的用了什么」,
  不是「现在 env 里配了什么」——后者会在改配置但没重启时说谎。

**Founder 侧配置(Cloudflare 控制台,agent 不碰)**:
1. R2 → 目标 bucket → Settings → 打开 **Object versioning**。
   有了版本历史,即使 token 被滥用发起删除,旧版本仍在 —— 这是「只写 token」真正的底。
2. R2 → Manage R2 API Tokens → 新建 token,权限 **Object Read & Write**,
   **Specify bucket** 只勾这一个 bucket。把 Access Key ID / Secret 填进 worker 与
   cron 服务的 `R2_BACKUP_*`。
3. **保留策略的取舍**:R2 的控制台 token 目前不能按前缀(`backups/`)细分,
   也没有「纯只写」档。所以两条路二选一,别两边都留着:
   - **(推荐)** token 给 Object Read & Write,代码继续做 30 天裁剪。versioning 兜底删除。
   - token 收成只读+写不删(或用 R2 lifecycle rule 做裁剪):代码里的裁剪会失败,
     但**失败只影响裁剪、不会把当晚成功的备份记成失败**(#794 已把两件事拆开,
     裁剪失败单独进日志/Sentry)。

## 保留策略
- 上传成功后清理:`backups/db/` 下 key 里日期早于 30 天前的对象删除。
  只按 key 命名匹配删,不认识的对象一律不碰。
- 裁剪失败**不改变当晚备份的成败结论**(#794):dump 传上去了就是成功了,
  删旧文件删不掉是另一件事,分开记、分开告警。

## 新鲜度怎么看(#794 ③)
每次备份尝试(成功与失败)都往 `BackupRun` 表落一行,append-only,永不改写。
「最近一次 `succeeded` 行的 `finishedAt`」就是新鲜度的唯一依据 ——
一次失败绝不会把上一次成功从面板上抹掉。

| 看哪里 | 看到什么 | 谁用 |
|---|---|---|
| `GET /api/health` | `{"backup":"fresh"\|"stale"\|"missing"\|"unknown"}` | 外部监控。关键词告警建议盯 `"backup":"stale"` 与 `"backup":"missing"` |
| `/admin/system` → Database backup | 距上次成功多少小时、dump 多大、跑了多久、哪个 trigger、是不是隔离凭据、之后有没有失败过 | Founder |
| `/admin`(首页 risk signals) | Database backup 一格,stale/never 时变红 | Founder |

- **门槛 30 小时**:备份每 KL 日一份,24 小时是节拍本身,留 6 小时余量吸收
  「跑晚了/重试了/部署窗口错开了」。漏整整一晚 = 48 小时,远超门槛,必被抓到。
- **/api/health 的 HTTP 状态码不受备份影响**:备份不新鲜不代表站点宕机,
  算进 503 会让现有 uptime 监控在一次跑晚时误报整站故障。
- 这个端点免鉴权,所以只吐三个词:不报 key 名、不报大小、不报时间戳。细节去 admin 看。

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
