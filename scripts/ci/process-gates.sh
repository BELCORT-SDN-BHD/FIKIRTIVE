#!/usr/bin/env bash

# 《开发作业手册》五道机器闸(M1–M5)+ 事后规格公示(notice)。
# Founder 2026-08-28 批准落地。
#
# 为什么是独立 workflow、绝不改 ci.yml:先例与理由见 .github/workflows/post-merge.yml
# 头注——`quality` 是被 lock 钉死的必需检查,动它的形态的那一族错误,代价是整仓无法合并。
#
# 三条设计纪律,照抄本仓库 CI 的既有做法:
#   - fail closed:拿不到判定所需的输入(diff、PR 描述、API token),一律红,不静默放行。
#   - 报错报到能动手改:报具体文件、该写哪一行,不报「有违例」四个字。
#   - 棘轮只减不增:两块豁免板的上限是本文件里的常量,调大必须改这里——diff 里刺眼。
#
# 用法: bash scripts/ci/process-gates.sh <m1|m2|m3|m4|m5|notice>
# 环境(由 process-gates.yml 提供):
#   BASE_SHA / HEAD_SHA  PR 的 base 与 head 提交
#   PR_BODY_FILE         PR 描述正文落盘的文件(内容是不可信输入,本脚本只 grep,不执行)
#   GH_TOKEN             m2 校验批准评论作者时调 GitHub API(gh CLI)
#
# 诚实定位(手册原文):M1 验形式不验语义,是「强迫记得」的闸。语义仍靠 S5 与人审。

set -euo pipefail

REPO="BELCORT-SDN-BHD/FIKIRTIVE"
FOUNDER_LOGIN="nicksgan-belcort"   # 冻结签名的唯一合法作者;agent 代记无效(手册 S1 闸门)
SPECS_DIR="docs/specs"

# 产品代码 = 这两棵树。docs/、scripts/、.github/ 不算——规格-only 与工具 PR 不需要规格引用。
PRODUCT_CODE_RE='^(apps/|packages/)'

# M1 路径地板:碰这些的 PR 无论自报什么挡,一律强制规格引用(堵「全都自报轻挡」的绕法)。
# 名单故意宽:钱路/租户词根命中即算。宽的代价是多写一次规格引用,窄的代价是钱路漏网。
FLOOR_RE='(^packages/db/prisma/(migrations/|schema\.prisma)|billing|credit|ledger|settlement|refund|reserve|spend|money|auth|tenant|org-role|consent)'
NEW_ROUTE_RE='^apps/web/app/.*/(page|route|layout)\.(ts|tsx)$'

# 机器可读语法(手册 M1 ③):PR 描述里独立成行,冒号后至少一个空格。
#   Spec: docs/specs/<名字>.md          —— 已冻结规格引用(可多条)
#   轻改: <勾选句>                       —— 轻挡(「商家在 X 处看到 Y」或「商家可见行为无变化」)
SPEC_LINE_RE='^Spec:[[:space:]]+docs/specs/[A-Za-z0-9._-]+\.md[[:space:]]*$'
LIGHT_LINE_RE='^轻改:[[:space:]]*..*$'

# 豁免板棘轮:板在 docs/specs/*.txt,上限在这里。调大上限 = 改这两行 = 审阅者一眼看见。
ACCEPTANCE_EXEMPT_BOARD="docs/specs/acceptance-exemptions.txt"
ACCEPTANCE_EXEMPT_MAX=0
FLAG_EXEMPT_BOARD="docs/specs/flag-exemptions.txt"
FLAG_EXEMPT_MAX=0

fail() { printf '%s\n' "$@" >&2; exit 1; }

need_env() {
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      fail "process-gates: 环境变量 $name 缺失——判定所需输入拿不到,按 fail-closed 红。"
    fi
  done
}

changed_files() { git diff --name-only "$BASE_SHA" "$HEAD_SHA"; }
added_files()   { git diff --name-only --diff-filter=A "$BASE_SHA" "$HEAD_SHA"; }

