# 前端接线与设计变更交接规范

> **用途：** 后端接线任务涉及前端时的必读流程，不是另一份设计、接口定义或项目进度表。
> **请求记录：** 2026-09-02，Founder 要求记录交接规则，确保后续新增／修改组件仍遵守既有设计原则。本请求不批准任何后续功能、重设计或上线。

接手本轮 PR 的代码基线、检查范围和分支差异时，先看[交付快照](frontend-baseline-handoff.md)；本文件继续独立持有后续接线的规则。

## 1. 先确认接的是同一套设计

开工前读取项目指令、[产品蓝图](../../../../docs/BLUEPRINT.md)、[设计来源地图](../README.md) 与 [authority.json](../authority.json)，再按本次板块读取第 2 节的资料。

- 检查当前 checkout 确实包含对应设计源、组件和 compatibility aliases。此文在另一分支可读，不代表那条分支已有设计实现。
- 按任务风险检查上游：轻量改动核对直接来源，中量核对直接上游，重量核对完整链条。上游必须有 canonical artifact、Founder 批准记录，并能用当前代码／测试复核；聊天与旧报告只用于找到来源。
- 若来源缺失、批准不明或代码与记录冲突，报告具体缺口和大致补齐成本，由 Founder 选择先补齐／同步，或带明确记录继续。不得自行复制截图重建、降低范围或把缺口写成已完成。
- 同步、合并、提交、push、部署和生产数据操作继续遵守当前任务授权；此交接档不授予这些权限。保留其他任务的未提交修改与现有 symlink。

**完成条件：** 能列出本任务实际使用的权威文件、批准记录、代码入口和可验证的接口。状态与剩余差异查 [runtime convergence](../information-architecture/runtime-convergence.md)，不要在这里另建进度表。

## 2. 按涉及的板块读取，不重抄规则

| 涉及范围 | 必读来源 |
|---|---|
| 页面归属、导航、入口／返回流程 | [IA](../information-architecture/README.md)、[surface contract](../information-architecture/surface-contract.md)、[core flows](../information-architecture/core-flows.md)；准确 routes 与 labels 读取 `packages/core/src/navigation.ts` |
| Home／Analysis | [Home 接线 spec](../information-architecture/frontend-convergence-phase-2-home-spec.md) 及同目录 acceptance ledger、[Home pattern](../patterns/founder-home/) |
| Create／Canvas | [Create／Canvas 接线 spec](../information-architecture/frontend-convergence-phase-3-create-canvas-spec.md) 及其 acceptance ledger、[Canvas pattern](../patterns/canvas/) |
| Library／官方 Avatar | [Library pattern](../patterns/library/README.md)、[backend handoff contract](../patterns/library/backend-handoff-contract.md)；缺口核对记录也在该 contract 内 |
| Brand／Otto IQ | [Brand pattern 与 engine 边界](../patterns/brand/README.md)、根目录 `CONTEXT.md` 的对象归属 |
| Settings | [Settings 接线 spec](../information-architecture/frontend-convergence-phase-4-settings-spec.md)、[Settings pattern](../patterns/settings/) |
| Login／Auth | [access journey spec](../patterns/auth/access-journey-spec.md)、[Auth pattern](../patterns/auth/) |
| Otto `@` reference | [interaction contract](../information-architecture/reference-picker-contract.md)、[Phase 5 spec 与 production gate](../information-architecture/frontend-convergence-phase-5-reference-picker-spec.md) |

引用文件中的旧 checkpoint 只是当时观察；当前行为须重新核对。设计／业务决策以有效批准为准，现状以 live code 与测试为准；发现冲突先报告，不自行改写批准。

## 3. 先定边界，再接真实能力

1. 写出本任务的意图、受影响表面、可检查验收条件与非目标。按项目既有轻／中／重流程执行；接线不自动降低风险等级。
2. 列出界面需要的 reads、actions、状态和对象 ID，逐项对照真实接口。数据库、权限、价格、持久化与业务动作继续由现有 domain owner 负责，人工 UI 和 Otto 共用同一动作层。
3. 接口不足时，在该板块已有 handoff／spec 记录缺口并交还对应后端任务；未经批准，不借接线顺手建设引擎或改变产品行为。
4. 生产界面消费真实 data/actions；fixture 只在 review／tests 中使用。不能用假延时、静态 credits、浏览器临时状态或成功 toast 冒充持久化、权限、扣费与完成状态。
5. 若已批准的 `*Reference.tsx` 同时包含 fixture state，按真实接入需要抽取最小共享展示层：review 传 fixture，production 传真实数据。不要整份搬入生产，也不要复制一套视觉实现或另建通用框架。

**完成条件：** 每个可见操作都有真实能力和失败／恢复语义；尚缺能力明确标注为待交接。需要分批上线或隐藏已批准功能时，由 Founder 决定，不静默缩减验收范围。

## 4. 缺组件或需要改 UI 时怎么处理

