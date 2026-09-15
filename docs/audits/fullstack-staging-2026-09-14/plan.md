# 第三轮全栈 staging 走查计划（已批准范围，执行中）

日期：2026-09-14。范围决定票：[第三轮范围与预算](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1363)。里程碑：[清账到 GO](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1357)。

批准：2026-09-14，Founder 在本对谈回复「可以，但是除此之外，我还要你自己计划更多真实的测试。」批准本计划范围、六条本轮 GO 口径与 US$20 真实生成预算；累计 US$16 暂停。追加要求已落实为 [real-scenarios.md](real-scenarios.md) 的真实商家旅程及扩展子检查。批准不包含 beta-gate 草稿、尚未裁定的业务口径、部署、线上故障注入、远端数据删除或对外发布。

## 意图与成功条件

验证商家从登录、品牌和素材、Otto 提案、确认花费、生成、查看与下载，到失败退款和恢复的完整链条，并覆盖当前已实现的其他正式页面、后台和队列。每个通过结论必须关联当前代码／部署、真实操作和适用的后端证据；没有跑、只跑半句或环境挡住都不算通过。

最大风险：第二轮只有 9/65 行完整通过，而当前“代码与 CI 已通过”不能替代真实 Google、供应商、存储恢复和告警送达；继续混写会再次产生虚假的 GO。

完整环境证据见 [preflight.md](preflight.md)，自动测试盘点见 [test-inventory.md](test-inventory.md)；下列为规划所需摘要。

## 初始环境快照与后续核证（2026-09-14）

**下方条目保留初始快照，不作为后续Unknown的唯一判断。** 当前权威环境回执见 [environment-investigation.md](environment-investigation.md)：已核staging实际PostgreSQL目标、BytePlus生成路由、桶正常复制路由；旧worker stale是历史all-role心跳。仍未核存储token权限scope和compute精确代码版本；备份连续失败、历史DLQ1条仍存在。故真实生成仍待环境例外选择，预算批准不代替环境授权。

本地主干已快进到 `14bcd038`。编排者读取 GitHub：该版本 E2E CI success（run `34799408266`），postmerge success（run `34769616176`）。这些是独立自动化证据，不直接给本轮现场矩阵记 PASS。

编排者只读 Railway 状态：staging web 与 worker 为 SUCCESS，同版 `14bcd038`；worker-compute 为 SUCCESS，但元数据无 commitHash，独立版本尚待核。staging-live web 与 worker 均 CRASHED，同版；staging-live 不可当健康测试环境。

实际 staging：`https://web-staging-7901.up.railway.app`。

- `/api/ready`：`ready=true, db=up, migrations=applied`。
- `/api/health`：`ok=true, db=up, worker=up, workers={worker-wait:up,worker-compute:up,worker:stale}, backup=missing, migrations=applied, build.sha=14bcd038, build.ref=main`。
- 独立核清 worker-compute 版本、旧 worker stale 的含义与 `backup=missing` 的真实原因前，不宣告全栈健康或 GO。缺备份不能按总字段 `ok=true` 忽略。
- 编排者安全脱敏比对：staging web 的 DATABASE_URL／DATABASE_URL_POOLED／R2_BUCKET／R2_MEDIA_BACKUP_BUCKET 与 production 对应值不同、与 staging worker 相同；staging STRIPE_SECRET_KEY 为 test 前缀，COWORK_PROVIDER 非 mock。这仅证明配置值区分，尚未核 DB 实际身份、桶权限范围、backup missing 原因与 generation provider 路由；不能宣称完全隔离。Google 替身开关和告警渠道仍待核验。不得回显变量全集、令牌或一次性登录码。

## 基础层与现行依据

产品方向为 `docs/BLUEPRINT.md`，第 6 节近期重点为可收费的完整 Creation；第 5 节长期地图不表示所有能力已实现。路线未实现的未来能力不冒充测试覆盖，不因它写在蓝图就新建功能。

继承第二轮 `docs/audits/fullstack-staging-2026-09-11/plan.md` 的执行与判定方法，并保留该轮矩阵全部 65 行逐条来源。历史现行数为 PASS 9 / PARTIAL 29 / FAIL 5 / NOT RUN 22（旧报告:525–540）；本轮全部清零为 NOT RUN。

现行已批准规格：sign-in、brand-product-identity、creation-engine、frontend-baseline、money-engine、otto-engine，以及本版 asset-action-idempotency、tenant-isolation、share-preview、fail-closed-reliability、media-durability、zero-queue。批准记录位于各规格开头；验收按当前文件逐分句核对，变更登记不能漏。

