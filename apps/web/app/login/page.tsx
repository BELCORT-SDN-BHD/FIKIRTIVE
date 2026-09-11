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

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in failed. Try again.",
  Verification: "That link expired or was already used. Request a new one.",
  Configuration: "Sign-in is unavailable right now. Try again later.",
  Default: "Sign-in failed. Try again.",
};

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
        initialError={error ? ERRORS[error] ?? ERRORS.Default : null}
        initialStep={parseLoginStep(step)}
      />
    </AuthPageShell>
  );
}
