#!/usr/bin/env python3
"""逐行重数 coverage-matrix.md 的判定格。口径：只数四张判定表的数据行；
Preflight 三行是前置检查不计入；前端基线表里标「见上表」的三行是重复引用，不重复计数。"""
import io,re,collections
src=io.open('coverage-matrix.md',encoding='utf-8').read().split('\n')
SEC={'登录门','产品身份','Creation','前端基线'}
sec=None; idx=None; c=collections.defaultdict(collections.Counter); n=collections.Counter()
for line in src:
    if line.startswith('## '):
        sec=line[3:].split('（')[0].strip(); idx=None; continue
    if not line.startswith('|'): idx=None; continue
    cells=[x.strip() for x in line.strip().strip('|').split('|')]
    if '判定' in cells: idx=cells.index('判定'); continue
    if idx is None or sec not in SEC: continue
    if set(''.join(cells))<=set('-: '): continue
    v=re.sub(r'[*~`]','',cells[idx])
    if v.startswith('见上表'): continue          # 重复引用行
    m=re.search(r'(NOT RUN|PARTIAL|PASS|FAIL)',v)
    c[sec][m.group(1)]+=1; n[sec]+=1
order=['PASS','PARTIAL','FAIL','NOT RUN']
print('%-8s %5s %6s %8s %5s %8s'%('表','行数',*order))
t=collections.Counter()
for s in ['登录门','产品身份','Creation','前端基线']:
    print('%-8s %5d %6d %8d %5d %8d'%(s,n[s],*[c[s][k] for k in order])); t.update(c[s])
print('%-8s %5d %6d %8d %5d %8d'%('合计',sum(n.values()),*[t[k] for k in order]))
