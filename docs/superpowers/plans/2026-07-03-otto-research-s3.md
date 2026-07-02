# Otto 研究 · S3(执行:审批 → 队列 → reserve/settle → 报告)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。实现 = Opus;每 task review(碰钱 task 用 opus money-lens);**S3 结束跑整支 money-safety review(创作篇两轮标准),合并前硬门。**
> spec = `docs/superpowers/specs/2026-07-03-otto-research-design.md` §4/§6。**这是研究块唯一碰钱的块。**

**Goal:** 用户在 RESEARCH_CARD 点「Approve & run」→ 服务端 balance 预检 + 建 ResearchJob(幂等)+ 卡→running + 入队 → worker 跑**有界 search→read→synthesize 循环**,整段用**一个 `withLlmBudget`** 计量(reserve→run→settle,只扣实际 token 成本)→ 写 RESEARCH_REPORT + 卡→done;失败→卡→failed + 退款。

**Architecture(money 设计,Fable 锁,基于 2026-07-03 seam 报告):**
- **唯一花钱 = LLM tokens**(search API 免费)。研究 worker 的核心是多步 LLM 循环 → 整段包一个 `withLlmBudget({ refId:"research:<cardId>", model, paid:true, maxSteps: tier.maxSteps })` —— 它**自带 reserve(turnBudget 上限)→ 跑 → settle(实际)**,和 `ottoTurn`/`otto-resume` 给 Otto 思考计费**完全同构**(otto-resume.ts:81-96 就是 worker 内新 refId 的先例)。**不新建钱原语。**
- **花钱 once-EVER**:`CreditLedger` 的 `reserve:<refId>`/`settle:<refId>`/`refund:<refId>` 幂等键(`@@unique([orgId, idempotencyKey])` + `CreditLedger_finalizer_once`)天然保证同一 `research:<cardId>` 只 reserve/settle 一次。
- **确认即授权**:用户点「Approve & run(~N credits)」= confirm-before-spend(卡已显示 estimatedCredits)。真 reserve 在 worker 起步瞬间(几秒后),是实现细节。

## Global Constraints(碰钱,最高优先)

- **钱路复用,零新原语**:reserve/settle 只经 `withLlmBudget`(worker 内);approve 动作**不 reserve**(只建 job + 入队);search API $0。
- **worker 重试幂等(money-critical,money-review 必查)**:pg-boss 会重试 handler。必须防**双 reserve**:(a) handler 开头 **CAS** `ResearchJob.status QUEUED→RUNNING`(`updateMany where status:"QUEUED"`,count===0 → 已被处理,直接 return);(b) 兜底 = `CreditLedger` 的 `reserve:research:<cardId>` 唯一键(重试内 reserveCredits 的 ledger insert 是 skipDuplicates —— **但必须验证 reserveCredits 在重复 key 下不重复扣余额**;若它不是幂等的,则 CAS 是主防线,且给 RESEARCH_QUEUE 设 `retryLimit: 0`,失败即 failed 不重试)。**决定:retryLimit 0 + status CAS 双保险**(研究失败让用户重新 approve,而不是自动重试撞钱)。
- **approve 幂等**:`ResearchJob` 唯一索引 `research:<cardId>` once-EVER → 双击/重放 approve 只建一个 job(第二次返回既有)。卡 status 非 planned → 拒绝再 approve。
- **owner-scoped 身份**:approve 用 `requireOwner`(session);worker 从 `ResearchJob.ownerId` scope 所有读(job→card→thread 都 `where ownerId`),CAS 卡更新也带 ownerId。
- **预算耗尽优雅截断**:循环每步检查 step/search/page 预算;`withLlmBudget` 的 maxSteps 到顶由 SDK `MaxTurnsExceededError` 触发 → `usageOnError` 交实际 usage 给 settle(扣实际,不超扣)→ 用已有材料写报告 + 注明截断。**绝不超 reserve。**
- **加性 migration**(ResearchJob 新表)+ **RESEARCH_TIERS.estimatedCredits 由 `turnBudgetInternal(maxSteps)` 推导**(卡估值 ≈ reserve;不再是 S2 占位)。
- 每 task:vitest 绿 + `pnpm -r typecheck` + **web build EXIT 0**;S3 结束整支 money review。

---

### Task 1: ResearchJob 表 + `approveResearch` 动作($ 授权,但 approve 本身 $0)

**Files:** Modify `packages/db/prisma/schema.prisma`(ResearchJob 模型 + status enum 或复用)、Create migration(加性 CREATE TABLE + `research:%` once-EVER 部分唯一索引,镜像 GenJob cowork 索引 20260617000000)、Create `apps/web/lib/research-actions.ts`(`approveResearch`)+ test。

