# 租户围栏 warn 基线重取（2026-09-19）＋ 无帧兜底实测清单

> 规格: `docs/specs/tenant-isolation.md`（已冻结 · v1，#1369）§1.3 第四态 / §1.8 先建帧后执法
> 票:   #1403（翻闸票）。前一次基线: `docs/audits/tenant-guard-warn-baseline-2026-09-14.md`
> 分支: `claude/tenant-money-enforce-flip-1403`（本文件是**翻闸前**的最后一次取数，取在本分支的
> 任何代码改动**之前**，主干 `bd5877c3`）

## 0. 一句话

翻闸前按票 #1403 的要求把 warn 日志重新取一次：staging 的日志缓冲里**一条都没有**（下一节说明为什么，
以及证据），所以按 2026-09-14 那次同样的办法重取 —— 守卫停在出厂 `warn` 挡位跑完全仓测试，把
`[tenant-guard][warn]` 全部捞出来。同一趟顺手把 §9.3 缺的那份清单也测了出来：**哪些调用点今天是靠
「无帧但字面 orgId 放行」那条兜底活着的**。

## 1. staging 日志这条路走不通（读到的原文）

两条 Railway 日志都拉了（只读）：

| 命令 | 拉到 | `tenant-guard` 行数 |
|---|---|---|
| `railway logs -s worker -e staging -p b5d13d78-…` | 500 行，覆盖 2026-09-19 01:44→09:47（UTC） | **0** |
| `railway logs -s web -e staging -p b5d13d78-…` | 33 行，全部是最近一次部署的容器启动输出 | **0** |

worker 那 500 行**全是** `[worker] heartbeat worker-wait <ts>`；web 那 33 行止于 `✓ Ready in 154ms`
加几条 `No API key provided for OpenAI tracing exporter`。两件事因此都成立：日志缓冲**够不着**观察轮
（web 只回溯到上次部署），而且这段时间 staging **没有商家流量**，一条 warn 也不会被打出来。

**所以本文件的基线是按 2026-09-14 那次的办法重取的**（票里允许的回退路径），不是 staging 日志。
下面每一条数字都标明了它是怎么来的。

## 2. 怎么取的（可复现，并且这次没有 `process.env`）

守卫的挡位**没动**（`packages/db/src/tenant-guard.ts` 仍是 `let orgScopedGuardMode = "warn"`），在守卫的
判定分支上临时加一段**落盘埋点**，跑完即撤 —— 本 PR **没有**提交那段代码（`git diff` 为空可证）。埋点记两类：

- `WARN` —— 观察轮抛出、被 `console.warn` 吞掉的那一句（`console.warn` 上有 19 个测试文件下了 spy，
  靠终端收集会漏，2026-09-14 那次已经踩过）；
- `FALLBACK-ALLOW` —— **本次新增**，也正是 2026-09-14 §7 明说「没有证明」的那一半：一次调用**没有帧**、
  落在钱表族（`orgId`）上、而守卫**放行**了它。放行的唯一理由就是那条兜底（`where` 里写着字面租户号，
  或 `data` 里带着 `orgId`）。

一个坑（2026-09-14 没有、这次踩到了）：埋点的开关**不能读环境变量**。`packages/core/src/env-contract.test.ts`
会扫产品源码里每一个 `process.env.X` 并要求它在 `ENV_CONTRACT` 里登记 —— 第一次跑当场红在
`TENANT_GUARD_SINK` 上。改成写死路径的常量之后通过。（这条闸是对的：它挡住的正是「往产品代码里塞一个
没人登记的开关」。）

跑的是 CI 的同一条命令（自己建随机 `*_test` 库、跑完 drop）：

```
DATABASE_URL=postgresql://fikirtive:fikirtive@127.0.0.1:5432/fikirtive_test \
FIKIRTIVE_TEST_DB=tg1403base_9f3c21_test pnpm quality --leg tests
```

**全绿**（exit 0，390s）：

| 套件 | 测试文件 |
|---|---|
| `packages/core` | 75 passed |
| `packages/db` | 46 passed + 1 skipped |
| `packages/otto` | 99 passed |
| `packages/generation` / `storage` / `token-crypto` | 6 / 6 / 1 passed |
| `apps/worker` | 73 passed |
| `apps/web` | 634 passed |

## 3. warn 清单：1858 条，18 个签名

一个「签名」= 表 . 操作 + 守卫给的那句拒绝理由。翻 enforce 当天，同一个签名下的每一次调用都会
从「记一条警告」变成「抛异常」。

