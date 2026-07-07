# 本地复现 CI 三关(check / test / web-build)

CI 不可用时(账单封锁 / Actions 宕机),合并前必须在本地完整跑过这三关并把结果贴进
PR(见 `AGENTS.md` 与 `.claude/CLAUDE.md` 的合并纪律)。配方与
`.github/workflows/ci.yml` 一一对应;任何一步非零退出 = 红,不得合并。

## 前置:Postgres + 测试库

```bash
docker compose up -d postgres
# ⚠️ compose 默认库名是 `artlio`,不满足 packages/db 与 apps/web(F35)的 *_test
# 库名守卫 —— 测试连它会被拒。所以要单独建一个 artlio_test:
docker compose exec postgres psql -U artlio -c 'CREATE DATABASE artlio_test;'
```

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
export DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test'
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
