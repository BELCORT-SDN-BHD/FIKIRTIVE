# Creation product pattern — Grok Imagine full parity

> **Historical only — superseded 2026-08-29.** Founder 后续明确指定 Stitch 为唯一 interaction model，当前 draft authority 是 [`stitch-image-video-parity-spec.md`](./stitch-image-video-parity-spec.md)。本文件只保留决策历史，不再授权 implementation。

**状态：** Superseded；historical only。  
**批准日期：** 2026-08-29。  
**Founder 明确确认：** “从0开始借鉴”。  
**取代：** `grok-imagine-interaction-parity-proposal.md` 的 Stitch × Grok hybrid direction；旧文件只保留为决策历史。

## 1. 为谁、成功是什么

主要用户是想快速完成 image 或 video creation 的小生意 Founder。他不应先学习 node、Canvas、agent queue 或 generation pipeline；他只需描述 outcome、补充必要资料、确认下一次付费动作，然后连续修改结果。

**一句成功定义：** Founder 能用与 Grok Imagine 相同的心智模型，从 Discover 或一个 prompt 开始，完成 image generation、follow-up edit、image-to-video、单结果操作与 history reopen；Fikirtive 只在会扣 credits 前加入清楚的 Otto question / exact confirmation。

## 2. Source of truth 与 ownership

### Grok Imagine 拥有

- 整体 information architecture、页面层级、composer 位置和 creation flow。
- Imagine home、featured templates、Discover、conversation results、single-result view、result actions 与 lightweight history。
- 一个 composer、连续 generation、result-first iteration、image/video mode 和 reference attachment 的 interaction model。

### Fikirtive 拥有

- Fikirtive brand、design tokens、Base UI primitives 与 Otto identity。
- 每次 paid generation 的 exact credits、一次性确认、失败/退款/unknown money truth。
- Library、Campaign、Schedule、Share 的产品边界与业务 action。

### 明确不再拥有

- Stitch Canvas、infinite board、dotted background、spatial nodes、drag/pan/zoom、selection toolbar、agent log 或 permanent workflow panel。

同一个规则只在一个地方定义。页面消费 `../../brand/`、`../../foundations/globals.css` 与 `../../primitives/`；本 pattern 只组合 interaction，不复制价格、generation 或 handoff 的业务实现。

## 3. 研究依据

1. [Imagine](https://mobbin.com/flows/e8598a7f-01ba-47ee-b28e-9a82b9bf7b53)：sidebar、featured templates、Discover、底部 composer。
2. [Creating an image](https://mobbin.com/flows/64c96a9e-1cf3-426e-abae-d73080f262bc)：prompt、multi-result、follow-up prompt 都在一条 conversation。
3. [Generating a video](https://mobbin.com/flows/4a614a21-6ef8-4bc5-a713-c18a62700a6f)：reference + prompt、single-media result、progress overlay、result-owned vertical actions。
4. [Imagine history](https://mobbin.com/flows/9464567b-6eb5-497b-a3de-356e32fde3b6)：history 是 reopen 入口，不是 execution queue。
5. [Generating images with Imagine API console](https://mobbin.com/flows/b00d8863-c783-4d52-a113-5dbfa943c9d5)：settings、retry 与 results 保持直接生成链路。

## 4. Canonical surfaces

### A. Imagine home

- 左侧 primary navigation：New generation、Imagine、Projects、History。
- 主区先出现 prompt/composer，再出现 featured templates 与 Discover media grid。
- Image / Video mode、ratio、reference upload 和 send 都附着于同一个 composer。
- 点击 template、Discover result 或 history item都进入同一 generation/conversation system。

### B. Creation conversation

- Founder prompts、Otto interrupts、paid receipts、generation progress 与 result groups 按时间顺序出现。
- Direct prompt 不先制造 plan；可以安全执行时直接进入下一次 paid confirmation。
- Follow-up prompt 产生新 result/version，不覆盖旧结果。
- 页面始终只有一个 composer。

### C. Blocking question interrupt

- Otto 只有缺少关键 input 时才问；一次只问一件事。
- 2–4 个可点答案 + 自由输入。
- 回答后原 turn 继续进入 paid confirmation，不跳到 wizard 或独立 panel。

### D. Paid confirmation interrupt

- 明确下一次动作、outputs、ratio/duration、references 与 exact credits。
- Primary CTA：`Generate · N credits`；secondary：Edit details / Cancel。
- Confirm 只能触发一次；之后转成 receipt，progress 属于 result。

### E. Single result

- 一个 image/video 居中成为视觉焦点。
- Generating 时 progress overlay 在 media 上。
- Like、retry、download、share、more 等 actions 属于该 result。
- Image 可进入 Make video；video generation 再经过下一次 exact paid confirmation。
- 底部 composer 继续自然语言 iteration。

### F. History / reopen

- History 只列 conversation / generation；不是 status queue。
- Reopen 恢复 prompt/result context，并可继续使用同一个 composer。

## 5. 必须可走完的 flows

1. `Imagine home → prompt → 8-credit confirmation → generating → image results`。
2. `ambiguous prompt → one Otto question → answer → confirmation → result`。
3. `image result → follow-up edit → 4-credit confirmation → new result group`。
4. `image result → Make video → 20-credit confirmation → progress overlay → video result`。
5. `History → reopen prior conversation → continue prompt`。
6. `confirmation → Cancel`，不产生 result、不扣 credits。
7. `result → retry / download / share / send to Library` 提供真实 prototype feedback，不伪装 production completion。

## 6. Checkable acceptance criteria

1. 页面不出现 Canvas board、spatial node、drag、pan、zoom、selection toolbar 或 Agent log。
2. Imagine home、conversation、single result 与 history 的结构可逐项映射到上面列出的 Mobbin Grok flows。
3. 全程只有一个 creation composer；Image / Video 与 attachments/settings 都从该 composer 操作。
4. Direct、question、confirmation、generating、ready、follow-up、image-to-video、cancel 与 history reopen 都能实际操作。
5. 每次 paid confirmation 只对应下一次 generation，显示 exact credits，且不能重复 submit。
6. Progress、feedback 与 result actions 属于 result，不另建 task/status panel。
7. Follow-up 生成新版本；旧 result 仍可回看。
8. 1440×900 与 1920×1080 不遮挡；keyboard focus、Escape、reduced motion 与 empty/loading states 可验收。
9. Prototype 明确标注 fixture-only 边界；不调用 production generation、money、persistence 或 navigation action。

## 7. Non-goals

- 复制 Grok logo、品牌 copy、subscription 或 dark theme。
- 保留 Stitch spatial Canvas 或把 Grok flow 包在旧 Canvas 内。
- Full pixel editor、timeline editor、mobile editor、production generation 或真实扣款。
- 暴露 provider/model 名称。

## 8. Direction reversal 与批准

本次会退役现有 prototype 的大部分 spatial Canvas mechanics，而不是渐进保留。Founder 已收到 scrap cost 与 one-night cooling rule 提醒，并在 2026-08-29 明确 reconfirm：**“从0开始借鉴”**。因此本文件从该确认起成为 Creation pattern 的唯一当前 authority。
