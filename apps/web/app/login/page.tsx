import { redirect } from "next/navigation";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { auth } from "@/lib/better-auth/compat";
import { googleSignInConfigured } from "@/lib/better-auth/social-config";
import { emailDeliveryAvailable } from "@/lib/email/transport";
import { authDestination, parseLoginStep } from "@/lib/auth-journey";
import { signupsPaused, SIGNUPS_PAUSED_MESSAGE } from "@/lib/signup-gate";

import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log in · Fikirtive" };

/**
 * SIGNIN-A14 —— Google 门失败时，登录页上那一句（规格 docs/specs/sign-in.md §1.3 逐字）。
 *
 * 这一页的 `?error=` 只有一个产地：Better Auth 的 OAuth 回调（`oauth2/errors.mjs` 的
 * `redirectOnError`，转向 `/login` —— state 解得开时用 LoginForm 传下去的 `errorCallbackURL`，
 * 解不开时用 `lib/better-auth/server.ts` 里 `onAPIError.errorURL` 那道地板）。
 * 全仓没有第二处往 `/login` 写 `error=`（围栏在 `__tests__/login-google-door-errors.test.tsx`）。
 *
 * 所以**每一个键都读这同一句**，而不是一张 键→不同文案 的表：
 *   · 取消授权、被撤销的邮箱、暂停期的陌生人、Google 报邮箱未验证 —— 规格 §1.3 要求这四种
 *     在页面上读起来完全一样（防枚举：不说明原因）。一张会分岔的表就是那条要求的反面。
 *   · 库还会发出十几个我们既不能预防也不该逐个解释的键（state 过期、拿不到 user info、
 *     换 code 失败……）。它们对商家的意思是同一件事：这一趟没成，再试一次或改用 email。
 *
 * 被核对过的键清单（连同它们在 better-auth 1.6.20 dist 里的出处）逐条写在
 * `__tests__/login-google-door-errors.test.tsx` 的注释里，并在那里逐个断言读到这一句。
 *
 * 旧的那张表（`AccessDenied` / `Verification` / `Configuration` / `Default`）是 NextAuth 时代的
 * 键名，Better Auth 一个都不会发；它在这一页上从来没有匹配过任何一次真实失败。
 */
const GOOGLE_SIGN_IN_FAILED_MESSAGE = "Google sign-in didn't complete. Try again or use email.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string; step?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const { error, from, step } = await searchParams;

  return (
    <AuthPageShell>
      {/* SIGNIN-A6 —— 规格 §1.3「空态」那一条：开关打开时页顶多一条横幅。它说的是**门的状态**，
          不是某一次尝试的结果，所以它挂在页面上、每次渲染重新读一次开关（`signupsPaused()` 从不
          在模块初始化时捕获），而不是等某个陌生人被拒之后才出现——防枚举那条规矩要求「被拒的人
          看到的东西和输错码一模一样」，横幅因此必须对**所有人**一视同仁地在或不在。

          用 default（非 destructive）的 Alert：这不是错误，老商家读到它照样进得来，而 LoginForm
          的红色 Alert 是留给「这一次失败了」的。 */}
      {signupsPaused() ? (
        <Alert className="mb-4">
          <AlertDescription>{SIGNUPS_PAUSED_MESSAGE}</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm
        from={authDestination(from)}
        googleEnabled={googleSignInConfigured()}
        signInCodesAvailable={emailDeliveryAvailable()}
        initialError={error ? GOOGLE_SIGN_IN_FAILED_MESSAGE : null}
        initialStep={parseLoginStep(step)}
      />
    </AuthPageShell>
  );
}
