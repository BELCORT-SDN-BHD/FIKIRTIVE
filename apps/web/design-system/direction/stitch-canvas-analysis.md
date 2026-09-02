# Founder 录屏分析:IDEA FOR CANVA SECTION.mov(2026-08-19,3:12,96 帧全览)

> **Current authority note（2026-08-29）：** Founder 已重新确认 Stitch 是 Creation 的唯一 interaction model，image/video 是 domain translation。当前待验收 spec 是 [`../patterns/canvas/stitch-image-video-parity-spec.md`](../patterns/canvas/stitch-image-video-parity-spec.md)；本文件其余内容是研究与历史决策，冲突时不能覆盖当前 spec。

## 视频内容纪实

Founder 在 stitch.withgoogle.com 上从零走了一遍完整流程:

1. **Stitch 首页**(f001):左侧项目列表(My projects / Shared with me + 搜索 + Recent),主区大标题 + 大输入框(App/Web 切换、模型选择、示例 chips、灵感画廊)。Founder 的 Stitch 账号里已有项目「Fikirtive Dashboard Interface」(Aug 19, 2026)。
2. **进入新项目**(f004-f016):整页即画布(深底点阵),四个常驻件:
   - **左上:浮动聊天气泡**——可展开成对话卡(显示 AI 回复全文),可收成小胶囊(``…``);流式输出时显示 Thinking…;工作时逐条列 agent 步骤(Extracting text from page / Extracting brand assets / Building the design system)带勾。
   - **左下:Agent log**——所有 prompt 的队列,每条带状态(spinner=进行中可点 X 取消,勾=完成),可折叠。
   - **底部居中:输入框(omnibox)**——placeholder "What would you like to change or create?",带 +(附件)、/(命令)、主题、模型选择(3 Flash / Thinking with 3.1 Pro / Redesign with Nano Banana Pro+截图)、语音、发送。
   - **右侧:垂直工具条**——光标选择 / 框选 / 附件 / 手掌平移 / 插图片 / 主题 / 收藏星。
   - 右下:undo/redo + 缩放百分比;顶栏:汉堡 + 项目名 + Export + Share。
3. **附件与上下文**(f022-f088):粘贴 GitHub URL → 变成 chip;macOS 文件选择器可直接附本地文件。发送后 Stitch 研究 URL,把「提取的网页文本」作为一个 artifact 卡放上画布(带 star/👍/👎 hover 操作),边研究边在聊天气泡里讲人话("I'm researching FIKIRTIVE on GitHub… I'll then create a design system and a dashboard…")。
4. **Founder 的原话 prompt**(f073 定格):
   > "sooo i am interested in generate a dashboard for my APP FIKIRTIVE, can you create a stitch like canva stuff for, my canva section, but tweaked for my app FIKIRTIVE. for the other section than Canva creation section, do for general design like sidekick from shopify"
5. **Stitch 自己规划的结构**(f091):"…design the Dashboard, the 'Fikirtive Canvas' (your Canva-like section for ad creation), and the 'Otto Sidekick' panel for AI-driven insights." 录屏在生成完成前结束——**重点是交互模型,不是生成结果**。
6. 轮播 tips 值得抄:⌘K command panel;Select multiple screens to edit together;Select [3x] to generate multiple design options;Format menu 自动排列 screens;Upload reference images to guide your design;多屏 stitch 成 Prototype。
7. 片尾(f094)Founder 短暂切到 LottieFiles/motion-design-skill 的 GitHub 页——动效意识在场。

## 提炼:FIKIRTIVE Canvas section 的交互语法(Stitch 模式移植)

