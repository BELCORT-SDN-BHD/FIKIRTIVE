# 租户围栏 warn 基线重取（2026-09-14）

> 规格: `docs/specs/tenant-isolation.md`（已冻结 · v1，#1369）§1.3 第四态 / §1.8 先建帧后执法
> 票:   #1403（「翻闸前请把 warn 日志重新取一次基线，别拿切片④合并之前的日志当依据」）
> 分支: `claude/tenant-enforce-prework-1403`（基线跑在本分支的根治提交之后）

## 0. 一句话

守卫停在出厂 `warn` 挡位跑完 packages/db、apps/worker、apps/web 三套测试，把 `[tenant-guard][warn]`
那一行全部捞出来：**这就是翻 enforce 当天会当场失败的完整清单**。本文件最后一节是翻闸配方与待
Founder 定调的那一个问题。

## 1. 这份基线是怎么取的（可复现）

守卫的挡位**没动**（`packages/db/src/tenant-guard.ts` 仍是 `let orgScopedGuardMode = "warn"`），三套测试
按各自的方式跑完，每条 `[tenant-guard][warn]` 落一行。

一个坑必须写下来，否则下次取基线的人会拿到一份偏小的清单：**不能靠 `console.warn` 收集**。仓库里有
19 个测试文件对 `console.warn` 下了 `vi.spyOn`，一个被 spy 吃掉的警告在终端上根本不出现。所以本次
在守卫的 warn 分支上临时加了一个**文件落盘**（spy 拦不住 `appendFileSync`），跑完即撤 —— 本 PR
**没有**提交那段临时代码（`git diff` 为空可证）。

调用点归属也有一个坑：**Prisma 的异步边界会把调用方的栈吃掉**。守卫的 `$allOperations` 钩子里
`new Error().stack` 只剩守卫自己那三帧（`scopeWhere` → `applyTenantScope` → `$allOperations`），把
`Error.stackTraceLimit` 提到 200 也一样。试过把调用点塞进 `args`：Prisma 会把 `args` 克隆一份，
Symbol 属性在钩子里已经不见了（实测 `Object.getOwnPropertySymbols(args)` 为空数组）。
`AsyncLocalStorage` 能穿过这道边界（守卫的 `getPrincipal()` 就是这么拿到帧的），但要让它带上调用点
就必须在代理里**提前 await**，那会让 13 处生产代码的 `prisma.$transaction([...])` 数组形式在事务
之外执行 —— 为了量一件事把被量的东西弄坏，不做。

所以本文件的归属分两层，各自标清楚：
- **动态证据**：每条警告都带「哪一套测试、哪一个测试文件」（1753/1753 条全部带到），这是跑出来的；
- **静态归属**：再把每个签名映射到生产调用点的 `file:line`。
  凡是仓库里**没有**生产调用点的签名，本文件明说它只来自测试夹具 —— 那种警告翻闸当天不会打到商家。

**静态归属只读 `where` 是不够的（判官 2026-09-15 P2-3，本次已返工）**：守卫先看**帧**再看 `where`。
同一句 `membership.findFirst`，无帧时按严格档判、会报警；而包在 `runAsStaff(staffPrincipal(gate, null))`
或 `runAsSystem(...)` 里时走的是**扫描域**分支，`findFirst` 在 `SYSTEM_SCAN_OPS` 里（tenant-guard.ts:259）
→ 直接放行，一条警告都没有。所以每一个候选调用点都必须往上追到它的外层帧
（`runAsStaff` / `runAsSystem` / `runAsUser`，以及帧里的 `ownerId` 是不是 null）才能定性。
初版本文件漏了这一步，错记了两行，见第 4 节的「已撤回」。

## 2. 三套测试的结果（都跑完了，全绿）

机器是共享的；第一轮在 load 30+、swap 5.1G/6G 的时候取，`TRUNCATE` 单次要 4~15 秒，出现过
`Hook timed out in 10000ms` 与 Postgres `53300 sorry, too many clients already`。那些**不是**回归，是
机器被邻居占满。等机器空下来（load ~1）按同样命令重跑，三套全绿：

| 套件 | 测试文件 | 测试 | 结果 |
|---|---|---|---|
| `packages/db` | 45/45（1 skipped） | 705 passed（+5 todo） | 全绿 |
| `apps/worker` | 71/71 | 888 passed（+1 todo） | 全绿 |
| `apps/web` | 607/607 | 8232 passed（+10 todo） | 全绿 |

