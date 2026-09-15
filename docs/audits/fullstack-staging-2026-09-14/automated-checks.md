# 本机自动验证执行记录

日期：2026-09-14。代码基准 `14bcd038b386d6e7d6ad98bbc716aaf018a23314`。本支线执行已结束，实际供应商费用 **$0**。

**首轮 `pnpm quality` exit 1，不能称整条命令全绿。** 未执行段随后分开完成；三个首败定向复核通过，但未重跑整条 quality。常驻 Playwright 43通过/1跳过。追加真实worker smoke证明确认→入队→独立worker→文件与结算，原页自动收敛因临时脚本断言错误未执行；另一次重新打开同一结果的浏览器检查通过。未改产品代码、公共测试或公共harness。

## 环境与命令

- 独立worktree，没有真实 `.env` 文件。从最小环境启动，固定 Node22.22.2 / pnpm10.0.0；清空 DATABASE_URL_POOLED、外部服务密钥、R2与上报配置。wrapper存 `local-logs/safe-run.py`；每段精确命令、exit、秒数在 `local-logs/results.jsonl`。
- 第一次 frozen install 因 PATH选到Node23.10而被Prisma拒绝（exit1），固定Node22后同命令exit0、28.82秒。未修改依赖锁。
- 所有DB地址固定127.0.0.1；每库均本轮随机新建并独占。首轮quality创建两个库。补跑Web、worker、E2E、诊断与每次smoke均使用自己的库，未并行争抢构建或测试跑道。
- 首轮本机Postgres实测时区 `Asia/Kuala_Lumpur`。其后仅对本轮新建库设置UTC并用新连接确认。CI workflow为postgres:16且不覆盖TZ，但本轮未取得CI live `SHOW timezone`，不冒称已实测CI值。证据 `local-logs/timezone-alignment.log`。

## 真实结果（不重复计算定向复核）

| 套件 | 测试文件 | 首次实际用例结果 | 结果 |
|---|---:|---|---|
| token-crypto | 1通过 | 22通过 | 通过 |
| core | 75通过 | 1755通过、3todo | 通过，有待补项 |
| generation | 6通过 | 235通过 | 通过 |
| storage | 6通过 | 35通过、8todo | 通过，有待补项 |
| db | 40通过、3失败、1跳过 | 681通过、3失败、5todo | 首轮失败 |
| Otto（补跑） | 96通过 | 1699通过、11todo | 通过，有待补项 |
| Web（补跑） | 607通过 | 8232通过、10todo | 通过，有待补项 |
| worker（补跑） | 71通过 | 888通过、1todo | 通过，有待补项 |
| **普通套件合计** | **902通过、3失败、1跳过；共906** | **13547通过、3失败、38todo** | **不能称全绿** |
| 常驻Chromium | 28 journey文件 | 43通过、1既有跳过 | exit0，123.33秒 |

CRM broadcast旅程因入口隐藏而既有skip，不是本轮跳过。todo未算已覆盖。定向诊断的3个通过不追加到上述总数；重跑同一用例不能算新增覆盖。新增smoke与readback也单列，不混进906文件的常驻套件。

工程门：两类安全fence、PR-scope86例、质量腿/docs inventory自检、packages build（91秒）、全仓types（242秒）、lint（133秒）、Otto目录/知识柜、价格底线、mint计划、全新库migration与schema drift全部通过。完整quality耗1349.36秒后因DB失败退出。

随后按顺序直接运行原门的实际命令：`pnpm --filter @fikirtive/otto test`（62.68秒）、Web test（332.72秒）、worker test（105.97秒）、Web production build（155.98秒），全部exit0。Web build有2条既有Turbopack整仓文件trace warning，见 `web-build.log`。E2E migration、`pnpm exec tsc -p e2e/tsconfig.json`、`node e2e/count-journeys.mjs`均exit0。

## 首轮三个失败与单次复核

1. `packages/db/src/consent-runtime.test.ts:429`：期望 `2099-01-01T00:00:00.000001Z`，收到 `2098-12-31T16:00:00.000001Z`，恰差8小时。本机默认时区与夹具UTC语义不匹配。改本轮诊断库为UTC后，仅该例复核通过（exit0）；不列为已证明产品缺陷。
2. `packages/db/src/__tests__/canvas-node-status-check.test.ts:265`：`the settlement never blocked on the ChatThread lock — the race was not forced`。空闲UTC独占库，仅该例一次复核通过（exit0）。首次竞态强制失败仍保留；不能以复核绿声称压力稳定。
3. `packages/db/src/__tests__/canvas-settlement-backlog.test.ts:1781`：1001失败画布、每批200个 `Promise.all` 事务时，`Unable to start a transaction in the given time`。空闲UTC库仅该例一次复核通过，测试本体1.807秒。首次失败时该例15.436秒，整个文件226.878秒。属于运行环境/负载敏感的证据，根因未完全确定；没有改池大小、事务预算或断言。

