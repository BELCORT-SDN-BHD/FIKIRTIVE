# Library／官方 Avatar 设计一致性证据

日期：2026-09-08。比较对象：已部署版本 `0e1f2ab3` 的代码与该版本自带设计／规格，通过 `git show 0e1f2ab3:<path>` 读取。此文件是 **source-only 代码与设计比较，不是 live UI 测试结果**；浏览器结果与截图由主报告单独持有（包括 Screens 12、20）。本次没有运行测试、查询生产数据库、调用生成或修改产品代码。

以下代码与规格行号均指 `0e1f2ab3`，除明确标注“当前工作树”的文件。

## 1. Library media detail

### 已核实的展示偏离

- 批准设计 `apps/web/design-system/patterns/library/README.md:71–79` 规定顺序：large preview → `Use in Canvas` → Favorite／Collection／Download → provenance → creation context；长内容折叠。冻结与 Founder 接受 fixture 的记录在 `:118–132`。
- 正式 Library 在 `apps/web/components/library/LibraryView.tsx:1257–1260` 挂载旧 `components/asset/DetailPanel.tsx`。该面板 `:890–893` 直接显示完整 `gen.prompt`，`:944–950` 直接显示 image engine receipt，没有折叠控件；动作区直到 `:1019` 才出现。长 context 在复用动作前展开，违反上述顺序与长文折叠规则。
- 同一面板 `:984–1015` 显示 Image shape／Video spec；`:1053–1124` 显示 Regenerate／Animate／Crop；`:1253–1277` 显示 edit composer。面板中未找到 `Use in Canvas` 文案或 Canvas handoff 调用。

### 必须保留的跨规格冲突

不能把所有详情编辑操作直接认定为“未经批准”。Library README `:98,110` 要求 Library 不出现 creation composer，生成与编辑进入 Canvas；但是同一部署版本的冻结 `docs/specs/creation-engine.md:65`（CREATE-A1）明确包含“资产详情 Generate edit”，`:76`（CREATE-A12）包含对资产 Regenerate。引擎 spec 的批准记录在 `:4`。

因此，直接编辑／重做的表面归属应分类为 **已批准 artifacts 之间的范围冲突**，需要在现有 change register 对齐；不是工程师可以凭某一份文档静默删掉的功能。`docs/specs/frontend-baseline.md:13,56,64,81` 同时要求不重开已批准设计、FRONT-A14 对齐并登记差异，未在本次读取中找到允许把 Library 变成完整编辑器的明确设计豁免。

建议方向：先统一 Library／Canvas 的动作归属，再在 approved presentation 边界接真实 typed Generation ID。保留共享业务动作；不把“共享动作”误读为所有表面必须共用同一套布局。Preview、Download、Favorite、Add to collection 本身符合设计；Copy link／Move to trash 有后续实现与语义，不因按钮多就一概判违规。

### 提示词来源标注

- `apps/web/lib/asset-actions.ts:182` 把 `Generation.promptText` 返回为面板 prompt；`:188` 比较 `sentPromptText` 与 `job.requestedPrompt ?? gen.promptText`。
- 同文件 `:236–239` 仅做字符串相等比较；`DetailPanel.tsx:948` 依据 `verbatim` 显示 `Sent exactly as you wrote it.`。
- 这证明一个可定位的语义脆弱点：若 `requestedPrompt` 缺失且 `promptText` 已经是 Otto 扩写稿，相等比较仍会把扩写稿描述成用户亲写原话。本次未读取该生成任务的原始聊天／数据库记录，**不能凭源码坐实具体案例是哪条写入路径丢失原文**。浏览器报告可分别记录所见错误表达与用户输入。
- 修复验收应区分用户原话、Otto 增强稿、实际发送文本；缺原话时不能用扩写稿替代并宣称 verbatim，也不能仅藏掉错误陈述。

当前工作树的 `apps/web/design-system/governance/content-disclosure.md:3–5,20–22` 有 2026-09-05 批准的信息展示原则，但该文件 **不在 `0e1f2ab3` 中**。可作为当前政策评审依据，不能称已部署；以上长文／顺序偏离不依赖它即可成立。

## 2. Official avatars

### 已批准能力与实现缺口