| # | 签名 | 次数 | 类别 | 翻闸当天 |
|---|---|---|---|---|
| 1 | `Membership.findFirst` 无 orgId 过滤 | 905 | A 生产·无帧读 | **会 500**（登录解析 = 雷②） |
| 2 | `Membership.upsert` 无帧不许写 | 211 | B 生产·system 帧写 | **会 500**（注册/身份合流 = 雷①） |
| 3 | `Membership.updateMany` 无帧不许写 | 208 | B | **会 500**（同上） |
| 4 | `Membership.deleteMany` 无 orgId 过滤 | 152 | C 仅夹具 | 测试红，商家无感 |
| 5 | `CreditAccount.upsert` 无帧不许写 | 142 | B | **会 500**（开户赠额 / 充值确认 = 雷③） |
| 6 | `CreditLedger.createMany` 无帧不许写 | 138 | B | **会 500**（同上） |
| 7 | `CreditLedger.findMany` 无 orgId 过滤 | 27 | C（生产侧已建帧，见 §5） | 测试红 |
| 8 | `CreditLedger.deleteMany` 无 orgId 过滤 | 18 | C | 测试红 |
| 9 | `CreditAccount.deleteMany` 无 orgId 过滤 | 13 | C | 测试红 |
| 10 | `Membership.findFirstOrThrow` 无 orgId 过滤 | 9 | C | 测试红 |
| 11 | `Membership.deleteMany` 无帧不许写 | 7 | C | 测试红 |
| 12 | `CreditLedger.create` 无帧不许写 | 7 | B | **会 500**（充值确认 = 雷③） |
| 13 | `Membership.findFirst` 碰了帧外的租户 | 6 | **A′ 生产·有帧但形状被拒** | **会 500**（雷②的第二副面孔，见 §4） |
| 14 | `Membership.update` 无 orgId 过滤 | 4 | C | 测试红 |
| 15 | `CreditLedger.count` 无 orgId 过滤 | 4 | C | 测试红 |
| 16 | `Membership.count` 无 orgId 过滤 | 2 | C | 测试红 |
| 17 | `CreditAccount.count` 无 orgId 过滤 | 2 | C | 测试红 |
| 18 | `CreditLedger.create` 写到别家 / `CreditAccount.findMany` 碰了帧外的租户 | 2+1 | D 守卫自测故意造 | 本来就该拒 |

A(905+6) · B(706) · C(211) · D(3) = 1858。

**与 2026-09-14 那份的差别**：签名集合一致，次数不同（那次 1753 / 19 个签名）。次数只在同一轮内可比 ——
中间合了十几个 PR，测试文件数从 607 涨到 634。**没有新签名出现，也没有一条是 `adjustWindowFilter()`
那个形状打出来的**（四颗形状雷在 PR #1458 已根治，这一轮再次确认它们没有回来）。

## 4. 签名 13：雷②其实有两副面孔（本次新发现的细节）

`Membership.findFirst 碰了帧外的租户` 这 6 条来自
`actor-library-seed.test.ts` / `brand-product-identity.test.ts` / `edit-desk-tenant-chain.test.ts` ——
它们**不是**守卫自测。同一句生产代码（`apps/web/lib/auth-guard.ts:88` 的
`{ userId, orgId: { not: FOUNDER_OWNER_ID } }`）有两种下场，取决于调用时**有没有帧**：

- **无帧**（正常登录路径）⇒ 签名 1「无 orgId 过滤」；
- **嵌在别人的帧里**（测试里换个身份再 `requireOwner()`）⇒ `not` 形状在 `scopeWhere` 里点不出确定的
  租户集合 ⇒ 签名 13「碰了帧外的租户」。

两副面孔同一个根：这句读**结构上无帧可建**（此刻还不知道这个人属于哪一家）。所以修法只有一个 ——
把它放进**扫描域**帧（`system` + `ownerId === null`），`findFirst` 在 `SYSTEM_SCAN_OPS` 里，两条路一起消失。
本 PR 就是这么修的。

## 5. 生产调用点（file:line，逐条追到外层帧）

**A/A′/B 三类 —— 翻闸当天真的会 500 的那几处**：

