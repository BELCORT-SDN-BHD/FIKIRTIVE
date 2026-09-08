# Creation E2E：产品图 → 官方 Avatar → 产品使用视频

**执行日期：** 2026-09-04（Asia/Kuala_Lumpur）  
**执行方式：** 已登录真实 Chrome desktop、真实数据库、真实 BytePlus image provider、真实 credits；未修改应用代码。  
**浏览器入口：** `http://127.0.0.1:3310/create`  
**Frontend commit：** `062aae863adbdd2cb9b53aa727a2292fa8eb044c`（`062aae86`）  
**实际 generation worker commit：** `fe9c70bde07c`（运行时版本与 frontend 不一致）  
**Canvas：** `canvas_4b5fc3a7-fa15-4c56-961b-502eb8d0eb15`  
**Conversation：** `thread_4b5fc3a7-fa15-4c56-961b-502eb8d0eb15`

## 结论

这条复杂旅程目前是 **部分通过、未完成视频**。

- 产品图已真实生成并进入 Canvas。
- Library 能重新选择刚生成的产品图；下一轮 USER message 正确保存其 Generation ID。
- `@Xinyi` 被正确解析为 canonical Character ID，并出现在付费确认的 approved reference receipt。
- Otto 正确把需求拆为「先做 Xinyi 手持产品的 9:16 starting image，再用它生成 5 秒视频」。
- Starting image 在发送给 provider 前失败：当前 local storage 无法为 Xinyi 的两张参考图生成 provider 可访问 URL。系统 fail closed，供应商未扣费，1 credit 已全额退回。
- 因 starting image 没有成功，后续 avatar video 没有被建立或调用；因此不能称这条 E2E 已通过。

最重要的修复方向不是再改 prompt，而是先让 **web、worker 与 reference storage 使用同一个可验收 release profile**。目前 frontend 和 worker 不在同一 commit，且真实 provider 运行在 `LocalDiskStorage`；该 storage 的 `presignedGet()` 设计上永远返回 `null`，所以任何需要把 Library / Avatar 图片传给外部 provider 的流程都会在本地失败。

## 预期用户目标

> 先生成一个产品，然后使用一个官方 Avatar，让该 Avatar 在视频中真实使用这个产品；产品外观和 Avatar 身份都应保持一致。

本轮选择：

- 产品：premium coral-orange insulated tumbler，ribbed grip，silver lid。
- Avatar：`@Xinyi`。
- 视频：5 秒、9:16、warm modern café、Xinyi 举起 tumbler 喝一口后对镜头微笑、Sound off。

## 逐阶段结果

| 阶段 | 结果 | 证据 | 判定 |
|---|---|---|---|
| 1. 从 Create 输入产品目标 | Prompt 进入新 Canvas / Conversation | `01-create.png`、`02-product-brief.png` | Healthy |
| 2. 产品付费确认 | 1 image、1728×2304、3:4、1 credit | `03-product-confirmation.png` | Healthy |
| 3. 产品真实生成 | Job `01M1N7912KN8A77NWAEYSY1CSY`，DONE，1 attempt，provider spend `$0.035` | `04-product-done.png` | Healthy |
| 4. 从 Library 复用产品 | 刚生成的 tumbler 可选；composer 显示具体产品名，不再是泛化 `Image ref` | `05-library-picker.png`、`06-avatar-product-video-brief.png` | Healthy，含 a11y 缺口 |
| 5. 加入 `@Xinyi` | USER message 保存产品 Generation ID；confirmation 保存 Xinyi canonical ID | DB evidence、`07-avatar-product-image-confirmation.png` | Healthy |
| 6. 生成 Xinyi + 产品 starting image | Job `01M1N7G76R4RCW0EJTCXDWQR4P`，FAILED，3 attempts，provider spend `$0` | `08-avatar-start-image-failed.png`、`09-failure-after-refresh.png` | Blocked |
| 7. 从 starting image 生成 5 秒视频 | 上游 starting image 未产生，未能进入 video confirmation / provider call | 无 video job | Not reached |

## 数据与钱路证据

### 产品图

- Job: `01M1N7912KN8A77NWAEYSY1CSY`
- Kind: `IMAGE`
- Status: `DONE`
- Attempts: `1`
- Image options: `{ "aspectRatio": "3:4" }`
- Provider spend: `$0.035`
- Credits: `RESERVE 1.0 → SETTLE 1.0`
- Result Generation ID: `01M1N79T4JTW8RZCRGHEBKTCAW`

