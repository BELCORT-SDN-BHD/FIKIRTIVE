# 本地质量检查

GitHub 与本地使用同一个质量入口：

```bash
pnpm install --frozen-lockfile
pnpm quality
```

`pnpm quality` 会依次验证 package build、数据库 migration 与 schema 漂移、测试、
TypeScript、lint、Otto skill 边界、资金毛利不变量、破坏性 migration，以及 Next.js
production build。任一步失败，整项质量检查失败。

## 本地数据库

本机需有可连接的 PostgreSQL 16。默认连接为：

```text
postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test
```

脚本拒绝基础数据库名不以 `_test` 结尾的连接；本地运行时，它还会建立一个独立的
临时测试库，并在结束时删除。要使用另一台测试数据库，可传入安全的 `DATABASE_URL`。
若为了诊断而要保留本次临时数据库，设置 `FIKIRTIVE_KEEP_TEST_DB=1`。

## GitHub 上的形态

Draft PR 不运行这项较重检查。PR 转为 Ready 后，GitHub 把同一批闸拆成五条**并行**的
腿，每条腿一台独立机器：

```text
quality.sh --leg typecheck | --leg tests | --leg build | --leg lint | --leg checks
```

五条腿之上是一个名为 `quality` 的扇入 job，它仍然是**唯一的 required check**：五条
腿全绿它才绿，任何一条失败、被取消或状态不明，它一律判失败。墙钟因此从「所有闸相加」
变成「最慢的一条腿」。

本地不需要分腿：不带参数的 `pnpm quality` 依旧按上面的顺序跑完全部闸，一个不少。要
在本地复现某一条腿（例如 CI 只有 `tests` 红），可以跑 `pnpm quality --leg tests`。

哪个闸属于哪条腿，写在 `scripts/ci/quality.sh` 每个 `gate` 的第一个参数上；
`scripts/__tests__/quality-legs.test.sh` 会机器校验「所有腿的并集 = 全部闸」与
「ci.yml 跑的腿名 = quality.sh 声明的腿名」，它本身也是一道闸。它手写一份独立的
「闸 → 腿」清单当真值：增删闸、改闸名、把闸挪到别的腿，都必须在同一个 commit 里
改那份清单，否则这道闸红。它读 ci.yml 时按 YAML 语义解析（用本机已有的 PyYAML /
ruby / yq / js-yaml 任一），注释里的腿名和接线一律不算数——被注释掉的闸不会跑。

它还校验「这条腿真的会跑，而且跑挂了会传出去」，因为「文件里写着这条命令」不等于
「这条命令执行了」：每条腿的 `run` **整段脚本**必须一字不差是
`pnpm quality --leg <腿名>`（多一个 `|| true`、或者被 `if false; then … fi` 包起来，
这条腿就再也红不起来）；`package.json` 里 `quality` 这条 script 也必须一字不差是
`bash scripts/ci/quality.sh`（`pnpm quality` 最终跑的是它）；每个 job 的 `if:` 必须
和自测里手写的条件逐字相同（job 没跑报的是 `skipped`，不是 `failure`）；任何 step
都不许带 `if`、`continue-on-error`、`shell`、`working-directory`，任何 job 都不许带
`continue-on-error`、`strategy`、`defaults`。所以在 ci.yml 里新增 job、改 job 的
`if:`，同样要在同一个 commit 里改那份手写清单。

扇入 job 的脚本不只被读，还会被自测**真跑一遍**：把它从 ci.yml 里解析出来，用五条腿
各种非绿组合喂进去，验证它确实判失败。只读文件只能证明比较写在那里，跑一遍才能证明
比较被执行到。

不要把重复执行同一批闸的 job 或第二套本地命令再加回来。
