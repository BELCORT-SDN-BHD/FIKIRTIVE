import "server-only";
import { APIError } from "better-auth/api";

/**
 * SIGNIN-A13 / SIGNIN-A14 —— 门的拒绝，一个**机器可读的键**，一份定义。
 * 规格：docs/specs/sign-in.md（已冻结 · v1）§1.3、§1.4「拒绝如何回到登录页」。
 *
 * ## 为什么键要住在自己的文件里，而不是随手写在抛出的地方
 *
 * Google 门的拒绝要变成登录页地址栏里的 `?error=<键>`，而 Better Auth 把同一个拒绝按
 * **两条不同的路**送出去，两条路读的是 `APIError` 上的两个不同字段（1.6.20 实测，行号为
 * 本仓库 `node_modules` 中的 dist）：
 *
 *   · 建号那一刻被拒（`databaseHooks.user.create.before`）——
 *     `oauth2/link-account.mjs:107-111` 的 `catch` 收下 APIError，返回 `{ error: e.message }`；
 *     `api/routes/callback.mjs:156-158` 再把它 `split(" ").join("_")` 当成键写进地址。
 *     **读的是 `message`。**
 *   · 建会话那一刻被拒（`databaseHooks.session.create.before`）——
 *     `createSession` 在那个 catch **之外**，APIError 一路穿到
 *     `api/routes/callback.mjs:152-155` 的 `if (isAPIError(e) && e.body?.code)`。
 *     **读的是 `body.code`，没有 code 就不转向，落成一份没有 Location 的 403 JSON**
 *     ——那正是规格 §1.4 记下来的今日缺陷。
 *
 * 两条路必须给出**同一个键**，否则同一个拒绝会因为「这个邮箱以前有没有账号」而在地址栏里
 * 显出两副面孔。做到这件事只有一个办法：`message` 与 `code` 用同一个常量，而且这个常量
 * **不能有空格**（有空格的 message 会被上面那个 `split(" ").join("_")` 改写成另一个字符串）。
 * 所以这些值长得像机器键而不像句子 —— 它们本来就是键。
 *
 * 商家读到的话不在这里：登录页只有一句 Google 门文案（`app/login/page.tsx`），四个键读起来
 * 完全一样。键的分工只服务两件事：服务端日志/告警要分得清「暂停误伤老商家」与「撤销生效了」
 * （`lib/signup-gate.ts` 那个 enum 的原话），以及登录门④（#1319）要复用同样的两个键。
 */
export const SIGN_IN_REFUSED_PAUSED = "sign_in_paused";
export const SIGN_IN_REFUSED_REVOKED = "sign_in_revoked";
/** 全站每小时新账号上限撞满（SIGNIN-A17 的那道闸）。 */
export const SIGN_IN_REFUSED_UNAVAILABLE = "sign_in_unavailable";
/** SIGNIN-A13 —— 供应商自己说这个邮箱没验证过。 */
export const SIGN_IN_REFUSED_EMAIL_UNVERIFIED = "sign_in_email_unverified";

export type SignInRefusalCode =
  | typeof SIGN_IN_REFUSED_PAUSED
  | typeof SIGN_IN_REFUSED_REVOKED
  | typeof SIGN_IN_REFUSED_UNAVAILABLE
  | typeof SIGN_IN_REFUSED_EMAIL_UNVERIFIED;

/** 门的拒绝：403，`message` 与 `code` 同值（理由见文件头）。 */
export function signInRefusal(code: SignInRefusalCode): APIError {
  return new APIError("FORBIDDEN", { message: code, code });
}
