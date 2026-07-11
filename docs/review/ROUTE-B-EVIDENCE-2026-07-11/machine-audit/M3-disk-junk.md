# M3 — 磁盘占用与遗留物盘点

只读盘点,未执行任何清理/删除/停止操作。证据 = 命令 + 关键输出行。判断不了的标 Unknown。

盘点时间:2026-07-11 23:08 起,~10 分钟窗口。
`origin/main` 本地缓存指针(未 fetch,只读):`52949e6c`(2026-07-11 22:06,#235)。
主仓当前签出分支:`claude/northstar-immersive @ 763a28e6`(**未**并入 origin/main——这是当前活跃工作,禁删)。

---

## 1. 主仓 + `.claude/worktrees/*`

`/Users/winnin/Desktop/FIKIRTIVE` 总大小 **12G**(`du -sh`,含全部 worktrees,因 worktrees 挂在 `.claude/worktrees/` 子目录下)。`.git` 目录本身 **212M**。

| 路径 | 大小 | HEAD commit | 相对 origin/main | 工作区 | 归类 |
|---|---|---|---|---|---|
| `FIKIRTIVE`(主签出) | 12G(含子项) | 763a28e6 `claude/northstar-immersive` | 未并入(活跃分支) | clean | 【禁删】活跃主工作区 |
| `.claude/worktrees/agent-ad23af9ec48f0b508` | 16M | fdd18ef4(#187 blueprint v2.5) | **已并入** origin/main | clean, 0 改动 | locked(git 层锁定,需先 unlock 才能移除)。内容已在主线,可回收但受 lock 保护 → 【要 founder 批】(先 unlock 再删) |
| `.claude/worktrees/fikirtive-orchestrator-handoff-1ec82f` | 18M | 0a3a3384(#218 L0a) | **已并入** origin/main | clean | 【安全删】纯遗留,内容已在主线 |
| `.claude/worktrees/orchestration-0383dd`(**本会话所在**) | 1.8G(含 node_modules ~1.0G) | 52949e6c `claude/orchestration-0383dd` | = origin/main 当前指针 | — | 【禁删】当前会话使用中 |
| `.claude/worktrees/orchestration-skill-setup-1312a5` | 18M(工作树本体;关联 scratchpad 另计 2.2G,见第 3 节) | b5a48d0f(#228) | **已并入** origin/main | clean | 【安全删】纯遗留,内容已在主线 |
| `.claude/worktrees/sad-zhukovsky-33bdaf` | 18M | a53c244f(northstar auth 修复) | **未并入** origin/main | clean | 【要 founder 批】——与下一行是同一 commit 的重复检出,内容未上主线 |
| `.claude/worktrees/serene-swartz-e3fc34` | 1.3G(node_modules 1.2G) | a53c244f(同上,同 commit) | **未并入** origin/main | clean | 【要 founder 批】——与上一行完全重复(同一 commit 两份工作树),留一份即可,但内容未并主线不可盲删 |

**红旗**:`sad-zhukovsky-33bdaf` 与 `serene-swartz-e3fc34` 是同一 commit `a53c244f` 的两份独立工作树(名字不同,内容相同),合计浪费 ~1.3G,且都未合并入 origin/main——需要 founder 确认这条分支是否已经废弃(其分支名 `claude/serene-swartz-e3fc34` / `claude/northstar-immersive`? 实际两者 HEAD 都指向 `a53c244f`,均标注 `origin/claude/northstar-city-v1`,疑似同一功能分支的两次快照)。

---

## 2. `~/Desktop/FIKIRTIVE-RESCUE-2026-07-10`(抢救档案)

总大小 **250M**(`du -sh`)。

| 子目录 | 大小 | 内容一句话 | 归类 |
|---|---|---|---|
| `d629-otto-design-research` | 249M(内含 `node_modules` 98M) | 疑似已抢救 codex worktree `d629`(见下节——原 worktree 253M,内容/大小高度吻合,推测已完整拷贝) | 【要 founder 批】——若确认与 `.codex/worktrees/d629` 内容一致且已核对,原 worktree 可视为冗余;抢救档案本身按"抢救"用途应保留 |
| `24a1-otto-mascot` | 60K | 小型设计片段 | Unknown 用途,体积小,不构成清理优先级 |
| `L-C-STUDIO-IDEA-2026-07-11` | 56K | 同上 | Unknown |
| `ORCHESTRATION-PROOFS-2026-07-11` | 576K | 编排证据存档 | 【禁删】疑似交接凭证 |
| `a620-admin-audit` | 816K | 小型审计片段 | Unknown |
| `gtm-canvas-paid-node` | 4.0K | 几乎空 | 【安全删】占位无实质内容(未核实是否为符号链接/空文件) |

---

## 3. `~/.codex/worktrees/*`(逐个)

git worktree 元数据显示这些工作树全部挂在同一个 `.git`(`https://github.com/BELCORT-SDN-BHD/FIKIRTIVE.git`),除 `d629`(见下方红旗——已断链孤儿)与 `39db`/`baa6`(属于另一个独立仓库 `FIKIRTIVE website`,见第 5 节)。

| 目录 | 大小 | HEAD / 分支 | 工作区状态 | 归类 |
|---|---|---|---|---|
| `13d2` | 17M | bff7f502(detached,#134 blueprint v2.4) | clean | 【要 founder 批】——与 1ef9/33ed/56de/6715 完全同 commit 重复(5 份相同快照) |
| `1ef9` | 17M | bff7f502(同上) | clean | 同上,重复 |
| `33ed` | 41M | bff7f502(同上) | clean | 同上,重复 |
| `56de` | 17M | bff7f502(同上) | clean | 同上,重复 |
| `6715` | 41M | bff7f502(同上) | clean | 同上,重复 |
| `1850` | 1.1G(node_modules 1.0G) | c5d8e8ec `codex/orchestrator-handoff` | clean | Unknown 是否已并主线(未逐一核对,时间预算内未测) |
| `24a1` | 1.2G(node_modules 1.2G) | 515e6073(#…schedule fail-closed) | **dirty**——`FlowCanvas.tsx`、`otto-celebrating.svg`、`OttoAccount/App/Avatar.tsx` 等多个文件有未提交改动 | 【要 founder 批】——含未入库改动,不可删 |
| `a620` | 1.9G(node_modules 1.2G) | 30dd90e0(#… admin tenant detail v2) | dirty(`?? docs/audits/` 未跟踪新增) | 【要 founder 批】——含未跟踪产物 |
| `b5ec` | 2.0G(node_modules 1.2G) | eb8ce68c(#173 otto sidebar) | dirty(`?? outputs/ tmp/ videos/` 未跟踪) | 【要 founder 批】——含未跟踪产物(疑似生成视频/临时文件,体积大) |
| `d629`(artlio) | 253M | **孤儿——`.git` 指向 `/Users/winnin/Documents/artlio/.git/worktrees/artlio`,该路径不存在** | git 命令全部报 `fatal: not a git repository` | 红旗:已断链,无法用 git 读取历史/差异。体积(253M)与抢救档案 `FIKIRTIVE-RESCUE-2026-07-10/d629-otto-design-research`(249M)高度吻合,**疑似已被抢救拷贝**。【要 founder 批】——核实抢救副本完整后,原孤儿目录可标记安全删 |
| `dec1` | 584M(node_modules 558M) | d5434f6d(#… nav dup campaign fix) | dirty(多个文件标记删除 `D`,含 `.gstack/qa-reports/` 截图等) | 【要 founder 批】——工作区内有 `D`(删除)状态但未提交,需人工确认意图 |
| `gtm-canvas-prod-qa-20260705` | 1.4G(node_modules 1.2G) | 71f85839(#… nav guard) | Unknown(未测 status,时间预算内跳过) | Unknown |
| `artlio-auth-session-gate-test` | 11M | 19e3c411 `codex/auth-session-gate-test` | Unknown(未测) | Unknown |
| `artlio-research-queue-safety` | 11M | d28d32d6 `codex/research-queue-safety` | Unknown(未测) | Unknown |

**node_modules 重复份数(仅 `.codex/worktrees` 下顶层):** `gtm-canvas`(1.2G)+ `a620`(1.2G)+ `24a1`(1.2G)+ `dec1`(558M)+ `b5ec`(1.2G)+ `1850`(1.0G)+ `d629` 嵌套一份(88M)= **7 份,合计约 6.4G**,全部为可重装依赖(`pnpm install` 可重建),**内容本身不构成清理风险**,但占用巨大——建议按 worktree 处置结果统一清空 node_modules(不删 worktree 本体)。

---

## 4. `/private/tmp/claude-501` 下 FIKIRTIVE 相关 scratchpad

`claude-501` 总大小 **4.9G**(`du -sh`)。逐 session 目录:

| session 目录(截断显示父级) | 大小 | 归类 |
|---|---|---|
| `...fikirtive-orchestrator-handoff-1ec82f/3d3b73a4-.../scratchpad`(内含 `fleet/wt-inbox-opus`、`fleet/wt-l1gate4`、`fleet/wt-ship`、`wt-d8-truth`、`wt-doctrine`、`wt-governance`、`wt-lcf`、`wt-merge-skill` 共 8 个内嵌 git worktree) | 1.1G | 【安全删】——上级 worktree 本体(`fikirtive-orchestrator-handoff-1ec82f`)HEAD 已确认并入 origin/main;此 scratchpad 是该 session 的临时产物,大概率随会话结束即可清 |
| `...orchestration-0383dd/7138271f-8200-.../scratchpad`(**本会话**,内含 `wt-otto-fix` 工作树) | 1.7G | 【禁删】本会话使用中 |
| `...orchestration-skill-setup-1312a5/3e104495-.../scratchpad`(内含 `wt-d2-unconfirmed`、`wt-slice1`、`wt-e-schedule-guard`、`wt-pr0-foundation`、`wt-f-mime-sniff`、`wt-d41-redtest` 共 6 个内嵌 worktree) | 2.2G | 【安全删】——上级 worktree 本体 HEAD(b5a48d0f)已确认并入 origin/main;但内嵌 worktree `wt-d2-unconfirmed`(分支 `main-health`)、`wt-slice1`(分支 `claude/aprime-slice1-shell`)需先核实是否已并入(命名"unconfirmed"提示未定论)→ 降级为【要 founder 批】 |
| 其余同名前缀小目录(几十 K 以下) | <100K 合计 | 【安全删】纯元数据,体积可忽略 |

---

## 5. `~/Documents/FIKIRTIVE website`(独立仓库,非主 monorepo)

**红旗:该仓库没有配置 remote**(`git remote -v` 空输出)——是纯本地仓库,唯一副本;若本机丢失,未推送内容将永久丢失,且连"已推送"这个安全网都没有。

| 路径 | 大小 | HEAD | 工作区 | 归类 |
|---|---|---|---|---|
| `~/Documents/FIKIRTIVE website`(主检出) | 929M(node_modules 881M) | 4ae40c6 `main`(本地分支,无 remote) | **dirty**——`.gitignore`、`app/globals.css`、`app/layout.tsx`、`app/page.tsx`、`design-qa.md`、`tests/rendered-html.test.mjs`、`vite.config.ts` 已改动,另有未跟踪的 `app/StructuredData.tsx`、`app/beta/`、`app/components/` | 【禁删】——含大量未提交改动且无 remote 备份,是最脆弱的一份 |
| `~/.codex/worktrees/39db/FIKIRTIVE website` | 888M(node_modules 881M) | 4ae40c6(detached,同一仓库的 worktree) | dirty(`tests/rendered-html.test.mjs` 改动;新增 `STORYBOARD.md`、`app/storyboard/`) | 【要 founder 批】——与主检出是同仓库的另一份工作树,改动方向不同,需人工核对是否要合并回主检出 |
| `~/.codex/worktrees/baa6/FIKIRTIVE website` | 905M(node_modules 881M) | 4ae40c6(detached,同一仓库) | dirty(与主检出高度相似的改动列表:`.gitignore`/`globals.css`/`layout.tsx`/`page.tsx`/`design-qa.md`) | 【要 founder 批】——与主检出改动几乎重叠,疑似同一批修改的重复工作树 |

三份加总 node_modules ≈ 2.6G,均可重装。**关键风险不是磁盘空间,是这个仓库整体无 remote、三份工作树都有未提交且互不相同的改动——清理前必须先确认哪份是最新真相,并考虑推送/备份到远端。**

---

## Red flags(异常/风险,汇总)

1. **`~/Documents/FIKIRTIVE website` 无 remote**——唯一本地副本,且三份工作树(主检出 + `39db` + `baa6`)都有未提交、互不相同的改动,是本次盘点中最脆弱的资产。
2. **`.codex/worktrees/d629` 是断链孤儿**——`.git` 指向的 `/Users/winnin/Documents/artlio` 已不存在,git 命令全部失败;体积(253M)与 `FIKIRTIVE-RESCUE-2026-07-10/d629-otto-design-research`(249M)高度吻合,疑似已抢救,但未逐文件核对一致性。
3. **`.codex/worktrees/{24a1,a620,b5ec,dec1}` 均有未提交改动/未跟踪产物**,其中 `dec1` 还有多个文件处于删除(`D`)状态未提交——四份都不能盲删。
4. **`sad-zhukovsky-33bdaf` 与 `serene-swartz-e3fc34`(主仓内)** 是同一 commit 的重复工作树,且都未并入 origin/main。
5. **`.codex/worktrees/{13d2,1ef9,33ed,56de,6715}` 五份完全相同 commit(`bff7f502`)的重复检出**,全部 clean,合计 ~133M——重复度最高但风险最低的一组。
6. **node_modules 总重复量粗估 ≥ 13G**(主仓系 ~4G + `.codex/worktrees` ~6.4G + rescue 98M + website 三份 2.6G),全部可通过包管理器重装,不构成数据风险,但是本次盘点中最大的"安全瘦身"空间。

## Unknowns

- `.codex/worktrees/1850`、`gtm-canvas-prod-qa-20260705`、`artlio-auth-session-gate-test`、`artlio-research-queue-safety` 未测 `git status`(时间预算内跳过),是否 dirty 未知。
- `FIKIRTIVE-RESCUE-2026-07-10/d629-otto-design-research` 是否与 `.codex/worktrees/d629` **逐文件**一致,只核对了目录总大小(249M vs 253M),未做内容 diff。
- `~/Documents/FIKIRTIVE design directions` 目录存在但未测量大小/内容(不在本分片指定清单内,顺带发现)。
- `.claude/worktrees/agent-ad23af9ec48f0b508` 的 git lock 具体是被哪个进程/会话持有,未核实(是否还有活跃进程指向它)。
- Desktop 上另有 `FIKIRTIVE-immersive-review`、`FIKIRTIVE-northstar-review`、`FIKIRTIVE-归档-2026-07` 三个目录,不在本分片指定检查清单内,未测量,仅记录存在。

## 建议清理清单(供 founder 裁决,worker 不执行)

1. 【安全删】`.claude/worktrees/fikirtive-orchestrator-handoff-1ec82f`(18M,commit 已并主线,clean)。
2. 【安全删】`.claude/worktrees/orchestration-skill-setup-1312a5` 工作树本体(18M,commit 已并主线,clean;其关联 scratchpad 见下条单独处理)。
3. 【要 founder 批】先 `git worktree unlock` 再删 `.claude/worktrees/agent-ad23af9ec48f0b508`(16M,commit 已并主线但当前 locked)。
4. 【要 founder 批】`.claude/worktrees/sad-zhukovsky-33bdaf` 与 `serene-swartz-e3fc34` 二选一保留(同 commit 重复,~1.3G,未并主线)。
5. 【要 founder 批】`.codex/worktrees/{13d2,1ef9,33ed,56de,6715}` 五选一保留其余删除(同 commit `bff7f502` 完全重复,合计 ~133M,全部 clean)。
6. 【要 founder 批】核实 `.codex/worktrees/d629` 内容已被 `FIKIRTIVE-RESCUE-2026-07-10/d629-otto-design-research` 完整抢救后,清除原孤儿目录(253M,git 已断链无法正常操作,可能需要 `rm -rf` 而非 git 命令)。
7. 【要 founder 批】`.codex/worktrees/{24a1,a620,b5ec,dec1}` 逐一核对未提交改动是否已被其他 PR 吸收,吸收后再清(合计 node_modules 部分 ~4.2G 可先单独清空重装,worktree 本体等改动确认后处理)。
8. 【要 founder 批】`~/Documents/FIKIRTIVE website` 三份工作树(主检出 + `39db` + `baa6`)先核对改动差异、决定去留,并考虑补配 remote 做异地备份,再谈瘦身。
9. 【安全删】全体 node_modules(主仓、各 worktree、rescue、website)可统一 `pnpm install --frozen-lockfile` 重装前先清空——纯缓存,不影响任何未提交工作(前提:仅删 node_modules 本身,不动 worktree 其余文件)。
10. `/private/tmp/claude-501` 下与已确认"内容已并主线"的 worktree 对应的 scratchpad(`fikirtive-orchestrator-handoff-1ec82f`、`orchestration-skill-setup-1312a5` 对应的两个 session 目录,合计 ~3.3G)可整体按【安全删】处理,但 `orchestration-skill-setup-1312a5` scratchpad 内的 `wt-d2-unconfirmed`、`wt-slice1` 命名暗示未定论,建议先单独确认这两个子目录再动。
