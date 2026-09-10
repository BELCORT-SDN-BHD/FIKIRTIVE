import { redirect } from "next/navigation";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { auth } from "@/lib/better-auth/compat";
import { googleSignInConfigured } from "@/lib/better-auth/social-config";
import { emailDeliveryAvailable } from "@/lib/email/transport";
import { authDestination, parseLoginStep } from "@/lib/auth-journey";

import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log in · Fikirtive" };

/**
 * SIGNIN-A14 —— Google 门失败时，登录页上那一句（规格 docs/specs/sign-in.md §1.3 逐字）。
 *
 * 这一页的 `?error=` 只有一个产地：Better Auth 的 OAuth 回调
 * （`oauth2/errors.mjs` 的 `redirectOnError`，转向我们用 `errorCallbackURL` 交给它的 `/login`）。
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