- 进入 canvas section = **整页工作区**(脱离 dashboard 壳),商家的一个 project = 一张无限画布。
- 画布上的一等公民:生成的 image/video/文档/研究结果都是 **artifact 卡**,可选中、被引用、被迭代;hover 有轻量反馈(收藏/赞踩)。
- **对话不是侧栏,是浮在画布上的气泡**:平时收成胶囊,工作时展开讲人话 + 列步骤。
- **Agent log = 任务队列**:多条指令可排队、单条可取消,历史全留痕(呼应产品原则「有迹可循」)。
- **底部 omnibox 是唯一起手点**:自由输入 + 附件(本地文件/URL/Library 引用)+ 模式切换。
- 工具条只管画布操作(选/框/移/缩放),创作智能全走对话。
- Canvas 内的 Otto 会话按 project 分席,与外部 Otto 不连贯,共享 knowledge base(Founder 2026-08-20 亲述,后端讨论待连接期)。

## 外壳(非 canvas section)方向

- 传统 SaaS dashboard,以 Founder 两张参考截图为准:
  - 「Firma」财务 dashboard:近白底、白卡、细边框、圆角、KPI 行、图表卡、右栏列表、左侧分组导航。
  - 「Generate Articles」(Founder 特别喜欢,贴了两次):浅灰侧栏 + 白内容区、面包屑、大标题、pill 页签、**柔和多彩渐变卡**(紫/蓝/橙)、黑色主按钮、圆角友好但专业。
- 外壳加一颗 **Otto pop-up button**(Shopify Sidekick 式)——与 W2-7 面板/launcher 概念兼容,视觉按新方向重造。

## Mobbin 复核（2026-08-29）

以下结论来自 Mobbin 的 **Stitch Web** 实际 screen 与 flow；用于补足 Founder 录屏没有覆盖完整的进入、修改和导出步骤。

### 已核对的 flow

1. [Starting a chat](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4)
   - 首页是 prompt-first：左侧保留项目列表，主区以大输入框开始新项目。
   - 提交后直接进入全屏点阵 Canvas；AI 进度在左侧浮动对话中呈现，底部 omnibox 保留为下一次操作入口。
   - 生成完成后，design system 与多个 screen 都作为独立 Canvas node 排列，而不是塞进传统 dashboard 页面。
