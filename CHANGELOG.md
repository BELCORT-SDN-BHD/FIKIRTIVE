# 变更日志

本文件记录 FIKIRTIVE 仓库按里程碑发布的变更，格式参照 [Keep a Changelog](https://keepachangelog.com/)。

版本口径分三档：**补丁**（修补与小功能）、**小版**（大节点或新面）、**大版**（商业模式级）。版本号在里程碑场按本轮范围定，由 agent 推荐一档、Founder 拍板；收版时打 `git tag vX.Y.Z` + GitHub Release，并在此文件新增一版一节。`package.json` 版本号不随之变动。家规出处：`.claude/CLAUDE.md`「里程碑制」。

## [Unreleased]

### v0.2.0 候选（2026-09-19，未收版：GO 待裁）

一句话：**「清账到 GO」**——第三轮真钱走查把发现的每一条都修了合了，五份规格三份归档、一份交付、一份保持冻结，商家钱表的租户围栏正式执法，分享链接与遥测收口，恢复手册两次真删真捞的盲走。**这一节还不是一个版本**：走查判 **NO-GO（2026-09-19）**，判据与缺口表见 [`docs/audits/fullstack-staging-2026-09-14/report-round3.md`](docs/audits/fullstack-staging-2026-09-14/report-round3.md) 2026-09-19（六）一节。决策记录 = 里程碑地图 [#1357](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1357)。

#### 交付

- **钱与租户**（规格 `docs/specs/tenant-isolation.md`、`docs/specs/asset-action-idempotency.md`、`docs/specs/money-engine.md`）：商家钱表的租户围栏从观察档正式翻到执法档、能在生产关掉隔离的那个开关连同 setter 一起删除，三颗前置雷根治（[#1403](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1403)，PR [#1495](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1495)）；失败单改一改再试只预扣一次、原退款不动，由真库行为测试钉住（REAL-08，PR [#1473](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1473)）；上传理解结算后在那张图上留一行回执，不再静默扣 0.1 credit（PR [#1464](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1464)）；图片拖进画布当场进理解队列，不再等 15 分钟到 24 小时（R3-F25，PR [#1474](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1474)）
- **分享链接与遥测**（规格 `docs/specs/share-preview.md`）：顾客点分享链接不再被送到 `localhost`、旧式链接不再闪出登录页（R3-F31／F32，PR [#1468](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1468)）；报错日志不再带出分享链接的 token——服务器端补上、浏览器端一并洗全（R3-F35，PR [#1482](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1482)）
- **媒体耐久与恢复**（规格 `docs/specs/media-durability.md`，交付＝staging；生产激活在部署门）：误删产物照手册就能捞回来——两次真删真捞的盲走把手册补到照做即通（MEDIA-A1/A2/A3/A5，PR [#1484](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1484)、[#1496](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1496)）；备份从「持续失败、零成功」修回每天真跑（PR [#1442](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1442)）
- **创作与画布**（规格 `docs/specs/creation-engine.md`、`docs/specs/frontend-baseline.md`、`docs/specs/brand-product-identity.md`）：没有首帧的文生视频不再对引擎和商家说「从给定首帧开始」（R3-F26，PR [#1466](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1466)）；失败卡按「Try again」有回应了、连按不再复制四张（R3-F29，PR [#1470](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1470)）；重放已批准的那张卡画布上还是一张（R3-F28，PR [#1469](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1469)）；切回标签页或按返回，进行中的卡当场跟上、取数那几秒不再一个字都没有（R3-F27，PR [#1476](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1476)）；Otto 面板收到长回答后滚轮又能滚、回复框回到看得见的地方（R3-F34，PR [#1487](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1487)）；变体与重生成的图继承源图的商品与人物记录（R3-F30，PR [#1475](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1475)）；挂上第一张参考图就自动成为封面（PR [#1462](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1462)）；Library 产品详情可改名换主图（PR [#1444](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1444)）
- **走查与规矩**：第三轮全栈 staging 走查跑完真实付费旅程、双账号并发（#1388）、客户面分享旅程与两次恢复盲走，报告与全部原始证据入库 `docs/audits/fullstack-staging-2026-09-14/`；规矩变更——本仓库不再做 Codex／跨厂复审，合并门改为 required CI 绿 ＋ Claude 系两镜头复审 ＋ 非作者执行（Founder 2026-09-18 裁决，PR [#1471](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1471)）；延后台账 97 条年检（[#1362](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1362)，PR [#1483](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1483)）

#### 未纳入本版

- 生产部署门 [#1480](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1480)：生产迁移、备份激活、staging worker 缺的 `SENTRY_DSN`／`PUBLIC_BASE_URL`、生产 `NODE_ENV` 核证、备份桶 lifecycle 读数、第三次恢复盲走——一律等 Founder 批准才动
- 钱面「无帧但字面 orgId 放行」兜底收口 [#1497](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1497)（下一版）
- polish：[#1478](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1478)（视频供应商失败重投回队尾）、[#1479](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1479)（e2e 23-brand 抖动）、[#1485](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1485)、[#1494](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1494)
- 台账年检出来的建议票 [#1486](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1486)、[#1488](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1488)–[#1493](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1493)（不挂里程碑，下个里程碑场下注）

#### 收版条件

GO 裁定 → 打 `git tag v0.2.0` ＋ GitHub Release，并把本节改写成正式的一版一节。今天判 **NO-GO**，两条路二选一：① 下一位 engineer 补跑走查矩阵剩下那一摞（粗估 3–5 个工作日、供应商 ≈US$20–40；其中 `BASE-24` **不需要 Founder 裁「修还是删条」**——那条 FAIL 采自 2026-09-14 的 build `14bcd038`，而给 Library 加上改名／换主图入口的 PR [#1444](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1444) 在 2026-09-15 才合入，它要的是在当前 build 上重走一遍）；② Founder 一句话把本轮 GO 口径缩到已执行范围，那就是 GO ＋ 收版。**编排者不代裁缩口径**（验收与口径属 Founder），所以本节不写版本号标题、不写日期、不打 tag。

## [0.1.1] - 2026-09-12

0.1.1 = 「E2E 第二轮就绪」补丁档：登录门、产品身份、创作修补三条战线合入并上 staging，第二轮全栈走查开跑并交付。决策记录 = 里程碑地图 [#1304](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1304)；收版判据见 [#1331](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1331)，勾表记录 = 地图 [#1304](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1304) 2026-09-12 勾表评论。

### 交付

- 登录门五片（规格 `docs/specs/sign-in.md`）：密码退役与 credential 行清零（[#1316](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1316)，关既有安全票 [#980](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/980)）；邮箱一次性码门与限流（[#1317](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1317)）；Google 门（[#1318](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1318)，回调配置 [#1310](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1310)）；暂停新注册与撤销——撤销由 better-auth 前门统一执行、自带端点同归名单管（[#1319](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1319)）；端到端旅程与 SIGNIN 编号补齐，新增旅程 `e2e/journeys/23-two-doors-one-workspace.spec.ts`（[#1320](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1320)）
- 产品身份 Brand 三片（规格 `docs/specs/brand-product-identity.md`，冻结票 [#1313](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1313)）：schema、迁移回填与共享动作 createProduct（[#1321](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1321)）；读路改接 Entity、标签改「Product」（[#1322](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1322)）；编辑与删除同步 + 自动化旅程（[#1323](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1323)）
- Creation 六片（规格 `docs/specs/creation-engine.md` §5 与 `docs/specs/frontend-baseline.md`）：生成资产写宽高与披露句（[#1324](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1324)）；重试与恢复提示（[#1325](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1325)）；直接出片 fail-closed 等四处（[#1326](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1326)）；报价／费用／余额三口径（[#1327](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1327)）；variation 真实交付＝上轮门槛 A3（[#1328](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1328)）；分镜「挂 Library 图」通道（[#1329](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1329)）
- 第二轮全栈 staging 走查（[#1330](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1330)，范围 [#1309](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1309)）：报告 `docs/audits/fullstack-staging-2026-09-11/report-round2.md`（PR [#1351](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1351)）；结论 NO-GO，新发现 FSE-201…211 登记进四份规格 §5 待下一版裁定（PR [#1352](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1352)）
- 里程碑场决策票 [#1305](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1305)–[#1312](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1312) 全解，记录在地图 [#1304](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1304)

## [0.1.0] - 2026-09-09

0.1.0 = 现在线上的东西得到名字；本版为里程碑制第一次试跑（仓库整理）。

### 交付

- 家规「里程碑制」五条入 `AGENTS.md`（PR [#1295](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1295)）
- GitHub `idea` 标签与 `polish` 说明（[#1296](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1296)）
- 记忆库压缩（[#1298](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1298)）
- worktree 回收 11→7（[#1293](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1293)）
- 17 张开放票分流（[#1290](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1290)）：5 留作记录、1 关、11 进下一版挂里程碑「下一版（编号待里程碑场定）」
- 延后台账 D-097（PR [#1294](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1294)）
- 就绪演练三条判据全过（[#1299](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1299)）；S5 勾表与收版记录（[#1300](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1300)）
- 决策记录 = 整理地图 [#1285](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1285)
