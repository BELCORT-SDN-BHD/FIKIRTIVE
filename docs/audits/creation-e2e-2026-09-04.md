# Creation Beta E2E Readiness Report

**Tested version: `main@e622bec6312e071ccf57d4aaf20265846f1efacc`**

> 状态：完成本轮只读审计。本文记录真实行为、证据与修复建议，不修改已冻结规格，也不代表批准上线。
>
> Founder 授权：在真实生成总预算 US$10 内执行完整 Creation E2E；源码只读，只允许记录审计结果。
>
> 读者：负责 Creation 接线与修复的 Claude／工程实现者。本文是 QA 证据与专业建议，不是范围批准或实现命令。开始处理前应先确认当前 HEAD；如果已经超过 tested commit，应先查看增量 diff，并重跑受影响 journey。

## 0. Test manifest

| Field | Tested value |
| --- | --- |
| Repository | `BELCORT-SDN-BHD/FIKIRTIVE` |
| Branch | `main` |
| Full commit | `e622bec6312e071ccf57d4aaf20265846f1efacc` |
| Short version | `e622bec6` |
| Web package | `@fikirtive/web@0.1.0` |
| Run mode | Production build via `next start` |
| Test URL | `http://127.0.0.1:3312` |
| Primary browser | Google Chrome, full desktop surface |
| Test Canvas | `canvas_063fe339-227a-476e-9e4f-f9998b4a416e` |
| Test account | `e2e-founder-0903@fikirtive.test` |
| Source policy | Read-only; no application source changes |
| Real-spend ceiling | Founder-approved US$10 |
| Actual provider spend | Approximately US$0.556 |

### Version boundary

Most Creation journeys were first exercised on `0238e162d36f9f7dac99f04cc6497fa8cc449835`. Before closing the report, `main` advanced to `e622bec6`. The delta was inspected and contained only Add-to-Library type-selection changes plus tests and one spec note. The web production build, changed tests, Add asset form and official Avatar behavior were then rechecked on `e622bec6`. Findings outside that delta remain valid for the tested code path because the relevant files did not change.

### How to use this report

- Treat each issue ID below as a reproducible QA observation, not as permission to redesign the flow.
- Prefer repairing the canonical contract or policy named in the recommendation, then propagate it to UI and tests.
- Preserve Founder-approved decisions and the existing design-system sources of truth.
- After a fix, use the regression criterion attached to that issue as the acceptance check.
- A newer commit is a new test target; record its SHA rather than overwriting this report's tested version.

## 1. 审计结论

**Creation 尚未达到 Beta 上线标准。**

核心的 text-to-image、text-to-video、扣费结算、自动入 Library、视频播放和下载已经能真实工作；但仍有四个发布阻挡：

1. **Video 的声音意图没有进入生成契约。** UI 没有 sound 开关；请求又默认 `audio: true`。用户写“completely silent”仍可能获得有声音的视频。
2. **Canvas 的基础编辑不完整。** 实际浏览器里文字删除、multi-select 和 video selection/action 失败，自动测试没有捕捉到这些真实接线问题。
3. **官方 Avatar 没有只读。** Aisyah 详情仍显示并启用付费 `Make variant · 1 credit`，违反已批准的官方 Avatar catalog read-only 规则。
4. **Otto 的阶段状态仍会漂移。** 后续成功生成后，current turn 曾停在较早失败信息；刷新最新状态后又退化为没有意义的 `🖼 result`。两步式计划也不会可靠地从图片批准推进到下一步 video confirmation。

从 release-risk 角度，建议先关闭这些阻挡项并重跑同一份验收矩阵，再评估是否继续增加 Creation 功能。

### Issue register

| ID | Severity | Area | Observation | Recommended release disposition |
| --- | --- | --- | --- | --- |
| QA-CRE-001 | P0 | Video | Sound intent is not part of the approved generation contract | Block Beta until deterministic |
| QA-CRE-002 | P0 | Canvas | Delete, multi-select and video action targeting fail in the real browser | Block Beta |
| QA-CRE-003 | P0 | Official Avatar | Read-only catalog exposes paid mutation controls and writable server actions | Block Beta |
| QA-CRE-004 | P0 | Otto | Current-turn state is stale or collapses to `result`; multi-step advancement is unreliable | Block Beta |
| QA-CRE-005 | P0 | Paid follow-ups | Variation/edit/animate do not consistently use the exact-credit confirmation contract | Block paid follow-ups |
| QA-CRE-006 | P1 | Create | History order, naming and vocabulary reduce findability | Fix before public Beta |
| QA-CRE-007 | P1 | Library | Raw backend/provider errors reach Founder-facing UI | Fix before public Beta |
| QA-CRE-008 | P1 | Canvas layout | Overlays cover artifacts and Fit ignores safe areas | Fix before wider desktop testing |
| QA-CRE-009 | P1 | References | Picker lacks search, filtering and long-history capacity | Fix before real customer libraries |

