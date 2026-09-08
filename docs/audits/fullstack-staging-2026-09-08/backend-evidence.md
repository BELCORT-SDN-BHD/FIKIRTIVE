# Staging 后端只读证据 — 2026-09-08

本文件由只读 worker 查询 Railway 与 staging PostgreSQL 后整理。worker 没有触发生成、修改数据库、部署、修改变量或执行清理。浏览器操作由主会话完成。以下时间均为 UTC；本轮边界起点为 `2026-09-08T05:14:22Z`。

## 查询方法与版本

- Railway CLI `5.20.0` 已认证；当前 worktree 未 link。所有查询显式指定 project `b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`、environment `staging` 和 service。
- `railway deployment list -p <project> -e staging -s web --limit 1 --json`：web deployment `a5e48c58-2201-4967-bf1d-7ddb97dc0827`，SUCCESS，commit `0e1f2ab3f1b05fba6112ee9544d6de5930648f83`，branch `main`，创建于 `03:35:49.616Z`，reason `redeploy`。
- worker deployment `fbc0e5fb-8359-40db-8b91-c703007a7bae`，SUCCESS，同一 commit；创建于 `2026-09-06T16:32:16.927Z`。
- staging-live 的 web/worker 最新部署均 CRASHED；本轮没有在该环境执行 E2E。
- 域名从现场变量白名单查询确认：`web-staging-7901.up.railway.app`。`/api/ready` 返回 ready=true、db=up、migrations=applied；`/api/health` 返回 worker=up、backup=missing、build.sha=`0e1f2ab3`、ref=`main`。
- 后续源码调查使用 `git show 0e1f2ab3:<path>`，没有用当前 checkout 冒充部署源码。
- 数据库连接仅在进程内解析 staging Postgres 的连接信息，再通过环境传给 psql；未输出凭据。连接强制 `default_transaction_read_only=on`，`statement_timeout=10000`，仅执行 SELECT。
- 日志按 service、起止时间和 job ID 筛选；证据中不保留签名 URL、连接字符串或 session 数据。
- CodeGraph: not used — worker worktree 按项目规则使用直接读文件与 Git 对应版本。

## 环境边界

首次检查 staging web `GENERATION_PROVIDER=mock`，worker=`byteplus`；web cowork=`fal` 且允许付费 provider。`05:14:22Z` 复查 web 的 generation provider 变量已不存在，部署 commit 未改变。web Stripe key 为 test mode，worker 未配置该 key。

staging web/worker 数据库目标一致；与 production web 数据库目标不同。staging 与 production web 使用相同 R2 endpoint、bucket、access key 和 secret，storage driver 均为 r2。只比较相等性，没有披露秘密值。Founder 在主会话明确允许本轮在共享 bucket 上传及生成，预算 USD20，不清理。数据库目标不同不能替代完整租户隔离测试。

## 本轮关联对象

- ownerId：`founder`
- Canvas：`canvas_adbb6b80-b83c-4502-965e-be4dfe92b9c8`
- thread：`thread_adbb6b80-b83c-4502-965e-be4dfe92b9c8`

| 动作 | 后端证据 | 结果 |
|---|---|---|
| 商品图片 | job `01M1ZQ2Z3K3M8W8YAC0TTN4F1R`；IMAGE、seedream、count=1 | DONE；05:15:39.015–05:16:06.670；spent=true；spentUsd=0.035；billedUnits=1 |
| 图片产物 | Generation `01M1ZQ3T2SW24FDX4P41XRYJ1C`；Asset `01M1ZQ3T2EQ7YRS4NRQV6B4CP8` | source=GENERATED |
| 商品视频 | job `01M1ZQDMXJ0K7H9BXJ41F2ZE39`；VIDEO、seedance-2-mini、count=1 | DONE；05:21:29.025–05:23:09.465；attempts=1；spent=true |
| 视频参数 | sourceGenerationId=`01M1ZQ3T2SW24FDX4P41XRYJ1C`；5s、720p、3:4、audio=false | 与批准商品图及参数一致；tail/reference-video=null，entityIds=[] |
| 视频产物 | Generation `01M1ZQGPAADZS2E052FFP2VNNY`；Asset `01M1ZQGPA2C3NEEKT23AEG3C44` | sentPromptText 有记录；finalPromptText 未提供；params=null |
| 重复上传 | Generation `01M1ZQZHGHFS5HJFBNC7C42M2X`，05:31:15.347 | source=UPLOAD，重用图片的同一 Asset `01M1ZQ3T2EQ7YRS4NRQV6B4CP8` |

