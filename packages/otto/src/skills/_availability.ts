/**
 * Otto 关于「这一段今天还做不到什么」的那几句 —— 一段事实一处措辞(C7)。
 *
 * 为什么要有这个文件:W2-13(#1007)把 CRM 整段从商家表面收起来了,并且把 Otto 的指令与
 * `listChannelScopes` 的描述一起改了口。但 CRM 引擎与它的六条技能一行没动,于是又回到本仓
 * 那个老根因 —— **说的与做的失同步**:
 *   · `readSegments` / `buildSegment` 照旧写着「和商家自己的屏幕走同一条动作层」,而那些屏幕
 *     今天一扇也打不开(`apps/web/app/crm` 下十四条路由全是 `redirect("/")`);
 *   · 分群五个规则事实**今天一个都圈不出一群人**(下面逐条列证据与取证命令),可技能描述把
 *     五个并列写,模型据此建出来的分群会**静默地空**;
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
 * 分群三条技能共读的那一句。
 *
 * 逐条实据。每一条都写明**谁验的、什么命令**,因为这一段本身就是一次「说真话」——
 * 它自己失实过一次(见文末「r1 的教训」),所以每个事实主张都必须自带取证路径。
 *
 * ① **没有页面**(2026-08-19,`grep -rn 'redirect("/")' apps/web/app/crm` + 逐个读)——
 *    `apps/web/app/crm/page.tsx` 及 13 个子页全是 `redirect("/")`;
 *    `packages/core/src/navigation.ts` 零 `/crm` href。两条各有既有围栏:
 *    `apps/web/lib/__tests__/route-redirects.test.ts`、`packages/core/src/navigation.test.ts`。
 *
 * ② **五个规则事实,今天一个都圈不出一群人**。逐支的死因不同,但结论一样:
 *    · `last_order_recency` / `tag` —— `apps/web/lib/segment-actions.ts:64` 的
 *      `UNAVAILABLE_FACTS` 明写缺席,`evaluateContact`(:169-192)构造 `facts` 时根本不放
 *      它们,于是 `packages/core/src/segment-rules.ts` 的两支恒 false
 *      (`parseInstant(undefined)→null`、`Array.isArray(undefined)→false`)。
 *    · `lifetime_spend` —— 读 `Contact.totalOrdersMyr`,该列**全仓零写入点**
 *      (`grep -rn totalOrdersMyr`:生产侧只有读;`apps/web/lib/crm-actions.ts:325` 明确
 *      拒收 "That field is read-only.")。永远 null → `isAmount(undefined)` 假 → 恒 false。
 *    · `channel` —— **r1 把这一支写成「能用」,那是假的**。`contactChannelFacts()`
 *      (`apps/web/lib/consent-authority.ts`)只留 `isChannelVerifiedIdentity` 的行,而写
 *      `CHANNEL_VERIFIED_IDENTITY` 的全仓只有 `packages/db/src/contact-identity.ts:95`
 *      (函数 `markContactIdentityChannelVerified`),**它零生产调用点**
 *      (`grep -rn markContactIdentityChannelVerified` → 只有两个测试文件)。生产侧八处身份
 *      写入全钉 `MERCHANT_UNVERIFIED_IDENTITY`(`crm-actions.ts:216/232/522/536/545/609/634/675`),
 *      而且 `crm-actions.test.ts:541` 有围栏禁止那个文件写 verified 等级。要升级只能靠
 *      「连得上的渠道」,而渠道连不上 —— 这句话就印在本段末尾拼进来的那个权威里。
 *    · `contactability` —— 只有**一侧**选得出人。`contactable` 要
 *      `marketingConsent === "opt_in"`,`opt_in` 要 `consentFact()` 拿到 `verified_grant`,
 *      而 `packages/db/src/consent-fold.ts` 只对 customer + interactive + verified 的事件给
 *      `verified_grant`;生产两个 `recordConsentEvent` 调用点
 *      (`crm-actions.ts:297` `crm_manual`、`:917` `import`)在闭合写者矩阵里都是
 *      merchant / backfill / asserted。所以 `contactable` 恒空,`not_contactable` 恒全中。
 *
 *    **行为自证**(2026-08-19 本机跑过,临时探针已删;同款断言已固化进
 *    `availability-truth-fence.test.ts`,不再依赖一次性脚本):
 *      contactChannelFacts([{whatsapp, merchant_unverified}]) → []
 *      rule `channel is whatsapp` vs 生产形状的 contact       → false
 *      rule `contactable`         vs 生产形状的 contact       → false
 *      rule `not_contactable`     vs 生产形状的 contact       → true
 *
 * ③ **圈出来的人今天也到不了** —— 渠道那半句拼唯一权威,不抄第二份。
 *
 * ── r1 的教训(留着,别再犯)──────────────────────────────────────────────
 * 这一段的第一版写着「channel 和 contactability 两个事实选得出真人」。channel 那半句是**假**
 * 的,而且它和三句之后拼进来的「渠道连不上」在同一个字符串里自相矛盾 —— 本票要消灭的正是
 * 这个形状,却由本票亲手写进了模型上下文。教训是:**「有数据结构」不等于「有数据」**,
 * 判定标准必须是「生产代码里有没有一个真实商家够得到的写入点,file:line?」——
 * `apps/web/app/privacy/page.tsx` 那把尺子早就立在那儿了,这一段第一版没有拿它量 channel。
 */
export const CRM_SEGMENT_AVAILABILITY =
  "Availability, say it plainly whenever segments come up: there is no page in the app today for customer " +
  "segments, contacts or broadcasts, so never send the user to one. No segment rule can pick out a group of " +
  "customers yet, so say that before building one. Four of the five rule facts have nothing behind them — last " +
  "order recency, tags, lifetime spend, and channel, which counts only a number that a connected channel has " +
  "confirmed — so a rule using any of those four matches nobody rather than guessing. The fifth, contactability, " +
  "works in one direction only: contactability=not_contactable matches every contact, and " +
  "contactability=contactable matches nobody, because opt-in needs the customer's own confirmation. A saved " +
  "segment is a list and nothing more today. " +
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
