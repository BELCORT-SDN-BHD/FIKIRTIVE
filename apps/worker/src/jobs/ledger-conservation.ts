/**
 * ledger-conservation.ts —— **账本守恒的生产探测器**(规格 §5 变更登记 2026-09-02
 * 顾问复审结构性风险⑥;钱引擎⑤B 落地)。
 *
 * ── 补的是哪个洞 ────────────────────────────────────────────────────────────
 * 整条钱路只有一个不变量:**余额 = 这个 org 全部流水之和**(`balance == Σ balanceDelta`)。
 * 它今天活在两个地方 —— `credits.ts` 的注释,和 `credits.test.ts` 的单测。两个都在**开发机**
 * 上。生产上没有任何东西在核它:一次带 bug 的部署、一次手工 SQL、一条绕过 `grantCredits`
 * 的写入,都会让某个 org 的余额和它的流水悄悄分家,而**没有人会发现**——商家看到的是余额,
 * 我们对账看的是流水,两边各自自洽。
 *
 * 这个每日巡检就是那双眼睛。它的边界和 `stripe-reconcile` 一字不差:
 *   - **只报警,绝不补账**。发现漂移不改余额、不写流水。补账是人的决定(哪一边是真的、
 *     该补哪一笔、要不要退款),把它自动化就是在钱路上开出第二个权威 —— 而 Money
 *     exactly-once 的全部内容就是「只有一个权威」。
 *   - 只读:一句聚合 SQL 读账本与账户,一句读最近 24 小时的 SETTLE 行。唯一的写是**节流行**
 *     (ActionEvent),它不是钱。
 *
 * ── 第二件事:hold-shortfall 的可观测性 ──────────────────────────────────────
 * `settleCredits` 在「实际用量 > 持有额」时会把结算钳到持有额,差额是**平台自己吃掉的钱**,
 * 记在 SETTLE 行的 `reason` 上(`hold-shortfall:<n>`)。这个设计是对的 —— 行本身就是幂等
 * 守卫,所以吸收额天然精确一次。但它此前**只有查询才看得见**:没有任何一条路径会主动说
 * 「昨天我们吃掉了多少」。弹性预留(#898)让 hold 可以缩到很小之后,这个数才真的会长起来。
 * 所以同一趟巡检顺手数一遍,>0 就发一条 info 级报警 —— 不是故障,是**一个该被人看见的数字**。
 *
 * ── 为什么是每天一次 ────────────────────────────────────────────────────────
 * 守恒是一个**结构性**不变量:它破了就一直破着,不会自愈,也不会在半小时内变得更严重。
 * 每天一次足够,而全表聚合每半小时跑一次是白花的数据库钱。
 */
import { prisma } from "@fikirtive/db";
import { HOLD_SHORTFALL_REASON_PREFIX } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import type { FounderAlert } from "@fikirtive/core/founder-alert";
import { founderAlert } from "../alerting.js";

/** 一轮最多报几个漂移的 org。全平台同时漂移是「部署炸了」而不是「一个 org 有问题」,
 *  而一封列举两千个 org 的邮件没有人读得完 —— 报前 N 个 + 总数,足够让人开始查。 */
export const CONSERVATION_ALERT_LIMIT = 25;

/** hold-shortfall 统计的回看窗口。和巡检间隔同一个数:一天一轮,数昨天那一天。 */
export const SHORTFALL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 节流行的 ActionEvent type(和对账哨兵的观察行同一套形状:主键带日期,重启不重置)。 */
const CONSERVATION_ALERTED_TYPE = "credits.conservation.alerted";

export type LedgerDrift = {
  orgId: string;
  /** `CreditAccount.balance` —— 商家看到的那个数。 */
  balance: number;
  /** `Σ CreditLedger.balanceDelta` —— 流水算出来的那个数。 */
  ledgerSum: number;
};

export type LedgerConservationResult = {
  /** 这一轮发现的漂移 org 数(全部,不只报出去的那几个)。 */
  drifted: number;
  /** 真的发了报警的漂移 org 数(节流之外的仍然进 Sentry,见 alertThrottledDaily)。 */
  alerted: number;
  /** 过去 24 小时里被钳过的 SETTLE 行数。 */
  shortfallRows: number;
  /** 那些行加起来平台吃掉了多少 internal credits。 */
  shortfallInternal: number;
  /** 这一轮什么都没做的原因(读不动库)。有值时上面的数字**不代表「一切正常」**。 */
  skipped?: string;
};

