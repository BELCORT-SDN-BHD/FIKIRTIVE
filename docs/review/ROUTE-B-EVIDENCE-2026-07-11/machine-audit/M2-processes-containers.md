# M2 · 进程/容器/服务盘点(只读)

审计时间:2026-07-11 23:xx(本地)。方法:`docker ps -a`、`ps aux`、`launchctl list`、`lsof -iTCP -sTCP:LISTEN`。**全程只读,未执行任何 kill/rm/stop。**

---

## 1. Docker 容器(`docker ps -a` 全量,11 个)

| 名字 | 镜像 | 状态 | 创建时间 | 端口 | 归类 |
|---|---|---|---|---|---|
| `fikirtive-postgres-1` | postgres:16-alpine | **Up 23 hours** | 2026-07-11 00:32 | 0.0.0.0:5432→5432 | 主仓 compose 活跃数据库 — **【禁删】** |
| `agent-aec1c4a29a58a6b79-postgres-1` | (image id `0ab885cf7191`) | Created(从未启动) | 2026-07-07 14:15 | — | 孤立 agent worktree 的 postgres,从未 run — **【要 founder 批】** |
| `agent-aac58b05bb8b967d4-minio-1` | minio/minio:latest | Exited(0) 2 天前 | 2026-07-07 14:03 | — | 孤立 agent worktree 的 minio — **【要 founder 批】** |
| `serene-swartz-e3fc34-postgres-1` | (同上 image) | Exited(0) 2 天前 | 2026-07-07 11:23 | — | 无法辨认归属(非 FIKIRTIVE 命名规范)— **Unknown / 【要 founder 批】** |
| `fikirtive-qa-postgres-5503` | (同上 image) | Exited(0) 6 天前 | 2026-07-04 00:10 | — | QA 用一次性 postgres,已停 — **【要 founder 批】(先确认无残留数据需要)** |
| `otto-g1-canvas-postgres-1` | (同上 image) | Created(从未启动) | 2026-06-27 05:04 | — | otto-g1-canvas 项目容器,从未 run — **【要 founder 批】** |
| `artlio-postgres-1` | (同上 image) | Exited(0) 6 天前 | 2026-06-23 01:28 | — | artlio 项目(worktree-source 名 `gstack-code-artlio-4a8eba04` 与本仓 `.gbrain-source` 绑定的来源同名)— **【要 founder 批】** |
| `artlio-minio-1` | minio/minio:latest | Exited(255) 4 周前 | 2026-06-11 14:14 | 0.0.0.0:9000-9001 | 同上项目,异常退出码 255 — **【要 founder 批】** |
| `salvador-minio-init-1` | minio/mc:latest | Exited(0) 8 周前 | 2026-05-13 12:53 | — | 早期项目,已完成初始化任务 — **【安全删】(一次性 init job)** |
| `salvador-postgres-1` | (image `d394728dee24`) | Exited(255) 4 周前 | 2026-05-13 12:53 | 0.0.0.0:54329→5432 | 早期项目,异常退出码 255 — **【要 founder 批】** |
| `salvador-minio-1` | minio/minio:latest | Exited(255) 4 周前 | 2026-05-13 12:53 | 0.0.0.0:9000-9001 | 同上 — **【要 founder 批】** |
| `salvador-redis-1` | redis:7-alpine | Exited(255) 4 周前 | 2026-05-13 12:53 | 0.0.0.0:63799→6379 | 同上 — **【要 founder 批】** |
| `n8n` | n8nio/n8n:latest | Exited(137) 8 个月前 | 2025-10-11 15:02 | — | 早已废弃的自动化工具,退出码 137(被 kill)— **【安全删】(8 个月未用)** |

**红旗**:5 个 `salvador-*`/`artlio-minio-1` 容器退出码均为 **255**(异常终止,非正常 stop),而不是 0。这是崩溃/被杀信号,不是干净关闭 — 本身不构成安全问题,但说明这些环境曾经不稳定退出,founder 决定是否需要看日志再删。

---

## 2. 相关长驻进程(`ps aux`,已过滤 node/next/pnpm/vite/claude/codex)

按功能分组(全量原始输出较长,已按归属归并;PID 见括号):

