# 全栈测试现况与运行计划

日期：2026-09-14。只读调查基准：主检出 `14bcd038`。**调查时测试尚未开始**；调查没有执行 migration、测试、生成、部署或共享 staging 写入。后续本地执行已结束，最终结果见 `automated-checks.md`：首轮quality红灯保留，常驻E2E43通过/1跳过，追加worker链路部分成立并完成结果回看，独占库与进程已清理。下列数量是文件扫描，不能代替通过记录。

## 当前测试资产

| 层 | 当前资产 | 证据 |
|---|---|---|
| 浏览器 | 28 个 journey 文件；43 个普通 `test(` 声明，另有 1 个明确 skip；只有 Chromium、一个 worker、零重试 | `e2e/playwright.config.ts:32-57`；`e2e/journeys/10-broadcast-consent-gate.spec.ts:18-23` |
| Web | 607 个 `.test.ts/tsx` 文件；包含真实数据库集成和 mocked 单元测试，单线程执行 | `apps/web/vitest.config.ts:31-43` |
| 后台 worker | 71 个测试文件；真实 DB 的生成回执、账本守恒、重投、租户、队列、身份验证码回收等；文件串行 | `apps/worker/vitest.config.ts:31-39` |
| 共享逻辑 | core 75、db 44、generation 6、otto 96、storage 6、token-crypto 1 个测试文件 | 各目录 `package.json` 的 test 脚本；各目录文件扫描 |
| 完整工程门 | types、lint、测试、migration/schema drift、价格底线、Otto 目录/知识柜一致性、production web build | `scripts/ci/quality.sh:1014-1069` |

以上普通测试文件共 906 个，数量不表示用例数或全部被 runner 收集；准确收集与 skip 数由下一轮真实运行报告提供。

浏览器覆盖：登录墙、邮箱/Google 两门及返回地址、退出、余额和预扣、费用可追踪、退款幂等、充值货架、消费历史、租户隔离、素材删除/上传/收藏/集合、建项目、画布工具栏/选择/引用、首页布局、品牌分区、Otto 状态和确认卡。CRM broadcast journey 明确跳过，因为正式入口隐藏。

## 不能将现有全绿称为「完整真实生成链路」

- Playwright 仅启动 `@fikirtive/web start`，没有启动后台 worker：`e2e/playwright.config.ts:58-68`。
- 最新 Otto 画布 journey 明确不按 Send、不按生成按钮，而是 seed 对话/确认卡：`e2e/journeys/27-engine-a3-canvas-conversation.spec.ts:79-102`。
- 终态收敛 journey 用 helper 直接写终态，验证页面轮询刷新，不证明真实 worker 跑通：`e2e/journeys/19-generation-terminal-converges.spec.ts:78-90`。
- worker 真库测试可以证明数据库、钱、事务行为，但替换了付费引擎与对象存储：`apps/worker/src/jobs/gen-receipt-db.test.ts:28-46`。
- 真实第三方生成/视频、真实 Google OAuth、邮件投递、Stripe、R2、渠道发布与回执不在这个离线浏览器套件的真实覆盖内。也没有移动端、Safari、Firefox project。
- Otto `evals:check` 不是免费静态检查；runner 调用真实模型，存在单次/累计预算：`packages/otto/evals/runner.ts:4-30`。不得混入无费用全量命令。

## 安全边界与资源冲突

1. E2E 每轮 TRUNCATE public 所有表，必须用本次独占本机临时库：`e2e/global-setup.ts:60-83`。`_test` 名称守卫只验证名字，不验证 localhost；不能只看名字就认为共享 staging 安全（`e2e/support/env.ts:23-36`）。
2. `quality` 自动创建每轮随机库及 worker 专用库，结束时清理自己创建的库：`scripts/ci/quality.sh:900-906,935-978`。不要指定已有他人 `FIKIRTIVE_TEST_DB`；该脚本存在复用已存在库并最终删除的路径。
3. 必须显式清空 `DATABASE_URL_POOLED`。真实 client 优先用它（`packages/db/src/client.ts:35`），quality 只改 `DATABASE_URL`，未清空 pooled 地址；普通 DB guard 也只检查后者。E2E appEnv 已清空 pooled（`e2e/support/env.ts:131`）。
4. E2E 拒绝 shell 中外部服务凭据，并给 Next 明写空串以覆盖 `.env.local`：`e2e/support/env.ts:79-108,121-167`，`e2e/global-setup.ts:74-81`。执行时仍应使用最小环境并检查 env 文件变量名字；不要输出秘密值。
5. 本地 Playwright 默认会复用已运行服务器（`e2e/playwright.config.ts:66`）；独占端口并设置 `CI=1` 禁止复用，避免测到别的构建。
6. quality 使用机器锁 `/tmp/fikirtive-quality.lock`（`scripts/ci/quality.sh:423`），DB pool 默认 4（`:164`）。不要绕锁在同机并跑完整 quality/build；E2E 不受该锁保护，也不要与 quality 争抢 `.next`、dist、CPU 或同一库。
7. 在本轮独立 worktree 构建，顺序先 quality 后 E2E，E2E 用第三个独占数据库。构建产物、上传 `.data`、trace/report 都留在该 worktree。

