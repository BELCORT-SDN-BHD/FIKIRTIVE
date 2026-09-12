# 租户隔离落闸（身份帧 + 值比对）规格书（S1）

> 状态: 草稿
> 批准: （冻结时填）https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/464 Founder 评论「S1 批准 tenant-isolation.md」(YYYY-MM-DD)
> 规格前缀: TENANT（验收编号 = TENANT-A1、A2…，全仓不得与其他规格撞前缀）

## 0. 一句话

每个入口进数据库之前先报上「我是谁、动的是哪家店」，数据库那道闸再逐笔比对租户号对不对——做成之后，一个商家的会话再也碰不到另一个商家的数据和钱，越权不靠调用点自觉，靠闸。

## 1. 九问（S1 grill 的答案）

1. **商家做什么动作、看到什么结果？**
   - 正常路径商家零感知：自己的画布、生成、CRM、充值扣费全部照旧。
   - 越权路径当场失败：拿 A 商家的会话去改 B 商家的资源（例如把请求体里的 `orgId` 换成 B），动作报错返回、B 的数据一字未改。不新增 UI 文案，沿用各动作现有的错误返回。
   - 例子：商家 Aisha 的浏览器里改一个 id 去删同行的排期帖，今天靠调用点自己写对 where 才拦得住；做完之后是数据库闸直接抛错。
2. **入口在哪里？（列全，含深链）**（计数对主干 `368e9094`，引用时重验）
   - **网页商家面 125 个无帧 `requireOwner()` 站点**（文件内零 `runAsUser`）：`apps/web/lib/billing-actions.ts:37`、`:97`（钱面，两处全无帧）、`gen-actions.ts`（4 处 `requireOwner`、仅 1 处 `runAsUser`，第一段 PR #481 只接了 `startGen`）、`memory-actions.ts`(13)、`campaign-actions.ts`(10)、`schedule-actions.ts`(9)、`library-collections.ts`(8)、`upload-actions.ts` / `crm-actions.ts` / `canvas-actions.ts` / `brand-record-actions.ts`（各 6）等。
   - **后台员工面 21 个 `requireRole` 站点**（#479 并案）：`tenant-actions.ts:44,76,113,154,203,267,327`、`admin-actions.ts:45,81,119,148,183`、`credit-actions.ts:23,34`、`reconcile-actions.ts:89,140`、`refund-actions.ts:378`、`admin-v2-page.tsx:8`、`app/admin/{reconcile,queue,tenants/[orgId]}/page.tsx`。`requireSession` 生产站点已归零，该半题作废。
   - **worker 7 个队列 handler**：`caption / gen / ingest / publish / refgen / render / research`，形状都是「帧前按 id 单行读 → 用行上的 ownerId 建帧」。
   - **route handler**：`app/api/otto/stream`（Otto 的唯一流式入口）。
3. **四态：空、加载、错误、成功各长什么样？**
   - 这是后端加固，四态落在闸上而非页面上：**放行**（帧内 ownerId 与查询相符）＝无感；**拒绝**（值不符）＝抛错，动作失败；**无帧**＝拒（本规格要立的新规则，今天是退回存在性检查）；**扫描域**（`kind:"system" && ownerId===null`，reaper/对账）＝合法跨租户，放行。
   - 迁移期第四态由挡位承担：每个切片上线时该面先 `warn` 观察一轮，再翻 `enforce`；全部切片落地后**删挡位**（能在生产关掉租户隔离的开关本身就是审计发现）。
4. **数据从哪来、写到哪去？**
   - 身份只来自服务端：`requireOwner()` 的 gate → `resolveUserPrincipal` → `runAsUser` 建帧；`principal.ts` 的 `Principal` 今天只有 `user` / `system` 两支。
   - 闸在 `packages/db/src/tenant-guard.ts`：`SCOPED_WHERE_OPS`（:151-167）已含 `findUnique/findFirst/findMany/update/updateMany/upsert/delete/deleteMany/count/aggregate/groupBy`；有帧时值比对已完成（:227-237 不等即抛、:251 强制注入 `ownerId`、:265-268 create 异租户抛错、:277-283 禁改写 `ownerId`）；复合唯一键按下划线分段下钻（:202-213）。**已完成的这一半不重做**（commit `6b6c537c`，Founder 已裁 2026-09-12 核实不重做）。
   - 仍缺的一半写在 `:404-411` 的无帧分支：只调 `whereHasOwnerId`，而它（:214-223）对对象型过滤器只要求「有任意一个非 undefined 的值」，所以 `{ ownerId: { not: "" } }` 伪造照过。
   - schema 侧：`packages/db/prisma/schema.prisma` 151 条 `@relation(fields:)` 中，含租户列的复合外键 76、**裸外键 75**（与 2026-09-09 分流记的「复合 54 / 裸 75」中裸数逐字相同）。回填 = 给这 75 条加上租户列，让跨租户挂接由数据库拒绝。