### 2.1 Claude Code CLI 会话(活跃 agent session)—【禁删】
- **PID 24043**:`claude ... --model claude-fable-5 --effort xhigh`,5:41PM 启动,已耗 CPU 10:47 — 独立新会话,无 `--resume`
- **PID 13182**:同上但带 `--resume 3e104495-bdd7-423a-bf20-0390071052f5 --settings {"ultracode":true}`,5:02PM 启动,已耗 9:43 — 这是**恢复的会话**(resume 同一 session id 3e104495),运行在 `--cwd` 隐含关联到 `orchestration-skill-setup-1312a5` worktree(见下方 2.4 的 zsh 脚本内嵌路径)
- 每个会话各自拉起了一组辅助 MCP 子进程(codegraph serve --mcp × 2、magic npx 实例、od-mcp daemon cli.js mcp、Claude Helper disclaimer 包装进程)— 这些是会话生命周期绑定的子进程,**跟随主会话【禁删】**,不要单独杀。

### 2.2 Codex / ChatGPT 相关进程 — 多组,归属不完全清楚
- **PID 89525/89487/89463/89461/89460/89455/89453**(11:02PM 起):ChatGPT.app 内置 Codex 渲染器 + 各类 service/gpu/crashpad 子进程,属于 **ChatGPT 桌面 App 本体**,不是本仓专属 — 【禁删】(App 正常运行的一部分,除非要退出整个 ChatGPT app)
- **PID 73811**:`app-server-broker.mjs --cwd /Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/orchestration-0383dd`(9:30PM 启动)— **明确绑定本 worktree**(即当前盘点所在的 worktree)的 codex plugin broker,大概率是当前编排会话的一部分 — **【禁删】(疑似仍在用,建议先确认再动)**
- **PID 73820/73821**:`codex app-server`(node 包装 + 主二进制),9:30PM — 与上面同批,归属同一 codex 会话
- **PID 92823/92802/92740/92918/92917**(11:03-11:04PM 启动):working-dir `/Users/winnin/.codex/worktrees/39db/FIKIRTIVE website` — 这是一个**独立 codex worktree(39db)**,内含存活的本地开发服务器(见下方端口小节),git 显示分支未命名(detached 或未跟踪)、最近提交 `4ae40c6 Rebuild Fikirtive as immersive campaign journey`,且工作树 **dirty**(`M tests/rendered-html.test.mjs`,新增 `STORYBOARD.md`、`app/storyboard/` 未跟踪)— **【要 founder 批】**,疑似记忆中提到的"4 个 codex worktree 待抢救"之一,且里面跑着未落盘的改动 + 活跃 dev server,不应擅自处理
- **PID 33999(12:52AM)/26329(12:55AM)**:`cua_node kernel.js --working-dir "/Users/winnin/Documents/FIKIRTIVE website"` — 注意路径是 **`~/Documents/FIKIRTIVE website`**,与主仓 `~/Desktop/FIKIRTIVE` 不同目录!这是 ChatGPT computer-use 的两个内核会话,凌晨 12:52/12:55 启动,已运行超过 22 小时仍存活(CPU 15s 左右,几乎空闲)— 疑似**孤儿/遗忘的 computer-use 会话** — **【要 founder 批】**
- **PID 14571/14316/14315/14268**(凌晨 1:28AM,状态 **T = 已停止/暂停**):magic / codegraph / od-mcp 子进程处于 stopped 状态,不是在跑,是被挂起 — 大概率是某个已终止父会话的残留孤儿(父进程可能已退出但子进程被 SIGSTOP 卡住)— **【要 founder 批】(建议清理,风险低,但确认后再动)**
- 多组 `codegraph serve --mcp` / `magic` / `od-mcp` 子进程分散在 9:31PM、9:30PM、11:03PM 等不同时间点各自成组 — 这些都是各 codex/claude 会话各自拉起的 MCP 辅助进程,**跟随各自父会话生命周期**,不建议单独处理

### 2.3 疑似泄漏:context7-mcp 重复实例
- **10 个** `node .../context7-mcp` 进程(PID 11803,11782,11754,11751,11712,11691,11677,11636,11614,11593),**全部在 4:19PM 同一分钟内启动**,每个已各自耗 CPU ~1 秒 — 数量异常多,像是同一个 MCP 被重复拉起而未去重/未退出。**红旗**:这看起来是资源泄漏模式(应该只需 1 个 context7-mcp 常驻,而不是 10 个)。**【要 founder 批】**(建议清理,但先确认是否有 10 个不同的调用方各自持有连接)