先查 [primitives](../primitives/)、对应 pattern 和现有调用点。视觉值、组件行为、页面归属的修改位置依 [来源地图](../README.md)；兼容路径仍指向同一个 owner。

| 情况 | 处理方式与批准边界 |
|---|---|
| 现有组件已能表达真实状态 | 直接复用／组合，保持已批准布局和行为；后端字段命名不决定用户看到的布局或措辞 |
| 同一组件仅缺一个必要 variant／状态 | 在 canonical owner 扩展，检查其他消费者；不得在页面复制一个近似组件。可观察行为变化先写 mini spec；只在当前授权范围内实施 |
| 确实没有适合的组件 | 记录具体用户场景、为何现有组件／组合不足，提出最小补充；按风险流程批准后进入正确层级，并增加状态样张和行为测试。不按“以后可能用到”预建组件库存 |
| 改布局、交互步骤、页面归属或品牌方向 | 先记录到对应 spec 的 change register，向 Founder 展示影响并取得明确决定；涉及 IA 同时更新其 canonical artifact，而不是只改页面 |
| 新表面、退役实现，或涉及 money、auth、tenant、schema、data deletion | 属于重量任务；完整 spec 与 Founder 冻结后才能写实现，不能藏在 frontend refactor 中 |

轻量文案／数值修改仍先核对直接 SSOT；中量行为修改仍需 mini spec；本表不豁免全局 foundation check。方向反转须说明返工成本、提醒既有一晚冷静规则，并取得 Founder 明确再次确认。实施中提出的新想法先记 change register，再由 Founder 决定当下处理还是排队。

新增／扩展共享组件时，按适用场景覆盖 default、focus、disabled、loading、empty、error 等状态、可读名称、键盘操作和 reduced motion；测试所有受影响消费者，保持共享 API 的兼容性。基础库以当前仓库的 shadcn Base UI 实现为准，不能为接线便利另引入第二套基础交互库。

输入键位只读取 [apps/web/AGENTS.md](../../AGENTS.md)；tokens 与 motion 读取正式来源，不在这里复制数值。确需新设计参考时按项目规则先用 Mobbin MCP；组件 polish 优先 Emil。slash-only 技能按既有规则先提出再使用。普通数据接线无需重新搜参考或重启设计探索。

**例子：** 上传失败时，把真实错误接到现有反馈组件；若想新增一个确认弹窗或改变上传步骤，就先走交互变更流程，而不是称作“只是接 API”。

## 5. 验证：能调用接口不等于体验完成

- 按本次冻结验收条件逐条验证可见控件：点击、排序／筛选、键盘、焦点、关闭／返回、深链与刷新；共享组件改动覆盖其受影响调用点。
- 写真实行为测试：成功、失败、重试、取消、无数据／无匹配、不可用／无权限，以及适用的重复提交与刷新恢复。需要证明持久化时，不能只用 mock 或 fixture 测试代替真实非生产环境验证。
- 按风险运行相关测试、类型检查、scoped lint 和 production build，使用当前项目 scripts；结果记录具体运行范围和失败。DB、钱路与权限检查由对应后端合同和行为测试证明。
- 在真实浏览器走完改动流程，按该板块已批准的 viewport／键盘要求核对视觉与遮挡。浏览器、账号或测试环境不可用时写明未验证，不能称为通过；截图不能单独证明交互或保存成功。
- `design-system:audit` 仅统计 imports，不能证明整体设计／无障碍合规。source guard tests 只能证明它们实际断言的结构，不能替代行为测试。
- 自动检查通过、工程浏览器验证、Founder 验收分别记录。把本次变更展示给 Founder，得到明确接受后才关闭对应 UX 验收；旧版设计批准不等于新增 UI 变化已获批准。清单外反馈由 Founder 决定 fix-now 或 queued。

## 6. 交还结果：写回原处，不增加另一套权威

把结果追加到本板块现有 spec／acceptance ledger；接口缺口写回原 handoff，导航与 IA 改动写回其 owner。新增／移动设计 owner 时同步 README、authority map 和现有 guard tests。

每次交还至少包含：

- **范围与批准：** 本次目标、冻结验收条件与批准位置；未批准／未实现项单列。
- **设计变更：** 改了哪些 canonical components／variants、为何必要、影响哪些消费者；复用或抽取了什么，是否涉及 flow／IA。
- **接口：** 已接通什么，缺少什么，真实对象／业务状态的 owner 在哪里。
- **证据：** 测试、类型／lint／build、浏览器流程与查看路径；没跑、失败或仅 mock 的项目如实标注。
- **Founder 验收：** 待查看／反馈待处理／明确接受，附对应记录，不由 agent 自行替 Founder 签字。
- **交付边界：** 当前分支与工作树、是否提交／push、保留的工作及依赖；只报告实际执行过的动作。

这份文档只约束接线方法。它不创建新的设计系统、审批数据库或 agent 编排层；也不能单靠文字保证另一任务遵守，仍需入口发现、可执行检查、代码审查与 Founder 验收共同落实。