## 本机准备情况（实际只读检查）

- Node `v22.22.2`，pnpm `10.0.0`，Playwright `1.60.0`；对应 Chromium executable 已存在。根配置要求 Node >=22/pnpm10（`package.json:4-6`）。
- PostgreSQL `16.14 (Homebrew)` 正监听 `127.0.0.1:5432`/`::1:5432`。以本机 `winnin` 角色对 `postgres` 执行 SELECT 成功，`rolcreatedb=true`，无需读取环境秘密。
- `ffprobe` 已安装；worker 有依赖其可用性的条件 skip（`apps/worker/src/jobs/gen-output-dimensions.test.ts:207`）。
- Docker CLI `28.5.1` 在，但 daemon 未连接。仓库 compose 默认占 5432，因此不能再直接启动其 postgres 与现有服务冲突（`docker-compose.yml:7-13`）。本轮可用现有本机 Postgres 的新库，不需 Docker。
- 3399 查询未见监听；机器锁查询未见锁目录。均为调查时快照，运行前重查。

## 下一轮具体运行顺序

以下命令均**尚未执行**。先在独立 worktree 验证依赖已安装，以最小环境运行；所有数据库 URL 固定 `127.0.0.1`，不从仓库真实环境继承。`safe_run` 为下一轮临时 wrapper：环境仅保留 PATH/HOME/locale，加本机测试 URL、`DATABASE_URL_POOLED=''`、`NODE_OPTIONS=--max-old-space-size=6144`、`DB_POOL_MAX=4`、`NEXT_TELEMETRY_DISABLED=1`；所有 `OFF_MACHINE_CREDENTIAL_NAMES`、storage 开关以及构建期上报凭据明写为空。wrapper 在执行前检查 URL host/库名，且不加载 `.env.local`。Next 构建会自读其 env 文件，所以这些空串必须在进程环境中明确存在。

```sh
# 1. 本机专用环境执行完整工程门；quality 自建两个随机临时库。
safe_run pnpm quality

# 2. 创建本轮独占 E2E 库；若名字已存在，另取名字，不能复用或覆盖。
createdb -h 127.0.0.1 -U winnin fikirtive_e2e_round3_20260914_test

# 后续 safe_run 的 DATABASE_URL 切换为：
# postgresql://winnin@127.0.0.1:5432/fikirtive_e2e_round3_20260914_test
safe_run pnpm --filter @fikirtive/db exec prisma migrate deploy
safe_run pnpm exec tsc -p e2e/tsconfig.json
safe_run node e2e/count-journeys.mjs
# quality 已构建同一工作树，无改动时无需再构建一次。
safe_run env CI=1 E2E_PORT=3399 pnpm e2e
```

CI 的浏览器准备顺序同样是 packages build → migration → e2e typecheck → web build → Chromium → E2E（`.github/workflows/e2e.yml:122-145`）。失败留 `e2e/.report` 和 `e2e/.artifacts`；记录当前 commit、环境、真实通过/失败/skip 数与 trace，不重试掩盖红灯。

完整用户请求还需额外验收段：真实浏览器 → Web 动作 → 队列 → 独立 worker → 本机模拟生成/存储 → 成品入库 → 结算/退款 → 页面看见结果；至少覆盖成功、重复确认、失败退款、离页恢复与双租户。当前常驻套件没有该完整闭环，执行前需决定采用既有可运行工具还是增加测试 harness，不能默称已覆盖。真实付费供应商/共享 staging 的验证应另列明确预算、测试租户、允许动作与清理边界；本轮已获开始全面 E2E 的意图授权；调查时真实花费额度、环境配置变更与破坏性测试的具体授权尚未确定。随后 Founder 已批准第三轮计划与真实生成总预算 US$20（US$16 暂停）；本文件所属执行支线仅运行 $0 本地验证。

耗时只能先给计划余量：本地完整工程门加浏览器先预留 30–60 分钟，失败诊断另计；这不是当前代码实测耗时。全链路补充验收还取决于现有接口可用性，不能承诺同一时长。

CodeGraph: not used — worker 按分工使用 rg 与直接文件读取，不借主检出图。
