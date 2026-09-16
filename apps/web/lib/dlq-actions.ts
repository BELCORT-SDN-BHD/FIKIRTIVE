"use server";
/**
 * 丢弃一条死信 + 留一行审计（Founder 2026-09-15 裁决；登记在
 * docs/specs/fail-closed-reliability.md §5，验收编号 DLQ-A1…A5）。
 *
 * 为什么会有这个动作：七条（今天八条）队列都配了 `deadLetter`，而**没有任何东西消费它们**
 * （`packages/core/src/dead-letters.ts` 开头那段逐字写着这是设计）。放弃一件活没有错，错的是放弃
 * 之后**没有出口** —— 探针 `/api/ops/dlq` 会为那一条永远 503，`/admin/queue` 看不见它，产品里唯一
 * 的处理手段是对生产库跑裸 SQL，而本仓禁止那么做。于是一条死信 = 一个永久红灯。
 *
 * 这个动作只做一件事，并且**只做那一件**：
 *   · 它把那一条 pg-boss job 从「等着被人捞走」变成 `cancelled`，探针从此不再数它。
 *   · 它**一个字都不碰 CreditLedger**。死信是队列行，不是账。钱的了结另有其人（预留—结算—退款那
 *     一套，`understand.ts` / `gen.ts`），丢弃一条死信既不退钱也不扣钱 —— DLQ-A4 用「零账本行」
 *     的断言把这条钉死。
 *   · 它留一行 `ActionEvent`：谁、丢了哪条队列的哪个 job、payload 里点名了什么、什么时候。
 *     没有这一行，这个按钮就是一个能悄悄抹掉证据的按钮。
 *
 * 权限用 **`system.mutate`**，不是 `/admin/queue` 今天的 `system.read`。看板是只读面，`viewer` 角色
 * 就持有 `system.read`（`packages/core/src/roles.ts` 的 `PLATFORM_ROLE_CAPABILITIES`）—— 把一个不可逆
 * 的写动作挂在读权限下，等于让只读角色去销毁队列状态。同一个 section、write 那一半，和这套 RBAC
 * 里其他「看得见／动得了」的分法一致（`ops` 与 `super-admin` 持有，`viewer` 不持有）。
 *
 * 租户：死信是 pg-boss 的**平台级行**，`pgboss.job` 没有租户列，所以这里没有 org 作用域可言 ——
 * 与 `/admin/queue` 其余指标同一条结构（staff 帧的 `ownerId = null`，守卫按扫描域处理）。
 */
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/node";
import { prisma, type Prisma } from "@fikirtive/db";
import { runAsStaff } from "@fikirtive/db/principal";
import { DEAD_LETTER_QUEUES, FOUNDER_OWNER_ID, newId } from "@fikirtive/core";
import { requireRole, staffPrincipal } from "./auth-guard";
import { getBoss } from "./queue";
// 常量与返回类型住在 `dead-letters-admin.ts`：带 `"use server"` 的模块只能导出 async 函数，
// 多一个常量或类型就会让 `next build` 把整个模块的导出判成空（那边的注释写了实测现象）。
import { DLQ_DISCARD_EVENT, type DiscardDeadLetterResult } from "./dead-letters-admin";

/** 只允许死信队列。少了这一条，同一个动作就能取消 `gen`／`publish` 上**在飞**的活。 */
const DISCARDABLE_QUEUES = new Set<string>(DEAD_LETTER_QUEUES);
/** pg-boss 的 job id 是 uuid；不先挡一次，畸形 id 会带着 `::uuid` 转换直接炸在 Postgres 上。 */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTarget(raw: unknown): { queue: string; jobId: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const { queue, jobId } = raw as { queue?: unknown; jobId?: unknown };
  if (typeof queue !== "string" || !DISCARDABLE_QUEUES.has(queue)) return null;
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) return null;
  return { queue, jobId };
}

/**
 * pg-boss 12.18.2 把 `cancel()` 的返回值类型写成了空接口 `CommandResponse {}`
 * （dist/types.d.ts），而运行时返回的是 `{ jobs, requested, affected }`
 * （dist/manager.js `mapCommandResponse`）。这里按运行时形状收窄，并且**把缺席当 0**：
 * 读不出「改了几行」时，宁可当成没改（不写审计行），也不写一行证明不了的审计。
 */
type CancelResponse = { affected?: unknown };

export async function discardDeadLetter(raw: unknown): Promise<DiscardDeadLetterResult> {
  const gate = await requireRole("system", "mutate");
  if ("error" in gate) return gate;
  return runAsStaff(staffPrincipal(gate, null), () => discardInFrame(gate, raw));
}

