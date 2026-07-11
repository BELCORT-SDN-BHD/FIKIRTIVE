# E3 · 钱路 + 租户 + 市政厅 — 能力真相矩阵

> 基线:`main@b5a48d0f`(已 `git rev-parse` 确认)。Prod web = `7ed7ac22`(落后 main;未在本 worktree checkout,故 prod 档凡无部署证据一律 Unknown);prod worker SHA = Unknown → 所有 worker 侧能力 prod 档 = Unknown。
> 只读取证。stage 只据代码/迁移/配置实际内容;GRILL/harmony/spec 只填 promise_source。

## Matrix

| id | zone | capability | promise_source | stage_main | stage_prod | gate | evidence | provenance | gaps |
|---|---|---|---|---|---|---|---|---|---|
| E3-01 | 钱路 | Credit 账本五操作(reserve/settle/refund/grantTx/grant) | 蓝图钱路;credits.ts 头注「SOLE writer」 | integrated | Unknown | 硬编码;无 flag | `packages/db/src/credits.ts:34`(reserve)`:66`(settle)`:96`(refund)`grantCreditsTx:130`(约)`grantCredits:167`(约);全部单事务+ledger行 | Verified current source | 无断层;五操作齐备,invariant balance==Σdelta 注释锁定 |
| E3-02 | 钱路 | Partial-unique 幂等索引(三条) | 判决 exactly-once;credits.ts 头注 | integrated | Unknown | DB 唯一索引 | `migrations/20260619130000_credits/migration.sql:39`(orgId,idempotencyKey)`:50`(ref_kind_once WHERE refId NOT NULL)`:57`(finalizer_once WHERE kind IN SETTLE,REFUND);迁移文件仍在,逐条核对 | Verified current source | 无:三索引全在;settle/refund 用 createMany(skipDuplicates)=ON CONFLICT DO NOTHING,非 try/catch(注释解释 P2002 会 abort 整 tx) |
| E3-03 | 钱路 | reserve→settle→refund 三方调用点接线 | 蓝图 spend 闭环 | integrated | Unknown(worker) | 硬编码 | reserve: `gen-actions.ts:142`/`refgen-actions.ts:93,204`;settle: `worker/src/jobs/gen.ts:205,700`;refund: `gen.ts:222,280,309,441,760`+`cowork-actions.ts:305`+`actions.ts:189`+`refgen-actions.ts:122,231` | Verified current source | reserve 在 web action(GenJob insert 同事务),settle/refund 在 worker commit;跨进程但同 refId,索引兜底 |
| E3-04 | 钱路 | 视频定价现值 vs 2026-07-03 终案(5s8/10s14/参考16) | 判决 2026-07-03 定价终案 | integrated | Unknown | 硬编码表 | `spend.ts:87` VIDEO_CREDITS_BY_RESOLUTION{720p:8,1080p:16} `:88` VIDEO_CREDITS_720P_10S=14 `:89` REFERENCE_VIDEO_CREDITS=16;`pricedGenCredits:91` 逐分支 | Verified current source | **代码与终案逐项一致**:720p5s=8✓ 720p10s=14✓ 参考视频=16✓。注:仅 seedance-2-fast 是 flat-priced(FLAT_PRICED_VIDEO_MODELS `:81`);其余 fal 模型走 displayedFromUsd(cost) |
| E3-05 | 钱路 | OTTO_LLM_MARGIN = 2.0 | 判决 2026-07-03 定价终案 | integrated | Unknown | env `OTTO_LLM_MARGIN` 覆盖,fallback 2.0 | `llm-prices.ts:52` OTTO_LLM_MARGIN_DEFAULT=2.0(注「2.0×=50% 毛利」)`:56` ottoLlmMargin() 读 env | Verified current source | 与终案一致;env 可覆盖(正有限数才生效,否则 fallback) |
| E3-06 | 钱路 | search 3x 乘数 | 判决 2026-07-03 定价终案(工单转述) | Unknown | Unknown | 无 | 全仓 grep 未见 web-search 专属 3x 乘数;research 计价 = `propose-research.helpers.ts:24` turnBudgetInternal(prices, ottoLlmMargin()=2.0, maxSteps) | Verified current source(缺席) | **断层:代码里没有 search 3x**。研报按 LLM turn budget × margin2.0 × maxSteps 计,无 3× 加成。3x 决定是否落地存疑 |
| E3-07 | 钱路 | 毛利地板 ≥45% 机器 gate | 判决;宪法 5 margin floor | implemented(定性 gate,非数值) | Unknown | 硬编码 assert | `model-config.ts:29` assertSpendableModel `:41` 拒非 flat-priced 视频模型;`spend.ts:7-9` 注 isFlatPricedVideoModel 被 spend gate 消费 | Verified current source | **断层:gate 是「必须 flat-priced 才可卖」的定性拦截,没有任何 ≥45% 的数值计算/断言**。地板靠「flat 表=已按终案 floor 过」的人肉假设,非机器校验百分比 |
| E3-08 | 钱路 | 视频毛利地板 + BytePlus 资源包告警(P1) | MASTERPLAN P1;byteplus-pack-alert | integrated(告警逻辑) | Unknown | env(capacityUsd/usedUsd/alertPct) | `apps/web/lib/byteplus-pack-alert.ts:29` buildBytePlusPackSignal;env 缺 capacityUsd→"configure alert";consumed by `admin-v2.ts` | Verified current source | 告警在,alert-only;阈值默认 20%(`:37`)。**capacityUsd 未配则不告警(fail-open 到"去配置"状态)** |
| E3-09 | 钱路 | Stripe 充值链(packs/checkout/webhook 幂等) | 蓝图钱路;billing-actions | integrated | Unknown | env STRIPE_WEBHOOK_SECRET;签名=auth | webhook `apps/web/app/api/stripe/webhook/route.ts:24` 处理 completed+async_payment_succeeded,`:38` payment_status==paid,`:43` idempotencyKey `stripe:<session.id>`;`billing-actions.ts` createTopupCheckout(orgId 来自 gate.ownerId 非 client) | Verified current source | 幂等按 session.id(非 event.id)→ 两事件类型间 exactly-once。dispute/refund = alert-only(`route.ts:50` 起,不自动 clawback) |
| E3-10 | 钱路 | Credit 消费明细(用户侧 Account→Credits 分类) | 判决「要」 | integrated | Unknown | 无 | `account-actions.ts:69` getMyAccount 返回 `recent: AccountActivity[]`(`:76` creditLedger.findMany where balanceDelta!=0,25 条);`:32` KIND_LABEL 分类;genJob 标签化(`:46`) | Verified current source | 用户侧分类明细**已建**(balance/reserved/最近 25 条 balance-moving 行,带 friendly label)。admin 同口径:`admin/cost/page.tsx`+`admin/money/page.tsx` 存在 |
| E3-11 | 钱路 | Beta 100cr 首充授予 | 蓝图 beta;spend.ts | integrated | Unknown | 硬编码,idempotent | `spend.ts` BETA_INITIAL_GRANT_CREDITS=100×INTERNAL_PER_DISPLAY;bootstrapPersonalOrg 内 grantCreditsTx key `signup:<orgId>`(map §5) | Verified current source | 幂等 on signup:<orgId>,与 org bootstrap 同事务(grant 失败回滚整 org) |
| E3-12 | 租户 | 租户铁幕 tenant-guard/TENANT_MODELS 覆盖 | 蓝图租户隔离;审计 2026-07-04 | integrated | Unknown | 硬编码;prod=WARN,test=THROW | `packages/db/src/tenant-guard.ts:8` TENANT_MODELS(含 L0 六表 TrackedLink/QrAsset/QrPlacement/VoucherToken/SourceTag/AttributionEvent + ScheduledPost/BrandKit/BrandRecord/BrandRule);`:64` 检查 findMany/findFirst/updateMany/deleteMany | Verified current source | **无新 model 漏挂**:ScheduledPost 已挂;PublishAttempt/ScheduledPostMedia **无 ownerId 列**(awk grep=0),故正确地不需进 TENANT_MODELS(经父 ScheduledPost 隔离)。MetaConnection/MetaActionExecution 在 EXEMPT(带理由)。coverage 测试 `tenant-guard-coverage.test.ts` 存在,强制每 ownerId model 二选一 |
| E3-13 | 租户 | tenant-guard 已知盲区 | tenant-guard.ts 头注 | integrated(有意豁免) | Unknown | — | `tenant-guard.ts:3-7` 盲区:raw SQL/nested writes/findUnique/aggregate/groupBy/count 豁免;`:38` CHECKED_OPS 仅四写读操作 | Verified current source | prod 只 WARN 不 throw(`:57` 注:false positive 不能 500 活请求)→ 生产环境实际靠 explicit filter + 2-org 隔离测试,guard 仅 backstop |
| E3-14 | 市政厅 | RBAC section 矩阵 | 蓝图市政厅;roles.ts | integrated | Unknown | 硬编码 SECTION_MATRIX | `roles.ts:22` SECTIONS=8 项(model/cost/content/team/system/knowledge/credits/tenants);`:36` SECTION_MATRIX deny-by-default;`:54` roleAllows | Verified current source | **断层观察:RBAC 只有 8 个 section**,但 `app/admin/` 有 ~16 个页目录(audit/cases/content/conversations/cost/credits/directives/knowledge/models/money/otto/settings/staff/system/team/tenants)。工单称「11 section」— 与代码 8-RBAC-section 及 16-页目录均对不上,口径需上级核 |
| E3-15 | 市政厅 | admin 页 founder 墙 + 逐 action re-assert | map §5;admin/layout | integrated | Unknown | isFounderAdmin | `admin/layout.tsx` allowed()+isFounderAdmin else redirect "/";每 action requireRole(map §105-122) | Observed(map)+Verified(目录存在) | 未逐行核 layout,依 map;目录确有 layout.tsx |
| E3-16 | 市政厅 | X-02 授信上限(单笔≤1000/日≤3000) | 判决 X-02 | implemented(部分) | Unknown | 硬编码常量 | `credit-actions.ts:13` FINANCE_DIRECT_CREDIT_LIMIT=1_000;`:29` \|displayedAmount\|>1000 → 拒「需 founder 批准」 | Verified current source | **断层:单笔≤1000 有闸;日累计≤3000 无实现**(全仓无按 finance/日聚合的计数)。X-02 仅一半落地 |
| E3-17 | 市政厅 | 冒充 30 分钟 / 禁写 / 留痕 | 判决;map §64 | integrated | Unknown | isFounderAdmin 双闸 | `better-auth/server.ts:118` impersonationSessionDuration: 60*30 // 30 min(已逐字复核);禁写:isImpersonating() 阻断 web spend/mutation 入口(map §137 列 gen/refgen/otto/cowork/brand/owner-settings);audit impersonate.start/stop(map §118-119) | Verified current source(时长);map(禁写点/审计) | 30min=1800s **代码逐字确认**;禁写点密集列举;stopImpersonating 故意不 requireRole(F15) |
| E3-18 | 市政厅 | 双人确认(X-04) | 判决 X-04 | Unknown | Unknown | — | 全仓 grep dual/two-person/second-approv 无命中(仅 Otto 卡二次 approve 防重,非治理双人确认) | Verified current source(缺席) | **断层:X-04 双人确认无代码实现证据** |
| E3-19 | 管网 | 夜间 pg_dump→R2 备份 | 判决 7-1「已开工」;P0-1② | integrated(代码在) | Unknown(worker SHA 未知) | env(R2 ops bucket);时间窗 | `apps/worker/src/db-backup.ts:1` 头注;`maybeRunNightlyBackup` 挂 `worker/src/index.ts:264` setInterval 5min + `:266` 启动检查;KL 03:00 窗 + key-exists HEAD 为 exactly-once;`db-backup.test.ts` 在 | Verified current source | 代码**已落地并接线**(非仅"开工")。备份键在 u/<owner>/ 之外(浏览器不可达);fail-soft;DATABASE_URL 仅经 PG* env 不入 argv/log。prod 是否真跑=worker SHA 未知→Unknown |
| E3-20 | 市政厅 | admin 死付费端点清理(7-10~7-14 批) | 工单转述批准 | Unknown | Unknown | — | `app/admin/` 下无 stripe/checkout/payment 页目录(grep 无命中);admin/money+admin/cost 为账本读页 | Verified current source(缺席) | **无法判**:找不到「死付费端点」现存证据,也无清理 commit 指针。可能已清或从未存在;需上级给原始端点清单 |

