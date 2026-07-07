# 本地复现 CI 三关(check / test / web-build)

CI 不可用时(账单封锁 / Actions 宕机),合并前必须在本地完整跑过这三关并把结果贴进
PR(见 `AGENTS.md` 与 `.claude/CLAUDE.md` 的合并纪律)。配方与
`.github/workflows/ci.yml` 一一对应;任何一步非零退出 = 红,不得合并。

## 前置:Postgres + 测试库

```bash
docker compose up -d postgres
# ⚠️ compose 默认库名是 `fikirtive`,不满足 packages/db 与 apps/web(F35)的 *_test
# 库名守卫(接受任意 *_test 后缀)—— 测试连它会被拒。所以要单独建一个 fikirtive_test:
docker compose exec postgres psql -U fikirtive -c 'CREATE DATABASE fikirtive_test;'
```

> 2026-07-07 名字清剿:本地库/用户/volume 已从旧名 `artlio` 改为 `fikirtive`。老机器上
> 若容器还是旧卷(`artlio-pg`),`docker compose up -d postgres` 会新建 `fikirtive-pg`
> 空卷并以新用户初始化;旧卷数据不动。旧库上直接建 `fikirtive_test` 也可以:
> `docker compose exec postgres psql -U artlio -c 'CREATE DATABASE fikirtive_test;'`(用户名跟旧卷走)。

## 第一关 — check(typecheck + fences)

```bash
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build
pnpm -r typecheck
bash scripts/check-skill-imports.sh
bash scripts/check-no-raw-prisma.sh
pnpm --filter @fikirtive/otto run catalog:check
pnpm lint:parity
bash scripts/check-blueprint-integrity.sh
bash scripts/check-destructive-migrations.sh
```

## 第二关 — test(migrate + 漂移门 + 全部测试)

```bash
export DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test'
pnpm --filter @fikirtive/db exec prisma migrate deploy
# schema 漂移门:schema.prisma 改了但没配套 migration → 这里红(prod 会炸)。
pnpm --filter @fikirtive/db exec prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code
pnpm -r test
```

## 第三关 — web-build(Railway 部署同款命令)

```bash
pnpm --filter @fikirtive/web build
```

三关全绿后,把每关的关键输出(最后几行即可)贴进 PR 描述,等 founder 明确批准再合并。
