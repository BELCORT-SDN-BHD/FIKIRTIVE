"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, MailIcon, RefreshCwIcon } from "lucide-react";

import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/better-auth/client";
import {
  SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_REJECTED_MESSAGE,
  SIGN_IN_CODE_UNAVAILABLE_MESSAGE,
  SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE,
  normalizeSignInEmail,
  type SignInCodeFailure,
  type SignInCodeRequestResult,
} from "@/lib/better-auth/signin-code-contract";
import {
  authDestination,
  authRouteHref,
  loginStepHref,
  parseLoginStep,
  type LoginStep,
} from "@/lib/auth-journey";

import { requestSignInCode } from "./actions";

type LoginFormError =
  | ({ source: "sign_in_code" } & SignInCodeFailure)
  | { source: "password" | "social" | "code_entry"; message: string };

/** FRONT-A2/A12 —— 「送码这件事失败了」的标题，一句话、一个来源。
 *
 *  已批准的 Auth 夹具没有这一态（`design-system/patterns/auth/AuthAccessJourneyReference.tsx`
 *  的每一步只画一种错误），按 Founder 裁决②「生产必需而设计没有的错误态沿用设计的样式呈现，
 *  标题保留主干原句」，这里保留主干在邮箱步已经在用的那一句。
 *
 *  邮箱步的「Continue with email」与 code 步的「Send again」走的是同一个函数、同一个错误源
 *  （`source: "sign_in_code"`），所以共用这一句，而不是在 code 步另写一份措辞。 */
const SIGN_IN_CODE_FAILED_TITLE = "Email could not be continued";

function GoogleMark() {
  return (
    <span
      aria-hidden
      className="grid size-5 place-items-center rounded-full border border-border bg-card text-[11px] font-bold"
    >
      G
    </span>
  );
}

function BackToLogin({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeftIcon aria-hidden />
      Back to login
    </Button>
  );
}