/**
 * 告警节流:**同一个 org 一天只吵一次人**(形状照抄 `stripe-reconcile` 的 alertThrottledDaily)。
 *
 * 节流不是静音:超过当天第一次的走 `repeat`,Sentry 照收(它本来就是按 key 聚类计数的那一层),
 * 只有邮件与 Telegram 被压掉。状态写在 ActionEvent 的**主键** `<type>:<orgId>:<日期>` 上,
 * 因为 worker 随时可能重启,而「今天喊过没有」必须跨重启成立。
 *
 * 写不进节流行(不是撞主键的那种失败)⇒ 分不清今天喊没喊过 ⇒ **照常全渠道喊**:一次数据库
 * 抖动可以让人多收一封邮件,不可以让一笔资损变哑。`founderAlert` 自己永不抛。
 */
async function alertThrottledDaily(alert: FounderAlert, orgId: string, now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  let repeat = false;
  try {
    await prisma.actionEvent.create({
      data: {
        id: `${CONSERVATION_ALERTED_TYPE}:${orgId}:${day}`,
        // ownerId 跟着这个 org 自己走(ActionEvent.ownerId 有外键):挂一个不存在的
        // 「founder」组织会让节流行永远写不进去,于是每一轮都全渠道喊 —— 恰好是这段
        // 代码要防的那件事。
        ownerId: orgId,
        type: CONSERVATION_ALERTED_TYPE,
        payload: { key: alert.key, day, sentAt: now.toISOString() },
      },
    });
  } catch (e) {
    repeat = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
    if (!repeat) {
      console.error(`[ledger-conservation] could not record the alert-throttle row for ${orgId}; alerting in full anyway:`, e);
    }
  }
  await founderAlert(alert, { repeat });
}

/**
 * **按 org 重算余额,和账户上那个数比一遍。**
 *
 * `FULL OUTER JOIN` 而不是 `LEFT JOIN`:两种漂移方向都要抓得到 —— 有账户没流水(余额凭空
 * 长出来),和有流水没账户(流水写下去了、账户行不见了)。只查一边等于对另一半漂移装瞎。
 *
 * 一句聚合 SQL 而不是逐 org 循环:守恒是全表性质,而 `GROUP BY` 是数据库最擅长的事;
 * 逐 org 查会在有一千个 org 时变成一千趟往返,然后这个巡检自己就成了要报的那种事故。
 */
export async function findLedgerDrift(): Promise<LedgerDrift[]> {
  const rows = await prisma.$queryRaw<{ orgId: string; balance: number; ledgerSum: bigint }[]>`
    SELECT COALESCE(a."orgId", l."orgId") AS "orgId",
           COALESCE(a."balance", 0)       AS "balance",
           COALESCE(l."sum", 0)           AS "ledgerSum"
    FROM "CreditAccount" a
    FULL OUTER JOIN (
      SELECT "orgId", SUM("balanceDelta")::bigint AS "sum"
      FROM "CreditLedger"
      GROUP BY "orgId"
    ) l ON l."orgId" = a."orgId"
    WHERE COALESCE(a."balance", 0) <> COALESCE(l."sum", 0)
    ORDER BY ABS(COALESCE(a."balance", 0) - COALESCE(l."sum", 0)) DESC`;
  return rows.map((r) => ({ orgId: r.orgId, balance: Number(r.balance), ledgerSum: Number(r.ledgerSum) }));
}

/**
 * 过去 24 小时里 `settleCredits` **钳掉**的那些差额(平台吃掉的钱)。
 *
 * 金额藏在 `reason` 里(`hold-shortfall:<n>`)。在 TS 里解析而不是在 SQL 里 `regexp_replace`:
 * 一天的行数是几十条量级,而一条写错的正则会**静静地**把金额算成 0 —— 那正是这个统计
 * 存在的理由的反面。解析不出来的行照数进 `rows`,只是不进金额:「有几行」和「加起来多少」
 * 是两个问题,一个坏行不该让另一个也变哑。
 */
