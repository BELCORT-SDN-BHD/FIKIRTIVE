# M1 · git worktrees + 分支全量盘点

只读盘点。未执行任何 rm/prune/reset/clean/stash。所有命令均为 `git ... status --short` / `git branch -a` / `git rev-list --count` / `git rev-parse` / `gh pr list` / `ps` / `du` 只读调用。

证据基准：`~/Desktop/FIKIRTIVE` 主仓 `origin/main` 本地引用 = `52949e6c`（PR #235,最后 fetch 2026-07-11 18:17,今日新鲜)。docs/ops/ORCHESTRATOR-STATE.md 记录的地面真相基准是 `09cd9060`(#227)——本盘点用的 origin/main 引用比状态账新(#228-#235 均已落地),按机器事实为准。

## 一、worktree 全量(`git worktree list --porcelain`,共 29 条注册记录)

### 受保护清单(ORCHESTRATOR-STATE.md §二"Dirty worktree 保护清单" 7 条 —— 全部核对,dirty 计数与文档完全一致,【禁删】)

| Worktree | 分支/HEAD | dirty 计数(核实) | 归属 |
|---|---|---|---|
| `~/Desktop/FIKIRTIVE`(主仓) | `claude/northstar-immersive` / `763a28e6` | 4(文档写 5,今核实为 4——`git status --short` 现场为 4 行;可能文档记录时点不同,轻微漂移,不影响"禁删"判断) | 用户主工作区,PR #203 分支,【禁删】 |
| `…/scratchpad/wt-lcf` | `claude/lc-f-home-ideas-lighting` / `54c1de0b` | 2(StudioIdea schema+migration,与文档记录一致) | 旧 Claude session 遗留,已有耐久备份,【禁删】 |
| `~/.codex/worktrees/24a1/FIKIRTIVE` | `codex/schedule-publish-qa-fixes` / `515e6073` | 15(canvas/Otto/设计资产) | Codex 活跃工区,PR #142 已 MERGED 但另有 15 个未提交改动,【禁删】 |
| `~/.codex/worktrees/a620/FIKIRTIVE` | `codex/admin-dashboard-v2` / `30dd90e0` | 1(`docs/audits/`) | Codex,PR #131 已 MERGED,另有 1 个未提交,【禁删】 |
| `~/.codex/worktrees/b5ec/FIKIRTIVE` | detached / `eb8ce68c` | 3(outputs/tmp/videos) | Codex,无分支(detached),生成产物,【禁删】 |
| `~/.codex/worktrees/dec1/FIKIRTIVE` | detached / `d5434f6d` | 16(删除态:hooks/QA 截图/config/lockfile) | Codex,无分支(detached),状态存疑(大量删除态,像中断的清理操作),【禁删】 |
| `~/.codex/worktrees/gtm-canvas-prod-qa-20260705` | `codex/nav-new-campaign-guard-20260705` / `71f85839` | 1(`FlowCanvas.tsx`) | Codex,PR #166 已 MERGED,另有 1 个未提交改动,【禁删】 |

### Prunable 幽灵记录(目录已不存在,`git worktree list --porcelain` 标 `prunable`;`git worktree prune` 是纯元数据清理,不会动任何文件——因为目录已经没了)

