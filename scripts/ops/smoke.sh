#!/usr/bin/env bash
# 部署后烟测(#797,工程评估债 #6)。
#
# 「部署成功」在今天只意味着容器起来了。它不意味着 web 能答话、数据库连得上、匿名页面
# 渲染得出来。这三件事任何一件坏了,商家看到的都是一个打不开的产品,而部署面板是绿的。
# 这个脚本就是补上那一步:部署完对着一个 URL 跑一次,答不上来就红。
#
# 只发 GET,只打匿名端点,不带任何凭据,不写任何东西 —— 对任意环境跑都不会改变它的状态。
# 没有默认 URL:目标必须由调用者显式写出来,不能靠脚本里的默认值把烟测打到意料之外的环境。
#
# 用法:
#   scripts/ops/smoke.sh https://staging.example.com
#   scripts/ops/smoke.sh https://staging.example.com --require-worker
#   scripts/ops/smoke.sh https://staging.example.com --attempts 20 --interval 6
#
# 退出码:0 = 全绿;1 = 有必需检查未通过;2 = 用法错误。
set -uo pipefail

BASE=""
ATTEMPTS=10
INTERVAL=6
REQUIRE_WORKER=0

usage() {
  cat >&2 <<'EOF'
usage: smoke.sh <base-url> [--attempts N] [--interval SECONDS] [--require-worker]

  <base-url>          required. e.g. https://staging.example.com — no default, on purpose.
  --attempts N        how many times to retry while the deploy becomes ready (default 10)
  --interval SECONDS  seconds between attempts (default 6)
  --require-worker    also fail unless the worker heartbeat reports "up"
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --attempts) ATTEMPTS="${2:-}"; shift 2 || true ;;
    --interval) INTERVAL="${2:-}"; shift 2 || true ;;
    --require-worker) REQUIRE_WORKER=1; shift ;;
    -h|--help) usage; exit 2 ;;
    -*) echo "smoke: unknown option $1" >&2; usage; exit 2 ;;
    *) if [ -n "$BASE" ]; then echo "smoke: more than one base URL given" >&2; exit 2; fi; BASE="$1"; shift ;;
  esac
done

if [ -z "$BASE" ]; then usage; exit 2; fi
case "$BASE" in
  http://*|https://*) ;;
  *) echo "smoke: base URL must start with http:// or https:// — got \"$BASE\"" >&2; exit 2 ;;
esac
case "$ATTEMPTS$INTERVAL" in *[!0-9]*) echo "smoke: --attempts and --interval must be whole numbers" >&2; exit 2 ;; esac
BASE="${BASE%/}"

pass=0
fail=0
note() { printf '  %s\n' "$1"; }
ok()   { printf 'PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }

# 一次 GET。回显 "<http-code>\n<body>";curl 自身失败(DNS/连接/超时)回显 000 与空 body。
probe() {
  curl --silent --show-error --location --max-time 20 \
       --write-out '\n%{http_code}' "$1" 2>/dev/null || printf '\n000'
}

echo "smoke: ${BASE}"
echo "smoke: read-only GETs only; no credentials are sent"

# ── ① /api/health ────────────────────────────────────────────────────────────
# 部署刚起来的几十秒里 502/503 是正常的,所以这一项带重试;重试用完还不绿才算真红。
health_code=""
health_body=""
attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  raw="$(probe "${BASE}/api/health")"
  health_code="${raw##*$'\n'}"
  health_body="${raw%$'\n'*}"
  [ "$health_code" = "200" ] && break
  printf '      /api/health attempt %s/%s → HTTP %s\n' "$attempt" "$ATTEMPTS" "${health_code:-000}"
  attempt=$((attempt + 1))
  [ "$attempt" -le "$ATTEMPTS" ] && sleep "$INTERVAL"
done

if [ "$health_code" = "200" ]; then
  ok "/api/health answered 200"
else
  bad "/api/health never answered 200 (last: HTTP ${health_code:-000})"
fi

case "$health_body" in
  *'"db":"up"'*) ok "database reachable from web" ;;
  *) bad "web does not report a reachable database" ;;
esac

worker_status="unknown"
case "$health_body" in
  *'"worker":"up"'*) worker_status="up" ;;
  *'"worker":"stale"'*) worker_status="stale" ;;
esac
if [ "$REQUIRE_WORKER" = "1" ]; then
  if [ "$worker_status" = "up" ]; then ok "worker heartbeat is fresh"; else bad "worker heartbeat is \"${worker_status}\""; fi
else
  note "worker heartbeat: ${worker_status} (not a required check — pass --require-worker to make it one)"
fi

# ── ② 匿名页面 ───────────────────────────────────────────────────────────────
# /login 是登出状态下必须渲染的那一页。它 200 才说明 Next 的渲染路径整条是通的,而不只是
# 一个 API 路由活着。
raw="$(probe "${BASE}/login")"
login_code="${raw##*$'\n'}"
if [ "$login_code" = "200" ]; then
  ok "anonymous page /login answered 200"
else
  bad "anonymous page /login answered HTTP ${login_code:-000}"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "smoke: ${pass} checks passed."
  exit 0
fi
echo "smoke: ${fail} check(s) failed, ${pass} passed."
exit 1
