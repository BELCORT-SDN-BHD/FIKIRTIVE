# 本地复现 CI 四关（check / test / web-build / lint）

CI 因账单封锁或 Actions 宕机而完全没有启动步骤时，合并前必须在 PR 的精确 head 上复现
四个 job，并保留完整、非敏感日志与退出码。任何命令非零都算红；billing zero-step 只能记为
“未运行”，不能记为绿色。

`.github/workflows/ci.yml` 与本 runbook 都只调用 `scripts/ci/run-job.sh`。各 job 的内部命令
只维护在该脚本，不在这里复制。

## 前置条件

- Node.js 22。
- `package.json` 的 `packageManager` 所钉版本（当前为 pnpm 10.0.0）。
- test job 使用隔离的 PostgreSQL 16 数据库，库名必须以 `_test` 结尾。

本地 Docker 数据库可这样准备；这条 URL 只提供服务器地址、凭据与基准库名，实际使用的库由
runner 自己派生并创建（见下一节）：

```bash
node --version
pnpm --version
docker compose up -d postgres
export DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test'
```

若机器仍使用旧卷，数据库用户可能是 `artlio`；只替换上面的数据库用户名，不得改成真实或
生产数据库。runner 会在 migration 前再次拒绝任何库名不以 `_test` 结尾的 URL，且不会打印
URL 内容。

## 本地并发隔离（#562 约定）

在 GitHub Actions 之外，test job 会为每次运行派生一个独有的数据库名（默认由进程 PID 加随机
后缀组成，必定以 `_test` 结尾），自动创建它，并把 `DATABASE_URL` 改写到该库，migration 与
`pnpm -r test` 全程使用它。

**并发警告：2026-07-30 出现过多个本地 session 同时跑 test job、共用 `fikirtive_test` 而互相
清库的事故，双方都拿到了假红假绿的结论。任何两个 session 都不得共用同一个 test 数据库。**

- `FIKIRTIVE_TEST_DB=<name>`：把库名钉死，便于同一 session 内多次复用。名字必须以 `_test`
  结尾（且只含小写字母、数字、下划线），否则 runner 立即拒绝、不做任何安装。
- `FIKIRTIVE_TEST_DB_DROP=1`：job 退出时（含失败退出）删除该库。不设时保留库，便于事后验尸。

```bash
FIKIRTIVE_TEST_DB=fikirtive_pr562_test bash scripts/ci/run-job.sh test
```

保留下来的一次性库可以这样清理：

```bash
docker compose exec postgres psql -U fikirtive -c 'DROP DATABASE IF EXISTS "fikirtive_12345_678_test" WITH (FORCE)'
```

云端 CI（`GITHUB_ACTIONS` 已设）不走这条路径，行为完全不变。

## 四个精确 job

```bash
bash scripts/ci/run-job.sh check
bash scripts/ci/run-job.sh test
bash scripts/ci/run-job.sh web-build
bash scripts/ci/run-job.sh lint
```

四条命令必须分别为零退出。将每条命令的完整非敏感日志、日志 hash、精确 head/base、Node/pnpm
版本和 disposable test DB 证据写入 PR；之后仍须按项目 merge 纪律取得适用的明确批准。
