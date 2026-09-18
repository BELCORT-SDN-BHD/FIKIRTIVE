# 全栈验收阶段报告

日期：2026-09-14。当前代码基准：`14bcd038b386d6e7d6ad98bbc716aaf018a23314`。本报告记录本轮阶段结果；本轮本地测试进程和专用数据库已清理，真实环境阻塞仍待处理。

## 当前判断

**NO-GO，尚不能宣布全量验收通过。** 已完成的检查提供了实际证据，但真实供应商生成、真实登录双通道、备份恢复等必需分句尚未闭合。未执行不等于产品故障；自动测试通过也不替代真实交付。

Founder追加要求已落实为31个真实场景，覆盖跨页面数据同步、刷新恢复、键盘、窄视口、输入边界、权限、文件实际字节、队列与结算。原65行基线、六份规格59行验收、13个扩展组分别记账，不混成单一通过率。详情见[覆盖矩阵](coverage-matrix.md)、[真实测试清单](real-scenarios.md)及[现场操作记录](run-ledger.md)。

## 已取得的证据

- staging真实创建并改名测试产品，Brand、Library与创作引用看到同一产品；只读数据库核对身份、关系与价格。尚未验证图片编辑、删除恢复或完整生成谱系。
- 历史作品经来源深链、刷新及另一标签恢复；原图实际取回，尺寸1728×2304、3:4，哈希与对象名一致。不是新生成，也不是Download按钮落盘验收。
- 个人姓名实际保存、刷新持久化，再恢复原值。最终账单仍11 credits，无预留，11条流水／9笔扣费。新增产品保留；没有擅自删除远端测试数据。
- 连接页面正确显示未连接／不可用；弹窗关闭后焦点回到入口。工作区空白名称和仅前后空格变化不可保存。普通商家访问两个后台入口均回首页；这不等于全部API或双租户隔离完成。
- 当前Campaign和Schedule入口被有意停放，实际回首页；不把残留页面文件误当开放功能，也不据此报缺陷。

## 自动验证

首轮`pnpm quality`退出1，保留红灯。类型、lint、全新数据库迁移及结构差异检查通过；数据库测试首次681通过、3失败、5todo。失败分别为本地时区差异、竞态未被测试强制触发、千条任务压力下事务启动超时。

后续独占UTC数据库中，三个失败用例各单次复核通过。这说明首次结果受环境／负载影响，不能称产品已被修复，也不能把原quality命令改写为成功。

| 分段 | 本轮结果 |
|---|---|
| token-crypto | 22通过 |
| core | 1755通过、3todo |
| generation | 235通过 |
| storage | 35通过、8todo |
| DB首次 | 681通过、3失败、5todo；一个文件skip |
| Otto | 1699通过、11todo |
| Web | 8232通过、10todo |
| worker | 888通过、1todo |
| production Web build | 通过；2条tracing warning保留在日志 |
| 现有Playwright浏览器旅程 | 43通过、1原有skip |
| 新增真实worker本地链路 | PARTIAL：实际入队、worker消费、DONE、文件与资产、一次扣费结算成立；脚本金额断言错误导致exit1，未运行至原页自动收敛验证。独立只读回看exit0，重新打开可见结果。模拟供应商、预制方案卡，不能代表真实Otto或BytePlus质量 |

命令、退出码、运行时间和清理结果以[自动验证记录](automated-checks.md)及`local-logs/results.jsonl`为准。不同层次测试、重复定向复核不合并为虚假的独立端到端数量。

追加链路前两次未走到执行：第一次临时脚本把登录助手直接送到画布，和助手要求的首页断言不匹配；第二次复用方案卡夹具缺少model，点击后产品正确显示“This card is missing a model.”，GenJob为0、worker未认领。这两次保留失败记录，归为测试夹具准备问题，不宣称产品生成链路故障。

第三次实际任务（`01M2F3CEBPSVJE9131VR51PJ8V`）入队后由独立worker执行为DONE，得到1条Generation、1条Asset及非空本地文件。钱包内部单位1000→990，等于100→99 credits；reserved归零，1次RESERVE、1次SETTLE、无REFUND。脚本错误要求SETTLE再扣10单位，但当前资金规则在RESERVE扣10，SETTLE只释放预留，balanceDelta正确为0（`packages/db/src/credits.ts:290、679`）。因此脚本exit1属于断言错误，不能判产品二次扣费或未扣费。没有重跑新生成；原页实时自动收敛的断言未执行，保留未验证。

同一任务的独立只读回看exit0：重新登录并打开页面后图片naturalWidth>0，当前轮不再Generating。主线程也查看[回看截图](local-logs/fullstack-readback.png)，可见Done、Made 1 image · 1 credit、99 credits及模拟图片。文件SHA256与Asset哈希一致。这个回看证明恢复显示，不补证原页无需刷新的自动更新；蓝色模拟图片不作生成质量判定。

## 产品与体验发现

- **已批准能力缺口：Library产品详情缺少名称／主图编辑入口。** Brand改名可同步到Library，但不能替代规格要求的Library反向编辑。对应PRODID-A4失败，见[问题记录](findings-catalog.md)。
- **姓名菜单同步延迟：**资料页保存成功后菜单仍旧名，刷新才同步。现行验收的刷新持久化分句通过；立即同步是否作为修复项须按体验发现处理。
- **素材弹窗关闭后焦点丢失：**加载中和加载完成后各一次关闭，焦点均落到BODY，未回原素材。规格定位及源码核对另见问题记录，不扩成整项无障碍认证结论。
- **手机宽度探索：**390px视口下展开导航后内容拥挤；当前批准产品为desktop-only，不据此擅自增加手机设计要求。
- 初始Profile邮箱DOM空值与真实截图矛盾，已撤回产品故障推断；不能继续引用为已确认缺陷。

## 阻塞与费用

staging实际数据库与配置桶已核为独立测试目标，实际生成路由为BytePlus。仍有两项证据缺口：媒体备份凭据的资源权限范围未证，compute部署无法对应精确代码提交。用户的US$20预算已批准、US$16暂停；关于接受环境缺口继续真实生成的单独选择尚未收到答复，因此没有执行真实生成或上传理解，**本轮供应商费用US$0**。

备份持续失败且没有成功记录；PostgreSQL服务器18.6与镜像中的pg_dump17存在兼容性风险，但尚未取得运行时stderr证明根因。历史死信1条不归作本轮新增失败。详见[环境调查](environment-investigation.md)。

其余尚欠真实证据包括邮件／Google双向登录、付费图视频与variation、重放／并发钱路、真实供应商费用回执、双租户现场对照、分享撤销、备份恢复、真实设备／IME／读屏及外部告警送达。某些操作还需要明确夹具或单次外部动作授权；不得用本地替身或旧报告填PASS。

## 工作边界

本轮没有改产品代码、部署、修改生产、发送外部消息或删除远端数据。测试和记录位于独立工作树`codex/e2e-round3-20260914`，没有创建或合并PR。线上状态GET可能触发既有Sentry遥测，不能把“没有主动发送通知”写成“完全无遥测”。

本轮9个本地测试库名最终均不存在；自建tsx/Next服务为0，3399无监听。见`local-logs/cleanup.json`与`process-cleanup.json`。日志、临时runner与本地素材留作证据，没有清理其他任务的工作树或数据库。

工具现场截图曾含测试邮箱；尚未形成持久化脱敏截图集。报告中的原图是既有测试产品素材。有限文字秘密检查另行记录，不据此保证所有日志和图片均已脱敏。独立文档核对为同引擎只读检查，不构成跨厂商评审。

同引擎隐私检查快照：2026-09-14 04:34:40–04:34:42 UTC，68个候选文件中扫描63个文本、跳过5个二进制。常见token、private key、带密码连接URL、JWT与Bearer模式未命中；邮箱命中归为保留测试域名或包版本误报。执行中的新trace和后续写入不在结论内；图片及ZIP内部未审。此为有限模式检查，不是完整无秘密保证，也不是可以直接外发全部原始产物的结论。

自动验证执行者的结束检查另见`local-logs/credential-check.json`：常见真实外部token模式0命中；日志／trace保留本机E2E固定认证secret、合成OTP和临时cookie，所对应数据库已删除。原始trace仍按测试认证材料处理，不因其为本地占位就宣称所有产物可无审查外发。

CodeGraph: used — query: "e2e"; index: 主检出更新到14bcd038后fresh；fallback reads: 当前规格、路由、测试配置及本审计目录所引代码。工作树内未建立或使用图。

