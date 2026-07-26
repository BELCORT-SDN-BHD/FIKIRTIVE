# 会话级门锁(harness hooks)

这些脚本由 Claude Code 在工具调用前后执行,注册在 `.claude/settings.json` 的 `hooks` 段。
它们把项目法里几条最容易被"这次就算了"绕过的规矩,交给 harness 执行,而不是靠 session 自律。

| 脚本 | 事件 | 行为 |
| --- | --- | --- |
| `pretooluse-write-guard.sh` | `PreToolUse` / `Edit\|Write\|MultiEdit\|NotebookEdit` | 顶层会话(编排者)写仓库内文件 → 拒;worker(转录路径含 `subagents/`)→ 放行;仓库外路径 → 放行 |
| `pretooluse-bash-guard.sh` | `PreToolUse` / `Bash` | 推 main、force push、`gh pr merge`、改 Blueprint 哈希 → 拒;其余放行 |
| `session-start-model-evidence.sh` | `SessionStart` | 打印本会话转录的 model 字段核验命令与停线提示 |
| `probe-payload.sh` | 按需临时注册 | 把 hook 收到的原始 JSON 落盘到 `$TMPDIR/fikirtive-hook-probe/`,不拦任何东西 |

## 总开关与例外

- `FIKIRTIVE_HOOKS_OFF=1` — 一律放行(所有脚本第一件事就是查它)。
- `FIKIRTIVE_ORCH_WRITE_OK=1` — 仅解开写锁,给"编排者必须亲手改一行"的紧急情况。
- `FIKIRTIVE_BLUEPRINT_AMEND=1` — 仅在 Founder 的修宪流程里解开 Blueprint 哈希锁。

## fail-open 是刻意的

payload 解析失败、字段名对不上、`node` 不在 PATH、仓库路径解析失败 —— 一律 `exit 0` 放行。
门锁挡不住的东西还有 CI 与 GitHub ruleset 兜底;而一个会把整个会话卡死的 hook,
第一次误伤之后就会被永久关掉,那才是真正的失守。

## 升级 Claude Code 之后先校准字段名

hook 的 stdin JSON 字段名(`tool_name`、`tool_input.file_path`、`transcript_path`、`cwd`)
随 harness 版本变动。本目录的脚本按 Claude Code 2.1.220 的形状写成,并对未知形状放行——
也就是说,字段名一旦改变,锁会**静默失效**,不会报错。因此每次升级后跑一次校准:

1. 把 `.claude/settings.json` 里某个 `PreToolUse` 的 `command` 临时换成 `probe-payload.sh`;
2. 新开一个会话,随便让它编辑一个文件;
3. 读 `$TMPDIR/fikirtive-hook-probe/` 下最新的 JSON,确认 `tool_input.file_path` 与
   `transcript_path` 仍在原位、worker 转录路径里仍有 `subagents/` 这一段;
4. 字段名若变了,改脚本里对应的读取分支(它们已经同时接受下划线与驼峰两种写法);
5. 把 `command` 换回原脚本,并在 PR 或 issue 里留下这次校准的证据。
