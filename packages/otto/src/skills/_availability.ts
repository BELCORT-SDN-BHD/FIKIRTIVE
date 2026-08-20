/**
 * Otto 关于「这一段今天还做不到什么」的那几句 —— 一段事实一处措辞(C7)。
 *
 * ── 设计换代(2026-08-20,四轮 codex 跨族复判 DELTA-FAIL 后编排者触发断路器)──────────
 * 前四轮死在同一个根因:**散文对「谁会被选中/选中多少人」下断言**。r1 channel 写「能用」是
 * 假的 → r2 contactability 方向写反 → r3「今天全部/今天无人」式绝对量词证不出 → r4 连
 * 「四事实圈不出人」这个总断言本身也被证伪(`totalOrdersMyr` schema 允许非空且无字段级约束;
 * migration `20260809100000` 把存量 `ContactIdentity` 整批判成 `channel_verified`,不只是
 * 单条函数逐个授予;既有测试 `segment-actions.test.ts:243-257` 本就有 lifetime/channel 命中
 * 1~2 人的反例)。教训:**grep 只能证明代码层「写不写、调不调」,证不出数据层「有没有、有
 * 多少」**,任何从代码推出「所以匹配 N 人」的句子,下一批数据或下一处没查到的写入路径就能
 * 推翻它。
 *
 * 新规矩 —— 这一段(以及 `availability-truth-fence.test.ts` 的 `CLAIM_EVIDENCE`、
 * `crm-segments.test.ts` 的豁免 `why`)从此只许三类内容:
 *   ① **静态可证的读写者事实**:某字段生产侧有没有写入路径、某函数被谁调用 —— 只说代码层
 *      存在性,永不推断「所以匹配 N 人」。
 *   ② **闸门机制**:选择实际走 `selectedIntoAudience`,不是逐条件独立判断;
 *      `excludeReportedOptOut` 只减不加且作用在闸门算完之后;known opt-out 的精确定义。
 *      若要提 contactable/not_contactable 二分,要么显式带前提(单叶规则组 + 排除开关关
 *      闭),要么干脆不写真值表 —— 本文件选择后者。
 *   ③ **行动指令**:分群保存的是规则定义,联系人动态重算;Otto 要对「这个分群圈到谁/多少
 *      人」说话之前,先调 `preview` 拿实测 `matchedCount` —— 用测量代替预言。
 *
 * 为什么要有这个文件:W2-13(#1007)把 CRM 整段从商家表面收起来了,并且把 Otto 的指令与
 * `listChannelScopes` 的描述一起改了口。但 CRM 引擎与它的六条技能一行没动,于是又回到本仓
 * 那个老根因 —— **说的与做的失同步**:
 *   · `readSegments` / `buildSegment` 照旧写着「和商家自己的屏幕走同一条动作层」,而那些屏幕
 *     今天一扇也打不开(`apps/web/app/crm` 下十四条路由全是 `redirect("/")`);
 *   · Routine 那两条技能只说「本技能不会激活/派发」,没说**整个产品今天都不会**——
 *     商家把规则发布、把 Routine 授权完,什么也不会发生。
 *
 * 这几句是**给模型读的**(技能描述随工具表每轮进上下文),所以措辞按对商家说话的标准写:
 * 中性事实,不写内部原因,不给日期。
 *
 * 「够不着的那一段」这件事的另一半 —— 消息渠道 —— 已经有唯一权威
 * `MESSAGING_STATUS_ASSISTANT`(`@fikirtive/core/messaging-status`),下面直接拼它,不抄第二份。
 */
import { MESSAGING_STATUS_ASSISTANT } from "@fikirtive/core";

