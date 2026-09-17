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

- **REAL-03＝PASS**：`/brand/records?tab=products` 可建产品（R3-F20 阻断已消失），Brand／Library／`@` 菜单／确认卡与生成谱系四处同一 Entity id（`PRODID-A1/A2`），无首帧合成（三个帧输入列全 NULL、`RefGenJob=0`），交付与报价一致（16:9／5s／720p／静音）。**唯一偏差**：产品封面挂的是商家自己已有的 Library 图，而那张图本身是 AI 生成，不是新上传——本轮 harness 没有文件上传动作，「商家上传真实产品照片」仍未被端到端跑过（登记见 `findings-catalog.md` 本轮补记）。证据：`real-03-person-video.json` 步骤 S01–S17、`verdicts[0]`。
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

**Founder 已先行授权修复（编排者 2026-09-17 先派工，待 Founder 追认，§7.4「新发现全部本版修」2026-09-15 授权 + §7.4「要我拍板的直接决定」2026-09-16 授权覆盖）**：F31+F32（分支 `claude/share-entry-redirect-origin-r3-f31`）、F28（分支 `claude/canvas-crash-after-approve-r3-f28`）、F29（分支 `claude/failed-card-try-again-feedback-r3-f29`）、F26（分支 `claude/video-prompt-no-phantom-first-frame-r3-f26`）——五个分支均已派工，撰写本节时尚未开 PR。**留给 Founder 裁的（本轮不施工）**：F30 语义（`docs/specs/brand-product-identity.md` §5 已加登记行）、REAL-08 付费半段是否人造供应商失败或改判测试覆盖（`docs/specs/asset-action-idempotency.md` §5 已加登记行）、staging 两把分享密钥何时补齐（`docs/specs/share-preview.md` §5 已加登记行）、F27（客户端 Back 空白，未派工，交 Founder）。

## 合并台账（承 2026-09-15 commit `5008332f` 之后新落地的 27 个 PR；本节取代收官三 `a627043e` 的 11 行早期版本——那版撰写于合并链仍在跑的当中，本节是链跑完之后的完整版）

以下 27 个 PR 与 sha 均取自 `reports/merge-ledger-r3.txt`（编排者串行合并链的权威记录）、逐条以 `git log origin/main` 核实存在且顺序与该文件一致（核实于 2026-09-17，主检出 HEAD `c0d25917`）：

| # | 合并时间（KL） | PR | 合并 commit | 摘要 |
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

**主干终态**：`main = c0d25917`（第 27 个 PR 的合并 commit），`git log --oneline c0d25917` 逐条核实以上全部 27 个 sha 均为其祖先且顺序与上表一致。staging 已部署到 `c0d25917`（web + worker-compute + worker-wait 三个服务；旧角色 `worker` 已退役，`/api/health` 的 `workers.worker` 字段显示 `"retired"`，见 R3-F19 的修法）——本节合并台账与本轮付费旅程 2–4 组读到的 build sha 一致，无 BUILD-DRIFT。
