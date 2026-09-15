# Founder 画布现场诊断（2026-09-14）

本目录是对 Founder 自己 staging 画布的一次**只读现场诊断**，日期 2026-09-14，对象是 Founder 截图中的 `Hi!` 画布——Project `canvas_dad82159-06c9-46e1-b3fa-709bb39624a9`、Thread `thread_dad82159-06c9-46e1-b3fa-709bb39624a9`。诊断未修改产品、用户会话、钱账或线上配置，未触发真实付费生成；对应主干提交 `14bcd038`。完整结论见 `report.md`（另有 `backend-report.md`、`firstframe-status.md` 两份支撑证据，以及 `pending-generate-diagnosis.md` 的隔离复现记录）。

诊断结论已按四项发现（FC-1…FC-4）登记进 `docs/specs/otto-engine.md` §5 与 `docs/specs/creation-engine.md` §5 的变更登记；本目录只是证据存放处，不是修复。

## 这不是产品测试套件的一部分

`pending-generate.test.ts` 与 `vitest.config.ts` 只诊断用，只存在于这个 audit 文件夹，**不接入、不改写任何正式测试套件**，CI 不会跑它们。

Codex 那次复现依赖本地一个 `node_modules` 符号链接，只读复用主检出 `packages/otto/node_modules`（未安装、未构建、未修改主检出）；这个符号链接是环境产物，本次入库**有意不提交**，因此本目录下看不到 `node_modules`。

## 如何重跑

原始命令（记录于 `pending-generate-diagnosis.md`）：

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH packages/otto/node_modules/.bin/vitest run --config docs/audits/founder-canvas-2026-09-14/vitest.config.ts
```

在别的检出重跑时：

- vitest 二进制路径要换成当前检出实际存在 `node_modules` 的位置（例如先在主检出跑一次 `pnpm install`，再指向该检出的 `packages/otto/node_modules/.bin/vitest`），因为诊断本身**不提供** `node_modules`。
- `vitest.config.ts` 里 `resolve.alias["@/"]` 目前写死指向 Codex 工作树的绝对路径（`/Users/winnin/.codex/worktrees/founder-canvas-diagnosis-20260914/FIKIRTIVE/apps/web/`），跨检出重跑前需要同步改成当前检出的 `apps/web/` 路径。
- 预期结果与原始记录一致：`interrupted:true, approvals:1, executed:0, status:"Ready"`，1 个症状断言红、3 个诊断探针绿，约 1.5 秒；完整输出见 `pending-generate-output.txt`。
