# Creation product pattern — R22 Canvas convergence

**状态：** Approved and frozen；first-class Create workspace amendment 已批准，prototype implementation 已授权。
**方向批准：** 2026-08-29 — “是的。”
**原 Spec 批准：** 2026-08-29 — “批准冻结 spec”。
**参考边界：** R22 是当前视觉与空间实现基线；它所采用的 Stitch agentic Canvas 原则继续成立。Fikirtive 只把 creation domain 翻译为 image/video，并加入 Otto、credits 与产品 handoff。

## 1. 为谁、成功是什么

主要用户是没有专业创作团队、也不想学习 prompt engineering 的小生意 Founder。

**一句成功定义：** Founder 能像使用 Stitch 一样，从一句目标开始，让 Otto 判断是否需要追问，在付费前确认准确 credits，并在同一张可拖动 Canvas 上生成、选择、修改、比较和延伸 image/video；旧结果、当前状态与完整 conversation 都不会丢失。

## 2. Source of truth 与翻译规则

### R22 拥有已选定的 surface model

- Prompt-first project home 与 recent projects。
- 全屏、可平移和缩放的无限 Canvas。
- 上方 Otto status、下方 Conversation history、底部 omnibox 的三件式 agent structure。
- Canvas artifact selection、context chip、object-level AI edit、variations、export 与 share。
- 原结果保留，新结果落在旁边的非破坏式 iteration。

Stitch Mobbin flows 继续作为 interaction research evidence，但不再要求另造一套比 R22 更像 Stitch 的外观。

当前可直接复核的 R22 completed-state capture 是
`references/r22-canvas-completed-1280x720.jpg`；它与本 spec 一起构成 Canvas convergence 的视觉依据。

### Fikirtive 拥有 domain truth

- Fikirtive brand、design tokens、Base UI primitives 与 Otto identity。
- Image/video 的产品语义、规格、references 与 Library/Campaign/Schedule handoff。
- 每次 paid generation 的 exact credits、一次性 confirmation、退款与 unknown 状态文案。
- Provider/model 是内部实现，不出现在 Founder UI。

| Stitch | Fikirtive Creation |
| --- | --- |
| App / Web | Image / Video |
| Generated screen | Generated image / video artifact |
| Edit with AI | Edit with Otto |
| Screen variations | Image/video variations |
| Screen context chip | Selected media/reference context chip |
| Export screen | Download / Share / Continue to Library or campaign |
| Design generation | Credit-bearing media generation |

### 明确不混入

- 不采用 Grok Imagine 的 feed、Discover、single-result page 或 history-as-navigation 结构。
- 不采用 FLORA 的手动 node graph、连线与 block programming 心智模型。
- 不采用 Canva AI 的 chat-to-separate-editor 两段式结构。

## 3. Mobbin 研究依据