视频 worker 日志将 job 关联至队列任务 `3f51ce28-d2ae-48f7-ae2e-60048e787044`，记录 start、try 1。幂等键为 `cowork:01M1ZQD56KPGZV764EEFW279MF`。数据库证明源图 ID；现有回执没有保留实际发给 provider 的完整签名 URL payload。

重复上传重用 Asset，但创建新 Generation。这与部署版 `apps/web/lib/upload-actions.ts:289` 按 owner+contentHash upsert Asset、随后创建 UPLOAD Generation 的实现一致。查询本轮资产的 AssetUnderstanding 为零行，未发现上传相关费用。进一步核实：复用 Asset.source 仍为 GENERATED，upsert update 不改 source；部署版 `apps/worker/src/jobs/understand.ts:179–180` 明确只理解 UPLOAD/IMPORT，`:466` 按 Asset.source 筛选。因此这个重复上传不进入理解队列是现有来源过滤规则的结果，**不是已有理解缓存命中**。不能用此案例证明新外部上传的理解链路成功；若 UI 宣称这张图已经自动理解，则缺少对应理解记录。

## 费用与一次结算

| 引用 | reserve internal | settle 返还 internal | 净扣显示 credits |
|---|---:|---:|---:|
| `otto-stream:01M1ZQ0QXC2VY00SXBD62G8C4G` | 40 | 18 | 2.2 |
| `otto-stream:01M1ZQ2DZYAPDYTBA50WAHFTBH` | 40 | 32 | 0.8 |
| 图片 job | 10 | 0 | 1 |
| `otto-stream:01M1ZQC943B385GEBK756KZ961` | 40 | 11 | 2.9 |
| 视频 job | 110 | 0 | 11 |
| `otto-stream:01M1ZQQQCC95HVNXHGKXWX9CT4` | 40 | 20 | 2 |
| 合计 | | | 19.9 |

图片和视频均各有一条 RESERVE、一条 SETTLE；视频 SETTLE 时间 `05:23:08.767Z`，清除全部110 internal hold。末次账户快照 balance=`99999075` internal，即 `9,999,907.5` 显示 credits，reserved=0；与主会话起始余额 `9,999,927.4` 的差额19.9一致。

`packages/core/src/spend.ts:72–75` 定义100 internal/USD、10 internal/显示 credit；因此本轮商家收费等价 USD1.99，**这不等于供应商实际账单**。图片成本快照 USD0.035；视频快照 USD0.3803821875；合计 USD0.4153821875。视频 provider 回执 billedUnits=109586 tokens，按部署成本钉点 USD3.50/million 推算 USD0.383551；这是公式推算，不是发票。

聊天结算可被 reserve 上限截断，平台可能吸收超额成本；`packages/otto/src/meter.ts` 的 settleCredits 路径证明不能用商家 credits 宣称供应商 USD20 硬上限已被严格验证。采样 web 日志未提供本轮聊天 token/USD 回执。主会话逐笔审批并保留预算余量；未使用延迟的账户汇总冒充单次收据。

## 只规划的双语文案与 typed reference

用户消息 `01M1ZQQQCC95HVNXHGKXWX9CT4` 于 `05:26:59.214Z` 保存，referenceRefs 精确为 `["generation:01M1ZQ3T2SW24FDX4P41XRYJ1C"]`。对应回复 `01M1ZQSSADHBRTZCWKPFWT6318` 于 `05:28:06.734Z` 保存。本轮 thread 仍只有上述两个 GenJob；未新增生成。该时间窗 web 日志没有匹配 skill/search 的记录，但日志缺失不能单独严格证明从未搜索。

## Official avatars 空目录根因

现场查询：founder 的 Entity 全类型总数为0，因此可选官方演员也是0；其他 staging 租户共有10个未删除、catalogKey 非空的 CHARACTER，分属2个租户。

部署版 `apps/web/lib/reference-search.ts:103` 起的 Entity 查询按 authenticated ownerId、deletedAt=null、CHARACTER 限定，再按 `packages/core/src/entity-policy.ts` 的 catalogKey 判据区分官方演员。这里没有 published 标记门槛。由于 founder 没有候选行，空目录符合数据，并非已证明 picker 丢掉存在的行。