## Founder 追加裁决：输入附近不再堆叠重复说明（2026-09-14）

**已批准、待下场修复；本场只写报告与规格登记，不修改产品。** Founder 当前截图中的自动理解、自动搜索、对话收费／每轮预留三段长驻说明不必要，同类入口一起处理。移除此类重复常驻段落，不仅藏入 tooltip／折叠区；实际动作报价与确认、交易回执、可操作错误、认证安全和后端计费语义仍保留。本条不是删除全站提醒的授权。

共享来源是 `UnderstandingCostHint`、`SearchCostHint`、`ConversationCostHint`；现码除聊天输入外，还挂在起步页、Otto 门厅、模板／素材上传、素材详情和画布拖放入口。准确源码与挂点、旧测试调整方向见 [问题目录的 R3-F06](findings-catalog.md#r3-f06--输入附近不再堆叠重复费用说明)。三份直接适用规格 `frontend-baseline.md`、`money-engine.md`、`otto-engine.md` 的变更登记已追加带日期的 **批准:／APPROVED** 行，保留旧记录，以本次裁决覆盖旧常驻展示处方。当前仅是工作树文档，仍须按项目规则先以 docs-only PR 合入主干，再施工；未把计划记成已修复。

## 版本收尾仍需实际验收（2026-09-14 核证）

来源为主线程本日 GitHub API 只读回执 `milestones/2`（本 worker 未独立请求）：[v0.2.0 里程碑](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/milestone/2) 仍为 open，开放事项 16、已关闭 36。[当前整理地图](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1357) 的目标包含混合清账、第三轮验收 GO 与 v0.2.0 收版；production 另场。旧正文里的 S1／手册等流程已由项目 2026-09-13 裁决替代，不据旧地图恢复。

16 张开放票包含地图、规格记录、验收及环境事项，不能等同于 16 个未修代码错误。修复完成不等于里程碑可关闭：须实际验收 GO、Founder 验收、开放事项全部关闭或按已批准去处清账，再依项目规则整理 CHANGELOG、tag 与 GitHub Release。本轮仅记录此条件，未执行关票、关闭里程碑、打 tag 或发布 Release。

## 2026-09-15 staging 第二轮（登录态只读）

第二轮走查改用登录态：4 个并行 worker 以 Founder org `founder`（租户 A，super-admin）已登录会话跑只读旅程，build `14bcd038`，全程未登出、US$0、零远端写入（只读证明见证据文件的 `writesMade`）。原始证据入库在 `docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r2/`（`surfaces.json`、`surfaces-verify.json`、`workflow-r2-result.json`）；覆盖回填见 [coverage-matrix.md 本次回填边界（2026-09-15）](coverage-matrix.md#本次回填边界2026-09-15)；七条新发现与两条既有发现的收尾更新见 [findings-catalog.md](findings-catalog.md)（R3-F09–R3-F15；R3-F01 收尾判 RESOLVED，R3-F05 收尾定根因并给出修复 PR #1446）。本文件不重复列出逐条细节。

本轮首次引入独立核证员复核每条自报状态，推翻了 worker 自报的七处：REAL-26／REAL-15 由自报 PASS 降为 PARTIAL，REAL-17／REAL-28 由自报 PARTIAL 收紧为 BLOCKED，REAL-05 的「Enter 绝不自动触发」分句、REAL-08 的「FSE-204 商家侧仍未闭合」分句、REAL-13 的 FRONT-A6 分句均被证伪或撤销。最值得 Founder 先看的两条：①REAL-05 核证过程中，一次未加修饰键的真实 Enter 本会在 US$0／零写入前提下触发一次真实花费（`StartSomething.tsx:288-294`），本轮全程零写入是靠核证员自己清空草稿与只读复核兜住的，不是产品本身的保证；②REAL-28 后台三项写操作（发积分／退款／对账）今日在零写入边界下结构性无法验证，状态是**未证**而非已证 PASS。

## 2026-09-16（一）Founder 三项裁决（对谈）

① **产品自动封面后失效的「Remove from product」菜单项**：追认删除。已随 PR #1462（分支 `claude/prodid-a4-auto-cover`，未合并主干）落地在 `docs/specs/brand-product-identity.md` §5 2026-09-15 行的追加句——该不变量是全量的，一件还挂着基础层参考图的产品永远有封面，「Remove from product」按下去会被同一事务里的 `reconcileEntityCover` 立刻钉回同一张图、按了没反应，故随该 PR 一并撤掉；本报告不重复登记裁决内容，只作出处指针。② **上传理解静默扣 0.1 credit**：上传完在那张图上留一行回执「Understood · 0.1 credits」，不加常驻段落；实现 PR 在飞（分支 `claude/upload-understanding-receipt`，commit `a594a2f4` 及复核修正 `03046f01`，未合并），登记见 `docs/specs/money-engine.md` §5 2026-09-16 行与 `findings-catalog.md` R3-F24。③ **便签 Shift 点文字被踢出多选**：按守卫版修，已合并（PR #1452 的另一支线，最终 HEAD `141a6ba6`，`docs/specs/frontend-baseline.md` §5 R3-F07 相关行已同批更新，本报告只作引用）。④ **staging `TOKEN_ENCRYPTION_KEY`**：Founder 自己跑不回显命令，设到 Railway 的 `worker` 与 `worker-compute` 两服务；两服务补齐前后的 `configFingerprint`（据转述 `970711b2`→`8536b2af`）由编排者读出转述，本文档未独立复核这两个哈希值——**未核**；R3-F18 已关闭，登记见 `findings-catalog.md`。

## 2026-09-16（二）staging 第三轮：真实付费旅程第一组（真供应商，US$20 封顶／US$16 暂停）

Founder 2026-09-15 已授权真实付费旅程；本组「preflight-fixtures」由两个 worker（执行＋核证）串行完成，全程签入身份 tenant A（org `founder`，display name `tools`，super-admin，邮箱脱敏），证据入库 `docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r3-paid/{preflight-fixtures.json,workflow-group1-result.json}`；覆盖回填见 [coverage-matrix.md 本次回填边界（2026-09-16）](coverage-matrix.md#本次回填边界2026-09-16staging-第三轮付费旅程第一组)，逐步骤见 [real-scenarios.md](real-scenarios.md) REAL-03／REAL-12 两行本次更新。

**判定摘要**：P0 PASS；REAL-12 PARTIAL（4 份真实文件上传、理解结算、账本闭环均证成，3/4 文件本地 sha256 与存储字节同哈希，「下载比对」被浏览器 CSP／沙盒挡住而非被产品挡住）；REAL-03 本组 NOT RUN（前置条件「Brand 建测试产品」在 UI 上走不到——根因即 R3-F20 指路死路，worker 已完整枚举 `/brand` 五分区、Library Elements、`@` 菜单三处确认无建产品控件，未绕开产品自身入口伪造流程；路径已查明，修复 PR #1463 合并或另行授权后由后续付费组重跑）；BUILD-DRIFT（本组执行窗口内 staging 自动重部署**四次**：`eed4f079`→`4496bc3b`（PR #1460）→`57ce7ee6`（PR #1455）→`1a03bb71`（PR #1456），执行 worker 原只记到前两跳，核证员事后用未认证 `GET /api/health` 复核出第三跳；每笔操作已按时间戳回溯到具体 sha，但后续付费组须先钉住主干静默期或每组自行核当次 sha，不可默认沿用本组的 build 标签）。

**Money proof**：全天 `CreditLedger` 恰新增 8 行，4 个 `refId`（`understanding:<id>`）各恰 1 条 RESERVE + 1 条 SETTLE + 0 条 REFUND，`CreditLedger_ref_kind_once`／`CreditLedger_finalizer_once` 两条唯一索引结构性防止双扣或结算后又退款；`CreditAccount(founder)` 余额 `99997978`→`99997974`（display 9,999,797.8→9,999,797.4，净 -0.4）、reserved 全程归零；`arkcli usage stats` 当日 4 请求／9308 input／196 output token（单一模型 `seed-2-0-mini`）与产品自身逐行 token 记录逐字段一致。**本组花费**：US$0.00 生成（零新增 GenJob／RefGenJob）＋ 0.4 显示 credits 理解；远低于 US$16 暂停线。

**新发现**（详见 `findings-catalog.md`）：R3-F20（产品指路死路，修复 PR #1463 在飞）、R3-F21（重部署后陈旧 action 404 被误导文案说成商家网络问题）、R3-F22（上传测试视频静默写入品牌记忆事实且来源标注错误）、R3-F23（字节校验只嗅文件头，损坏文件被正常计费理解）、R3-F24（上传扣费当刻无逐动作回执，Founder 已裁按结算后回执处理，即上文 A②）。

**第二至第四组**：待跑，见 `coverage-matrix.md` 同节末尾的排期说明；下一组覆盖 REAL-04／REAL-06／REAL-08，REAL-03 待 R3-F20 解锁后补跑，REAL-09（四长一短并发）待整组报价确认在预算内再执行。

## 2026-09-17（三）staging 第三轮：真实付费旅程 2–4 组（真供应商，US$20 封顶／US$16 暂停）

Founder 2026-09-15 授权的真实付费旅程续跑；PR #1463（R3-F20 修复）与 #1464（上传回执）连同本轮之前累计的其余 25 个 PR 已全数合入主干，build `c0d25917`（本节末「合并台账」逐一核对）。3 个 journeys worker + 3 个独立 verifier 串行跑完第二至第四组（`real-03-person-video`／`real-04-06-08`／`real-10-share-anon`），全程签入身份 tenant A（org `founder`，super-admin）。原始证据入库 `docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r3-paid/{real-03-person-video.json,real-04-06-08.json,real-10-share-anon.json,workflow-groups2-4-result.json}`（后者含三份 verifier 报告，逐条 `checked`／`moneyProof`／`downgrades`）；覆盖回填见 [coverage-matrix.md 本次回填边界（2026-09-17）](coverage-matrix.md#本次回填边界2026-09-17staging-第三轮付费旅程第二至第四组)，逐步骤见 [real-scenarios.md](real-scenarios.md) 对应各行本次更新。

**判定摘要**（verifier 与 worker 不一致处以 verifier 为准，两边都在下方列出）：

- **REAL-03＝PASS**：`/brand/records?tab=products` 可建产品（R3-F20 阻断已消失），Brand 卡片／Library Elements Products／`@` 菜单／确认卡／`GenJob.entityIds`／`approvedEntities`／`Generation.entitySnapshot` 七处同一 Entity id（`PRODID-A1/A2`；2026-09-18 订正：原文写「四处」，与同一份证据在 [coverage-matrix.md](coverage-matrix.md) REAL-03 行与 [real-scenarios.md](real-scenarios.md) REAL-03 行写的「七处」不一致，按逐条枚举得出的七处为准），无首帧合成（三个帧输入列全 NULL、`RefGenJob=0`），交付与报价一致（16:9／5s／720p／静音）。**唯一偏差**：产品封面挂的是商家自己已有的 Library 图，而那张图本身是 AI 生成，不是新上传——本轮 harness 没有文件上传动作，「商家上传真实产品照片」仍未被端到端跑过（登记见 `findings-catalog.md` 本轮补记）。证据：`real-03-person-video.json` 步骤 S01–S17、`verdicts[0]`。
- **REAL-07＝PARTIAL（verifier 改判，非 worker 自报的 PASS）**：worker 自报 PASS，但自己的 `clausesNotProven` 已列出「深链是在终态之后验证的」，违反 PASS 判据；verifier 因此把它降为 PARTIAL——刷新腿确实在生成中（GENERATING）验证过，Back 腿卡在终态边界，深链与第二标签两腿都在终态之后 4 分钟才验证，「回到同一个仍在跑的 job」这条未被证明。已证部分保留：同一 job 全程恰 2 条账本行、四个入口余额一致、慢任务从未伪装失败。证据：`real-03-person-video.json` S10–S12；核证判词 `workflow-groups2-4-result.json` `verdicts[0].downgrades[0]`。
- **REAL-30＝PARTIAL**（手机宽未跑）：1280 与 1920 两个视口下同一张未批准确认卡逐字节一致（引用数、尺寸、credits、按钮文案），切换视口不产生新意图；本组指令范围只到桌面／大屏，手机腿未执行。证据：`real-03-person-video.json` S07–S09。
- **REAL-20＝PASS**（verifier 由 worker 自报的 PARTIAL 升级）：worker 自报 PARTIAL 因 `arkcli usage stats` 当场查零记录；verifier 在 10 分钟后重查拿到 1 条记录——`ModelName dreamina-seedance-2-0-mini`、`ReqCnt 1`、`TotalTokens 108900`，与 `GenJob.billedUnits` 108900 逐位相等，`ReqCnt 1` 同时证明供应商侧也只收到一次调用（无双扣）；worker 的空结果是 arkcli usage 5–30 分钟的查询延迟假象，不是真实缺口。四本账（确认卡／账本／余额差／供应商回执）本组全部对齐。证据：`workflow-groups2-4-result.json` `verdicts[0].findings[0]`。
- **REAL-24＝NOT RUN**（工具缺口，非跳过）：in-app 浏览器工具集没有离线／网络状态模拟动作，本组指令也未含替代步骤，如实标 NOT RUN。证据：`real-03-person-video.json` `verdicts[3]`。
- **REAL-04＝PASS**：无人物商品视频（`entityIds`／`approvedEntities` 只含产品、不含演员）成功可播可下载；同图 Create variations 产出独立可用的新图且原图不动；两单各自恰一组 RESERVE/SETTLE、零 REFUND。证据：`real-04-06-08.json` S01–S14、`verdicts[0]`。
- **REAL-06＝PARTIAL**：B 标签重放同一张已批卡的「零新增账本」半句有硬账本证据（零新增 `GenJob`、零新增账本行、余额不动）；但重放请求本身的服务端正面回执被画布崩溃（R3-F28）吞掉，只能从数据库侧间接证明「请求没有引发第二次扣费」，不能证明「幂等守卫真的处理过这次重放」——本轮不把「零新增行」误读成「守卫被观测到工作」，这两件事分开陈述。终态前的在途重放（ASSET-A5 形态）本组也未发生（图片在 B 标签点击前已完成）。跨标签业务解释仍是 `asset-action-idempotency.md §5` 2026-09-12 登记行明写「待裁、不静默通过」的争议，本组不代为裁定。证据：`real-04-06-08.json` S07–S11；verifier `downgrades` 对「两把键并存」与「重放正面回执」两条子句的收紧说明。
- **REAL-08＝PARTIAL（结构性受阻，非取证不足）**：产品确有编辑重试入口（Try again／Change something），原退款行全程未被抵消或重复，付费前 fail-closed 且理由具体可行动；**但「新单一次预扣」这半句在 org founder 上无法达成**——今天仅有的两个自然失败都是永久性无效输入（80×107px 起始帧；「不能作人物」的参考图），任何忠实重试都会在校验层就被拒绝，永远走不到付费提交。要关掉这一半，需要 Founder 批准人造一次供应商侧失败（而不是校验失败），或改判由单元／集成测试覆盖——重复本轮旅程只会拿到同样的 PARTIAL。证据：`real-04-06-08.json` S16–S19；`asset-action-idempotency.md` §5 本轮新增登记行。
- **REAL-10＝BLOCKED**（verifier 追加第三个阻断因素）：两个独立阻断均已复核——① staging 全部 8 个组织零 `ScheduledPost` 行，且产品在本 build 上没有商家排期入口（`/schedule` 307 回 Home，无导航项，无 `page.tsx`；唯一入口是 Otto 的 `sharePostPreview` 技能）；② 即便有排期，`MEDIA_PROXY_SECRET`／`SHARE_PREVIEW_SECRET` 在 staging `web` **与** `worker` 两个服务上都未设置。verifier 额外发现第三个阻断——见下方 R3-F31：即便前两项都补齐，`/s/<token>` 在 staging 会把客户送到 `localhost:8080`。账本无新增、其他租户 404、fail-closed 页面文案三项可脱离分享链验证的条款均已证成；`SHARE-A10`（签名跨租户改指）在 staging 无法验证——观察到的 404 证明的是「密钥未配置」分支，不是租户隔离本身。证据：`real-10-share-anon.json` 全部步骤；`workflow-groups2-4-result.json` `verdicts[2].downgrades`。
- **REAL-11＝BLOCKED**（同因，未单独派工）：verifier 明确指出 REAL-11（Revoke 后旧页面与媒体立即失效）与 REAL-10 卡在同一堵墙——两把密钥缺失＋零 `ScheduledPost`——本轮未为它单独分配步骤，直接按同一阻断原因标 BLOCKED，留给两把密钥补齐、且至少一条 `ScheduledPost` 存在之后再派工。

**Money proof（三组合计）**：第二组（`real-03-person-video`）US$0.380（1 段视频 11 credits + 1 轮聊天 2.2 credits）；第三组（`real-04-06-08`）US$0.485（1 段视频 11 + 1 张图 1 + 1 张 variation 1 + 1 次 Regenerate 1 + 3 轮聊天合计 8.1 credits）；第四组（`real-10-share-anon`）US$0（零生成、零 `ScheduledPost` 写入、唯一一次「Copy link」点击在任何数据库写入之前即被拒）。三组合计 US$0.865764375（四舍五入 US$0.87），累计仍远低于 US$16 暂停线、US$20 封顶完整保留。逐组账本守恒，由三名独立 verifier 各自重查：第二组 job 窗口恰 4 行（2 组 RESERVE/SETTLE，视频 -110/+110 与 0/-110、聊天 -40/+40 与 +18/-40），零 REFUND；第三组窗口 14 行，`sum(balanceDelta) = -221`、`sum(reservedDelta) = 0`，4 组 RESERVE/SETTLE 配对、零 REFUND、零悬挂预留、零重复结算；第四组窗口零新增行。三组的「禁写」扫描（Organization／Membership／BrandKit／ChannelConnection／MetaConnection／RuntimeConfig／AllowedEmail／ScheduledPost 等敏感表列）均为零，无一笔越权写入。arkcli 开跑前花费快照另存 `reports/ark-spend/before-groups2-4-20260917T042559Z.json`（编排者 session 本地路径，脱敏、rc 0；**session-local，未入库**，不在本 PR 的证据文件之列）。

**正面回执**：PRODID-R11／FSE-210（`@` 选中的产品 id 在提案→确认卡这一步丢失）第二次在 staging 不复现——`GenJob.entityIds`／`approvedEntities`／`Generation.entitySnapshot` 三处均带着同一个产品 Entity id，PR #1420 的修法在本组独立核实第二次成立；R3-F20 修复（PR #1463）生效，`/brand/records?tab=products` 可直接建产品，本轮 REAL-03 得以从 NOT RUN 转为 PASS；PRODID-A10（建、改产品零扣费）本组再证一次——建产品与挂封面两步产生零账本行；PR #1462（首张参考图自动写回封面）观察到实际生效——`Entity.baseAssetId` 在挂图那一刻由 NULL 自动写成该图 id，无需商家手动设置。

**新发现**（详见 `findings-catalog.md`）：R3-F25（画布拖放上传延迟入队，补登记编号，正文已在 `money-engine.md`）、R3-F26（P2，文生视频提示词声称有首帧但该单确无首帧）、R3-F27（客户端 Back 后 Otto 面板空 40–60 秒）、R3-F28（P1，第二标签重放或确认 variations 把画布撞进错误边界，React #185，复现两次，账本无损）、R3-F29（失败卡 Try again 零反馈致四次点击克隆四张卡，且 `coworkVaryCard` 是否付费的三处代码注释互相矛盾）、R3-F30（派生图 variation／Regenerate 两条路径 `entitySnapshot` 均为空，产品血统一跳后丢失）、R3-F31（P1，`/s/<token>` 在 staging 303 到 `localhost:8080`，分享链接对客户端到端必坏）、R3-F32（旧式 `?t=` 链接令牌留在地址栏约 1 秒且短暂露出登录壳）。工具坑、旁证与一句值得保留的 fail-closed 文案范本见 `findings-catalog.md` 本轮补记，不在此重复。

**Founder 已先行授权修复（编排者 2026-09-17 先派工，待 Founder 追认，§7.4「新发现全部本版修」2026-09-15 授权 + §7.4「要我拍板的直接决定」2026-09-16 授权覆盖）**：F31+F32（分支 `claude/share-entry-redirect-origin-r3-f31`）、F28（分支 `claude/canvas-crash-after-approve-r3-f28`）、F29（分支 `claude/failed-card-try-again-feedback-r3-f29`）、F26（分支 `claude/video-prompt-no-phantom-first-frame-r3-f26`）——**四条修复分支**，加上写这份收官（四）文档自己那条分支，当时共五条在飞（2026-09-18 订正：原文只写「五个分支均已派工」，上面却只列得出四条修复分支，第五条是本文档分支，容易被读成漏列了一条修复）；撰写本节时四条修复均尚未开 PR，落地情况见本文件 2026-09-18（四）一节。**留给 Founder 裁的（本轮不施工）**：F30 语义（`docs/specs/brand-product-identity.md` §5 已加登记行）、REAL-08 付费半段是否人造供应商失败或改判测试覆盖（`docs/specs/asset-action-idempotency.md` §5 已加登记行）、staging 两把分享密钥何时补齐（`docs/specs/share-preview.md` §5 已加登记行）、F27（客户端 Back 空白，未派工，交 Founder）。

## 合并台账（承 2026-09-15 commit `5008332f` 之后新落地的 27 个 PR；本节取代收官三 `a627043e` 的 11 行早期版本——那版撰写于合并链仍在跑的当中，本节是链跑完之后的完整版）

以下 27 个 PR 与 sha 均取自 `reports/merge-ledger-r3.txt`（编排者串行合并链的权威记录）、逐条以 `git log origin/main` 核实存在且顺序与该文件一致（核实于 2026-09-17，主检出 HEAD `c0d25917`）：

**2026-09-18 订正与补记**：① 时间列原写「KL」，实为 **UTC**——逐条对 `gh pr view <n> --json mergedAt` 核实（例：第 27 行 #1464 表里写 `09-17 04:36`，`mergedAt` 是 `2026-09-17T04:36:44Z`，KL 时间应是 12:36），列头已改；② 第 28–33 行随收官（五）追加，覆盖 `c0d25917` 之后到 `66f9c766` 为止的全部六个合并，`git log --first-parent c0d25917..66f9c766` 核实恰为这六个、顺序与下表一致；③ 第 34 行随收官（六）追加，即收官（五）那份文档 PR 自己（#1472，`80d1e280`）——它写下第 28–33 行时自己还没合，所以补在这里，`git log --first-parent 66f9c766..80d1e280` 核实之后恰只有它这一个合并，`80d1e280` 也正是本 PR 开分支时的 `origin/main`。

| # | 合并时间（UTC） | PR | 合并 commit | 摘要 |
|---|---|---|---|---|
| 1 | 09-15 05:18 | #1438 | `122f50b2` | R3-F06 变更登记入主干 + 第三轮走查报告入库（docs-only） |
| 2 | 09-15 05:28 | #1443 | `b4a46c27` | 第三轮走查 R3-F03／F04／F05 修复登记进 brand-product-identity 与 frontend-baseline 变更登记 |
| 3 | 09-15 05:31 | #1440 | `8b200a34` | Founder 画布现场诊断入库 + 四项发现登记（docs-only） |
| 4 | 09-15 05:33 | #1453 | `f8b6fb13` | 运行手册：staging 备份令牌拆分步骤 |
| 5 | 09-15 05:46 | #1439 | `8370ef19` | 个人姓名保存后账号菜单与头像立即同步，不用刷新 |
| 6 | 09-15 06:09 | #1442 | `920c7774` | 备份持续失败根因：pg_dump 17 拒绝 dump PostgreSQL 18；升 18 并把失败原因分类落库 |
| 7 | 09-15 06:23 | #1445 | `1c817a4c` | TENANT-A1「重叠在飞互不串帧」补真并发测试 |
| 8 | 09-15 06:36 | #1447 | `3845af4e` | TENANT-A8／A9 从 it.todo 变成真库行为测试：七队列各一单、异租户注入被拒、同音频缓存不重复计费 |
| 9 | 09-15 09:10 | #1454 | `5008332f` | 第三轮走查收尾：staging 第二轮结果、备份根因登记、新发现十一项与 Founder 2026-09-15 裁决入册（docs-only） |
| 10 | 09-15 09:40 | #1444 | `f7bb64e3` | Library 产品详情可改名、换主图，与 Brand 页同一身份双向同步（PRODID-A4） |
| 11 | 09-15 09:52 | #1446 | `ffe9a4d1` | Library 素材详情关闭后键盘焦点回到原素材卡 |
| 12 | 09-15 10:11 | #1448 | `eed4f079` | 输入附近不再堆叠上传理解／搜索费用／对话预留常驻说明，实际动作报价与账单不变（R3-F06） |
| 13 | 09-16 13:00 | #1451 | `fcde7762` | 三条真库测试首跑红的根因与修法：时区是产品缺陷、锁竞态判无罪、结算积压是测试自造并发 |
| 14 | 09-16 13:13 | #1460 | `4496bc3b` | 三条停放旧地址真的回 307，不再先流骨架再跳（R3-F10） |
| 15 | 09-16 13:24 | #1455 | `57ce7ee6` | 「Add connection」对话框打开时焦点不再落在 Connect 按钮上（R3-F09） |
| 16 | 09-16 13:39 | #1456 | `1a03bb71` | Connections 页顶补上规格要求的那句说明（R3-F14） |
| 17 | 09-16 14:04 | #1457 | `d217327c` | 健康接口不再显示早已没人写的旧 worker 心跳行（R3-F19） |
| 18 | 09-17 02:34 | #1449 | `92d549a7` | 对话里说「直接生成」就真的给出可确认的分镜生成卡；普通对话不再先卖一张首帧图（FC-1／FC-3） |
| 19 | 09-17 02:46 | #1450 | `37bbb993` | 续写同一张图时原图与演员一起进卡与谱系；首帧意图、卡面角色与实际请求三者一致（FC-2／FC-4） |
| 20 | 09-17 03:00 | #1458 | `28f3cdfa` | 翻闸前置：四颗形状雷根治、warn 基线重取、A3/A4 真扣费路径复验 |
| 21 | 09-17 03:27 | #1462 | `68fed829` | 挂上第一张参考图就自动成为封面并写回，Library 与 Brand 从此同一张图（Founder 2026-09-15 裁决，PRODID-A4） |
| 22 | 09-17 03:39 | #1452 | `ef3f874f` | 画布 Shift 多选偶发只选中一张：加选开关晚一拍写进 store |
| 23 | 09-17 03:52 | #1461 | `f0835808` | 后台可丢弃单条死信并留审计记录（Founder 2026-09-15 裁决） |
| 24 | 09-17 04:04 | #1459 | `456a57ba` | 打错地址不再撞上无导航的裸 404：停放前缀送回冻结去处，其余地址留在产品里（R3-F11） |
| 25 | 09-17 04:19 | #1463 | `a59ebe67` | 每一条「去加产品」的指路都通向真有「Add product」键的页面（R3-F20） |
| 26 | 09-17 04:22 | #1465 | `a627043e` | 第三轮收官（三）：Founder 三裁、R3-F18…F24、付费旅程第一组入库 |
| 27 | 09-17 04:36 | #1464 | `c0d25917` | 上传理解结算后在那张图上留一行回执，不再静默扣 0.1 credit（Founder 2026-09-16 裁决） |
| 28 | 09-17 06:33 | #1467 | `c4dd4cd9` | 第三轮收官（四）：付费旅程 2–4 组入库、R3-F25…F32 登记、27 份合并台账（docs-only；上表前 27 行就是这份 PR 写下的，所以它自己不在那 27 行里——本行补上，台账对 `git log` 才不缺口） |
| 29 | 09-17 07:22 | #1466 | `66ef15fa` | 没有首帧的文生视频不再对引擎和商家说「从给定首帧开始」；卡上写的就是发出去的（R3-F26） |
| 30 | 09-18 09:11 | #1468 | `3a848cd3` | 顾客点分享链接不再被送到 localhost；旧式链接不再闪出登录页（R3-F31／F32） |
| 31 | 09-18 11:26 | #1471 | `620045da` | 规矩：本仓库不再做 Codex／跨厂复审，合并门改为 CI 绿＋Claude 系两镜头复审＋非作者执行（Founder 2026-09-18 裁决） |
| 32 | 09-18 11:54 | #1470 | `14a4c38d` | 失败卡按「Try again」有回应了：转圈、加好、出错都看得见，连按不再复制四张（R3-F29） |
| 33 | 09-18 12:09 | #1469 | `66f9c766` | 重放已批准的那张卡，画布上还是一张：不再冒出「2 selected」与凭空的「Batch of 2」（R3-F28） |
| 34 | 09-18 12:43 | #1472 | `80d1e280` | 第三轮收官（五）：四份修复合并台账、R3-F26／F28／F29／F31／F32 状态更新、规矩变更登记、Founder 拍板清单（docs-only；上表第 28–33 行就是这份 PR 写下的，所以它自己不在那六行里——本行补上，台账对 `git log` 才不缺口） |

**主干终态（2026-09-17 写下时的口径，仍然如实；2026-09-18 之后的终态见下一节）**：`main = c0d25917`（第 27 个 PR 的合并 commit），`git log --oneline c0d25917` 逐条核实以上全部 27 个 sha 均为其祖先且顺序与上表一致。staging 已部署到 `c0d25917`（web + worker-compute + worker-wait 三个服务；旧角色 `worker` 已退役，`/api/health` 的 `workers.worker` 字段显示 `"retired"`，见 R3-F19 的修法）——本节合并台账与本轮付费旅程 2–4 组读到的 build sha 一致，无 BUILD-DRIFT。

## 2026-09-18（四）修复落地、合并台账补记与裁决

承本文件 2026-09-17（三）一节末尾那句「四条修复分支均已派工、撰写时尚未开 PR」（该节由收官（四）PR #1467、合并 `c4dd4cd9` 写入）：四条已全部开 PR、复审、合入主干，另有一条规矩变更同期落地。**主干终态**：`main = 66f9c766`（PR #1469 的合并 commit），`git log --first-parent c0d25917..66f9c766` 核实 `c0d25917` 之后恰有六个合并，即本文件合并台账第 28–33 行，顺序与该表一致。以下每条的 PR 号、合并 sha、合并时刻均以 `gh pr view <n> --json state,mergeCommit,mergedAt` 逐条核实（2026-09-18）。

**四份修复，各自替商家挡掉了什么**（一句用户可见效果，票号在句末）：

- **没有首帧的那种文生视频，提示词不再对付费引擎和商家说「从给定首帧开始」——卡上写的就是真发出去的那一份**。从前商家只打了一句话、@ 了两个元素，这一单一张首帧图都没有，我们却花钱请引擎去照顾一张不存在的图，商家读到的也是同一句假话。现在装配层只认服务端证据（`videoAttachmentRole`、核过的演员数），模型自填的 `mode` 说了不算（PR #1466，合并 `66ef15fa`，2026-09-17T07:22:52Z）。
- **顾客点开商家发出的分享链接，不再被送到 `localhost`；旧式 `?t=` 链接也不再让令牌在地址栏停一秒、不再闪出「Go to sign in」**。跳转目标改成相对地址（浏览器按它刚请求的那个对外地址解析，不必猜代理后面的主机名），旧链接改由路由层在任何外壳冲出去之前答完（PR #1468，合并 `3a848cd3`，2026-09-18T09:11:43Z）。
- **失败卡上按「Try again」终于有回应：转圈、加好了、没成，三样都看得见，连按也不再复制出四张一样的卡**。从前服务端 200、对话里真多出一张卡，屏幕上却一个字不变，商家于是一分钟按一次、按了四次。现在两颗键（结果卡「Make another」与失败卡「Try again」）读同一份回执合同（PR #1470，合并 `14a4c38d`，2026-09-18T11:54:18Z）。
- **付完钱、那张卡已经在板上了，服务端把同一张卡再答一次，画布上还是一张：不再冒出「2 selected」，也不再画出商家没买过的「Batch of 2」**。幂等闸本来就没多扣一分钱，坏的是画布这一侧把重放当新卡追加（PR #1469，合并 `66f9c766`，2026-09-18T12:09:08Z）。

**规矩变更，以及本轮的复审该怎么读**：Founder 2026-09-18 裁决「codex review 完全不需要了」——本仓库不再做 Codex／跨厂复审，合并门改为 **required CI 绿＋Claude 系两镜头对抗复审 P0/P1 清零＋非作者执行**（PR #1471，合并 `620045da`，2026-09-18T11:26:06Z；条文落在项目 `.claude/CLAUDE.md`「开发流程」第 4 条）。对本轮的直接后果：**这条裁决之后的每一轮复审都是 Claude 系两镜头复审，它就是正式复审本身**，不是任何东西的替补——上文与既往章节里那种「同厂替补」标注不再适用于此后的复审记录，也不必再为它们补一次跨厂后审。连带作废的还有 `docs/DEFERRED.md` 的 D-073 与 D-076（两条都写着「需补一次 codex 跨族后审」），两行保留不删，已就地标注失效。**（2026-09-18（五）补）规格里那些旧的「跨厂复审」标签怎么读**：`docs/specs/share-preview.md` §5 2026-09-17 行的「跨厂复审 2026-09-17 点名」、`docs/specs/money-engine.md` §5 2026-09-16 行「已知边界（2026-09-16 跨厂复审逐条实证…）」这两处，记的都是**裁决之前**真的发生过的那次复审，是历史事实，不改；今后读它们时一律读作「第二镜头复审」，不要据此以为本仓库今天还欠着一次跨厂后审。两行本次一字未动。

**仍未验证——第三轮走查可判 GO 之前剩下的两件真跑**（都必须在真环境真点，读码与单测替代不了）：

1. **R3-F28 的崩溃本身还没被证明消失**。修法已合入，但 `Minified React error #185` 在 jsdom 里复现不出来（环境限制），走查现场那两步（S13 确认 Create variations、S10 第二标签重放已批卡）与两刀的关系已在规格里如实分开写。要判定，必须在 staging 部署到 `66f9c766` 之后用真浏览器重跑 S13 与 S10——复跑组 `verify-r3-f28`，预算约 US$0.07（两次 1 credit 的图片确认）。**在此之前 R3-F28 一律记「修复已合入，崩溃本身待真浏览器复跑」，不得标关闭。**
2. **#1388 的双账号并发观测第三轮没跑过**：一边连发 4 条长视频、一边发图，那张图必须几秒内就出来——这条「排长队的人不挡插队的小活」本轮从未在真环境观测过一次（票 #1388，OPEN，`gh issue view 1388` 核实）。

这两件是当时仅剩的两件**已可立即执行**的真跑项；其余阻断（REAL-10／REAL-11 的两把分享密钥、REAL-08 的付费半段）不是跑不跑的问题，是等 Founder 拍板的问题——两条都已在 2026-09-18 当天拍完（密钥＝设，REAL-08＝改由测试覆盖），见下表第⑤⑥条；REAL-10／11 那条分享旅程在密钥设好之后会再加回来一件真跑。

**（2026-09-18（五）更新，本段随现况改写）**：上面第 1 件**已经做完了**——复跑组 `verify-r3-f28` 当天在 build `66f9c766` 上把 S13 与 S10 原样跑过，两步全 PASS，R3-F28 据此关闭（详见本文件 2026-09-18（五）一节与 `findings-catalog.md` R3-F28 行）。同一天 Founder 自己把两把分享密钥设上了，REAL-10／11 从 BLOCKED 转为可跑。**所以第三轮走查判 GO 之前剩下的真跑项现在是两件**：① **#1388 的双账号并发观测**（一边连发 4 条长视频、一边发图，那张图必须几秒内就出来——票 #1388 仍 OPEN，本 PR 分支 `gh issue view 1388` 核实），② **REAL-10／REAL-11 的客户面分享旅程**（密钥齐了、`Copy link` 也真铸得出公网链接了，但这条旅程还差一条经 Otto `sharePostPreview` 技能铸出来的 `ScheduledPost`，staging 上目前一条都没有——见下一节「密钥落地」那段）。

**Founder 2026-09-18 裁决（对谈）——本轮新增十条逐条有答**：「裁决原话」列是 Founder 当场说的话，未改写；「落地去向」列写这条今天归谁、落在哪。带「PR 在飞」的条目由各自的修复 PR 写自己的规格行，本 PR 不代写。存量待拍板项没有变，列在表后。

| # | 事项（一句用户效果） | 裁决原话 | 落地去向 |
|---|---|---|---|
| ① | 商家把图片直接拖进画布上传，那件素材要等 **15 分钟到 24 小时**才被读懂、才扣那 0.1 credit，屏幕上当时什么都不说（R3-F25） | 「其实为什么一开始会有这样的设计？我认为这个设计完全不合理，可以移除。」 | **本版修**：上传即入队，与其它上传入口一致；修复 PR 在飞。「为什么一开始会是这样」这一问由那条 PR 的版本史考据回答——**见修复 PR**，本文件不代答。登记行 `docs/specs/money-engine.md` §5 2026-09-16 行「已知边界」第④点 |
| ② | 四份已合入修复（R3-F26／F28／F29／F31+F32）的规格登记行都还挂着「批准: 待 Founder 追认」 | 「是什么？不明白。」 | **待解释后再裁**：那四个「批准:」格本次一字未动；编排者另行向 Founder 讲清这四行到底在追认什么，再回来拍 |
| ③ | 失败卡那颗键在飞时写「Adding…」、没成时写「Couldn't add another card — please try again.」（R3-F29） | ok | **追认**：`docs/specs/frontend-baseline.md` §5 2026-09-17 R3-F29 行的文案改动括注已由「编排者裁定，待 Founder 追认」改成「编排者裁定，Founder 2026-09-18 对谈追认」；该行的「批准:」格属上面第②条，未动 |
| ④ | 一张图再做 Create variations 或 Regenerate，新图身上「这张图用了哪个商品」就没了（R3-F30） | ok | **本版修**：修复 PR 在飞；登记行 `docs/specs/brand-product-identity.md` §5 2026-09-17 行 |
| ⑤ | staging 上那两把分享密钥 `MEDIA_PROXY_SECRET`／`SHARE_PREVIEW_SECRET` 设不设、谁来设 | ok | **设**：命令由编排者另交 Founder 自己跑（不回显）；设好之前 REAL-10／REAL-11 仍是 BLOCKED。登记行 `docs/specs/share-preview.md` §5 2026-09-17 第一行 |
| ⑥ | REAL-08「生成失败之后重试一次、只预扣一次」的付费半段，在 org founder 上结构性跑不到 | ok | **改由测试覆盖**（不人造供应商侧失败）：PR 在飞；登记行 `docs/specs/asset-action-idempotency.md` §5 2026-09-17 行 |
| ⑦ | 商家批完一条生成、去 Library 再按浏览器 Back 回首页，Otto 对话正文空白 40–60 秒才补上那张进行中的卡（R3-F27） | 「修」 | **本版修**：PR 在飞 |
| ⑧ | 一次测试上传把一句「solid orange screen」写进了 Founder staging 账号的品牌记忆，还标成商家手打 | 「删除。」 | **授权删除**：编排者执行（staging 数据），不走 PR |
| ⑨ | 上传回执要不要也出现在 Library 的格子上——今天两处载体（Library 资产详情抽屉、画布卡片 Info 面板）都要点一下才看得见 | 「保持。」 | **保持现状**：回执留在详情抽屉与 Info 面板，不进格子——与设计系统的 Library 规则一致（`apps/web/design-system/patterns/library/README.md:31`：「使用保持原始比例的紧凑 media grid；video 显示 duration，图片不附加长期可见的大段 metadata。」）。已追记进 `docs/specs/money-engine.md` §5 2026-09-16 行 |
| ⑩ | zero-queue 的 QUEUE-A7 探针跑出来的数字与验收行的文字有偏差（数字皆牌价估算口径，未调计费接口） | ok | **追认**：`docs/specs/zero-queue.md` §5 2026-09-13 行的裁决格已写上「Founder 2026-09-18 对谈追认」 |

**本轮新增十条至此全部有主**：①④⑥⑦四条在修（各自 PR 在飞），③⑩已追认，⑤待 Founder 自己跑那条命令，⑧待编排者执行删除，⑨维持不动——只剩②一条真的还悬着（Founder 要先听懂那四行在追认什么）。

*存量（前几轮已挂，本次只复核指针仍在）：*

- 各规格 §5 其余「待 Founder」行：FSE-207／208／211 三条口径（`docs/specs/creation-engine.md` §5 2026-09-11 三行，FSE-211 另有 2026-09-13 的复测句订正行）、frontend-baseline 的 2026-09-04／05 几条（`docs/specs/frontend-baseline.md` §5 :116、:119、:149、:157、:165）、tenant-isolation 严格档「无帧但字面 orgId 放行」的兜底收不收（同文件 §5 :80，收口挂在票 #1403）、money-engine 的 ④b Abandon 残余竞态（`docs/specs/money-engine.md` §5 :117）。
- 票 #1403（OPEN）：钱面 enforce 翻转的前置与严格档兜底定调。**一处数字对不上，本文件不代为判定**：票面「翻转前置」列的是**三**条（①Membership 在 `runAsSystem` 里写；②`auth-guard.ts:88` 合法跨租户成员读；③webhook／worker 侧钱账无帧写），而本文件合并台账第 20 行（PR #1458）的摘要写的是「四颗形状雷根治」——两处口径不一致，标记**未核**，请以票面为准或由 Founder 一句话定死。
- 票 #1361（OPEN）：staging 数据库口令轮换，Founder 亲自执行、agent 备单复证。
- 票 #1362（OPEN）：延后台账 39 条到期者批量呈裁。
- 生产部署门：**#1380 已于 2026-09-12T21:27:28Z 关闭**（`gh issue view 1380` 核实），票面原写「动 schema：迁移＋fresh-database 验证；生产执行前 Founder 另行确认备份与恢复方案」。**未核**：任务书说的「一门三件（生产迁移＋媒体备份激活＋预检 SQL）」中的「预检 SQL」，本次在仓内没找到对应工件；这道门今天可指的权威只有 `docs/specs/tenant-isolation.md` 的生产执行前置句与下面这条 #1385，是否另立一张票请 Founder 定。
- 票 #1385（OPEN）：备份桶复制＋恢复手册＋真删捞回演练，其中 MEDIA-A3（Founder 随手挑一个人照手册从头走一遍）、MEDIA-A7（对生产桶只做只读核验）、MEDIA-A8（照 `beta-gate.md` GATE-A6 念那句判定）三条验收在 `docs/specs/media-durability.md` §「验收」表（:53、:57、:58）。

**本次订正的低阶勘误（逐条写明改了什么）**：

1. **合并台账时间列**：列头「合并时间（KL）」→「合并时间（UTC）」。依据：表里第 27 行 #1464 写 `09-17 04:36`，而 `gh pr view 1464 --json mergedAt` 答 `2026-09-17T04:36:44Z`——写进去的一直是 UTC，KL 时间应是 12:36。
2. **本文件 2026-09-17（三）节末段（由收官（四）PR #1467 写入）的「五个分支均已派工」**：改成「四条修复分支，加上写那份文档自己那条分支，当时共五条在飞」。原文列得出的只有四条修复分支，第五条是文档分支，容易被读成漏列了一条修复。
3. **R3-F26 的状态漏写 PR 号**：`findings-catalog.md` R3-F26 的**状态**行原写「分支…尚未开 PR」，现改为已合入并写明 PR #1466 / `66ef15fa`，同时把复审 P3 两条（规格「未关掉的缺口」由三条改四条、新增的 TOCTOU 理论例外）指了出来。
4. **REAL-03「四处」与「七处」不一致**：本文件 2026-09-17 节原写「Brand／Library／`@` 菜单／确认卡与生成谱系**四处**同一 Entity id」，而同一份证据在 `coverage-matrix.md` REAL-03 行与 `real-scenarios.md` REAL-03 行都写「**七处**」并逐条枚举（Brand 卡片／Library Elements Products／`@` 菜单／确认卡／`GenJob.entityIds`／`approvedEntities`／`Generation.entitySnapshot`）。证据文件支持的是七处，本文件已按七处改写并保留订正说明。
5. **R3-F32 的状态是被 R3-F31 那条 PR 顺手改的**：`git blame` 核实 `findings-catalog.md` 里 R3-F31 与 R3-F32 两条的**状态**行同由 commit `3a848cd3`（PR #1468）改写。这不是错，是出处——两条本来就是一条 PR 的两半，已在 R3-F32 行里写明，免得后来人以为 F32 另有一次独立更新。
6. **`share-preview.md` §5 的行号指针**：原写 `packages/core/src/env-contract.ts:609` 指「`APP_ORIGIN` 在契约里是 optional」，但 :609 是该条目的 `name:` 行；`requirement: "optional"` 在 :612，整条目是 :608-617。已改为指条目范围并点名 :612。
7. **`docs/DEFERRED.md` D-073／D-076**：两行的触发条件列各加一句「已随 2026-09-18 裁决失效（PR #1471，`620045da`），无需补审」，行本身保留不删。

## 2026-09-18（五）追认、画布崩溃复跑关闭、密钥落地、新登记 R3-F33

承上一节（收官（五），PR #1472、合并 `80d1e280`、2026-09-18T12:43:21Z，`gh pr view 1472` 核实）留下的四件悬案：②「那四个批准格」待 Founder 听懂后再裁、⑤ 两把分享密钥待 Founder 自己跑命令、⑧ 那条污染记忆待编排者执行删除，以及 GO 之前第一件真跑（R3-F28 崩溃复跑）。本节把这四件逐一交代完，并登记当天撞出来的一条新发现。

**①「这四条追认」——四个批准格今天落格了**。上一节第②条记的是 Founder 当时答「是什么？不明白。」，于是四份已合入修复的规格登记行都还挂着「批准: 待 Founder 追认」。编排者当天把那四行到底在追认什么讲清楚之后，Founder 原话「这四条追认」。四个格子因此从「批准: 待 Founder 追认（编排者依 2026-09-15「新发现全部本版修」裁决与 2026-09-16「要我拍板的直接决定」授权先行施工，2026-09-17）」改成「批准: 2026-09-18 Founder 对谈追认（原话「这四条追认」；编排者依 2026-09-15「新发现全部本版修」裁决与 2026-09-16「要我拍板的直接决定」授权先行施工，2026-09-17）」——先行施工那半句照旧留着，因为那是事实：施工确实早于追认，追认补的是那道批准手续，不是把时间线改写成先批后建。四行分别是：

| 规格 | 行 | 这一行追认的是什么（一句用户可见效果） |
|---|---|---|
| `docs/specs/creation-engine.md` | §5 2026-09-17 R3-F26 行（:195） | 没有首帧的那种文生视频，提示词不再对付费引擎和商家说「从给定首帧开始」 |
| `docs/specs/frontend-baseline.md` | §5 2026-09-17 R3-F29 行（:220） | 失败卡按「Try again」有回应了：转圈、加好、出错都看得见，连按不再复制四张 |
| `docs/specs/frontend-baseline.md` | §5 2026-09-17 R3-F28 行（:221） | 重放已批准的那张卡，画布上还是一张，不再冒出「2 selected」与凭空的「Batch of 2」 |
| `docs/specs/share-preview.md` | §5 2026-09-17 R3-F31／F32 行（:80） | 顾客点分享链接不再被送到 `localhost`；旧式链接不再让令牌停一秒、不再闪登录页 |

本次**只动那四个格子里的字**，同一行的其余内容一字未改（`git diff --word-diff` 核实：每行只有「待」→「2026-09-18」与「追认（编排者依」→「对谈追认（原话「这四条追认」；编排者依」两处替换）。R3-F30 那张表（`docs/specs/brand-product-identity.md`）的「字段可以加」由它自己的修复 PR #1475 写，本 PR 不碰。

**② R3-F28 的崩溃本身复跑完了，PASS，本条关闭**。复跑组 `verify-r3-f28` 于 12:41:03Z–12:54:10Z 在 staging build `66f9c766` 上执行，签入身份 org `founder`，本组花费 **US$0.07**（两次 1 credit 的图片确认，各 US$0.035），累计 **US$0.94**，离 US$16 暂停线与 US$20 封顶都还远。三条判定全 PASS，并由一名独立核证员逐条重查后维持：

- **S13（从节点工具条确认「Create variations」）PASS**：不崩、不出错误边界、控制台零错误，「2 selected」／「Download 2」／「Batch of」在确认当刻、结算之后、点新卡之后三次扫描全部零命中；画布 3 张卡变 4 张，恰一条新 GenJob `01M2T8PAWHG1A768CMQB8J823P`，恰一对 RESERVE／SETTLE。那份「控制台没有错误」不是哑读数——同一标签里先故意抛过一个探针错误并读到了，才据以判空。
- **S10（第二标签重放已批卡）PASS**：标签 2 在批准之前就载好、重放那一刻还停在未批准的卡面上，是真陈旧态；标签 1 批准一次得 GenJob `01M2T8WT62K7VXTBXZV1KVHQRQ`，标签 2 于 12:48:35Z 重放那一下**零新 GenJob、零新账本行**，不崩、不出多选条，两个标签最后收敛成同一块 5 张卡的画布。
- **MONEY-F28 PASS**：全天 org founder 的账本恰 6 行——两对生成 RESERVE／SETTLE（各 1 credit、各 US$0.035）加一对 Otto 聊天（净 2.4 credits，这一对是那一步本身要求的聊天轮次，worker 自己披露、没藏）；零 REFUND、零悬挂预留，余额与屏幕逐位对上。

核证员另外做了两件事，都记在案：**升级一条**——worker 自报唯一一条「未证成」（找不到 `cowork:<cardId>` 这把钥匙）其实找错了地方，它不在账本上、在 `GenJob` 上（`01M2T8WT62K7VXTBXZV1KVHQRQ.idempotencyKey = cowork:01M2T8TM7BCKYDAW5BTW8ZA681`），且 `packages/db/prisma/schema.prisma` 的 `GenJob` 注释写明有一条局部唯一索引 `GenJob_cowork_idempotency_once` 让 `cowork:%` 跨所有状态唯一——于是「重放零写入」不只是这一次的观测，是**数据库约束结构性保证**的：一张卡这辈子只生成得了一次。**推翻一条**——worker 顺手记的「2026-09-17 那次崩溃弄丢了一张商家已付费的卡」不成立，那条 `GenJob 01M2PX2N965JH5HCYCGBWA9BS2` 的 `threadId` 为 NULL、幂等钥匙属 `asset:regen:` 族，根本不走画布卡那条路，它自己那张 `Generation` 好端端地生出来了，而且它建于崩溃任务之后约 2 分半——因果上也轮不到崩溃背锅。**这一条不得开成缺陷登记。**

验收⑤⑥⑦三条是代码形状，不靠真跑，靠围栏：`apps/web/lib/__tests__/canvas-replayed-placement-r3f28.test.ts`、`canvas-seam-callback-stability-r3f28.test.ts`、`canvas-seam-effect-deps-r3f28.test.ts`，三份都在主干上（本 PR 分支 `ls` 核实）。**四样齐了——修复合入（PR #1469／`66f9c766`）、真浏览器复跑 PASS、代码形状有围栏、规格行当天追认——`findings-catalog.md` 的 R3-F28 状态行据此由「修复已合入主干，崩溃本身待真浏览器复跑——本条不得标关闭」改成「已关闭（2026-09-18）」。**证据：`local-logs/staging-r3-paid/verify-r3-f28.json`（执行）与 `verify-r3-f28-verifier.json`（独立核证），两份随本 PR 入库。

**③ 上一节第⑧条那条污染记忆，删掉了**。2026-09-18 12:38:41Z，那句「The video displays a solid orange screen with no other visual elements.」（`Memory 01M2N6Y9NEK11F406B9WDJFF2S`，`ownerId=founder`）从 staging 的品牌语境里移除。**删法走的是产品自己那颗键**——事实卡头部的「Remove this context」，不是直接改库：点下去没有确认对话框，当场消失并弹一句「Removed. You can restore it from the list.」，左栏多出一个「Removed」清单、里面挂着它和一颗「Restore」，即**软删**、商家自己随时捞得回来。只读复核对得上：那一行的 `deletedAt` 由 NULL 变成 `2026-09-18 12:38:41.178`，「还活着的 solid orange 行」计数归零；**其余事实一格未动**（Audiences 那条 `01M1ZQWCNQYDP75JGJ9VG9MHSW` 仍 `deletedAt=NULL`、内容逐字节相同）。证据：`local-logs/staging-r3-paid/f22-delete-evidence.json`。**产品侧那两处根因不随这次删除关闭**——`origin` 标成 `manual` 而非素材来源、Otto 自写的句子直接落 `Ready` 跳过商家确认闸，两条仍开着等后续裁决。

**④ 上一节第⑤条那两把分享密钥，Founder 自己跑完命令设上了（约 13:45Z）**。核对只看**名字与长度，值从头到尾没有显示过**：`web` 上 `MEDIA_PROXY_SECRET` 与 `SHARE_PREVIEW_SECRET` 各 64 字符；`worker`、`worker-compute` 上 `MEDIA_PROXY_SECRET` 各 64 字符；三处 `MEDIA_PROXY_SECRET` 的 sha256 前缀同为 `0a19139e0c22`，即三边确实是同一把。`web` 于 13:47:49Z 重启，`/admin/system` 随后答「Deploy identity In sync — Web and worker both run 80d1e280 with the same shared configuration (74b2b78a)」。**产品面的实证**：Library 素材的「Copy link」现在真的铸得出一条公网地址的 `/api/media/pub/<token>`（路径 221 字符），匿名 GET 答 `200 image/jpeg`、`cache-control: private, no-store`；在此之前同一颗键只会答「Sharing links aren't configured in this environment yet.」。**但 REAL-10／REAL-11 还差最后一件**：那条客户面旅程需要一条经 Otto `sharePostPreview` 技能铸出来的 `ScheduledPost`，staging 上目前一条都没有——这是密钥齐了之后剩下的唯一前置。（本条的现场观测由编排者当天在 staging 完成，**未另出入库证据文件**；上面每一句都写明了观测的是什么，供后来人复核。）

**⑤ 新登记 R3-F33：一次重部署把正开着画布的商家送进一屏全白**。复跑 R3-F28 的过程中撞上：12:50-12:51Z 之间 staging 从 `66f9c766` 换成 `80d1e280`，两个开着的画布标签重新载入后**双双全白**——`document` GET 200、所有 chunk 200、`readyState` 是 `complete`，DOM 里躺着一个没解开的 Suspense 占位，一个可见字符都没有，零控制台错误、零错误边界；新构建完全上线之后再刷一次就恢复了。**这一跳的 `git diff` 只有 7 份文档，`git diff --name-only 66f9c766 80d1e280 -- apps/web packages` 返回零个文件**（本 PR 分支复核，与核证员结论一致）——产品代码一个字没改，白屏照样发生，所以这是部署／chunk 切换本身的形状，不是代码回归，不记在任何一条修复账上。对商家的代价：我们每合一次 PR（哪怕只改文档）都会重部署，正在画布上干活的商家这一刻看到的不是「新版本来了，刷新一下」，也不是一句错误，而是一屏什么都没有的白，全靠自己猜要再按一次刷新。与 R3-F21（重部署后已开页面的上传失败被说成商家网络问题）是同一个根下的两片叶子：**已经开着的那一页不知道脚下的部署换了**。登记在 `findings-catalog.md` R3-F33，**待 Founder 裁 fix-now 或排队**；本条只记现象与代价，不预设修法。

**⑥ 今天派出去的四条修复 PR，都还开着，没有一条合了**（本 PR 分支逐条 `gh pr view` 核实，2026-09-18）：

| PR | 这一条替商家挡掉什么 | 状态 |
|---|---|---|
| #1473 | 失败单改一改再试的付费半段由真库测试钉住：新单只预扣一次、原退款不动（REAL-08） | OPEN，复审修正落地中 |
| #1474 | 商家把图片直接拖进画布上传，当场就进理解队列，不再等 15 分钟到 24 小时才扣费与出回执（R3-F25） | OPEN，复审修正落地中 |
| #1475 | 变体与重生成的图继承源图的商品与人物记录，一跳之后仍查得到「用了哪个商品」（R3-F30） | OPEN，复审修正落地中 |
| #1476 | 切回标签页或按返回回到首页，进行中的卡片当场跟上；面板取数那几秒不再一个字都没有（R3-F27） | OPEN，复审修正落地中 |

两条值得单独记的：

- **#1474（R3-F25）的「为什么一开始会是这样」已有答案，不是设计**。Founder 上一节第①条问过这句。版本史考据（由那条 PR 自己做）答：`5d90165c`（2026-06-12）照抄 `uploadCandidates` 的正文时**漏抄了派 ingest 那一段**；`019b552c`（2026-07-02）为另一件不相干的失效加了 `redispatchLostIngest`，反倒把这个缺口盖住了（东西最终会补上，只是晚 15 分钟到 24 小时）；`39528bb6`（2026-09-02）删掉了唯一那个还能照着比对的姊妹实现。按 Founder「修根不修表」的常令，那条 PR 的射程从画布这一处**放宽到 `createEntity` 与 `saveCroppedGeneration`**——关的是这一类，不是这一例。
- **#1476（R3-F27）的标题按证成的效果改过口，且这一条不算关**。原来那句「空白 40–60 秒」的数字**没能复现**，所以标题改成说真正证成的那件事（回到页面当场重读）；**浏览器 Back 那条腿还欠一次真浏览器复测**——在那之前 R3-F27 不标关闭。

**本节四件悬案的结账**：上一节列的②⑤⑧三条＋GO 前第一件真跑，今天全部有了终局——②追认落格、⑤密钥设上（REAL-10／11 只剩一条 `ScheduledPost` 的前置）、⑧删除执行完毕、R3-F28 关闭。**第三轮走查判 GO 之前剩下的真跑项因此是两件**：#1388 的双账号并发观测，以及 REAL-10／REAL-11 的客户面分享旅程。新欠的一笔是 R3-F33，等 Founder 一句 fix-now 或排队。
