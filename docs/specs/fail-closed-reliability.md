# 出问题不装没事（引擎 fail-closed ＋ 报警送达确认）规格书（S1）

> 状态: 已冻结 · v1
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1371 Founder 评论「S1 批准 fail-closed-reliability.md」(2026-09-12)
> 规格前缀: RELY（验收编号 = RELY-A1、A2…，全仓不得与其他规格撞前缀）

合并两票：**A** = #1055（引擎缺配置仍编造理解事实并扣钱）、**B** = #1057 剩余五条（报警只「试着发」就记成「已送达」）。**Founder 已裁 2026-09-12（#1359 场②）**：两票本版做，挡 GO；生产上明写 `GENERATION_PROVIDER=mock` 也一律拒绝，离线演示走 staging。下列证据锚点取自 2026-09-12 只读核证员对主干 `368e9094` 的核证。

## 0. 一句话

引擎没配好、报警没送到、备份没配对时，系统一律停下来说实话——不编造理解结果、不扣商家的钱、不把「试着发」记成「已送达」——商家因此不会为一段捏造的描述付费，我们也不会在商家投诉之前一无所知。

## 1. 九问（S1 grill 的答案）

1. **商家做什么动作、看到什么结果？**
   - 上传素材触发理解（自 MONEY-A9 §7.3 起按件收费）。引擎没配好时，文件停在队列里，显示既有文案 `UNDERSTANDING_PROVIDER_PAUSED`：「That file hasn't been read yet — something on our side needs fixing first. It stays in line and will be read once that's sorted.」（`packages/core/src/asset-understanding.ts:600`，一字不改），预留退回，余额不动。
   - 今天同一场景是反的：标 DONE、给出罐头描述与假商品价（`packages/generation/src/understanding.ts:212-227`，"A product photo from the owner's library." / `products:[{name:"Sample item",price:"RM 10"}]`），并照常扣钱（`apps/worker/src/jobs/understand.ts:832` reserve → `:1383` settle），假事实还写进品牌记忆给 Otto 用。
   - 按生成：生产上明写 mock 时不再交付纯色假图并结算，走既有的拒绝＋退款。
   - 例：商家 Aisha 传 20 张菜品照，运维漏配 `GENERATION_PROVIDER`。今天她拿到 20 条编出来的描述、店铺记忆里多出「Sample item RM 10」、余额少一截；本规格之后她看到 20 条「还没读到，会自己再来」，余额一分不少。
2. **入口在哪里？（列全，含深链）**
   - 商家侧**无新入口**，沿用既有上传与生成路径；操作者侧无新页面。
   - 改动落点：`packages/generation/src/understanding.ts:364-370`（理解端口工厂默认 mock）、`packages/generation/src/index.ts:260-261`（`mock` 短路排在生产拒绝之前）、`packages/core/src/env-contract.ts:600-610`（`GENERATION_PROVIDER` 枚举含 `mock`）与 `:1064-1071`／`:1299-1307`（`SENTRY_DSN` 只验 `new URL()`）、`packages/core/src/founder-alert.ts:110-113`（repeat 时人工渠道直接 suppressed）、`apps/worker/src/jobs/gen.ts:1006-1022`／`:1190-1207`（先写永久标记再发、不读 outcomes）、`apps/web/app/api/stripe/webhook/route.ts:52-70`／`:109-133`（丢弃 outcomes）、`apps/worker/src/backup-cron.ts:32-34`（不走 env 契约）、`docs/ops/telegram-alerts.md`、`docs/ops/incident-visibility.md`。
3. **四态：空、加载、错误、成功各长什么样？**
   - 空／加载：不变（理解行的排队与进行中沿用现状）。
   - 错误（商家侧）：引擎没配好 ⇒ 行停 `PAUSED` ＋ 上面那句既有文案 ＋ 退款；**永不出现** DONE ＋ 罐头内容。生成侧沿用既有拒绝文案，不新增 copy。
   - 错误（操作者侧）：生产进程带非法配置（`GENERATION_PROVIDER=mock`、形状不对的 `SENTRY_DSN`、备份服务缺必需项）⇒ **开机即拒绝启动**并点名变量；走 `FIKIRTIVE_ENV_CONTRACT=warn` 逃生阀起来的进程，由运行时那层再拒一次（两层，不是二选一）。
   - 成功：配置正确时一切与今天一样；`PAUSED` 的行由既有扫描器按 `UNDERSTAND_PAUSED_RETRY_MS` 自动捡回（`apps/worker/src/jobs/understand.ts:556`），配好之后商家不用重传。