（为了不被邻居的内存压力打断，三套都是分批跑的：每批独立进程、跑完即退，批内文件一个不少、
一个不重。分批只改进程边界，不改任何一条超时、不跳过任何一个文件。）

## 3. warn 清单：1753 条警告，19 个不同的签名

一个「签名」= 表 . 操作 + 守卫给的那句拒绝理由。翻 enforce 当天，同一个签名下的每一次调用都会
从「记一条警告」变成「抛异常」。

| # | 签名 | 次数 | 类别 |
|---|---|---|---|
| 1 | `Membership.findFirst` 无 orgId 过滤 | 854 | A 生产·无帧读 |
| 2 | `Membership.upsert` 无帧不许写 | 208 | B 生产·system 帧写 |
| 3 | `Membership.updateMany` 无帧不许写 | 205 | B |
| 4 | `Membership.deleteMany` 无 orgId 过滤 | 152 | C 仅夹具 |
| 5 | `CreditAccount.upsert` 无帧不许写 | 139 | B |
| 6 | `CreditLedger.createMany` 无帧不许写 | 135 | B |
| 7 | `Membership.findFirstOrThrow` 无 orgId 过滤 | 9 | C |
| 8 | `CreditLedger.deleteMany` 无 orgId 过滤 | 8 | C |
| 9 | `Membership.deleteMany` 无帧不许写 | 7 | C |
| 10 | `CreditLedger.create` 无帧不许写 | 7 | B |
| 11 | `Membership.findFirst` 碰了帧外的租户 | 6 | D 守卫自测故意造 |
| 12 | `CreditLedger.findMany` 无 orgId 过滤 | 4 | A |
| 13 | `Membership.update` 无 orgId 过滤 | 4 | C |
| 14 | `CreditLedger.count` 无 orgId 过滤 | 4 | C |
| 15 | `CreditAccount.deleteMany` 无 orgId 过滤 | 3 | C |
| 16 | `CreditAccount.findMany` 碰了帧外的租户 | 2 | D |
| 17 | `CreditLedger.create` 写到别家 | 2 | D |
| 18 | `CreditAccount.count` 无 orgId 过滤 | 2 | C |
| 19 | `Membership.count` 无 orgId 过滤 | 2 | C |

合计 A 858 · B 694 · C 191 · D 10 = 1753。

## 4. 生产调用点（file:line）

**A 类 —— 生产路径上的无帧读（2 个签名，858 次）**

| 签名 | 生产调用点 | 外层帧 | 那一句在干什么 |
|---|---|---|---|
| 1 `Membership.findFirst` | `apps/web/lib/auth-guard.ts:88`（`{ userId, orgId: { not: FOUNDER_OWNER_ID } }`） | **无帧**（`requireOwner`，:74） | 登录时**解析这个人属于哪一家** —— 此刻还不知道租户，结构上就无帧可建 |
| 12 `CreditLedger.findMany` | `packages/db/src/credits.ts:584`（`adjustWindowFilter()` 省略 orgIds） | 随调用方；admin 报表侧是 `runAsSystem("admin:platform-read")` | admin 人工钱报表的**全 org** 口径，按设计跨租户 |

**已撤回（判官 P2-3，初版错记）**：`apps/web/lib/tenant-actions.ts:206` 曾被记进签名 1。它确实没有
字面 `orgId`，但它跑在 `runAsStaff(staffPrincipal(gate, null))` 里（:185），`ownerId` 为 null ⇒ 扫描域
分支，而 `findFirst` 在 `SYSTEM_SCAN_OPS` 内 ⇒ **放行，不报警、翻闸也不 500**。该行已删除。

其余 15 个 `membership.findFirst` 生产调用点（`auth-guard.ts:146`、`org-role-guard.ts:37`、
`profile-names.ts:54`、`profile-actions.ts:60`、`member-directory-service.ts:76`、四个
`customer-*-gateway.ts`、四个 `customer-*-service.ts`、`tenant-admin.ts:204` …）逐个读过，
`where` 里都带**字面** `orgId`，不在这一类里。

**B 类 —— 生产路径上的 system 帧写（5 个签名，694 次）**

