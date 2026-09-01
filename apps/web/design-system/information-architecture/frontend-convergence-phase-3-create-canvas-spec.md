# Beta frontend convergence — Phase 3 Create and Canvas

> **状态：Frozen — Founder approved 2026-09-01。已授权 implementation。**  
> **上游权威：** `docs/BLUEPRINT.md`、`product-map.md`、`surface-contract.md`、`core-flows.md`、`@fikirtive/core/navigation`。  
> **设计权威：** `../patterns/canvas/stitch-image-video-parity-spec.md`、`../patterns/canvas/CreateWorkspaceReference.tsx`、`../patterns/canvas/CanvasReference.tsx` 与 `../patterns/canvas/references/r22-canvas-completed-1280x720.jpg`。

## 1. Who and success

**For：** 没有专业创作团队、不想学习 prompt engineering，需要持续制作 image / video 的小生意 Founder。

**One-sentence success：** Founder 从正式 `Create` 用一句目标开始或继续一个 Canvas，进入同一张全屏工作区，与 Otto 澄清、确认准确 credits、生成、比较和修改结果；刷新或离开后，Canvas、Conversation、状态、花费与结果都仍然诚实可恢复。

## 2. Foundation finding

上游产品、IA、screen pattern 与视觉方向均存在、已获 Founder 批准并可复核。当前差距只在 production convergence：

- 正式 `/create` 仍渲染 nested cards、canvas count、Templates 与 Discover；批准版只保留 shared Otto composer 与 Canvas history。
- 正式 Canvas 仍有 `Chat / Projects` left rail 与可见 `Project` language；批准版是无第二导航的 full-screen Canvas、上方 current Otto turn、左下 Conversation、底部 omnibox。
- Production 已有唯一 `FlowCanvas`、tenant-scoped Canvas nodes / threads、durable generation、exactly-once credits 与 server settlement；prototype 的 in-memory fake generation 绝不能进入正式 route。
- 内部 `Project` 可以继续作为 persistence container，但 Founder-facing product object 与 copy 统一叫 `Canvas`；本阶段不重命名 schema。
- `CanvasNode` 已持久化卡片位置，`ChatThread / ChatMessage` 已持久化 Conversation；但 production 没有 Canvas viewport（pan / zoom）或 transient selection 的 server owner。Phase 3 不用 `localStorage` 伪造恢复：重开时沿用 `Fit to content`，精确 viewport / selection restore 另列 backend persistence seam。
- 当前 Create composer 只执行 `createProject(name)`，因此输入会成为 Canvas 名称、不会成为第一轮 Conversation。系统已有 `createEmptyCoworkThread`、`startStreamedThread` 与 `/api/otto/stream`；Phase 3 只补一条可靠的 Create → Canvas first-turn handoff，复用这些 contract，不建立第二套 chat。

## 3. Intent and work packages

### C1 — Create workspace convergence

- 正式 `/create` 保留 shared application shell、`Create` active navigation 与 canonical route。
- 主内容收敛为一个 real Otto creation composer 与一个 tenant-scoped Canvas history。
- Composer submit 使用一条 owner-scoped orchestration action 建立 Canvas 与 Conversation handoff；prompt 必须成为第一轮 durable Conversation input，不能只拿来命名 Canvas 后丢掉。
- 页面跳转、刷新或 retry 不得重复发送首句话或重复计费；handoff 必须有稳定 identity，并复用现有 Otto stream / idempotency contract。
- Canvas history 使用真实 Canvas ID、name、updated time 与 server ordering；支持空状态、loading、read failure 与打开 existing Canvas。
- 移除 Templates、Discover、canvas count、starting points、suggested prompts 与 nested dashboard cards；这些不迁入别处，也不制造兼容副本。

### C2 — Full-screen Canvas composition

