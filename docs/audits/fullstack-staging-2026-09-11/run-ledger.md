# Round 2 走查执行记录（run-ledger）

> 本文件是 W1 走查者的**现场记录**，不是结论。判定汇总见 `coverage-matrix.md`，问题见 `findings-catalog.md`，合成报告 `report-round2.md` 由后续 worker 写。
> 范围依据：`plan.md`（一字未改）。执行者：W1（终端 worker）。日期：2026-09-11（UTC）。

---

## §0 Preflight（plan.md §0 三件）

### P0-1 版本对齐 — PASS

`/api/health` 原文（UTC 2026-09-11T11:58:28Z）：

```
{"ok":true,"db":"up","worker":"up","workers":{"worker":"up"},"backup":"missing","migrations":"applied","build":{"sha":"2a96750e","ref":"main"}}
```

`/api/ready` 原文（UTC 2026-09-11T11:58:29Z）：

```
{"ready":true,"db":"up","migrations":"applied"}
```

Railway 部署（project `b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`、environment staging）：

| service | deployment id | status | createdAt (UTC) | commitHash |
|---|---|---|---|---|
| web | 51f973fd-9f25-4928-8d9e-6f42105de442 | SUCCESS | 2026-09-11T11:39:15.367Z | 2a96750eb506f4419d06032494470a8d01d22972 |
| worker | 64417a88-b437-4583-a012-9d84f2eca3a3 | SUCCESS | 2026-09-11T11:39:15.367Z | 2a96750eb506f4419d06032494470a8d01d22972 |

结论：web 与 worker **同版**，且与 `/api/health` 的 `build.sha=2a96750e` 一致；与本走查 worktree 的基准 commit 相同。`"backup":"missing"` 照录（第一轮同现象，不在本轮范围）。

### P0-2 前置票状态 — 14/15 已上线，1 张未合并

`gh issue view` / `gh pr view` 现查（2026-09-11）：

| 票 | 状态 | 对应 PR | PR 状态 | merge commit | 在 2a96750e 祖先链 |
|---|---|---|---|---|---|
| #1310 Google 回调配置 | CLOSED | — | — | — | （配置类，无 PR） |
| #1316 登录门① | CLOSED | — | — | — | 上线（早于 #1347） |
| #1317 登录门② | CLOSED | — | — | — | 上线 |
| #1318 登录门③ | CLOSED | #1347 | MERGED 2026-09-11T04:34:41Z | 32ad40fa | YES |
| #1319 登录门④ | CLOSED | #1345 | MERGED 2026-09-11T11:39:13Z | 2a96750e | YES（即部署版本本身） |
| #1320 登录门⑤ | **OPEN** | #1349 | **OPEN** | — | NO |
| #1321 Brand① | CLOSED | — | — | — | 上线 |
| #1322 Brand② | CLOSED | #1343 | MERGED 2026-09-11T02:46:56Z | d6c5e247 | YES |
| #1323 Brand③ | CLOSED | #1346 | MERGED 2026-09-11T04:51:07Z | bbce50b6 | YES |
| #1324 Creation① | CLOSED | #1341 | MERGED 2026-09-11T04:19:22Z | bce42f89 | YES |
| #1325 Creation② | CLOSED | #1340 | MERGED 2026-09-11T05:26:38Z | 04fe588a | YES |
| #1326 Creation③ | CLOSED | — | — | — | 上线 |
| #1327 Creation④ | CLOSED | — | — | — | 上线 |
| #1328 Creation⑤ | CLOSED | — | — | — | 上线 |
| #1329 Creation⑥ | CLOSED | #1342 | MERGED 2026-09-11T04:08:20Z | 857dcdd0 | YES |

祖先链核对：`git merge-base --is-ancestor <merge-commit> 2a96750e` → 7/7 YES。

**计划表已过期的两行**（plan.md §1.2 记的是写计划当时的状态）：#1340（Creation②）与 #1345（登录门④）计划里写 `OPEN`，现查均已 MERGED 并随本次部署上线 → R2-12 与 R2-05 **可执行**，不标 `NOT RUN（未部署）`。
**仍未上线的一张**：#1349（登录门⑤）OPEN → 按派工口径，R2-03 排到**最后**执行，执行前重查 PR 状态与 `/api/health` 的 sha。

### P0-3 环境边界复述

| 边界 | 现查事实 | 与第一轮的差别 |
|---|---|---|
| 素材存储 | staging `R2_BUCKET=fikirtive-staging`；production `R2_BUCKET=fikirtive-production`；两边 `STORAGE_DRIVER=r2` | **第一轮 ENV-01「与 production 共享素材存储」在本轮已不成立**（两个桶名不同）。Founder 本轮给的共享存储豁免因此用不上；仍照 Founder 令执行：上传文件名一律前缀 `r2-20260911-`、走完列清单、不删任何素材 |
| provider 路由 | `COWORK_PROVIDER=fal`、`COWORK_PAID_PROVIDERS_ALLOWED=true`、`OTTO_DEFAULT_VIDEO_MODEL=seedance-2-mini` | 与第一轮 ENV-02 同形状（付费 provider 已放行＝真引擎会真花钱） |
| 备份 | `/api/health` → `"backup":"missing"` | 与第一轮同（不在本轮范围，照录） |
| `E2E_GOOGLE_DOOR_STUB` | staging web **未设置**（51 个变量里无此键） | plan.md §1.2 口径②满足：Google 门结论不因替身失效，不标 BLOCKED |
| `SIGNUPS_PAUSED` | staging web **未设置**（原值形状＝键不存在；还原＝删除该变量） | A6 需临时新增，走完立即删除还原 |
| 其它 | `AUTH_ENABLED=true`、`NORTHSTAR_PREVIEW=1`、`FIKIRTIVE_ENV_CONTRACT=warn`、`FOUNDER_ADMIN_EMAILS=tools@belcort.com`、`AUTH_ALLOWED_EMAILS` 有四个条目（含 `tools@belcort.com`） | — |

读变量方式：`railway variables -p … -e staging -s web --json`，只取键名与**非密钥**配置值；密钥类变量的值一律未读取、未落盘（临时 json 已 `rm`）。production 只读 `R2_BUCKET`／`STORAGE_DRIVER` 两格用于判 ENV-01，**未做任何写入**。

### 钱路换算口径（Founder 令：写常量名，不写死数字）

`packages/core/src/spend.ts`：`CREDITS_PER_USD`、`INTERNAL_PER_DISPLAY`、`SIGNUP_GRANT_CREDITS`、`displayCredits()`。
换算式：`USD = internalCredits / CREDITS_PER_USD`；`displayed = internalCredits / INTERNAL_PER_DISPLAY`；故 `USD = displayed × INTERNAL_PER_DISPLAY / CREDITS_PER_USD`。
本轮预算上限 USD 20（Founder 2026-09-11 #1330 评论），80% 停手报进度、100% 立停；逐笔登记见文末「§4 预算表」。

---

## 走查流水（按 plan.md §3.2 顺序，R2-03 最后）

（下文按条目追加。截图 `NN-短描述.png`，整屏 `screencapture -x`，视口尺寸逐条记。）

## §4 预算表（每一次花钱的动作一行）

| # | 时间(UTC) | 条目 | 动作 | 入口 | GenJob id | 报价(displayed credits) | ledger reserve | ledger settle/refund | 供应商成本快照(USD) | 结果 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | 尚未发生 | — | — | — | — | — | — | — | — |

累计商家侧扣费：0 displayed credits ＝ USD 0.00（换算式见上）。距 80% 停手线尚远。