基础层缺口：`docs/specs/beta-gate.md:3–4` 仍是草稿且待批准；#1363 的外部状态仍为调查时 OPEN，但本对谈已批准第三轮计划。不能把本轮批准扩大为 beta-gate 冻结；仍需整理 beta-gate 与收版判据，整理和交叉核对约半天，Founder 拍板时间另计。只读及隔离测试继续进行。

## 覆盖与证据矩阵

`coverage-matrix.md` 含 65 行历史基线、59 行六份新增规格验收、13 组扩展面。扩展面在执行前展开具体步骤，不混成单一通过率。

| 范围 | 已有自动验证入口（存在不代表本轮已执行） | 现场必须补的证据 |
|---|---|---|
| 登录、账户合并、密码面退役 | `e2e/journeys/21-sign-in-and-return.spec.ts`、22、26 | 真实收码、Google 双向账号合并、回调失败、暂停／撤销、大小写两次登录、赠金与审计归属 |
| Brand → Library → @ → 确认卡 | `e2e/journeys/23-brand-product-identity.spec.ts`、24、25 | 真实结果谱系、双向编辑删除恢复、归档不被 Otto 引用、原有成片不变 |
| 花费、退款、防重复提交 | `e2e/journeys/02` 至 `07`；`apps/web/lib/__tests__/asset-action-idempotency.test.ts`、`asset-idempotency-ledger.test.ts` | 双击／断网重发／完成后重放／新意图各核 job 与账本；报价、预扣、结算、供应商实际成本分别对账 |
| 图、视频、variation、分镜、取消、恢复 | 画布旅程 14、16–19、27；worker 的 gen-video 测试 | 真引擎交付、人物与无人物视频、两场景同脸供 Founder 判、下载落盘哈希／尺寸／时长、cap 多入口并发、取消与重连 |
| 租户、员工权限与队列 | journey 09；tenant-guard、tenant-fk-backfill、job-bootstrap-tenant-frame-db 测试 | 双租户真实读改删和关联拒绝、正常正对照、七队列、员工审计；不得真实发布或充值外部账户 |
| 分享、故障诚实与告警 | share-preview、生产配置与告警行为测试 | Range 大对象、撤销立即失效、遥测无 token、限流存储故障恢复、真实告警送达（通知目的地须授权） |
| 备份恢复与零排队 | media-backup 测试；gen-video-zero-queue-db 等 | 现有媒体演练 `docs/runbooks/media-restore.md:181` 可复核，另核当前差集／哈希；真实四视频不挡短任务、崩溃收敛、账本一致 |
| 设备、可访问性、其他正式页面 | 当前 Playwright 仅 Desktop Chromium，见 `e2e/playwright.config.ts:57` | 手机／大屏、键盘、真实 IME、屏幕阅读器、各已实现页面四态和路由清单、性能与注册邮件 SLA |

自动 E2E 明确不联网（`e2e/playwright.config.ts:19–21`）；Google 签名是替身（journey 26:13），故不能替代真实环境。模拟 production 配置在隔离本地进程测，不能擅改线上生产变量。

## 执行顺序与检查方式

1. **只读 preflight**：核版本、服务、迁移、备份、存储隔离、provider 与费用、邮件／Google／告警夹具。记录独立 worker 版本与 `/api/ready`、`/api/health` 脱敏原文。
2. **本地全栈自动验证**：隔离 worktree、隔离测试数据库、无外部 provider 凭据，跑类型、单元、真实数据库集成、production build 和全部驻留 E2E。记录命令、提交、退出码和日志路径；测试失败与缺环境分开。
3. **真实 staging 商家链路**：使用已授权测试租户，按矩阵逐行执行；每次付费先核卡面和预算，记录 job/refId、输入、结果、RESERVE/SETTLE/REFUND。
4. **扩展设备与可靠性**：手机大屏、键盘 IME／无障碍、双租户、性能、注册并发；故障注入、删除恢复和对外消息按单独明确授权执行。
5. **证据合成与审核**：run-ledger、backend-evidence、findings-catalog、coverage-matrix、report-round3。每个 PASS 逐分句复核；所有链接可定位；只对实际执行范围给 GO／NO-GO。

预估：自动化和资料核对半天；真实链路与设备覆盖 1–2 天；受控故障／恢复与报告半天至一天。缺 Google 夹具、备份或服务故障会延长；不承诺在单次会话跑完。扩展组已拆为 real-scenarios.md 的 31 项子检查；各自可执行，但真实设备、受控账号与故障场景有独立前置。

