#!/usr/bin/env python3
"""逐 PASS 审计器（第 4 轮新增，与 count-verdicts.py 并列）。

做一件事：把 coverage-matrix.md 里**每一个判定为 PASS 的行**拉出来，配齐三样东西打印，
好让人逐分句核对「验收句只做了一半却整行 PASS」：

  ① 编号／登记行
  ② 验收原文 —— 逐字取自 `git show origin/main:docs/specs/<spec>.md`
     （编号行取 §2 验收表那一行；`§5 :NNN`／`fb:NNN` 取该文件第 NNN 行；取不到就说取不到，不编）
  ③ plan.md（冻结，一字未改）里点名这一条的判定口径 ＋ 本轮证据指针（矩阵证据列）

它**不下判定**。判定由人逐分句做，结论写进 report-round2.md §3「逐 PASS 分句审计」表。
用法：/usr/bin/python3 audit-pass-rows.py   （须在本目录下跑，须能 git show origin/main）
"""
import io, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

SEC = {'登录门', '产品身份', 'Creation', '前端基线'}
PREFIX_SPEC = {
    'SIGNIN': 'sign-in.md',
    'PRODID': 'brand-product-identity.md',
    'CREATE': 'creation-engine.md',
    'FRONT': 'frontend-baseline.md',
}
_cache = {}


def spec(name):
    """origin/main 上那份规格的逐行文本（只读，不取工作树的版本）。"""
    if name not in _cache:
        p = subprocess.run(['git', 'show', 'origin/main:docs/specs/' + name],
                           capture_output=True, text=True)
        _cache[name] = p.stdout.split('\n') if p.returncode == 0 else None
    return _cache[name]


def acceptance(label):
    """按编号／登记行取验收原文。取不到就说取不到，不猜、不改写。"""
    m = re.search(r'(SIGNIN|PRODID|CREATE|FRONT)-A(\d+)', label)
    if m:
        f = PREFIX_SPEC[m.group(1)]
        body = spec(f)
        if body is None:
            return '（取不到 %s）' % f
        head = '| %s-A%s |' % (m.group(1), m.group(2))
        for l in body:
            if l.startswith(head):
                return '%s §2 逐字：%s' % (f, l.strip())
        return '（%s 里找不到 %s-A%s 那一行）' % (f, m.group(1), m.group(2))
    m = re.search(r'fb:(\d+)', label) or re.search(r'§5\s*:(\d+)', label)
    if m:
        f = 'frontend-baseline.md' if 'fb:' in label else 'creation-engine.md'
        body = spec(f)
        if body is None:
            return '（取不到 %s）' % f
        n = int(m.group(1))
        if n > len(body):
            return '（%s 只有 %d 行，取不到第 %d 行）' % (f, len(body), n)
        return '%s:%d §5 登记行逐字：%s' % (f, n, body[n - 1].strip())
    return '（无编号／无行号：本行判定口径以 plan.md 那一行为准，见下）'


def plan_rows(label):
    """plan.md（冻结、一字未改）里点名这一条的行 —— 本轮的判定口径。"""
    keys = re.findall(r'(?:SIGNIN|PRODID|CREATE|FRONT)-A\d+', label)
    keys += re.findall(r'fb:\d+', label)
    keys += ['§5 :' + n for n in re.findall(r'§5\s*:(\d+)', label)]
    if not keys:
        keys = [label.strip('*` ')]
    out = []
    for i, l in enumerate(io.open('plan.md', encoding='utf-8').read().split('\n'), 1):
        if not l.startswith('|'):
            continue
        for k in keys:
            if k in l and l not in out:
                out.append('plan.md:%d %s' % (i, l.strip()))
                break
    return out


def main():
    src = io.open('coverage-matrix.md', encoding='utf-8').read().split('\n')
    sec = idx = None
    rows = []
    for l in src:
        if l.startswith('## '):
            sec = l[3:].split('（')[0].strip(); idx = None; continue
        if not l.startswith('|'):
            idx = None; continue
        cells = [x.strip() for x in l.strip().strip('|').split('|')]
        if '判定' in cells:
            idx = cells.index('判定'); continue
        if idx is None or sec not in SEC:
            continue
        if set(''.join(cells)) <= set('-: '):
            continue
        v = re.sub(r'[*~`]', '', cells[idx])
        if v.startswith('见上表'):
            continue
        m = re.search(r'(NOT RUN|PARTIAL|PASS|FAIL)', v)
        if m.group(1) != 'PASS':
            continue
        rows.append((sec, cells, idx, v))

    print('逐 PASS 审计：coverage-matrix.md 里判定为 PASS 的行，共 %d 行' % len(rows))
    print('（判定口径以 plan.md 为准；验收原文逐字取自 origin/main 的规格；本脚本不下判定）')
    for n, (sec, cells, idx, v) in enumerate(rows, 1):
        label = cells[1] if len(cells) > 1 else cells[0]
        print('\n' + '=' * 78)
        print('[%d] %s | 条目 %s | 编号/登记行 %s | 判定 %s' % (n, sec, cells[0], label, v))
        print('-- 验收原文 --')
        print('   ' + acceptance(label)[:1200])
        print('-- 本轮判定口径（plan.md，冻结）--')
        for r in plan_rows(label)[:4]:
            print('   ' + r[:400])
        print('-- 本轮证据指针（矩阵证据列）--')
        print('   ' + (cells[idx + 1] if len(cells) > idx + 1 else '（无）')[:600])
    return 0


if __name__ == '__main__':
    sys.exit(main())
