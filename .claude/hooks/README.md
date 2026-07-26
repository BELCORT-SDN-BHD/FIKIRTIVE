# 会话级门锁(harness hooks)

这些脚本由 Claude Code 在工具调用前后执行,注册在 `.claude/settings.json` 的 `hooks` 段。
它们把项目法里几条最容易被"这次就算了"绕过的规矩,交给 harness 执行,而不是靠 session 自律。

| 脚本 | 事件 | 行为 |
| --- | --- | --- |
| `pretooluse-write-guard.sh` | `PreToolUse` / `Edit\|Write\|MultiEdit\|NotebookEdit` | 顶层会话(编排者)写仓库内文件 → 拒;worker → 放行;仓库外路径 → 放行;**载荷里没有 `transcript_path` → 放行** |
| `pretooluse-bash-guard.sh` + `bash-guard.mjs` | `PreToolUse` / `Bash` | 推 main(含裸 `git push`、`git push origin HEAD` 在 main 上)、force push(含 `+refspec`)、`gh pr merge`、`gh api` PUT/POST 合并 PR、改 Blueprint 哈希 → 拒;shell 写 Blueprint/哈希(重定向、`tee`、`sed -i`)→ 拒;编排者用 shell 写仓库内文件 → 拒;其余放行 |
| `session-start-model-evidence.sh` | `SessionStart` | 从载荷读**本会话**转录路径,打印 model 字段核验命令与停线提示 |
| `probe-payload.sh` | 按需临时注册 | 把 hook 收到的原始 JSON 落盘到 `$TMPDIR/fikirtive-hook-probe/`,不拦任何东西 |

## 谁是 worker

两个 guard 用同一条判据:转录文件直接躺在某个 `<session>/subagents/` 目录里
(实测形状 `…/<session-uuid>/subagents/agent-<id>.jsonl`),或文件名以 `agent-` 开头。
只看路径里有没有 `subagents` 这个词是不够的 —— `CLAUDE_CONFIG_DIR=/tmp/subagents/…`
会让顶层会话凭空拿到 worker 的写权限。

## 总开关与例外(必须在启动进程时给,Bash 里 export 无效)

hook 继承的是 **Claude Code CLI 进程**的环境。在 Bash 工具里 `export FIKIRTIVE_HOOKS_OFF=1`
只影响那一次 Bash 调用,hook 根本看不到 —— 逃生口只能在启动时给:

```sh
FIKIRTIVE_HOOKS_OFF=1 claude        # 一律放行(所有脚本第一件事就是查它)
FIKIRTIVE_ORCH_WRITE_OK=1 claude    # 仅解开写锁,给"编排者必须亲手改一行"的紧急情况
FIKIRTIVE_BLUEPRINT_AMEND=1 claude  # 仅在 Founder 的修宪流程里解开 Blueprint 锁
```

会话进行中要解锁,只能退出后按上面的方式重开;没有"这一条命令临时放行"的写法。

## fail-open 是刻意的

payload 解析失败、字段名对不上、`node` 不在 PATH、仓库路径解析失败、**载荷里没有
`transcript_path`** —— 一律 `exit 0` 放行。门锁挡不住的东西还有 CI 与 GitHub ruleset 兜底;
而一个会把整个会话卡死的 hook,第一次误伤之后就会被永久关掉,那才是真正的失守。

这一条对 `transcript_path` 尤其要紧:tier 判据把"不是 worker"读成"是编排者",所以字段一旦
改名,没有这条放行,**全项目每一个 worker 的写入都会被拦死**。宁可锁静默失效,不可全面瘫痪。

## 门锁挡不住什么(别把绿灯当证明)

- `pnpm`、`git apply`、`python`、编辑器等任何不带 `>`/`tee`/`sed -i` 形状的写法,bash guard 看不见。
- `.claude/settings.json` 的 deny 规则只作用于 Edit/Write/MultiEdit/NotebookEdit 工具,管不到 shell;
  Blueprint 的 shell 侧由 bash guard 单独拦一次,两道都在才算齐。
- deny 规则里同时写了 `./docs/BLUEPRINT.md` 与 `**/docs/BLUEPRINT.md` 两种形状:相对路径的解析基准
  (项目根 vs 当前工作目录)没有在本机核实过,两种都写才与基准无关。格式写错的规则会被 harness
  **静默跳过**(只在启动日志里留一句 `Invalid permission rule … was skipped`),所以改这段之后要看一眼启动输出。

## 升级 Claude Code 之后先校准字段名

hook 的 stdin JSON 字段名(`tool_name`、`tool_input.file_path`、`transcript_path`、`cwd`)
随 harness 版本变动。本目录的脚本按 Claude Code 2.1.220 的形状写成,并对未知形状放行——
也就是说,字段名一旦改变,锁会**静默失效**,不会报错。因此每次升级后跑一次校准:

1. 把 `.claude/settings.json` 里某个 `PreToolUse` 的 `command` 临时换成 `probe-payload.sh`;
2. 新开一个会话,随便让它编辑一个文件;
3. 读 `$TMPDIR/fikirtive-hook-probe/` 下最新的 JSON,确认 `tool_input.file_path` 与
   `transcript_path` 仍在原位、worker 转录仍是 `subagents/` 目录下的叶子文件;
4. 字段名若变了,改脚本里对应的读取分支(它们已经同时接受下划线与驼峰两种写法);
5. 把 `command` 换回原脚本,并在 PR 或 issue 里留下这次校准的证据。

`SessionStart` 也要一起校准:它现在从载荷读 `transcript_path`,读不到就明说读不到,
绝不退回"扫目录取最新 .jsonl"——开工那一刻,目录里最新的通常是**上一个**会话。
