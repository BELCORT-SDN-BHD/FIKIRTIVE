#!/usr/bin/env bash

# 《开发作业手册》五道机器闸(M1–M5)+ 事后规格公示(notice)。
# Founder 2026-08-28 批准落地;同日四镜头盲审修正(merge-base、签名绑定、pathspec、
# 迁移形状、地板豁免测试文件、自守卫、全角冒号宽容——逐条见各闸注释)。
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
#   BASE_SHA / HEAD_SHA  PR 的 base 与 head 提交(脚本内先收敛成 merge-base 再用——
#                        base.sha 是 main 的当时 tip,分支落后时两点 diff 会把别人合进
#                        main 的文件算成本 PR 的改动,盲审四镜头同抓的第一号假红源)
#   PR_BODY_FILE         PR 描述正文落盘的文件(内容是不可信输入,本脚本只 grep,不执行)
#   GH_TOKEN             m2 校验批准评论作者时调 GitHub API(gh CLI)
#
# 诚实定位(手册原文):M1 验形式不验语义,是「强迫记得」的闸。语义仍靠 S5 与人审。

set -euo pipefail

REPO="BELCORT-SDN-BHD/FIKIRTIVE"
FOUNDER_LOGIN="nicksgan-belcort"   # 冻结签名的唯一合法作者;agent 代记无效(手册 S1 闸门)
SPECS_DIR="docs/specs"

# 产品代码 = 这两棵树。docs/、scripts/、.github/ 不算——规格-only 与工具 PR 不需要规格引用。
# 闸自身的文件由 M5 的自守卫 case 看住(盲审:闸不能把自己排除在一切管辖之外)。
PRODUCT_CODE_RE='^(apps/|packages/)'
TEST_PATH_RE='(\.test\.|\.spec\.|__tests__)'

# M1 路径地板:碰这些的 PR 无论自报什么挡,一律强制规格引用(堵「全都自报轻挡」的绕法)。
# 名单故意宽:钱路/租户词根命中即算。宽的代价是多写一次规格引用,窄的代价是钱路漏网。
# 纯测试文件不算地板(盲审实测词根命中 134 文件里 78 个是测试——测试按定义不改商家可见行为)。
FLOOR_RE='(^packages/db/prisma/(migrations/|schema\.prisma)|billing|credit|ledger|settlement|refund|reserve|spend|money|auth|tenant|org-role|consent)'
NEW_ROUTE_RE='^apps/web/app/.*/(page|route|layout)\.(ts|tsx)$'

# 机器可读语法(手册 M1 ③):PR 描述里一行一条;容忍列表前缀与全角冒号(中文输入法默认
# 打全角——盲审:判不到还说「你没写」是最坏的红)。
#   Spec: docs/specs/<名字>.md          —— 已冻结规格引用(可多条)
#   轻改: <勾选句>                       —— 轻挡(零行为变化;纯文案/间距的可见微调属轻挡)
SPEC_LINE_RE='^[[:space:]]*[-*]?[[:space:]]*Spec(:|：)[[:space:]]*docs/specs/[A-Za-z0-9._-]+\.md[[:space:]]*$'
SPEC_PATH_RE='docs/specs/[A-Za-z0-9._-]+\.md'
LIGHT_LINE_RE='^[[:space:]]*[-*]?[[:space:]]*轻改(:|：)[[:space:]]*..*$'

# 闸门自身的文件:改它们的 PR 必须在描述里自报(M5 自守卫;最小版,不动 ci.yml 的字节锁)。
GATE_FILES_RE='^(scripts/ci/process-gates\.sh|scripts/ci/process-heartbeat\.sh|scripts/tools/spec-status\.sh|\.github/workflows/process-(gates|heartbeat)\.yml)$'
GATE_EDIT_LINE_RE='^[[:space:]]*[-*]?[[:space:]]*闸门改动(:|：)[[:space:]]*..*$'

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

# 把 BASE_SHA 收敛成 merge-base。算不出来 = 判定不了本 PR 改了什么 = 红(fail closed)。
resolve_base() {
  need_env BASE_SHA HEAD_SHA
  BASE_SHA="$(git merge-base "$BASE_SHA" "$HEAD_SHA")" || fail \
    "process-gates: 算不出 merge-base($BASE_SHA vs $HEAD_SHA)——fetch-depth 不够或提交缺失,红。"
}

