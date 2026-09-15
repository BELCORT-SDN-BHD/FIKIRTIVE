import "server-only";
import { prisma } from "@fikirtive/db";
import { DEAD_LETTER_QUEUES } from "@fikirtive/core";

/**
 * 后台读死信清单（Founder 2026-09-15 裁决，登记在 docs/specs/fail-closed-reliability.md §5）。
 *
 * 为什么要有这一层：`/api/ops/dlq` 只答「有没有」（clear / backed-up / unknown），`/admin/queue`
 * 只画生成队列的指标 —— 于是一条卡在 `gen.dlq` 里的死信，整个产品里**没有任何地方能看到它是哪一条、
 * 也没有任何地方能把它处理掉**。staging 今天就正好卡着一条，探针因此长期 503，而唯一的处理手段是
 * 对库跑裸 SQL（本仓禁止）。这一层补上「看」，`dlq-actions.ts` 补上「丢弃」。
 *
 * 读法与探针**逐字同源**（`lib/dlq-watch.ts` 的 `queryJobTable`）：同一张 `pgboss.job`、同一个
 * `state <= 'active'` 判据、同一份 `DEAD_LETTER_QUEUES` 名单。两边必须是同一条判据，否则「看板上
 * 没了」和「探针不再数它」会变成两句话 —— 而丢弃这个动作的全部意义就是让这两句话永远一致。
 *
 * 租户：死信是 **pg-boss 的平台级行**，`pgboss.job` 里没有 ownerId／orgId 这一列，也没有任何按租户
 * 切分的读法 —— 所以这里不做租户过滤，不是漏了，是这张表本身没有租户维度（同 `/admin/queue` 的其余
 * 指标）。唯一带租户的那一笔读取是下面的账本净额，它按 `refId` 精确查、只求和、不写。
 */

/** 一次看板渲染最多列这么多条。死信本该是零；几十条以上是另一种故障，不该靠一个列表页处理。 */
const MAX_ROWS = 50;

/**
 * 丢弃动作的审计行 type，与它的返回形状。
 *
 * 它们住在这里而不是 `dlq-actions.ts`，是因为那个文件带着 `"use server"` —— Next 只允许那种模块
 * 导出 async 函数，多一个常量或类型，`next build` 会把整个模块的导出判成空（实测：
 * "The module has no exports at all"），而 vitest 与 tsc 全绿。这是本仓记录在案的老坑
 * （`export type {}` 只有 next build 会炸）。
 */
export const DLQ_DISCARD_EVENT = "dlq.discard";

export type DiscardDeadLetterResult =
  | { ok: true; outcome: "discarded"; auditEventId: string }
  | { ok: true; outcome: "already-gone" }
  | { error: string };

/** payload 里可以原样显示的键：形如 `genJobId` / `id` 的标识符。 */
const IDENTIFIER_KEY = /(^id|Id)$/;

export type DeadLetterIdentifier = { key: string; value: string };

export type DeadLetterItem = {
  queue: string;
  jobId: string;
  /** ISO-8601（UTC）。 */
  createdAt: string;
  /** payload 里的标识符，原样给操作者 —— 这是他判断「这是谁的什么活」的唯一依据。 */
  identifiers: DeadLetterIdentifier[];
  /**
   * payload 里其余键**只报键名，不报值**。死信里躺的是商家的活，payload 可以带提示词、文件名、
   * 商品描述；一个后台列表页不需要把那些字摊开才能让人按下 Discard（同 `dlq-watch.ts` 对 Sentry
   * 的那条纪律：只说哪条队列、几条，不带 payload）。
   */
  withheldKeys: string[];
  /** payload 点名了某一单生成时，那一单在账本上的净额；没点名或查不到则 null。 */
  ledger: { net: number; rows: number } | null;
};

/**
 * 「读不到」和「读到了，是空的」必须是两句不同的话（`packages/core/src/dead-letters.ts` 立的规矩）。
 * 看板照这条来：库读不到时不画一个空清单冒充「一条都没有」。
 */
export type DeadLetterListing =
  | { readable: true; items: DeadLetterItem[]; truncated: boolean }
  | { readable: false };

type JobRow = { queue: string; jobId: string; createdAt: Date; data: unknown };

function summarise(data: unknown): { identifiers: DeadLetterIdentifier[]; withheldKeys: string[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { identifiers: [], withheldKeys: [] };
  const identifiers: DeadLetterIdentifier[] = [];
  const withheldKeys: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (IDENTIFIER_KEY.test(key) && (typeof value === "string" || typeof value === "number")) {
      identifiers.push({ key, value: String(value).slice(0, 64) });
    } else {
      withheldKeys.push(key);
    }
  }
  return { identifiers, withheldKeys };
}

/** payload 点名的生成单号（`gen.dlq` 的 payload 就是 `{ genJobId }`，见 apps/web/lib/gen-actions.ts）。 */
function genJobIdOf(identifiers: DeadLetterIdentifier[]): string | null {
  return identifiers.find((entry) => entry.key === "genJobId")?.value ?? null;
}

/**
 * 这些单子在账本上的净额。**只读、只求和**，一行都不写 —— 丢弃一条死信从来不动钱
 * （`dlq-actions.ts` 与 DLQ-A4 的断言）。它存在的理由只有一个：操作者按下 Discard 之前，要能一眼
 * 看见「这一单的钱已经了结了」，而不是去翻账本页再回来。
 */
async function ledgerNets(genJobIds: string[]): Promise<Map<string, { net: number; rows: number }>> {
  const nets = new Map<string, { net: number; rows: number }>();
  if (genJobIds.length === 0) return nets;
  const grouped = await prisma.creditLedger.groupBy({
    by: ["refId"],
    where: { refId: { in: genJobIds } },
    _sum: { balanceDelta: true },
    _count: { _all: true },
  });
  for (const row of grouped) {
    if (row.refId) nets.set(row.refId, { net: row._sum.balanceDelta ?? 0, rows: row._count._all });
  }
  return nets;
}

export async function listDeadLetters(): Promise<DeadLetterListing> {
  let rows: JobRow[];
  try {
    rows = await prisma.$queryRaw<JobRow[]>`
      SELECT j.name AS "queue",
             j.id::text AS "jobId",
             j.created_on AS "createdAt",
             j.data AS "data"
        FROM pgboss.job j
       WHERE j.name = ANY(${[...DEAD_LETTER_QUEUES]}::text[])
         AND j.state <= 'active'
       ORDER BY j.created_on ASC
       LIMIT ${MAX_ROWS + 1}`;
  } catch {
    // 队列表读不到（pgboss schema 还没建、库不可达、pooler 重启）。不画空清单。
    return { readable: false };
  }

  const truncated = rows.length > MAX_ROWS;
  const visible = rows.slice(0, MAX_ROWS).map((row) => ({
    queue: row.queue,
    jobId: row.jobId,
    createdAt: new Date(row.createdAt).toISOString(),
    ...summarise(row.data),
  }));

  const nets = await ledgerNets(
    [...new Set(visible.map((item) => genJobIdOf(item.identifiers)).filter((id): id is string => Boolean(id)))],
  ).catch(() => new Map<string, { net: number; rows: number }>());

  return {
    readable: true,
    truncated,
    items: visible.map((item) => {
      const genJobId = genJobIdOf(item.identifiers);
      return { ...item, ledger: genJobId ? (nets.get(genJobId) ?? null) : null };
    }),
  };
}