## 2. 被测版本与环境

- 最新主干：`e622bec6312e071ccf57d4aaf20265846f1efacc`。
- 完整桌面浏览器：Chrome，真实 production build，`http://127.0.0.1:3312`。
- 真实 Canvas：`canvas_063fe339-227a-476e-9e4f-f9998b4a416e`。
- 设计与交互权威：
  - `apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md`
  - `apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md`
- 引擎验收权威：`docs/specs/creation-engine.md`。

环境说明：

- `@fikirtive/web` production build 通过，共 48 个页面。
- build 仍有 2 条 Turbopack 文件追踪警告，来源是 `actor-library-seed.ts` 的文件系统读取。
- production server 以 warn 模式启动；`STORAGE_DRIVER` 与 `SENTRY_DSN` 未配置。因此这次只能证明本机真实流程，**不能据此宣称 production-ready**。
- 本机素材 URL 无法被云端模型访问，因此所有 image-to-image、image-to-video 与官方 Avatar reference 的失败在本报告中与产品缺陷分开记录。

## 3. 真实生成与花费

本轮 Canvas 相关 ledger 记录：

| Journey | 结果 | 产品 credits | Provider 实际成本 |
| --- | --- | ---: | ---: |
| Text-to-image | DONE | 1 | US$0.035000 |
| 5 秒 720p text-to-video | DONE | 11 | US$0.380382 |
| 4 秒 480p text-to-video | DONE | 5 | US$0.140616 |
| Cancelled image | CANCELLED + REFUND | 0 net | 0 |
| Image edit，source unreachable | FAILED + REFUND | 0 net | 0 |
| Video edit，reference unreachable | FAILED + REFUND | 0 net | 0 |

合计：**17 displayed credits settled；provider 实际成本约 US$0.556**，远低于 Founder 批准的 US$10。

所有失败任务都在 provider spend 前终止，reserve 后有对应 refund；未发现悬空 reserve。

## 4. Journey health

### 4.1 Create entry — Needs work

通过：

- `/create` 可以打开已有 Canvas。
- History card 能回到正确 Canvas。
- first prompt → durable Canvas／Conversation 的已有真实路径可工作。

缺口：

- Canvas history 当前是**旧到新**，不是 recent activity first。
- History 仍出现 `New project`，与已批准词汇“Canvas，不叫 Project”冲突。
- 很长的 prompt 直接成为 history title，缺少可扫描的名称策略。
- 全局 Ask Otto 会根据旧状态自动展开，在 minimal Create page 上占据一半空间。

建议方向（QA-CRE-006）：可考虑让 history 查询使用 pinned-first + `updatedAt desc`；标题由 canonical Canvas naming rule 生成；为旧 `New project` 提供迁移；Create 默认保持 global Otto 收起。建议用 20+ Canvas 的账号验证排序与扫描效率。

### 4.2 Otto → clarification → confirmation → work — Blocked

通过：

- Canvas 内存在独立 current-turn、Conversation history、New conversation 与 composer。
- Add context、Library picker、选择／移除 reference chip 可工作。
- `@` 可发现官方 Cast。

缺口：

- current-turn 曾在后续 direct video 已成功后仍显示 `That generation didn't go through`；最新强制刷新后显示 `🖼 result`，仍不是可理解的 done state。
- 两步式 image → video 计划会说“approve on card above”，但批准卡只藏在 Conversation；图片批准后也不会可靠推进下一张 video confirmation。
- `@Aisyah` 在 composer 中退化为普通文字，而不是清楚、可移除、带实体身份的 approved chip。
- Library picker 没有 search／filter，长 prompt 直接占满列表，无法承受长期 history。

复现摘要（QA-CRE-004）：

1. 在同一 Canvas 先经历一次失败 generation，再完成一次成功 direct video。
2. 观察 current-turn；它曾继续显示旧失败。
3. 强制刷新最新页面；current-turn 改为 `🖼 result`，仍没有表达成功产物、下一步或收费结果。
4. 在两步 image → video 计划中批准图片；下一步 video confirmation 没有稳定出现。

期望：current-turn 只表达当前 Conversation 的一个明确阶段，成功状态可理解，批准一个 step 后进入下一个需要用户决定的 step。

可能的代码边界：`OttoChatStream.tsx`、current-turn projection、plan-card payload 与 step acceptance handler。

