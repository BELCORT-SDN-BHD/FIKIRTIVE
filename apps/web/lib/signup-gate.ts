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
 * 「来过」＝ 环境名单点名（founder / AUTH_ALLOWED_EMAILS，这两条永远算数，数据库不能把
 * founder 锁在外面），或者 `AllowedEmail` 里**有一行**（任何状态）。两扇门第一次成功登录都会
 * 写一行 active（`admitSelfSignup`），所以「有行」正是规格里那句「从未登录过」的反面。
 *
 * 固定成本、无分支：两次纯字符串比对加**恰好一次**数据库读，对任何地址都一样 —— 这条路上的
 * 耗时不许随答案变化（#678 那一族缺陷的根）。数据库读不到就 fail closed。
 */
async function lookupAddress(email: string): Promise<{ known: boolean; revoked: boolean } | null> {
  if (envList(process.env.FOUNDER_ADMIN_EMAILS).includes(email)) return { known: true, revoked: false };
  if (envList(process.env.AUTH_ALLOWED_EMAILS).includes(email)) return { known: true, revoked: false };
  try {
    const row = await prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } });
    return { known: !!row, revoked: row?.status === "revoked" };
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