| 签名 | 生产调用点 | 外层帧（今天） | 本 PR 的修法 |
|---|---|---|---|
| 1、13 | `apps/web/lib/auth-guard.ts:88`（`requireOwner` 解析这个人属于哪一家） | **无帧** | `runAsSystem("auth:resolve-tenant")` 扫描域帧（只读） |
| 2、3 | `apps/web/lib/auth-guard.ts:278`、`:290`（注册补建 membership） | `runAsSystem("auth:bootstrap-personal-org")`，**未点名租户** | 整笔事务进 `runAsTenant(orgId)` |
| 2 | `apps/web/lib/better-auth/converge.ts:93`（founder 身份合流） | `runAsSystem("auth:converge-identity")`，**未点名租户** | 那笔事务进 `runAsTenant(FOUNDER_OWNER_ID)` |
| 5、6 | `packages/db/src/credits.ts` 的 `grantCreditsTx`（开户赠额，跑在上面那笔事务里） | 同上 | 随事务的 `runAsTenant` 一起解决 |
| 5、6、12 | `packages/db/src/credits.ts` 的 `grantCredits`（充值确认），调用点 `apps/web/app/api/stripe/webhook/route.ts:227` | `runAsSystem("stripe-webhook")`，**未点名租户** | 那一句进 `runAsTenant(orgId)`（与同文件 `:240` 已有的两段式写法逐字相同） |

**C 类（只在测试夹具里）**：`deleteMany` / `count` / `update` / `findFirstOrThrow` 这一族在整个仓库的
**生产代码里一个调用点都没有**，是 `beforeEach` / `afterEach` 清场留下的。翻闸当天打不到商家，要修的是
测试夹具。本 PR 随翻闸一起修（不修就是 CI 红）。

**已核实**已经在帧里、翻闸当天不会 500 的两处（2026-09-14 §4 点名过，这次重核）：

- `packages/db/src/credits.ts:584` `adjustWindowRows` 的全 org 报表口径 —— 唯一生产调用点
  `apps/web/lib/admin-v2.ts:715`，跑在 `runAsSystem("admin:platform-read")`（同文件 `:418`）里 ⇒ 扫描域放行。
- `apps/web/lib/tenant-actions.ts:206` 撤邀请的 `not` 形状 —— 跑在 `runAsStaff(staffPrincipal(gate, null))`
  （同文件 `:185`）里 ⇒ 扫描域放行。**票 #1403 2026-09-13 评论点名的那个数据点确实消失了**，原因就是
  切片④（#1379）；这一轮 1858 条里它一条也没有，符合预期。

## 6. 无帧兜底实测清单（§9.3 缺的那一半，本次补上）

**4640 次放行、122 个文件**靠「无帧但字面 orgId 放行」活着。按操作分：

| 操作 | 次数 | 操作 | 次数 |
|---|---|---|---|
| `Membership.findFirst` | 1545 | `CreditLedger.createMany` | 156 |
| `CreditAccount.create` | 780 | `CreditAccount.findUnique` | 80 |
| `CreditLedger.findMany` | 355 | `CreditAccount.findFirstOrThrow` | 49 |
| `CreditLedger.create` | 332 | `CreditLedger.deleteMany` | 40 |
| `CreditAccount.findUniqueOrThrow` | 261 | `Membership.deleteMany` | 39 |
| `CreditLedger.findFirst` | 176 | `CreditLedger.count` | 37 |
| `CreditAccount.update` | 176 | `Membership.create` | 36 |
| `Membership.createMany` | 170 | `CreditAccount.deleteMany` | 33 |
| `CreditAccount.updateMany` | 164 | `CreditAccount.upsert` | 24 |
| `Membership.findMany` | 161 | 其余 11 种 | 各 ≤ 4 |

按包分：`apps/web` 2861 次 · `packages/db` 1264 次 · `apps/worker` 515 次。
**其中 99 个文件靠的是无帧的「写」**（`create` / `createMany` / `update` / `updateMany` / `upsert` /
`delete` / `deleteMany` 共 1961 次）。

### 6.1 这 122 个文件是什么（这是收兜底的真实代价）

**122 个全是测试文件**（埋点带的是「哪个测试文件在跑」）。绝大多数是两种形状：

1. **播种**：`prisma.creditAccount.create({ data: { orgId, balance } })` 之类，在 `beforeEach` 里建钱账；
2. **断言**：`prisma.creditLedger.findMany({ where: { orgId } })` 之类，跑完数一数账本行。

没有单一收口点：31 个文件走 `packages/db/test/setup.ts` 的 `seedOrg`，另外 71 个文件自己 inline 写。
**逐文件清单已随本文件入库**：`tenant-warn-baseline-2026-09-19-files.txt`（同目录，122 行，
每行「放行次数 / 其中无帧写的次数 / 仓库相对路径」，合计行与本节数字逐条对得上）。收兜底那一票
（#1497）照着它逐个文件改，不需要再跑一遍埋点。

### 6.2 生产侧靠兜底活着的调用点（逐条读过代码）

埋点只答得出「哪个测试文件在跑」，答不出「哪一行生产代码」（Prisma 的异步边界吃掉调用栈 ——
2026-09-14 §1 已实测并记录）。所以生产侧这一段是**静态读出来的**，每一条都追到了外层帧：

