# Creation UIUX → 后端接线与 E2E 交接

日期：2026-09-08。供 Founder 与接手工程 agent 使用。**从本文件开始即可**；它是材料入口和交付快照，不取代链接的设计／接口权威文件。

## 1. 当前交付是什么

| 项目 | 当前结论 |
|---|---|
| 本地 Canvas 对话栏与 Library 复用 UIUX | Founder 已接受候选。原话及日期已写回 spec／acceptance。 |
| Design System 检查 | 本次组件范围已核对与修正；不宣称全站、dark 或完整无障碍均已通过。 |
| Round 1 E2E | **阶段报告，NO-GO**。部分流程失败、阻塞或未运行，不是全量完成认证。 |
| 正式接线、后台修复、最终回归 | 本轮未完成；接手时查当前代码与部署，不能据旧报告认定现在仍坏或已好。 |
| 本次交付动作 | 本地文件，尚未 commit／push／PR／部署。仅有基线 commit 不包含这些改动。 |

**版本分开：**

- E2E 测试部署：`0e1f2ab3f1b05fba6112ee9544d6de5930648f83`，Railway staging，web／worker 同版证据在后台记录。
- UIUX 工作树：`/Users/winnin/.codex/worktrees/4232/FIKIRTIVE`，分支 `codex/uiux-frontend`，基线 `78b2160d19e735a1c41be1fcb9eb8a7699797b56` **加本地未提交改动**。
- 本地候选：`http://127.0.0.1:3008/product-patterns/canvas`、`/product-patterns/library`。服务需要运行；本地 fixture 不代表 production。

工程接手先核对工作树及 diff，尤其新建、未跟踪的组件与测试。保留其他任务文件；不要把所有 audit、tmp、output 一起盲目提交。跨工作树时完整转交本次代码和必要文档，不能只取此文件或旧 HEAD。

## 2. 必读顺序与唯一来源

