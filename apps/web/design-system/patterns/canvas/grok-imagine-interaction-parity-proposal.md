# Grok Imagine interaction parity redesign proposal

**状态：** Founder approved and frozen for prototype implementation。  
**日期：** 2026-08-29。  
**范围：** `/product-patterns/canvas` fixture-only prototype。Production generation、money、Library、Campaign 与 Schedule contracts 不变。

## 1. 一句话方向

**Grok Imagine 是 Creation 的完整 interaction model；Google Stitch 只提供 full-screen spatial Canvas 外壳；Fikirtive 只增加 Otto 品牌、真正阻塞时的明确追问，以及每次 paid generation 前的 exact-credit confirmation。**

这里的「跟 Grok 一样」指行为、状态顺序和动作层级一致，不复制 Grok 的黑白品牌或页面排版。只要一个 creation 行为在 Grok Imagine 中已有成熟模式，Fikirtive 就不再发明第二套 Otto workflow。

## 2. 为谁、怎样算成功

用户是想快速完成 image/video creation、但不想学习专业设计软件或 prompt engineering 的小生意 Founder。

**成功定义：** Founder 可以像使用 Grok Imagine 一样，用一次 prompt 开始、直接看生成结果、继续用自然语言迭代，并从结果执行 Edit、Retry、Variations、Make video、Download、Share；同时仍能在 Stitch 式可拖动 Canvas 中摆放和选择 artifacts。只有信息不足或即将扣 credits 时，Otto 才插入一个清楚、可继续的中断。

## 3. 三个 source of truth

| 责任 | 唯一权威 | Fikirtive 中的表现 |
|---|---|---|
| Creation interaction | Grok Imagine | Prompt、reference、generation settings、progress、results、follow-up、result actions、history/reopen |
| Spatial workspace | Google Stitch | Full-screen dotted Canvas、artifact nodes、selection、drag、pan、zoom、top bar、bottom composer geometry |
| Product trust + identity | Fikirtive | Otto/Fikirtive brand、design tokens、blocking question、exact credits confirmation、money receipt、Library/handoff boundaries |

任何 component 只能有一个 owner。Canvas 不能同时保留 Grok conversation model 与 Stitch Agent log model，也不能另外建立 Fikirtive 专属 task planner。

## 4. Mobbin evidence

本次重新核对以下 Grok Web flows 的实际画面：