body_lines() {
  # PR 描述是不可信输入:只读、只 grep,任何内容都不进入求值位置。
  # GitHub 的正文是 \r\n 行尾,\r 会黏在提取出的路径尾上,这里一次剥掉。
  [[ -r "$PR_BODY_FILE" ]] || fail "process-gates: PR_BODY_FILE 不可读——按 fail-closed 红。"
  tr -d '\r' < "$PR_BODY_FILE"
}

# PR 描述里的 Spec: 引用路径(不验证,只提取;一行一个,去重)。
spec_ref_paths() {
  body_lines | grep -E "$SPEC_LINE_RE" | awk '{print $2}' | sort -u
}

# 验证一条规格引用:文件在、状态是已冻结。不合格就地退出(在主 shell 里跑,不进子壳——
# 命令替换里的 exit 只杀子壳,fail-closed 会被 if 吞掉,这里刻意避开那个坑)。
validate_spec_ref() {
  local spec="$1"
  [[ -f "$spec" ]] || fail \
    "M 闸:PR 描述引用了 $spec,但仓库里没有这个文件。" \
    "先把规格以 docs-only PR 合进主干(铁律 3),再开产品 PR。"
  grep -qE '^>?[[:space:]]*状态(:|：).*已冻结' "$spec" || fail \
    "M 闸:$spec 的状态不是「已冻结」——引用只认冻结版。" \
    "冻结动作 = Founder 在功能 issue 评论「S1 批准」,然后把状态行改成「已冻结 · v1」。"
}

m1() {
  need_env BASE_SHA HEAD_SHA PR_BODY_FILE
  local product floor routes refs spec
  product="$(changed_files | grep -E "$PRODUCT_CODE_RE" || true)"
  if [[ -z "$product" ]]; then
    echo "M1 绿:本 PR 不碰产品代码(apps/、packages/),不需要规格引用。"
    return 0
  fi

  refs="$(spec_ref_paths || true)"
  if [[ -n "$refs" ]]; then
    while IFS= read -r spec; do validate_spec_ref "$spec"; done <<< "$refs"
    echo "M1 绿:已冻结规格引用有效——"
    printf '  %s\n' $refs
    return 0
  fi

  floor="$(printf '%s\n' "$product" | grep -E "$FLOOR_RE" || true)"
  routes="$(added_files | grep -E "$NEW_ROUTE_RE" || true)"
  if [[ -n "$floor$routes" ]]; then
    fail "M1 红:本 PR 碰了路径地板(钱路/数据库迁移/登录租户/新路由),无论轻重挡一律要已冻结规格引用。" \
      "命中地板的文件:" \
      "$(printf '  %s\n' $floor $routes)" \
      "修法:在 PR 描述里独立成行写  Spec: docs/specs/<名字>.md  (该规格须已冻结)。"
  fi

  if body_lines | grep -qE "$LIGHT_LINE_RE"; then
    echo "M1 绿:轻挡勾选句在案。轻挡的定义是零商家可见行为变化——如果这句是假的,S5 与人审收账。"
    return 0
  fi

  fail "M1 红:本 PR 碰产品代码,但 PR 描述里既无已冻结规格引用、也无轻改勾选句。" \
    "二选一,独立成行写在 PR 描述里(冒号后要有空格):" \
    "  Spec: docs/specs/<名字>.md      (中/重挡:引用已冻结的 S1)" \
    "  轻改: 商家在 X 处看到 Y          (轻挡:零行为变化;纯维护写「商家可见行为无变化」)" \
    "碰到的产品文件(前 20):" \
    "$(printf '%s\n' "$product" | head -20 | sed 's/^/  /')"
}

