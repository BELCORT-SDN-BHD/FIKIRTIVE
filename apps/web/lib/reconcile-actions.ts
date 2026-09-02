"use server";
/**
 * Stripe 对账观察行的两个 admin 动作(MONEY-A12,规格 §7.5):**看**未了结的缺口,**关掉**其中一条。
 *
 * 哨兵(`apps/worker/src/jobs/stripe-reconcile.ts`)的新规矩是「缺口不了结就一直喊」——
 * 它自己只认一种了结:账本那一行出现了(webhook 被重投,钱补上了),那种它会自动关闭。
 * 剩下的一种只有人知道:这笔付款是用**别的方式**了结的(在 Stripe 后台退了款、那是一笔
 * 测试 session、买家自己撤单)。没有这两个动作,那种缺口会每天吵一次,永远。
 *
 * 三条边界:
 *   · **只写关闭行,一个字都不碰钱**。账本行仍然只由 webhook 那条唯一入账路径产生
 *     (哨兵不补账,这里同样不补账)。关闭的是「还要不要继续喊」,不是「这笔钱算不算数」。
 *   · **必须先有观察行**。凭空关闭一个不存在的缺口,只会在审计日志里留下一条谁也对不上的
 *     记录 —— 那正是审计的反面。
 *   · **处置是结构化的,不是一句自由文本**。关掉的是一笔「商家可能付了钱没拿到东西」的追踪,
 *     所以要么指得出 Stripe 退款单号,要么指得出账本上那一行(当场查),要么就得写清楚并
 *     再确认一次。一句「已处理」关掉一笔真实资损,是这个按钮最容易造成的伤害。
 *
 * 权限沿用 `credits.mutate`(finance / super-admin)—— 与人工调账同一把钥匙:能决定
 * 「这笔缺口不用再追了」的人,和能动账本的人是同一批。
 */
