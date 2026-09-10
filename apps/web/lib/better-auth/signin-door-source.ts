import "server-only";

/**
 * SIGNIN-A10 —— 「他是从哪扇门进来的」，一个函数。
 *
 * 验收 A10 要求两扇门建出来的两个账号「只差来源门标记」，那个标记写进 `AllowedEmail.invitedBy`
 * （`admitSelfSignup`）。来源只能从 Better Auth 交给数据库钩子的 ctx 里读，而这一段有一个
 * 规格 §1.4 逐字记下来的实现陷阱（两名研究员各自实跑证实）：
 *
 *   数据库钩子里读到的 `ctx.path` 是**路由模板字面量** `"/callback/:id"`，不是
 *   `"/callback/google"`。供应商名只能从 `ctx.params.id` 取；写成 `"/callback/google"` 的判定
 *   永远不会触发，而 grep 字符串的测试还是绿的。
 *
 * 所以这里只认两件事：`/sign-in/email-otp` 是码门；`/callback/:id` 的门名从 `params.id` 来。
 * 认不出来的一律回落到中性的 `"self-signup"` —— 一个不知道自己从哪来的标记，好过一个猜错的。
 * 这是标记，不是闸：它决定 `AllowedEmail` 那一行怎么写，从不决定谁能不能进来。
 */
export const SIGN_IN_DOOR_CODE = "sign-in-code";
export const SIGN_IN_DOOR_UNKNOWN = "self-signup";

type DoorContext = { path?: string; params?: Record<string, unknown> } | undefined;

export function signInDoorOf(ctx: DoorContext): string {
  const path = ctx?.path;
  if (path === "/sign-in/email-otp") return SIGN_IN_DOOR_CODE;
  if (typeof path === "string" && path.startsWith("/callback/")) {
    const provider = ctx?.params?.id;
    // fail closed on the LABEL too: an OAuth callback whose provider we cannot read is recorded
    // as unknown rather than as some default provider name.
    return typeof provider === "string" && provider ? provider : SIGN_IN_DOOR_UNKNOWN;
  }
  return SIGN_IN_DOOR_UNKNOWN;
}