4. **数据从哪来、写到哪去？**
   - 引擎选择来自 `GENERATION_PROVIDER` / `BYTEPLUS_API_KEY`。**生产判定沿用代码里现有的唯一信号 `NODE_ENV === "production"`**（`packages/generation/src/index.ts:261`），不新增环境变量、不新增豁免开关。
   - 理解端口工厂照抄生成端口的形状：`byteplus` ⇒ 真供应商；生产上其余一切取值（含未设与明写 `mock`）⇒ 不可用引擎，抛配置类错误，由既有配置类分支处理（重试到上限 ⇒ `PAUSED` ＋ `refundUnderstandingHold`，`understand.ts:879-905`）；非生产 ⇒ 仍是 mock（本地与 CI 一字不变）。
   - `env-contract` 里 `GENERATION_PROVIDER` 的生产合法值收窄为 `byteplus`；`SENTRY_DSN` 增加**形状正则**（`https://<key>@<host>/<projectId>`）。
   - 报警送达：`founderAlert` 的返回值从此必须读——「送到了」= 至少一条通道 `status === "sent"`（`skipped`/`failed` 都不算），与拒付分支现成写法同款（`apps/web/app/api/stripe/webhook/route.ts:368-373`）。未送达则不写「已喊过」的永久标记，由下一趟既有巡检重试；防轰炸照抄 `alertThrottledDaily` 的当日节流（主键 `<throttleId>:<UTC 日期>`，`apps/worker/src/jobs/stripe-reconcile.ts:211-229`）：人工渠道一天最多响一次，Sentry 每趟照收。台账仍写在 `ActionEvent.payload.alertDelivered`（无 schema 变化）。
   - 备份 cron 引入 `assertWorkerEnv`（`apps/worker/src/boot-env.ts`），与 worker 主进程同一份 env 契约。
5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？** 碰。理解按件预留—结算（`reserveCredits` → `settleInTx`）。本规格**不新增任何账本写法、不改价格**：拒绝路径复用既有 `refundReservation`（幂等，且与 SETTLE 由 finalizer 唯一索引互斥，`apps/worker/src/jobs/understand.ts:868-873`），幂等键仍是该行本轮的 `moneyRefId`（`understand.ts:832`）。净效果：本该被结算的假理解，改为预留即退，账本该 refId 净额 0（RELY-A2）。B 部分只动通知，不碰账本。
6. **权限与租户边界是什么？** 不改权限模型。三条边界：① 理解行的所有状态写入沿用既有「条件里带 `ownerId` ＋ 带原状态」的两段式（`understand.ts:562-566`），拒绝路径不例外；② 告警节流／台账行的 `ownerId` 跟**这笔缺口自己的 org** 走，不一律挂 `founder`（挂错 = 外键报错 = 节流写不进去 = 每趟一封邮件，正是要防的事；规矩出处 `stripe-reconcile.ts:208-211`）；③ 告警正文只带 id、金额、org id，不带商家素材内容或文件正文。
7. **参考对照：抄哪家？** 不适用：加固类规格，无 UI 参照（唯一商家可见文案沿用既有常量 `UNDERSTANDING_PROVIDER_PAUSED`）。仓内对照是拒付分支的送达回执写法与 `alertThrottledDaily`，两者都已在主干上跑。
8. **胃口：轻／中／重挡，为什么？** 重挡：改变生产上商家可见结果（DONE＋假描述＋扣费 → PAUSED＋退款），且踩钱路（M1 路径地板必然命中，不可能走轻改）。胃口 **1.5 天**：A 半天（核证员估 S），B 一天（估 M）。超出先砍 B③ 的自动重试，只保留「读回执 ＋ 记未送达台账 ＋ Sentry 留痕」，其余一条不砍。
9. **Otto 怎么协助这个功能？** 不新增 Otto 动作。受益在下游：引擎没配好时不再有假商品与假价格写进品牌记忆，Otto 也就不会把编出来的「Sample item RM 10」当成店铺事实讲给商家听。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| RELY-A1 | 生产配置未设 `GENERATION_PROVIDER`（或设成 `byteplus` 以外的值，逃生阀启动），商家上传一张菜品照 | 理解行停在 `PAUSED` 并显示既有文案「That file hasn't been read yet …」；描述、商品、价格一个都没有；品牌记忆无新增行 |
| RELY-A2 | 同 A1 场景之后查账（**钱守恒**） | 该轮 refId 的预留已退，账本净额 0；商家余额与上传前一字不差；无 SETTLE 行 |
| RELY-A3 | 生产配置明写 `GENERATION_PROVIDER=mock`（逃生阀启动），商家按一次生成、再上传一张图 | 生成被拒并退款，拿不到纯色假图；理解同样停 `PAUSED` ＋ 退款；两者都没有 DONE |
| RELY-A4 | 运维把生产 worker 的 `GENERATION_PROVIDER` 设成 `mock` 或留空后启动 | 进程开机即拒绝启动，报错点名 `GENERATION_PROVIDER`；`mock` 不再是生产合法枚举值 |
| RELY-A5 | 开发者在本地／CI 不设 `GENERATION_PROVIDER` 跑测试与演示 | 行为与今天完全一致（mock 照跑，不联网、不收费），无新增开关 |
| RELY-A6 | 运维把 `SENTRY_DSN` 填成 `https://example.com` 启动生产进程；再换成形状合法的 DSN | 前者开机拒绝并点名该变量；后者正常启动。全程不做任何启动探测外呼 |
| RELY-A7 | 模拟「商家付了钱什么都没拿到」且邮件与 Telegram 双双失败 | 下一趟巡检**再次**尝试人工渠道（不是永久静音）；Sentry 每趟照收；日志写明这一条谁都没收到 |
| RELY-A8 | 同一天内同一条缺口被巡检反复扫到 | 人工渠道当天只响一次，之后走 `repeat`（邮件／Telegram suppressed），Sentry 仍计数 |
| RELY-A9 | 构造 Stripe 付款成功但 metadata 不可用（及金额与套餐不符），且告警一条都没送出 | webhook 仍回 200；台账记 `alertDelivered=false`；下一趟 `stripe-reconcile` 重试；某趟送达后翻 `true` 且不再重试 |
| RELY-A10 | 生产备份 cron 在缺必需 env 的情况下启动；补齐后再启动 | 前者退出码非 0 并点名缺项（不再「起来了但没备份」）；后者照常完成当日备份 |
| RELY-A11 | 打开 `docs/ops/telegram-alerts.md` 与 `docs/ops/incident-visibility.md` | 列出的告警 key 与代码里的 `founderAlert` key 逐条对得上（当场 grep 比对）；两份文档里没有把明文 token 写进命令行的示例 |

