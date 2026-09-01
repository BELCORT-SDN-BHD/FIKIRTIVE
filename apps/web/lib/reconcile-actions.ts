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
  RECONCILE_OBSERVED_TYPE,
  reconcileClosureId,
  reconcileObservationId,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";

/** Stripe 退款单号的形状。格式校验挡的是「随手打一串字当单号」,不是伪造 —— 真伪由 Stripe 后台核。 */
const STRIPE_REFUND_ID = /^re_[A-Za-z0-9]{6,}$/;
/** `other` 处置的最短说明。二十个字大约是「一句说得清为什么可以关」的下限。 */
const OTHER_NOTE_MIN = 20;

/** 一行未了结的观察行(admin 页面读的就是这个)。 */
export type ReconcileObservationRow = {
  sessionId: string;
  orgId: string | null;
  amountTotal: number | null;
  currency: string | null;
  firstSeenAt: string | null;
  lastAlertedAt: string | null;
  observedAt: string;
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
  const observed = (observation.payload ?? {}) as { orgId?: unknown; credits?: unknown };
  const gapOrgId = typeof observed.orgId === "string" && observed.orgId ? observed.orgId : observation.ownerId;
  const gapCredits = Number(observed.credits);

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
      select: { id: true, orgId: true, kind: true, balanceDelta: true },
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
    details.ledgerRef = ledgerRef;
    details.ledgerRowId = entry.id;
    details.ledgerOrgId = entry.orgId;
    details.ledgerCredits = String(gapCredits);
  } else if (disposition === "other") {
    // 剩下的一切。这一支最危险(它什么都能装),所以要求写清楚 **且** 再确认一次。
    if (note.length < OTHER_NOTE_MIN) {
      return { error: `Describe how this was settled in at least ${OTHER_NOTE_MIN} characters — this closes the tracking on money a merchant may never have received.` };
    }
    if (v?.confirmed !== true) return { error: "Tick the confirmation box: closing this stops all further alerts for this payment." };
  } else {
    return { error: "Pick how this payment was settled." };
  }

  try {
    await prisma.actionEvent.create({
      data: {
        // 主键由 session id 派生:同一个缺口关两次,第二次撞主键 —— 一个缺口只有一条关闭事实。
        id: reconcileClosureId(sessionId),
        ownerId: observation.ownerId || FOUNDER_OWNER_ID,
        type: RECONCILE_CLOSED_TYPE,
        payload: { sessionId, disposition, ...details, note, closedBy: gate.email, closedAt: new Date().toISOString() },
      },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      // 已经关过了。这不是错误:两个人先后按下同一个按钮,结果应当一样。
      return { ok: true, alreadyClosed: true };
    }
    throw e;
  }
  return { ok: true };
}