/** The production Linear-style Auth journey, backed by the existing Better Auth contracts. */
export function LoginForm({
  from,
  googleEnabled,
  signInCodesAvailable = true,
  initialError = null,
  initialStep = "hub",
}: {
  from: string;
  googleEnabled: boolean;
  /** FRONT-A12/A2 —— 这个部署到底寄不寄得出信(Founder 2026-09-05 裁决①「按环境提示」)。
   *
   *  服务端算好了递下来,和 `googleEnabled` 一模一样的做法:一个部署级的 env 读
   *  (`lib/email/transport.ts` 的 `emailDeliveryAvailable()`),对每个邮箱答案都一样,所以说出来
   *  不构成「这个邮箱有没有账号」的探针。客户端不自己去猜——猜出来的第二份事实迟早与真正
   *  要去寄信的那一半对不上,正是 #681 那颗 Google 按钮的病。
   *
   *  默认 true:评审夹具与既有测试不必知道这件事,而生产那一路总是显式传值。 */
  signInCodesAvailable?: boolean;
  initialError?: string | null;
  initialStep?: LoginStep;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = authDestination(from);
  const routeStep = parseLoginStep(searchParams.get("step"));
  const step = routeStep === "hub" && initialStep !== "hub" ? initialStep : routeStep;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"code" | "google" | "password" | "verify" | null>(null);
  const [error, setError] = useState<LoginFormError | null>(
    initialError ? { source: "social", message: initialError } : null,
  );
  const [codeSentAgain, setCodeSentAgain] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const focusEmailAfterReset = useRef(false);

  useEffect(() => {
    if (step === "email" && focusEmailAfterReset.current) {
      focusEmailAfterReset.current = false;
      emailInputRef.current?.focus();
    }
  }, [step]);

  function go(next: LoginStep) {
    setError(null);
    setCodeSentAgain(false);
    router.push(loginStepHref(next, callbackURL), { scroll: false });
  }

  /** FRONT-A12 —— 返回值就是「码到底送出去了没有」。
   *
   *  code 步的「Send again」以前 `await sendSignInCode()` 之后无条件报成功，失败时商家会同时
   *  读到一条错误和一句「A new login code was sent.」——后者是假的。真话只能从这里带出来。 */
  async function sendSignInCode(e?: React.SyntheticEvent): Promise<boolean> {
    e?.preventDefault();
    if (busy) return false;
    // 寄不出去的部署上,这颗按钮本来就是禁用的、code 那条入口也不画;这一句挡的是仍然到得了
    // 这里的那条路(输入框里按 Enter 的隐式提交)。不另设错误:该说的话就在这一步的说明里,
    // 说第二遍等于两个产地。
    if (!signInCodesAvailable) return false;
    const normalizedEmail = normalizeSignInEmail(email);
    if (!normalizedEmail) {
      setError({
        source: "sign_in_code",
        status: "error",
        reason: "invalid_email",
        message: SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
      });
      emailInputRef.current?.focus();
      return false;
    }

    setBusy("code");
    setError(null);
    let result: SignInCodeRequestResult;
    try {
      result = await requestSignInCode({ email: normalizedEmail });
    } catch {
      result = {
        status: "error",
        reason: "unknown",
        message: SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE,
      };
    }
    setBusy(null);
    if (result.status === "error") {
      setError({ source: "sign_in_code", ...result });
      return false;
    }

    setEmail(normalizedEmail);
    setCode("");
    go("code");
    return true;
  }

  async function verifySignInCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const normalizedEmail = normalizeSignInEmail(email);
    const otp = code.trim();
    if (!normalizedEmail || otp.length !== SIGN_IN_CODE_LENGTH) {
      setError({ source: "code_entry", message: SIGN_IN_CODE_REJECTED_MESSAGE });
      codeInputRef.current?.focus();
      return;
    }

    setBusy("verify");
    setError(null);
    const { error: signInError } = await authClient.signIn.emailOtp({ email: normalizedEmail, otp });
    setBusy(null);
    if (signInError) {
      setError({ source: "code_entry", message: SIGN_IN_CODE_REJECTED_MESSAGE });
      codeInputRef.current?.focus();
      return;
    }
    window.location.assign(callbackURL);
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy("password");
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: email.trim(),
      password,
    });
    setBusy(null);
    if (signInError) {
      setError({ source: "password", message: "Wrong email or password." });
      return;
    }
    window.location.assign(callbackURL);
  }

  async function signInWithGoogle() {
    if (busy) return;
    setBusy("google");
    setError(null);
    const { error: signInError } = await authClient.signIn.social({
      provider: "google",
      callbackURL,
    });
    if (signInError) {
      setBusy(null);
      setError({ source: "social", message: "Sign-in failed. Try again." });
    }
  }

  function useDifferentEmail() {
    setEmail("");
    setPassword("");
    setCode("");
    setError(null);
    focusEmailAfterReset.current = true;
    go("email");
  }

  if (step === "email" || ((step === "code" || step === "password") && !email)) {
    // FRONT-A12 —— 寄不出信的部署不许在这一步许下一个它做不到的承诺。夹具那句
    // 「We'll send a temporary login code.」是能寄信时说的话;寄不出去时这一步改说环境本身
    // (措辞只提部署、不提这个邮箱,FRONT-A2),商家在**输入邮箱这一步**就读到,而不是翻到
    // 下一屏之后才被告知一句假的「已寄出」。
    return (
      <AuthStepCard
        title="What's your email address?"
        description={
          signInCodesAvailable
            ? "We'll send a temporary login code."
            : SIGN_IN_CODE_UNAVAILABLE_MESSAGE
        }
        footer={<BackToLogin onClick={() => go("hub")} />}
      >
        {/* FRONT-A12 —— 「这个地址不对」在这一步只有一个声音(判官 #1237 P2-3)。
            两条路都到得了「地址无效」:提交(`Continue with email` / 输入框里按 Enter)与
            `Use password instead`(type="button",浏览器的原生校验碰不到它)。后者早就走
            `SIGN_IN_CODE_INVALID_EMAIL_MESSAGE`,前者却被 `type="email" required` 的原生气泡
            先接走 —— 同一个问题两种措辞、两种样式、还随浏览器与系统语言变,商家读到哪一句
            全看他按了哪颗键。`noValidate` 把提交这一路交回给 `sendSignInCode` 里那道同样的
            检查,于是两条路读到逐字相同的一句。
            `type="email"` 与 `required` 都留着:它们仍然管键盘形态与无障碍语义,只是不再另开
            一个错误产地。围栏在 `__tests__/login-code-resend.test.tsx` 第四组。 */}
        <form noValidate onSubmit={sendSignInCode}>
          <FieldGroup className="gap-5">
            {error ? (
              <Alert role="alert" variant="destructive">
                {/* FRONT-A14 —— 邮箱步的错误标题按已批准的 Auth pattern 分成两种。

                    夹具(design-system/patterns/auth/AuthAccessJourneyReference.tsx:136)在这一步
                    只有一个错误态:商家还没给出可用的邮箱就按「Use password instead」,标题写
                    「Email needed」。生产走的是同一条路 —— 那颗按钮是 type="button",浏览器的
                    原生 required 不拦它,所以这一态在生产**可达**,标题必须与夹具逐字一致。

                    另一种是服务端故障(reason "unknown",signin-code-contract.ts 两种 reason 之一),
                    夹具没有这一态。按 Founder 裁决②,生产必需而设计没有的错误态沿用设计的样式呈现,
                    标题保留主干原句 —— 那时邮箱本身是好的,写「Email needed」会指错地方。 */}
                <AlertTitle>
                  {error.source === "sign_in_code" && error.reason === "invalid_email"
                    ? "Email needed"
                    : SIGN_IN_CODE_FAILED_TITLE}
                </AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={error?.source === "sign_in_code" ? true : undefined}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                ref={emailInputRef}
                id="email"
                type="email"
                name="email"
                required
                autoFocus
                placeholder="you@yourbrand.com"
                autoComplete="email"
                aria-invalid={error?.source === "sign_in_code" ? true : undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Button type="submit" disabled={!!busy || !signInCodesAvailable} className="w-full">
              {busy === "code" && <Spinner data-icon="inline-start" />}
              {busy === "code" ? "Sending…" : "Continue with email"}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                if (!normalizeSignInEmail(email)) {
                  setError({
                    source: "sign_in_code",
                    status: "error",
                    reason: "invalid_email",
                    message: SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
                  });
                  emailInputRef.current?.focus();
                  return;
                }
                go("password");
              }}
            >
              Use password instead
            </Button>
          </FieldGroup>
        </form>
      </AuthStepCard>
    );
  }

  if (step === "code") {
    return (
      <AuthStepCard
        title="Check your email"
        description={
          <>
            We sent a temporary login code to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </>
        }
        footer={<BackToLogin onClick={() => go("hub")} />}
      >
        <form onSubmit={verifySignInCode}>
          <FieldGroup className="gap-5">
            {error ? (
              <Alert role="alert" variant="destructive">
                {/* FRONT-A2 —— 这一步有两个错误源,标题读真分支,不写死。

                    `code_entry` 是商家输入的码被拒(错、过期、次数用尽合成同一句,见
                    signin-code-contract.ts 的 SIGN_IN_CODE_REJECTED_MESSAGE),标题是夹具
                    (AuthAccessJourneyReference.tsx:172)的「Code not accepted」。

                    `sign_in_code` 是「Send again」这一次重发本身失败——码根本没送出去,商家
                    再怎么检查手上那六位数也没用,写「Code not accepted」是指错地方。这一态
                    与邮箱步的送码失败同源,共用同一句标题。 */}
                <AlertTitle>
                  {error.source === "sign_in_code" ? SIGN_IN_CODE_FAILED_TITLE : "Code not accepted"}
                </AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={error?.source === "code_entry" ? true : undefined}>
              <FieldLabel htmlFor="code" className="sr-only">
                Login code
              </FieldLabel>
              <InputOTP
                ref={codeInputRef}
                id="code"
                name="code"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={SIGN_IN_CODE_LENGTH}
                aria-label="Login code"
                aria-invalid={error?.source === "code_entry" ? true : undefined}
                containerClassName="justify-center"
                value={code}
                onChange={(value) => {
                  setCode(value.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH));
                  setError(null);
                  setCodeSentAgain(false);
                }}
              >
                <InputOTPGroup>
                  {Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </Field>
            <Button type="submit" disabled={!!busy} className="w-full">
              {busy === "verify" && <Spinner data-icon="inline-start" />}
              {busy === "verify" ? "Signing in…" : "Continue with login code"}
            </Button>
            <div className="flex items-center justify-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={async () => {
                  // FRONT-A12:只有真的送出去了才报「已重发」。失败时上面那条 Alert 说明原因。
                  setCodeSentAgain(await sendSignInCode());
                }}
                disabled={!!busy}
              >
                {busy === "code" ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon aria-hidden />}
                {busy === "code" ? "Sending…" : "Send again"}
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={useDifferentEmail} disabled={!!busy}>
                Use another email
              </Button>
            </div>
            {codeSentAgain ? (
              <p role="status" className="text-center text-xs text-success-soft-foreground">
                A new login code was sent.
              </p>
            ) : null}
          </FieldGroup>
        </form>
      </AuthStepCard>
    );
  }

  if (step === "password") {
    return (
      <AuthStepCard
        title="Enter your password"
        description={
          <>
            Continue as <span className="font-medium text-foreground">{email}</span>.
          </>
        }
        footer={<BackToLogin onClick={() => go("hub")} />}
      >
        <form onSubmit={signInWithPassword}>
          <FieldGroup className="gap-5">
            {error ? (
              <Alert role="alert" variant="destructive">
                {/* FRONT-A14:已批准的 Auth pattern 在密码这一步写的是「Password not accepted」
                    (design-system/patterns/auth/AuthAccessJourneyReference.tsx 的 password 步)。
                    主干这里写的是「Sign-in failed」—— 同一句在 hub 上是对的(社交登录失败与
                    密码无关),在密码步上它比设计稿模糊。只改这一步的标题,不动下面那句
                    「Wrong email or password.」:中性、不泄露邮箱是否存在,是 FRONT-A2 要的口径。 */}
                <AlertTitle>Password not accepted</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={error?.source === "password" ? true : undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput
                id="password"
                name="password"
                aria-label="Password"
                required
                autoFocus
                placeholder="Enter your password"
                autoComplete="current-password"
                aria-invalid={error?.source === "password" ? true : undefined}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Button type="submit" disabled={!!busy} className="w-full">
              {busy === "password" && <Spinner data-icon="inline-start" />}
              {busy === "password" ? "Signing in…" : "Log in"}
            </Button>
            <div className="flex items-center justify-center gap-2">
              <Link
                href={authRouteHref("/forgot-password", callbackURL)}
                className={buttonVariants({ variant: "link", size: "xs" })}
              >
                Forgot password?
              </Link>
              {signInCodesAvailable ? (
                <>
                  <span aria-hidden className="text-border">
                    ·
                  </span>
                  {/* FRONT-A12 —— 寄不出信的部署上这条入口不画:按下去只会得到一句
                      「Password not accepted」加一段与密码无关的解释,指错地方。 */}
                  <Button type="button" variant="link" size="xs" onClick={() => sendSignInCode()}>
                    Use a login code
                  </Button>
                </>
              ) : null}
            </div>
          </FieldGroup>
        </form>
      </AuthStepCard>
    );
  }

  return (
    <AuthStepCard
      title="Log in to Fikirtive"
      description="Choose how you want to continue."
      footer={
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={authRouteHref("/signup", callbackURL)}
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <FieldGroup className="gap-4">
        {error ? (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" className="w-full" onClick={() => go("email")}>
          <MailIcon aria-hidden />
          Continue with email
        </Button>
        {googleEnabled ? (
          <>
            <FieldSeparator>or</FieldSeparator>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={signInWithGoogle}
              disabled={!!busy}
            >
              {busy === "google" ? <Spinner data-icon="inline-start" /> : <GoogleMark />}
              {busy === "google" ? "Redirecting…" : "Continue with Google"}
            </Button>
          </>
        ) : null}
      </FieldGroup>
    </AuthStepCard>
  );
}