- 正式 `/create/canvas` 使用 approved full-screen anatomy；返回目标是 canonical Create。
- 移除 Founder-facing `Project`、`Projects`、left rail 与第二套 history navigation。
- 顶栏只保留 Back、Canvas name、真实 save state 与必要 account controls；不能把 credits 当成装饰性静态数字。
- `FlowCanvas` 继续是唯一 spatial / generation kernel；pan、zoom、select、multi-select、drag、node persistence、polling 与 lineage 不重写。
- Image、video、text / note、upload 与 extracted reference 的 placement 都读取同一 server-owned board，不从 DOM 位置或 fixture 推断 identity。

### C3 — Otto current turn, Conversation and omnibox

- Canvas 上方 current-turn surface 只显示当前 Otto 状态：idle、needs input、needs confirmation、working、done、failed、cancelled 或 confirming status。
- 左下 `Conversation` 是现有 tenant-scoped ChatThread / ChatMessage 的折叠 chronological history；它不是另一个 status dashboard。
- 底部 omnibox 是 Canvas 内唯一主要自由输入源；selection、Library / Brand context 与 `@` references 显示为可移除 context。
- Create 的第一条 prompt、Canvas follow-up 与 global Ask Otto 必须走同一 server-owned Otto action / thread contract；不建立 Canvas-only fake chat。
- 选择历史 turn 只恢复该 turn 的 response、receipt、context 与结果定位；不能重新执行或重新收费。

### C4 — Paid action truth

- 任何 image / video generation、variation、edit 或 animate 继续使用现有 `useCanvasGen`、server quote、idempotency、reserve、settle / refund 与 durable receipt。
- 付费前显示 output、数量、ratio / duration、references 与 exact credits；只有一次 `Generate · N credits`。
- UI confirmation 不能成为新的价格 owner；价格只读 canonical pricing / quote authority。
- Unknown settlement 显示 `Confirming generation status…` 并恢复同一 action；不能生成第二个 idempotency key。
- `Generation failed · credits returned` 只在 server 已确认 refund 后出现。

### C5 — Persistence and handoffs

- Canvas name、node positions、conversation、nodes、generation receipts 与结果来自现有 server-owned persistence。
- 本阶段重开 Canvas 时 `Fit to content`；不承诺恢复上次 pan / zoom 或 transient selection。若以后需要精确恢复，先建立明确的 server owner 与另行批准的 persistence contract。
- 只有存在可证明的 aggregate save state 时才显示 `Saving… / Saved / Save failed`；否则依各动作的真实完成 / 失败 feedback，不用 browser storage 或装饰性文案假装 workspace 已保存。
- 所有 generation 自动进入 Library history；`Remove from canvas` 只移除 placement，不删除 Library object。
- Download 与 read-only share 依附 selected Generation；未接通的 external handoff 不显示成功。
- Campaigns 与 Schedule 属于 parked / deferred beta surface，本阶段不重新加入。

## 4. Single source of truth and DRY

1. Routes、labels、redirects：`@fikirtive/core/navigation`。
2. Create / Canvas anatomy 与 interaction：approved Canvas pattern；production 不复制 fixture state machine。
3. Canvas / thread / generation identity：现有 tenant-scoped server records。
4. Generation execution、quote、idempotency 与 settlement：现有 production action layer；本阶段只接 UI，不重写钱路。
5. References：Library / Brand / Otto IQ canonical IDs 与 frozen `@` reference-picker contract。
6. Tokens、controls、feedback、focus 与 motion：current Design System primitives。

## 5. Checkable acceptance criteria

