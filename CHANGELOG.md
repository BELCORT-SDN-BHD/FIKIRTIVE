# 变更日志

本文件记录 FIKIRTIVE 仓库按里程碑发布的变更，格式参照 [Keep a Changelog](https://keepachangelog.com/)。

版本口径分三档：**补丁**（修补与小功能）、**小版**（大节点或新面）、**大版**（商业模式级）。版本号在里程碑场按本轮范围定，由 agent 推荐一档、Founder 拍板；收版时打 `git tag vX.Y.Z` + GitHub Release，并在此文件新增一版一节。`package.json` 版本号不随之变动。家规出处：`.claude/CLAUDE.md`「里程碑制」。

## [Unreleased]

无

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