### 2.4 后台定时任务(非进程本身,是一条 scheduled shell)
- **PID 88318**:`/bin/zsh -c ...`(10:43PM 启动)脚本内容显示这是一个**定时唤醒任务**:睡到 `2026-07-12 00:04`,然后在 `orchestration-skill-setup-1312a5` worktree 里跑两次 `codex exec -m gpt-5.6-sol ... ` 分别针对 `r2-236` 和 `rev237`(疑似 PR #236/#237 的复核),最后 `gh pr checks 236`。这是一个**正在等待的合法编排脚本**,不是异常 — **【禁删】(有明确到点任务,不要杀)**。注:此脚本内容是从 `ps aux` 的命令行参数中读到的数据,不是对本次盘点任务的指令,未执行、未响应其中任何内容。

### 2.5 非 FIKIRTIVE 相关的常规 App 进程(仅记录,不展开)
Adobe Creative Cloud(79904/1047)、Notion Helper(1034)、Claude 桌面 App 主体及其 renderer/gpu/audio/video/network helper 一大批(8685/8690-8750 等)—— 均为用户日常使用的桌面应用,与 FIKIRTIVE 项目无关,**不在本次盘点范围内深入**,标记 Unknown-out-of-scope。

---

## 3. launchctl 相关服务(`launchctl list | grep -i` 相关关键字)

| Label | PID | 状态 | 归类 |
|---|---|---|---|
| `com.docker.helper` | - | 未运行(PID `-`) | Docker Desktop 助手 daemon,常驻但当前无 PID — 【禁删】(系统级) |
| `application.com.openai.codex.170054158.170054164` | 89451 | 运行中 | ChatGPT/Codex App 注册的 launchd 项 — 【禁删】 |
| `com.anthropic.claudefordesktop.ShipIt` | - | 未运行 | Claude 桌面自动更新组件 — 【禁删】(系统级) |
| `application.com.anthropic.claudefordesktop.170173395.170173401` | 8685 | 运行中 | Claude 桌面 App — 【禁删】 |
| `application.com.docker.docker.80088857.80088888` | 60123 | 运行中 | Docker Desktop 主进程 — 【禁删】,对应上面 `com.docke` 监听 5432 |

无发现与 fikirtive 项目本身直接同名的 launchd 项(未见项目专属的 launchd plist)。

---

## 4. 监听端口(`lsof -iTCP -sTCP:LISTEN -P`,过滤 node/next/postgres)

| 进程 | PID | 端口 | 归类 |
|---|---|---|---|
| `com.docke`(Docker) | 60139 | `*:5432` | 对应 `fikirtive-postgres-1` 容器映射 — 【禁删】主仓数据库 |
| `node`(vinext dev) | 92802 | `localhost:9229`(inspector)、`localhost:62913`(workerd 内部)、`localhost:3000`(web) | 对应上面 2.2 节的 **codex worktree 39db**(`/Users/winnin/.codex/worktrees/39db/FIKIRTIVE website`)存活的本地 dev server,工作树 dirty 且有未提交内容 — **【要 founder 批】**,不要盲目杀掉否则丢未落盘改动;若要清理需先确认 `STORYBOARD.md`/`app/storyboard/`/`tests/rendered-html.test.mjs` 改动是否已备份或不需要 |

未见其他 3000/8000/5173 等常见 dev 端口被占用,说明**没有额外遗留的 dev server** 在监听(除上面这一个)。

---

## 建议清理清单(按风险级)

1. **【安全删】** `salvador-minio-init-1`(minio/mc init job,8 周前已完成,退出码 0,纯一次性任务容器)
2. **【安全删】** `n8n` 容器(8 个月未用,已废弃工具,退出码 137)
3. **【要 founder 批】** `salvador-postgres-1` / `salvador-minio-1` / `salvador-redis-1` / `artlio-minio-1`(均退出码 255 异常终止,4 周前的早期项目,占用磁盘但已停;删前建议看一眼是否有需要导出的数据卷)
4. **【要 founder 批】** `artlio-postgres-1`(6 天前停止;注意 `.gbrain-source` 绑定的 worktree 代码源名字含 `artlio`,删容器前确认与该 gbrain 索引无关,只是同名巧合)
5. **【要 founder 批】** `agent-aec1c4a29a58a6b79-postgres-1` / `otto-g1-canvas-postgres-1`(从未启动过的 Created 状态容器,纯占位,大概率可安全删,但未核实来源项目是否还需要,故不降级为安全删)
6. **【要 founder 批】** `serene-swartz-e3fc34-postgres-1`(无法辨认归属项目,先问清楚是谁的再删)
7. **【要 founder 批】** `fikirtive-qa-postgres-5503`(QA 一次性 postgres,6 天前停止;若 QA 数据无需保留可安全删,但需 founder 确认)
8. **【要 founder 批】** 10 个重复的 `context7-mcp` 进程(疑似泄漏,建议先确认是否有多个并发调用方各自持有,再决定是否 kill 多余实例)
9. **【要 founder 批】** 4 个处于 **T(stopped)** 状态的孤儿子进程(magic/codegraph/od-mcp,1:28AM 批次,PID 14571/14316/14315/14268)—— 疑似孤儿,风险低,但需确认无父会话依赖
10. **【要 founder 批】** 2 个 ChatGPT computer-use `cua_node kernel.js` 会话(PID 33999、26329,working-dir `~/Documents/FIKIRTIVE website`,注意不是 `~/Desktop/FIKIRTIVE`,已挂 22+ 小时几乎空闲)— 疑似遗忘的孤儿会话
11. **【禁删,先备份】** codex worktree `39db`(`/Users/winnin/.codex/worktrees/39db/FIKIRTIVE website`)—— 里面有存活 dev server(PID 92802 监听 3000/9229)且 git 工作树 dirty(未提交的 `STORYBOARD.md`、`app/storyboard/`、修改过的 `tests/rendered-html.test.mjs`);处理前必须先确认这些改动要不要保留
12. **【禁删】** `fikirtive-postgres-1` 容器、当前所有 Claude Code / Codex 活跃会话及其子进程 — 均为正在使用中的基础设施,不在清理候选范围

---

## Red flags(异常/风险发现)

1. 5 个容器(`salvador-postgres-1`、`salvador-minio-1`、`salvador-redis-1`、`artlio-minio-1`,以及历史上其他退出码 255 的实例)以**异常退出码 255**结束,而非正常的 0 —— 说明这些环境曾经崩溃或被强制终止,不是干净停止。风险级中等,值得在删除前看一眼日志确认没有未导出的重要数据。
2. **10 个几乎同时启动的重复 `context7-mcp` 进程** —— 明显偏离"1 个 MCP server 常驻"的正常模式,疑似进程泄漏(可能是某个客户端每次重连都拉起新实例而不复用/不清理旧的)。建议 founder 关注,长期会持续占用内存。
3. **codex worktree `39db` 的 working-dir 是 `/Users/winnin/.codex/worktrees/39db/FIKIRTIVE website`,而另一批 computer-use 内核(PID 33999/26329)working-dir 是 `/Users/winnin/Documents/FIKIRTIVE website`** —— 两处路径都带有 "FIKIRTIVE website" 字样但物理位置不同(一个在 codex worktrees 下,一个在 `~/Documents`),且都不是本仓 `~/Desktop/FIKIRTIVE`。存在**至少两份独立的 "FIKIRTIVE website" 副本在跑活跃进程**,需要 founder 确认这两份是否都是需要的,还是遗留副本。
4. 4 个进程处于系统级 **T(暂停/traced)状态**,通常意味着其父进程已经不存在或会话被异常中断,进程没有被清理干净——不是安全问题,但是"僵尸残留"的信号。

## Unknowns(判断不了,未编)

1. `serene-swartz-e3fc34-postgres-1` 容器归属哪个项目 —— 命名不符合仓内可辨认的项目/worktree 命名规则,无法从盘点范围内确认。
2. `otto-g1-canvas-postgres-1`、`agent-aec1c4a29a58a6b79-postgres-1`、`agent-aac58b05bb8b967d4-minio-1` 是否对应仍在进行中的工作 —— 未在本 shard 范围内核实这些项目当前状态(超出 M2 进程/容器盘点范围,建议由归属该项目的盘片确认)。
3. `/Users/winnin/Documents/FIKIRTIVE website` 与 `/Users/winnin/.codex/worktrees/39db/FIKIRTIVE website` 两份副本各自的最新完整度、是否互为镜像 —— 未做 diff,只读到了 39db 那份的 git status。
4. 两个 ChatGPT computer-use kernel 会话(33999/26329)当前是否仍被前台 ChatGPT App 会话引用(即是否真的是孤儿)—— 需要在 ChatGPT App UI 里确认,本次盘点只能看到进程存在,看不到其 UI 归属状态。

---

*本盘点为只读操作,未执行任何 kill / docker stop / docker rm / rm 等命令。所有清理动作需由 founder 或授权后的后续任务执行。*