初败见 `local-logs/quality.log`，复核分别见 `dbrecheck-consent.log`、`dbrecheck-deleted-card.log`、`dbrecheck-pressure.log`。筛选复核显示的其他 skipped 是 `-t` 选择范围，不是从全量删除测试。

## 追加独立worker链路：部分成立，临时runner未全绿

边界：Otto卡是预制fixture；供应商是现成MockProvider，非真实模型。Web是production build，独立worker是 `NODE_ENV=test GENERATION_PROVIDER=mock WORKER_ROLE=all`，同一独占库及本地storage。`ASSET_UNDERSTANDING=off`，未宣称验证素材理解。真实浏览器按Generate；没有直接写GenJob DONE或人工结算。

临时文件保留在 `local-logs/fullstack-runner/`，不加入常驻suite。三次有界尝试：

- 第一次exit1，26.62秒：signIn helper要求到达带首页导航的页面，临时脚本却直接返回画布。截图证实登录已成功。这是runner设置错误。
- 第二次exit1，119.99秒：展示用 `seedPlanCard` 缺model。点击后UI正确拒绝 `This card is missing a model.`，GenJob=0、无入队无扣费。这是展示fixture不能直接用于执行；产品fail closed成立。
- 第三次补齐当前默认model，先用真正 `buildGenRequestFromCard` 和 `genRequest` 校验完整payload，按真实pricing核报价1credit后执行。**确认、真实queue、worker消费、DONE、1 Generation/Asset、本地文件、唯一reserve/settle、余额1000→990、hold0均已通过断言**。随后临时脚本误认为SETTLE必须再扣10，实际为0，因此exit1，29.77秒。代码真相是 `credits.ts:290` RESERVE先扣款；`:679` SETTLE记录差额并释放预扣。这是runner金额分摊断言错误，非产品双扣/少扣。临时脚本已据该来源修正供未来复跑，**本轮没有重跑来覆盖失败**。

第三次有效对象：GenJob `01M2F3CEBPSVJE9131VR51PJ8V`；独立worker日志明确 `DONE → 1 generations via mock`。报价1显示credit=10内部单位；RESERVE的(balanceDelta,reservedDelta)=(-10,+10)，SETTLE=(0,-10)，无REFUND；账户1000→990，reserved=0。文件SHA256与Asset内容哈希一致。

证据：`fullstack-worker.log`、`fullstack-summary.json`（身份/金额/文件/哈希）、`fullstack-evidence.json`（清理前数据库事实）、`fullstack-artifacts/`（第三次失败trace与截图）。前两次trace在 `fullstack-artifacts-attempt1/`、`fullstack-artifacts-attempt2/`，各次exit在results.jsonl。

因为第三次在UI轮询前被上述runner断言中断，**原页无需刷新自动收敛未验证**。经追加授权，只重新启动同库Web，不启worker、不按Generate，重新登录打开原结果：`fullstack-readback` exit0，1例通过（29.78秒），图片可见且naturalWidth>0，当前轮不再Generating。证据 `fullstack-readback.png` 与 `fullstack-readback.json`。这证明再次打开可以看到已交付图片，不能替代原页自动收敛。

## 清理与数据边界

- 首轮quality自己的DROP曾超时；最终检查原两个库已不存在。其余本轮自建7库删除全部exit0。**最终剩余本轮数据库为0**，逐库精确名字/exit见 `local-logs/cleanup.json`。未删除任何既有他人库或改服务器配置。
- 端口3399无监听，按本worktree过滤的tsx/Next服务进程为0；`local-logs/process-cleanup.json`。worker日志有SIGTERM正常退出。没有遗留自建worker/server。
- 本地storage成品、临时runner、截图、trace和报告保留作为审计产物，不上传外部。文本日志已检查常见真实外部token格式，匹配0；全程未读取真实env。日志/trace含固定本地E2E认证secret、合成OTP与临时测试cookie，均对应现已删除的本机数据库，不是外部服务凭据。见 `credential-check.json`。

CodeGraph: not used — 独立worker按规则使用rg、直接文件、测试和本机DB证据。