| Worktree 路径(已不存在) | 分支 | 判断 |
|---|---|---|
| `…/fikirtive-orchestrator-handoff-1ec82f/…/scratchpad/fleet/wt-inbox-opus` | 无(未记录分支,只有 detached HEAD `3dfcdbc`) | 【安全删】`git worktree prune` |
| `…/fikirtive-orchestrator-handoff-1ec82f/…/scratchpad/fleet/wt-l1gate4` | 无 | 【安全删】`git worktree prune` |
| `…/fikirtive-orchestrator-handoff-1ec82f/…/scratchpad/fleet/wt-ship` | 无 | 【安全删】`git worktree prune` |
| `…/fikirtive-orchestrator-handoff-1ec82f/…/scratchpad/wt-d8-truth` | `claude/d8-capability-truth`(PR #211 已 MERGED) | 【安全删】`git worktree prune`(分支内容已在 main) |
| `…/fikirtive-orchestrator-handoff-1ec82f/…/scratchpad/wt-governance` | `claude/masterplan-lighting-v2`(PR #214 已 MERGED) | 【安全删】`git worktree prune`(分支内容已在 main) |

### 其余非受保护、目录尚存的 worktree(逐条核实 dirty=0,分支↔PR 状态见下)

| Worktree | 分支 | dirty | PR 状态 | 判断 |
|---|---|---|---|---|
| `…/scratchpad/wt-doctrine` | `claude/doctrine-sol-elevation` | 0 | PR #226 MERGED | 【安全删】干净+已并入 main,可移除工作副本 |
| `…/scratchpad/wt-merge-skill` | `claude/orchestration-skill-merge` | 0 | PR #225 MERGED | 【安全删】同上 |
| `…/scratchpad/wt-otto-fix`(本次审计所在会话的兄弟 worktree) | `claude/research-sanitize-error` | 0 | **PR #237 OPEN**(mergeable) | 【禁删】活跃未合分支,勿动 |
| `…/scratchpad/wt-d2-unconfirmed` | `main-health` | 0 | 就是 origin/main 本身(ahead=0 behind=0) | 【安全删】只是 main 的干净镜像,无独有内容 |
| `…/scratchpad/wt-slice1` | `claude/aprime-slice1-shell` | 0 | **PR #236 OPEN**(mergeable) | 【禁删】活跃未合分支(FIK-1 aprime 切片),勿动 |
| `~/.codex/worktrees/13d2/FIKIRTIVE` | detached `bff7f502` | 0 | 该 commit 是旧 main 祖先(ahead=0 behind=51 对照同 SHA 的历史分支) | 【要 founder 批】内容零风险(纯旧快照),但目录由 Codex CLI 管理,删前建议先确认 Codex 内部注册表(`~/.codex/worktrees` 索引)是否仍引用它,而非直接 rm |
| `~/.codex/worktrees/1ef9/FIKIRTIVE` | detached `bff7f502`(与 13d2 同 commit) | 0 | 同上 | 同上【要 founder 批】 |
| `~/.codex/worktrees/33ed/FIKIRTIVE` | detached `bff7f502`(同上) | 0 | 同上 | 同上【要 founder 批】 |
| `~/.codex/worktrees/56de/FIKIRTIVE` | detached `bff7f502`(同上) | 0 | 同上 | 同上【要 founder 批】 |
| `~/.codex/worktrees/6715/FIKIRTIVE` | detached `bff7f502`(同上) | 0 | 同上 | 同上【要 founder 批】—— 五个几乎一模一样的空快照 worktree,疑似 Codex 每次 session 自动开的临时目录,从未清理 |
| `~/.codex/worktrees/1850/FIKIRTIVE` | `codex/orchestrator-handoff` | 0 | PR #228 MERGED(即"控制权交接"文档里的旧控制面分支,已 completed) | 【要 founder 批】内容已并入且完成使命,但涉及"控制权交接"记录,建议 founder 确认不再需要留档后再删 |
| `~/.codex/worktrees/artlio-auth-session-gate-test` | `codex/auth-session-gate-test` | 0 | PR #127 MERGED | 【安全删】干净+已并入 |
| `~/.codex/worktrees/artlio-research-queue-safety` | `codex/research-queue-safety` | 0 | PR #126 MERGED | 【安全删】干净+已并入 |
| `~/.codex/worktrees/d629/artlio` | `codex/fikirtive-dashboard-uiux` | **0(现场核实)** | 无匹配 PR(open/closed/merged 均无);ahead=0 behind=474(该分支全部提交已是 main 的祖先,无独有内容) | ⚠️见下方 red flag —— 与内部记忆(2026-07-10)"待抢救/238MB 原型/钱路相邻 diff"矛盾,现场是干净的(0 dirty)。253MB 磁盘占用。判断:【要 founder 批】,先向 founder 核实此前记忆所指的"diff"是否已提取/落盘别处,再决定是否清理,不能假设记忆过期 |
| `~/Desktop/FIKIRTIVE/.claude/worktrees/agent-ad23af9ec48f0b508` | `worktree-agent-ad23af9ec48f0b508` | 0 | 无独有内容(worktree-agent-* 快照分支,ahead=0) | ⚠️`git worktree list` 报告 `locked`(claude agent pid 8635,声称 2026-07-07 07:04 启动);**现场核实 `ps -p 8635` 无此进程** —— 锁记录已失效(stale lock)。判断:【要 founder 批】,内容零风险但 lock 语义存疑,建议先 `git worktree unlock` 前确认无 Claude Code 会话仍引用该目录,而非本次直接处理 |
| `~/Desktop/FIKIRTIVE/.claude/worktrees/fikirtive-orchestrator-handoff-1ec82f` | `claude/fikirtive-orchestrator-handoff-1ec82f` | 0 | 无匹配 PR;ahead=0 behind=13(纯 main 祖先,无独有内容) | 【安全删】干净+无独有提交 |
| `~/Desktop/FIKIRTIVE/.claude/worktrees/orchestration-0383dd`(本次审计运行所在 worktree) | `claude/orchestration-0383dd` | 0 | 无匹配 PR;ahead=0 behind=0(=origin/main) | 【禁删】当前活跃会话正在使用,勿动 |
| `~/Desktop/FIKIRTIVE/.claude/worktrees/orchestration-skill-setup-1312a5` | `claude/orchestration-skill-setup-1312a5` | 0 | 无匹配 PR;ahead=0 behind=7 | 【要 founder 批】——ORCHESTRATOR-STATE.md 记载"新控制面"session 曾在此运行(`3e104495-…`);语义上是控制面历史記录,建议 founder 确认该控制面 session 已彻底交接完毕再清 |
| `~/Desktop/FIKIRTIVE/.claude/worktrees/sad-zhukovsky-33bdaf` | `claude/serene-swartz-e3fc34` | 0 | 无匹配 PR(open/closed/merged 均无);ahead=14 behind=30 | 【要 founder 批】——有 14 个未合并到 main 的提交且无 PR,可能是进行中但尚未发 PR 的工作,不确定是否废弃 |
| `~/Desktop/FIKIRTIVE/.claude/worktrees/serene-swartz-e3fc34` | detached,同 SHA `a53c244f`(与上一行同一分支同一提交) | 0 | 同上 | 同上【要 founder 批】——与 `sad-zhukovsky-33bdaf` 疑似同一份工作的两个副本(重复 worktree),建议先问 founder 哪个是"活的",再考虑合并/清理 |

## 二、`git branch -a` 全量(108 条 local+remote refs,已按 headRefName 与 `gh pr list --state all --limit 200` 交叉核对)

### 已并入 main、无独有内容,PR 记录为 MERGED 或 ahead=0(【安全删】—— 分支引用本身,不涉及上面提到的 worktree 磁盘清理,两者要分开执行)

约 60+ 条历史功能分支(`claude/blueprint-v2.5~2.11`、`claude/design-*`、`claude/l0-measurement-primitives`、`claude/l1-*`(mime-byte-verification/schedule-media-validation/unconfirmed-guard/media-contract-redtest)、`claude/otto-silent-failure-fix`、`claude/ledger-batch-20260711`、`claude/governance-docs-to-main`、`claude/r5-two-brain-archive`、`claude/verdicts-2026-07-11`、`claude/leader-playbook-verdicts`、`claude/whatpass-v2-candidates`、`claude/masterplan-lighting-v2`、`claude/d8-capability-truth`、`claude/doctrine-sol-elevation`、`claude/orchestration-skill-merge`、`codex/orchestrator-handoff`、`codex/admin-dashboard-v2`、`codex/auth-session-gate-test`、`codex/research-queue-safety`、`codex/nav-new-campaign-guard-20260705`、`codex/eslint-sweep-20260710`、`fix/ops-legal-baseline` 等)——`gh pr list --state all` 逐条核对均为 `MERGED`,可安全 `git branch -d`(local)/ 让 GitHub 侧删除已合并的 remote 分支。origin 侧同名分支(`origin/claude/...`)是同一批,一并处理。

**22 条 `worktree-agent-*` 快照分支**:逐条核实 `ahead=0`(全部,和之前审计的发现一致),behind 从 30~51 不等,内容是历史某时点的 main 快照,无独有提交。【安全删】,可批量 `git branch -d`。

### 活跃、有开放 PR(【禁删】)

| 分支 | PR | 状态 |
|---|---|---|
| `claude/research-sanitize-error` | #237 | OPEN,MERGEABLE(FIK-2 相关) |
| `claude/aprime-slice1-shell` | #236 | OPEN,MERGEABLE(FIK-1 aprime) |
| `claude/northstar-immersive` | #203 | OPEN,mergeable=UNKNOWN(与 main 有 16/122 分叉,CONFLICTING 记录见 ORCHESTRATOR-STATE.md) |
| `claude/northstar-city-v1` | #202 | OPEN,mergeable=UNKNOWN |

### 有独有内容但无 PR、或 PR 已 CLOSED(未合并)—— 需 founder 定夺(【要 founder 批】)

| 分支 | ahead/behind | PR | 备注 |
|---|---|---|---|
| `claude/otto-kb-citation-followup` | ahead=17 behind=120 | 无 | 17 个提交无 PR 记录,建议先确认是否已被其他分支吸收 |
| `claude/otto-url-build` | ahead=1 behind=119 | 无 | 单提交,长期无 PR,可能废弃但未经证实 |
| `ns-account-work` | ahead=11 behind=30 | 无 | 与北极星系列(northstar-city-v1 同源 SHA 系)相关,未核实是否为 #202 的重复副本 |
| `nsc-account-work` | ahead=7 behind=30(SHA `8b669c9a`,与 `claude/nsi-work`、`claude/northstar-city-v1` 同 commit) | 无(但内容疑似与 PR #202 相同提交) | 可能是 #202 分支的别名/旧名,需人工确认后再决定是否删除 |
| `claude/nsi-work` | 同上,同 SHA `8b669c9a` | 无 | 同上 |
| `claude/l1b-publish-worker` | ahead=2 behind=14 | PR #220 CLOSED(未合,已被 #227 合并版取代) | 内容已被 `claude/l1-publish-consolidated`(#227,MERGED)取代,大概率可安全删,但保险起见仍标要批 |
| `claude/serene-swartz-e3fc34` | ahead=14 behind=30 | 无 | 见上方 worktree 表,双 worktree 检出同一分支 |
| `claude/confident-kapitsa-f2a22b` | ahead=0 behind=53 | 无 | ahead=0 无独有内容,可考虑归入"安全删"一类,但因无 PR 记录解释其存在原因,列为 Unknown |
| `claude/funny-proskuriakova-963366` / `claude/nice-lamarr-02b471` / `claude/relaxed-chaplygin-17e7bc`(三者同 SHA `2688c313`) | ahead=0 behind=28 | 无 | 三个不同分支名指向同一提交,疑似同一次工作的多个别名快照;ahead=0 无独有内容,风险低,但用途不明,列 Unknown |

### 特殊/基线引用(非功能分支,判断从略)

`main`(本地 ahead=0 behind=7,落后 origin/main 7 个提交——本地陈旧引用,无风险,可 `git fetch --prune` 后自然对齐,不需要单独清理)、`main-health`、`origin`、`origin/main`。

## 三、建议清理清单(汇总,风险级已标注;本 worker 不执行任何一项)

1. 【安全删】5 条 prunable 幽灵 worktree 记录(`wt-inbox-opus`/`wt-l1gate4`/`wt-ship`/`wt-d8-truth`/`wt-governance`)—— `git worktree prune`,目录已不存在,零数据风险。
2. 【安全删】`wt-doctrine`、`wt-merge-skill`、`wt-d2-unconfirmed`、`fikirtive-orchestrator-handoff-1ec82f` 四个 worktree 工作副本——分支已 MERGED 或与 origin/main 完全一致、dirty=0,可 `git worktree remove`。
3. 【安全删】`artlio-auth-session-gate-test`、`artlio-research-queue-safety` 两个 Codex worktree——分支已 MERGED、dirty=0。
4. 【安全删】约 60+ 条已 MERGED 的历史分支引用(local+remote,含 blueprint/design/l0/l1/verdicts 系列)+ 22 条 `worktree-agent-*` 快照分支——`git branch -d`,内容已在 main。
5. 【要 founder 批】5 个 Codex 空白 detached worktree(`13d2`/`1ef9`/`33ed`/`56de`/`6715`,同一祖先 commit,dirty=0)——内容零风险,但由 Codex CLI 自动管理,删前建议先确认 Codex 内部索引是否仍引用。
6. 【要 founder 批】`1850`(`codex/orchestrator-handoff`,PR #228 已 MERGED)——涉及"控制权交接"文档记录的分支,建议留痕确认后再删。
7. 【要 founder 批】`orchestration-skill-setup-1312a5` worktree——ORCHESTRATOR-STATE.md 记载的"新控制面"session 曾在此运行,先确认交接完全落地。
8. 【要 founder 批】`agent-ad23af9ec48f0b508` worktree——`locked` 标记的 pid 8635 已不存在(stale lock),需先 `git worktree unlock` 前确认无会话仍引用。
9. 【要 founder 批】`d629/artlio`(253MB)——现场 dirty=0,但与内部记忆"待抢救/钱路相邻 diff"矛盾,先向 founder 核实该 diff 是否已落盘别处。
10. 【要 founder 批】`sad-zhukovsky-33bdaf` / `serene-swartz-e3fc34` 两个 worktree(同一分支 `claude/serene-swartz-e3fc34`,14 个未合并提交、无 PR)——疑似重复副本,需确认哪个是活跃工作。
11. 【要 founder 批】分支 `claude/otto-kb-citation-followup`(17 commits 无 PR)、`claude/otto-url-build`、`ns-account-work`/`nsc-account-work`/`claude/nsi-work`(疑似 #202 别名)、`claude/l1b-publish-worker`(已被 #227 取代)——逐条需人工确认后再删。
12. 【禁删】ORCHESTRATOR-STATE.md 列明的 7 个受保护 dirty worktree、4 个 OPEN PR 对应分支(#203/#202/#236/#237)、本次审计所在的 `orchestration-0383dd` worktree——一律不动。

## 四、Red flags

1. **Stale lock**:`agent-ad23af9ec48f0b508` worktree 被 `git worktree list` 标记 `locked`(声称 claude agent pid 8635,2026-07-07 07:04 启动),但现场 `ps -p 8635` 查无此进程——锁记录已失效超过 4 天,可能误导后续 agent 认为该目录仍被占用。
2. **记忆 vs 现场矛盾**:内部记忆(2026-07-10)记载 `d629` 是"238MB 原型/钱路相邻 diff,待抢救",但本次现场核实该 worktree `git status --short` 为 0(完全干净),且分支无任何未合并到 main 的独有提交(ahead=0)——需向 founder 核实此前提及的"diff"是否已提取或已在别处落盘,不能假设记忆过期而直接判定安全。
3. **重复 worktree**:`sad-zhukovsky-33bdaf` 与 `serene-swartz-e3fc34` 两个独立 worktree 目录检出同一提交(`a53c244f`,分支 `claude/serene-swartz-e3fc34`),后者还是 detached 而非直接在分支上——两份磁盘拷贝维护同一份未发 PR 的工作,增加维护面。
4. **`main` 本地引用落后 origin/main 7 个提交**——不影响 origin/main 权威性,但如果有工具/脚本引用本地 `main` 分支名(而非 `origin/main`)做基线判断,会读到过期基线。
5. **`.orchestration` 目录审计并发**:同目录下已有 M2/M3/M4/M5 分片文件,说明多个盘点 worker 并行写入同一目录——本文件仅新增 M1,未触碰其余分片。

## 五、Unknowns

- `claude/l1b-publish-worker` 是否已被 #227 完全吸收(未逐提交 diff 比对,只看了标题相关性)。
- `ns-account-work` / `nsc-account-work` / `claude/nsi-work` 与 `claude/northstar-city-v1`(#202)的确切关系(同 SHA 系列但分支名不同,未查具体是否为同一人工作的重命名历史)。
- `codex/fikirtive-dashboard-uiux`(`d629/artlio`)此前记忆所指的"钱路相邻 diff"具体内容/是否已迁移,本次只能确认现场目录当下干净。
- Codex CLI 是否有自己的 worktree 生命周期管理(例如复用 `13d2`/`1ef9`/`33ed`/`56de`/`6715` 这批空白 detached 目录),删除前未与 Codex 侧确认。
- `git branch -a` 108 条中,除本文重点核对的 ~50 条外,其余已 MERGED 系列分支未逐条列出完整清单(篇幅所限,已在"安全删"分类中按类别汇总,未列出全部具体分支名——如需精确批量删除脚本,需另行导出完整名单)。