## 六条 GO 门槛（本轮范围已批准；不改未决规格）

| 门槛 | 可检查的通过条件 |
|---|---|
| A1 商品与人物正确贯穿创作 | 第二轮 FSE-001…007 与本版 FSE-201…211 对应修复复走；引用、付费前尺寸闸、谱系、状态、编辑重试、分镜真实交付成立 |
| A2 无人物视频不回归 | 至少一条成功可播放的无人物视频，输入、尺寸、时长、结果与账本一致 |
| A3 variation 真交付 | 至少一条真实可下载 variation，预扣与结算恰一次、无悬挂金额 |
| A4 花费前后真实一致 | 数量规格引用与报价一致；理解费状态不说谎；余额各面一致；新意图／重放语义正确；成本与扣费分别可追踪 |
| A5 恢复、隔离、可靠性闭合 | 下载落盘、cap 多入口并发、取消、刷新／Back／深链、租户守卫、分享、备份恢复与零排队；不得忽略 `backup=missing`；对应新增规格验收完成 |
| A6 登录全路径闭合 | 真实两扇门和双向同账户、失败回到登录、密码面退役、暂停撤销限流、赠金与审计正确；替身证据与真实 Google 分列 |

任一必需验收 FAIL、NOT RUN、BLOCKED 或未完成分句即 NO-GO；P0/P1、跨租户读写泄露、重扣／悬挂钱、版本无法对应亦 NO-GO。不可构造 Google 未验证账户、成本阈值等若需改变原验收，由 Founder 裁定，不能执行者静默删条。GO 仅对本轮已批准范围；不等于生产部署或收版授权。NO-GO 报告必须分列产品失败、尚未执行与环境阻塞：未测不能写成产品坏了，环境缺口也不能写成产品已通过。

## 预算与授权边界（2026-09-14 批准）

真实生成调用预算 **US$20 上限已批准；累计 US$16 必须暂停呈报，US$20 必须停止**。规划 worker 未产生任何真实调用；实际执行和余额以 run-ledger 为准。视频并发与全量规格可能超额，先按卡面／供应商单价编排，80% 暂停呈报，100% 立即停止。牌价估算和实际账单分列，不声称 US$20 必定覆盖全部项目。

生成已获上述限额批准；仍待明确：测试账号与邮件／通知目的地；共享存储若仍存在的写入豁免；SIGNUPS_PAUSED 切换、注册批量／失败注入、进程崩溃、限流存储故障；staging 指定对象删除恢复。历史 #1330 或探针预算不自动沿用。production 零写、零删除、零发布；线上部署另批。

## 必须呈 Founder 的未决验收

- `zero-queue.md:51`：探针超容排队、expired 与队列满错误未完成，接受有限证据还是补测；该行估计另需约 US$1.95 只覆盖超容样本，并非完整探针预算。
- `tenant-isolation.md:82`：MembershipRole 复合外键暂缓，TENANT-A7 此项仅部分通过，不能自动豁免。
- `fail-closed-reliability.md:73`：生成告警与 Stripe 告警“送达”含不含 Sentry 两种口径未统一；:72、:74 的运行时与环境假设需现查。
- `asset-action-idempotency.md:74`：刷新／第二标签页再按 Regenerate 为新意图新扣费，变更登记待过目。
- `beta-gate.md:3–4`：上线闸仍待批准；本轮范围在当前对谈已批准，但收版标准未定，历史地图的 S1/S5 手册规则已被项目 2026-09-13 裁决替代，不能据旧 issue 恢复旧流程。

CodeGraph: not used — worker 按项目规则用 rg 与直接读文件；GitHub 三票只读现查。其他 session 的旧 worktree 只报告保留，本计划不清理。

## 追加变更登记

| 日期 | Founder 要求 | 落实与边界 |
|---|---|---|
| 2026-09-14 | 「可以，但是除此之外，我还要你自己计划更多真实的测试。」 | 批准现有计划与 US$20 真实生成预算，16 暂停；主动增加跨功能真实旅程、扩展组子检查。保留既有验收来源，不新增产品行为、不改业务阈值、不承诺预算足够全量；部署、线上故障注入、远端删除未授权。 |

手机范围补充：wave2-shell.md:403批准desktop-only，窄视口检查属本轮探索，不因测试范围批准自动要求新手机设计或判桌面回归。工具截图可见测试邮箱，持久化／外发前须脱敏；未完成全审计秘密扫描。