async function discardInFrame(
  gate: { email: string },
  raw: unknown,
): Promise<DiscardDeadLetterResult> {
  const target = parseTarget(raw);
  if (!target) return { error: "That isn't a dead-letter job this page can discard." };
  const { queue, jobId } = target;

  // 先读 payload，再取消 —— 取消之后 payload 还在库里，但这个顺序让「有没有这一条」和「审计行写
  // 什么」来自同一次观察。判据与探针逐字同源（lib/dlq-watch.ts）：`state <= 'active'` 之外的行
  // 探针本来就不数，对这个动作而言它们已经不存在。
  let rows: { data: unknown }[];
  try {
    rows = await prisma.$queryRaw<{ data: unknown }[]>`
      SELECT j.data AS "data"
        FROM pgboss.job j
       WHERE j.name = ${queue}
         AND j.id = ${jobId}::uuid
         AND j.state <= 'active'
       LIMIT 1`;
  } catch {
    return { error: "Couldn't reach the queue — try again in a moment." };
  }
  // 已经不在了（别人先丢了、pg-boss 自己清了）。这是**结果正确**，不是错误：操作者要的状态
  // 已经成立。不写审计行，所以连丢两次也只留一行。
  if (rows.length === 0) return { ok: true, outcome: "already-gone" };

  let affected: number;
  try {
    const boss = await getBoss();
    // pg-boss 自己的状态迁移，不是裸 DELETE：`cancel` 把 state 置为 `cancelled`
    // （dist/plans.js `cancelJobs`），行还在库里可查，而探针的 `state <= 'active'` 不再数它。
    // 物理删除会把「这条活被放弃过」这件事一起删掉 —— 审计行就失去了可对照的对象。
    const response = (await boss.cancel(queue, jobId)) as CancelResponse;
    affected = typeof response.affected === "number" ? response.affected : 0;
  } catch {
    return { error: "Couldn't discard that job — try again in a moment." };
  }
  // 读到和取消之间被人抢先了。同上：结果正确，不写审计行。
  if (affected === 0) return { ok: true, outcome: "already-gone" };

  // 取消**已经发生**，而且不可逆。这一行审计写不下去（pooler 抖一下、Organization 的外键、库满）
  // 不许把整个动作报成失败（判官 P2-1）：报失败 ⇒ 操作者重试 ⇒ 上面那次预读什么都找不到 ⇒ 他读到
  // 「已经不在了，什么都没记」—— 一次**零审计的丢弃**被一句假话盖住，与 DLQ-A2／A3 和这个文件
  // 开头那段「没有这一行，这个按钮就是一个能悄悄抹掉证据的按钮」直接相反。
  //
  // 正确的答案是两件事一起说出口：活丢掉了（真的），痕迹没留下（也是真的），请手工补一条。形状照
  // `lib/tenant-actions.ts` 的 `revokeMerchantAccess`（`auditFailed`）那条既有先例，只是这里的返回
  // 是个 outcome 联合，所以它是自己的一个 outcome 而不是一面旗。
  const auditEventId = newId();
  const audited = await prisma.actionEvent
    .create({
      data: {
        id: auditEventId,
        // 平台级动作的审计一律挂 founder org，与 `rbac.deny`／`directive.edit` 同一归属
        // （ActionEvent 在 TENANT_GUARD_EXEMPT 名单里：append-only 审计，后台读天生跨租户）。
        ownerId: FOUNDER_OWNER_ID,
        type: DLQ_DISCARD_EVENT,
        payload: { queue, jobId, data: summariseForAudit(rows[0]!.data), via: gate.email },
      },
    })
    .then(() => true)
    .catch((error: unknown) => {
      reportAuditFailure(error, queue, jobId);
      return false;
    });

  // 不管审计写成没写成，队列里那一条都已经是 `cancelled` 了 —— 看板必须照实重画。
  revalidatePath("/admin/queue");
  return audited ? { ok: true, outcome: "discarded", auditEventId } : { ok: true, outcome: "discarded-unaudited" };
}

/**
 * 审计写失败要**有人看得见**，而屏幕上那句话只有正在看的那个人读得到。
 *
 * 纪律同 `dlq-watch.ts` 对 Sentry 的那条：**不带 payload、不带商家标识**，只说哪条队列的哪个 job
 * （两者都是 pg-boss 的平台级标识，不是商家内容）＋ 失败的分类。原始 message 一个字都不带 ——
 * Prisma 会把调用参数渲染进 message，而这次调用的参数里就有那份 payload 摘要
 * （同 `lib/tenant-actions.ts` 第 4 轮判官那条）。
 *
 * 整条包在 try/catch 里：`captureMessage` 自己会抛（transport 没起、DSN 配错、序列化炸掉），而这条
 * 路上取消已经落库 —— 告警自己的错顺着 promise 冒出去会让操作者读到「动作没完成」，那正是这条修复
 * 要消灭的那句假话（`lib/tenant-actions.ts` 第 9 轮同一条口径：响不响都不许改变这条路的答案）。
 */
function reportAuditFailure(error: unknown, queue: string, jobId: string): void {
  const code = (error as { code?: unknown } | null)?.code;
  const errorName = error instanceof Error ? error.name : typeof error;
  // Sentry 没配 DSN 的环境（本机、CI）至少留一行可 grep 的痕迹。
  console.error(`[dlq-discard] job discarded but its audit row could not be written (queue=${queue}, jobId=${jobId}):`, errorName);
  try {
    Sentry.captureMessage("Dead letter discarded but its audit row could not be written", {
      level: "error",
      tags: { area: "admin", gate: "dlq-discard-audit" },
      extra: { queue, jobId, errorName, errorCode: typeof code === "string" ? code : undefined },
    });
  } catch {
    // 告警通道自己炸了。咽下去是这里唯一正确的答案：`discarded-unaudited` 那句话照样上屏幕，
    // 操作者看得见「这一次没留下痕迹」。
  }
}

/**
 * 审计行里的 payload 摘要：**标识符原样留，其余只留键名**。审计要能回答「丢掉的是哪一单」，不需要
 * 把商家的提示词或文件名再抄进一张永久保留的表里（同 `dead-letters-admin.ts` 给页面的那份摘要，
 * 也同 `dlq-watch.ts` 对 Sentry 的纪律）。
 */
function summariseForAudit(data: unknown): Prisma.InputJsonObject | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const summary: Record<string, string | string[]> = {};
  const withheldKeys: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (/(^id|Id)$/.test(key) && (typeof value === "string" || typeof value === "number")) {
      summary[key] = String(value).slice(0, 64);
    } else {
      withheldKeys.push(key);
    }
  }
  if (withheldKeys.length > 0) summary.withheldKeys = withheldKeys;
  return summary;
}
