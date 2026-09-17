import "server-only";
import * as Sentry from "@sentry/node";
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
  /**
   * 丢弃**成功了**，审计行没写下去。这必须是它自己的一句话（判官 P2-1）：取消是不可逆的，把整个动作
   * 报成失败会让操作者去重试，而重试时那一条已经不在队列里了 —— 他会读到「已经不在了，什么都没记」，
   * 于是一次**零审计的丢弃**被一句假话盖住。同一形状的先例在 `lib/tenant-actions.ts`
   * （`revokeMerchantAccess` 的 `auditFailed`）：动作算数、痕迹没留下，两件事一起说出口。
   */
  | { ok: true; outcome: "discarded-unaudited" }
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
  /** payload 点名了某一单生成时，那一单在账本上的两个净额；三态见 `DeadLetterLedgerState`。 */
  ledger: DeadLetterLedgerState;
};

/**
 * 一单生成在账本上的两个净额 —— **只看一个是不够的**（判官 P2-3）。
 *
 * `balanceDelta` 与 `reservedDelta` 是两件事：RESERVE 写 `-cost / +cost`，SETTLE 写 `B-A / -B`，
 * REFUND 写 `+amount / -amount`（`packages/db/src/credits.ts`）。只把 `balanceDelta` 求和，
 * 「预留了 110、从没释放」会被报成「扣了 110」，而「结算掉 110」也是「扣了 110」—— 两种完全不同
 * 的局面印出同一句话，偏偏那正是操作者按下 Discard 之前最需要分清的。所以两个数一起报：真花掉的
 * 和还押着的，外加这一单上出现过哪几种账本动作。
 */
export type DeadLetterLedger = {
  /**
   * 已经真正**吃掉**的额度 ＝ −Σ(balanceDelta + reservedDelta)。
   *
   * 不是 −Σ balanceDelta：RESERVE 写 `-cost / +cost`，那一刻 balance 就少了 110，但这 110 只是
   * 从「可用」挪到了「押着」，一分钱都还没花掉（实测：只减 balanceDelta 会把一条纯 RESERVE 报成
   * 「扣了 110」）。`balance + reserved` 才是这个 org 的总额度，它的净减少才是真花掉的那部分。
   * 对照 `packages/db/src/credits.ts`：RESERVE ⇒ 0，RESERVE+SETTLE(A) ⇒ A，RESERVE+REFUND ⇒ 0。
   */
  charged: number;
  /** 还押在这一单上、没有释放的额度 ＝ Σ reservedDelta。>0 就是一笔悬着的预留。 */
  held: number;
  /** 这一单上出现过的账本动作种类（RESERVE / SETTLE / REFUND …），按字母排。 */
  kinds: string[];
  rows: number;
};

/**
 * 账本那一行的三态。**「读失败」不许长得跟「没有钱这回事」一样**（判官 P2-2）：
 *   · `DeadLetterLedger` —— 读到了，这是那一单的数；
 *   · `null` —— payload 根本没点名哪一单生成活，没有账可查；
 *   · `"unreadable"` —— 查了，没查成（pooler 抖、库不可达）。
 * 上一版把第三种 `.catch(() => new Map())` 成第二种，于是一次失败的账本读在屏幕上表现为「这一条
 * 不涉及钱」，操作者可能就此丢掉一条预留还悬着的活。这与本文件开头那条「读不到 vs 读到空是两句话」
 * 是同一条规矩，只是上一版没把它执行到账本这一层。
 */
export type DeadLetterLedgerState = DeadLetterLedger | null | "unreadable";

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
 * 这些单子在账本上的两个净额（扣掉的 / 还押着的）。**只读、只求和**，一行都不写 —— 丢弃一条死信从来不动钱
 * （`dlq-actions.ts` 与 DLQ-A4 的断言）。它存在的理由只有一个：操作者按下 Discard 之前，要能一眼
 * 看见「这一单的钱已经了结了」，而不是去翻账本页再回来。
 */
async function ledgerNets(
  genJobIds: string[],
): Promise<{ readable: true; nets: Map<string, DeadLetterLedger> } | { readable: false }> {
  const nets = new Map<string, DeadLetterLedger>();
  if (genJobIds.length === 0) return { readable: true, nets };
  // 按 `refId × kind` 分组，而不是只按 `refId`：动作种类是屏幕上那句话的一半（判官 P2-3），
  // 而一次聚合就能把它带回来，不必为此多跑一趟查询。
  //
  // 结果用 `.then/.catch` 收成一个标记联合，而不是 `try { grouped = await … }`：Prisma 7 的
  // `groupBy` 用**返回值**反推入参的类型，给 `grouped` 写一个显式类型标注会让那条推断反过来失败
  // （实测 tsc TS2345，把入参当成了返回的数组类型）。
  const grouped = await prisma.creditLedger
    .groupBy({
      by: ["refId", "kind"],
      where: { refId: { in: genJobIds } },
      _sum: { balanceDelta: true, reservedDelta: true },
      _count: { _all: true },
    })
    .then((rows) => ({ ok: true as const, rows }))
    .catch((error: unknown) => {
      reportLedgerReadFailure(error);
      return { ok: false as const };
    });
  if (!grouped.ok) return { readable: false };
  for (const row of grouped.rows) {
    if (!row.refId) continue;
    const current = nets.get(row.refId) ?? { charged: 0, held: 0, kinds: [], rows: 0 };
    current.charged -= (row._sum.balanceDelta ?? 0) + (row._sum.reservedDelta ?? 0);
    current.held += row._sum.reservedDelta ?? 0;
    current.rows += row._count._all;
    current.kinds.push(row.kind);
    nets.set(row.refId, current);
  }
  for (const entry of nets.values()) entry.kinds.sort();
  return { readable: true, nets };
}

/**
 * 账本读失败要**有人看得见**。屏幕上那句「读不到」只有正在看的那个人读得到，而这条读失败可能是
 * pooler 正在抖 —— 团队该知道。纪律同 `dlq-watch.ts` 的上报：只报**失败的分类**（错误类名与
 * Prisma 错误码），不报原始 message —— Prisma 的 message 会把调用参数渲染进去，而这里的参数是
 * 商家的生成单号（同 `lib/tenant-actions.ts` 第 4 轮判官那条）。
 *
 * 整条包在 try/catch 里：告警自己会抛（transport 没起、DSN 配错、序列化炸掉），而这条读只是页面的
 * 一部分 —— 告警响不响都不许把整张看板拖成 500。
 */
function reportLedgerReadFailure(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  try {
    Sentry.captureMessage("Dead-letter board could not read the credit ledger", {
      level: "error",
      tags: { area: "admin", gate: "dead-letter-ledger" },
      extra: {
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: typeof code === "string" ? code : undefined,
      },
    });
  } catch {
    // 告警通道自己炸了。咽下去是这里唯一正确的答案：`"unreadable"` 已经上了屏幕，看板照常渲染。
  }
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

  const ledger = await ledgerNets(
    [...new Set(visible.map((item) => genJobIdOf(item.identifiers)).filter((id): id is string => Boolean(id)))],
  );

  return {
    readable: true,
    truncated,
    items: visible.map((item) => {
      const genJobId = genJobIdOf(item.identifiers);
      // 没点名生成单 ⇒ `null`（没有账可查）；点名了但这一趟读失败 ⇒ `"unreadable"`。两者
      // 长得不一样，屏幕上说的也就不是同一句话。
      if (!genJobId) return { ...item, ledger: null };
      return { ...item, ledger: ledger.readable ? (ledger.nets.get(genJobId) ?? null) : ("unreadable" as const) };
    }),
  };
}