1. [Starting a chat](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4)：prompt-first 首页、进入 Canvas、current turn、Agent log 与持续 omnibox。
2. [Generating a screen](https://mobbin.com/flows/9d6c0018-3e6e-4e80-a2ae-746a8874373c)：从已有 artifact 继续生成，并把结果加入同一个 project context。
3. [Creating variations](https://mobbin.com/flows/cdcaabae-3a6c-4379-bbce-0b0f3ed5e6bc)：选中对象、指定 variation 数量/强度/变化维度，结果并排出现。
4. [Editing an element](https://mobbin.com/flows/1b15996f-5865-43db-bc3b-221b950a0629)：选中对象或 element 后以 `Edit with AI` 进入 focused modification。
5. [Adding a screen](https://mobbin.com/flows/c406e2c4-d94d-4435-aa25-0deb3a210e7a)：从已有输出继续扩展 project，不跳离 workspace。
6. [Uploading an image](https://mobbin.com/flows/0facc57e-f3b6-4e68-98cc-16b112245fe5)：reference attachment 进入同一个 creation context。
7. [Downloading a screen](https://mobbin.com/flows/0ed48c7a-9af7-48f6-959a-aea94feb0f60)：export 依附当前选择，并以轻量 feedback 完成。

## 4. Canonical surface anatomy

### A. Founder Home

- 产品只有一个 Home；它只负责 Founder 的 marketing health、insights 与 next actions。
- Home 可以提供 `Continue creating`、recent canvas 或 recommendation handoff 等跨板块快捷入口，但不渲染 creation composer、project manager、Conversation、agent status 或 Canvas tools。
- Sidebar `Create`、Home 的 `Create something new` 与 recommendation-specific `Create this` 都进入同一个 first-class Create workspace；context 必须可见、可移除，不自动提交或扣 credits。

### B. First-class Create workspace

- `Create` 与 Home、Library、Campaigns、Schedule 同级，是主 application shell 内的独立 product area；它不是第二个 Home，也不是 Home 的展开状态。
- 页面 title、breadcrumb 与 active navigation 统一使用 `Create`。
- 主内容只承载 prompt-first composer、Image / Video、attachment、必要规格、recent canvases 与 creation starting points。
- 示例只作为 prompt 起点，不把 output plan 固定成 preset。
- 第一条 prompt 由 Otto 自动命名 project；提交或打开 existing project 后进入 full-screen Canvas。

### C. Full-screen Canvas workspace

- Creation 脱离 dashboard shell，使用完整 desktop viewport。
- Canvas 是主要空间；支持 pan、zoom、select、multi-select 与 drag reposition。
- Image、video、reference 与 Otto 产生的 supporting artifact 都是可选择对象，但 Founder 不需要建立连线或 workflow graph。
- 自动排列用于保持新结果可读；Founder 手动移动后不自动抢回位置。

### D. Otto status（上方）

- 只展示当前任务状态：idle、needs input、needs confirmation、working、done 或 needs attention。
- Working 时以简短自然语言和必要步骤解释系统在做什么；Done 后只回报真实结果。
- 它不是对话副本、永久 inspector，也不承担历史浏览。

### E. Conversation history（下方）

- `Conversation` 保存用户消息、Otto 回复、结构化 decision record 与 task receipt，不是第二个 status panel。
- 参照 Stitch 的 Agent log：Conversation 停在画布左下，默认是低干扰 dock；展开时向上长成一条时间顺序 thread，而不是另一组 status cards。
- 每一轮以 user prompt 为主、Otto receipt 与真实状态为辅；点击历史轮次只恢复上方 Otto status/context，不在 history 内复制完整工作面板。
- 每条 task/decision 显示真实状态：`Queued / Working / Needs answer / Needs confirmation / Done / Failed / Cancelled / Confirming status`。
- 展开历史时可恢复该轮回复、问题、决定与结果 context。
- 只有尚未开始的 Queued paid task 可以 Cancel；已经 Working 的动作不展示无法兑现的取消按钮。

### F. Omnibox（底部居中）

- 它是创建、自由回答和修改的主要文字输入源；R22 结构化 question card 可以直接收单选、多选或 `Something else`。
- 支持 Upload、URL、Library 与 Brand context。
- 当前选中的 artifact 以可移除 context chip 明示，避免 Otto 修改错误对象。
- Image / Video 是 creation capability，不暴露内部 provider/model。

### G. Selection 与 object actions

- 选中 artifact 后显示紧贴对象的高频 actions；复杂设置使用 origin-aware popover。
- Image 高频 actions：Ask Otto、Variations、Animate、Download、More。
- Video 高频 actions：Ask Otto、Variations、Download、More。
- `Edit with Otto` 会把 selection 加入 omnibox context；修改产生新 artifact/version，不覆盖原稿。

### H. Workspace controls

- 顶栏只保留 R22 的 project name、saving truth 与 prototype truth；没有真实 destination 的 Preview / Export 不制造假按钮。
- 右侧工具条：select、frame select 与 pan；media creation 由底部 omnibox 负责，不建立第二个入口。
- 右下：undo/redo 与 zoom。
- Download 与 share link 依附当前 selection；Share 只暴露 selected-output 的 read-only fixture。

## 5. Agentic decision loop

每次 omnibox submit 后，Otto 只能选择下列一条路径：

1. **免费且信息足够：** 直接完成，并在 current turn 回报结果。
2. **缺少阻塞信息：** 只问真正影响结果的问题；R22 question card 可把一个决定拆成少量连续问题。
3. **将消耗 credits：** 在 current turn 内展示下一次 generation confirmation。

### Blocking question

- 问题必须改变 output、规格或成本；非必要 preference 由 Otto 使用合理默认值。
- 每题提供 2–4 个快捷答案，并保留 `Something else`。
- 问题住在当前 Otto task 内；答案写入 Conversation decision record，完成后继续同一 task，不创建新的 project。
- 等待回答期间显示 `0 credits`；回答结束后若下一步付费，必须进入 paid confirmation，不能直接生成。

### Paid generation confirmation

- 显示即将生成的 output、数量、image ratio 或 video duration、使用的 references 与 exact credits。
- 多 output 可以列出多个 item，但它仍属于当前 conversation turn，不变成永久 plan workspace。
- Primary CTA 使用 `Generate · N credits`；secondary actions 是 Edit details / Cancel。
- Confirmation 只能提交一次；提交后变成 receipt/status，不继续保留可重复付款按钮。
- **没有生成后的强制 Approved gate。** Founder 选择某个结果继续使用，就是明确 selection；credits confirmation 是生成前的唯一付费批准。

## 6. 必须可完整走通的 flows

1. `Create workspace composer → image prompt → Canvas confirmation → Working → image artifacts`。
2. `Ambiguous prompt → R22 question card → answers recorded in Conversation → exact-credit confirmation → artifacts`。
3. `Select image → Edit with Otto → context chip → confirmation → new version beside source`。
4. `Select image → Variations → count/range/aspects → confirmation → side-by-side variants`。
5. `Select image → Animate → duration/motion confirmation → video artifact beside source`。
6. `Direct video prompt → necessary question or confirmation → Working → video artifact`。
7. `Submit another prompt while Working → Queued in Conversation → starts when dependency allows`。
8. `Select historical Conversation turn → restore response/status/result context → continue from omnibox`。
9. `Queued → Cancel → no generation`; refunded only when refund is confirmed。
10. `Result → Download / selected-output Share`，保持同一个 artifact identity；Campaign / Schedule 是 Founder 验收本 fixture 后的 production integration。

## 7. Trust、persistence 与 failure rules

- Generation 状态由服务端 truth 决定；关闭页面不取消已付费工作。
- Project 自动保存 artifacts、positions、viewport、conversation 与 Agent log；顶栏只诚实显示 `Saving… / Saved / Save failed`。
- `Generation failed · credits returned` 只能在 refund 已确认时显示。
- 结算未知时显示 `Confirming generation status…`，只能恢复同一次 idempotent action，不能创建第二次收费。
- `Remove from canvas` 只移除 placement；Generation 仍在 Library 的 Generations index。
- Prototype 只展示 fixture behavior，不调用 production generation、money、persistence 或 external handoff。

## 8. Motion 与 interaction polish

依据 `emil-design-eng`：高频操作优先即时和可打断，不为了“看起来高级”增加延迟。

- Pan、zoom、selection、keyboard shortcut 与 pointer-following drag 不加装饰性 enter animation。
- Artifact 拖动期间直接跟随 pointer；使用 pointer capture，禁止第二触点令对象跳位。
- Popover：150–200ms strong ease-out，从 trigger 的 transform origin 出现；关闭更快。
- Dialog：200–250ms ease-out，保持 center origin。
- 新 artifact ready：最多 180ms opacity + `scale(0.98 → 1)`；不能从 `scale(0)` 出现。
- Button press：100–160ms、`scale(0.97)`；只在实际 pressable control 使用。
- Progress indicator 使用 linear motion；结果进入不得等待 stagger 完成才可操作。
- `prefers-reduced-motion` 下移除位移动画，只保留帮助理解的 opacity/color feedback。
- UI transitions 只动画 transform 与 opacity；不使用 `transition: all`。

## 9. Checkable acceptance criteria

1. Home 与 workspace 可逐项映射到上述 Stitch Mobbin flows；页面不再出现 Grok Imagine navigation/feed。
2. Workspace 是 desktop full-screen Canvas；1440×900 与 1920×1080 下无遮挡。
3. Canvas 可 pan、zoom、select；所有用户内容节点（image、video、sticky note、extracted reference）共享同一套 drag 行为，且不要求用户建立 node connections。Batch boundary、Otto status、Conversation、composer 与工具条不是内容节点，保持固定。
4. 上方 Otto status、下方 Conversation、底部 omnibox 三个 surface 职责不重叠。
5. Conversation 保存全部 turns、decisions 与 receipts；历史可恢复对应 context。
6. Omnibox 是主要自由输入源；selection 通过 context chip 进入下一次 Otto request，结构化 answers 由 R22 question card 收集。
7. Direct、question、confirmation、Working、Done、Failed、Cancelled 与 unknown status 都可验收。
8. 每次付费动作先显示 exact credits，并防止 confirmation double-submit。
9. Edit、variation 与 image-to-video 都生成新 artifact；原结果保留。
10. Image/video generation progress 与结果真实出现在 Canvas，不跳转 single-result page。
11. Download 与 selected-output Share 依附当前 selection，并提供诚实 feedback；Campaign / Schedule 不在本 fixture checkpoint 伪装完成。
12. Keyboard focus、Escape、pointer capture、multi-touch protection 与 reduced motion 可验收。
13. Prototype 明确标注 fixture-only，不调用 production money、generation、persistence 或 navigation action。
14. Brand/tokens/primitives 全部从 `apps/web/design-system/` 现有 owners 消费，不复制新的视觉 truth。
15. Founder Home 与 Create workspace 消费 `@fikirtive/core/navigation` 的导航权威，不复制第二份 labels/routes；`Create` 是 first-class product destination，进入 new 或 existing project 才切换 full-screen Canvas。

## 10. Non-goals

- 逐像素复制 Stitch brand、logo、copy、模型名称或 UI-generation 专属 export。
- Feed-style creation、Discover gallery、single-result page 或 history navigation。
- FLORA-style manual workflow graph、timeline editor、full pixel editor 或 mobile Canvas editor。
- 把 Otto planning 固定成某种 output 数量或 preset bundle。
- 在 prototype 接入真实 generation、credits、Library、Campaign、Schedule 或 Share backend。

## 11. Direction change 与 scrap cost

- 2026-08-29：Founder 修正方向为“像 Stitch 一样 agentic，只把 website design creation 换成 video/image”。
- 2026-08-29：Founder 方向批准：“是的，可以”。
- 当前 Grok prototype 的 fixture-only route、brand/primitives 与部分 media assets可复用；navigation、surface hierarchy、state model 与主要 interaction 必须重写。
- 在本 spec 获得 Founder 明确批准前，不修改 prototype implementation。
- 2026-08-29：Founder 重新选择已保留的 R22 Canvas 作为实现基线。scrap 仅限当前未通过的 Canvas fixture；design system、Founder Home、application shell 与其他已通过表面不回退。

## 12. Founder acceptance

**Spec approval：Approved and frozen；R22 baseline amendment approved。**
**日期：** 2026-08-29。
**Founder 原话：** “批准冻结 spec”；“ok 对，从这个版本开始处理吧。”

## 13. 2026-08-29 interaction refinement addendum

**Intent：** 保留 Founder 已通过的 R22 Canvas，同时把三个仍显得像 fixture 的接缝收紧：全部 board content 可拖动、Conversation 更像 Stitch 的持续 thread、Creation Lab 明确属于 Fikirtive 主壳。

**Mobbin evidence：**

- [Stitch · Starting a chat](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4)：project entry 是 prompt + project list；Canvas 内左侧 current agent work、左下 Agent log、底部 composer 同时持续存在。
- [Stitch · Adding a screen](https://mobbin.com/flows/c406e2c4-d94d-4435-aa25-0deb3a210e7a)：新增 screen 留在同一张 spatial canvas；screen list 是内容工具，不是第二个 app shell。
- [Stitch · expanded agent workspace](https://mobbin.com/screens/83b04e08-0003-4d20-b6f4-4e1c0ed60aaf)：current work 与 Agent log 分责，composer 固定，Canvas 保持最大面积。

**Checkable acceptance：**

1. Image、video、sticky note 与 extracted reference 都带 `data-canvas-node`，由同一 `beginNodeDrag` / `moveNode` pointer engine 更新位置；zoom 后仍按 Canvas 坐标移动。
2. Conversation 按最旧到最新排列；active turn 清楚但不把 Otto status card 复制进 history；展开/收起不移动 composer 或工具条。
3. Creation Lab 不再出现 My projects / Shared with me 的第二条 rail；它从 `MERCHANT_NAV` 渲染主导航，并把 prompt、recent work 与 starting points 收进同一内容面。
4. Prototype 仍是 fixture-only；本 addendum 不接 production generation、money、persistence 或 auth。

**Founder request record：** 2026-08-29 — “canvas里面的nodes都要能自由拖动”；“conversation history 可以找一个更适合的设计吗？看看stitch的（使用mcp）”；Creation Lab 必须考虑从 Fikirtive Home 的入口进入。

### Founder Home → Creation approval（superseded）

2026-08-29 早先批准的 hybrid entry（Home → Creation Lab → Canvas）已由 §15 的 Unified Founder Home amendment 取代。

## 14. 2026-08-29 information architecture correction addendum（superseded）

**Intent：** 消除“两个 Home”的心智模型，把创作区明确定义为一个从唯一 Fikirtive Home 进入的 product module。

**Checkable acceptance：**

1. 产品只有一个 `Home`，它仍是 Founder marketing health dashboard。
2. 创作入口在导航、breadcrumb、page title 与 Otto 指路真相里统一命名为 `Creation Lab`。
3. 页面关系是 `Home → Creation Lab → Canvas workspace`；具体 recent canvas 可从 Home 或 Creation Lab 直达 Canvas。
4. Review fixture 使用 `surface=lab`、`CreationLab` 与 `creationLabReviewHref`，不再用 `home` 命名创作 surface。

**Founder approval：** Approved and frozen on 2026-08-29 — “ok可以”。

## 15. 2026-08-29 Unified Founder Home amendment（superseded）

**Intent：** 移除第二个 Home-like Creation Lab。原 Founder Home 保持全产品唯一 Home，并通过内嵌 creation components 负责开始与继续创作；Canvas 仍是唯一完整 creation workspace。

**Professional model：** `Single Home architecture with an embedded Creation module`；Home 到 Canvas 使用 progressive disclosure。

**Checkable acceptance：**

1. Review prototype 不再渲染 `CreationLab`、`surface=lab` 或独立 Lab shell。
2. Founder Home 保留 marketing health hierarchy，并拥有 `Continue creating`、recent canvases 与按需展开的 new-creation composer。
3. `Create something new` 与 recommendation-specific `Create this` 在 Home 展开同一个 composer；后者带一个可见、可移除 context。
4. Composer submit 直接进入 full-screen Canvas；existing canvas shortcut 也直接进入 Canvas。
5. Canvas Back 回 Founder Home，不回独立 Lab。
6. Review shell 的 Create destination 指向 Home creation module，不进入 production `/create` 或 auth wall。
7. Home 不复制 Conversation、Otto status 或 Canvas tools；这些仍只存在 full-screen Canvas。
8. Creation composer、route builders、navigation labels 与 Canvas back target 各自只有一个 owner。
9. Prototype 继续 fixture-only，不接 production generation、money、persistence 或 auth。

**Scrap：** 只退役未通过的独立 Lab shell/page composition；R22 Canvas、drag engine、Conversation、Otto status、fixtures、tokens 与 Home marketing components 全部保留。

**Founder approval：** Approved and frozen on 2026-08-29 after the standing direction-change reminder — “确定。”

## 16. 2026-08-29 first-class Create workspace amendment

**Intent：** 修正 §15 对“不要两个 Home”的错误解释。产品仍只有一个 Home，但 `Create` 是与 Schedule 等主导航板块同级的专用 creation workspace；它拥有不同于 Home 的主内容，而不是 Home 的展开状态。

**Professional model：** `First-class product area with a dedicated workspace route`。

**Checkable acceptance：**

1. 点击 sidebar `Home` 只显示 Founder marketing dashboard；不出现展开式 creation composer。
2. 点击 sidebar `Create` 进入独立 Create route，breadcrumb、H1 与 active navigation 都显示 `Create`；主体画面与 Home 不同。
3. Create workspace 与 Schedule calendar 一样复用同一个 application shell，但主体只保留一个 prompt-first Otto composer 与 Canvas history；不叠加 starting points、建议 prompt、统计 badge 或 dashboard 模块。
4. Home 可以保留轻量 `Continue creating` / contextual handoff，但所有 new-creation actions 都进入 Create workspace，不在 Home 原位展开。
5. Create workspace submit 或打开 recent project 后进入 full-screen Canvas。
6. Canvas Back 回 Create workspace；不回 Home。
7. Legacy `surface=lab` 与旧 Home `intent=create` review URL 都 redirect 到 canonical Create workspace，不保留第二套 surface。
8. Create composer、route builder、navigation destination 与 Canvas back target 各自只有一个 owner。
9. Prototype 继续 fixture-only，不接 production generation、money、persistence 或 auth。

**Scrap：** 撤销未通过的 Home embedded composer 与 Unified Home route intent；保留 Home dashboard、Home shortcuts、Create composition、R22 Canvas、drag engine、Conversation、Otto status、fixtures、tokens 与 shared shell。

**Founder approval：** Approved and frozen on 2026-08-29 after the standing direction-change reminder — “是的。”

### 16.1 2026-08-30 Create workspace simplification

**Intent：** Create 是 task-oriented workspace，不是第二个 Home 或 creation dashboard。Founder 要求把入口收敛为一个简单的 Otto 对话框与 Canvas history。

**Mini acceptance：**

1. Create 的主体只呈现 `Create with Otto` composer 与 `Canvas history`。
2. 不呈现 starting points、建议 prompt、recent count badge 或营销 dashboard。
3. Composer submit 与 Canvas history item 继续进入同一个 full-screen Canvas。
4. Application shell、canonical route、fixture-only 边界与 shared navigation owner 不变。

**Founder direction：** 2026-08-30 — “我认为一个简单的otto 对话框 + canva history 就好”。

### 16.2 2026-08-30 Stitch-minimal interaction pass

**Intent：** 把 Stitch 的 minimalism 落在完整 creation journey，而不是只缩小某一张卡。Canvas 继续是产品本体；Otto 只作为轻量、持续、随状态变化的控制层。

**Selected visual evidence：**

- [Starting a chat](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4)：Create 入口只突出 prompt 与 project history；active project 让 Canvas、current turn、collapsed Agent log 与 composer 形成一个连续 surface。
- [Editing an element](https://mobbin.com/flows/1b15996f-5865-43db-bc3b-221b950a0629) 与 [Creating variations](https://mobbin.com/flows/cdcaabae-3a6c-4379-bbce-0b0f3ed5e6bc)：selection 决定 actions；复杂动作在对象附近展开，结果留在同一张 Canvas。
- [Uploading an image](https://mobbin.com/flows/0facc57e-f3b6-4e68-98cc-16b112245fe5) 与 [Downloading a screen](https://mobbin.com/flows/0ed48c7a-9f37-416d-8996-c0bef41c92ea)：reference 进入 composer context；export 依附 selection，以轻量 feedback 结束。

**Mini acceptance：**

1. Create 主体保持 `Create` product area，但移除重复的 Otto identity、explainer、charge note、重阴影与 nested card hierarchy；一个 shared composer 是唯一 primary action。
2. Create history 使用低干扰的语义列表；不增加第二条 rail、dashboard widget、starting points 或 prompt suggestions。
3. 初始 composer 不持续展示 Image / Video、ratio 或 duration。Prototype 从 prompt 与 selection 推断 capability；只有会改变 output 或 cost 时，Otto 才在 current turn 追问。
4. Canvas 左上只有一个 current-turn surface。Status、blocking question 与 paid confirmation 是它的互斥状态，不再同时渲染多张 agent cards。
5. Conversation 默认折叠；展开后只显示 chronological prompt、简短 Otto receipt 与真实状态，不复制 current-turn work panel。
6. Generation progress 留在对应 artifact；Canvas 不出现全局 progress dashboard、永久 plan 或 queue board。
7. Selection actions 保持 contextual；variation、edit、animate 与 export 都不跳离 Canvas，新结果继续放在 source 旁边。
8. Credits confirmation 是 Fikirtive 必须保留的差异，但只显示下一次动作、必要规格、exact credits 与一次性 Confirm / Cancel。
9. 高频操作不增加装饰 motion；popover 125–180ms ease-out，button press 100–160ms，keyboard、pan、zoom 与 drag 即时响应并遵守 reduced motion。
10. 1440×900 与 1920×1080 下，artifact Canvas 始终是 active workspace 的最大视觉区域；Create 与 Canvas 的 core path 可由键盘操作且没有遮挡。

**Founder approval：** Approved on 2026-08-30 — Founder 在收到完整 Mobbin-backed reduction report 后回复“ok”。

### 16.3 2026-08-30 Design-system convergence pass

**Intent：** Founder 已确认当前 Create / Canvas 视觉方向，本轮不重做画面，只把 QA 发现的 radius、control primitive、typography、motion 与 Otto contrast drift 收回正式 design system owner，确保以后修改能从单一来源传播。

**Mini acceptance：**

1. Canvas pattern 不再使用 `rounded-xl` / `rounded-2xl` 作为 product surface radius；card-like surfaces 统一消费 `--radius-card`。
2. Canvas 的可点击 controls 使用 canonical Base UI-backed `Button` / menu / popover；composer 使用 `InputGroupTextarea`。隐藏 file input 是 browser upload mechanism，不属于可见 control 例外。
3. Canvas pattern 不保留任意 `text-[Npx]`、arbitrary tracking 或 literal `duration-150 ease-out`；只使用 foundation typography / motion utilities 与 variables。
4. Canonical `Button variant="otto"` 保留 Fikirtive / Otto coral，同时 small text foreground 达到 WCAG AA 4.5:1。
5. 自动 guard 拒绝 Canvas pattern 重新加入 raw `<button>`、raw `<textarea>`、legacy surface radius 与上述 typography / motion literals。
6. Create / Canvas 的 routes、布局、drag / pan / zoom、question、exact-credit confirmation、generation 与 Conversation 行为保持不变。
7. 1440 × 900 重新走 Create → question → confirmation → generating → completed → Conversation / contextual actions；没有新增 overlap 或 browser console error。

**Founder approval：** Approved on 2026-08-30 — Founder 在收到 Canvas design-system QA 与修复范围后回复“好的。”。