5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？**
   - **碰，而且钱面正是缺口最深的一处**：`billing-actions.ts` 两处 `requireOwner` 全程无帧；`gen-actions.ts` 四处只有 `startGen`（唯一扣费权威）有帧；后台 `grantCreditsAction`（`credit-actions.ts:22`，`orgId` 取自请求体）、`refund-actions.ts:378`、`reconcile-actions.ts:89,140` 也无帧。
   - **本规格不改任何金额、价格与幂等键**：`reserve/settle/refund` 与 `grantCreditsTx` 的既有键（如 `signup:<orgId>`）原样保留，改的只是「谁被允许动这一行」。任何键的改动都属越界。
   - 钱守恒由 TENANT-A4 当场演示：越权尝试后两边余额与流水行数不变；同租户扣费仍恰好一笔、重放不重复扣。
6. **权限与租户边界是什么？**
   - 租户身份只能来自被验证的服务端 principal。**`reason` 是审计用的名字，不是权限凭据**：`runAsTenant()` 在「嵌在他人用户帧里」时会降级成 `{kind:"system", reason:"tenant-direct"}`，那正是跨租户访问的形状，不得因为「帧是 system 且帧内 ownerId 与查询相符」就放行。
   - 判定按结构不按名字：`system + ownerId===null` = 扫描域；任何带 ownerId 的帧一律值比对。
   - **豁免只有两类，按结构不按名字**：(a) 扫描域；(b) per-(model, uniqueKey) —— 今天只有 `Transcript × contentHash_model` 一条（全局内容寻址缓存，同音频同模型 $0 复用），不得退化成整模型豁免；换转写模型或引入非确定性解码参数时这条特判必须重评。
   - **队列 handler 的帧前单行读**：按「读完立刻用行上的 `ownerId` 建帧并复核」处理，不整类豁免 `findUnique`（整类豁免等于在最常见的读上开洞）。
   - **后台员工面（#479 并案）**：新增第三类 `staff` 帧，帧里带操作者与目标租户，审计归属从「每站点手写 `gate.email`」变成帧带；跨租户铸币仍要 `requireRole("tenants","mutate")` ＋ 活跃商家校验，权限不因建帧而放宽。**Founder 已裁 2026-09-12（场⑦）**：推荐建，但排在切片①②之后。
7. **参考对照：抄哪家？** 不适用：加固类规格，无 UI 参照。
8. **胃口：轻／中／重挡，为什么？**
   - **重挡**：碰租户边界与钱路，且改 schema（75 条裸外键回填）。Founder 已裁 2026-09-12（#1359 场②）：**本版做、挡 GO**。
   - 胃口一周以上，按面切片，每片独立可验收、独立合并：**①钱面 → ②商家动作面 → ③CRM 面 → ④后台 staff 帧 → ⑤裸外键回填**。**Founder 已裁 2026-09-12（场⑦）**：推荐按面分批（一次给 125 个站点同时落闸，翻车面是全站 500）；推荐钱表族参数化进守卫（钱面就是最该有闸的面）；推荐 75 裸外键回填**同版但放最后一片**，须 Founder-only 的生产迁移流程另行确认备份与恢复。
   - **硬顺序（Founder 已裁 2026-09-12，#1359 场②）**：**先建帧、后执法**，不可对调、不可并行上线。顺序做反＝落闸当天付费生成与全部无帧动作一起 500。
