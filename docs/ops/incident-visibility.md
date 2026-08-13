# 事故可见性与诊断(runbook,不是状态表)

> 仓库能证明探针和 instrumentation 代码存在,不能证明 production 已部署哪一版、外部监控/
> 通知已接线、Sentry DSN 已配置、Stripe webhook 已订阅或告警能送达。每次事故先 live-query;
> 查不到就写 `Unknown`。本页不授予 deploy、rollback、恢复、变量修改或外部服务写入权限。

## 仓库当前可验证的能力

- `GET /api/health` 免登录返回非敏感**存活**摘要,**HTTP 恒为 200**(#796 起):
  `{ ok:true, db:"up|unknown", worker:"up|stale|unknown", workers:{…}, migrations:"applied|failed" }`。
  心跳读取是顺带的(1 秒不回就放弃),读不到只把 `db`/`worker` 写成 `unknown`,**不改状态码** ——
  它回答的是「这个 Web 进程还答不答得出话」,不是「系统健康吗」。
  (#796 之前它在 DB 不可达时回 503;那个行为被移到 `/api/ready`,因为平台的**重启**探针指着
  这个端点,库故障回 503 会把还活着的 Web 重启掉、并让启动迁移一轮轮重试。)
- `GET /api/ready` 免登录返回**就绪**判断:迁移未就位或 DB 不可达 → HTTP 503(平台据此不把流量
  切给这个容器,旧部署继续承载);都正常 → 200。平台的**部署 / 负载**探针指这里。
- worker 心跳超过代码阈值会显示 `stale`;它是诊断信号,不是自动修复或通知保证。
  拆成算力/等待两班之后,每班一行(`worker-compute` / `worker-wait`,未拆时仍是 `worker`);
  顶层 `worker` 字段的含义是「至少一班活着」,按班真相在 `workers` 里。
- `GET /api/ops/dlq` 免登录巡检七条死信队列(#793):HTTP 200 = 七条**全部查得到且一条不剩**,
  503 = 有死信(`backed-up`),或有队列查不到 / 计数读不懂 / 库读不到(`unknown`)。
  只答 clear/backed-up/unknown,不给条数或队列名;计数直接查 job 表,所以 worker 死透了它
  照样出声。接线与生产侧残留清单见 `docs/ops/dashboards.md`。
- web/worker 含 Sentry instrumentation(server 侧 + 浏览器侧),但只有 live environment
  配置生效后才会记录。
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
2. `/api/health` 与 `/api/ready` 各自的 HTTP 状态和完整非敏感 body;超时与 503 分开记录。
   (`/api/health` 恒 200,所以那一头要看 body 的 `db`/`worker`/`migrations`;判「该不该接流量」看 `/api/ready`。)
3. Railway 最近 deployment、restart 与日志时间线。
4. 外部 uptime monitor 是否存在、探测哪个域名、最后成功/失败时间、通知渠道是否已验证。
5. Sentry 是否实际收到同时间窗事件、alert rule 是否存在。
6. 若涉及 Stripe/Meta/其他 connector,现场确认 webhook/subscription/平台状态;代码 handler 存在
   不等于事件会送达。

任何一项查不到都写 `Unknown`;不从 `.env.example`、旧截图或历史 runbook 推断 live value。

## 诊断顺序

1. **Web 无响应/超时:**先看 Railway web deployment 与 logs;此时 `/api/health` 无法替 web 自证。
2. **`/api/ready` 503 `database-unreachable`(或 health body 里 `db:"unknown"`):**核对 DB 平台状态、
   连接与变更时间线;未经恢复授权不执行迁移或 restore。
2b. **`/api/ready` 503 `migrations-not-applied`:**新部署的迁移没跑成,站点正跑在旧结构上,
   旧部署仍在承载流量(#796)。先修迁移,别强推;`/api/health` 此时仍是 200,别据此判断已恢复。
3. **health 200 + `worker:"stale|unknown"`:**查 worker deployment/logs、heartbeat 和 queue;不要把 web 200 报成系统健康。
   拆班之后先看 body 里 `workers` 的哪一行 stale —— 算力班和等待班坏掉的表现完全不同。
4. **health 200 + worker up:**按用户操作时间追 Sentry、应用日志、审计记录和相关外部 provider 回执。
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