import { prisma } from "@fikirtive/db";
import {
  FOUNDER_OWNER_ID,
  INTERNAL_PER_DISPLAY,
  RECONCILE_CLOSED_TYPE,
  RECONCILE_CREDIT_USE_TYPE,
  RECONCILE_OBSERVED_TYPE,
  reconcileClosureId,
  reconcileCreditUseId,
  reconcileObservationId,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { founderAlert } from "./founder-alert";

/** Stripe 退款单号的形状。格式校验挡的是「随手打一串字当单号」,不是伪造 —— 真伪由 Stripe 后台核。 */
const STRIPE_REFUND_ID = /^re_[A-Za-z0-9]{6,}$/;
/** `other` 处置的最短说明。二十个字大约是「一句说得清为什么可以关」的下限。 */
const OTHER_NOTE_MIN = 20;

/** 正则元字符转义。sessionId 是**外部数据**(Stripe 给的、操作员贴的),原样拼进正则等于让它
 *  自己改写匹配语义 —— 一个 `.` 就能把「逐字等于」变成「任意一个字符」。 */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 这条 reason 里**指名**了这一笔 session 吗?
 *
 * 子串匹配不够:`cs_test_123` 会命中一条写着 `cs_test_1234` 的补发 —— 那是**另一笔**付款,
 * 而两笔的金额、商家、形态可以完全一样。所以要按**边界**比:id 的左右两侧都不能再接一个
 * id 字符。前缀(`cs_test_1234`)、后缀(`xcs_test_123`)、紧邻字符(`cs_test_123abc`)
 * 因此全部落空,而空格、标点、行首行尾包住的那一个才算数。
 *
 * ④a P2:上一版用 `reason.split(/[^A-Za-z0-9_]+/)` 切 token,再要求某个 token 逐字相等 ——
 * 那等于**假设 Stripe 的 id 只由 `[A-Za-z0-9_]` 组成**,而 Stripe 从未正式承诺过 id 的字符集。
 * 真出现一个带 `-` 的 session id,切法会把 id 自己也切开,于是**任何** reason 都配不上它:
 * 一条如实写了单号的人工补发被判成「没指名这一笔」,操作员被逼去走 “Something else”,
 * 而那一支是三支里最弱的凭据。方向反了 —— 所以改成整串转义后查两侧边界,
 * id 里有什么字符都不再影响判定。
 */
function reasonNamesSession(reason: string, sessionId: string): boolean {
  if (!sessionId) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeForRegExp(sessionId)}(?![A-Za-z0-9_])`).test(reason);
}

/** 一行未了结的观察行(admin 页面读的就是这个)。 */
export type ReconcileObservationRow = {
  sessionId: string;
  orgId: string | null;
  amountTotal: number | null;
  currency: string | null;
  firstSeenAt: string | null;
  lastAlertedAt: string | null;
  observedAt: string;
  /** 首见那一刻问到账本了吗?false = 哨兵当时读不动账本,这一行**还没被确认成缺口**。
   *  页面必须把这个差别说出来:「账本里没有这笔」和「当时没能查账本」不是同一句话。 */
  ledgerVerified: boolean;
};

/**
 * 未了结的观察行,新的在前。
 *
 * 与哨兵读的是**同一组行、同一条索引**(`(projectId, type)`;观察行与关闭行的 projectId 都是
 * null)—— 页面上看到的「还没关」与哨兵心里的「还要喊」必须是同一个集合,否则人关掉的东西
 * 和机器追的东西会各说各话。
 */
export async function listReconcileObservations(): Promise<{ rows: ReconcileObservationRow[] } | { error: string }> {
  const gate = await requireRole("credits", "mutate");
  if ("error" in gate) return gate;

  const [trail, alerts] = await Promise.all([
    prisma.actionEvent.findMany({
      where: { projectId: null, type: { in: [RECONCILE_OBSERVED_TYPE, RECONCILE_CLOSED_TYPE] } },
      select: { type: true, payload: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // 最近一次真的喊过人是什么时候 —— 节流行的主键就是 `<throttleId>:<UTC 日>`。
    prisma.actionEvent.findMany({
      where: { projectId: null, type: "credits.reconcile.alerted" },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const lastAlert = new Map<string, string>();
  for (const row of alerts) {
    const m = /^stripe_unreconciled_alert:(.+):\d{4}-\d{2}-\d{2}$/.exec(row.id);
    if (m && m[1] && !lastAlert.has(m[1])) lastAlert.set(m[1], row.createdAt.toISOString());
  }

  const closed = new Set<string>();
  const open = new Map<string, ReconcileObservationRow>();
  for (const row of trail) {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const sessionId = typeof p.sessionId === "string" ? p.sessionId : "";
    if (!sessionId) continue;
    if (row.type === RECONCILE_CLOSED_TYPE) closed.add(sessionId);
    else if (!open.has(sessionId)) {
      open.set(sessionId, {
        sessionId,
        orgId: typeof p.orgId === "string" ? p.orgId : null,
        amountTotal: typeof p.amountTotal === "number" ? p.amountTotal : null,
        currency: typeof p.currency === "string" ? p.currency : null,
        firstSeenAt: typeof p.firstSeenAt === "string" ? p.firstSeenAt : null,
        lastAlertedAt: lastAlert.get(sessionId) ?? null,
        observedAt: row.createdAt.toISOString(),
        // 缺这一格的老行(本次提交之前写下的)按**已确认**读:它们当年就是确认过才写的。
        ledgerVerified: p.ledgerVerified !== false,
      });
    }
  }
  for (const sessionId of closed) open.delete(sessionId);
  return { rows: [...open.values()] };
}

export async function closeReconcileObservation(
  raw: unknown,
): Promise<{ ok: true; alreadyClosed?: true } | { error: string }> {
  const gate = await requireRole("credits", "mutate");
  if ("error" in gate) return gate;

  // 手写校验 —— 与 credit-actions.ts 同一种做法(web 侧不直接依赖 zod)。
  const v = raw as { sessionId?: unknown; disposition?: unknown; refundId?: unknown; ledgerRef?: unknown; note?: unknown; confirmed?: unknown };
  const sessionId = typeof v?.sessionId === "string" ? v.sessionId.trim() : "";
  if (!sessionId || sessionId.length > 200) return { error: "Enter the Stripe Checkout Session id (cs_…)." };

  const disposition = typeof v?.disposition === "string" ? v.disposition : "";
  const note = typeof v?.note === "string" ? v.note.trim().slice(0, 500) : "";
  const details: Record<string, string> = {};

  // 观察行**先读**:这一笔缺口属于哪个商家、金额是多少,都只有它说了算。下面的账本核对拿它
  // 当租户边界 —— 没有这一步,「查账本」就是一次全局查询,A 家的缺口可以拿 B 家的补发单据关掉。
  const observation = await prisma.actionEvent.findUnique({
    where: { id: reconcileObservationId(sessionId) },
    select: { ownerId: true, payload: true },
  });
  if (!observation) return { error: "No reconciliation observation exists for that session id." };
  const observed = (observation.payload ?? {}) as { orgId?: unknown; credits?: unknown; ledgerVerified?: unknown };
  const gapOrgId = typeof observed.orgId === "string" && observed.orgId ? observed.orgId : observation.ownerId;
  const gapCredits = Number(observed.credits);
  // 关的这一笔当初到底有没有问到账本(哨兵的 ledgerVerified:false = 「还没验」)。半年后翻账的
  // 人要能看出:这条关闭盖掉的是一个**确认过的**缺口,还是一个从来没被确认过的观察。
  const gapLedgerVerified = observed.ledgerVerified !== false;
  /** 手工补发那一支要占用的账本行 —— 占用标记与关闭行同一笔事务写(见下)。 */
  let creditUseRowId = "";

  if (disposition === "refunded_in_stripe") {
    // 退款了结:单号是这条处置**唯一**可核的凭据,没有它这条关闭记录就没法追。
    const refundId = typeof v?.refundId === "string" ? v.refundId.trim() : "";
    if (!STRIPE_REFUND_ID.test(refundId)) return { error: "Enter the Stripe refund id (re_…) for this refund." };
    details.refundId = refundId;
  } else if (disposition === "credited_manually") {
    // 手工补发了结:那就一定有一行账。**当场查**,查不到就不许关 —— 「我记得补过了」不是证据。
    //
    // 三道校验,少一道这条凭据就不算凭据:
    //   ① **同一个商家**(租户边界)—— 全局查一把 refId,等于允许拿 B 家的补发单据关掉 A 家的缺口。
    //   ② **是补发的形态**(GRANT / ADJUST)—— 一笔 RESERVE 或 SETTLE 证明的是别的事。
    //   ③ **金额对得上**这笔缺口 —— 补了 50 关掉一笔 600 的缺口,商家还是少了 550。
    const ledgerRef = typeof v?.ledgerRef === "string" ? v.ledgerRef.trim() : "";
    if (!ledgerRef || ledgerRef.length > 200) return { error: "Enter the credits-ledger refId or idempotency key of the manual grant." };
    if (!Number.isInteger(gapCredits) || gapCredits <= 0) {
      // 缺口自己的 credits 数都读不出来(session metadata 当初就是坏的),就没有东西可比对。
      // 这一支不许放行:改走 "Something else",写清楚 + 二次确认。
      return { error: "This gap has no recorded credit amount, so a manual grant cannot be matched against it — close it under “Something else” with an explanation." };
    }
    const entry = await prisma.creditLedger.findFirst({
      where: { orgId: gapOrgId, OR: [{ idempotencyKey: ledgerRef }, { refId: ledgerRef }] },
      select: { id: true, orgId: true, kind: true, balanceDelta: true, reason: true, idempotencyKey: true },
    });
    if (!entry) return { error: "No credits-ledger row for THIS merchant carries that refId or idempotency key — check it before closing this gap." };
    if (entry.kind !== "GRANT" && entry.kind !== "ADJUST") {
      return { error: `That ledger row is a ${entry.kind}, not a manual grant — point at the GRANT or ADJUST row that put the credits in.` };
    }
    const expected = gapCredits * INTERNAL_PER_DISPLAY;
    if (entry.balanceDelta !== expected) {
      return {
        error: `That grant is ${entry.balanceDelta / INTERNAL_PER_DISPLAY} credits but this payment was for ${gapCredits} — they do not match.`,
      };
    }
    // ④ **这一行必须指名这一笔 session**。同一个商家同一天补两次 220,金额与形态都对得上,
    //    但那是**另一笔**补发 —— 拿它关掉这一笔,商家仍然少了 220。两种指名都算数:
    //      · `stripe:<sessionId>` —— 自动入账的形态(webhook 后来补投成功了)。
    //      · reason 里粘着完整的 session id —— 人工补发的形态(runbook 要求这么写)。
    const namesThisSession = entry.idempotencyKey === `stripe:${sessionId}` || reasonNamesSession(entry.reason ?? "", sessionId);
    if (!namesThisSession) {
      return {
        error: `That grant does not name this payment. A manual grant must carry the session id (${sessionId}) in its reason, or use the idempotency key stripe:${sessionId} — otherwise close this under “Something else” with an explanation.`,
      };
    }
    details.ledgerRef = ledgerRef;
    details.ledgerRowId = entry.id;
    details.ledgerOrgId = entry.orgId;
    details.ledgerCredits = String(gapCredits);
    creditUseRowId = entry.id;
  } else if (disposition === "other") {
    // 剩下的一切。这一支最危险(它什么都能装),所以要求写清楚 **且** 再确认一次。
    if (note.length < OTHER_NOTE_MIN) {
      return { error: `Describe how this was settled in at least ${OTHER_NOTE_MIN} characters — this closes the tracking on money a merchant may never have received.` };
    }
    if (v?.confirmed !== true) return { error: "Tick the confirmation box: closing this stops all further alerts for this payment." };
  } else {
    return { error: "Pick how this payment was settled." };
  }

  const ownerId = observation.ownerId || FOUNDER_OWNER_ID;
  const closure = {
    // 主键由 session id 派生:同一个缺口关两次,第二次撞主键 —— 一个缺口只有一条关闭事实。
    id: reconcileClosureId(sessionId),
    ownerId,
    type: RECONCILE_CLOSED_TYPE,
    payload: {
      sessionId,
      disposition,
      ...details,
      note,
      closedBy: gate.email,
      closedAt: new Date().toISOString(),
      // 关的是「确认过的缺口」还是「还没验过的观察」——两者的证据强度不同,别让它糊在一起。
      ledgerVerifiedAtClose: gapLedgerVerified,
    },
  };

  try {
    if (creditUseRowId) {
      // **一行只能关一个缺口**。占用标记与关闭行同一笔事务:要么两条都在,要么一条都不在,
      // 绝不会出现「关闭行写了、占用没记上」(那等于这行补发还能再关一笔)。
      // 占用标记自本次提交起生效 —— 在此之前写下的关闭行没有对应标记(零回填、零迁移),
      // 所以它挡的是**今后**的重复引用,不追认历史。
      await prisma.$transaction(async (tx) => {
        await tx.actionEvent.create({
          data: {
            id: reconcileCreditUseId(creditUseRowId),
            ownerId,
            type: RECONCILE_CREDIT_USE_TYPE,
            payload: { ledgerRowId: creditUseRowId, sessionId, closedBy: gate.email },
          },
        });
        await tx.actionEvent.create({ data: closure });
      });
    } else {
      await prisma.actionEvent.create({ data: closure });
    }
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      // 撞了主键 —— 但撞的是哪一条?事务里分不出来(一条语句失败,整笔就废了),所以事后读一次。
      //
      // **三态,不是两态**(复审四 P2-2)。把说不清的那一种也答成「已经关过了」,等于告诉操作员
      // 「这笔已经了结,不用管了」—— 而实际上关闭行可能根本不存在,缺口还在,人却不会再来看它。
      //   ① 标记记的是**这一笔** + 关闭行确实在  ⇒ 真的已经关过了(两个人先后按了同一个按钮)。
      //   ② 标记记的是**别的** session          ⇒ 这行补发被拿去关过另一笔缺口,拒。
      //   ③ 其余(没有标记 / 标记里没有 session / 关闭行不在)⇒ 说不清,**fail closed**:拒 + 叫人。
      if (creditUseRowId) {
        const markerId = reconcileCreditUseId(creditUseRowId);
        const [marker, closedRow] = await Promise.all([
          prisma.actionEvent.findUnique({ where: { id: markerId }, select: { payload: true } }),
          prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionId) }, select: { id: true } }),
        ]);
        const usedFor = (marker?.payload as { sessionId?: unknown } | null)?.sessionId;
        if (typeof usedFor === "string" && usedFor !== sessionId) {
          return { error: `That grant was already used to close another gap (${usedFor}). One manual grant closes one payment — find the grant that belongs to this one, or close this under “Something else”.` };
        }
        if (typeof usedFor === "string" && usedFor === sessionId && closedRow) {
          return { ok: true, alreadyClosed: true };
        }
        // ③ 说不清。报警不许决定这次的返回值(与钱路其它报警点同一条规矩)。
        try {
          await founderAlert({
            key: "reconcile.credit_use_marker_inconsistent",
            title: "A reconciliation close hit a unique-constraint collision that does not match any known state",
            action: `Inspect ActionEvent ${markerId} and ${reconcileClosureId(sessionId)} by hand. The gap was NOT closed — nothing was written.`,
            context: { sessionId, markerId, ledgerRowId: creditUseRowId, markerSessionId: typeof usedFor === "string" ? usedFor : null, closureRowExists: Boolean(closedRow), closedBy: gate.email },
          });
        } catch (alertErr) {
          console.error(`[reconcile] inconsistent credit-use marker ${markerId}; alert failed:`, alertErr);
        }
        return { error: `The single-use marker for that grant is in an unexpected state (${markerId}) and this gap was NOT closed — check it by hand before retrying.` };
      }
      // 非手工补发那一支只有一条写:撞的必然是关闭行,也就是「已经关过了」。
      return { ok: true, alreadyClosed: true };
    }
    throw e;
  }
  return { ok: true };
}
