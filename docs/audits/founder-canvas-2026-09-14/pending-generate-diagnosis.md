# Otto 承诺生成却没有确认卡：隔离复现

日期：2026-09-14。代码：14bcd038b386d6e7d6ad98bbc716aaf018a23314。仅诊断，未修产品。

## 实测边界

本地假模型返回一句承诺与 `generate({cardId: "fixture-storyboard-card"})`，真实 `generateSkill`、Agents SDK、`runOttoTurn`、`finalizeOttoTurn` 运行，数据库替换为空查询 mock。再将实际审批结果输入真实 `canvasTurnStatus`。没有访问数据库、环境文件、浏览器、模型供应商或网络。测试不导入 web finalizer，也不渲染整个 React 界面；从 finalizer 到组件的接线以下标作代码证据，不能称为完整端到端复现。

## 已执行反馈环

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH packages/otto/node_modules/.bin/vitest run --config docs/audits/founder-canvas-2026-09-14/vitest.config.ts
```

最终退出 1，1 个症状断言红、3 个诊断探针绿，约 1.5 秒。完整无敏感内容输出在 `pending-generate-output.txt`。反复运行相同结论：`interrupted:true, approvals:1, executed:0, status:"Ready"`，正文为承诺。测试仅存在本 audit 文件夹，不改变正式测试套件。依赖通过本 worktree 的本地 symlink 只读复用主检出的 node_modules（没有安装、构建或修改主检出）。

## 三个假说与探针

1. **审批存在但没有可显示 GEN_CARD**：仅把 pendingConfirmCount 从 0 改为 1，Ready 变为 Needs confirmation；仅传 needs_approval / pending ID 仍 Ready。确认。
2. **错 ID 已触发工具失败**：若成立，park 时应查卡。实际 park 与 restore 查询次数均 0；显式执行 executeGenerate 才查 `kind: GEN_CARD`，空结果返回 `Card not found.`，startGen 仍 0。排除作为当前停止原因，属于潜伏的下一道失败。
3. **SDK 审批未正确识别或保存**：若成立，approvals 或 restore interruptions 应为空。实际 finalization 有 1 个 generate 审批，序列化恢复后仍有 1 个 interruption。排除。

## 链条与代码证据

- `packages/otto/src/skills/generate.ts:198` 声明 spend；`:208` 明确仅执行 GEN_CARD；`:73` 执行时查询限定 GEN_CARD。参数结构只有 string cardId（`:40`），无法在 SDK 暂停之前证明对象种类。
- `packages/otto/src/runtime.ts:1034` 从 interruptions 得到 interrupted、approvals、文本与序列化 state。此段已真实执行。
- `apps/web/lib/otto-actions.ts:1585` 将 generate.ref 直接当 pendingCardIds；只为非 generate 审批铸 APPROVAL_CARD（`:1640`）。当前分支不确认该 ref 对应合法 GEN_CARD。`:1608` 只在没有模型正文时补审批指向句，所以模型承诺原样持久化（`:1625`）。此段为代码证据，未执行。
- `apps/web/app/api/otto/stream/route.ts:666` 输出 needs_approval 与 pendingCardIds。`OttoChatStream.tsx:529` 接入 pending ID，但`:1360` 只计 GEN_CARD，`:1377` 还限于当前用户消息之后的 idle 卡。STORYBOARD_CARD 不可能成为该确认卡。此段为代码证据。
- `apps/web/lib/otto-canvas-turn.ts:164` 仅 pendingConfirmCount>0 才显示 Needs confirmation；`:194` 其余 Ready。本段已真实执行。
- 刷新时 `apps/web/lib/dto.ts:262` 的 toChatThreadDTO 不投影审批 state；组件 `OttoChatStream.tsx:350` pending set 从空开始。此段为代码证据，未运行 reload 测试。

## 正确动作与最小修复边界

STORYBOARD_CARD 是草稿，不能直接作为 generate.cardId。已有人工路径为 `StoryboardCard.tsx:651` → `prepareStoryboardVideos`（`storyboard-gate1-actions.ts:755`，读取 STORYBOARD_CARD，制作各镜头子卡）→ 明确确认 → `StoryboardCard.tsx:679` 对 childCardId 调共享付费动作。应将 Otto 接上同一分镜准备与子卡确认动作，保留报价与付费批准，不能用取消 SDK 审批解决。不要只增加解释文字，也不要让 Ready 接管真实等待状态。

推荐回归：真实 SDK 假模型发出分镜生成意图，真实应用 finalizer + mock 持久层 + 实际 UI 装配，断言出现对应子卡、合法类型/归属/报价、确认前零 startGen；刷新后仍能确认。另以 STORYBOARD_CARD 误传 generate 的负例，证明系统不会留下无法操作的审批或宣称 Ready。当前测试为最小症状环；web finalizer 到完整 UI 的缺口仍需该回归补齐。

CodeGraph: not used — worker isolated worktree, followed project rule to use rg and direct reads.