| 生产调用点 | 形状 | 为什么今天无帧 |
|---|---|---|
| `apps/web/lib/auth-guard.ts:146` `resolveUserPrincipal` | `{ orgId: gate.ownerId, status, deletedAt, user: { email } }` | **它就是造帧的那个函数** —— 帧的内容（membershipId / orgRole / subjectUserId）正是这一句读出来的，帧不可能已经存在 |
| `apps/web/lib/customer-inbox-gateway.ts:58` | 同形状 | 同上：四个 CRM 网关各自在 `runRead` / `runMutation` 建帧**之前**解析成员身份 |
| `apps/web/lib/customer-broadcast-gateway.ts:46` | 同形状 | 同上 |
| `apps/web/lib/customer-broadcast-report-gateway.ts:36` | 同形状 | 同上 |
| `apps/web/lib/customer-workflow-gateway.ts:55` | 同形状 | 同上 |

这五处是「先读才知道租户」的鸡生蛋结构在**登录/权限**这一面的翻版（规格 §4 异议栏点名的是队列那一面）。
收兜底时它们各自要一个**具名扫描域帧**（和本 PR 给 `auth-guard.ts:88` 的那个同一形状），不是靠兜底。

其余生产调用点（`org-role-guard.ts:37`、`member-directory-service.ts:76/88`、四个 `customer-*-service.ts`、
`profile-names.ts:54`、`profile-actions.ts:60`、`tenant-admin.ts:138/204`、`tenant-actions.ts:33/68/301`、
`conversation-admin.ts:49`、`credits.ts` 的 23 处、`account-actions.ts` / `spend-history-data.ts` 各 3 处、
worker 的 `gen.ts` / `refgen.ts` / `understand.ts` / `stripe-reconcile.ts` / `ledger-conservation.ts`）
**都在调用方的帧里**（`runAsUser` / `runAsTenant` / `runAsStaff` / `runAsSystem`），逐个读过。

### 6.3 结论：兜底本 PR **不收**，理由与下一步

编排者 2026-09-19 的裁定是「**每一处靠它活着的站点都已经在帧里**就同批收掉；还有站点需要它就为那些站点
保留、列出来、说明理由」。实测结果是**条件不成立**：

- **生产侧**：§6.2 的五处**结构性无帧**（造帧的那一步自己要先读一次库）。收掉兜底要先给这五处各建一个
  具名扫描域帧 —— 可做，但那是登录与四个 CRM 网关的入口改动，不是翻闸这一件事。
- **测试侧**：122 个文件（其中 99 个靠无帧写）。收兜底＝在翻闸这一次提交里再改 122 个测试文件，
  **一行产品行为都不会变**。

翻闸提交必须保持「只改一件事、一次 revert 可回滚」（规格 §1.8 硬顺序 + 2026-09-14 §9.1 写死的配方），
所以本 PR 只翻闸、只收挡位开关，**兜底原样保留、一个字不放宽**。§9.3 当初说「收口的前提是先有一份实测
清单」——**这份清单就是本节**，收兜底那一票现在有据可依了。建议的下一票范围：五处扫描域帧 + 122 个测试
文件的夹具改造 + 守卫无帧分支改成「钱面无帧即拒」，独立验收、独立回滚。

## 7. 这份基线证明不了什么（别拿它当全量）

- 它测的是**测试套件走过的路**，不是生产流量。staging 这一轮拿不到任何真实流量数据（§1）。
- 次数只在同一轮内可比：夹具类签名的次数跟着测试文件数走，改一次测试就变。
- `FALLBACK-ALLOW` 的归属只到**测试文件**级；生产调用点那一段是静态读出来的（§6.2），
  不是跑出来的 —— 读漏一处的风险由「翻闸后全套测试 + required CI 全绿」兜底，不由本节声称。

## 8. 原始数据

埋点落盘的原始 TSV 共 6498 行（`WARN` 1858 行 ＋ `FALLBACK-ALLOW` 4640 行），留在本机 scratchpad，
重启即失（本机 scratchpad 的已知性质）。**从它里面救出来并入库的是**：

- `tenant-warn-baseline-2026-09-19-files.txt`（同目录）—— 兜底那 4640 次放行的**逐文件**汇总，
  122 行，合计行写明 4640 次 / 122 个文件 / 99 个文件靠无帧的写（1961 次）。

没入库的是逐行原始 TSV（每一行一次放行，带模型与操作名）—— 它的结论已经在本文件 §3 / §6 的
两张表与上面那份清单里。要复现全部，按 §2 的三步重跑一遍即可（约 7 分钟机器时间）。