1. **接线或修改任何前端之前：** [前端接线规范](../../../apps/web/design-system/governance/frontend-integration-handoff.md)，以及它指向的项目规则、Blueprint、DS README／authority。完成条件：列出本任务真实使用的组件与数据／动作 owner。
2. **接 Canvas／Library：** [Canvas 冻结 spec §17](../../../apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md#17-2026-09-08-canvas-对话与-library-复用-amendment)、[验收与缺口](../../../apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-acceptance.md)、[Library backend contract](../../../apps/web/design-system/patterns/library/backend-handoff-contract.md)。完成条件：逐条映射 CC-01–10，明确真实能力和待补项。
3. **更改说明、收费或状态文案：** [content disclosure](../../../apps/web/design-system/governance/content-disclosure.md)。Founder 已接受 Create 三段费用披露；普通 Enter 发送也不是本轮缺陷，见 §17 最新裁决。不要用历史规则覆盖新裁决。
4. **改导航或引用：** [surface contract](../../../apps/web/design-system/information-architecture/surface-contract.md)、[core flows](../../../apps/web/design-system/information-architecture/core-flows.md)、[reference picker contract](../../../apps/web/design-system/information-architecture/reference-picker-contract.md)。页面归属、对象 ID 和返回关系由原文件持有。

## 3. 本次代码在哪里，怎样接

路径均相对 repo root，接手时验证当前存在与调用关系。

| 文件／入口 | 作用与接线边界 |
|---|---|
| `apps/web/design-system/patterns/canvas/CanvasConversationColumn.tsx` | 新共享展示层；`open / onOpenChange / children / composer`，不负责后台动作。正式 Canvas 应复用它。 |
| 同目录 `CreationComposer.tsx` | 共用输入框；选中对象可移除、长名称保护。保持单一 owner。 |
| 同目录 `CanvasReference.tsx` | 已接受 review 消费者与模拟状态；用于对照，不能整份导入正式路由。 |
| 同目录 `library-review-handoff.ts` | Review typed handoff／目标 URL；不是服务端权限或真实 Canvas 创建实现。 |
| `apps/web/design-system/patterns/library/LibraryReference.tsx`、`model.ts`、`fixtures.ts` | Library 同素材 Edit／Animate／显式新 Canvas 样张。真实 reader/action 由原 domain 提供。 |
| `apps/web/app/product-patterns/canvas/page.tsx` | Review 深链校验与失效对象出路；fixture lookup 不替代 tenant 检查。 |
| `apps/web/lib/__tests__/canvas-conversation-column.test.tsx` | 新组件／helper 行为回归；另有 Canvas／Library pattern 与 DS guard tests。 |

**正式接线调查入口：** `apps/web/components/canvas/NorthstarCanvasWorkspace.tsx` → `CanvasOttoOverlay.tsx` → `apps/web/components/otto/OttoChatStream.tsx`／`OttoFrontDoor.tsx`。这是本地观察，接手先复核当前分支，不按旧路径猜新代码。

关键接缝：

- Review 与正式页面消费同一展示层，正式数据／动作来自真实接口。后台字段不能自动变成第二套 UI。
- Library 交接是**未发送意图**。现有 `pendingFirst` 会自动发送，不能直接接入该语义。明确发送与付费确认是不同动作。
- 同一素材 canonical ID、原 Canvas 可访问性、无原 Canvas 的创建、返回状态、已有草稿冲突由真实能力承接；不要把 URL 中的任意媒体地址当作授权依据。
- Review 的 `fikirtive-review-*` session state、fixture quote、`Charged once`／`Credits returned` 都不是后台证据。退款与费用回执须由账务权威结果驱动；未知保持未知。
- 真实 typed `@`、lineage、跨租户权限及刷新后状态需要接线验证。review label picker 不证明完整引用能力。
- 已批准布局见 spec；若现有接口缺状态，先报告最小缺口。新增行为或重设计让 Founder 决定，在对应 change register 记录，不在接线中静默降级。

## 4. E2E 报告与所有回查材料

| 材料 | 用途 |
|---|---|
| [带截图批注 PDF](../../../output/pdf/Fikirtive-Fullstack-E2E-Audit-2026-09-08-Round1.pdf) | Founder／工程整体阅读，23 页阶段审计。 |
| [报告 Markdown](report-round1.md) | 可搜索正文；保留当时结论，不覆盖成最新状态。 |
| [问题目录](findings-catalog.md) | FSE-001–013、设计差异、复现／源码依据／建议／复测。 |
| [覆盖矩阵](coverage-matrix.md) | PASS／PARTIAL／FAIL／BLOCKED／NOT RUN；未跑不是通过。 |
| [后台证据](backend-evidence.md) | 部署、任务、引用、资金与退出快照。 |
| [运行记录](run-ledger.md)、[自动检查](automated-checks.md)、[预检](preflight.md) | 具体执行与限制；Round 1 没有自动测试通过数。 |
| [设计对照](design-parity-evidence.md)、[Founder 反馈](founder-design-feedback.md) | 当时差异；Conversation 后续决定以新 spec §17 为准。 |
| [本地 UIUX 截图目录](../../../output/uiux-canvas-2026-09-08/) | 展开／收起、1440／1920、追问、确认、失效引用与 DS 样张。 |
| [竞品研究材料](../../references/creation-competitor-research-2026-09-08/) | 仅作参考，不授权新增功能。 |

本文件不移动、复制原报告或证据；相对链接随 repo 一起可用。若交给另一台机器，需同时携带链接目标，单独一个 Markdown 不是自包含证据包。

**分诊建议：** 优先修复准确引用 → 报价 → 官方 Avatar＋商品视频 → 状态同步 → 保留材料重试的连续旅程。FSE-001–007 是报告 P1 建议；FSE-008–013 也需逐条处置。问题目录是审计意见，不自动授权新 schema、auth、钱路或发布动作。

**新决定覆盖旧报告的地方：** FSE-003 的历史标题 `Send to Otto` 与实际仅填草稿不一致。最新 Library `Edit / Animate` 按 §17 正是进入 Canvas 留待发送；复测应检查文案与新行为一致，不为“修复旧标题”引入自动发送。历史缺陷保留追溯，处置记录引用新决定。

## 5. 现有验证与仍需证明的范围

UIUX amendment 的证据在 acceptance ledger：六文件 50 tests、types、scoped lint 通过；微调前 production build exit 0（缺 Auth 配置警告，不证明登录）；微调后未重跑 build。浏览器验证折叠／恢复、草稿、引用移除、部分 Library 交接／Back、双尺寸布局和追问确认。

尚缺实际鼠标 pan／drag 完整回归、极长无空格名称压力测试、dark／系统 reduced-motion 视觉验收、全站对比度审计；还有真实 typed references、持久化、钱路、权限与生产接线。**50 个 fixture／组件测试不能抵消 E2E 缺口。**

Round 1 结尾 USD3.82 是客户收费等值，不是供应商实际成本审计；账号 cap 恢复 0、无进行中任务／hold 是当时快照。旧 USD20 授权与共享桶豁免属于原轮范围；后续花费与环境变更先确认剩余额度和当次授权，不能据本文无限续用。不要清理共享桶或 production 数据。

## 6. 接手后的建议顺序与完成条件

1. **核对版本与范围。** 记录新分支／commit、部署 web／worker 版本，确认包含本地新增文件；对每个 FSE 和 CC 标明当前状态。旧报告不是当前代码事实。
2. **完成接线和修复。** 按已有规则定任务范围，复用 DS；每个问题带复现失败→修复通过的行为证据。超出现有批准的体验变化交 Founder 决定。
3. **重跑正式用户旅程。** 从新商家注册开始：登录／恢复；纯规划与追问；图片生成／编辑／variation；上传与 Library 原素材；商品＋官方 Avatar 首帧→视频；取消／失败／修改重试；刷新／多标签／历史；下载落盘；所有相关 Library、Brand 产品、Settings／余额路径。Google、会话过期和手机桌面引导亦须补测。每条以 coverage matrix 展开，不以这段概览替代测试清单。
4. **检查真实后台与体验。** 同一 request／asset／job／quote ID 对齐 UI、日志、DB；检查幂等、重复提交、失效引用、旧报价、租户越权、钱路结算／退款。破坏性测试使用隔离测试数据和获批环境。记录首反馈、首字、排队、生成、终态到 UI 的时间，区分供应商耗时与前端停滞；不编造未批准的 SLA。
5. **出修复后报告。** 标明版本、每项 FSE／CC 的复测结果、带批注截图、证据、未测试项和剩余风险。建议 release gate：核心 Creation 旅程闭合，P1 已修复复测或由 Founder 明确处置；钱路／权限与发布安全关卡有证据，关键未覆盖项不得静默算通过。备份恢复、Google 等原报告关卡按 live 状态关闭。

UIUX 接受、自动测试、真实 E2E 和上线授权分别记录。最终上线仍由 Founder 决定；本交接不授予 merge、部署或生产写入权限。

CodeGraph: not used — 本轮是已知文件的交付整理，非持图 worktree，以当前文件、Git 和已有验证证据核对。