### Avatar starting image

- Job: `01M1N7G76R4RCW0EJTCXDWQR4P`
- Kind: `IMAGE`
- Status: `FAILED`
- Attempts: `3`
- Source Generation ID: `01M1N79T4JTW8RZCRGHEBKTCAW`
- Entity IDs: `{01M1HG5PQ40W7BCGZE0ATKC1HV}`
- Approved entity snapshot: `Xinyi · CHARACTER`
- Image options: `{ "aspectRatio": "9:16" }`
- Failure: `conditioning refs unreachable (0/2) — refusing to spend`
- Provider spend: `$0`
- Credits: `RESERVE 1.0 → REFUND 1.0`

### 本轮用户实际 credits

- 产品需求 Otto turn：2.3 credits
- 产品生成：1.0 credit
- Avatar + product 规划 Otto turn：1.9 credits
- Avatar starting image：净 0 credit（1.0 reserved，1.0 refunded）
- **本轮净 credits：5.2 credits**

## 已确认修好的部分

### 产品 reference 不再被静默丢失

这次 USER message 已保存：

```text
sourceGenerationIds = ["01M1N79T4JTW8RZCRGHEBKTCAW"]
```

对应的 paid confirmation 同时保存：

```text
approvedEntities = [
  {
    "id": "01M1HG5PQ40W7BCGZE0ATKC1HV",
    "name": "Xinyi",
    "type": "CHARACTER"
  }
]
```

因此上一轮「用户视觉上附加了产品，但后端没有收到稳定产品 identity」的问题已在本轮证据中关闭。

## Findings 与建议

### E2E-CRE-PAV-001 — Reference-backed generation 在当前验收环境不可执行

**严重度：Blocker（验收环境）；production 风险仍未验证。**

Xinyi 两张参考图的 Asset 与文件都存在，但 real provider 需要可从外网读取的 URL。当前 generation worker 使用 local disk；`LocalDiskStorage.presignedGet()` 返回 `null`。Worker 因此在花供应商费用前拒绝降级生成。

证据：

- `packages/storage/src/index.ts:157-159`
- `apps/worker/src/jobs/gen.ts:1131-1144`
- Job `01M1N7G76R4RCW0EJTCXDWQR4P`
- Ledger 的 `RESERVE → REFUND`

**建议：** 建立一个真实 E2E release profile：web 与 worker 固定在同一 commit；使用隔离的 R2 test bucket 或 staging remote storage；同一 profile 保存 official avatar refs、user uploads 与 generated outputs。修复后重跑同一旅程，不用换 prompt。

### E2E-CRE-PAV-002 — Frontend 与 worker 版本分裂

**严重度：P1。**

页面运行 `062aae86`，实际处理 generation 的 worker cwd 是 `/Users/winnin/Desktop/FIKIRTIVE/apps/worker`，commit 为 `fe9c70bd`。这会让同一张 Canvas 同时呈现两个 release 的行为。例如新 worker 已把 reference failure 持久化为 merchant-safe message，当前旧 worker 仍保存内部 diagnostic。

**建议：** QA 启动脚本应打印并比对 web SHA、worker SHA、storage driver、provider 与 DB target；任一不一致就阻止“latest version passed”声明。

### E2E-CRE-PAV-003 — Failed job 未实时收敛，刷新后才正确显示 Failed

**严重度：P1。**

数据库在 `03:33:26` 已是 FAILED、退款也已完成，但 UI 仍显示 `Otto · Generating / Working on it… / still working…`。刷新后 current turn 才变成 `Otto · Failed`。

证据对比：

- 失败已完成但 UI 仍 working：`08-avatar-start-image-failed.png`
- 刷新后恢复真实终态：`09-failure-after-refresh.png`

这违反冻结 spec 对 working / failed / refund 状态应由 server truth 恢复的要求。

**建议：** 让 current-turn polling 在 GenJob terminal 后立即注入 durable TURN_ERROR / terminal receipt，并用同一 server payload 同步 artifact card、Otto current turn 与 balance；不得依赖 page reload。

### E2E-CRE-PAV-004 — 两阶段 flow 要用户手动“带回 starting image”

**严重度：P1 UX。**

