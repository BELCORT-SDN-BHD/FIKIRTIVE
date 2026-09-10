import "server-only";
import { APIError } from "better-auth/api";
import { prisma } from "@fikirtive/db";
import { signInDoorDecision } from "@/lib/signup-gate";

/**
 * SIGNIN-A1/A6/A7 —— 门上的那一句「可以进吗」，规格 §1.6 的三步判定（`signInDoorDecision`）。
 *
 * 它以前叫 `assertAllowedEmail`，问的是「在不在名单里」。码门对陌生人打开之后那已经不是门要
 * 问的问题了：名单仍然存在（撤销黑名单 ＋「已证明拥有该邮箱的人」），但**不在名单**不再是拒绝
 * 的理由，`revoked` 与「暂停期的陌生人」才是。名字跟着语义改，是为了下一个读这行的人不会以为
 * 这里还在守一张邀请名单。
 *
 * 拒绝的话术对两种拒绝**完全一致**（规格 §1.3 防枚举）：页面上「被撤销」「暂停期陌生人」与
 * 「码输错」读起来必须一模一样，所以这里不带任何可区分的 message/code。
 */
export async function assertSignInDoor(email: string | null | undefined): Promise<void> {
  if ((await signInDoorDecision(email)) !== "allow") {
    throw new APIError("FORBIDDEN", { message: "This email can't sign in." });
  }
}

/** Resolve a ba_user's email by id and put it through the same door. Fail-closed: an unknown
 *  userId yields undefined email → throws. Used by session.create.before, which is what covers
 *  REPEAT sign-ins and revocation (SIGNIN-A7). */
export async function assertSignInDoorForUserId(userId: string): Promise<void> {
  const u = await prisma.betterAuthUser.findUnique({ where: { id: userId }, select: { email: true } });
  await assertSignInDoor(u?.email);
}