1. `/create` 只显示 Create title、一个 real composer 与 real Canvas history；没有 Templates、Discover、count badge、starting points 或 suggested prompts。
2. Composer 与 history 通过 canonical route 进入同一个正式 Canvas；Back 返回 Create。
3. UI 统一使用 `Canvas`；Founder-facing surface 不出现 `Project / Projects / Project brief`。
4. Production route 不 import review fixtures、`CanvasReference`、`CreateWorkspaceReference` 或 prototype model / fake timers。
5. Canvas 没有 left navigation rail；1440×900 与 1920×1080 下 spatial workspace 是最大视觉区域且无遮挡。
6. `FlowCanvas` 仍是唯一 production Canvas kernel；不存在第二套 node、drag、generation 或 settlement implementation。
7. Pan、zoom、select、multi-select、keyboard select 与 drag reposition 继续工作；刷新后 node positions 恢复，viewport 以 `Fit to content` 初始化。
8. Otto current turn、Conversation 与 omnibox 职责不重叠，且使用真实 thread / message / receipt 数据。
9. Create prompt 进入第一条 durable Conversation turn；跳转、刷新或 retry 不会重复发送，也不会只成为 title 后消失。
10. Blocking question 只收真正改变 output 或 cost 的信息；回答后若付费，仍进入 exact-credit confirmation。
11. Image、video、edit、variation 与 animate 在付费前显示 server quote，并防 double submit。
12. Working、done、failed、cancelled、queued 与 confirming-status 在刷新后保持真实；关闭页面不取消已付费任务。
13. Original artifact 在 edit / variation / animate 后保留；新结果使用 durable lineage 放在 source 附近。
14. Conversation 可容纳长期 history，先使用 progressive loading；只有量测证明需要时才加入 virtualization，不一次渲染无止境 messages。
15. `@` picker、selected artifact、Library 与 Brand context 使用 typed canonical IDs，可移除且不复制 object truth。
16. Download / share 只作用于 current selection；没有 selection 时给出清楚 feedback，不执行隐藏默认对象。
17. Empty、loading、read failure、save failure、out-of-credits、generation failure、refund confirmed 与 settlement unknown 都有独立行为测试。
18. 所有 visible controls 可键盘操作，有可读名称、visible focus 与正确 tab order；Escape 只关闭当前 overlay，不丢 task state。
19. 高频 canvas interaction 不加装饰性延迟；overlay motion 在 300ms 内、可中断并遵守 reduced motion。
20. Money / tenant / generation contract tests、Create / Canvas behavior tests、typecheck、scoped lint、production build 与同 viewport visual QA 全部通过。

## 6. Non-goals

- 重命名 `Project` database model、迁移 schema 或重写 tenant identity。
- 重写 `FlowCanvas`、generation provider、pricing、reserve / settle / refund 或 worker queue。
- 将 prototype fake generation、fixture threads 或 sample credits 接入 production。
- Manual timeline editor、node graph programming、mobile Canvas、Campaigns 或 Schedule。
- 在本票顺手重做 Library、Brand、Settings、Auth 或 global Otto panel。
- Canvas viewport、transient selection 或 draft composer 的跨装置精确恢复；这些需要独立 server persistence contract。

## 7. Implementation gates

1. Founder 批准并冻结本 spec 后才能修改 production Create / Canvas。
2. 先写行为测试，钉住 removal boundary、no-fixture import、Canvas language、single kernel 与 money contract 不变。
3. 先收敛 Create，再收敛 Canvas composition，再接 current turn / Conversation；每一段都复用现有 server action。
4. Money、auth、tenant 或 schema 如出现新行为需求，停止本票并单独呈批，不把它藏在 frontend refactor。
5. Founder 在正式 authenticated `/create` 与 `/create/canvas` 完成 visual / interaction acceptance 后才关闭。

## 8. Decision record

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-09-01 | Review candidate | 基于已冻结 IA、R22 / Stitch Canvas authority 与当前 production FlowCanvas / generation contracts建立；未授权 implementation。 |
| 2026-09-01 | Approved and frozen | Founder 明确回复「批准」；Phase 3 可依本文件 implementation。 |
| 2026-09-01 | Implementation checkpoint | Frozen frontend scope已实现；逐项证据与两条 closure seams记录在 `frontend-convergence-phase-3-create-canvas-acceptance.md`。 |