# 改动文件清单。--diff-filter=d 排除删除:删除不是「放错地方」也不是「新引入」,
# 三道用它的闸(M1/M4/M5)都不该对删除发难(盲审:否则冻结区永远删不掉、闸把自己锁死)。
changed_files() { git diff --name-only --diff-filter=d "$BASE_SHA" "$HEAD_SHA"; }
added_files()   { git diff --name-only --diff-filter=A "$BASE_SHA" "$HEAD_SHA"; }

body_lines() {
  # PR 描述是不可信输入:只读、只 grep,任何内容都不进入求值位置。
  # GitHub 的正文是 \r\n 行尾,\r 会黏在提取出的路径尾上,这里一次剥掉。
  [[ -r "$PR_BODY_FILE" ]] || fail "process-gates: PR_BODY_FILE 不可读——按 fail-closed 红。"
  tr -d '\r' < "$PR_BODY_FILE"
}

# PR 描述里的 Spec: 引用路径(不验证,只提取;一行一个,去重)。
spec_ref_paths() {
  body_lines | grep -E "$SPEC_LINE_RE" | grep -oE "$SPEC_PATH_RE" | sort -u
}

# 验证一条规格引用:在 merge-base(= 主干)上存在且已冻结——铁律 3「规格只在主干上有效」,
# 同一个 PR 里新加的规格不能自我引用(盲审抓的自引漏洞)。
# 刻意在主 shell 里跑,不进子壳——命令替换里的 exit 只杀子壳,fail-closed 会被 if 吞掉。
validate_spec_ref() {
  local spec="$1" content
  if ! content="$(git show "$BASE_SHA:$spec" 2>/dev/null)"; then
    fail "M 闸:PR 描述引用了 $spec,但主干(merge-base)上没有这个文件。" \
      "规格只在主干上有效(铁律 3):先把它以 docs-only PR 合进主干,再开产品 PR——" \
      "规格-only PR 走 docs 快路,几分钟的事,不是官僚主义。"
  fi
  printf '%s' "$content" | grep -qE '^>?[[:space:]]*状态(:|：).*已冻结' || fail \
    "M 闸:主干上的 $spec 状态不是「已冻结」——引用只认冻结版。" \
    "冻结三步:Founder 本人在功能 issue 评论「S1 批准 $(basename "$spec")」→ 状态行改" \
    "「已冻结 · v1」→「批准:」行填该 issue 完整链接;然后经 docs-only PR 上主干。"
}

m1() {
  need_env PR_BODY_FILE
  resolve_base
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

  floor="$(printf '%s\n' "$product" | grep -E "$FLOOR_RE" | grep -vE "$TEST_PATH_RE" || true)"
  routes="$(added_files | grep -E "$NEW_ROUTE_RE" | grep -vE "$TEST_PATH_RE" || true)"
  if [[ -n "$floor$routes" ]]; then
    fail "M1 红:本 PR 碰了路径地板(钱路/数据库迁移/登录租户/新路由),无论轻重挡一律要已冻结规格引用。" \
      "命中地板的文件:" \
      "$(printf '  %s\n' $floor $routes)" \
      "修法:在 PR 描述里独立成行写  Spec: docs/specs/<名字>.md  (该规格须已冻结且已在主干)。"
  fi

  if body_lines | grep -qE "$LIGHT_LINE_RE"; then
    echo "M1 绿:轻挡勾选句在案。轻挡的定义是零行为变化(纯文案/间距的可见微调算轻挡)——如果这句是假的,S5 与人审收账。"
    return 0
  fi

  fail "M1 红:本 PR 碰产品代码,但 PR 描述里既无已冻结规格引用、也无轻改勾选句。" \
    "二选一,独立成行写在 PR 描述里:" \
    "  Spec: docs/specs/<名字>.md      (中/重挡:引用已冻结的 S1)" \
    "  轻改: 商家在 X 处看到 Y          (轻挡:零行为变化;纯维护写「商家可见行为无变化」)" \
    "已写却被判没写?检查:是不是行内混在句子里(要独立成行;- 列表前缀与全角冒号都认)。" \
    "碰到的产品文件(前 20):" \
    "$(printf '%s\n' "$product" | head -20 | sed 's/^/  /')"
}