Otto 明确说 `Once you approve and generate it, bring that image back here`。这暴露了内部 orchestration seam。对 Founder 而言，它应该是一条连续 task：Step 1 完成后，系统自动把该 Generation ID 作为 Step 2 的 source，并显示下一次独立付费确认；不应要求用户再找图、再附加、再解释一次。

**建议：** 保留每个付费动作各自确认，但让 dependency handoff 自动发生：`starting image DONE → create next video confirmation with sourceGenerationId`。Conversation 记录 lineage 和第二次 exact-credit approval，不自动扣费。

### E2E-CRE-PAV-005 — `Try again` 是文案，不是可执行恢复动作

**严重度：P2。**

失败 artifact 写 `Try again`，但该 card 没有可读的 Retry button；用户只能自己重新组织下一句。对于 reference 不可达，盲目重试也一定再次失败。

**建议：** 根据失败类型显示可执行恢复：reference unavailable 应提示重新选择 / replace reference；可重试 provider error 才显示 `Try again`。重试仍需新的 exact-credit confirmation，不复用已退款 job。

### E2E-CRE-PAV-006 — Library media item 缺少可读 accessible name

**严重度：P2 Accessibility。**

视觉 picker 有缩略图和 caption，但 AX tree 中 media item 是无名称 `button` + `image`，键盘和 screen reader 用户难以判断将选择哪一项。

**建议：** 每个 item button 以 asset title + media type + source 组成 accessible name，例如 `A premium coral-orange insulated tumbler, image, generated in this Canvas`。

## UI/UX 对批准设计的观察

### 做得好的部分

- Canvas 保持全屏 spatial workspace；产品与失败 attempt 均作为非破坏式 artifact 留在 board 上。
- current Otto turn、Conversation 与 omnibox 的职责仍分开。
- 付费前显示 exact output、ratio、数量、references 与 credits。
- 产品 reference chip 使用具体内容名称，降低“改错对象”的风险。
- `@Xinyi` 在确认卡有明示 reference receipt，而不是只存在 prompt 文本。
- 钱路 fail closed：reference 不可用时没有静默生成“长得不像”的替代结果，也没有供应商费用。

### 需要收紧的部分

- terminal status 必须实时，而不是刷新后才诚实。
- 多阶段 agentic task 应自动传递 lineage，用户只负责决定和批准，不负责搬运内部 Generation ID。
- 失败恢复必须是 action-aware，不是泛化 `Try again`。

## 截图索引

1. [Create 初始状态](creation-product-avatar-video-062aae86/01-create.png)
2. [产品需求 brief](creation-product-avatar-video-062aae86/02-product-brief.png)
3. [产品 1-credit 确认](creation-product-avatar-video-062aae86/03-product-confirmation.png)
4. [产品真实生成完成](creation-product-avatar-video-062aae86/04-product-done.png)
5. [Library 选择产品](creation-product-avatar-video-062aae86/05-library-picker.png)
6. [产品 reference + @Xinyi 视频需求](creation-product-avatar-video-062aae86/06-avatar-product-video-brief.png)
7. [9:16 starting image 确认](creation-product-avatar-video-062aae86/07-avatar-product-image-confirmation.png)
8. [DB 已失败但 UI 仍 working](creation-product-avatar-video-062aae86/08-avatar-start-image-failed.png)
9. [刷新后的诚实 Failed 状态](creation-product-avatar-video-062aae86/09-failure-after-refresh.png)

## Retest gate

工程修复后，使用同一个产品与 `@Xinyi` prompt 重跑，并要求以下全部成立：

1. Web 与 worker SHA 完全一致。
2. Avatar reference、product Generation 与最终 video 的 storage 均可被 provider 访问。
3. Starting image 成功，Xinyi 身份与 tumbler 四项产品特征保持一致。
4. Step 1 完成后自动出现 Step 2 video confirmation；不要求用户重新附图。
5. Video confirmation 明示 5 秒、9:16、Sound off、source image、exact credits。
6. Video job 真实 DONE；数据库、ledger、provider spend 与 playable artifact 一致。
7. 关闭 / 刷新 / 重开后，current turn、Conversation、credits、starting image、video 与 lineage 全部恢复。
8. 失败时 UI 在下一次 poll 内收敛为 terminal state，不依赖刷新。

只有 1–8 全部通过，才能把这条「product → official avatar → product-use video」标为 E2E Pass。
