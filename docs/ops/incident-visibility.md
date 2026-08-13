# 事故可见性与诊断(runbook,不是状态表)

> 仓库能证明探针和 instrumentation 代码存在,不能证明 production 已部署哪一版、外部监控/
> 通知已接线、Sentry DSN 已配置、Stripe webhook 已订阅或告警能送达。每次事故先 live-query;
> 查不到就写 `Unknown`。本页不授予 deploy、rollback、恢复、变量修改或外部服务写入权限。

## 仓库当前可验证的能力

- `GET /api/health` 免登录返回非敏感健康摘要:DB 可达时 HTTP 200 +
  `{ ok:true, db:"up", worker:"up|stale|unknown" }`;DB 不可达且 web 仍能响应时 HTTP 503。
- worker 心跳超过代码阈值会显示 `stale`;它是诊断信号,不是自动修复或通知保证。
- web/worker 含 Sentry instrumentation,但只有 live environment 配置生效后才会记录。
- 管理面代码包含 `/admin/system`、`/admin/cost`、`/admin/audit`;能否访问及数据是否新鲜必须
  在当前部署和权限下验证。
- `/admin/queue`(#779)只读生成队列指标库,回答「队列堵没堵」。未配置 `QUEUE_METRICS_QUERY_URL`
  时页面显示 "Not connected" 且一次外呼都不发;能否读到必须现场验证,不能从本页推断。

## 两套监控并存,互不替代(#779 stack 声明)

- **供应商侧队列指标库**(`/admin/queue`):只观测生成队列本身——等待条数、排队时长、并发、
  成功率、失败原因、取消/过期、时长、回调速率。
- **应用侧监控**(Railway、`/api/health`、worker 心跳、Sentry):观测我们自己的进程。
- 两者 coexist:队列指标库看不见我们的 web/worker 是否活着,应用侧监控也看不见供应商队列排了
  多长。任一侧「绿」都不能代表另一侧健康,汇报时必须分开说。
- 计费按上报量;我们对**指标库**只查询、从不写入,未配置即零成本。接线后第一周须核对一次真实账单。
- **对我们自己的数据库,口径要说准**(#779 判官 r1 P2-3):指标层(`queue-observability.ts`)
  一个字都不碰数据库;但页面的 `requireRole` 会读 `UserRole`,**拒绝时**按平台既有安全审计写一行
  `ActionEvent`(`rbac.deny`)。那是全部受控管理面共用的既有行为,本票不改它,只是不再说成
  「零数据库访问」。事故时按 `rbac.deny` 查谁被挡在门外,和查这一页一样管用。
- `PublicQueryBandwidth` / `PublicWriteBandwidth` 为 null(平台默认额度),且我们的服务不在
  供应商内网、走公网端点——生产量级前须查清额度,量大再议。以上三项均为 external state,
  查不到写 `Unknown`。

## 事故开始时先固定 live facts

在 incident issue/记录中写下查询时间和证据,不要回写到本页成为新快照:

1. production 的实际域名、web/worker service 与部署 commit。
2. `/api/health` 的 HTTP 状态和完整非敏感 body;超时与 503 分开记录。
3. Railway 最近 deployment、restart 与日志时间线。
4. 外部 uptime monitor 是否存在、探测哪个域名、最后成功/失败时间、通知渠道是否已验证。
5. Sentry 是否实际收到同时间窗事件、alert rule 是否存在。
6. 若涉及 Stripe/Meta/其他 connector,现场确认 webhook/subscription/平台状态;代码 handler 存在
   不等于事件会送达。

任何一项查不到都写 `Unknown`;不从 `.env.example`、旧截图或历史 runbook 推断 live value。

## 诊断顺序

1. **Web 无响应/超时:**先看 Railway web deployment 与 logs;此时 `/api/health` 无法替 web 自证。
2. **HTTP 503 / `db:"down"`:**核对 DB 平台状态、连接与变更时间线;未经恢复授权不执行迁移或 restore。
3. **HTTP 200 + `worker:"stale|unknown"`:**查 worker deployment/logs、heartbeat 和 queue;不要把 web 200 报成系统健康。
4. **HTTP 200 + worker up:**按用户操作时间追 Sentry、应用日志、审计记录和相关外部 provider 回执。
5. 固定最小复现与影响范围后再提出修复/rollback 选项;执行权限仍由当前 incident task 与项目法决定。

## 通知闭环验收

外部监控、email、聊天或未来 notification channel 只有同时满足以下证据才可报“已接通”:

- live endpoint/事件源已绑定;
- 一次受控测试确实触发;
- 目标收件人/渠道实际收到;
- 去重、升级和恢复通知行为有记录;
- secret/个人资料未出现在 repo 或公开 issue。

未完成受控端到端测试时只能说“代码/配置位存在,送达未确认”,不能承诺会提醒用户或 Founder。

## 诚实边界

- 日志保留期、告警 provider、收件人、Sentry/Stripe/Meta 配置都是 external state。
- Admin 页面与 Sentry 是诊断面,不是生产恢复 authority。
- 事故关闭必须附 live recovery evidence;“已 merge”“已 redeploy”或单次 health 200 都不等于根因解决。