建议方向（QA-CRE-004／009）：可将 current-turn 作为当前 thread authoritative task state 的投影，让 question、confirmation、working、done、failed 互斥；step acceptance 产生下一步 confirmation。Reference picker 则可复用统一实体 DTO，并加入搜索、分类与虚拟列表。建议用刷新、切换 Conversation、失败后再成功三组回归证明状态不会倒退。

### 4.3 Direct image generation — Healthy with one blocker around follow-up actions

通过：

- exact quote → confirm → reserve → provider → settle → Canvas node → Library 全链路成功。
- 成功图片能显示后续 action footer。
- Canvas Download 在真实浏览器下载成功。
- 失败和取消均显示未收费且 ledger 已退款。

缺口：

- `Create variations`／`More like this` 曾直接 reserve 1 credit，没有先出现一次性 exact confirmation。
- source-based variation 在本机因 provider 读不到 local URL 失败；这属于环境限制，但 confirmation 缺失属于产品缺陷。

复现摘要（QA-CRE-005）：选择成功 image node，点击 `Create variations`／`More like this`。余额立即进入 1-credit reserve，而不是先显示包含 output、count、ratio、references 与 exact credits 的确认。provider 读不到本地 source 后任务失败并退款。

期望：付费副作用发生在用户确认完整 material 之后；失败时同一 job 的 reserve 与 refund 可追溯。

建议方向（QA-CRE-005）：建议 variation、edit、animate 与 direct generation 共用 quote → single confirmation → approved material → receipt 契约，避免按钮直接形成付费副作用。回归时应核对一次用户意图只产生一组 reserve／settle 或 reserve／refund ledger。

### 4.4 Direct video generation — Blocked

通过：

- 4 秒、Standard 480p、16:9 在确认前显示 exact 5 credits。
- job 自动从 queued 更新到 DONE，无需刷新。
- Canvas 内 Play 可工作；Library 自动出现同一视频。
- 真实输出约 4.096 秒，H.264，24fps；本次中段画面符合 red cup prompt。

关键缺口：

- UI 只有 duration、quality、aspect ratio，没有 sound on/off。
- `useCanvasGen` 没有把 audio 意图送入 request；server defaults 把缺失值解释为 `audio: true`。
- 最新“completely silent”视频仍包含 AAC audio track；这次轨道接近静音（约 -91dB），但较早写 `no music, no voice` 的视频实测有可听声音（mean -30.9dB）。结果不可靠。
- 选了 16:9，但输出是 864×496（约 1.742），不是精确 1.778；建议产品与引擎共同明确允许的 aspect tolerance，再决定入库校验或规范化策略。
- Video node 可播放，但真实浏览器点击后没有稳定进入 selected state，也没有出现 video action footer／download。

复现摘要（QA-CRE-001）：

1. 打开 Canvas → Video。
2. 输入 `A red ceramic coffee cup rotating slowly on a clean white table, soft daylight, completely silent, no music, no voice, no text.`
3. 选择 4 seconds、Standard 480p、16:9，确认 5 credits。
4. 等待 DONE，并检查 job `01M1MBH5W162TQZ745K4PSN6VP` 与输出文件。
5. 真实 job snapshot 为 `audio: true`；MP4 含 AAC stereo track。该次音量接近静音，但较早同类 prompt 的输出有可听音频。

期望：UI 提供明确 sound 决定；sound off 的 approved material、job snapshot、provider request 与输出一致。

可能的代码边界：`FlowCanvas.tsx` 的 Video dialog、`useCanvasGen.ts` request、`batch-idempotency.ts` default resolution 与 worker provider adapter。

建议方向（QA-CRE-001）：

1. 可在 canonical `VideoSpec` 加明确 `sound: on | off`，让 UI、quote、approved material、idempotency key、job snapshot、provider request、receipt 与 replay 使用同一字段。
2. 建议 sound off 的回归证据最终落到 provider payload `generate_audio=false`／等价参数，而不是只依赖 prompt 文案。
3. 可在输出入库时校验时长、像素比例、audio stream 与批准规格；不符合时走明确恢复路径。
4. 建议 Video node 复用 image 的 selection/action contract，并覆盖 Edit with Otto、Remake／Animate、Download 与 More。

### 4.5 Canvas workspace — Blocked

通过：

- node 可拖动，刷新后位置保留。
- pan、zoom in/out、fit、selection mode 可进入。
- Add text、Add context、New conversation 基础入口存在。
- Image 的 5-icon action footer 与 Download 工作。

真实浏览器失败：