部署版 `apps/web/lib/auth-guard.ts:79` 在 founder 分支立即返回；`apps/web/lib/better-auth/converge.ts:59` 起 founder 分支只同步角色/membership，`:83–86` 的非 founder 分支才调用 bootstrapPersonalOrg；`apps/web/lib/auth-guard.ts:315` 才调用 seedActorLibrary。故 founder 重新登录也不会补演员。这是 founder 引导遗漏。部署 Git 树包含 `assets/actor-library/v1` 原件，且其他租户已有播种行，不能将问题笼统写成全局素材不存在。

现有人工补播入口 `scripts/ops/seed-actor-library.ts` 会写 DB/storage；本轮 worker 未运行。源代码路径与行号均指 commit `0e1f2ab3`，当前 checkout 未必对应。

## Brand 保存证据与限制

`E2E Cafe commuters` 保存为 Memory（不是 BrandRecord）`01M1ZQWCNQYDP75JGJ9VG9MHSW`，ownerId=founder，category=audiences，contextStatus=Ready，未删除。创建 `05:29:32.087Z`，更新 `05:30:15.509Z`；BrandContextRevision 于 `05:30:15.517Z` 记录 confirmed，summary=`Saved this context for Otto.`。

其他租户中相同测试标签匹配数为0；这证明当前存储归属，不等于执行过跨租户越权攻击测试。部署版 `apps/web/lib/memory-actions.ts:200–210` 的上下文读取默认限 Ready，显式 preview 才纳入特定 draft。worker 没有在保存前读取历史草稿快照，因此不能仅靠最终 Ready 状态宣称已端到端证明草稿绝无泄漏。

## Edit with Otto 补充回执

主会话报告编辑确认前 Otto 文字声称图片编辑只能1:1，卡片却为1728×2304、3:4。后端 job `01M1ZR6AG91BZ5DGGTEPPFWP3F` 实际保存 imageOptions.aspectRatio=`3:4`，sourceGenerationId=`01M1ZQ3T2SW24FDX4P41XRYJ1C`，于 `05:34:57.558Z` 创建、`05:35:26.487Z` DONE。产物 Generation=`01M1ZR76Q4MFVS5J5R0SDQFW80`，Asset=`01M1ZR76PT2W097VTD1MZ5KHAQ`。

部署版 `apps/worker/src/jobs/gen.ts:1490` 将 aspectRatio 传给 provider.generate；`packages/generation/src/byteplus.ts:271` 调用 imageOutputSizeForModel，`:295`/`:382` 发送该宽高，没有发现图像编辑一律方形的限制。Asset 的 width/height 现场为 null，因此最终图片尺寸由主会话另验，不能从 job 参数倒推成实际产物尺寸。现有证据已确认文字1:1与付款卡片/持久任务3:4矛盾。

编辑 billedUnits=1，spentUsd=USD0.035；一条10 internal RESERVE 与一条 SETTLE（返还0，清除10 hold）。编辑前聊天 `otto-stream:01M1ZR32ECEV5529K6N6BBAE3C` reserve40、settle返还7，净扣3.3显示 credits。累计收费从19.9增至**24.2显示 credits（USD2.42等价）**。三次生成成本快照合计USD0.4503821875；供应商聊天成本不确定性仍适用。

主会话随后通过浏览器 DOM 确认编辑产物为 **1728×2304**；此尺寸证据来自主会话浏览器，不是 worker 的数据库独立验证。它与3:4任务参数一致，进一步反证 Otto 的 square-only 说法。

## 继续验收时的复查与可用回归测试

继续验收复查：web deployment 仍为 `a5e48c58-2201-4967-bf1d-7ddb97dc0827`，SUCCESS，commit仍为 `0e1f2ab3f1b05fba6112ee9544d6de5930648f83`。截至该查询，起点后的账本净扣242 internal、reserved合计0，最后一条账目为 `05:35:26.459Z`；thread共2个DONE图片job、1个DONE视频job。

以下为**部署 commit 中存在的测试**，不是本次审计测试通过记录。worker仅通过 git show 阅读，没有运行这些测试；当前 checkout 与部署 commit 不同，多项测试会初始化/清理测试数据库，不能误用已连接的 staging 数据库。

