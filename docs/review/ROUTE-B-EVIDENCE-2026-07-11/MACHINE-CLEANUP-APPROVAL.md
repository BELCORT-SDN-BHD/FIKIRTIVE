# 电脑清理批准清单(2026-07-11 深夜盘点,5 路只读扫描)

> **Founder 三答(2026-07-11 深夜)**:①第一组批全清 → **已执行完毕**(~8.3GB 释放,详见 machine-audit/CLEANUP-EXECUTION-LOG.md;artlio-* 两个 .git 异常 worktree 降级第二组);②fal.ai 弃用 → 本机明文 key 条目**已删**+文件收权限;**遗留:Railway FAL_KEY 移除 + fal 后台吊销(生产侧,待办)**;③~/Documents/FIKIRTIVE website 三副本 = **codex 侧项目,移出本次范围**(其 dev server/ChatGPT kernel 进程一并不动)。
> 第二组(逐项)未动,待后续;Cloudflare 轮换仍挂 D5。

> 依据:`.orchestration/machine-audit/M1-M5`(全部带命令级证据)。**未获批前一件不动。**
> 分四组:第一组一句话可批;第二组逐项;第三组安全加固;第四组我们自己的交接义务。

## 第一组 · 纯垃圾/已入库副本(批一次全清,预计释放 ~15GB+)

| 项 | 大小 | 证据 |
|---|---|---|
| 5 条幽灵 worktree 记录(目录已不存在,只剩 git 登记) | 0 | M1;`git worktree prune` 即可 |
| ~80 条已并入 main 的历史分支 + 22 条 agent 快照分支 | 0 | M1;内容全在 main |
| 已并入 main 且干净的 worktree 目录(handoff-1ec82f、1312a5 本体、wt-doctrine/wt-merge-skill/wt-d2-unconfirmed、2 个 artlio-* codex worktree) | ~90M | M1/M3;分支 MERGED+dirty=0 |
| `~/Desktop/FIKIRTIVE/demo-remotion/`(#150 已从 git 删除的旧渲染产物残留) | 533M | M5;`git ls-files` 0 跟踪文件 |
| 全部重复 node_modules(可随时 pnpm 重装) | ≥13G | M3 |
| n8n 容器(8 个月没用)、salvador-minio-init(一次性任务已完成) | — | M2 |
| 空 .data/ 目录 ×2、.env.example 模板副本 ×13、err.log | ~0 | M4/M5 |

## 第二组 · 有内容/不确定,逐项点头

1. **⚠️ 最脆弱资产:`~/Documents/FIKIRTIVE website` 三份副本(929M+888M+905M)**——这个仓库**没有远端备份**,是唯一本地副本,三份工作树各有互不相同的未提交改动;其中一份还跑着活 dev server,旁边挂着两个 22+ 小时的 ChatGPT computer-use 会话。**建议:先推一个远端备份,再人工合并三份,最后清重复。删任何一份之前必须先备份。**
2. `d629/artlio`(253M,git 断链孤儿)——疑似已完整抢救到 Desktop 的 RESCUE 档案(249M),但旧记忆称含"钱路相邻 diff";需内容核对一致后才删。
3. 4 个有未提交改动的 codex worktrees(24a1=canvas/Otto 资产、a620=audits、b5ec=outputs、dec1=16 个删除态)——逐个确认吸收后处置。
4. `sad-zhukovsky` 与 `serene-swartz` 两份重复 worktree(同 14 个未合 commit,~1.3G)——二选一保留。
5. salvador/artlio 系列停止容器(退出码 255 异常终止)——删前看数据卷。
6. 进程类:10 个重复 context7-mcp(疑似泄漏)、4 个僵尸子进程、2 个空闲 ChatGPT kernel——确认无引用后杀。
7. 无 PR 的未合分支若干(otto-kb-citation-followup 17 commits 等)——逐条确认。
8. 5 个 codex 空白重复 worktree(133M,同 commit)+ 1850(交接档案)+ 1312a5 的 stale lock。

## 第三组 · 安全加固(建议全批,10 秒的事)

1. **新发现(FIK-1 台账没有这条)**:`~/.claude/.mcp.json` **权限 644 且内含明文 fal-ai key**(73 字符真值,非占位符)——本机任何用户可读。建议:`chmod 600` + **轮换这把 fal key**。
2. 主仓三个真实密钥文件(`.env.local`/`apps/web/.env.local`/`packages/db/.env`)权限 644 → 收紧 600。
3. (旧账重提)Cloudflare Global Key 轮换仍等你批(FIK-1 台账 D5)。

## 第四组 · 我们自己的交接义务(告知,不用批)

- **M5 最高优先发现**:本 session 的全部审计证据与决策文档(`.orchestration/`,20 文件)目前**不在 git 里**——交接前整体走一个 PR 入库(决策文档→docs/ops,证据→docs/review 或 docs/evidence),否则下一任 session 拿不到决策依据。列入 handoff 硬性动作。
- 主仓 `.gitignore` 有一行未提交改动(无害),交接时说明。
- 本地 main 引用落后 origin/main 7 commits(工具若读本地 main 会拿旧基线)——由 FIK-1 在 repo sanitise 时处理。
- M2 观察到 FIK-1 的定时脚本(00:04 复核 #236/#237)——正常,勿动。

## 执行纪律
- 第一组批准后由 FIK-2 执行(逐条留 before/after 证据);第二组每项单独确认;涉及 FIK-1 车道的(分支删除、repo 卫生)移交 FIK-1。
- 任何删除前:确认无进程引用 + 内容已在 main/备份中。
