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

/**
 * SIGNIN-A7 —— 撤销与建会话**并发**时的那一张漏网会话（第 4 轮判官，Codex）。
 *
 * 上面那道闸（`session.create.before`）只**读**，撤销（`revokeEmailAccess`）在它自己的事务里
 * 翻名单并删会话。于是这一道序会漏：
 *
 *   ① 闸读 `AllowedEmail`，此刻还是 active → 放行；
 *   ② 撤销整笔提交 —— 名单翻成 revoked，`deleteMany` 删掉**此刻存在的**会话（待建的那一张
 *      还不存在，删不到）；
 *   ③ 待建的那一张这才 INSERT 进 `ba_session`。
 *
 * 结果是一个已经被撤销的地址手上留着一张活会话，而两边各自都没做错事。闸放在 `before` 里怎么
 * 读都修不掉它：`before` 与那一条 INSERT 不在同一笔事务里，读完就释放，序仍然可以插进来。
 *
 * 所以这道确认放在**会话已经落库之后**，而且那一次读是 `SELECT … FOR SHARE`：
 *   · 撤销若**还在飞**（它的 UPDATE 已经拿着那一行的行锁），这次读会**等**它提交，然后读到
 *     revoked —— 上面那道序的 ③ 因此再也读不到过期的 active；
 *   · 撤销若**已经提交**，读到的直接就是 revoked。
 * 两种情形下我们都把**自己刚建的那一张**收回去，再按门的统一话术拒绝（§1.3 防枚举：与「码输
 * 错」读起来一模一样）。撤销那一侧一行都不用改，它照旧只管自己那笔事务。
 *
 * Fail closed：读不到用户行、读库失败，一律按「不许留下这张会话」处理 —— 与门的其余部分同口径。
 */
export async function assertSessionSurvivesRevoke(sessionId: string, userId: string): Promise<void> {
  const email = await prisma.betterAuthUser
    .findUnique({ where: { id: userId }, select: { email: true } })
    .then((u) => (u?.email ?? "").trim().toLowerCase())
    .catch(() => "");
  if (email) {
    const stillAllowed = await prisma
      .$queryRaw<{ status: string }[]>`SELECT "status" FROM "AllowedEmail" WHERE "email" = ${email} FOR SHARE`
      .then((rows) => rows[0]?.status !== "revoked")
      .catch(() => false);
    if (stillAllowed) return;
  }
  await prisma.betterAuthSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
  throw new APIError("FORBIDDEN", { message: "This email can't sign in." });
}