**语义(测试逐条锁):**
1. `ResearchJob`:`{ id, ownerId, threadId, cardId @unique?, idempotencyKey @unique-partial, tier, status: QUEUED|RUNNING|DONE|FAILED, reservedCredits?, actualCredits?, error?, createdAt, updatedAt }`。部分唯一索引 `WHERE idempotencyKey LIKE 'research:%'`(once-EVER,镜像 cowork)。
2. `approveResearch({cardId}) → { jobId } | { error }`:`requireOwner` → 载 RESEARCH_CARD `{id, ownerId, kind:"RESEARCH_CARD", deletedAt:null}` + thread owner 复核 → 卡 `payload.status !== "planned"` → `{error:"Already running or done."}` → **balance 预检**(读 CreditAccount.balance vs `RESEARCH_TIERS[tier].estimatedCredits`;不足 → `{error:"Not enough credits", code:"insufficient_credits"}`,**不建 job**)→ `$transaction`:建 ResearchJob(idempotencyKey `research:<cardId>`;唯一冲突 → 返回既有 jobId,幂等)+ 卡 `payload.status = "running"`(RMW)→ 事务后 `boss.send(RESEARCH_QUEUE, {jobId})` + 持久化 queueJobId(best-effort)。
3. **approve $0**:不 reserve、不建 GenJob、不 withLlmBudget —— 仅建 job + 改卡 status + 入队(测试断言 reserveCredits/settleCredits 从未在 approve 路径被调)。
4. 测试(mock prisma/boss/requireOwner):happy(建 job + 卡 running + enqueue);双击幂等(第二次返回既有 job,不重复建);非 planned 拒绝;balance 不足拒绝且不建 job;owner-scope(卡不存在/非本人 → error);$0 断言(无 reserve/settle/genJob.create)。

**Steps:** TDD → db build + generate → web 全套 + typecheck + build EXIT 0 → commit `feat(otto,db): ResearchJob + approveResearch (enqueue, \$0 at approve; spend deferred to worker)`。

---

### Task 2: RESEARCH_QUEUE + worker `handleResearch`(**碰钱核心**,opus money-lens review)

**Files:** Modify `apps/worker/src/queues.ts`(+RESEARCH_QUEUE)、`apps/worker/src/index.ts`(+boss.work 注册)、Create `apps/worker/src/jobs/research.ts`(`handleResearch`)+ test;可能 Modify `packages/core`(RESEARCH_QUEUE 常量 + policy retryLimit:0)。

**语义:**
1. `handleResearch(data: {jobId}, retryCount)`:载 ResearchJob owner-scoped → **CAS `status QUEUED→RUNNING`**(`updateMany where {id, status:"QUEUED"}`;count===0 → 已处理,return;这是重试幂等主防线)。
2. 载 card + thread(owner-scoped);构造 research ctx(search 端口 = env key 注入的 tavily/brave 适配器;readPage = readPageCached —— 复用 S1,worker 侧同样从 env 读 key)。
3. **`withLlmBudget({ orgId: job.ownerId, refId: "research:"+job.cardId, model: OTTO_DEFAULT_MODEL, paid:true, maxSteps: RESEARCH_TIERS[tier].maxSteps, usageOnError: e => MaxTurnsExceededError ? mapUsage(e) : null }, async () => { ...bounded loop... return {result, usage} })`**:
   - 有界循环(≤ tier.maxSearches search、≤ tier.maxPages readPage):规划子问题 → search(瘦结果)→ 挑 URL → readPage(缓存分页)→ 增量笔记(只留要点)→ 综合。
   - 返回 `{ result: reportPayload, usage: 累计 tokens }` → withLlmBudget settle 实际。
   - **实现形态以简为先**:可用 `run(otto,...)` 式有界 agent 循环 or 一个手写的 search/read/synthesize 编排(实现时定;关键是 usage 如实回给 withLlmBudget)。
4. 成功:写 `RESEARCH_REPORT` ChatMessage(seq+1,ownerId/threadId from job,payload:`{sources:[{url,title}], findings, synthesis, creditsCost}`,镜像 appendCoworkResult)+ 卡 `payload.status="done"` + 记 actualCredits。**幂等**:RESEARCH_REPORT 写入靠 (threadId, 某唯一键) 或先查 job.status,重复 return。
5. 失败/截断:`withLlmBudget` 抛(InsufficientCredits / 其它)→ catch → 卡 `status="failed"` + error 摘要;withLlmBudget 内部已 refund(错误路径)或按实际 settle(截断路径)。ResearchJob status→FAILED。**绝不超 reserve、绝不无产出扣款**(reserve 失败 = $0)。
6. RESEARCH_QUEUE policy `retryLimit: 0`(失败即 failed,用户重新 approve = 新流程,避免自动重试撞钱)。