| 守卫 | 部署版测试路径与用例位置 | 本次实际覆盖 |
|---|---|---|
| 并发重复确认 | `apps/web/lib/__tests__/canvas-variation-confirm-ledger.test.ts:190` — CREATE-A1并发双击只有一组账本；`asset-idempotency-ledger.test.ts:124,189` — Regenerate两次/并发一job一reserve | 没有运行这些测试；浏览器仅批准一次后恢复，查到单组账本，不能称并发攻击已通过 |
| 重复结算/退款竞争 | `packages/db/src/credits.test.ts:112` — second settle no-op；`:165` settle-after-refund；`:234` second refund no-op；`:255` refund-after-settle；`:276` concurrent finalizer winner | 没有运行；本轮成功任务没有主动制造付费失败/退款 |
| 租户边界 | `apps/web/lib/__tests__/library-tenant-isolation-seg2a.test.ts:138,148,158,165` — 双向库隔离、搜索隔离、演员每租户；`e2e/journeys/09-tenant-isolation.spec.ts:14` — 第二商家余额/历史/Library | 没有运行；本轮单founder会话，不替代双租户验证 |
| 新账号演员引导 | `apps/web/lib/__tests__/actor-library-seed.test.ts:120,166,189,210` — 双org各5名、重复播种、真实convergeIdentity、二次登录幂等 | 没有运行；读取测试表明覆盖非founder引导，现场已发现founder分支缺口 |
| 花费上限 | `packages/db/src/credits.test.ts:383,391,472,486,541,559,581` — 恰好上限、超过拒绝无账目、损坏配置拒绝、并发、跨租户上限；`apps/web/lib/__tests__/spend-cap-preflight.test.ts:64,71,115` — 展示单位、fail-closed、按卡片档位定价 | 没有运行；本轮未修改用户cap或人为碰余额上限 |

这些是下一轮可执行的确定性行为检查，不应把“测试存在”写成“当前部署已通过”。需要独立测试数据库及部署commit对应代码才能给出同版本测试结论；本次未安装依赖、创建测试环境或修改配置。

### 后续实际执行：Create variations 快速双击及失败退款

上述测试清单之后，主会话在原图的 Create variations 确认卡（1 credit、3:4、count1）快速双击 Generate。现场后端只出现一个 job `01M1ZRF0D1JWSCZGHN8EX6YCNJ`，同一 Canvas/thread，sourceGenerationId 为原商品图。idempotencyKey=`canvas:41f26b1c957d72e1ba2d6fd5bf7c37b6328a5d5c532014ad98747ccc409ab6bd`，attempts=1。

job 于 `05:39:42.124Z` 创建、`05:40:42.828Z` FAILED；错误为 `generation provider returned only 0/1 usable images`，generationIds为空。worker 日志对应一次 start try1 与该终态错误。spent=true，spentUsd=USD0.035，billedUnits=null；这是供应商已可能计费的失败，不可写成免费失败。

账本恰好一条 RESERVE：`05:39:42.150Z` balanceDelta=-10/reservedDelta=10；恰好一条 REFUND：`05:40:42.843Z` balanceDelta=10/reservedDelta=-10；无 SETTLE。余额恢复至 `9,999,903.2`显示credits、reserved=0。主会话的快速双击没有产生第二个job/hold，且失败退款本轮实际观测通过；这不等同于手工构造并发HTTP请求的竞态测试。

累计商家净收费仍24.2显示credits（USD2.42等价）。包含这次失败在内，生成成本快照增至USD0.4853821875。不能因用户已退款而从平台生成花费中扣掉此次0.035。

## 新注册与失败恢复补充

主会话使用专用E2E邮箱提交注册；worker查询只读账号状态，没有读取密码、验证码或会话token。`05:44:55.409Z` 创建 ba_user `Nffv73OaLPMikdCL47Ll43KuTMwruZmr`，当时 emailVerified=false；canonical User和Membership均无对应行，尚无可查的新租户。此时不能判断演员播种失败：`better-auth/converge.ts:35` 在未验证时直接返回，需正常完成验证后再查组织、赠额与演员。

主会话观测 variation 失败节点出现时 Current turn仍显示上一轮Done，刷新后才显示Failed，Conversation数量17→19。代码支持的待验证原因：部署版 `apps/web/components/canvas/useCanvasGen.ts:837` 的直接动作轮询在失败时更新Canvas节点及余额；`apps/web/components/otto/OttoChatStream.tsx:649` 的对话轮询依赖本地消息推导出的hasWorkingJob。直接动作若未将新卡同步到对话，本地轮询不能启动。此为源码支持的假说，未通过前端埋点完整验证，不能写成已完全证明的根因。

重试缺引用则有直接源码证据：`OttoChatStream.tsx:990` 的canvasRetryDraft仅取latestUserText；`:1146` 调用seedComposer；`:952–961` 仅设置textarea/text，未恢复sourceGenerationIds或referenceRefs。主会话“Edit and retry恢复长提示词，但无附件chip”与此一致。重试不是原任务材料完整恢复；本轮未据此再次发送/付费。

