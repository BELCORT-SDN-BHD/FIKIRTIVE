# M5 — 主仓与文档卫生盘点

范围:仅"电脑上看得见的仓库级杂物"(粗查)。细活归 FIK-1,未越界进入代码/PR 内容审查。
方法:全程只读(`ls`/`du`/`git status --short`/`git log`/`git check-ignore`),未执行任何写入或删除。
时间:2026-07-11。

---

## 1. 主仓 `~/Desktop/FIKIRTIVE`(受保护 dirty worktree,只读确认)

`git status --short`(全量,4 行):

```
 M .gitignore
?? .codex/
?? demo-remotion/
?? err.log
```

| 项 | 证据 | 说明 |
|---|---|---|
| `.gitignore`(modified,未提交) | `git diff .gitignore` 显示新增一行 `.claude/settings.local.json` | 已跟踪文件的未提交改动,只加了一行 ignore 规则,无风险内容,但未提交 |
| `.codex/` (untracked) | `du -sh .codex` → 4.0K;内含 `config.toml` | 本地 Codex CLI 配置,未加入 `.gitignore`,体积小 |
| `demo-remotion/` (untracked) | `du -sh demo-remotion` → **533M**;内含 `node_modules`、`out/`、`.DS_Store` | 见下方专项说明 — 已从 git 历史中彻底删除,现为纯本地遗留 |
| `err.log` (untracked) | 44 字节,1 行:`Preparing worktree (detached HEAD 73facc46)` | 无害的 git worktree 日志残留 |

### `demo-remotion/` 专项(风险点最大的一项)

