# 不再先合成 first frame：现场状态

核查日期：2026-09-14。只读核查，未运行测试、调用生成供应商、部署、修改任何工作树文件或与维修 agent 交互。

## 结论

**必须区分两条入口：分镜的强制合成首帧已完成合并；普通 Otto 对话没有清理干净，本次现场确实又提议先付费出图再视频。因此不能向 Founder 回答「已经全部改好」。** 下方部署与 PR 证据仅证明分镜改动已到当前 staging web。商家主动选择已有图做动画，仍应与系统额外提议再生成图分开判断。

- Founder 裁决：`/Users/winnin/Desktop/FIKIRTIVE/docs/specs/creation-engine.md:186`，2026-09-12 S5 裁决适用于所有镜头，任何分镜不再出现两步提议或 Generate all first frames。
- 已合并 [PR #1417](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1417)，merge `dfc7481f4fe364457b4eef6d62798505716fd8ef`，`mergedAt=2026-09-12T18:03:34Z`（马来西亚时间 9/13 02:03）。施工 [issue #1394](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1394) 已关。
- 本次 `gh pr view 1417 --json mergedAt,mergeCommit,statusCheckRollup` 返回 quality/e2e 等 SUCCESS（这是已有 CI，未重跑）。
- 本次 `git merge-base --is-ancestor dfc7481f4fe364457b4eef6d62798505716fd8ef 14bcd038b386d6e7d6ad98bbc716aaf018a23314` exit 0，确认当前 main 包含改动。

## 当前代码验证

- `/Users/winnin/Desktop/FIKIRTIVE/apps/web/lib/storyboard-gate1-actions.ts:283` minimalCtx 固定 `alwaysVideoReference: true`，`sourceGenerationId: undefined`。`:419` mintVideoChild 直接 kind video，从 `shot.videoPrompt` 铸卡。
- `/Users/winnin/Desktop/FIKIRTIVE/packages/core/src/reference-budget.ts:209`，alwaysReference 时返回 reference，不把纯商品挂图当 startFrame。
- `/Users/winnin/Desktop/FIKIRTIVE/packages/otto/knowledge/playbooks/storyboards.md:10`，给 Otto 的现行说明为每镜 ONE paid step、无 opening-still step；不是只改按钮文案。
- `/Users/winnin/Desktop/FIKIRTIVE/apps/web/components/otto/StoryboardCard.tsx:1105` 当前按钮 Make all videos，旧首帧批量执行端点与 UI 在 #1417 报废。
- `/Users/winnin/Desktop/FIKIRTIVE/apps/worker/src/jobs/gen.ts:2186` 参考图路径将原图直接作为 reference_image。同文件 :2093 起 `sourceGenerationId` 的动画路径仍存在，供已有图片动画使用；其存在不是「先生成付费首帧」的证明。
- #1417 PR 有已知收尾记录：兼容老卡字段、Otto editShot 仍接受 firstFramePrompt 并有过期级联、continuity schema 残留。不能声称所有同名字段都删净，但它们不等同于旧的首帧生成步骤仍在。

## 本次重新读取的部署证据

显式项目 FIKIRTIVE `b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`，显式环境 staging；仅 `railway deployment list`，不读取变量或凭据。

| 服务 | 最新部署 | 状态 | 当前提交 |
|---|---|---|---|
| web | 8c521569-f5ab-4126-b462-a4e9ee3120ff | SUCCESS | 14bcd038b386d6e7d6ad98bbc716aaf018a23314 |
| worker（wait） | b1d44a1a-fac4-4d38-a18b-5aff667614f7 | SUCCESS | 14bcd038b386d6e7d6ad98bbc716aaf018a23314 |
| worker-compute | 1473645d-5fbc-412d-b927-99ec99a5322f | SUCCESS | metadata 无 commitHash，精确版本未知 |

现场 GET `https://web-staging-7901.up.railway.app/api/health` 返回 `build:{sha:"14bcd038",ref:"main"}`，worker-wait / worker-compute up。故能确认当前 staging web 包含撤首帧代码；不能从这些证据声称 compute 版本也已确认，或任何生产域名已上线。未重新执行付费生成旅程。

## 另一 agent 的 E2E 维修：可以证实到哪一步

- 本次 GitHub 唯一 OPEN PR [#1438](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1438)，分支 `claude/e2e-round3-docs`，HEAD `db0293da3a20da9a57d006e05b01092e00fae338`；PR 自述 docs-only：第三轮报告入库与输入附近常驻说明的批准登记，尚未做实现改动。**不能将该 PR 说成 firstframe 修复在施工。**
- 本次工作树状态确有与第三轮缺陷相符的未提交修改，是「有维修工作文件」的证据，不是任务完成或 agent 当前持续运行的证明：
  - `.claude/worktrees/agent-a9b94d2e2ea0dbd70`：worker Dockerfile、db-backup.ts/test、备份 runbook。
  - `.claude/worktrees/agent-a9c20f0a5a15921ba`：LibraryView、产品身份字段、library-elements 与行为测试。
  - `.claude/worktrees/agent-aa6f3dfdc95f99ef6`：ProfileNames、balance-refresh、名称同步测试。
  - `.claude/worktrees/agent-ada7b07a397379b39`：Library favorites E2E 与焦点返回测试。
  - `.claude/worktrees/agent-a477ef8f1ff47a12f`：新增 zz-r3f06-shots.spec.ts。
- 没有发现新的 firstframe 专属维修分支或 OPEN PR；对应已交付的是 #1417。其他工作树内容未更改，未干扰维修 agent。

CodeGraph: not used — worker 按项目规则直接 rg/读取代码，Git、GitHub 与 live Railway metadata 为事实证据。


## 关键补核：普通 Otto 对话仍会提出先图后视频（本次现场确认）

原始证据：`/tmp/fikirtive-founder-canvas-20260914/evidence.json`，messages seq27–32，thread `thread_dad82159-06c9-46e1-b3fa-709bb39624a9`。

- seq27，2026-09-14T05:41:10.527：用户只要求 `ok i want the video to be 15 seconds`。
- seq28，05:41:18.522：新卡真实 payload 是 `kind:image`、`model:seedream`、`estimatedCredits:1`，并冻结 `videoStep.next.desiredDuration:15` 和视频预估 `33`。这证明不是仅仅沿用「首帧」这个词，而是确实铸了额外图片提议。`genJobId:null`，这份记录本身不证明图片卡已花钱或已运行。
- seq29：Otto 说 starting picture comes first, then the video card will appear for you to confirm。
- seq30 用户改口让它直接用已有图作 first frame。
- seq31 卡是 video，但媒体 `role:reference`、`referenceGenerationIds:[01M2F6XFRQ0YVS45ZJ8C8YFATH]`，没有 sourceGenerationId；seq32 却说 using your image as the first frame。这是另一处**话术与结构化回执不一致**，不应宣称真正以首帧角色发给供应商；本次未检查实际 provider request。

### 当前代码中仍在的完整路径

全部路径以 `/Users/winnin/Desktop/FIKIRTIVE/` 为根，当前 main 14bcd038：

1. `packages/otto/src/skills/propose.ts:201` 的模型工具 description 仍指示：video needs starting picture 时 `forVideo:true AND videoPrompt`，图完成后自动出视频确认卡。
2. `packages/otto/src/skills/propose.helpers.ts:92` 起 schema 仍接受 `forVideo` 和 `videoPrompt`；`:1304` 仍执行 `kind === image && input.forVideo` 分支；`:1385` 把预估与 `videoStep.next` 写入卡；`:1546` 发出该字段。
3. `packages/otto/src/video-step-handoff.ts:91` 的 `buildVideoStepCardPayload` 仍把第一步产物写为第二步 sourceGenerationId，kind video；这是一整条仍保留的两步实现。
4. `packages/otto/src/skills/propose.test.ts:1935`–`:1962` 附近的测试仍用 Xinyi holding the tumbler、forVideo true，断言第一步 image 和后续计划冻结成功。此处仅阅读测试，未运行。
5. `packages/otto/knowledge/product-map/creating.md:19` 仍描述 picture first then clip 是一次 forVideo + videoPrompt 计划。
6. `packages/otto/knowledge/craft/prompting.md:24` 禁止演员/商品先合成；紧接着 `:25` 却写用户指图要 THAT to move 时 make an image first + forVideo true，`:27` 保留接力说明。此处指令不一致是**可确认的文本事实**，但未读取这轮具体模型输入，不能把它断言为本次唯一因果。

### 为什么不能用 #1417 宣称整件事完成

- creation-engine.md:186 / #1394 / #1417 的验收与报废清单明确围绕「任何分镜」「所有镜头」以及 Generate all first frames。
- 同份 spec `:137` 仍记录 9/4 普通 propose 两步接力实现。#1417 实际只撤 storyboard 的首帧铸卡与画面，并没有撤普通 propose 的 forVideo/videoStep/handoff。
- 因此目前最准确说法：**分镜那条已经改好；你正在用的普通 Otto 对话还有旧的先图后视频路径，本次又碰到了，并未全部清干净。**
- 目前看到的维修工作树/开放 PR 没有可核实的该 generic forVideo 路径修复。不能承诺另一 agent 正在修这个具体残留；只能确认其他 E2E 修复有文件现场。