守卫报这句话的条件是「帧在、但帧没点名租户」（`system` 帧，或 `ownerId` 为 null 的 `staff` 帧），
而这几个操作都不在 `SYSTEM_SCAN_OPS` 里。所以**要改的不是下面这些写语句本身，是把它们包起来的
那个帧**——下表把两者分开列：

| 签名 | 守卫在哪一行拦 | 真正要改的外层帧 |
|---|---|---|
| 2 `Membership.upsert` | `apps/web/lib/auth-guard.ts:278`、`apps/web/lib/better-auth/converge.ts:93` | `runAsSystem("auth:bootstrap-personal-org")`（auth-guard.ts:229）、`runAsSystem("auth:converge-identity")`（converge.ts:42） |
| 3 `Membership.updateMany` | `apps/web/lib/auth-guard.ts:290` | 同上（auth-guard.ts:229） |
| 5 `CreditAccount.upsert` | `packages/db/src/credits.ts:835`、`:877` | `runAsSystem("stripe-webhook")`（`apps/web/app/api/stripe/webhook/route.ts:19` → 充值确认 `grantCredits` :227）、注册赠额那条 `runAsSystem` 链 |
| 6 `CreditLedger.createMany` | `packages/db/src/credits.ts:678`、`:728`、`:830` | 同上 |
| 10 `CreditLedger.create` | `packages/db/src/credits.ts:289`、`:872` | 同上（本签名的触发测试就是 `stripe-webhook-integration.test.ts`，与这条链对得上） |

**已撤回（判官 P2-3，初版错记）**：`apps/web/lib/tenant-actions.ts:68` 曾被记进签名 3。它跑在
`runAsStaff(staffPrincipal(gate, orgId))` 里（:49，`orgId` **非 null**），帧点了名 ⇒ 走 `scopeWhere`、
`where` 里本来就带字面 `orgId` ⇒ **放行，不报警**。该行已删除。

**C 类 —— 只在测试夹具里（9 个签名，191 次）**

`membership` / `creditLedger` / `creditAccount` 的 `deleteMany`、`count`、`update`、
`findFirstOrThrow` 在整个仓库的**生产代码里一个调用点都没有**（分别有 24 / 27 / 21 个测试文件在用）。
它们是 `beforeEach` / `afterEach` 清场留下的。翻闸当天这一类**打不到商家**，要修的是测试夹具，
不是产品代码。

**D 类 —— 守卫自己的测试故意造的（3 个签名，10 次）**

`tenant-guard-money-slice1` / `-staff-slice4` / `-enforce-prework-1403` 里那几条「伪造跨租户」的用例，
本来就是要看见守卫拒绝。不是待办。

## 5. 四颗雷：现在还在不在（本文件要回答的那一问）

**不在了。** 证据分两半，都是跑出来的：

- **修之前会炸**。把守卫恢复成 #1403 之前的字面等值判定（只改那两处判定，其余一字不动），
  单跑 `src/tenant-guard-enforce-prework-1403.test.ts`：**21 条里 9 条红**，四颗雷全在里面 ——
  雷①后台发积分、雷②后台铸币、雷③人工退款、雷④后台租户详情页，外加雷④b 扫描域读与 4 条
  归一化用例。报错逐字是
  `Error: [tenant-guard] CreditAccount.findMany tried to use orgId outside the active tenant`。
- **修之后不炸**。同一个文件在根治提交上全绿；五个守卫测试文件一起跑全绿。

**这些用例证的是「翻闸之后」，不是「今天线上」（判官 2026-09-15 P2-4）**：四颗雷与 A3/A4 的用例都
自己把挡位扳到 `enforce` 再断言，而出厂默认仍是 `warn`。所以在 #1403 那一行翻下去之前，
**TENANT-A3/A4 在规格验收表上一直是开着的**，本文件不把它们记成已通过。挡位由测试文件级的
`afterEach` 统一扳回 `warn`。

**另外，无帧那一档 #1403 一个字都没放宽（判官 P2-1，已按判官意见收回）**：四颗雷全发生在**有帧**
的路上（四条生产路径都先 `runAsStaff(staffPrincipal(gate, orgId))` 再进库），走 {@link scopeWhere}；
无帧兜底 `whereHasOwnerId(strict)` 维持改动前的形状 —— 只认字面等值字符串与 `{ equals }`，
连 `{ orgId: { in: [自己一家] } }` 也拒。没有哪颗雷需要放宽它，少一条口子少一处要解释的地方。