2. [Editing content](https://mobbin.com/flows/96a82cc1-c025-4b2c-9923-35c00f1c37bc)
   - 先选中一个 screen，再从顶部 `Generate / Modify / Preview / More` 进行对象级操作。
   - AI 修改会在 Canvas 上留下新的结果节点；原结果仍可比较和追溯，不能静默覆盖。
3. [Editing an element with AI](https://mobbin.com/flows/8ee291b6-5576-4322-bf56-104bc366199c)
   - 选中的 screen 或 element 会成为底部 omnibox 的 context chip。
   - 用户以自然语言描述修改，AI 只作用于当前 context，降低误改整张画布的风险。
4. [Adding a screen](https://mobbin.com/flows/c406e2c4-d94d-4435-aa25-0deb3a210e7a)
   - Prototype 模式会把 screen 集合放在左侧小面板；`Add screen` 从已有 screen 中选择并加入 prototype。
   - 这说明「Canvas node」和「可播放 prototype 的 screen 顺序」是两个不同层次。
5. [Downloading a screen](https://mobbin.com/flows/0ed48c7a-9f37-416d-8996-c0bef41c92ea)
   - Export 依附于当前选择；可导出到 Figma、zip、clipboard 等目标。
   - 完成后用轻量 toast 回报，不打断 Canvas。

### 当前 Stitch 的稳定结构

- 全屏、可缩放的点阵 Canvas 是视觉主角。
- 左侧 AI 对话可展开或收起；左下 Agent log 单独负责任务队列和历史。
- 底部居中 omnibox 是创建与修改的共同入口；选中的对象以 context chip 明示作用范围。
- 右侧竖向工具列负责选择、框选、平移与素材操作；顶部负责对象模式、Preview、Export、Share。
- 生成结果、design system、reference 和 screen 都是可选中、可比较、可追溯的 Canvas node。

### 精确会话状态机（19 个 Mobbin 画面复核，2026-08-29）

这里修正一个容易误读的地方：Stitch 没有把「status」与「chat」做成两套并列面板。

1. **底部 omnibox 是唯一输入源。** 每次发送 prompt，左下 Agent log 立即新增一条 turn/task。
2. **左上浮层只显示当前 turn。** Queued/Working 时，它用自然语言和步骤说明当前进度；完成后，它显示该轮 AI
   回复；需要批准时，批准内容也留在这一轮，不另开永久 inspector。
3. **左下 Agent log 是 turn/task history。** 收起时只露当前 prompt 与 `Agent log`；展开后显示全部 prompt、状态与
   可取消的 queued turn。选择历史 turn 会让左上浮层恢复到该轮回复或状态。
4. **选中对象成为 omnibox context。** 对 screen 或 element 的修改仍从同一个输入框发送；context chip 明示作用
   范围，发送后走同一条 Agent log → current turn → Canvas result 链路。
5. **生成不会封锁 Canvas。** Working 状态与结果 node 共存；完成时原 node 保留，新结果落在 Canvas，top-level
   toast 只回报 Export/Download 等轻量完成事件。

可核对画面保存在同一个 pattern 的
[`references/`](../patterns/canvas/references/)：`stitch-starting-chat-01…05`、
`stitch-editing-content-01…04`、`stitch-editing-element-ai-01…03`、
`stitch-adding-screen-01…04`、`stitch-downloading-screen-01…03`。

FIKIRTIVE 唯一有意偏离是 paid generation 的 credits approval：它插在当前 Otto turn 内，但不改变 Stitch 的
空间结构、输入源、history 选择或 Canvas 更新顺序。

### 与 Founder 录屏的差异

- 2026-08-19 Founder 录屏是深色点阵 Canvas；2026-08-29 Mobbin 收录的当前 Stitch 是浅色点阵 Canvas。
- 这是视觉主题变化，不是交互模型变化。FIKIRTIVE 应沿用已批准的浅色 design system，并保留 Stitch 的空间结构与 flow；不为了像 Stitch 而引入第二套深色 token。

### 对 FIKIRTIVE 的边界

- 可借鉴：Canvas 空间结构、context chip、生成/修改/比较、Agent log、Preview、Export、Share 的 flow。
- 不直接复制：Stitch 的 UI 生成模型选择、Figma/代码专属导出格式，以及只服务 UI screen 的对象类型。
- FIKIRTIVE 需要在后续 spec 决定：首批 artifact 类型、Otto project thread 边界、credit approval、失败与重试、版本比较，以及 Founder 能否从 Library/Brand/Campaign 引用对象。

## Founder 决策记录

### Canvas grilling · Round 1（2026-08-29）

- Canvas 的长期任务不是只生成 marketing creatives；Founder 要它支持完成任何与 creation 有关的工作。
- `Create` 入口采用 Stitch 式 prompt-first 首页：左侧最近 projects，中间主 prompt。
- 一个 project 代表一次独立的 marketing initiative 或 creation initiative，而不是品牌永久共用的一张 Canvas，也不是单个素材。
- 创作模式采用 Otto-first：Founder 描述目标、选择结果和微调，由 Otto 执行主要工作。

### Canvas grilling · Round 2（2026-08-29）

- 长期方向是可扩展的通用 digital creation workspace；未来可增加 image、video、copy、document、presentation、web page、audio 等 typed artifact。
- 首个可验收版本先把 image + video creation 做深；campaign kit 可以是常见用例，但不把产品模型限制成 marketing-only。
- 同一个 project Canvas 可混合放置 reference、research、documents、images、videos 与 final deliverables。
- Founder 的手动操作保持轻量：select、move、resize、group、duplicate、delete、rename；内容层修改主要交给 Otto 或 focused editor。
- Canvas 负责创作与审批；发布或投放通过显式 `Continue to campaign` / `Continue to schedule` 进入对应产品面，不能在后台静默执行。
- Composer 的统一 context 入口覆盖 Upload、URL、Library、Brand、Campaign 与 previous project。

### Canvas grilling · Round 3（2026-08-29）

- 第一条 prompt 没有固定 output preset。Otto 由 LLM 根据用户意图、Brand context 与当前 Canvas 判断：直接处理免费操作、追问必要信息，或提出动态 creation plan。
- 动态 plan 可以包含任意合理数量与组合的 image/video；不能把 `4 images + 1 video` 写成 UI 或业务默认。
- 当前 Brand、Audience 与 Visual Guidelines 自动加入 project，并以可移除的 context chip 明示。
- 默认视频路径是先生成/选择 image，再 `Animate` 成 video；明确需要时仍支持直接 text-to-video。
- 修改采用非破坏式版本：每次产生新 version，原稿保留，并可标记一个版本为 `Approved`。
- LLM 可以决定工作方案，但不能绕过付费边界；任何消耗 credits 的 generation 都必须在执行前显示真实成本并取得 Founder 批准。

### Canvas grilling · Round 4（2026-08-29）

- Otto 根据情况自行选择三种回应：信息足够且免费则直接完成；信息不足则只追问真正阻塞的问题；涉及付费 generation 则先提出动态 plan。
- Paid creation plan 按 item 显示 type、目标、比例/时长、reference 与 credits；Founder 可修改或删除单项，并可选择逐项 `Make` 或 `Make all`。
- 多项工作按 dependency 执行：无依赖任务可并行；依赖选定 image 的 video 等待上游选择/批准。
- Agent log 必须忠实显示 `Queued / Working / Awaiting approval / Done / Failed / Cancelled`，并保留历史。
- Otto 自动按 creation plan 在 Canvas 排列 node，默认使用 `source → versions → approved result` 的可读结构；Founder 仍可手动移动和重组。

### Canvas grilling · Round 5（2026-08-29）

- Image node 支持 Ask Otto、Create variations、Animate、Approve、Download；Video node 支持 Ask Otto、Create variations、Approve、Download。Contextual toolbar 只露出高频动作，其余收进 `More`。Round 5 后续的 Library `Generations` 决策取代 `Save to Library`：所有 generation 已自动索引，不能再放一个暗示「未保存会丢失」的重复按钮。
- 选中 node 后使用顶部 contextual toolbar；复杂设置才临时打开 popover/drawer，不保留永久右侧 inspector。
- 多选 2–4 个版本可进入 side-by-side Compare，显示 prompt、规格、credits 与 lineage；Founder 可从中标记一个 `Approved`。
- Library 增加 `Generations` 分类，让用户跨 project 找到全部生成结果。它是同一份 Generation 的全局索引，不复制文件；Canvas、Library、Campaign 必须引用同一个 artifact id。
- `Generations` 支持 project、type、status（包括 Approved）等 filter；所有生成结果自动可见，不要求 Founder 回 Canvas 逐个执行 Save。
- Campaign/Schedule handoff 只携带已 Approved 的 nodes。建议 flow 是先用 popup 选择 New/Existing campaign 或 Schedule，再转到目标页面并预填同一份 artifact；等待 Founder 最终确认。
- 第一阶段 Share 只支持 read-only link；多人实时编辑延期。

### Library 现状 spot-check（2026-08-29）

- `apps/web/app/library/page.tsx` 已将 Library 定义成跨 project surface，并按 owner 读取 `getRecentGenerationThumbs(ownerId)`。
- 因此 `Generations` 应实现成现有 Generation 集合的分类/filter，不建立第二份保存流程或复制表。

### Canvas grilling · Round 6（2026-08-29）

- Campaign/Schedule handoff 采用 popup → navigate：先选择 New/Existing campaign 或 Schedule，确认后转到目标页面，Approved assets 已按同一 artifact id 预填。
- Project 自动保存 node、位置、版本、conversation 与 Agent log；顶部只回报 `Saving… / Saved`，并恢复用户上次 viewport，不提供手动 Save 主流程。
- 离开 Canvas 不取消 generation；任务在后台继续，重返 project 时 Agent log 恢复 durable 最新状态。
- 正常 Canvas editor 完全 desktop-only；只有 read-only share link 提供 mobile layout，不扩大 dashboard 或主编辑器的 mobile scope。
- Otto 根据第一条 prompt 自动命名 project，Founder 可随时修改。

### Canvas grilling · Final round（2026-08-29）

- 只有 `Queued` generation 可以真正 Cancel；成功取消后显示 `Cancelled · credits returned`。已经 `Working` 的任务不显示无法兑现的 Cancel，完成后照常进入 Canvas 与 Library Generations。
- Trust states 必须逐字对应已证实的 money outcome：确认退款才显示 `Generation failed · credits returned`；未知时显示 `Confirming generation status…`；成功时显示实际 charged credits。
- 已退款的失败重新生成前必须重新报价和批准；未知状态只能恢复同一次 idempotent action，不能自动开启新收费任务。
- `Remove from canvas` 只删除 placement，Generation 仍留在 Library；`Delete asset` 只从 Library 发起并警告相关 Canvas preview 会失效。In-flight generation 不可 Delete：Queued 用 Cancel，Working 等待完成。
- Read-only share link 创建时可选择分享范围，默认 `Approved only`；不得默认暴露 prompt、references 或 drafts。
- 第一阶段 share link 是无需登录的 unlisted、revocable link，严格 view-only；mobile 只实现这个 share view。Comment、approve、edit 延期到正式 collaboration 设计。

### Grilling completion

- 2026-08-29：decision tree frontier 已清空，Founder 已确认 shared understanding。
- 当时的正式 authority 曾记录于 [`../patterns/canvas/README.md`](../patterns/canvas/README.md)；其后方向经历 Grok 与 Stitch-first 修正。当前以 README 指向的待验收 spec 为准。

## Jasper 参考复核（Mobbin，2026-08-29）

### 已核对的 flow

1. [Creating a campaign](https://mobbin.com/flows/8ee7874e-dd10-4682-b59b-fd833d715915)
   - Campaign 创建前绑定 name、Brand Voice 与 Knowledge，再批量选择要生成的 content types。
   - 生成后每个 output 有独立状态；campaign 是一组相关 artifact 的容器。
2. [Adding campaign content](https://mobbin.com/flows/9e1be2f1-8bf3-459d-b6f9-be90cfe31f0e)
   - 已存在的 campaign 可继续增加不同 content type，不必重新创建 project。
3. [Jasper IQ](https://mobbin.com/flows/0f6eea06-b833-4732-87fa-c20ea68a7a8b)
   - 当前 Jasper 也转向 prompt-first 首页，并把 Brand Voice、Audiences、Knowledge Base、Style Guide、Visual Guidelines 作为独立 context 类别。

### 对 FIKIRTIVE 的取舍

- 借：project-scoped context、typed artifact、一次 plan 可包含多个 output、每项独立状态。
- 不借：生成前的长 modal wizard、把所有类型一次铺成选择矩阵、表格型 campaign workspace。
- FIKIRTIVE 应让 Otto 从自由 prompt 推断 creation plan，再以清楚的 plan/card 让 Founder 审核；Brand 与 Knowledge 自动带入，并以可移除的 context chip 明示。

### 现有 generation 真相（repo spot-check，2026-08-29）

- `packages/core/src/gen.ts` 的在产 image model 是 `seedream`，video model 是 `seedance-2-mini`；支持的 kind 是 `image | video`。
- 同一文件定义的模式包括 t2i、i2i、t2v、i2v、i2v-tail，当前 Canvas spec 不需要重新发明 generation contract。
- `packages/generation/src/byteplus.ts` 将 image 映射到 Seedream 5.0，将 video 映射到 Seedance 2.0 Mini。
- UI 不展示 provider 或 model 名；Founder 只选择要完成的能力与结果规格。
