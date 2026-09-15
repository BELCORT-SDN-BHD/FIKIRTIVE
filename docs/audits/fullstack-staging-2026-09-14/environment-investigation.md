# 第三轮：环境只读核查

2026-09-14 查询。只读 worker；未生成、上传、发信、读取 OTP/cookie、部署、修改变量或注册 SSH key。变量与日志在内存内筛选，只记录以下结论。

## 可执行结论

当前 staging 是真实 BytePlus 生成环境，不能称 $0 mock。Web 与 wait 版本已核；compute 版本仍 Unknown。数据库目标隔离已核，存储路由隔离已核，**存储凭据权限只覆盖 staging 尚未证明**，因此依 `docs/runbooks/staging.md` 暂不放行上传/生成。可以继续不涉及上传及外部作用的既有页面走查。已有登录会话由主任务现场确认，本文不重复接触身份资料。

## 目标、版本、实际路由

- 首先从主检出执行 `railway status --json`，现场 project 为 FIKIRTIVE（`b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`）。后续 CLI 显式 `-e staging -s <service> -p <project>`；production 唯一操作是经编排者确认的 web 变量只读比较，显式 `-e production`，值不输出。
- staging web deployment `8c521569-f5ab-4126-b462-a4e9ee3120ff` SUCCESS；wait 服务 worker deployment `b1d44a1a-fac4-4d38-a18b-5aff667614f7` SUCCESS；二者 commit `14bcd038b386d6e7d6ad98bbc716aaf018a23314`。
- compute deployment `1473645d-5fbc-412d-b927-99ec99a5322f` SUCCESS；metadata 无 commitHash，带 CLI 上传来源标记；digest `sha256:729d1b7de2eb3bc5191792c07977604393dc991993bb9e48c9e6616a736ea6b3`，与 wait 不同。DB `WorkerHeartbeat` 中 compute.commitSha 亦 null。构建日志中的其他 40 位 SHA 是依赖构建信息，不能当产品版本。**compute exact commit Unknown**；不能宣称三服务同版。
- worker 的 `WORKER_ROLE=wait`，worker-compute 为 `compute`。两者 `GENERATION_PROVIDER=byteplus` 且 BYTEPLUS_API_KEY 存在。`apps/worker/src/generation.ts:26` 调 `createGenerationProvider()`；`packages/generation/src/index.ts:311` 在该值下返回 BytePlusProvider。这是主生成路由证据。web 的 `COWORK_PROVIDER=fal` 不能替代该证据；web 未设 GENERATION_PROVIDER。
- `apps/worker/src/heartbeat.ts` 与 `apps/web/app/api/health/route.ts:69`：拆班各写自己的心跳。旧 `worker` 行对应 `ca864b28…`，属于历史 all-role 行；wait / compute 存活需看各自字段，不能因旧行 stale 就断言两班停工。

## 数据库与存储隔离

- 在内存比较 web/wait/compute 的 DATABASE_URL、DATABASE_URL_POOLED、R2_BUCKET、R2_ACCESS_KEY_ID、R2_MEDIA_BACKUP_BUCKET、R2_MEDIA_BACKUP_ACCESS_KEY_ID，三服务逐项相同。
- staging 与 production web 的直接与 pooled DB URL：host、database name、credentials 均不同。
- staging web DB 与 staging Postgres 服务 DATABASE_URL 的 private host、database name、credentials 均相同。使用该服务 DATABASE_PUBLIC_URL（仅内存）连库，并以 `BEGIN READ ONLY` 查询。现场 server version 为 PostgreSQL **18.6**；transaction_read_only 为 on。私网 URL 本地不可解析（ENOTFOUND），不是数据库不通；public endpoint 已成功查询。
- staging 的 R2_BUCKET 与 R2_MEDIA_BACKUP_BUCKET 名称均显式含 staging，且与 production 对应桶不同；两个 staging 桶分别用自己的配置做 `ListObjectsV2(MaxKeys=1)` 均 HTTP 200；不输出对象元数据或内容。
- content 的 access key / secret 与 production 不同；**media-backup access key 与 production 相同**。这不是生产桶被写入的证据，但不符合“凭据只覆盖该环境”已获证的说法。
- 实际复制路由固定来自 `mediaBackupR2Config()` 的 `R2_MEDIA_BACKUP_BUCKET`（`packages/storage/src/index.ts:905`）；客户端保存这个 bucket，复制 PutObject 明确使用它（同文件 :334、:380–384、:434–440）。因此当前配置的正常内容复制目标是 staging media-backup 桶，而非因 key 共用自动改写到 production。
- **scope Unknown**：未读取 Cloudflare token policy；未对 production 桶列对象或读对象。只凭 key 不同、名称隔离或正向 List 成功，都不能证明 token 不可碰 production。最小下一步是只读查看 Cloudflare 两类 token policy 的 bucket resource scope；如 media key 确实跨环境，需要 Founder 决定接受明确记录的缺口或另行批准隔离凭据修复。本文不自行放行。

## 备份 missing 原因

已确认不是 scheduler 缺失：BACKUP_TRIGGER 未设，wait 角色运行旧 timer；`apps/worker/src/index.ts:393–400` 仅 supervision 角色每五分钟及启动触发备份，当前日志确实每五分钟打印 starting，随即 `media subprocess failed (exit code 1)`。staging 服务实例列表无独立 cron。