再看这一轮 warn 清单：1753 条里，**没有一条**是 `adjustWindowFilter()` 那个形状打出来的。
第 16、17 两个签名虽然也叫「碰了帧外的租户」，但它们的来源测试文件就是守卫自测（D 类），
是故意造的跨租户调用，不是雷。

## 6. 按「翻 enforce 当天会发生什么」重排

| 类别 | 次数 | 翻闸当天 | 谁来修 |
|---|---|---|---|
| A 生产·无帧读 | 858 | **会 500**：登录解析、撤邀请预检、admin 全 org 报表 | 建帧，或给「按设计跨租户」的那一条明确豁免 |
| B 生产·system 帧写 | 694 | **会 500**：登录时补建 membership、充值/扣费/退款落账 | 这些调用点要先进 `runAsTenant` |
| C 仅夹具 | 191 | 测试红，商家无感 | 改测试夹具 |
| D 守卫自测 | 10 | 本来就该拒 | 不用动 |

**A + B = 1552 次、7 个签名，是翻闸前真正要清的账。** 两个提醒，都是判官 P2-3 之后补的：

1. 次数是「测试跑了多少次」，不是生产流量，而且**同一个签名里混着生产来源与夹具来源**
   （例如签名 1 的 854 次里，既有 `auth-guard.ts:88` 这条真无帧路径，也有夹具的无帧读）。
   要看的是**签名**和它背后那几个 `file:line` 与外层帧，不是这个数字。
2. 撤掉初版错记的两行（`tenant-actions.ts:206`、`tenant-actions.ts:68`）之后，**签名数与次数不变**
   （7 个签名 / 1552 次）—— 被撤的是归属，不是签名：这两个签名各自仍有站得住的生产调用点
   （`auth-guard.ts:88` 与 `auth-guard.ts:290`）。真正变的是**要去改哪几处**：
   钱面那一半集中在 `runAsSystem("stripe-webhook")` 与注册/身份合流那两条 `runAsSystem` 链，
   而不是散在 `credits.ts` 的六行写语句上。

## 7. 这份基线证明不了什么（别拿它当全量）

- 它测的是**测试套件走过的路**，不是生产流量。测试没覆盖到的钱面入口，这里一条警告都不会有。
- 它**没有**证明「哪些调用点是靠严格档那条『无帧但字面 orgId 放行』的兜底才没报警」——
  那要给守卫加一句临时埋点再跑一轮，是第 9.3 节那个问题的第一步，不在本片。
- 次数只在同一轮内可比。夹具类签名的次数跟着测试文件数走，改一次测试就变。

## 8. 结论

四颗形状雷已经根治，`packages/db`、`apps/worker`、`apps/web` 三套在根治提交上全绿。

翻闸**还不能翻**：A + B 两类共 **7 个签名、1552 次**。按「要去改哪个帧」收敛之后，翻闸前要动的是
**三处帧**加**一处无帧读**：

1. `runAsSystem("auth:bootstrap-personal-org")`（`apps/web/lib/auth-guard.ts:229`）—— 注册时补建
   membership 与赠额；
2. `runAsSystem("auth:converge-identity")`（`apps/web/lib/better-auth/converge.ts:42`）—— 身份合流；
3. `runAsSystem("stripe-webhook")`（`apps/web/app/api/stripe/webhook/route.ts:19`）—— 充值确认落账；
4. `requireOwner` 里那条无帧读（`apps/web/lib/auth-guard.ts:88`）—— 登录时解析这个人属于哪一家，
   结构上就无帧可建，要么给它一个明确豁免，要么改成先查 membership 再建帧。

翻 enforce 当天，这四处就是**登录与充值当场 500**。按规格 §1.8 的硬顺序 —— 先建帧，后执法 ——
这些点处理完、第 3 节清单里 A+B 两类重跑为空，才轮到第 9 节那一行。

另外两笔没并进上面这四处、但翻闸前要各自有交代的：`credits.ts:584`（`adjustWindowRows` 的全 org
报表口径，按设计跨租户，需要的是**明确豁免**而不是建帧），以及 C 类那 191 次测试夹具警告
（改夹具，不动产品代码）。

## 9. 翻闸配方（本 PR **不执行**，留给下一次独立提交）

### 9.1 一行改动