- 选中文字 node 后，Delete 与 Backspace 均没有删除。
- Shift+click 没有形成 multi-select；视觉上却出现多个粉色 outline，selection truth 不清楚。
- Video node 不能稳定选中；点击已有 video 曾误触全局 Generate image prompt，同时保留旧 image actions。
- composer、current-turn、action footer 与内容会重叠；fit-to-content 没有为 overlays 预留 safe area。
- stale failed node 体积过大，长期压住主要作品。

复现摘要（QA-CRE-002／008）：

1. 切到 Select tool，点击文字 node `E2E note — video approved`。
2. 分别按 Delete 与 Backspace；node 均未删除。
3. Shift+click 第二个 node；没有形成可验证的 multi-select，但多个 node 同时出现粉色 outline。
4. 点击 video node；Play 可用，selection/action footer 不稳定，旧 image action 仍可能保留。
5. Fit to screen；composer、current-turn 与 action footer 仍会覆盖可视内容。

期望：视觉 selection 与真实 selection state 一致；text/image/video 遵守相同 keyboard、multi-select 与 action-targeting 规则；Fit 将 overlays 视为 safe-area constraints。

可能的代码边界：`FlowCanvas.tsx`、React Flow selection callbacks、keyboard handler、node pointer propagation 与 overlay layout calculation。

建议方向（QA-CRE-002／008）：可建立唯一 `CanvasSelectionState`，让 pointer、keyboard、toolbar、node chrome 都读取同一状态；Play controls 应隔离自己的 pointer event，避免触发旧 selection action。建议增加 production-build browser E2E，覆盖 text／video／image 的 select、delete、multi-select、download 与 refresh persistence。

### 4.6 Library — Needs work

通过：

- All／Images／Videos／Cast／Ads filter 可切换。
- Search、详情、Copy link、Download 可工作。
- 最新 main 的 Add asset 已改为 `Choose a type…`，未明确选择前 Add 保持 disabled；产品图不会再静默变成人物。
- failed generation 从主 Library 移到 Needs attention；刷新后 stale in-progress 会消失。

缺口：

- Needs attention 把 backend 原文直接给 Founder：`reference video unreachable — refusing to spend`、`conditioning refs unreachable (0/2)` 等。
- failed cards 把完整长 prompt 当主标题，扫描性差。
- 资产详情的 generation receipt 仍可能显示 `Not reported by the engine`。
- 本测试 org 的 Product assets 为 0，因此 product reference 没有完成真实 E2E。

建议方向（QA-CRE-007）：backend 可保留 raw error code，Founder-facing UI 则通过稳定 taxonomy 映射成 `We couldn't reach that reference`，并提供 `Try again`／`Replace reference`。长 prompt 可放入 expandable details，卡片优先显示短标题、时间、状态和恢复动作。

### 4.7 Official Avatar catalog — Blocked

Founder 已批准：官方 Avatar 库是 read-only，用户只能查看并引用。

最新主干真实表现：

- Aisyah 详情出现 `Use as base`、`Add a variant`、`Variant name`、`What changes`。
- 填写两项后 `Make variant · 1 credit` 会变成 enabled。
- 本审计没有点击付费按钮，因此没有收费。

复现摘要（QA-CRE-003）：

1. Library → Cast → Open Aisyah。
2. 详情出现 `Use as base`、`Add a variant`、`Variant name` 与 `What changes`。
3. 输入任意 variant name 与 change description。
4. `Make variant · 1 credit` 从 disabled 变成 enabled。本轮没有点击，以免改变官方 catalog 状态。

期望：官方 catalog 只提供详情与 reference/use action；mutation UI 不出现，直接调用 shared action 也会在 spend 前被拒绝。

代码根因：

- `EntityDTO` 不携带 official-catalog／read-only policy。
- seed row 有 `catalogKey`／description metadata，但 DTO 没把它变成权限语义。
- `ElementVariantsDialog` 无条件展示 mutation controls。
- `createVariant`、`regenerateVariant`、`renameVariant`、`deleteVariant`、`setBaseAsset` 只检查 owner，没有拒绝 official catalog mutation。

建议方向（QA-CRE-003）：不建议用名字 `Aisyah` 或 UI 中临时判断 `catalogKey`。更稳妥的方案是让 Entity 的 canonical policy 明确表达来源与 capabilities，例如 `origin: OFFICIAL_CATALOG | USER` 以及 `mutateBase／createVariant／delete`，再由 DTO、UI 与 shared server actions 共用。官方项可只保留 View details、Use in Canvas／@ reference；server action 同样应拒绝 mutation，避免只靠隐藏按钮。

### 4.8 Uploads and reference generation — Partially tested