## 3. 不做（非目标；写明为什么和触发条件）

- **不做 `SENTRY_DSN` 的启动探测式外呼**，只做形状正则（**实现级立场，编排者定** —— 场⑦未呈 Founder，因不改商家可见行为与钱路；异议可在 S5 提出）。理由：本票的根因是「格式合法 ≠ 是 Sentry 地址」，形状正则正好堵住；探测会把开机可用性押在第三方，一次 Sentry 抖动就变成我们起不来。触发再议：真出现「形状对但项目写错」的事故。
- **不新增任何「允许生产跑 mock」的豁免开关**。Founder 已裁 2026-09-12（#1359 场②）；新开关也会撞机器闸 M4。
- **不改 Stripe webhook 的 200 契约**，重试由巡检承担，不靠 Stripe 重投。
- **不动 staging 的隔离设计与 Railway 变量**：外部状态，另需 Founder 对该次动作授权（见 §4）。
- **不碰理解的计价口径**（T13 族）与告警渠道扩容：分别属 MONEY 家与另票。

## 4. 异议栏

- **最大的风险：「生产」只有 `NODE_ENV === "production"` 这一个信号。** staging 若也以 `NODE_ENV=production` 运行（Railway 上很常见，仓库无法证明），本规格落地当天 staging 的 `$0 mock` 演示会被同一道闸拒掉——Founder 裁定里「离线演示走 staging」的退路当场失效，而发现时点通常是 worker 起不来。落地前必须现场核一次 staging 的 `NODE_ENV` 与 `GENERATION_PROVIDER`（`docs/runbooks/staging.md` preflight 的花费边界条目今天只覆盖 provider，不含 `NODE_ENV`——核法：`railway variables` 只读取键值，照该手册的 target 确认纪律执行），结果写进 §5 变更登记；本规格拒绝用「新增豁免开关」来换这条退路（那正是本票要消灭的东西）。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-12 | **§4 要求的 staging 现场核证结果（#1383 前置，只读）**。查法：`railway status` 确认 project `FIKIRTIVE` / environment `staging`；`railway variables -e staging -s web --kv` 与 `-s worker --kv` 各重定向到临时文件，只 grep `NODE_ENV` 与 `GENERATION_PROVIDER` 两键，读完即删，其余变量一律不回显。结果：① 两个 service 的 Railway 变量里**都没有 `NODE_ENV`**（web 50 个变量、worker 26 个变量，均无此键）——因此「staging 按生产标记运行」在变量层**不成立**，但进程运行时取值（`next start` 自己会把 web 设成 production；worker 镜像的启动命令未核）**未证**，要断言需另查运行进程；② staging **worker 的 `GENERATION_PROVIDER=byteplus`**——也就是说 staging 今天跑的是**真付费引擎**，不是 `docs/runbooks/staging.md` 两级意图表里写的 `mock`/$0。对本规格的影响：本票落地不会拒掉 staging worker 的启动（它已是唯一合法值），§4 担心的「staging 的 $0 mock 演示当天失效」这条退路**在别处已经先失效了**——staging 今天根本不是 $0。离线演示与 staging 花费边界要怎么摆，呈 Founder 另裁（不属本票）。 | |
| 2026-09-12 | 『送达』出现两套定义：§1.4 写『至少一条通道 sent（含 Sentry）』，RELY-A7 要求『邮件与 Telegram 双双失败⇒下一趟再试人工渠道』；实现按 A7 优先（gen 告警的送达判定排除 Sentry），Stripe 购买告警回执沿用 §1.4 含 Sentry 口径——后果：生产配了有效 SENTRY_DSN 时购买告警几乎总算已送达，主动找回只在连 Sentry 也挂时触发。两套口径待 S5 统一裁。 | |
| 2026-09-12 | RELY-A10 生产现场核证（只读，railway variables -e production -s worker 键名）：DATABASE_URL/STORAGE_DRIVER/SENTRY_DSN/GENERATION_PROVIDER/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_ENDPOINT/BYTEPLUS_API_KEY 全部在位；变量层无 NODE_ENV 键（与 A 段核证一致）——生产判定依赖运行时/启动命令，backup-cron 容器的 NODE_ENV 未核，若运行时非 production 则 A10 的 exit(1) 不会触发，S5 演示前需另核。 | |
| 2026-09-14 | **R3-F08**（`docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` 环境漂移登记：CI 服务容器 postgres:16、staging 实测 18.6）：RELY-A10 第二句「后者照常完成当日备份」自 2026-09-04 19:01Z 起在 staging 从未成立——BackupRun 累计 1360 条 failed、0 条 succeeded；根因＝worker 镜像 `pg_dump` 17（`apps/worker/Dockerfile:18` 固定 postgresql-client-17）拒绝 dump 已是 PostgreSQL 18.6 的 app DB（大版本不兼容），且失败时 stderr 被丢弃（`apps/worker/src/db-backup.ts` `stderr:"ignore"`），原始报错从未落盘，此前无法诊断——CI 固定 16 对 16，从未测过这条大版本落差。修复见 PR #1442（客户端 `pg_dump` 升至 18、stderr 截尾按错误类别分类入库、恢复侧加版本闸）。关闭条件：Founder 授权 staging worker 按 #1442 重建部署后，出现第一条 `status=succeeded` 的 BackupRun，且 `/api/health` 的 backup 字段离开 `missing`。 | 2026-09-15 Founder：批准登记；授权合并 #1442 后重建部署 staging worker，以第一条 succeeded BackupRun 关闭 |
| 2026-09-15 | **备份令牌拆分**：staging 与 production 的 media-backup R2 令牌今天是同一个 id（`docs/audits/fullstack-staging-2026-09-14/environment-investigation.md` §数据库与存储隔离已核实：content 的 access key/secret 两边不同，唯独 media-backup access key 与 production 相同），该令牌因此可读生产媒体桶、并读写生产备份桶——staging 只读核查不构成利用，但风险结构性存在，与本规格「fail closed、不越权」方向相悖。 | 2026-09-15 Founder：拆分；staging 改用只碰 staging 桶的令牌；操作手册另开 docs PR（分支 `claude/runbook-staging-backup-token-split`） |
| 2026-09-15 | **R3-F16（候选）画布结算积压扫描可被静默吞掉，积压可能永不清**（源：PR #1451 worker report，本规格未能找到定义该清扫器验收标准的既有条目，`creation-engine.md:147` 2026-09-05 与 `money-engine.md` 均只提及 `canvas-backfill` 的形状/死代码而非其失败语义，故按 fail-closed 精神登记于本规格）：`packages/db/src/canvas-settlement.ts:414` 定义 `CANVAS_BACKLOG_STATEMENT_TIMEOUT_MS = 2_000`，:495 用它对积压扫描 `SET LOCAL statement_timeout`；机器负载高时扫 1001 块板会被 Postgres 用 57014 取消该语句，`apps/worker/src/jobs/canvas-backfill.ts:94-96` 的 `catch` 把这次取消吞掉、只 `console.error` 后 `return 0`（PR 作者称其为刻意的 fail-safe，但对外表现是**没有任何告警**，与本规格「系统一律停下来说实话」的方向相悖）——生产上持续高负载时，这条积压扫描可能悄无声息地永远清不完，且无人知道。PR #1451 本身未改这一段（只把测试的并发形状改成产品真实形状，此发现是顺带记录、未修）。 | 2026-09-15 Founder：本版修 |
| 2026-09-15 | **R3-F19 `/api/health` 永远显示一行没人写的 worker 心跳**（编号取自派工书；本 worktree 的 `docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` 止于 R3-F17，未见该条目，编号出处只到派工书。登记在本规格的理由同上一行 R3-F16：验收表 RELY-A1–A11 没有任何一条定义 `/api/health` 的 `worker`/`workers` 字段——A10 只涉及 backup 那一格——而两个端点的 body 形状登记在 `frontend-baseline.md` §5 的 2026-09-04 两行，本条按 fail-closed「说实话」的精神登记于此）：`WorkerHeartbeat` 是 upsert 表、**没有任何产品代码删过行**（全部 `deleteMany` 都在测试里），所以 #796 拆班后再没人写的旧 `"worker"` 行（`apps/worker/src/plan.ts:192-194` 的 `heartbeatIdFor`：只有 `all` 角色写它，staging 跑 `wait`/`compute`）会**永远**留在响应里显示 `stale`，staging 上已冻约两天。后果：`docs/ops/incident-visibility.md:92` 让值班人「先看 `workers` 里哪一行 stale」，一个永远 stale 的幽灵行把这条 runbook 训练成「那行不用管」，真死一班时同样的 stale 没人再当回事；`docs/ops/dashboards.md:149` 的关键字监控同理（该行文档写的关键字是 `"worker":"up"` 缺失即告警，不是 `"worker":"stale"`）。**本次行为变化**（2026-09-16 复核改定，见下一段）：`apps/web/lib/health.ts` 新增 `WORKER_RETIRED_MS = 24h` 与 `workerRetired()`，并给按班状态加**第三个词** `retired`——超过 24 小时没人写的行在 `/api/health` 的 `workers` 里报 `retired` 而不是 `stale`，在 `/api/build-info` 的 `worker[]` 里多带一个 `retired: true`（该端点的行形状因此从 `{role,sha,at}` 变成 `{role,sha,at,retired?}`，`frontend-baseline.md:112` 登记的那份形状据此扩写一键；退休行冻住的那个 sha 仍然报出来，但带着标签，读的人一眼知道它不是现在跑的那一版）。**仅仅 stale 的行照旧报 `stale`**（「刚停跳几分钟」是这份列表的诊断价值）；顶层 `worker` 的「至少一班 up」算法一字未改，`retired` 既不是 `up` 也不是 `stale`，所以 `docs/ops/dashboards.md` Monitor 1 盯的顶层 `"worker":"up"` 关键字不受影响，而那条永远挂着的 `"worker":"stale"` 子串就此消失；**不删库、不加清扫器**，与 `apps/web/lib/deploy-fingerprint.ts:151-169` 用新鲜度退役旧行、「不需要谁去清库」同一条纪律。全部行都退休时顶层回 `unknown`，与 runbook 对 `stale|unknown` 同一步处置一致（`incident-visibility.md:91`）。<br><br>**2026-09-16 复核改定（跨厂复审 P2，两面镜头一致）**：本条的第一版把超窗的行**整行删掉**。那样做会拿一个盲区换另一个盲区——一班**真的**死了超过一天的 worker 会从唯一的按班列表（`workers` / `worker[]`）里消失，而顶层 `worker` 只要还有一班活着就照报 `up`，于是「死了一整天」反而比「死了六分钟」更难被看见，而前者严重得多；`incident-visibility.md` 又正是把值班人送去看这份按班列表的那一页。要治的是「`stale` 这个词被一行幽灵磨钝了」，不是「这一行不该被人知道」，所以改成**换词不删行**：信息一格不少，词义不再混用。runbook 两页同步写明 `retired` 的含义与处置（该 id 今天还该不该有人写→该写却 `retired` = 一次已经烧了一整天的故障）。 | 2026-09-15 Founder：本轮走查新发现本版全修 |

## 6. 改签记录

- 无
