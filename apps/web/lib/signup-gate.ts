import "server-only";
import { prisma } from "@fikirtive/db";
import { isFounderAdmin } from "./allowlist";

/** SIGNIN-A6 —— 登录页顶那条横幅的原文，逐字取自规格 §1.3（docs/specs/sign-in.md 已冻结 · v1）。
 *  两句都必须在：第一句说门关了，第二句说老商家照常进得来 —— 少了第二句，一个已经有账号的
 *  商家会以为产品对他也关了。诚实：不承诺日期。唯一消费者是 `app/login/page.tsx`。 */
export const SIGNUPS_PAUSED_MESSAGE =
  "New signups are paused right now. Existing accounts can still log in.";

/**
 * #543 — the emergency "pause new signups" switch (`SIGNUPS_PAUSED`).
 *
 * Read LIVE on every call, never captured at module init, so flipping the variable takes
 * effect on the next request without a code change. FAIL-CLOSED: an unset or explicitly
 * "off" value is the only way signups stay open — any other value (a typo, "yes", "paused",
 * a stray "1") pauses them. Shutting the door by accident is recoverable; leaving it open
 * by accident is not.
 */
export function signupsPaused(): boolean {
  const raw = (process.env.SIGNUPS_PAUSED ?? "").trim().toLowerCase();
  if (raw === "") return false;
  return !["0", "false", "off", "no"].includes(raw);
}

/**
 * SIGNIN-A1 / SIGNIN-A6 / SIGNIN-A7 —— 门的三步判定，一个函数（docs/specs/sign-in.md 已冻结 · v1
 * §1.6「门的判定顺序（两扇门一致，三处名单检查同一函数）」）。
 *
 * 规格把 deny-by-default 的口径从「不在名单一律拒」收窄成「未撤销＋未暂停即放行」，顺序照
 * §1.6 逐条写在下面。它取代了 `isAllowedEmail` 在**门上**的角色：`isAllowedEmail` 仍然是
 * 「这个地址在名单里吗」（登录之后每个 handler 的再断言用它），而这个函数答的是另一个问题
 * ——「这个地址现在可不可以进来（必要时开户）」。两个问题以前是同一个答案，码门对陌生人打开
 * 之后不再是。
 *
 * 为什么是一个 enum 而不是一个 boolean：`paused` 与 `revoked` 在页面上要长得一模一样
 * （规格 §1.3 防枚举），但它们在**服务端日志与告警**里是两件事；把两者压成 false 会让下一个
 * 人无从分辨「暂停期误伤了老商家」与「撤销生效了」。
 */
export type SignInDoorDecision = "allow" | "paused" | "revoked";

/**
 * 门要问的两件事，一次问完：这个地址**登录过吗**，以及它**被撤销了吗**。
 *
 * 「登录过」＝ `ba_user` 里有他那一行。两扇门都只在身份证明完成之后才建这一行（码门在验码那
 * 一刻，Google 门在回调里），所以「有账号」逐字就是规格 §1.6 ① 那句「从未登录过」的反面 ——
 * 而且它对**开关存在之前**进来的老商家同样成立（那批人可能连 `AllowedEmail` 行都没有）。
 *
 * 这里原来问的是另一件事：「环境名单点过名 ‖ `AllowedEmail` 里有任何一行」。两个都不是「登录
 * 过」：`inviteTenant` 在任何人登录之前就写得下一行 `invited`，`AUTH_ALLOWED_EMAILS` 里写一个
 * 地址更是一次请求都不用发 —— 于是暂停期间「先邀请（或先写进变量），再让他进来」是一条绕过
 * 开关的现成的路（第 2 轮判官 P0）。
 *
 * SIGNIN-A7 —— **门上一个环境例外都不留**。`AUTH_ALLOWED_EMAILS` 与 `FOUNDER_ADMIN_EMAILS`
 * 先后都曾在这里 `return { known: true, revoked: false }`，数据库根本不读，于是写在那两个变量
 * 里的地址撤了等于没撤；规格 §1.6 写的是「撤销仍然绝对」，那条捷径让它对整整一个名单不成立。
 * founder 的破窗锤没有丢，只是换了落点：**写侧**的 `revokeEmailAccess` 不肯撤一个还挂在
 * `FOUNDER_ADMIN_EMAILS` 上的地址，所以「一行数据库记录锁死部署者」这件事从一开始就发生不了，
 * 恢复路径也不经数据库（把地址从那个变量里拿掉，再撤）。
 *
 * 固定成本、无分支：**恰好两次**数据库读，对每一个地址都一样 —— 这条路上的耗时不许随答案变化
 * （#678 那一族缺陷的根）。任何一次读不到就 fail closed。
 */
