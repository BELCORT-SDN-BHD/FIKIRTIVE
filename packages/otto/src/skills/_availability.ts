/**
 * Otto 关于「这一段今天还做不到什么」的那几句 —— 一段事实一处措辞(C7)。
 *
 * ── 客户分群那一句改判(2026-08-20,Founder 裁决,断路器条款下再退一步)──────────────
 * 详细机制解释版(闸门算法、known opt-out 精确定义、字段级读写者取证)连续五轮跨族复判每轮都
 * 被抓到与代码不符 —— 根因是同一个:散文一旦对「谁被选中、选中多少人」下断言,就会被下一批
 * 数据或下一处没查到的写入路径推翻。Founder 裁决放弃这条路,`CRM_SEGMENT_AVAILABILITY`
 * 改为极简事实版,只说三件事:①商家界面今天没有客户分群页面;②联系触达所依赖的底层数据
 * (渠道、同意状态)对多数联系人还不完整;③要回答「这个分群圈到多少人」,必须先调
 * `preview` 读它实测返回的 `matchedCount`,不做预测或估算。不写选择算法、不写 known
 * opt-out 定义、不写任何人数或人群断言。逐句取证与反向禁词围栏都在
 * `availability-truth-fence.test.ts`。
 *
 * Routine 那一句(`ROUTINE_EXECUTION_AVAILABILITY`)本次未改动,仍是静态可证的读写者事实 +
 * 闸门机制 + 行动指令三类内容,见它自己的文档。
 *
 * 这几句是**给模型读的**(技能描述随工具表每轮进上下文),所以措辞按对商家说话的标准写:
 * 中性事实,不写内部原因,不给日期。
 *
 * 「够不着的那一段」这件事的另一半 —— 消息渠道 —— 已经有唯一权威
 * `MESSAGING_STATUS_ASSISTANT`(`@fikirtive/core/messaging-status`),下面直接拼它,不抄第二份。
 */
import { MESSAGING_STATUS_ASSISTANT } from "@fikirtive/core";

/**
 * 分群三条技能共读的那一句 —— 三句短版,逐句取证命令在 `availability-truth-fence.test.ts` 的
 * `CLAIM_EVIDENCE`。
 *
 * · 没有页面 —— `apps/web/app/crm/page.tsx` 及 13 个子页全是 `redirect("/")`
 *   (`apps/web/lib/__tests__/route-redirects.test.ts`),`packages/core/src/navigation.ts`
 *   零 `/crm` href(`navigation.test.ts`)。
 * · 底层数据不完整 —— 产品成熟度陈述,不下精确断言,措辞用软量词("much of"),不用绝对
 *   量词。
 * · preview 实测 —— `apps/web/lib/segment-actions.ts:305` `matchedCount: matched.length` 是
 *   `preview` 真实返回的字段,不是虚构名字。
 */
export const CRM_SEGMENT_AVAILABILITY =
  "Availability, say it plainly whenever segments come up: there is no page in the app today for customer " +
  "segments, contacts or broadcasts, so never send the user to one. Much of the underlying data contact reach " +
  "depends on — channel and consent status — is incomplete for many contacts today. Before saying how many " +
  "contacts a segment or rule reaches, call preview and report only the matchedCount it returns — never a " +
  "prediction or an estimate. " +
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