/**
 * 分群三条技能共读的那一句 —— 逐节标注属于三类内容里的哪一类。
 *
 * ① **没有页面**[类①](2026-08-19,`grep -rn 'redirect("/")' apps/web/app/crm` + 逐个读)——
 *    `apps/web/app/crm/page.tsx` 及 13 个子页全是 `redirect("/")`;
 *    `packages/core/src/navigation.ts` 零 `/crm` href。两条各有既有围栏:
 *    `apps/web/lib/__tests__/route-redirects.test.ts`、`packages/core/src/navigation.test.ts`。
 *
 * ② **五个规则事实的读写者事实**[类①,只说代码层存在性,不推断匹配结果]:
 *    · `last_order_recency` / `tag` —— `apps/web/lib/segment-actions.ts:64` 的
 *      `UNAVAILABLE_FACTS` 明写这两个;`evaluateContact`(:169-192)构造 `facts` 对象时
 *      **这两个键根本不存在**(不是值为 undefined,是对象字面量里没有这两行) —— 这是构造
 *      方式本身的事实,不依赖任何数据。
 *    · `lifetime_spend` —— 读 `Contact.totalOrdersMyr`。该字段 schema 允许非空
 *      (`packages/db/prisma/schema.prisma:1500`,`Decimal?` 无字段级约束);商家侧唯一能碰
 *      它的入口 `apps/web/lib/crm-actions.ts:325` 拒收("That field is read-only.");grep
 *      全仓(含全部 migration SQL)未发现任何其它写入点。**不推断「所以恒为空」**——schema
 *      允许非空这件事本身说明「有没有值」是数据问题,不是代码问题。
 *    · `channel` —— `contactChannelFacts()`(`apps/web/lib/consent-authority.ts:88-98`)只留
 *      `channel_verified` 等级的身份。这个等级有**两条写入路径**,不是一条:单条函数
 *      `markContactIdentityChannelVerified`(`packages/db/src/contact-identity.ts:95`)按身份
 *      逐条授予;migration
 *      `20260809100000_contact_identity_verification_grade/migration.sql:15-18,35-45`
 *      把迁移前**全部存量** `ContactIdentity` 行一次性判成这个等级(新增列的默认值也是
 *      `channel_verified`)。**r1-r4 四轮都只查了应用代码调用点,漏了这条 migration 写入
 *      路径 —— 这正是本次换设计的直接导火索,记录在此别再犯**。
 *    · `contactability` —— 不是一个能单独查「写不写」的字段,见下面「闸门机制」。
 *
 * ③ **闸门机制**[类②,读代码能证,不依赖数据]:
 *    Otto 分群端口(list/get/preview)不逐条件独立判断,统一走 `selectedIntoAudience`
 *    (`apps/web/lib/consent-authority.ts:122-139`,由 `apps/web/lib/segment-actions.ts:221-233`
 *    的 `matches()` 调用)。精确公式:
 *      · `excludeReportedOptOut === true && truth.reportedOptOut` → 先排除,只减不加,作用
 *        在闸门算完之后(`consent-authority.ts:133`)。
 *      · 非 known opt-out 的 contact → 结果 = `M(opt_in)`。
 *      · known opt-out 的 contact → 结果 = `M(opt_out) && !M(opt_in)`。
 *      · `M` = `contactMatchesRules`(`packages/core/src/segment-rules.ts:382-391`),对**整
 *        个** `all`/`any` 规则组重算,不只是 contactability 那一叶。反例:
 *        `apps/web/lib/__tests__/consent-single-authority.test.ts:703-715` —— `match:"any"`
 *        规则组含 `channel is email` + `contactability=not_contactable` 两叶,一个既是
 *        known opt-out、又持有 email 渠道的联系人**仍被整体排除**(`channel is email` 这一
 *        叶不看 consent,让 `M(opt_out)` 与 `M(opt_in)` 同为 true,消掉了 known-opt-out 本
 *        该带来的差异)。**所以「contactable 选中谁 / not_contactable 选中谁」的简单真值表
 *        只在「规则组只含 contactability 单叶、且 `excludeReportedOptOut` 关闭」时成立,混合
 *        规则组或开着排除开关都有反例 —— 本文件因此不写那张表,导出字符串里也不写。**
 *      · known opt-out(`isKnownOptOut`,`packages/db/src/consent-fold.ts:313-316`)精确定
 *        义,两条独立来源:
 *        ① verified customer 的**撤回**(revoke,不是随便什么 verified 事件):customer +
 *           interactive + verified 的**最后一次立场**如果是 `revoke` → `effective_revoke`;
 *           如果最后一次立场是 `grant` → `verified_grant`(`foldConsentEvents`,
 *           `consent-fold.ts:196-204`)。**只有在完全没有 interactive verified 立场时**,
 *           customer + backfill + verified 的三种基线 revoke 事件
 *           (`historical_verified_revoke` / `historical_verified_stop` /
 *           `stop_purpose_expansion`)才会折出 `effective_revoke`(`consent-fold.ts:207-218`)
 *           —— interactive 立场优先级高于 backfill 基线,一旦出现就覆盖基线的判定。反例:
 *           interactive grant 会保持 `verified_grant`(即使后面又来一条 backfill revoke 基
 *           线事件),见 `packages/db/src/consent-runtime.test.ts:289-323`。
 *        ② 未消解的 legacy opt-out 围栏(`unresolvedLegacyOptOut`,`contactConsentTruth`,
 *           `consent-fold.ts:333-344`):projection 仍是 `unknown`,且旧列
 *           `Contact.marketingConsent === "opt_out"`,scope 限定 whatsapp+marketing —— 零
 *           顾客验证。
 *      · 商家自记 opt-out(`crm_manual` / `import`,`apps/web/lib/crm-actions.ts:297-305` /
 *        `:915-926`,均 merchant/backfill/asserted)**本身不产生 known opt-out**,只落
 *        `truth.reportedOptOut`。`excludeReportedOptOut` 对这批人只做减法,不管这个人原本
 *        落在闸门的哪一侧 —— 反例:
 *        `apps/web/lib/__tests__/segment-reported-optout-exclusion.test.ts:1280-1295`(减掉
 *        三位**非** known-opt-out 的人)、`:1460-1470`(在一个专挑 known-opt-out 的分群里,
 *        照样把其中一位「既是 known opt-out、又被商家手记过」的人减掉)。
 *
 * ④ **行动指令**[类③]:`list` / `get` / `preview` 每次都动态重算联系人
 *    (`apps/web/lib/segment-actions.ts:348-445`);`buildSegment` 只存 `name` / `phrase` /
 *    `rulesJson`(`segment-actions.ts:574-580,603-621,664-675`),不冻结联系人、不触发发送。
 *    **结论**:这一段(以及导出的字符串)不对任何规则「会圈到谁、圈到多少人」下断言 ——
 *    Otto 要回答这类问题,先调 `preview`,读它返回的 `matchedCount`,用测量代替预言。
 *
 * ── 四轮判词全部教训(留着,断路器条款下别再犯)──────────────────────────────────
 * r1:channel 写「能用」是假的。r2:contactability 方向写反。r3:「今天全部/今天无人」式绝对
 * 量词证不出。r4:「四事实圈不出人」这个总断言本身也证不出 —— schema 允许非空、migration 批
 * 量写入、既有测试就有非零反例。四层病灶其实是一个根因:**凡是从代码推出「所以匹配 N 人」的
 * 句子,下一批数据或下一处未查到的写入路径就能推翻它**。断路器条款下的解法不是措辞更精确,
 * 是**这一段从此不允许再写这类句子**——只写读写者事实、闸门机制、和「去 preview 量」的指令。
 */
