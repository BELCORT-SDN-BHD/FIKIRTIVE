# 本地复现 CI 五关（check / test / web-build / lint / money-path-review）

CI 因账单封锁或 Actions 宕机而完全没有启动步骤时，合并前必须在 PR 的精确 head 上复现
五个 job，并保留完整、非敏感日志与退出码。任何命令非零都算红；billing zero-step 只能记为
“未运行”，不能记为绿色。

`.github/workflows/ci.yml` 与本 runbook 都只调用 `scripts/ci/run-job.sh`。各 job 的内部命令
只维护在该脚本，不在这里复制。

## 前置条件

- Node.js 22。
- `package.json` 的 `packageManager` 所钉版本（当前为 pnpm 10.0.0）。
- test job 使用隔离的 PostgreSQL 16 数据库，库名必须以 `_test` 结尾。

本地 Docker 数据库可这样准备；创建命令是幂等的：

```bash
node --version
pnpm --version
docker compose up -d postgres
docker compose exec postgres sh -lc \
  "psql -U fikirtive -tAc \"SELECT 1 FROM pg_database WHERE datname='fikirtive_test'\" | grep -qx 1 || createdb -U fikirtive fikirtive_test"
export DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test'
```

若机器仍使用旧卷，数据库用户可能是 `artlio`；只替换上面两处数据库用户名，不得改成真实或
生产数据库。runner 会在 migration 前再次拒绝任何库名不以 `_test` 结尾的 URL，且不会打印
URL 内容。

## 五个精确 job

```bash
bash scripts/ci/run-job.sh check
bash scripts/ci/run-job.sh test
bash scripts/ci/run-job.sh web-build
bash scripts/ci/run-job.sh lint
bash scripts/ci/run-job.sh money-path-review
```

五条命令必须分别为零退出。将每条命令的完整非敏感日志、日志 hash、精确 head/base、Node/pnpm
版本和 disposable test DB 证据写入 PR；之后仍须按项目 merge 纪律取得适用的明确批准。