async function lookupAddress(email: string): Promise<{ known: boolean; revoked: boolean } | null> {
  try {
    const [row, account] = await Promise.all([
      prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } }),
      prisma.betterAuthUser.findUnique({ where: { email }, select: { id: true } }),
    ]);
    return { known: !!account, revoked: row?.status === "revoked" };
  } catch {
    return null; // DB outage → fail closed at the caller
  }
}

/** SIGNIN-A1/A6/A7 —— 规格 §1.6 的三步，逐条。 */
export async function signInDoorDecision(email: string | null | undefined): Promise<SignInDoorDecision> {
  // SIGNIN-A16 —— 归一化在**判定之前**：`AllowedEmail.email` 没有大小写不敏感的唯一约束
  // （schema.prisma，长期修法 #578），所以每一个读侧和写侧都必须先 trim+lowercase，否则
  // `Aisha@Example.com` 会绕过为 `aisha@example.com` 写下的那一行撤销。
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return "revoked"; // fail closed: 没有地址就没有可以放行的理由
  const found = await lookupAddress(normalized);
  if (!found) return "revoked"; // 计数器/库不可达 → fail closed
  // ① 暂停开关打开，且这个地址从未登录过 → 拒（老用户照常进）。
  if (signupsPaused() && !found.known) return "paused";
  // ② 撤销 → 拒。撤销是绝对的，暂停开关的状态改变不了它。
  if (found.revoked) return "revoked";
  // ③ 其余放行并（必要时）建账号。
  return "allow";
}

/**
 * #543 — registration IS the invite.
 *
 * Self-service sign-in writes the address into the SAME AllowedEmail table the invite flow uses,
 * so every existing deny-by-default gate (`isAllowedEmail`, `requireSession`, `requireOwner`, the
 * admin re-assertions) keeps working byte-for-byte — the door opened, the walls did not move.
 * AllowedEmail keeps its other two jobs: operator invites, and revocation.
 *
 * SIGNIN-A10 —— `invitedBy` 记的是**来源门**（`sign-in-code` / `google`），这是验收表里
 * 「只差来源门标记」那一句唯一的落点。
 *
 * Called only AFTER the identity is proven (both doors call it from convergence, which runs
 * behind `emailVerified`), never speculatively from a request body: a refused or abandoned
 * attempt must not leave behind an address that could still walk in later.
 *
 * NEVER resurrects an existing row — `skipDuplicates` is an INSERT … ON CONFLICT DO NOTHING,
 * so an operator's `revoked` or `invited` row keeps its own status and audit trail.
 */
export async function admitSelfSignup(email: string, door: string = "self-signup"): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await prisma.allowedEmail.createMany({
    data: [{ email: normalized, status: "active", invitedBy: door }],
    skipDuplicates: true,
  });
}

/** What `revokeEmailAccess` did — the operator-facing answer, and the only thing a caller may
 *  branch on. `unknown` means «this address has no access to take away», NOT «no pending invite»:
 *  the invite reading is what made a self-served merchant un-revokable (规格 §1.6，审计 [6]).
 *  `protected` means «this address is the deployer's break-glass key» — see below. */
export type RevokeAccessOutcome = "revoked" | "already_revoked" | "unknown" | "protected";