export const CRM_SEGMENT_AVAILABILITY =
  "Availability, say it plainly whenever segments come up: there is no page in the app today for customer " +
  "segments, contacts or broadcasts, so never send the user to one. This description makes no claim about how " +
  "many contacts any rule or segment matches, or names them as everyone or nobody — that depends entirely on " +
  "this merchant's own data, so call preview and read its matchedCount before saying who a segment reaches or " +
  "how many. Last order recency and tags are never built into the fact object a rule is checked against at " +
  "all — that object has no such keys, by construction. Lifetime spend reads the contact's stored order total; " +
  "the only place this app lets a merchant edit that field rejects the edit, and no other write path for it " +
  "exists in this app's code. Channel reads only identities graded channel-verified — a grade one function " +
  "grants per identity, and this app's migration history has also assigned to every pre-existing identity row " +
  "at once. Contactability's underlying fact is discarded before the check runs: selection re-evaluates the " +
  "whole rule group twice for each contact, once as an opt-in and once as an opt-out, and combines the two " +
  "answers with whether she is a known opt-out — so her final membership can depend on the group's other " +
  "leaves, not on contactability alone. A known opt-out is the customer's own confirmed word that she opted " +
  "out, given through her channel, or — failing that — on file from a verified historical record; a merchant's " +
  "own note that a contact opted out is not itself a known opt-out. The rule group's excludeReportedOptOut can " +
  "additionally leave those merchant-recorded contacts out, but only as a subtraction on top of whatever the " +
  "consent gate already decided, never an addition. A saved segment stores its rule definition only; the " +
  "matching contact list is recalculated live every time it is read, and saving never sends anything. " +
  MESSAGING_STATUS_ASSISTANT;

