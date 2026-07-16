# Staging 使用手册(live-query-first)

> **性质:**安全操作程序,不是 Railway 状态台账。环境是否存在、URL、project/service ID、
> source trigger、部署 commit、数据库、bucket、provider 与变量现值都属于外部状态;每次任务
> 开始必须现场查询。查不到就记录 `Unknown` 并停止相关写操作,不得沿用本文件的旧快照。
> 本文件不包含密钥,也不授予部署、迁移、变量修改或真实花费权限。

## 两级意图(不是 live-state 断言)

| 级别 | 预期用途 | 预期生成 | 账单与数据边界 |
|---|---|---|---|
| `staging` | 日常 UI/流程/回归验证 | `mock`、$0 | Stripe test only;专用 DB 与 storage |
| `staging-live` | production-like 最后一关 | 现场确认的真实 provider | 每笔真实生成先获 Founder 批准;Stripe 仍只用 test;专用 DB 与 storage |

这张表描述 Founder 批准的隔离目标,不证明 Railway 目前符合它。任何一项未核实都标
`Unknown`;尤其不能假设 staging 已与 production 分库、分 bucket、无真钱 key 或已部署某 commit。

## 每次操作前的只读 preflight

在当前 GitHub task/PR 证据中记录查询时间与结果,不要把结果回填成长期 repo 状态:

1. **授权:**当前任务明确允许哪一种动作(只读 QA、部署、迁移或变量变更)。没有授权就只查询。
2. **目标:**用 Railway dashboard/CLI 现场确认 project、environment 和 service。`railway status`
   显示 production、未 link 或歧义时停止;后续命令必须显式带 `-e staging` 或
   `-e staging-live` 以及目标 service,不能依赖上一次 link。
3. **版本:**确认 web/worker 当前部署 commit、source/trigger 和待验证 commit。merge/push 不等于
   deploy;不要根据 GitHub 状态猜 Railway 状态。
4. **数据隔离:**确认 web/worker 指向该环境自己的 DB,并确认 bucket 名/凭据只覆盖该环境。
   任一引用指向 production 或无法证明隔离时停止。
5. **花费边界:**确认 generation provider、Stripe mode 及所有可能产生外部效果的 connector。
   不打印、复制或粘贴 secret 值;只记录经脱敏的存在性/模式结论。
6. **入口:**从 live query 得到域名后调用 `/api/health`;不要使用文档里保存的旧 URL。

## 不可越过的安全规则

- 绝不在 production 环境运行 staging 命令,也不从 link 状态推断 target。
- 不从 production duplicate 新环境后让服务带着复制来的 DB/secret 启动。环境创建或复制是
  单独的外部变更,必须有明确任务、先完成隔离设计并获相应批准。
- staging DB migration 只能打已验证的 staging 专用连接,并使用待验证 commit 自带的 migration。
  production migration 永远不属于本手册授权。
- `staging` 必须证明 provider 为 `mock` 才能称 $0;存在真钱 key 也不能当成 provider 隔离证明。
- `staging-live` 的任何真实 provider/API 调用逐笔询问 Founder;批准一次不等于后续无限使用。
- Stripe 在两级 staging 都只允许 test mode。任何 live/restricted-live key 迹象立即停止并报告。
- storage 未证明隔离时,不得上传、生成或执行清理;“内容寻址所以影响小”不是豁免。
- 不以自动或手动 linkage 的存在为前提。生产部署权限受现行项目法约束;Railway 的实际
  source/trigger 必须现场查询,发现与授权流程冲突就停止并报告。
- 不在 issue/PR/log/命令输出中披露 secret、完整数据库 URL、session cookie 或 access token。

## 验证顺序

1. **静态门:**当前 head 的 required CI 或获准 fallback 结果完整。
2. **健康门:**live 域名的 `/api/health` 返回预期 HTTP;`db` 与 `worker` 字段按响应如实记录。
3. **mock 门(`staging`):**只跑确定性 $0 用例,并用结果证明没有外部 provider effect。
4. **真实门(`staging-live`):**先写清单次预计花费/目的并获得 Founder 批准,再运行一个最小用例;
   记录实际结果和可审计回执,不承诺未验证的质量或渠道状态。
5. **UIUX 门:**按当前 ticket 的页面、用户流程、失败态、权限态和 reduced-motion/accessibility
   acceptance 做浏览器验证;旧 Northstar 文档不能替代当前 acceptance。
6. **退出门:**确认没有后台任务继续花费,记录环境/commit/时间,并把任何 `Unknown` 留在任务证据。

## 登录、日志与故障处理

- 优先使用产品正常登录流程。任何直接改库验证账号的动作都属于单独、显式授权的数据写入,
  不能因为旧 runbook 曾给过 SQL 就默认执行。
- 日志通过当前 environment/service 的 Railway live view/CLI 查询;先确认 target,再读取。贴到
  GitHub 前脱敏 URL query、authorization header、email、cookie、token 与 provider payload。
- `/api/health` 200 只证明 web 能访问 DB;worker 的 `up|stale|unknown` 仍须逐字段解释。
  503 或超时先按 `docs/ops/incident-visibility.md` 诊断,不要盲目 redeploy。
- Rollback、redeploy、变量修改、数据库恢复和外部 connector 写入各自需要当前任务授权;本手册
  只给 preflight/stop 条件,不把操作按钮当权限。

## 每次应留下的证据

- 查询时间、environment/service、部署 commit(无 secret)。
- DB/storage/provider/Stripe 隔离结论: `Verified` 或 `Unknown` 及证据来源。
- 运行的 CI/浏览器用例、真实花费批准链接(如有)、结果与残留后台任务检查。
- 未执行事项与 stop 原因。没有查到的事实必须写 `Unknown`,不能写成“应该”“之前是”。