/**
 * SIGNIN-A7 —— 撤销，一个动作两件事：**名单那一行翻成 revoked，他手上的会话在同一笔事务里
 * 消失**（docs/specs/sign-in.md 已冻结 · v1 §1.6「撤销」那一段，照 tenant-actions.ts 的写法）。
 *
 * 为什么必须是同一笔事务：这两件事分开做，中间那一瞬间就是一个「已经撤销、但旧 cookie 还能用」
 * 的窗口，而审计 [5] 记的正是今天那个窗口——撤销只删名单不删会话，旧 cookie 还能打
 * `/api/better-auth/*` 最长 7 天。一笔事务让「撤销生效」与「他被踢出去」是同一个时刻。
 *
 * 会话删掉之后**每一次请求都会重新问库**：Better Auth 这边没有配 cookie 缓存（server.ts 的
 * `session` 只映射表名），所以 `getSession` 每次都读 `ba_session` 那一行，行没了 = 会话没了；
 * 产品这边的 `requireSession` / `requireRole` / `requireOwner` 又各自把地址再过一次 `allowed()`。
 * 「不等 cookie 过期」因此有两道，而不是一道。
 *
 * 状态谓词是 `status ≠ revoked`，不是 `status = "invited"`：两扇门写进名单的都是 active
 * （`admitSelfSignup`），只认 invited 的那条谓词让**自助进来的地址永远撤不掉**（审计 [6]）。
 * 已经是 revoked 的行原样不动（`revoked` 行永不复活，也不该被重写 updatedAt 掩盖第一次撤销的
 * 时间），但会话照样清一遍——重复撤销必须是幂等的，而不是「第二次点没反应」。
 *
 * 这个函数不做授权：它是领域动作，权限由调用它的 server action 上的 `requireRole` 把守
 * （`lib/tenant-actions.ts` 的 `revokeMerchantAccess`，后台那颗「Revoke access」按的就是它）。
 *
 * 破窗锤（第 2 轮把它从门上搬到了这里）：**还挂在 `FOUNDER_ADMIN_EMAILS` 上的地址撤不动，答
 * `protected`。** 门那一侧从本轮起对每一个地址一视同仁地查撤销（founder 也不例外，否则 §1.6
 * 的「撤销仍然绝对」对整整一个环境变量不成立），所以「一行数据库记录不该把部署者锁在自己的
 * 产品外面」只能在写侧保住：那一行根本写不下去。恢复路径因此不经数据库 —— 先把地址从
 * `FOUNDER_ADMIN_EMAILS` 里拿掉，再撤。
 *
 * 边界（说清楚，不假装覆盖）：**没有 `AllowedEmail` 行的地址答 `unknown`，不新建一行黑名单。**
 * 今天唯一能进门却没有行的，是只被 `AUTH_ALLOWED_EMAILS` 点过名、还一次都没登录过的地址——
 * 它的授予在环境变量里，收回也在那里（登录过一次就会有行，那时这个函数管得着，A7 的负例用例
 * 正是这一条）。要让撤销覆盖到「从没来过的陌生地址」得先决定「预先拉黑」是不是一个产品动作，
 * 那是规格问题，不是这一层能自己决定的。
 */
export async function revokeEmailAccess(email: string): Promise<RevokeAccessOutcome> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (isFounderAdmin(normalized)) return "protected";
  return prisma.$transaction(async (tx) => {
    const row = await tx.allowedEmail.findUnique({ where: { email: normalized }, select: { status: true } });
    if (!row) return "unknown";
    if (row.status !== "revoked") {
      await tx.allowedEmail.update({ where: { email: normalized }, data: { status: "revoked" } });
    }
    // 两个用户表按邮箱相连；会话挂在 BetterAuthUser 上。地址在 `ba_user` 里是登录时归一化过的
    // 小写，所以这里用同一个小写值比对（Postgres 的 = 区分大小写）。
    const baUsers = await tx.betterAuthUser.findMany({ where: { email: normalized }, select: { id: true } });
    if (baUsers.length > 0) {
      await tx.betterAuthSession.deleteMany({ where: { userId: { in: baUsers.map((u) => u.id) } } });
    }
    return row.status === "revoked" ? "already_revoked" : "revoked";
  });
}