- staging app DB 的 BackupRun 第一次查询为 1345 行 failed、零 succeeded；再次查询为 1346 failed。第一次分类中 1322 条是 subprocess exit 1，其余23条未展开原文以避免泄露连接资料。这也表明失败仍在追加。
- `/api/health` 只读取最近 succeeded.finishedAt（`apps/web/app/api/health/route.ts:58`），不存在成功行即 missing；与上述实际数据吻合。
- **强根因假说：pg_dump 17 对 PostgreSQL 18 不兼容。** app DB server 现场18.6；当前 Dockerfile `apps/worker/Dockerfile:18` 固定 postgresql-client-17，注释也明确 pg_dump major 必须 >= server major。compute 当前 build 日志实际安装17.11；wait 部署来自此 Dockerfile/commit。wait 当前可见 build 历史未提取到安装行，因此不把它写成运行中版本实测。
- `apps/worker/src/db-backup.ts:192–199` 的 pg_dump stderr 故意忽略；现有日志只能见 exit code，无法直接证明唯一根因。Railway SSH 被平台拒绝（No registered SSH keys），未添加 key；本地只有 pg_dump16.14，没有17，因此未作本地17对18的复现，也未安装软件或导出 schema/数据。
- 无 R2_BACKUP_ACCESS_KEY_ID/SECRET，DB backup 会沿用 content 凭据；这是配置事实，不是本次 exit1 的已证原因。备份缺失需要修复与恢复验收单独授权，本轮不能宣称恢复能力可用。

## 登录指针与启动条件

产品正常入口为 `/login` 的 Continue with email / Continue with Google。历史测试租户与第二租户的定位在 `docs/audits/fullstack-staging-2026-09-11/run-ledger.md:163–180`，仅为指针，不复用历史 OTP、session 或假定旧余额。本轮主任务已经从正常浏览器确认已有会话；如需要重登，应走正常登录。本文未读取验证码或 cookie，未主动发信。

启动真实生成前还需：①证实 storage token scope 或 Founder 对缺口作明确裁决；②核 compute 代码版本，否则对 compute 路径只能记录版本未知下的现场结果；③使用本轮已批准预算和可付费测试租户、逐笔记账并在16美元暂停；④保留备份缺失为可恢复性验收 blocker。公开页面及当前会话的只读界面检查可继续。staging-live web/worker 的 CRASHED 状态未修复，也未作为替代环境使用。

CodeGraph: not used — 独立 worktree worker 按项目规则直接读取文件；live Git、Railway、SQL 和代码为证据。

## 权限与 compute 身份补查（同日，只读）

按 Cloudflare Wrangler 技能，只使用本机现有 Wrangler 4.128.0 登录；`wrangler whoami --json` 确认 loggedIn=true、OAuth Token。未登录新账户、装插件、查通用密钥文件或注册新凭据。通过常规 `wrangler auth token --json` 在内存取得现有会话凭据，未输出或落盘。按仓库既有 R2 工具的只读 API 路径，对 staging media-backup key 查询 `/accounts/{account}/tokens/{token-id}`：**HTTP403，Cloudflare error code9109**。现有 OAuth 身份无法读取该 token policy；未尝试提权或用其他密钥绕过。

因此 media-backup bucket policy scope 仍 **Unknown**。最小解决步骤是 Founder/现有 Cloudflare 管理员在控制台打开这枚 token 的 policy，核对允许的 bucket resources 并提供脱敏作用域记录；或者另行明确授权已有具 token-read 权限的管理接口完成同一 GET。无需生成媒体、读取生产对象清单、改变量或部署便能完成此核查。当前会话缺的具体能力就是读取 token policy，并非没有 Cloudflare 登录。

重新 `railway status --json` 后，compute 同一 deployment 的 source.image/source.repo、metadata repo/branch/commitHash 均 null；cliCaller=`claude_code`，createdAt=`2026-09-13T11:00:23.559Z`；存在 cliAgentSessionId，但它只定位上传会话，不能证明上传文件的 Git 内容，也不能证明无未提交差异。metadata 没有可证明源代码版本的 upload/source hash。构建日志发现的40位 SHA 在 whisper.cpp 依赖 clone/checkout 阶段，不作为产品 commit。结合 Heartbeat.commitSha=null，**compute exact product commit 仍 Unknown**。最小下一步是核原部署操作者保存的上传目录 HEAD＋dirty status/构建回执；如原回执缺失，则需另行批准可识别版本的部署才能消除此不确定性，本文不部署。

## 死信积压探针交叉核证

主线程公开入口现场 `/api/ops/dlq` 返回503、`{ok:false,deadLetters:"backed-up"}`。本worker读取 `apps/web/lib/dlq-watch.ts` 的直接job计数SQL及 `packages/core/src/dead-letters.ts` 的8条队列名单，在已核staging数据库执行同形READ ONLY聚合：`pgboss.queue LEFT JOIN pgboss.job`，仅计 `state <= 'active'`，返回队列名/数量/最早created_on。未读取payload、job ID或任何tenant细节，未重试或清理任务。

- `gen.dlq`：1条；最早created_on=`2026-09-11 13:02:28.119318+00`。
- `caption.dlq`、`ingest.dlq`、`publish.dlq`、`refgen.dlq`、`render.dlq`、`research.dlq`、`understand.dlq`：各0条。
- 8条队列均存在，合计1条，足以解释backed-up/503。created_on早于本轮，但未读取payload，所以不推定哪个测试、哪个租户或失败根因，也不把它计作本轮新增失败。

该环境运维清空验收仍被历史generation死信阻塞；下一步应在有权限的运维入口确认该任务的最终业务/账本状态，再决定是否需要处理。当前授权不包括清理或重试，本文没有执行。
