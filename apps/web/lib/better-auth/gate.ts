import "server-only";
import { prisma } from "@fikirtive/db";
import { signInDoorDecision } from "@/lib/signup-gate";
import { SIGN_IN_REFUSED_PAUSED, SIGN_IN_REFUSED_REVOKED, signInRefusal } from "./signin-refusal";

/**
 * SIGNIN-A1/A6/A7 —— 门上的那一句「可以进吗」，规格 §1.6 的三步判定（`signInDoorDecision`）。
 *
 * 它以前叫 `assertAllowedEmail`，问的是「在不在名单里」。码门对陌生人打开之后那已经不是门要
 * 问的问题了：名单仍然存在（撤销黑名单 ＋「已证明拥有该邮箱的人」），但**不在名单**不再是拒绝
 * 的理由，`revoked` 与「暂停期的陌生人」才是。名字跟着语义改，是为了下一个读这行的人不会以为
 * 这里还在守一张邀请名单。
 *
 * 拒绝的**话术**对两种拒绝完全一致（规格 §1.3 防枚举）：登录页上「被撤销」「暂停期陌生人」与
 * 「码输错」读起来必须一模一样 —— 那一句在 `app/login/page.tsx`，四种 Google 门失败共用同一句。
 *
 * SIGNIN-A14 —— 抛出来的这个 APIError 带一个机器可读的键（`signin-refusal.ts`，那里逐条写了
 * Better Auth 为什么必须 `message` 与 `code` 同值）。没有键的那一版正是规格 §1.4 记下来的
 * 缺陷：Google 回调里的拒绝落成一份没有 Location 的 403 JSON，商家看见的是裸 JSON 而不是登录页。
 */
export async function assertSignInDoor(email: string | null | undefined): Promise<void> {
  const decision = await signInDoorDecision(email);
  if (decision === "allow") return;
  throw signInRefusal(decision === "paused" ? SIGN_IN_REFUSED_PAUSED : SIGN_IN_REFUSED_REVOKED);
}

/** Resolve a ba_user's email by id and put it through the same door. Fail-closed: an unknown
 *  userId yields undefined email → throws. Used by session.create.before, which is what covers
 *  REPEAT sign-ins and revocation (SIGNIN-A7). */
export async function assertSignInDoorForUserId(userId: string): Promise<void> {
  const u = await prisma.betterAuthUser.findUnique({ where: { id: userId }, select: { email: true } });
  await assertSignInDoor(u?.email);
}
