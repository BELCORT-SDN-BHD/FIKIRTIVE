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
「ci.yml 跑的腿名 = quality.sh 声明的腿名」，它本身也是一道闸。

不要把重复执行同一批闸的 job 或第二套本地命令再加回来。
