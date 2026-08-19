/**
 * Otto 关于「这一段今天还做不到什么」的那几句 —— 一段事实一处措辞(C7)。
 *
 * 为什么要有这个文件:W2-13(#1007)把 CRM 整段从商家表面收起来了,并且把 Otto 的指令与
 * `listChannelScopes` 的描述一起改了口。但 CRM 引擎与它的六条技能一行没动,于是又回到本仓
 * 那个老根因 —— **说的与做的失同步**:
 *   · `readSegments` / `buildSegment` 照旧写着「和商家自己的屏幕走同一条动作层」,而那些屏幕
 *     今天一扇也打不开(`apps/web/app/crm/**` 十四条路由全是 `redirect("/")`);
 *   · 分群五个事实里只有两个真的选得出人,另外三个的规则一条也匹配不到(下面逐条列证据),
 *     可技能描述把五个并列写,模型据此建出来的分群会**静默地空**;
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
 * 逐条实据(2026-08-19 现场核过,变了就该回来改这一句):
 *   ① 没有页面 —— `apps/web/app/crm/page.tsx` 及 13 个子页全是 `redirect("/")`;
 *      `packages/core/src/navigation.ts` 里 Customers 那一格已删。
 *   ② 五个事实只有两个选得出人:
 *      · lastOrderAt / tags —— `apps/web/lib/segment-actions.ts:64` 的 `UNAVAILABLE_FACTS`
 *        把这两个事实明写成缺席,`evaluateContact` 根本不往 `facts` 里放它们,于是
 *        `packages/core/src/segment-rules.ts` 的 `last_order_recency` / `tag` 两支
 *        无条件 `return false`;
 *      · lifetime spend —— 读的是 `Contact.totalOrdersMyr`,而这一列**全仓零写入点**
 *        (生产侧 `apps/web/lib/crm-actions.ts:325` 明确拒收:"That field is read-only.";
 *        `apps/web/app/privacy/page.tsx:30` 按同一把「写入点」尺子早已判过一次)。
 *        列永远是 null → `isAmount(undefined)` 为假 → 这一支也匹配不到人。
 *      · 真选得出人的两个是 channel 与 contactability。
 *   ③ 分群选出来的人今天到不了 —— 渠道那半句用唯一权威。
 */
export const CRM_SEGMENT_AVAILABILITY =
  "Availability, say it plainly whenever segments come up: there is no page in the app today for customer " +
  "segments, contacts or broadcasts, so never send the user to one. Two of the five rule facts select real " +
  "people — channel and contactability. The other three have nothing behind them yet: last order recency and " +
  "tags are not connected, and lifetime spend has no source of data in the product, so a rule built on any of " +
  "those three matches nobody rather than guessing. A saved segment is a list and nothing more today. " +
  MESSAGING_STATUS_ASSISTANT;

/**
 * Workflow 两条技能共读的那一句。
 *
 * 逐条实据(2026-08-19 现场核过):
 *   ① 没有页面 —— `/crm/workflows` 与 `/crm/workflows/[id]` 同样是 `redirect("/")`。
 *   ② **没有任何东西会启动一次 run**:执行侧那几个方法(`createWorkflowRun`、
 *      `transitionRoutineRun`、`advanceContactJourney`、`createJourneyDueRun`)都先过
 *      `requireWorker()`,而它第一行就是
 *      `if (!options.resolveWorkerContext) fail("AUTHORITY_UNAVAILABLE")` ——
 *      `resolveWorkerContext` 在生产代码里**从未被传入**(全仓只有测试传),
 *      而且 `apps/worker` 里一条 workflow/routine 队列都没有。网关与 UI 动作也不导出这几个方法。
 *   ③ 就算跑起来也是模拟:`packages/db/src/workflow-engine.ts` 里唯一那次
 *      `tx.routineRun.createMany` 把 `simulated` 钉死为 true(这一条另有围栏
 *      `apps/web/lib/__tests__/crm-honest-preview.test.ts` 盯着)。
 */
export const ROUTINE_EXECUTION_AVAILABILITY =
  "Availability, say it plainly whenever a rule's effect comes up: there is no page in the app today for " +
  "workflows or routines, so never send the user to one. Nothing in the product starts a routine run — saving a " +
  "rule, moving the definition pointer to a revision, and authorising a routine all stop at a stored record, and " +
  "the run engine has no live entry point. Every run the engine is able to record is a simulation with delivery " +
  "and spend disconnected, so no routine action reaches a customer. Give no date for when routines start running.";
