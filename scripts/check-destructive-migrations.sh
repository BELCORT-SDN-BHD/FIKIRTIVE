#!/usr/bin/env bash
# 破坏性迁移闸(2026-07-04)。推 main = 自动对 prod 跑 prisma migrate deploy,无人工闸门。
# 一次静默的 DROP TABLE / DROP COLUMN / TRUNCATE / DELETE FROM 会不可逆地销毁真实客户
# 数据。这道闸扫所有 migration.sql:任何数据丢失级 DDL 必须在同文件带一行显式确认注释
#   -- DESTRUCTIVE-OK: <理由>
# 缺确认 = FAIL。让"删数据"从一个可以埋进大迁移里的静默操作,变成一个必须显式声明、
# founder 在 PR 里看得见的动作。索引/默认值/非唯一约束的 DROP 不是数据丢失,不拦。
set -euo pipefail
cd "$(dirname "$0")/.."

MIG_DIR="packages/db/prisma/migrations"
# 数据丢失级 DDL(大小写不敏感)。DROP DEFAULT / DROP INDEX / DROP CONSTRAINT 不在内。
PATTERN='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE|DELETE[[:space:]]+FROM'
MARKER='DESTRUCTIVE-OK'

fail=0
while IFS= read -r sql; do
  [[ -z "$sql" ]] && continue
  if grep -qiE "$PATTERN" "$sql"; then
    if ! grep -q "$MARKER" "$sql"; then
      echo "[destructive-migrations] FAIL: $sql 含数据丢失级 DDL 但无 '-- $MARKER: <理由>' 确认。" >&2
      grep -niE "$PATTERN" "$sql" | sed 's/^/    /' >&2
      fail=1
    fi
  fi
done < <(find "$MIG_DIR" -name migration.sql 2>/dev/null)

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "  若删数据是 founder 授权的有意操作:在该 migration.sql 顶部加一行" >&2
  echo "    -- DESTRUCTIVE-OK: <为什么这是安全/必要的>" >&2
  echo "  否则 —— 停手,别把销毁 prod 数据的迁移推上 main。" >&2
  exit 1
fi

echo "[destructive-migrations] OK: 无未确认的数据丢失级迁移。"