m2() {
  # 规格形状闸:凡标「已冻结」的规格,形状必须齐——验收表、不做、异议栏、批准链接,
  # 且批准评论必须是 Founder 本人写的、且逐字含「S1 批准 <这份规格的文件名>」——
  # 签名绑定到规格(盲审 P1:只查「说过 S1 批准」会让一次批准传染给同 issue 的任何规格)。
  # 对整个 docs/specs/ 运行,不只对本 PR 改的文件:形状坏的冻结规格留在树上,
  # 每个后续 PR 都该红,直到有人修。
  local spec bad=0 frozen_count=0
  local -a seen_prefix_specs=() seen_prefix_names=()
  shopt -s nullglob
  for spec in "$SPECS_DIR"/*.md; do
    [[ "$(basename "$spec")" == "TEMPLATE.md" ]] && continue
    if ! grep -qE '^>?[[:space:]]*状态(:|：)' "$spec"; then
      echo "M2 红:$spec 没有「状态:」行——每份规格必须自报草稿/已冻结/已交付·归档。" >&2
      bad=1
      continue
    fi
    grep -qE '^>?[[:space:]]*状态(:|：).*已冻结' "$spec" || continue
    frozen_count=$((frozen_count + 1))

    if ! grep -qE '^\|[[:space:]]*[A-Z][A-Z0-9]{1,15}-A[0-9]+[[:space:]]*\|' "$spec"; then
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

    # 规格前缀全仓唯一(TEMPLATE 的承诺要有人执行):同一前缀出现在两份冻结规格里,
    # A 规格的测试就能替 B 规格的同名编号顶绿(盲审)。前缀取自验收表行。
    local prefix
    while IFS= read -r prefix; do
      [[ -n "$prefix" ]] || continue
      local i
      # ${#arr[@]} 护栏:bash 3.2(macOS 系统壳)在 set -u 下展开空数组会报 unbound
      [[ "${#seen_prefix_names[@]}" -gt 0 ]] || { seen_prefix_names+=("$prefix"); seen_prefix_specs+=("$spec"); continue; }
      for i in "${!seen_prefix_names[@]}"; do
        if [[ "${seen_prefix_names[$i]}" == "$prefix" && "${seen_prefix_specs[$i]}" != "$spec" ]]; then
          echo "M2 红:验收前缀 $prefix 同时出现在 ${seen_prefix_specs[$i]} 与 $spec——前缀全仓唯一,撞了 M3 就能张冠李戴。" >&2
          bad=1
        fi
      done
      seen_prefix_names+=("$prefix")
      seen_prefix_specs+=("$spec")
    done < <(grep -E '^\|' "$spec" | grep -oE '[A-Z][A-Z0-9]{1,15}-A[0-9]+' | sed 's/-A[0-9]*$//' | sort -u)

    local approval issue signer api_ok attempt
    approval="$(grep -m1 -E '^>?[[:space:]]*批准(:|：)' "$spec" || true)"
    issue="$(printf '%s' "$approval" | grep -oE 'issues/[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
    if [[ -z "$issue" ]]; then
      echo "M2 红:$spec 已冻结但「批准:」行里没有 issue 链接(https://github.com/$REPO/issues/<N>)。" >&2
      bad=1
      continue
    fi

    # 批准评论作者校验:冻结签名只认 Founder 本人 + 逐字含本规格文件名。
    # 拿不到 API = 判定不了 = 红(fail closed);但「API 不可达」与「签名不对」分开报,
    # 且重试 2 次——别让一次网络抖动把全仓 PR 染红还报错报错方向(盲审)。
    if [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then
      echo "M2 红:没有 GH_TOKEN,无法校验 $spec 批准评论的作者——fail closed。" >&2
      bad=1
      continue
    fi
    signer="" api_ok=""
    for attempt in 1 2 3; do
      if signer="$(gh api "repos/$REPO/issues/$issue/comments" --paginate \
          --jq "[.[] | select(.user.login == \"$FOUNDER_LOGIN\") | select(.body | contains(\"S1 批准\")) | select(.body | contains(\"$(basename "$spec")\"))] | length" \
          2>/dev/null | awk '{s+=$1} END {print s+0}')"; then
        api_ok=1
        break
      fi
      sleep $((attempt * 2))
    done
    if [[ -z "$api_ok" ]]; then
      echo "M2 红:GitHub API 三次都没答话,无法校验 $spec 的批准签名——这是 API 不可达,不是签名不对;重跑本检查即可。" >&2
      bad=1
      continue
    fi
    if [[ "${signer:-0}" -lt 1 ]]; then
      echo "M2 红:$spec 标了已冻结,但 issue #$issue 里找不到 $FOUNDER_LOGIN 本人写的、含「S1 批准 $(basename "$spec")」的评论。" >&2
      echo "  agent 代记无效;签名必须点名文件——请 Founder 本人在 https://github.com/$REPO/issues/$issue 评论:S1 批准 $(basename "$spec")" >&2
      bad=1
    fi
  done
  [[ "$bad" -eq 0 ]] || exit 1
  if [[ "$frozen_count" -eq 0 ]]; then
    echo "M2 绿:当前没有已冻结规格,无形状可验、无签名可查(诚实的空绿,不是「全验过了」)。"
  else
    echo "M2 绿:已验 $frozen_count 份冻结规格,形状齐全,批准签名均为 $FOUNDER_LOGIN 本人且点名了各自文件。"
  fi
}

m3() {
  # 验收↔测试映射闸:本 PR 引用的冻结规格,其验收编号必须逐字出现在测试文件里。
  # S4 早期允许 it.todo("XXX-A1 …") 占位——编号在,测试树就认;S5 前转正由验收把关。
  # 编号只从验收表行(| 开头)提取,说明文字里的示例编号不算数(盲审:模板占位符会被误抓)。
  need_env PR_BODY_FILE
  resolve_base
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

  # pathspec 覆盖仓库全部四种测试命名(盲审实测:.test.ts ×625、.spec.ts ×13 全在
  # e2e/journeys/——钱路验收恰恰住在那里,漏掉它闸会把人往弱测试推、.test.sh ×2、.test.mjs ×1)。
  while IFS= read -r spec; do
    while IFS= read -r id; do
      [[ -n "$id" ]] || continue
      if [[ -f "$ACCEPTANCE_EXEMPT_BOARD" ]] && grep -qE "^$id([[:space:]]|\$)" "$ACCEPTANCE_EXEMPT_BOARD"; then
        continue
      fi
      if ! git grep -l --fixed-strings "$id" "$HEAD_SHA" -- \
          '*.test.ts' '*.test.tsx' '*.test.mjs' '*.test.sh' '*.spec.ts' '*.spec.tsx' '*__tests__*' >/dev/null 2>&1; then
        echo "M3 红:验收编号 $id(来自主干冻结版 $spec)在测试文件里找不到。" >&2
        echo "  修法:写一条包含字符串 $id 的行为测试(单测或 e2e 旅程都认);S4 早期可先 it.todo(\"$id …\") 占位。" >&2
        bad=1
      fi
    done < <(git show "$BASE_SHA:$spec" | grep -E '^\|' | grep -oE '[A-Z][A-Z0-9]{1,15}-A[0-9]+' | sort -u)
  done <<< "$refs"
  [[ "$bad" -eq 0 ]] || exit 1
  echo "M3 绿:引用规格(主干冻结版)的验收编号全部在测试树里有落点。"
}

m4() {
  # 反「只藏不删」闸:新引入的功能开关(BETA_* / *_ENABLED)必须带保留理由和失效日期,
  # 否则「藏起来」会变成永久状态——一个开关值能藏起 5,844 行组件(手册轻挡教训)。
  need_env PR_BODY_FILE
  resolve_base
  # git grep 的 ERE 不认 \b(2026-08-28 演练实测:带 \b 零匹配)——整词边界用它自己的 -w;
  # -I 跳过二进制,免得二进制里的碰巧匹配混进开关名单(盲审)。
  local flag_re='(BETA_[A-Z0-9_]+|[A-Z0-9_]{2,}_ENABLED)'
  local base_flags head_flags new_flags flag bad=0
  base_flags="$(git grep -howIE "$flag_re" "$BASE_SHA" -- apps packages 2>/dev/null | sort -u || true)"
  head_flags="$(git grep -howIE "$flag_re" "$HEAD_SHA" -- apps packages 2>/dev/null | sort -u || true)"
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
    if ! body_lines | grep -qE '保留理由(:|：)' || ! body_lines | grep -qE '失效日期(:|：)[[:space:]]*2[0-9]{3}-[0-9]{2}-[0-9]{2}'; then
      echo "M4 红:本 PR 新引入开关 $flag,但 PR 描述里没有「保留理由:」+「失效日期: YYYY-MM-DD」。" >&2
      echo "  藏而不删要付两行字的价;到期不拆,heartbeat 会来收账。" >&2
      bad=1
    fi
  done <<< "$new_flags"
  [[ "$bad" -eq 0 ]] || exit 1
  echo "M4 绿:新开关都带保留理由与失效日期。"
}

m5() {
  # 归位闸(首版只管三个目录 + 闸门自守卫,按棘轮扩张——目录约定表建立前不全仓开管,
  # 防误报逼出豁免通胀):
  #   docs/specs/                     只收平铺的 .md 与两块豁免板 .txt
  #   packages/db/prisma/migrations/  只收 prisma 迁移的既有形状(8–14 位时间戳目录、
  #                                   migration.sql 与 rollback.sql——rollback 是本仓库
  #                                   既有安全惯例,20260619120000_org_tenant 为先例)
  #   docs/superpowers/               冻结历史区:不加新文件、不改旧文件(README.md 除外;
  #                                   删除放行——changed_files 已排除删除,冻结区删得掉)
  #   闸门文件自身                     改动必须在 PR 描述自报一行「闸门改动: <理由>」
  need_env PR_BODY_FILE
  resolve_base
  local file bad=0 gate_touched=""
  while IFS= read -r file; do
    if [[ "$file" =~ $GATE_FILES_RE ]]; then
      gate_touched="$gate_touched$file"$'\n'
      continue
    fi
    case "$file" in
      "$SPECS_DIR"/*)
        if ! [[ "$file" =~ ^docs/specs/[A-Za-z0-9._-]+\.(md|txt)$ ]]; then
          echo "M5 红:$file —— docs/specs/ 只收平铺的 .md 规格与豁免板 .txt,不收子目录与其他类型。" >&2
          bad=1
        fi
        ;;
      packages/db/prisma/migrations/*)
        if ! [[ "$file" =~ ^packages/db/prisma/migrations/([0-9]{8,14}_[a-z0-9_]+/(migration|rollback)\.sql|migration_lock\.toml)$ ]]; then
          echo "M5 红:$file —— 迁移目录只收 <时间戳>_<名字>/migration.sql|rollback.sql 与 migration_lock.toml。" >&2
          bad=1
        fi
        ;;
      docs/superpowers/README.md) ;;   # 冻结区的说明文件本身可维护
      docs/superpowers/*)
        echo "M5 红:$file —— docs/superpowers/ 已冻结为历史存档(手册废止表),不加新文件、不改旧文件(删除不拦)。" >&2
        echo "  现行规格的家是 docs/specs/。" >&2
        bad=1
        ;;
    esac
  done < <(changed_files)

  if [[ -n "$gate_touched" ]]; then
    echo "::warning::本 PR 改动了流程闸门自身的文件——请审阅者盯紧这部分 diff:"
    printf '::warning::  %s\n' $gate_touched
    if ! body_lines | grep -qE "$GATE_EDIT_LINE_RE"; then
      echo "M5 红:改动闸门文件必须在 PR 描述里独立成行自报「闸门改动: <理由>」——" >&2
      echo "  闸不能被顺手改哑;自报不是许可,是让改闸这件事在 PR 上无法安静发生。" >&2
      printf '  %s\n' $gate_touched >&2
      bad=1
    fi
  fi

  [[ "$bad" -eq 0 ]] || exit 1
  echo "M5 绿:本 PR 改动的文件都在自己的家里。"
}

notice() {
  # 事后规格公示(不拦截):冻结晚于分支首笔产品提交的规格,自动标记示众。
  # 「先干后补」最便宜的防线——示众不禁止,S5 与人审看着办。
  need_env PR_BODY_FILE
  resolve_base
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
