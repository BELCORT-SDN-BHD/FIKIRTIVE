#!/usr/bin/env bash

# 《开发作业手册》自毁开关:三条死亡指标,每日由机器核算,命中自动开 issue 点名 Founder。
# Founder 2026-08-28 批准落地。
#
# 为什么存在:上一套流程的死法是「没人宣布死亡,它只是停了」——162 份文件的规格体系
# 7 月下旬停摆,36 天后才被审计发现。这套手册如果死,至少死得响:
#   指标一  连续 7 天有产品提交、docs/specs/ 零新增       → 「流程已停摆」issue
#   指标二  规格冻结后 48 小时内改签 ≥2 次                → 「S1 模板要复盘」issue
#   指标三  同一验收编号被 S5 打回 2 轮(评论里数标记)    → 「强制回 S1」issue
#
# 执行人是机器,不是任何人的自觉:终审原话——不能用「AI 记得报告」守一套防「AI 记得」
# 失灵的制度。本脚本不挂在合并必经链上(不是必需检查),红了不拦任何人,只报警。
#
# 环境:GH_TOKEN(开 issue / 搜评论);在 process-heartbeat.yml 的每日 cron 里跑。

set -euo pipefail

REPO="BELCORT-SDN-BHD/FIKIRTIVE"
FOUNDER_LOGIN="nicksgan-belcort"
SPECS_DIR="docs/specs"

# 同名 open issue 已在 = 已经报过警还没人处理,不重复开(报警器响一次就够,响十次是噪音)。
# 不用 GitHub search(中文分词与特殊字符不稳,盲审):拉全量 open 列表本地逐字比对。
# 列表拿不到就整个脚本红——「查不到」不等于「没报过」,静默时每天重开一张才是真噪音。
open_issue_exists() {
  local title="$1"
  local titles
  titles="$(gh issue list --repo "$REPO" --state open --limit 500 --json title --jq '.[].title')" \
    || { echo "heartbeat: 拉不到 open issue 列表,无法去重——fail closed,本次不开票并把 job 标红。" >&2; exit 1; }
  grep -qxF "$title" <<< "$titles"
}

alarm() {
  local title="$1" body="$2"
  if open_issue_exists "$title"; then
    echo "heartbeat: 「$title」已有 open issue,不重复报警。"
    return 0
  fi
  gh issue create --repo "$REPO" --title "$title" --body "$body" >/dev/null
  echo "heartbeat: 已开 issue——$title"
}