m2() {
  # 规格形状闸:凡标「已冻结」的规格,形状必须齐——验收表、不做、异议栏、批准链接,
  # 且批准评论的作者必须是 Founder 本人。对整个 docs/specs/ 运行,不只对本 PR 改的文件:
  # 形状坏的冻结规格留在树上,每个后续 PR 都该红,直到有人修。
  local spec bad=0
  shopt -s nullglob
  for spec in "$SPECS_DIR"/*.md; do
    [[ "$(basename "$spec")" == "TEMPLATE.md" ]] && continue
    if ! grep -qE '^>?[[:space:]]*状态(:|：)' "$spec"; then
      echo "M2 红:$spec 没有「状态:」行——每份规格必须自报草稿/已冻结/已交付。" >&2
      bad=1
      continue
    fi
    grep -qE '^>?[[:space:]]*状态(:|：).*已冻结' "$spec" || continue

    if ! grep -qE '\|[[:space:]]*[A-Z][A-Z0-9]{1,15}-A[0-9]+[[:space:]]*\|' "$spec"; then
      echo "M2 红:$spec 已冻结但验收表里没有一条带编号的验收行(格式:| XXX-A1 | 商家做 X | 看到 Y |)。" >&2
      bad=1
    fi
    if ! grep -qE '^#{2,3}[[:space:]].*不做' "$spec"; then
      echo "M2 红:$spec 已冻结但缺「不做」节——非目标不写,遗漏与裁剪就分不清。" >&2
      bad=1
    fi
    if ! grep -qE '^#{2,3}[[:space:]].*异议' "$spec"; then
      echo "M2 红:$spec 已冻结但缺「异议栏」——AI 的最大风险陈述是 S1 的必填项(global 法 7.1)。" >&2
      bad=1
    fi

    local approval issue signer
    approval="$(grep -m1 -E '^>?[[:space:]]*批准(:|：)' "$spec" || true)"
    issue="$(printf '%s' "$approval" | grep -oE 'issues/[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
    if [[ -z "$issue" ]]; then
      echo "M2 红:$spec 已冻结但「批准:」行里没有 issue 链接(https://github.com/$REPO/issues/<N>)。" >&2
      bad=1
      continue
    fi

    # 批准评论作者校验:冻结签名只认 Founder 本人。拿不到 API = 判定不了 = 红(fail closed)。
    if [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then
      echo "M2 红:没有 GH_TOKEN,无法校验 $spec 批准评论的作者——fail closed。" >&2
      bad=1
      continue
    fi
    signer="$(gh api "repos/$REPO/issues/$issue/comments" --paginate \
      --jq "[.[] | select(.user.login == \"$FOUNDER_LOGIN\") | select(.body | contains(\"S1 批准\"))] | length" \
      2>/dev/null | awk '{s+=$1} END {print s+0}')" || signer=0
    if [[ "${signer:-0}" -lt 1 ]]; then
      echo "M2 红:$spec 标了已冻结,但 issue #$issue 里找不到 $FOUNDER_LOGIN 本人写的「S1 批准」评论。" >&2
      echo "  agent 代记无效;请 Founder 本人在 https://github.com/$REPO/issues/$issue 评论四个字:S1 批准。" >&2
      bad=1
    fi
  done
  [[ "$bad" -eq 0 ]] || exit 1
  echo "M2 绿:docs/specs/ 里所有冻结规格形状齐全,批准签名验明是 $FOUNDER_LOGIN 本人。"
}

m3() {
  # 验收↔测试映射闸:本 PR 引用的冻结规格,其验收编号必须逐字出现在测试文件里。
  # S4 早期允许 it.todo("XXX-A1 …") 占位——编号在,测试树就认;S5 前转正由验收把关。
  need_env BASE_SHA HEAD_SHA PR_BODY_FILE
  local refs spec id bad=0
  refs="$(spec_ref_paths || true)"
  if [[ -z "$refs" ]]; then
    echo "M3 绿:本 PR 没有规格引用(轻挡或非产品 PR),无验收编号可映射。"
    return 0
  fi
  while IFS= read -r spec; do validate_spec_ref "$spec"; done <<< "$refs"

  # 豁免板棘轮:板行数超过本文件里的上限就红——上限调大必须改本脚本,diff 刺眼。
  if [[ -f "$ACCEPTANCE_EXEMPT_BOARD" ]]; then
    local rows
    rows="$(grep -cvE '^[[:space:]]*(#|$)' "$ACCEPTANCE_EXEMPT_BOARD" || true)"
    if [[ "${rows:-0}" -gt "$ACCEPTANCE_EXEMPT_MAX" ]]; then
      fail "M3 红:$ACCEPTANCE_EXEMPT_BOARD 有 $rows 行,超过上限 $ACCEPTANCE_EXEMPT_MAX(棘轮只减不增)。" \
        "要真加豁免,连本脚本里的 ACCEPTANCE_EXEMPT_MAX 一起改,并在 PR 里说清为什么。"
    fi
  fi

  while IFS= read -r spec; do
    while IFS= read -r id; do
      [[ -n "$id" ]] || continue
      if [[ -f "$ACCEPTANCE_EXEMPT_BOARD" ]] && grep -qE "^$id([[:space:]]|\$)" "$ACCEPTANCE_EXEMPT_BOARD"; then
        continue
      fi
      if ! git grep -l --fixed-strings "$id" "$HEAD_SHA" -- \
          '*.test.ts' '*.test.tsx' '*.test.mjs' '*.test.sh' '*__tests__*' >/dev/null 2>&1; then
        echo "M3 红:验收编号 $id($spec)在测试文件里找不到。" >&2
        echo "  修法:写一条包含字符串 $id 的行为测试;S4 早期可先 it.todo(\"$id …\") 占位。" >&2
        bad=1
      fi
    done < <(grep -oE '[A-Z][A-Z0-9]{1,15}-A[0-9]+' "$spec" | sort -u)
  done <<< "$refs"
  [[ "$bad" -eq 0 ]] || exit 1
  echo "M3 绿:引用规格的验收编号全部在测试树里有落点。"
}

m4() {
  # 反「只藏不删」闸:新引入的功能开关(BETA_* / *_ENABLED)必须带保留理由和失效日期,
  # 否则「藏起来」会变成永久状态——一个开关值能藏起 5,844 行组件(手册轻挡教训)。
  need_env BASE_SHA HEAD_SHA PR_BODY_FILE
  # git grep 的 ERE 不认 \b(2026-08-28 演练实测:带 \b 零匹配)——整词边界用它自己的 -w。
  local flag_re='(BETA_[A-Z0-9_]+|[A-Z0-9_]{2,}_ENABLED)'
  local base_flags head_flags new_flags flag bad=0
  base_flags="$(git grep -howE "$flag_re" "$BASE_SHA" -- apps packages 2>/dev/null | sort -u || true)"
  head_flags="$(git grep -howE "$flag_re" "$HEAD_SHA" -- apps packages 2>/dev/null | sort -u || true)"
  new_flags="$(comm -13 <(printf '%s\n' "$base_flags") <(printf '%s\n' "$head_flags") | grep -v '^$' || true)"

  if [[ -z "$new_flags" ]]; then
    echo "M4 绿:本 PR 没有引入新的功能开关名。"
    return 0
  fi

  if [[ -f "$FLAG_EXEMPT_BOARD" ]]; then
    local rows
    rows="$(grep -cvE '^[[:space:]]*(#|$)' "$FLAG_EXEMPT_BOARD" || true)"
    if [[ "${rows:-0}" -gt "$FLAG_EXEMPT_MAX" ]]; then
      fail "M4 红:$FLAG_EXEMPT_BOARD 有 $rows 行,超过上限 $FLAG_EXEMPT_MAX(棘轮只减不增)。"
    fi
  fi

  while IFS= read -r flag; do
    [[ -n "$flag" ]] || continue
    if [[ -f "$FLAG_EXEMPT_BOARD" ]] && grep -qE "^$flag([[:space:]]|\$)" "$FLAG_EXEMPT_BOARD"; then
      continue
    fi
    if ! body_lines | grep -q '保留理由:' || ! body_lines | grep -qE '失效日期:[[:space:]]*2[0-9]{3}-[0-9]{2}-[0-9]{2}'; then
      echo "M4 红:本 PR 新引入开关 $flag,但 PR 描述里没有「保留理由:」+「失效日期: YYYY-MM-DD」。" >&2
      echo "  藏而不删要付两行字的价;到期不拆,heartbeat 会来收账。" >&2
      bad=1
    fi
  done <<< "$new_flags"
  [[ "$bad" -eq 0 ]] || exit 1
  echo "M4 绿:新开关都带保留理由与失效日期。"
}

m5() {
  # 归位闸(首版只管三个目录,按棘轮扩张——目录约定表建立前不全仓开管,防误报逼出豁免通胀):
  #   docs/specs/                     只收平铺的 .md 与两块豁免板 .txt
  #   packages/db/prisma/migrations/  只收 prisma 迁移的标准形状
  #   docs/superpowers/               冻结历史区:不加新文件、不改旧文件(README.md 除外)
  need_env BASE_SHA HEAD_SHA
  local file bad=0
  while IFS= read -r file; do
    case "$file" in
      "$SPECS_DIR"/*)
        if ! [[ "$file" =~ ^docs/specs/[A-Za-z0-9._-]+\.(md|txt)$ ]]; then
          echo "M5 红:$file —— docs/specs/ 只收平铺的 .md 规格与豁免板 .txt,不收子目录与其他类型。" >&2
          bad=1
        fi
        ;;
      packages/db/prisma/migrations/*)
        if ! [[ "$file" =~ ^packages/db/prisma/migrations/([0-9]{14}_[a-z0-9_]+/migration\.sql|migration_lock\.toml)$ ]]; then
          echo "M5 红:$file —— 迁移目录只收 <14位时间戳>_<名字>/migration.sql 与 migration_lock.toml。" >&2
          bad=1
        fi
        ;;
      docs/superpowers/README.md) ;;   # 冻结区的说明文件本身可维护
      docs/superpowers/*)
        echo "M5 红:$file —— docs/superpowers/ 已冻结为历史存档(手册废止表),不加新文件、不改旧文件。" >&2
        echo "  现行规格的家是 docs/specs/。" >&2
        bad=1
        ;;
    esac
  done < <(changed_files)
  [[ "$bad" -eq 0 ]] || exit 1
  echo "M5 绿:本 PR 改动的文件都在自己的家里。"
}

notice() {
  # 事后规格公示(不拦截):冻结晚于分支首笔产品提交的规格,自动标记示众。
  # 「先干后补」最便宜的防线——示众不禁止,S5 与人审看着办。
  need_env BASE_SHA HEAD_SHA PR_BODY_FILE
  local refs spec spec_ts first_product_ts
  refs="$(spec_ref_paths || true)"
  [[ -n "$refs" ]] || { echo "notice: 无规格引用,无可公示。"; return 0; }
  first_product_ts="$(git log --reverse --format=%ct "$BASE_SHA..$HEAD_SHA" -- apps packages | head -1 || true)"
  [[ -n "$first_product_ts" ]] || { echo "notice: 分支上没有产品提交。"; return 0; }
  while IFS= read -r spec; do
    [[ -f "$spec" ]] || continue   # 引用是否合法由 M1 收账,公示只管时间线
    spec_ts="$(git log -1 --format=%ct "$HEAD_SHA" -- "$spec" || true)"
    if [[ -n "$spec_ts" && "$spec_ts" -gt "$first_product_ts" ]]; then
      echo "::warning file=$spec::事后规格公示——$spec 的最后修订晚于本分支首笔产品提交(先干后补)。示众不禁止;S5 请留意验收表是否照着已写好的代码倒填。"
    fi
  done <<< "$refs"
  echo "notice: 公示完成。"
}

case "${1:-}" in
  m1) m1 ;;
  m2) m2 ;;
  m3) m3 ;;
  m4) m4 ;;
  m5) m5 ;;
  notice) notice ;;
  *) fail "用法: bash scripts/ci/process-gates.sh <m1|m2|m3|m4|m5|notice>" ;;
esac