### 邮箱验证后的新租户

主会话通过正常邮件链接完成验证后，现场查到 canonical User `cmts923pm00002mptbuoube0j`，verified=true，组织 `org_cmts923pm00002mptbuoube0j`，membership=active。账户balance250 internal（25显示credits）、reserved=0；只有一条GRANT250，时间 `05:49:25.486Z`，幂等键 `signup:org_cmts923pm00002mptbuoube0j`。

该租户已有5个未删除官方CHARACTER，每个均有baseAssetId及2张有效ReferenceImage：

| 名称 | Entity ID | catalogKey |
|---|---|---|
| Aisyah | `01M1ZS0VASRXB08S0PJGKSJM1V` | actor-v1-aisyah |
| Arjun | `01M1ZS0XRZ3X0S7HDPNCBJF01P` | actor-v1-arjun |
| Rahman | `01M1ZS0YY6BDZV5DWEK1N8RB1P` | actor-v1-rahman |
| Weijie | `01M1ZS0WJEWS4YBEH7P5F5MB50` | actor-v1-weijie |
| Xinyi | `01M1ZS1038NQ1VMVBJKMQ6Y1BX` | actor-v1-xinyi |

本轮真实非founder注册→邮件验证→赠额→演员播种已观察成功；这不替代未执行的并发重复注册测试。该现场结果进一步把空目录问题限定到既有founder引导路径，不能写成全部新用户缺演员。

### 两个自有测试账号之间的 Canvas 深链

主会话在新用户会话直接打开已观测的founder Canvas URL（不带thread），看到空New canvas。DB确认founder Canvas归属仍为founder；新出现 `01M1ZS4SK78YP7JKY9PTM7W4MY` 归属新组织，name=New canvas，创建于 `05:51:36.040Z`。

部署版 `apps/web/components/canvas/ImmersiveCanvasEntry.tsx:107` 先调用getOrCreateDefaultProject，`:110` 只读取当前owner的projects；`:35–39` 在requested项目不属于该列表时选择自己的first/default，`:128` canonical redirect。因此这里行为是创建/回退到自己的Canvas，没有观察到跨账号数据泄露；同时它没有明确呈现“不可访问”，不可将空新画布写成访问原画布成功。

新用户随后创建的实际生成会话为 `thread_63f09f93-c7e6-4185-a6da-476d43d43c2e`，项目 `canvas_63f09f93-c7e6-4185-a6da-476d43d43c2e`；首轮聊天于 `05:52:23.904Z` reserve40 internal。新旧账号费用应分别汇总；新账号GRANT不得抵消审计实际收费。

### 改数量期间的报价等待窗口

主会话在新用户确认卡将count1改为2，观察选择立即显示2，旧1credit Generate仍短暂可点击，随后报价正确变为2；付款前恢复1，没有尝试等待窗口内付款。部署版 `CardOptionControls.tsx:75,88,127` 的busy/pending属于子组件，pending数量先显示，响应返回后才onChanged；父 `OttoTurnCard.tsx:234,347` 的Generate只被独立的父busy禁用。因此混合显示窗口有源码依据，**未验证错误收费或竞态利用成功**。本条只能归为确认一致性风险，不能报成已发生双扣或错误金额。

### 新租户商品图片费用

新用户图片job `01M1ZS883B063F2ADC822925KQ` DONE，创建 `05:53:29.209Z`、完成 `05:54:00.855Z`，产物 `01M1ZS96Z1K7QD7JPMSB5F3E9J`，spentUsd=0.035，billedUnits=1。新租户截至此刻净扣（排除开户GRANT）33 internal，即3.3显示credits，reserved=0；其中聊天2.3、图片1。founder净扣242 internal。因此两账号累计商家收费USD2.75等价，生成成本快照累计USD0.5203821875。

再次核查聊天费用可观测性：当前数据库ChatMessage/ChatThread没有usage/cost/token/model列；部署版stream路由的data-cost读取账本商家费用。meter接收供应商usage并按型号计费，但所检查持久记录和日志没有本轮完整供应商usage。当前有Anthropic凭据配置（只记录存在性），源码含主轮与摘要不同型号腿；这仍不足以计算本轮实际provider USD。**未获得可核对的聊天实际成本，不用客户费用或型号默认值冒充供应商账单。**

### 官方演员＋商品 typed mention 到确认卡