# ── 指标一:流程停摆 ─────────────────────────────────────────────────────────
# 「活着」的判据不是「有新规格文件」——一份冻结规格带着几周施工是手册的正常形态,
# 冻结后第 8 天还照着它写代码不叫停摆(盲审)。活着 = 近 7 天 docs/specs/ 有任何提交
# (新增、改签、变更登记都算),或近 7 天合并的 PR 里有人带过 Spec:/轻改 引用。
check_stall() {
  local product_commits spec_commits ref_prs
  product_commits="$(git log --since=7.days --format=%H -- apps packages | wc -l | tr -d ' ')"
  spec_commits="$(git log --since=7.days --format=%H -- "$SPECS_DIR" | wc -l | tr -d ' ')"
  ref_prs="$(gh pr list --repo "$REPO" --state merged --limit 100 --json body,mergedAt \
    --jq "[.[] | select(.mergedAt >= \"$(date -u -v-7d +%Y-%m-%d 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%d)\") | select(.body | test(\"(Spec|轻改)(:|：)\"))] | length" \
    2>/dev/null || echo 0)"
  echo "heartbeat: 近 7 天产品提交 $product_commits 笔,docs/specs/ 提交 $spec_commits 笔,带流程标记的已合并 PR ${ref_prs:-0} 张。"
  if [[ "$product_commits" -gt 0 && "$spec_commits" -eq 0 && "${ref_prs:-0}" -eq 0 ]]; then
    alarm "[流程] 已停摆:近 7 天有产品提交、docs/specs/ 零新增" \
"@$FOUNDER_LOGIN 自毁开关指标一命中(机器核算,非人工报告):

- 近 7 天产品提交:$product_commits 笔
- 同期 docs/specs/ 提交:0 笔;带 Spec:/轻改 标记的已合并 PR:0 张

《开发作业手册》的判词:产品在动而规格不动,说明流程在被绕过或已死亡——不许默默续命。
要么有人在跳过 S1(查最近的 PR 是不是全走了「轻改」),要么这 7 天确实全是轻挡(那也该看一眼是否属实)。

处置选项:修流程、或正式废止它。二选一,不选也是一种死法——上一套就是这么死的。"
  fi
}

# ── 指标二:冻结后改签过频 ───────────────────────────────────────────────────
check_resign_churn() {
  local spec commits n first last span
  shopt -s nullglob
  for spec in "$SPECS_DIR"/*.md; do
    [[ "$(basename "$spec")" == "TEMPLATE.md" ]] && continue
    grep -qE '^>?[[:space:]]*状态(:|：).*已冻结' "$spec" || continue
    # 近 7 天里改动了「状态/批准」行的提交,时间升序;冻结 + ≥2 次改签 = 至少 3 笔,
    # 且首尾相隔 ≤48h 才算「48 小时内改签 ≥2 次」。
    commits="$(git log --since=7.days -G'^>?[[:space:]]*(状态|批准)(:|：)' --format=%ct --reverse -- "$spec" || true)"
    n="$(printf '%s\n' "$commits" | grep -c . || true)"
    [[ "${n:-0}" -ge 3 ]] || continue
    first="$(printf '%s\n' "$commits" | head -1)"
    last="$(printf '%s\n' "$commits" | tail -1)"
    span=$(( last - first ))
    if [[ "$span" -le $(( 48 * 3600 )) ]]; then
      alarm "[流程] 规格改签过频:$(basename "$spec") 48 小时内状态/批准行动了 $n 次" \
"@$FOUNDER_LOGIN 自毁开关指标二命中:\`$spec\` 的状态/批准行在 48 小时窗口内被改了 $n 次(冻结 + ≥2 次改签)。

手册的判词:冻结版本被反复改签,说明 S1 的定义写法有问题——该复盘的是模板,不是继续改签。
处置:开一次 S1 模板复盘(哪一问没问到位,导致定义不稳),把漏掉的问补进九问。"
    fi
  done
}

# ── 指标三:同一验收编号 S5 打回 2 轮 ────────────────────────────────────────
# 约定(TEMPLATE.md 里写明):S5 打回时在功能 issue 评论里写一行「S5 打回 <编号>」。
# 机器只数这个标记——没有标记的打回数不到,这是诚实的边界,不是全知的承诺。
check_double_bounce() {
  local since issues issue ids id cnt _
  since="$(date -u -v-14d +%Y-%m-%d 2>/dev/null || date -u -d '14 days ago' +%Y-%m-%d)"
  # gh issue list 默认只取 30 条——本仓 issue 已过千,不加 --limit 报警器会静默漏报(盲审)。
  issues="$(gh issue list --repo "$REPO" --state all --limit 500 --search "updated:>=$since" --json number --jq '.[].number' 2>/dev/null || true)"
  if [[ "$(printf '%s\n' "$issues" | grep -c . || true)" -ge 500 ]]; then
    echo "heartbeat: 警告——issue 枚举打到 500 条上限,可能有截断;指标三的覆盖不完整。" >&2
  fi
  for issue in $issues; do
    ids="$(gh api "repos/$REPO/issues/$issue/comments" --paginate \
      --jq '.[].body' 2>/dev/null | grep -oE 'S5 打回 [A-Z][A-Z0-9]{1,15}-A[0-9]+' | sort | uniq -c || true)"
    [[ -n "$ids" ]] || continue
    # uniq -c 的行形如「   2 S5 打回 CANVAS-A1」:第 1 词是计数,第 4 词才是编号。
    while read -r cnt _ _ id; do
      [[ -n "${id:-}" ]] || continue
      if [[ "$cnt" -ge 2 ]]; then
        alarm "[流程] S5 双打回:$id 强制回 S1(issue #$issue)" \
"@$FOUNDER_LOGIN 自毁开关指标三命中:验收编号 \`$id\` 在 issue #$issue 里被「S5 打回」了 $cnt 轮。

手册的判词:同一条验收打回两轮,说明不是施工问题,是定义问题——不许第三轮硬修。
处置:回 S1,重新 grill 这一条(商家做 X → 看到 Y 到底指什么),改签规格后再施工。"
      fi
    done <<< "$ids"
  done
}

check_stall
check_resign_churn
check_double_bounce
echo "heartbeat: 三项指标核算完毕。"