9. **Otto 怎么协助这个功能？** Otto 与人工 UI 共用同一动作层，所以商家面建帧之后 Otto 侧自动继承同一道闸，不另写一套；唯一要单独建帧的是 `app/api/otto/stream` 这个流式 route handler（帧必须在流构造期建立，帧内创建、帧外调用会静默丢帧）。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| TENANT-A1 | 在任一已落闸面的动作里（含 `billing-actions` 两处与 `gen-actions` 四处）打印当前身份 | `getPrincipal()` 返回 `kind === "user"` 的完整帧（带 ownerId 与 userId）；两个商家的请求重叠在飞时互不串帧 |
| TENANT-A2 | 用 A 商家的会话，把请求体里的 id／orgId 换成 B 商家的资源，做改名、删除、读取各一次 | 三次全部失败；B 的数据与行数一字未改；A 自己的同一动作正常成功 |
| TENANT-A3 | 对已落闸的面发起一次无帧调用，并单独喂一次 `{ ownerId: { not: "" } }` 形状的 where | 两次都被拒（无帧即拒）；伪造过滤器不再过关 |
| TENANT-A4 | **钱守恒**：跨租户伪造一次充值确认、一次扣费、一次退款；再用同租户正常扣费一次并重放同一幂等键 | 三次越权全失败，两边 CreditLedger 余额与流水行数分毫未变；正常扣费恰好一笔，重放不产生第二笔 |
| TENANT-A5 | 每片落闸后走一遍该面的完整商家旅程（钱面：充值→扣费→退款；动作面：建项目→生成→排期；CRM 面：建客户→跟进） | 全程零 500、零新错误；与落闸前同结果 |
| TENANT-A6 | 后台员工发一次积分、退一次款、跑一次对账 | 三次都在 staff 帧内发生，审计行的操作者与目标租户由帧带出；跨租户铸币仍要求 `requireRole("tenants","mutate")` 才放行 |
| TENANT-A7 | 在全新数据库上跑完全部迁移，然后尝试把 A 租户的子行挂到 B 租户的父行 | 迁移零错误；跨租户挂接被数据库直接拒绝（不靠应用层） |
| TENANT-A8 | 跑 7 条队列各一单（caption / gen / ingest / publish / refgen / render / research） | 7 条全部跑通；帧建立之后该单的所有后续读写都经过值比对（用一次异租户 id 注入证明会被拒） |
| TENANT-A9 | 用同一段音频同一模型，在两个不同租户下各跑一次转写 | 第二次命中全局缓存、不报错、不重复计费；换成任何其它表的跨租户读则被拒 |
| TENANT-A10 | 跑机器计数：`apps/web` 生产代码里文件内零 `runAsUser` 的 `requireOwner` 站点数、生产 `requireRole` 站点未建帧数 | 两个数都是 0；守卫里的迁移期挡位已从代码中删除 |

## 3. 不做（非目标；写明为什么和触发条件）

- **`create` / `createMany` 的跨租户校验收紧**：`cross-tenant-write.test.ts` 里三条 #317 `it.fails` 靠它们做红案，动了就是越界。触发条件＝#317 另立切片。
- **原生 SQL 扫描路径**（`llm-reservation-reaper`）：结构性在 Prisma 扩展之外，闸看不见；本规格只从退款侧比对。触发条件＝该 reaper 重写为 Prisma 查询。
- **`PublishAttempt` 无 ownerId 列**：属 schema 工单，只能经 `post.ownerId` 传递性取租户。触发条件＝随裸外键回填那一片一起评估。
- **嵌套写（nested write）盲点**：外层 where 带 ownerId 即可，深层嵌套不在本规格扩展。触发条件＝出现真实越权用例。
- **权限模型本身**（角色、capability 划分）：本规格只做「谁能动哪家店的数据」，不改「哪个角色能做什么」。
- **UI 文案与错误提示改版**：越权失败沿用各动作现有返回，不新增 English copy。

## 4. 异议栏

- **最大风险：这是一次没有商家能看见好处、却能让全站宕机的改动。** 125 个站点建帧＋落闸，任何一个漏网站点在翻 `enforce` 那一刻就是一个 500，而钱面（充值、扣费）恰恰是漏得最多的那一面。缓解只有三条，都写进了本规格：按面分片、每片先 `warn` 观察再 `enforce`、先建帧后执法的硬顺序。真正无法靠流程缓解的残余风险是 worker 的 7 条队列——它们的帧前单行读是「先读才知道租户」的鸡生蛋结构，改造触及每一条队列的第一段代码，一旦判错整批任务当天全挂（设计契约原文：默认继承 = 7 条队列当天全挂）。建议这一段单独一片、单独复审。
- **次要异议：75 条裸外键回填放在同版，是把一次生产迁移压进一个已经很满的版本。** 它是 #317 移交的老债、与落闸同属「上线前门槛」，所以推荐同版；但如果本版时间吃紧，它是唯一可以整片延后而不破坏其余验收的部分（A7 随之延后，其余九条不受影响）。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|

## 6. 改签记录

- 无