- `git log --diff-filter=A --oneline -- demo-remotion` → 仅 `c6403c17 chore(demo): Remotion enterprise-demo scaffold + VO script` 添加过。
- `git log --diff-filter=D --oneline -- demo-remotion` → `c27e5c8e chore(cleanup): 删 ~440 行零风险死代码 + 死代码清单 (#150)`,`git show --stat c27e5c8e` 证实该 commit 把 `demo-remotion/` 下全部文件(`package.json`/`src/*`/`package-lock.json` 等)从 git 中移除。
- `git ls-files demo-remotion` → **0 个文件**,即当前完全未被 git 追踪。
- 但磁盘上该目录仍在,且比原始 scaffold 大得多(533M,含完整 `node_modules` 与渲染输出 `out/*.png`)——是本地运行/渲染后留下的构建产物,不在 `.gitignore` 白名单里(`git check-ignore demo-remotion` 无匹配)。
- **结论**:内容已合并清理进 main(#150 已入库),本地目录是纯粹的运行残留,不含未提交的独有工作。

### 已知的 5 个用户文件 + 其他根目录条目(仅列,未改动)

`ls -la` 根目录全量条目见证据;除上述 4 项 diff 外,其余为正常仓库结构(`apps/`、`packages/`、`docs/`、`scripts/`、`node_modules/`、`pnpm-lock.yaml` 等)及已知的 ignore 类目录:

| 目录 | 状态 | `.gitignore` 命中行 |
|---|---|---|
| `.data/` (19M) | 已忽略 | `.data/` |
| `.agents/` (12K) | 已忽略 | `.agents/` |
| `.superpowers/` (800K) | 已忽略 | `.superpowers/` |
| `.claire/` | 已忽略 | `.claire/`(F32 事故留下的防呆规则) |
| `.out-of-scope/` (20K) | 已忽略 | `.out-of-scope/` |
| `.gstack/` (5.4M, `drwx------`) | `.gitignore` 列有 `.gstack/`,但 `git check-ignore` 未直接命中(疑因权限或路径匹配细节,未深挖,不影响结论:未出现在 `git status` 未跟踪列表中) | — |
| `.scratch/` (0B, 空目录) | 未加入 `.gitignore`,但为空目录不会出现在 `git status` | 无 |
| `.prod-session.json` | 已忽略,`.gitignore` 注明"secret, must never be committed" | 仅记录文件名与用途,未读取内容 |

---

## 2. 本 worktree `orchestration-0383dd` 的 `.orchestration/`(= FIK-2 审计档案)

- `du -sh .orchestration` → **248K**,`find -type f | wc -l` → **20 个文件**(顶层 8 个 + `evidence/` 子目录 12 个,`evidence/` 单独 180K)。
- **该目录不在 git 里**:`git check-ignore -v .orchestration` 命中 `.git/info/exclude:19:.orchestration/`(本地 exclude,非提交的 `.gitignore`),`git ls-files .orchestration` → 0 个文件。
- 含义:这是**纯本地**、从未进入任何分支历史的审计/编排工作产物。如果这个 worktree 被丢弃而不打包,内容会永久丢失。

顶层文件清单(字节数):

```
5864   GATE1-DECISION-BRIEF-2026-07-11.md
12026  MATRIX-V0-2026-07-11.md
2660   founder-request-pack.md
2361   matrix-schema.md
7085   P0-WORKORDER-2026-07-11.md
6041   P0-otto-fix-acceptance.md
4262   PATH-TO-MARKET-2026-07-11.md
15665  state.md
```

`evidence/` 子目录(12 个文件,180K):`AF1-users-business.md`、`D-journey-walk-2026-07-11.md`、`E1~E5-*.md`(创作/Otto/钱与租户/发布渠道/分析-L0-鉴权-观测)、`H1-seams.md`、`I1-security-ops.md`、`OM1-offmain.md`、`founder-answers-2026-07-11.md`、`railway-prod-facts-2026-07-11.md`。

### 建议归档判定(交接用)

| 类别 | 建议 | 理由 |
|---|---|---|
| `state.md`、`MATRIX-V0-2026-07-11.md`、`GATE1-DECISION-BRIEF-2026-07-11.md`、`P0-WORKORDER-2026-07-11.md`、`PATH-TO-MARKET-2026-07-11.md` | **应走 PR 正式入库**(建议落 `docs/ops/` 或 `docs/northstar/`,与现有命名习惯一致) | 这些是决策/状态类文档,与 `docs/ops/SESSION-HANDOFF-2026-07-10.md` 同类,交接后若不入库会成为"看不见的真相来源" |
| `evidence/*`(12 个证据文件) | **应走 PR 正式入库**(建议整目录搬进 `docs/review/` 或新建 `docs/evidence/`) | 是本轮决策的一手证据链,founder 交接后如需复核决策依据,必须能在仓库里找到 |
| `founder-request-pack.md`、`matrix-schema.md`、`P0-otto-fix-acceptance.md` | **可留 scratch 或一并入库**(次要,视 founder 是否要保留过程文件而定) | 偏工作过程/模板性质,价值低于上面几份,但体积很小,一并入库成本低 |

**统一结论**:整个 `.orchestration/` 只有 248K,建议路线乙交接前**整体打包成一个 PR**(而非挑挑拣拣),避免遗漏证据链;唯一需要 founder 决定的是落哪个目录路径。

---

## 3. `docs/` 文档卫生粗查

### `origin/main` 最近 20 条 commit(用于判断"计划文档是否散落")

```
52949e6c docs(ops): 状态账 2026-07-11 晚间批次
73ce2d95 fix(otto): 失败回合从持久 data-error part 兜底渲染
647f490f fix(l1): 媒体字节验真
39f1c7db fix(l1): 恢复路径双发窗口
16f2abcf feat(aprime): 地基 PR-0 —— 原型城骨架落 main
8a1c73e8 feat(l1): 排期/批准入口的 IG 媒体校验
64d43701 fix(l1): IG 发布媒体契约守卫
b5a48d0f docs(orchestration): establish Codex-Fable control plane
09cd9060 feat(l1): 发布链合并
720fbd4f docs(orchestration): Sol Ultra 升格为并肩 advisor
f336d50e feat(l1): PR-L1a connection capability layer
ac1c929d refactor(skills): 三合一 orchestration 总手册
3dc41f22 docs(verdicts): founder 六答归档
0a3a3384 feat(l0): PR-L0a 量测原语对象与迁移
c2f6a45a docs(spec): [SPEC] L-C 创作区点亮施工图
8de50a2d docs(spec): L0 量测原语点亮施工图
0461d1a1 docs(spec): [SPEC] L1 发布链点亮施工图
f5da8d0c docs(masterplan): 点亮章 v2
08759711 docs: 三颗平台雷活法判决 + 龙头借鉴书入库
0cdaca4a docs(strategy): R5 双脑归档
```

- 观察:docs 类 commit 占比高(约 45%),命名规范(`docs(ops|orchestration|verdicts|spec|strategy|masterplan)`),均走 PR 合并 —— 符合项目一贯的"决策必须落文档"工作法,**未发现散落/无序**的迹象。这是该项目的正常操作节奏,不构成 red flag。

### `docs/ops`、`docs/northstar`、`docs/review` 顶层文件数与最后修改(仅统计)

| 目录 | 顶层文件数(不含子目录) | 最新修改 | 最旧看到的 |
|---|---|---|---|
| `docs/ops/` | 3 | `SESSION-HANDOFF-2026-07-10.md`(Jul 10 12:37) | `incident-visibility.md`(Jul 8 02:16) |
| `docs/northstar/` | 3(该目录另有子目录,共 17 项含子目录) | `IMMERSIVE-STORE.md`(Jul 10 02:15) | `GOOSEWORKS-MAP.md`(Jul 10 01:58) |
| `docs/review/` | 3(顶层可见;目录共 21 项含子目录) | `REVIEWER-PLAYBOOK.md`(Jul 8 02:16) | `QA-OTTO-STREAM-ROUTE-2026-07-04.md`(Jul 8 02:16 mtime,内容日期 07-04) |

（注:`ls -la` 的顶层计数含 `.`/`..`,上表已扣除；`docs/northstar`、`docs/review` 目录下还有更多子目录未逐一展开,超出本分片"只统计"范围,留给 planning 层汇总时按需深挖。）

---

## 建议清理清单

1. **【安全删】`~/Desktop/FIKIRTIVE/demo-remotion/`(533M)** —— 内容已在 #150 从 git 彻底删除并合并进 main,当前目录是纯本地渲染/依赖残留(`node_modules` + `out/*.png`),无任何未提交的独有工作(`git ls-files` 确认 0 个跟踪文件)。可安全删除,建议删除后把 `demo-remotion/` 加入 `.gitignore` 防止再次误建。
2. **【安全删】`~/Desktop/FIKIRTIVE/err.log`** —— 44 字节,内容仅为一行 git worktree 准备日志,无信息价值。
3. **【要 founder 批】`~/Desktop/FIKIRTIVE/.gitignore` 的未提交改动**(新增 `.claude/settings.local.json` 一行)—— 内容本身无害,但属于已跟踪文件的未提交修改,建议 founder 决定是否提交或丢弃,不要代为处理。
4. **【要 founder 批】`~/Desktop/FIKIRTIVE/.codex/config.toml`(4K,untracked)** —— 本地 Codex CLI 配置,未读取内容(铁律:不打印凭据值)。是否需要加入 `.gitignore`、是否含敏感配置,建议 founder 或熟悉该工具的 agent 确认后再决定去留。
5. **【要 founder 批 / 需整体处理】本 worktree `.orchestration/`(248K,20 文件,纯本地、从未入 git)** —— 交接前应整体打包为一个 PR 正式入库(建议顶层决策文档 → `docs/ops/` 或 `docs/northstar/`,`evidence/` 子目录 → `docs/review/` 或新建 `docs/evidence/`);体积小,不建议拆分挑拣,避免证据链缺角。
6. **【禁删】`~/Desktop/FIKIRTIVE/.prod-session.json`** —— `.gitignore` 明确标注"secret, must never be committed",且是 F32 类事故的防线之一,只记录存在与文件名,未读取内容,严禁碰。
7. **【禁删】`~/Desktop/FIKIRTIVE/.claire/`** —— `.gitignore` 注明"Stray Claude worktree dirs must never be committed (见 F32 audit)",属已知防呆规则覆盖的目录,不在本次清理范围。

---

## Red flags

1. `demo-remotion/` 533M 的本地残留是本次盘点中体积最大的异常项,且已确认与 git 历史脱钩(#150 删除),风险等级低但值得在交接文档里明确记一笔,避免下一任误以为它是"还没提交的工作"。
2. `.orchestration/` 全部内容（含本轮 P0/Gate1/Matrix 决策文档与证据链）目前**只存在于这一个 worktree 的本地文件系统**，未被 git 以任何形式追踪（`.git/info/exclude` 命中）——如果这个 worktree 在交接时被删除/未打包，相当于把本轮决策依据全部丢失。这是本分片发现的最高优先级风险，超出"repo hygiene"范畴，建议直接升级给 planning/founder。
3. `.gitignore` 有未提交的改动挂在主仓——不影响功能,但交接时如果直接打包"当前状态"而非"git 状态",容易让下一任误以为这行规则已经生效入库。

---

## Unknowns

1. `.gstack/`(5.4M,`drwx------` 权限)—— `.gitignore` 中列有 `.gstack/` 规则,但 `git check-ignore -v .gstack` 未直接返回命中(可能是权限导致读取受限,或路径匹配的细节未深挖)。未确认它是否真的被 git 完全忽略,也未确认目录内容性质。标记 Unknown,不代为判断。
2. `docs/northstar/`、`docs/review/` 的子目录内部内容未逐一展开盘点(任务范围要求"只统计"顶层),是否存在过时/重复的计划文档需要 planning 层专门查一遍。
3. `.codex/config.toml` 的具体配置内容未读取(铁律要求不碰凭据类文件细节),是否含敏感信息 Unknown,需 founder 或专人确认。