用户消息 `01M1ZSCD0KB45H3NC0GJD084B2`（`05:55:45.301Z`）referenceRefs确有两项：`official-avatar:01M1ZS0VASRXB08S0PJGKSJM1V` 与 `generation:01M1ZS96Z1K7QD7JPMSB5F3E9J`。但其旧payload.sourceGenerationIds为空，entityIds仅Aisyah。后续“显示确认卡”消息 `01M1ZSDJ5ARCBBCYJT6QG350CD` 未附引用。

首张合成起始图卡 `01M1ZSEKJ51KASJHDB9534D65Q`（`05:56:57.542Z`）保存1张、3:4、1credit，entityIds与approvedEntities含Aisyah；**payload不存在sourceGenerationId/sourceGenerationIds字段**。此快照尚无合成job。结论：两项typed mention持久化通过，但此确认卡没有绑定确切商品图；不能从文字提及商品推断provider一定收到它。worker已在审批前向主会话指出此差异。

### Change 表单未发送

主会话点击确认卡Change，在表单输入要求补绑定确切商品图，再点Send to Otto，观察Conversation展开但没有新回复。只读DB快照最新USER仍为 `05:56:23.340Z`、最新AGENT为 `05:57:03.064Z`；没有该修改请求的新消息。

部署版 `CardOptionControls.tsx:359` 调用onSubmit；`OttoTurnCard.tsx:321–323` 关闭表单并调用onChangeSomething(changeRequestSeed(...))；`OttoChatStream.tsx:1146` 转到 `seedComposer:952–961`，只设置输入文字，**不调用submit**。因此Send to Otto标签与实际“填入主输入框”行为不一致有直接代码证据。主会话还观察主输入框为空/修改文字仍留表单，该额外状态尚未完整定位，不将其猜成已证明的事件冒泡问题。

### 修正回复混淆了卡片 ID 与产物 ID

主会话改用主输入框说明商品引用缺失后，新卡 `01M1ZSKRXZ64W9GBGCGQT1WD2R`（`05:59:46.880Z`）仍只含Aisyah entityIds/approvedEntities，没有sourceGenerationId(s)。其prompt声称商品应与reference完全一致，却没有绑定商品产物。

回复中称作商品图/第二entity引用的 `01M1ZS6Z94N92QE2JHD5QT8DV8`，现场按类型查询实际是 **AGENT ChatMessage / GEN_CARD**，不是Generation或Entity。商品真正Generation为 `01M1ZS96Z1K7QD7JPMSB5F3E9J`。

部署 `packages/otto/src/skills/propose.ts:73` 只读取owned Entity；`propose.helpers.ts:895` 将input.entityIds过滤至ownedSet。因此若把该卡片ID放入entityIds，会被丢弃；此处未保存原始tool调用输入，不能宣称已直接观测该参数传递。已证事实是回复ID类型错误、最终卡片商品引用仍缺失。本轮未批准该错误卡片。

### Library 附件恢复后，双引用卡片成立

主会话改用Choose from Library把商品作为实际附件加入，再说明Aisyah后，卡 `01M1ZSPV4ST83PC7M174YBWHZV`（DB时间 `06:01:27.450Z`）同时保存 sourceGenerationId=`01M1ZS96Z1K7QD7JPMSB5F3E9J` 与Aisyah entityIds/approvedEntities。mediaReferences亦包含该商品generationId，role=baseImage、sameCanvas=true；报价1credit、count1、3:4。此卡片与之前仅typed mention的卡片必须区分：**该次恢复确实建立双引用绑定**，尚需job回执证明执行。

新用户在Brand保存的产品是BrandRecord `01M1ZSPTMDDGGHQ0VCHCJ85QWA`，kind=product、nameKey=`e2e coral travel mug`、active/Ready，data.price=`RM 49`。该租户Entity PRODUCT数量为0。部署 `reference-search.ts:54` 将@product只映射至Entity PRODUCT，不查询BrandRecord；因此该Brand产品不会直接出现在@Products。缺口是两个产品记录路径未接通，不能简单归咎搜索关键词。

Profile显示名已保存在canonical User：`E2E Café tester 中文`；ba_user.name仍为初始店名。两表email均非空。主会话观察disabled email字段空白；部署 `profile-names.ts` 返回gate.email、`app/profile/page.tsx:39` 绑定names.email。现有证据排除数据库邮箱缺失，但没有浏览器响应证据定位空白原因，保持未定位状态。

### 官方演员合成成功，随后视频拒收