/**
 * Workflow 两条技能共读的那一句。
 *
 * 逐条实据(2026-08-19 现场核过):
 *   ① 没有页面 —— `/crm/workflows` 与 `/crm/workflows/[id]` 同样是 `redirect("/")`。
 *   ② **没有任何东西会启动一次 run**:执行侧那几个方法(`createWorkflowRun`、
 *      `transitionRoutineRun`、`advanceContactJourney`、`createJourneyDueRun`)都先过
 *      `requireWorker()`,而它第一行就是
 *      `if (!options.resolveWorkerContext) fail("AUTHORITY_UNAVAILABLE")`
 *      (`apps/web/lib/customer-workflow-service.ts:2077-2078`)——
 *      `resolveWorkerContext` 在生产代码里**从未被传入**
 *      (`grep -rn resolveWorkerContext` → 只有 `customer-workflow.test.ts` 传;
 *      `customer-workflow-gateway.ts` 一律 `workflowLifecycleService(prisma)` 不带 options,
 *      导出的方法里也没有任何一个 run/journey 执行方法),
 *      而且 `apps/worker` 的 `QUEUES` 只有 ingest / render / refgen / gen / caption,
 *      `jobs/` 下无 workflow/routine 作业。
 *   ③ 就算跑起来也是模拟:`packages/db/src/workflow-engine.ts` 里唯一那次
 *      `tx.routineRun.createMany` 把 `simulated` 钉死为 true(这一条另有围栏
 *      `apps/web/lib/__tests__/crm-honest-preview.test.ts` 盯着)。
 *
 * 这一句的**围栏**在 `availability-truth-fence.test.ts`:r1 时它两头不靠 —— 判官实测把整句
 * 从描述里删掉,`catalog:check` 照报 fresh(渲染器截断在 80 字符,尾部改动看不见),1275 条
 * 测试全绿。全册 over-promise 词族挡得住「写回一句承诺」,挡不住「悄悄删掉一句实话」。
 */
export const ROUTINE_EXECUTION_AVAILABILITY =
  "Availability, say it plainly whenever a rule's effect comes up: there is no page in the app today for " +
  "workflows or routines, so never send the user to one. Nothing in the product starts a routine run — saving a " +
  "rule, moving the definition pointer to a revision, and authorizing a routine all stop at a stored record, and " +
  "the run engine has no live entry point. Every run the engine is able to record is a simulation with delivery " +
  "and spend disconnected, so no routine action reaches a customer. Give no date for when routines start running.";