- Add asset 表单与类型选择已验证。
- 没有用户明确提供可上传文件，因此本轮没有替用户上传本机文件。
- local file → cloud provider 的 source reachability 尚未成立；image edit、video edit、Avatar reference 因此在 provider spend 前失败并退款。
- 这限制了 official-avatar identity consistency、image-to-video 和 reference role assignment 的真实质量验收。

建议在上线前提供 provider 可访问的 staging storage，再重跑 CREATE-A2、A9、A10、A11。

## 5. 自动验证与真实浏览器的差异

- production build：通过。
- Creation targeted tests：13 files，267 tests 通过。
- 最新 Add asset tests：3 files，15 tests 通过。
- `canvas-video-spec-ui` 仍输出多条 React `not wrapped in act(...)` warning。
- design-system audit：144／285 个 product files 使用设计系统，repo-wide adoption 为 **50.5%**。

重要结论：Canvas selection／interaction 单元测试虽然通过，真实浏览器里的 Delete、multi-select、video selection 仍失败。当前测试证明的是 isolated component contract，不是最终接线正确。建议把 production-build browser E2E 纳入 Beta gate。

## 6. Design system 与 UIUX 对齐

关键 Creation 页面已大量复用项目按钮、dialog、input、badge、card、empty、spinner 等 primitives，targeted design-system tests 也通过；但**不能声称所有前端都已跟随 design system**，因为 repo-wide adoption 只有 50.5%。

当前主要偏差不是颜色或圆角，而是 interaction semantics：

- 同一类付费动作没有统一 confirmation。
- current-turn 和 Conversation 没有清楚分工。
- selection visuals 与实际 selection state 不一致。
- official read-only policy 只存在于设计决定，没有贯穿 domain → DTO → UI → action。
- raw backend error 越过了 user-facing copy 层。

从长期维护角度，建议在 SSOT 修复后向下传播，而不是在每个 screen 分别打补丁。

## 7. Beta 修复顺序

### P0 — 建议作为 Release blocker 优先关闭

1. Video sound contract：sound off 从 UI 一路到 provider，并验证输出。
2. 所有 variation／edit／animate 统一 exact-credit confirmation。
3. Canvas text/video/image 的 select、delete、multi-select 与 action targeting。
4. Official Avatar read-only 在 domain、DTO、UI 与 server action 四层 fail closed。
5. Otto current-turn 与 step advancement 使用唯一 authoritative state。

### P1 — 建议在公开 Beta 前关闭

1. Create history recent-first、Canvas vocabulary、可扫描标题。
2. Video action footer 与 Download。
3. Canvas overlay safe area 与 failed node compact state。
4. Unified reference picker 的搜索、分类、chips 和长期数据容量。
5. 把 raw backend errors 映射成 founder-friendly recovery copy。

### P2 — 建议纳入上线前韧性回归

1. provider-accessible staging storage 后重测所有 reference-based journeys。
2. refresh／close／reopen during generation；stale polling；manual recovery。
3. insufficient credits、unknown settlement、double-submit、cancel-after-queue。
4. screen-reader labels、keyboard-only Canvas journey、focus return 与 Dialog focus trap。

## 8. 回归验收门

建议把以下项目设为同一个 production build 上的回归验收门：

1. Silent video 的 job snapshot 为 audio off，输出没有 audio track 或符合 approved silence policy。
2. 16:9 输出满足批准的 aspect tolerance。
3. 每个付费 action 只有一次 confirmation、一次 reserve、一次 settle／refund。
4. Text、image、video 都能单选、multi-select、delete、download；刷新后状态合理。
5. official Avatar 的 mutation UI 不存在，直接调用 server action 也被拒绝且不扣费。
6. Otto 每个阶段只显示一个 current state，图片批准后可靠进入视频 confirmation。
7. Library 不显示 raw provider/backend error。
8. Product／clothes／location／official-avatar／generated asset 均可通过统一 `@` picker reference。

## 9. CodeGraph 与证据回执

`CodeGraph: used — query: "startGen; videoOptions; CanvasLibraryPicker"; index: fresh at 0238e162; fallback reads: apps/web/components/canvas/FlowCanvas.tsx, apps/web/components/canvas/useCanvasGen.ts, apps/web/lib/batch-idempotency.ts, apps/web/components/otto/stuff/ElementVariantsDialog.tsx, apps/web/components/otto/OttoStuff.tsx, apps/web/lib/types.ts, apps/web/lib/refgen-actions.ts, apps/web/lib/actor-library-seed.ts.`

主干后来前进到 `e622bec6`；新增 diff 只涉及 Add asset 类型选择与对应测试。该 diff、production build 与真实浏览器状态均已单独重验。
