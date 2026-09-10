/**
 * SIGNIN-A5 —— 邮件里那颗 **Log in** 按钮指向哪里。
 *
 * 规格 §1.2：「邮件里的登录链接：打开 `/login`，邮箱与码预填（码放在 URL 片段 `#` 里，不进
 * 服务器日志、不随 Referer 外泄），商家按一次 Continue。」
 *
 * ── 为什么不是「点开即登录」（规格 §4「实现差异（已选）」）────────────────────────────────
 * Linear 的邮件链接点开即登录。本产品刻意多要一次 Continue：企业邮箱的安全扫描器会**预先打开**
 * 邮件里的链接，「点开即登录」会被扫描器消耗掉那个码，甚至替商家登录一次。多按一次的代价，
 * 换来这条链接不会被机器人用掉。
 *
 * ── 一次性与 15 分钟从哪来（验收 A5 的后半句）────────────────────────────────────────────
 * 这条链接**本身不是凭据**，它只是把码搬到页面上。一次性与有效期因此不是链接的属性，而是码的：
 *   · 一次性 —— 验码成功那一刻 Better Auth 删掉那一行 verification（`signin-code-door.test.ts`
 *     的「spends the code」），所以同一封邮件的链接第二次点开，码仍然预填，按 Continue 会被拒；
 *   · 15 分钟 —— `expiresIn: AUTH_EMAIL_CODE_TTL_SECONDS`（server.ts），过期后同样被拒。
 * 这是「一个凭据一个生命周期」而不是两套：链接与手输的六位数如果各自计时、各自作废，商家会
 * 遇到「邮件里的按钮还能按、码却已经过期」这种自相矛盾的状态。
 *
 * 片段（`#`）而不是查询串：片段不会被浏览器送到服务器，所以码不进 access log、不进 Referer。
 * `step=code` 留在查询串里，因为服务端要靠它决定第一帧渲染哪一屏（`app/login/page.tsx`）。
 * 邮箱也放在片段里 —— 它同样是用户内容，没有理由比码更早离开浏览器。
 */
export function signInCodeLoginUrl(input: { email: string; code: string; baseUrl?: string }): string {
  const base = input.baseUrl ?? process.env.BETTER_AUTH_URL ?? "";
  // `new URL` needs an absolute base; a deployment with no BETTER_AUTH_URL is already fatal
  // elsewhere (the secret guard in server.ts logs it), so fall back to a relative link rather
  // than throwing inside a background send.
  let url: URL;
  try {
    url = new URL("/login", base);
  } catch {
    return "/login";
  }
  url.searchParams.set("step", "code");
  const fragment = new URLSearchParams({ email: input.email, code: input.code });
  url.hash = fragment.toString();
  return url.toString();
}

/** 解析那条片段的函数住在 `signin-code-contract.ts`（登录页那个客户端组件要用它，而这个模块读
 *  `process.env.BETTER_AUTH_URL`，不该被打进浏览器包）：`parseSignInCodeFragment`。 */