合成图job `01M1ZSRWZBJ5Q6RV95WV6ZZSYB` 于 `06:02:34.881Z` 创建、`06:03:16.290Z` DONE；sourceGenerationId为原商品 `01M1ZS96Z1K7QD7JPMSB5F3E9J`，entityIds/approvedEntities为Aisyah。产物 `01M1ZST5CQHVX7XZ0KKJ3159EM`；spentUsd=0.035、billedUnits=1，单次reserve10→settle。

接续视频job `01M1ZSVK3CMWZ4754BY4J647MP`，sourceGenerationId为上述合成图，参数5s、720p、3:4、audio=true；`06:04:03.096Z`创建，`06:04:08.073Z` FAILED。错误：`Real human faces aren't supported yet. Pick a cast member from your Library instead. You weren't charged.`。数据库spent=false、spentUsd=null、billedUnits=null；reserve110于 `06:04:03.113Z`，REFUND110于 `06:04:08.087Z`。官方演员来自产品推荐的目录，但合成后接续视频仍被拒，不能将这条核心旅程记为成功。

`06:04:35Z`附近汇总：新用户净扣101 internal（10.1显示credits）、founder242 internal；两者reserved均0，合计收费USD3.43等价。生成成本快照累计USD0.5553821875。失败视频没有记录成本；不把null写成已核对供应商零账单。worker日志 `06:04:58.117Z`出现同队列任务try2重投，不能混淆队列重投次数与实际provider次数。

主会话曾观察原商品节点不见；现场CanvasNode仍有：原商品 `01M1ZS88FGYF4JQP43XBN9GHM1` done，坐标80,80，240×320；合成图 `01M1ZSRXGYY0ABM473M75E2Y82` done，420,80，240×320；失败视频 `01M1ZSVKGW5B5DY79B9XEZWCZA` failed，80,420。原商品与合成Generation.deletedAt均null。因此未丢数据库产物/节点，UI可见性问题仍待区分viewport与客户端投影。

Brand产品新增图片已保存为data.imageAssetId=`01M1ZS96YVR5TTWN4M0F9RSH2Y`。本次关联没有建立Entity PRODUCT，前述@Products来源缺口仍适用。

## 末轮检查与新字节上传理解

`06:12Z`只读复查web/worker均仍为commit `0e1f2ab3f1b05fba6112ee9544d6de5930648f83`、SUCCESS；两个自有测试账号pending GenJob总数0、预留0。官方演员视频FAILED/spent=false/attempts1保持不变，队列try2没有新账目。供应商原始日志可核实HTTP400、code=`InputImageSensitiveContentDetected.PrivacyInformation`，指向输入图content[0]可能包含真人。部署byteplus适配器将此视频提交错误归为permanentInputError；不是客户端凭空拒绝。未复制供应商request标识或完整payload。

新用户会话title=`E2E Product + avatar journey`、pinnedAt=`06:11:42.372Z`已保存。主会话后续刷新看到原商品节点重新出现，补强“客户端显示暂时缺失，数据库节点未删除”的结论。

真正新字节上传：Generation `01M1ZTC1RMZY4S82P69X39AQSK`、Asset `01M1ZTC1RF2ZJ603HXAN02WQGJ`，创建 `06:13:02.352Z`，source=UPLOAD。主会话将输入称为PNG截图；实际存储元数据为image/jpeg、1000×994，此处如实记录，不混同输入描述和落库格式。

AssetUnderstanding `01M1ZTDQ133ZYN713PWQ208CG0`，kind=image-caption，`06:13:56.900Z`创建、`06:13:59.128Z`更新为DONE；inputTokens926、outputTokens51。priceInternalSnapshot=1。账本 `understanding:01M1ZTDQ133ZYN713PWQ208CG0` 于 `06:13:57.912Z` RESERVE(-1,+1)，`06:13:59.110Z` SETTLE(0,-1)，净扣**0.1显示credit（USD0.01收费等价）**。

新用户余额14.8显示credits、reserved=0。两账号累计商家收费增至USD3.44等价；生成成本快照不因本次理解费用增加（理解是另一类动作）。主会话Library detail显示“No credits charged”，这仅能描述上传本身，未表达实际另收的理解费用。与先前GENERATED重复上传被跳过相比，本轮已真实证明新UPLOAD扫描、理解及单次结算完成。

`06:19:17Z`再查web仍为原deployment/commit、SUCCESS。未执行部署、变量修改、数据库写入或清理。

### 只研究Instagram尺寸的聊天回执

