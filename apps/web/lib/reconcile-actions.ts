"use server";
/**
 * 关闭一条 Stripe 对账观察行(MONEY-A12,规格 §7.5)。
 *
 * 哨兵(`apps/worker/src/jobs/stripe-reconcile.ts`)的新规矩是「缺口不了结就一直喊」——
 * 它自己只认一种了结:账本那一行出现了(webhook 被重投,钱补上了),那种它会自动关闭。
 * 剩下的一种只有人知道:这笔付款是用**别的方式**了结的(在 Stripe 后台退了款、那是一笔
 * 测试 session、买家自己撤单)。没有这个动作,那种缺口会每天吵一次,永远。
 *
 * 三条边界:
 *   · **只写关闭行,一个字都不碰钱**。账本行仍然只由 webhook 那条唯一入账路径产生
 *     (哨兵不补账,这里同样不补账)。关闭的是「还要不要继续喊」,不是「这笔钱算不算数」。
 *   · **必须先有观察行**。凭空关闭一个不存在的缺口,只会在审计日志里留下一条谁也对不上的
 *     记录 —— 那正是审计的反面。
 *   · **谁关的、什么时候、为什么**逐字落在关闭行里:关闭一笔平台已知的资损,必须留下人。
 *
 * 权限沿用 `credits.mutate`(finance / super-admin)—— 与人工调账同一把钥匙:能决定
 * 「这笔缺口不用再追了」的人,和能动账本的人是同一批。
 */
import { prisma } from "@fikirtive/db";
import {
  FOUNDER_OWNER_ID,
  RECONCILE_CLOSED_TYPE,
  reconcileClosureId,
  reconcileObservationId,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";

export async function closeReconcileObservation(
  raw: unknown,
): Promise<{ ok: true; alreadyClosed?: true } | { error: string }> {
  const gate = await requireRole("credits", "mutate");
  if ("error" in gate) return gate;

  // 手写校验 —— 与 credit-actions.ts 同一种做法(web 侧不直接依赖 zod)。
  const v = raw as { sessionId?: unknown; note?: unknown };
  const sessionId = typeof v?.sessionId === "string" ? v.sessionId.trim() : "";
  if (!sessionId || sessionId.length > 200) return { error: "Enter the Stripe Checkout Session id (cs_…)." };
  const note = typeof v?.note === "string" ? v.note.trim().slice(0, 500) : "";
  // 空理由 = 一条读不出所以然的关闭记录。这一条闸不是形式:关掉的是一笔「商家可能付了钱
  // 没拿到东西」的追踪,半年后翻账的人必须看得懂当初为什么可以关。
  if (!note) return { error: "Say how this payment was settled — the closing note is the audit trail." };

  const observation = await prisma.actionEvent.findUnique({
    where: { id: reconcileObservationId(sessionId) },
    select: { ownerId: true },
  });
  if (!observation) return { error: "No reconciliation observation exists for that session id." };

  try {
    await prisma.actionEvent.create({
      data: {
        // 主键由 session id 派生:同一个缺口关两次,第二次撞主键 —— 一个缺口只有一条关闭事实。
        id: reconcileClosureId(sessionId),
        ownerId: observation.ownerId || FOUNDER_OWNER_ID,
        type: RECONCILE_CLOSED_TYPE,
        payload: { sessionId, closedBy: gate.email, closedAt: new Date().toISOString(), note },
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