| 项目 | 批准／设计证据 | 部署代码证据 |
|---|---|---|
| Preview、search、filter、Favorite、Use in Canvas；只读身份 | Library README `:64–65`；冻结／fixture 接受 `:118–132` | `LibraryView.tsx:499–543` 只有名称、只读 badge、封面、条件删除；没有 reuse／favorite。`:396–397` 注释明确当时因缺契约而省略两项 |
| Route-backed actor detail | README `:69`；演员方向选择 `:133` | `LibraryView.tsx:422,471,499` 使用本地 selected state 与 Dialog，没有选中 actor 的 route identity |
| Search／filter | README `:64`；方向记录 `:133–135` | `LibraryView.tsx:426` 只按 element kind 过滤；`:447–489` 是 tabs 与通用卡片；`lib/library-elements.ts:22` 明说 Elements 无分页／筛选 |
| 完整真实 reference 预览 | README `:133` 的 evidence panel；fixture sheet／action tabs | `library-elements.ts:37–40` 读取 references，但 `:48,63–64` 只返回首图 URL 与总数；`LibraryView.tsx:518–527` 只能显示首图。不能据此断言第二张素材不存在 |

### 批准可信度与不能混淆的边界

- README `:133` 记录 Founder 选择较大 portrait cards、use-case shortcuts、route-backed evidence panel；`:134` 记录具体演员 fixture 已实现，但 **actor-specific final visual acceptance pending**。不能把实现完成当作 Founder 最终验收。
- `apps/web/design-system/patterns/library/OfficialAvatarsView.tsx:81` 有 `AI generated` badge；`:145–175` 有 Character sheet／In action／default wardrobe；`:195–202` 有 Use in Canvas／Favorite。这些是被选方向的实现证据，不是生产数据完整性的证据。
- 同文件 `:189` 说明 voice 按视频设置，不固定到演员。**没有依据要求固定 voice sample／播放器**。
- Fixture 六个演员不等于生产必须六个。真实身份由 Creation engine 持有；本轮注册播种五个的运行结果由主报告持有，本 source-only 报告不重复认证。
- Wardrobe 有独立明确批准：冻结 `docs/specs/creation-engine.md:4`；`:107–108` 记录 actor × wardrobe 两轴模型及 Founder“就先这九套”。`:108` 要求每套同脸视频验证后才向商家开放。不得用未经验证的 preset 或 fixture 样片补齐界面。
- `OfficialAvatarsView.tsx:183–184` 的 commercial-rights 语句是 fixture copy；接生产前需真实 catalog／许可依据，不能复制文案即宣称事实成立。

### Data contract 与 UI 分开判定

`apps/web/lib/library-elements.ts:32–42,55–65` 返回身份、origin／capabilities、一个 cover、count；没有 age、gender、vibe、industry、完整 references、samples、wardrobe 或 voice context。丰富演员详情需要 typed read contract 与 UI 接线。**这些字段未返回，不证明源数据不存在。**

`LibraryView.tsx:396–397` 关于“缺 reuse／favorite 契约”的注释是实现时判断；现有 reference infrastructure 已有 official-avatar 类型测试，不能把旧注释当成今日能力不可实现的证明。先核对现有 reader／resolver／action 再决定缺口。

### 建议验收

1. 普通新用户打开 actor、预览真实 linked references、Use in Canvas 后可见可移除 typed actor context；handoff 不自动生成或扣费。
2. Search／已支持 filters 消费真实 metadata；筛除已选 actor 后关闭 detail，不自动替换；route／Back 恢复 Library 状态。
3. Favorite 刷新后保留；官方身份不可编辑；真实权限／跨租户拒绝由后端测试证明。
4. Actor＋product 生成的报价与实际 references 一致；结果保留 references；至少两个不同场景同脸验收对应 `creation-engine.md:74` CREATE-A10。
5. Wardrobe 读取同一 canonical actor／preset 来源，只有验证过的选项开放；显示缩略图不代替原始生成 reference bytes（`creation-engine.md:106–108`）。
6. 缺样片／metadata 时诚实表达，不用 review fixtures 冒充真实资产。

## 3. 已发现的测试（未运行）

- `apps/web/lib/__tests__/library-pattern.test.ts:47–56,76–90,131–135`：fixture／source guards，覆盖 badge、voice copy、favorite owner、stable actor handoff、筛除后关闭；不能证明生产 E2E。
- `apps/web/lib/__tests__/library-baseline-seg2a.test.ts:362–380`：挂载正式 Library，断言 actor 只读 badge、无删除；不覆盖 reuse／filter。
- `apps/web/lib/__tests__/library-tenant-isolation-seg2a.test.ts:177–183`：播种演员归入 official category。
- `apps/web/lib/__tests__/reference-picker-unified.test.tsx:146–154,306`、`reference-search.test.ts:131–136`、`message-reference-refs.test.ts:105–110`：official-avatar picker／typed references 相关覆盖。
- `apps/web/lib/__tests__/official-avatar-readonly-ui.test.ts:141–151` 与 `official-avatar-readonly-actions.test.ts`：只读保护覆盖。

CodeGraph: not used — 非持图 worker worktree；使用已有部署 commit 的定向源码／设计读取。未 fetch、未查询数据库、未执行测试。