## 断层观察(原始观察,不排序不评分)

1. **search 3x 缺席(E3-06)**:2026-07-03 定价终案含「search 3x」,但代码无任何 web-search 专属 3× 乘数;研报按 OTTO_LLM_MARGIN(2.0)× turn budget × maxSteps 计价。要么该决定未落地,要么口径已变。
2. **毛利地板 ≥45% 无数值 gate(E3-07)**:唯一的 spend gate(`assertSpendableModel`)是「非 flat-priced 视频模型不可卖」的定性拦截,没有任何计算实际毛利百分比并断言 ≥45% 的机器校验。地板正确性完全依赖「flat 价表已按终案 floor 过」这一人肉假设。
3. **X-02 只落地一半(E3-16)**:单笔 >1000 显示credit 需 founder 批准(硬闸在),但**日累计 ≤3000 完全没实现**——无按 finance 用户/按日的聚合计数逻辑。
4. **X-04 双人确认无实现证据(E3-18)**:治理级 two-person confirmation 全仓 grep 无命中。
5. **市政厅 section 数口径冲突(E3-14)**:RBAC 矩阵 8 section vs admin 页目录 ~16 个 vs 工单「11 section」三者对不上。
6. **admin 死付费端点(E3-20)**:找不到现存死端点,也无清理执行的 commit 证据——判不了「执行了吗」。
7. **fal 非 flat 视频模型仍走 displayedFromUsd(cost)(E3-04)**:只有 seedance-2-fast 在 FLAT_PRICED_VIDEO_MODELS;其余视频模型的 charge=近原始 COGS(≈零毛利),被 E3-07 的 gate 拦在不可卖之外——两者是配套的,但意味着"可卖模型"目前实质=seedance-2-fast 一家。
8. **backup / worker 侧全部 prod=Unknown**:worker 服务 SHA 未知,E3-03(settle/refund)、E3-19(备份)在 prod 是否真在跑无法判。

## Unknowns

- **所有 prod 档**:未在本 worktree checkout `7ed7ac22`,亦无 worker prod SHA;凡需部署证据者一律 Unknown(未编造 production/staged 判定)。
- **search 3x**:是决定被废、改口径、还是漏实现——需上级对照定价终案原文。
- **市政厅「11 section」定义**:11 指 RBAC section、admin 页、还是蓝图分区?代码给不出 11 这个数。
- **X-04 双人确认**:是否本就 deferred 到后期(如 dispute clawback 那样标 Phase 3b)——需查判决原文。
- **admin 死付费端点原始清单**:没有"要清理什么"的指针,无法验证"清理了吗"。
- **E3-15/E3-17 部分依赖 CODEBASE-MAP(2026-07-02 基线)**:admin/layout 逐行、better-auth server.ts 的 1800s 常量未逐字复核(map 转述 + 目录存在为证)。
