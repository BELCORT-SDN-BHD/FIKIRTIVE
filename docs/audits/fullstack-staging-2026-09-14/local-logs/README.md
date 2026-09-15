# local-logs 说明（第三轮全栈 staging 走查，2026-09-14）

本目录只入库了本地日志的一个子集。以下内容**未纳入 git**：

## 被排除的内容

- 目录 `fullstack-artifacts/`、`fullstack-artifacts-attempt1/`、`fullstack-artifacts-attempt2/`、`fullstack-report/`、`fullstack-report-attempt1/`、`fullstack-report-attempt2/`、`fullstack-readback-artifacts/`：
  这些是 Playwright 的 trace 与 HTML 报告产物（`trace.zip`、`index.html`、`test-failed-*.png` 等），单个 trace 常达数 MB，HTML 报告内嵌了完整 trace/截图数据，属于可重新生成的调试产物而非规格或证据文本，不适合入库膨胀仓库体积。
- 单文件超过 100 KB 的日志：`e2e-browser.log`（约 162 KB）、`quality.log`（约 241 KB）、`worker-tests.log`（约 406 KB）、`web-tests.log`（约 988 KB）。这些是完整测试运行的原始终端输出，体积大且大部分内容对读者价值有限，其结论已经摘录进本目录顶层的 `.md` 报告文件（如 `automated-checks.md`、`coverage-matrix.md`、`findings-catalog.md`）。

## 完整版在哪里

以上被排除的文件与目录，原样保留在本机：

```
/Users/winnin/.codex/worktrees/e2e-round3-20260914/FIKIRTIVE/docs/audits/fullstack-staging-2026-09-14/local-logs/
```

需要复核某条结论的原始 trace 或完整日志时，去这个路径读取（该 worktree 保留未提交的第三轮走查现场，不要在其中做写操作）。

## 定位

本目录下入库的文件是**第三轮走查的证据文件**，服务于 `findings-catalog.md` 等报告里引用的具体行号/时间戳核对，不是长期维护的测试基础设施；不要把这里当作正式的日志留存机制或 CI 产物归档规范。