**测试(worker,mock prisma/boss/withLlmBudget/search/readPage):** CAS 幂等(status≠QUEUED → 跳过不跑不扣);happy(withLlmBudget 调一次、refId=research:<cardId>、RESEARCH_REPORT 写、卡 done);预算耗尽(MaxTurnsExceeded → 截断报告 + settle 实际);withLlmBudget 抛 → 卡 failed + 无 report;搜索/页数上限遵守;owner-scope 贯穿;**$ 断言**:reserve/settle 只经 withLlmBudget(不手写 reserveCredits)、无双 reserve(重试走 CAS 跳过)。

**Steps:** TDD → worker build + typecheck → commit `feat(worker): research queue + bounded metered loop (withLlmBudget reserve/settle, retry-idempotent CAS)`。

---

### Task 3: 卡「Approve & run」接线 + 进度 + tier 估值校准

**Files:** Modify `apps/web/components/otto/ResearchCard.tsx`(planned 态按钮 → `approveResearch({cardId})`,确认文案含 credits;running 态轮询卡 status/进度;done → 链 REPORT)、`packages/otto/src/skills/propose-research.helpers.ts`(`RESEARCH_TIERS.estimatedCredits` 改为由 `turnBudgetInternal(RESEARCH_TIERS[tier].maxSteps, ...)` 推导 —— 卡估值 ≈ worker reserve)、相应测试更新。

**语义:**
1. ResearchCard planned:启用「Approve & run — ~N credits」→ 确认 → `approveResearch`(客户端唯一花钱触发点,同 PackCard 确认姿势;真扣在 worker)→ 成功卡转 running（本地 + 轮询)。insufficient_credits → Top-up 提示(同 PackCard)。
2. running:轮询(3s×N)读卡 status;done → 显示「Report ready」+ REPORT 已在流里;failed → 显示失败 + 「Try again」(重新 approve 需新卡?或允许 failed→re-approve —— **决定**:failed 卡显示重试提示,重试 = Otto 再 proposeResearch 出新卡,不复用旧卡,避免 refId 撞已 settle)。
3. estimatedCredits 校准:S2 占位(10/25/60)换成 `turnBudgetInternal` 推导值;测试断言估值单调且 = 对应 maxSteps 的 budget。
4. **build EXIT 0 门**(动 client)。

**Steps:** TDD(helpers 估值)→ 组件接线 → web 全套 + typecheck + build → commit `feat(otto): wire research Approve&run + progress + tier estimate from budget`。

---

### Task 4: 整支 money-safety review(S3,合并前硬门,双轮标准)

- [ ] 最强模型整支 review(创作篇 F4/G 标准),专项核:(a) 花钱只经 withLlmBudget(worker),approve/端口/UI 零 reserve;(b) **重试不双扣**(CAS + retryLimit0 + ledger 幂等三重,逐条 trace pg-boss 重试路径);(c) reserve=maxSteps 上限、settle=实际、截断不超扣、失败全退;(d) approve 幂等(research:<cardId> once-EVER)、balance 预检 fail-fast;(e) owner-scope 贯穿 worker;(f) 卡估值 ≈ reserve(不误导用户);(g) search API 免费不碰 credits、配额守卫防烧免费额度;(h) build EXIT 0。Critical/Important → 修完原审复核再谈合并。

---

## Self-Review

Spec §4/§6 覆盖:reserve/settle 复用 withLlmBudget ✅ T2;禁复合/新原语 ✅;上限即闸 + 优雅截断 ✅ T2;approve 幂等 + balance 门 ✅ T1;worker owner-scope ✅ T1/T2;tier 估值推导 ✅ T3;search 免费 + 配额守卫(端口层,S1 已可加/T2 循环内计数)✅。**重试幂等**是本块最大 money 风险 → CAS + retryLimit0 + ledger 三重,T4 专项 trace。类型:ResearchJob(T1)、handleResearch(T2)、RESEARCH_TIERS 校准(T3)。Money:approve $0(测试断言)、worker 花钱只经 withLlmBudget、once-EVER 三重幂等。

## 相关文件(seam 报告 2026-07-03)

reserve/settle:`packages/db/src/credits.ts`(reserveCredits:34 / settleCredits:66 / refundReservation:92)、`CreditLedger` schema:653。计量:`packages/otto/src/meter.ts:86`(withLlmBudget,自带 reserve/settle,maxSteps 多步)。worker 先例:`apps/worker/src/jobs/otto-resume.ts:81-96`(worker 内 withLlmBudget 新 refId)、`gen.ts:132-157`(appendCoworkResult ChatMessage 写)、`apps/worker/src/index.ts:129`(boss.work)、`queues.ts`。幂等:GenJob cowork once-EVER 索引 `20260617000000`。producer 先例:`gen-actions.ts:115-166`。卡状态 RMW/CAS:`gen.ts:669`。研究地基:S1 `web-page-cache.ts` + websearch 适配器;S2 `propose-research.*` + RESEARCH_TIERS + RESEARCH_CARD/REPORT kinds。
