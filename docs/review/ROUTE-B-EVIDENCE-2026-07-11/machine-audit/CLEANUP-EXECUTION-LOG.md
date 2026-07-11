# 第一组清理执行日志(2026-07-11 深夜,founder 已批)

## 1. git worktree prune(幽灵记录)
Removing worktrees/wt-inbox-opus: gitdir file points to non-existent location
Removing worktrees/wt-d8-truth: gitdir file points to non-existent location
Removing worktrees/wt-governance: gitdir file points to non-existent location
Removing worktrees/wt-ship: gitdir file points to non-existent location
Removing worktrees/wt-l1gate4: gitdir file points to non-existent location
worktree 数 32 → 27

## 2. 已合入且干净的 worktree 移除(逐个复验)
已删(clean,tip 0a3a3384d375e3ebd3c44b9466f2ea1fbd63d086 在 main 内): /Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/fikirtive-orchestrator-handoff-1ec82f
拒删(tip 不在 main): /private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-fikirtive-orchestrator-handoff-1ec82f/3d3b73a4-6c32-45a3-a845-4185acfb7d1d/scratchpad/wt-doctrine
拒删(tip 不在 main): /private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-fikirtive-orchestrator-handoff-1ec82f/3d3b73a4-6c32-45a3-a845-4185acfb7d1d/scratchpad/wt-merge-skill
拒删(tip 不在 main): /Users/winnin/.codex/worktrees/artlio-auth-session-gate-test
拒删(tip 不在 main): /Users/winnin/.codex/worktrees/artlio-research-queue-safety
--- 确认 FIK-1 名下未动 ---
1312a5 在(FIK-1 live,未动)✅

## 2b. squash 合并分支的正确复验(PR=MERGED + dirty=0)
已删(claude/doctrine-sol-elevation → PR #226 MERGED,dirty=0): /private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-fikirtive-orchestrator-handoff-1ec82f/3d3b73a4-6c32-45a3-a845-4185acfb7d1d/scratchpad/wt-doctrine
已删(claude/orchestration-skill-merge → PR #225 MERGED,dirty=0): /private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-fikirtive-orchestrator-handoff-1ec82f/3d3b73a4-6c32-45a3-a845-4185acfb7d1d/scratchpad/wt-merge-skill
删除失败: /Users/winnin/.codex/worktrees/artlio-auth-session-gate-test
删除失败: /Users/winnin/.codex/worktrees/artlio-research-queue-safety
剩余 worktree 数: 24

## 2c. artlio-* 两个 worktree .git 结构异常 → 降级第二组,不强删
## 3. 主仓残留(demo-remotion 533M + err.log)
533M	demo-remotion
已删 demo-remotion(tracked=0,#150 已从 git 删)
已删 err.log(44B)

## 4. 死容器
已删容器 n8n(状态 exited,卷未动)
已删容器 salvador-minio-init-1(状态 exited,卷未动)

## 5. 空 .data 目录
跳过 /Users/winnin/Desktop/FIKIRTIVE/.data(不存在或非空)
已删空目录 /Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/serene-swartz-e3fc34/.data
 M .gitignore
?? .codex/

## 6. 已并入分支批量删除(git branch --merged origin/main,自动排除 checked-out)
候选(祖先型): 26
  跳过(git 拒绝): claude/fikirtive-orchestrator-handoff-1ec82f
  跳过(git 拒绝): claude/funny-proskuriakova-963366
  跳过(git 拒绝): claude/nice-lamarr-02b471
  跳过(git 拒绝): claude/relaxed-chaplygin-17e7bc
本地分支数 73 → 51(squash 型未动,留 FIK-1 repo sanitise 逐条核)

## 7. node_modules 清理(website=范围外;d629=第二组;我方活跃 worktree 与 FIK-1 的保留)
已删 1222M: /Users/winnin/Desktop/FIKIRTIVE/node_modules
已删 1245M: /Users/winnin/.codex/worktrees/24a1/FIKIRTIVE/node_modules
已删 1202M: /Users/winnin/.codex/worktrees/a620/FIKIRTIVE/node_modules
已删 1222M: /Users/winnin/.codex/worktrees/b5ec/FIKIRTIVE/node_modules
已删 559M: /Users/winnin/.codex/worktrees/dec1/FIKIRTIVE/node_modules
已删 1046M: /Users/winnin/.codex/worktrees/1850/FIKIRTIVE/node_modules
已删 1265M: /Users/winnin/.codex/worktrees/gtm-canvas-prod-qa-20260705/node_modules
node_modules 共释放 ~7761M

/dev/disk3s1s1   926Gi    17Gi   436Gi     4%    426k  4.3G    0%   /

## 汇总(第一组完成,2026-07-11 深夜)
- 幽灵 worktree 记录 ×5 已 prune;worktree 32 → 24。
- 已合入干净 worktree 已删 ×3(handoff-1ec82f / wt-doctrine / wt-merge-skill,均复验 PR MERGED + dirty=0)。
- artlio-* 两个 worktree `.git` 结构异常 → 降级第二组,未强删。
- demo-remotion 533M + err.log 已删(tracked=0 复验)。
- 死容器 n8n / salvador-minio-init-1 已删(卷未动)。
- 空 .data ×1 已删(主仓 .data 不存在,跳过)。
- 祖先型已并入分支 22 条已删(73→51;git 拒绝 4 条留 FIK-1;squash 型全部未动,留 FIK-1 repo sanitise)。
- node_modules 释放 ~7.76G(website=范围外未动;d629 整体未动;我方活跃 worktree 与 FIK-1 的保留)。
- **总释放 ~8.3GB。全程零 tracked 文件丢失;FIK-1 名下与受保护 worktree 一律未动。**

## 同批安全动作(founder 已批)
- ~/.claude/.mcp.json:fal-ai 条目已删(唯一条目;备份 .bak-20260711 权限 600 留 7 天);文件收权限 600。
- 主仓三个 .env 密钥文件收权限 644→600。
- 【待 founder/FIK-1,生产侧】fal 既已弃用:Railway worker 的 FAL_KEY env 可移除 + fal.ai 后台吊销该 key(生产动作,非本轮执行)。