export async function sumRecentHoldShortfall(now: Date): Promise<{ rows: number; internal: number }> {
  const since = new Date(now.getTime() - SHORTFALL_WINDOW_MS);
  const settles = await prisma.creditLedger.findMany({
    where: { kind: "SETTLE", createdAt: { gte: since }, reason: { startsWith: HOLD_SHORTFALL_REASON_PREFIX } },
    select: { reason: true },
  });
  let internal = 0;
  for (const { reason } of settles) {
    const parsed = Number(reason.slice(HOLD_SHORTFALL_REASON_PREFIX.length));
    if (Number.isFinite(parsed) && parsed > 0) internal += parsed;
  }
  return { rows: settles.length, internal };
}

/**
 * 跑一轮守恒巡检。**永不抛错** —— 它挂在 worker 的定时器上,一次数据库抖动不该把整个
 * worker 带下去。返回这一轮的账,便于调用方打日志、也便于用例断言。
 *
 * 跨租户扫描 —— 「全平台的余额对不对得上流水」本来就是一个 platform-wide 的问题,
 * 所以它在一个具名系统身份下跑;唯一的写(节流行)是审计行,不是钱。
 */
export async function checkLedgerConservation(now: Date = new Date()): Promise<LedgerConservationResult> {
  return runAsSystem("ledger-conservation", async (): Promise<LedgerConservationResult> => {
    let drift: LedgerDrift[];
    try {
      drift = await findLedgerDrift();
    } catch (e) {
      // 读不动 ⇒ 这一轮**什么都没证明**。说出来,别让一次失败长得像「一切正常」。
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[ledger-conservation] the conservation scan could not run:", detail);
      await founderAlert({
        key: "credits.conservation.scan_failed",
        title: "The daily ledger-conservation check could not run",
        action: "Check the worker's database access. Until it runs again, nothing is watching balance-vs-ledger drift.",
        context: { detail },
      });
      return { drifted: 0, alerted: 0, shortfallRows: 0, shortfallInternal: 0, skipped: "scan-failed" };
    }

    let alerted = 0;
    for (const row of drift.slice(0, CONSERVATION_ALERT_LIMIT)) {
      const delta = row.balance - row.ledgerSum;
      console.error(
        `[ledger-conservation] DRIFT org=${row.orgId} balance=${row.balance} ledgerSum=${row.ledgerSum} delta=${delta}`,
      );
      await alertThrottledDaily(
        {
          key: "credits.conservation.drift",
          title: "A merchant's credit balance no longer matches their ledger",
          action:
            "Do NOT patch the balance by hand. Read that org's CreditLedger end to end, find the write that " +
            "bypassed grantCredits/reserveCredits/settleCredits, and decide with the founder which side is true.",
          context: {
            orgId: row.orgId,
            balanceInternal: row.balance,
            ledgerSumInternal: row.ledgerSum,
            driftInternal: delta,
            driftedOrgsThisSweep: drift.length,
          },
        },
        row.orgId,
        now,
      );
      alerted++;
    }

    let shortfall = { rows: 0, internal: 0 };
    try {
      shortfall = await sumRecentHoldShortfall(now);
    } catch (e) {
      // 这一半读不到不该拖垮上面那一半(守恒才是承重的)。说一声就够。
      console.error("[ledger-conservation] hold-shortfall roll-up failed:", e instanceof Error ? e.message : e);
    }
    if (shortfall.rows > 0) {
      // info 级:这**不是**故障。它是「昨天我们替商家吃掉了多少」,一个该被人看见的数字。
      await founderAlert({
        key: "credits.hold_shortfall.daily",
        title: "The platform absorbed some usage above what was held yesterday",
        action:
          "No action needed unless the number is growing. It is the elastic-hold clamp (#898) doing its job; " +
          "a rising trend means the holds are being sized too small.",
        context: {
          windowHours: SHORTFALL_WINDOW_MS / 3_600_000,
          settleRows: shortfall.rows,
          absorbedInternal: shortfall.internal,
        },
      });
    }

    return {
      drifted: drift.length,
      alerted,
      shortfallRows: shortfall.rows,
      shortfallInternal: shortfall.internal,
    };
  });
}