1. [Imagine](https://mobbin.com/flows/e8598a7f-01ba-47ee-b28e-9a82b9bf7b53)：prompt composer 常驻在 content/results 上方；Image/Video 与比例直接属于 composer；首页以 templates、discover results 和 history 提供起点。
2. [Creating an image](https://mobbin.com/flows/64c96a9e-1cf3-426e-abae-d73080f262bc)：一次 prompt 直接生成一组 results；follow-up prompt 在同一 conversation 中继续产生下一组 results，没有独立 approval 或 task-plan 阶段。
3. [Generating a video](https://mobbin.com/flows/4a614a21-6ef8-4bc5-a713-c18a62700a6f)：reference 与 prompt 在同一个 composer；progress 覆盖在生成中的 media 上；完成后的 feedback、retry、download 和 more actions 围绕 result 排列。
4. [Imagine history](https://mobbin.com/flows/9464567b-6eb5-497b-a3de-356e32fde3b6)：history 是轻量的旧 generation/conversation 入口，不是 execution queue。
5. [Generating images with Imagine API console](https://mobbin.com/flows/b00d8863-c783-4d52-a113-5dbfa943c9d5)：即使在 console 场景，upload、image/video mode、count/resolution settings、retry 与 results 仍是一条直接生成链路。

以上画面共同支持：**一个 composer、result-first、连续 iteration、result-owned actions/history**。Grok 没有与 creation conversation 并列的 permanent agent workflow panel。

## 5. Target anatomy

### A. Stitch shell

- 全屏浅色点阵 Canvas；进入 project 后脱离 dashboard content frame。
- Artifact 可 select、drag、pan、zoom、duplicate、remove、undo/redo。
- Top bar 只负责 project、autosave、export/share 等 workspace actions。
- Bottom composer 保持为唯一 creation input；选中 artifact 时显示 context chip。

### B. Grok creation conversation

- Founder prompt、Otto answer、generated result 和 follow-up prompt 属于同一条连续 conversation。
- Conversation 不再拆成「左上 Otto current response」与「左下 Agent log」。
- 新 result 出现在 conversation timeline，同时以同一 artifact id 出现在 Canvas。
- 选择 Canvas artifact 会定位对应 generation turn；选择 history turn 会选中对应 Canvas artifact。
- Image/Video mode、ratio、reference 与必要 generation settings 直接附着在 composer，不另开 planning workflow。

### C. Result surface

- `Queued / Generating / Ready / Failed / Cancelled` 只显示在 result/artifact 上。
- Generation 中可显示 progress；不封锁 Canvas 其他操作。
- Image frequent actions：`Edit`、`Variations`、`Make video`、`Retry`、`Download`、`Share`。
- Video frequent actions：`Edit`、`Variations`、`Retry`、`Download`、`Share`；secondary actions 进入 `More`。
- Follow-up edit 永远建立新 result/version，不静默覆盖 source。

## 6. Fikirtive 唯一两种有意偏离

### Blocking question

当 Otto 无法安全判断下一次 generation 的关键输入时，在当前 conversation turn 内显示一张 compact question card：

- 一次只问真正阻塞的一件事。
- 优先提供 2–4 个可直接点选的答案，同时允许自由输入。
- 回答后原 card 变成已回答 summary，conversation 直接继续。
- 不建立 questionnaire、wizard 或 separate clarification mode。

例子：Founder 说 “make a product video”，但 Canvas 没有选中 source image。Otto 问 `Which product image should I animate?`，Founder 选择一个 Canvas artifact 后直接进入 paid confirmation。

### Paid generation confirmation

每个会扣 credits 的下一次 generation，在当前 conversation turn 内显示 compact confirmation：

- 明确动作、output 数量、主要规格、references 与 exact credits。
- Primary CTA 使用 `Generate · 8 credits`，secondary action 是 `Edit details` 或 `Cancel`。
- Founder 明确请求 batch 时才可一次确认 batch；系统不能自动发明 `Make all` plan。
- 确认后 card 变成不可重复提交的 receipt，progress 转移到 result artifact。
- 完成显示 actual charged credits；失败、退款和 unknown state 继续服从现有 money truth。

## 7. Canonical flows to prototype

### Flow 1 — Direct image generation

`Prompt + optional references/settings → paid confirmation → generating result → ready variations → follow-up prompt`。

### Flow 2 — Blocking question

`Ambiguous prompt → one blocking question → Founder answer → paid confirmation → result`。

### Flow 3 — Result iteration

`Select result → follow-up edit prompt → paid confirmation → new non-destructive result → compare/retry/download/share`。

### Flow 4 — Image to video

`Select image → Make video or natural-language prompt → video settings → paid confirmation → progress on video artifact → ready video actions`。

### Flow 5 — History/reopen

`Open history → choose prior conversation → restore conversation, viewport and artifact selection → continue with one composer`。

### Flow 6 — Free Canvas operation

`Select artifact → ask Otto to rename/move/arrange → action happens immediately → short conversational receipt`；不出现 paid confirmation 或 fake generation status。

## 8. Retain / retire

### 保留

- 当前可工作的 drag、pan、zoom、select、add、duplicate、remove、undo/redo mechanics。
- Stitch 式 full-screen Canvas、top bar、bottom composer 与 selection context。
- Existing Fikirtive tokens、Base UI primitives、Otto orange、artifact ids、Library/handoff 和 credit truth。
- 当前 fixture-only boundary 与 production non-goals。

### 退役或重做

- 退役 bespoke `Otto current response panel`。
- 退役 `Agent log` 作为 task queue / separate conversation history。
- 退役 plan、dependency queue、creative `Approved`、`Make all` 和重复 status rows。
- 重做为 Grok 式 single conversation/results timeline、Grok result actions、lightweight history/reopen。
- 追问与付费确认只作为 conversation 内的 compact Fikirtive interrupts。

预计保留大部分 Canvas mechanics，重写约三分之一的 prototype UI 和相关 fixtures/tests；无 production data migration。

## 9. Checkable acceptance criteria

1. 页面只有一个 creation composer；不存在第二个 Otto input、Agent log queue 或 paid-plan surface。
2. Direct、clarification、confirmation、generating、ready、iteration、image-to-video、history/reopen 与 free Canvas action 全部可实际走完。
3. 除 blocking question 与 paid confirmation 外，creation 的动作顺序和层级可逐项映射到上面列出的 Grok flows。
4. Blocking question 一次只问一个阻塞信息，回答后原 turn 继续，不产生新的 workflow panel。
5. 每次 paid generation 只确认下一次真实动作，CTA 显示 exact credits；不能重复触发同一次确认。
6. Progress 和 operational status 只属于 result/artifact；conversation 只保存 prompt、reply、confirmation receipt 与 result reference。
7. Ready image/video 暴露与 Grok 相同心智模型的 follow-up/result actions，并可继续自然语言 iteration。
8. Conversation turn 与 Canvas artifact 使用同一 artifact id，双向 selection 不复制 asset 或 status。
9. 所有保留的 Canvas mechanics 继续 functional；此重做不能把 workspace 降级为静态 mock。
10. 1440×900 与 1920×1080 不遮挡；keyboard focus、Escape、reduced motion、loading、empty、failure 与 unknown money state 可验收。

## 10. Non-goals

- 复制 Grok branding、dark theme、sidebar 或 subscription UI。
- 保留 Stitch 的 Agent log/task-planner semantics。
- 建立通用 autonomous-agent workflow、multi-step project planner 或 dependency scheduler。
- Full pixel editor、timeline editor、mobile Canvas editor、production generation 或真实 money movement。
- 在 UI 暴露 Seedream、Seedance 或 provider/model 名称。

## 11. Approval and cooling gate

这是对已批准 prototype 的方向级收紧，会主动废弃当前约三分之一的 UI。依照 Founder 的 standing one-night cooling rule，本文件批准并获得明确 reconfirmation 前不开始代码；批准后它将取代
[`grok-image-flow-change-proposal.md`](./grok-image-flow-change-proposal.md) 成为 Canvas creation interaction 的最新 authority，原文件保留为历史决策记录。

**Founder approval：** Approved 2026-08-29。Founder 在 cooling gate 后明确回复“批准这个 interaction parity spec，继续实现”。
