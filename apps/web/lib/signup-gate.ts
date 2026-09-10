import "server-only";
import { prisma } from "@fikirtive/db";

/** Shown on the signup page and returned by the API when new signups are paused.
 *  Honest: it says the door is shut, and does not promise a date. */
export const SIGNUPS_PAUSED_MESSAGE = "New signups are paused right now.";

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

function envList(s: string | undefined): string[] {
  return (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
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
 * 这个地址「以前来过」吗 —— 暂停开关唯一要问的那个问题。
 *
 * 「来过」＝ 环境名单点名（founder / AUTH_ALLOWED_EMAILS），或者 `AllowedEmail` 里**有一行**
 * （任何状态）。两扇门第一次成功登录都会写一行 active（`admitSelfSignup`），所以「有行」正是
 * 规格里那句「从未登录过」的反面。
 *
 * SIGNIN-A7 —— **环境名单命中不再短路撤销那一步**。`AUTH_ALLOWED_EMAILS` 以前在这里直接
 * `return { known: true, revoked: false }`，于是一个写在那个变量里的地址被操作员撤销之后照样
 * 进得来：规格 §1.6 写的是「撤销仍然绝对」，而那条捷径让它对整整一个名单不成立。环境名单现在
 * 只回答**第一个**问题（「来过吗」，暂停开关要问的那个），撤销与否一律由 `AllowedEmail` 那一行
 * 答 —— 名单是「谁算老人」，不是「谁不可撤」。
 *
 * FOUNDER_ADMIN_EMAILS 是唯一的例外，而且是**破窗锤**：它是部署者手上那把钥匙，一行数据库记录
 * 不该能把他自己锁在产品外面（这条例外自 #543 起就在，本片没有改它，只是把它从「整个环境名单」
 * 收回到 founder 这一条）。它与规格 §1.6「撤销仍然绝对」的张力已登记进规格 §5，等 S5 裁决。
 *
 * 固定成本、无分支：一次纯字符串比对加**恰好一次**数据库读，对任何非 founder 地址都一样 ——
 * 这条路上的耗时不许随答案变化（#678 那一族缺陷的根）。数据库读不到就 fail closed。
 */
async function lookupAddress(email: string): Promise<{ known: boolean; revoked: boolean } | null> {
  if (envList(process.env.FOUNDER_ADMIN_EMAILS).includes(email)) return { known: true, revoked: false };
  const namedByEnv = envList(process.env.AUTH_ALLOWED_EMAILS).includes(email);
  try {
    const row = await prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } });
    return { known: namedByEnv || !!row, revoked: row?.status === "revoked" };
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
 *  the invite reading is what made a self-served merchant un-revokable (规格 §1.6，审计 [6]). */
export type RevokeAccessOutcome = "revoked" | "already_revoked" | "unknown";

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
 * （`app/admin/access-actions.ts`）。
 */
export async function revokeEmailAccess(email: string): Promise<RevokeAccessOutcome> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "unknown";
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