```diff
--- a/packages/db/src/tenant-guard.ts
-let orgScopedGuardMode: TenantGuardMode = "warn";
+let orgScopedGuardMode: TenantGuardMode = "enforce";
```

`packages/db/src/tenant-guard.ts`，挡位那个模块级变量（本分支上在 `let orgScopedGuardMode` 那一行）。
挡位是进程内常量，不读环境变量、不读数据库 —— 所以翻闸就是这一行，没有第二处。

**收开关是另一件事，不在这一次**。规格 §1.3 与 TENANT-A10 要求全部切片落地后把挡位连同
`getOrgScopedGuardMode` / `setOrgScopedGuardMode` 一起删掉（能在生产关掉租户隔离的开关本身就是
审计发现）。删它会同时改动四个测试文件（`tenant-guard-money-slice1` / `-staff-slice4` /
`-default-mode` / `-enforce-prework-1403`）里所有翻挡位的语句，属于一次独立的收尾提交；翻闸那一次
提交必须保持可回滚，所以顺序固定为：**先翻、观察、再删开关**。

### 9.2 翻闸前必须全绿的东西

| 要跑的 | 命令 | 为什么它是闸 |
|---|---|---|
| 守卫六件套 | `pnpm --filter @fikirtive/db exec vitest run src/tenant-guard-*.test.ts src/__tests__/tenant-guard.test.ts` | 四颗形状雷的回归守卫（本片新增 22 条）＋ 切片①④的既有行为。`src/__tests__/tenant-guard.test.ts` 不在 `src/tenant-guard-*` 这个通配里，必须单独点名，否则这一闸会漏掉整整一个文件 |
| 钱账全套 | `pnpm --filter @fikirtive/db test` | reserve/settle/refund/grant 的钱守恒与幂等 |
| 后台与商家面 | `pnpm --filter @fikirtive/web test` | 21 个 staff 入口、125 个商家动作站点 |
| 队列 | `pnpm --filter @fikirtive/worker test` | 7 条队列的帧前单行读（规格 §4 异议栏点名的残余风险） |
| 生产构建 | `pnpm --filter @fikirtive/web build` | `"use server"` 再导出这类只有 next build 会炸的坑 |
| required CI | `quality` + `e2e` | 主干 ruleset 的两道必需检查（项目规矩 2026-09-13 裁决） |

翻闸那一次提交**必须**把本文件第 2 节那份 warn 清单重跑一遍并确认为空；清单不空就是「还有站点没
建帧」，先补帧，不翻闸（规格 §1.8 硬顺序：先建帧、后执法，不可对调）。

### 9.3 待 Founder 定调的那一个问题（本 PR 不替他决定）

**问题（票 #1403 原文）**：严格档「无帧但字面 orgId 放行」的兜底，收不收、何时收。

**人话版**：今天一句查钱的语句，只要自己写清楚了「我查的是 org_123 这一家」，就算它没报身份也放行。
这条兜底是为了让还没建帧的老入口在迁移期活着。翻 enforce 之后它仍然在。收掉它 = 每一条碰钱的语句
都必须先报身份，一条都不许靠自觉。

**两个选项**（agent 推荐第一个）：

1. **翻闸时不收，单独排一票收**（推荐）。翻闸这一次只改一行、只验一件事，回滚成本是一次 revert。
   兜底收口会同时打到所有还没建帧的钱面入口，把两件事压进一次提交，翻车时分不清是哪一半的问题 ——
   这正是规格 §4 异议栏里「按面分片、每片先观察再落闸」的同一条理由。
2. **翻闸同时收**。省一次发布，但当天的爆炸半径是两件事的并集。

无论哪一个，收口的前提都一样：先有一份「哪些钱面入口今天靠这条兜底活着」的实测清单。本次基线只
证明了「哪些会当场失败」，**没有**证明「哪些是靠兜底才没失败」—— 后者要给守卫加一句临时埋点再跑
一轮（约半小时机器时间），属于收口那一票的第一步，不在本片。

### 9.4 回滚

把 9.1 那一行改回 `"warn"`，一次 revert 即可。**没有迁移、没有数据改动、没有需要回填的列** ——
挡位只改「守卫看见违规之后做什么」，不改任何一行数据，也不改任何一个幂等键。翻闸提交保持独立、
不与其它改动混在一起，就是为了让这次 revert 是干净的一次。