新用户USER消息 `01M1ZTZ4F2MFHWSQEZEMA5JXMA` 于 `06:23:27.714Z` 保存，AGENT文本 `01M1ZTZY6R2917CP5EM4WKGM2M` 于 `06:23:54.072Z` 保存。账本reserve40 internal（`06:23:27.769Z`）→settle返还2（`06:23:54.007Z`），净扣3.8显示credits；余额11.0、reserved=0。`06:20Z`后该用户GenJob新增0，符合不生成要求。

初查web日志没有search/read/skill匹配条目；后续发现并查询部署版专用OttoTurnTrace，补齐了工具计数：本轮refId对应modelId=`claude-sonnet-4-6`、steps4、researchWeb calls3/ok3/failed0、truncated=false、settledInternal38。这证明3次工具调用成功返回，不证明3次官方网页内容都抓取成功；工具内部搜索/读取子请求次数没有该表细分回执。主会话报告Help Center访问失败后仍给出确定规格；独立尝试亦429。可记录“当前证据不足却给确定结论”，**不可仅因来源不可达就断言尺寸结论为假**。Working无Stop及“Researching your brand”标签属主会话UI观察，后台回执不证明这些控件行为。

本次新增3.8显示credits后，两账号累计净收费38.2显示credits（USD3.82客户收费等价）；生成成本快照未新增，聊天供应商实际费用限制仍适用。

OttoTurnTrace补查亦修正早前覆盖不确定性：只规划的双语文案turn `otto-stream:01M1ZQQQCC95HVNXHGKXWX9CT4` steps1、toolCalls=[]，现可正面证明该轮没有调用搜索工具。两账号本轮共11条trace，modelId均为claude-sonnet-4-6且未truncated；该表记录工具名/计数与客户settledInternal，**不记录供应商token/USD**，所以实际聊天成本仍未恢复。此前仅检查ChatMessage/Thread和日志的结论应理解为当时证据范围，不是宣称全系统没有动作trace。

### 实际花费上限拒绝及恢复

主会话在新测试组织通过正常UI设置每次上限1显示credit；只读确认Organization.settings.spendCapCredits=1，余额11显示credits、reserved=0。随后从Library对自己的商品图发起11credits Animate，UI拒绝并指出需求11/上限1；截图32为1280×720。

DB按该组织与 `06:29Z` 后时间窗检查：GenJob新增0、CreditLedger新增0，净余额/预留变化均0。拒绝发生在建job及预扣之前；此具体入口的cap执行实际通过，不再属于全部未验证。但它不替代所有入口、并发和损坏配置测试。

恢复期间两次读仍为1；主会话随后完成UI的Remove cap及确认对话框。最终只读确认spendCapCredits=0、余额11、reserved=0。最初查找Save按钮失败是测试选择器未适应Remove cap文案，不作为产品缺陷。此次上限测试无新费用，累计客户收费仍USD3.82等价。

## Round 1 结束版本与费用时间戳

`2026-09-08T06:38:35Z`附近终检：web deployment `a5e48c58-2201-4967-bf1d-7ddb97dc0827` 与worker `fbc0e5fb-8359-40db-8b91-c703007a7bae` 均SUCCESS、commit `0e1f2ab3f1b05fba6112ee9544d6de5930648f83`。web首次CLI查询出现本机config/token刷新错误；一次顺序重查成功，不能把首次失败写成持续已认证。没有重新登录或修改部署。

现场ready=true、db=up、migrations=applied；health报告worker=up、workers.worker=up，build.sha=0e1f2ab3、ref=main，backup仍missing。此为端点状态快照，不代表所有后台队列或备份恢复能力已验收。

两个审计owner的GenJob QUEUED/GENERATING=0、RefGenJob QUEUED/GENERATING=0、AssetUnderstanding QUEUED/RUNNING=0、ResearchJob QUEUED/RUNNING=0；CreditAccount.reserved均0。

| 账号 | 结束显示余额 | 本轮净扣internal（排除GRANT） | 显示credits |
|---|---:|---:|---:|
| founder | 9,999,903.2 | 242 | 24.2 |
| org_cmts923pm00002mptbuoube0j | 11.0 | 140 | 14.0 |
| 合计费用 | — | 382 | 38.2 |

客户收费等价USD3.82；已记录生成成本快照USD0.5553821875（含失败仍记花费的一单），理解与聊天不混入该生成合计。供应商完整发票及聊天实际USD仍未取得。本段仅为Round 1版本/资金退出回执，**不是发布认证、全量安全认证或全E2E绿色结论**。
