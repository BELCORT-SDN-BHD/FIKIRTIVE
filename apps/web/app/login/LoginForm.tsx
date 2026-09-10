"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, MailIcon, RefreshCwIcon } from "lucide-react";

import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  parseSignInCodeFragment,
  type SignInCodeFailure,
  type SignInCodeRequestResult,
} from "@/lib/better-auth/signin-code-contract";
import {
  authDestination,
  loginStepHref,
  parseLoginStep,
  type LoginStep,
} from "@/lib/auth-journey";

import { requestSignInCode } from "./actions";

type LoginFormError =
  | ({ source: "sign_in_code" } & SignInCodeFailure)
  | { source: "social" | "code_entry"; message: string };

/** FRONT-A2/A12 —— 「送码这件事失败了」的标题，一句话、一个来源。
 *
 *  已批准的 Auth 夹具没有这一态（`design-system/patterns/auth/AuthAccessJourneyReference.tsx`
 *  的每一步只画一种错误），按 Founder 裁决②「生产必需而设计没有的错误态沿用设计的样式呈现，
 *  标题保留主干原句」，这里保留主干在邮箱步已经在用的那一句。
 *
 *  邮箱步的「Continue with email」与 code 步的「Send again」走的是同一个函数、同一个错误源
 *  （`source: "sign_in_code"`），所以共用这一句，而不是在 code 步另写一份措辞。 */
const SIGN_IN_CODE_FAILED_TITLE = "Email could not be continued";

/** SIGNIN-A8 —— 一小时内第 6 次要码时那条 Alert 的标题。
 *
 *  与「送不出去」分开写，因为它们要商家做的事不同：一个是「再试一次」，一个是「等一小时，
 *  别再按了」。共用一句会让商家对着一颗按不动的按钮反复按。措辞与 `SIGN_IN_CODE_RATE_LIMITED_MESSAGE`
 *  同源，同样只谈次数与时间，不谈这个邮箱有没有账号。 */
const SIGN_IN_CODE_RATE_LIMITED_TITLE = "Too many codes requested";

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
  // SIGNIN-A5 —— 邮件里的 Log in 按钮落地时，邮箱与码从 URL **片段**里读回来预填，商家按一次
  // Continue 就登录。片段（`#`）不会被浏览器送给服务器，所以码不进 access log、不随 Referer
  // 外泄 —— 这也是为什么它必须在客户端读：服务端根本看不见它。
  //
  // `useState` 的惰性初始化而不是 `useEffect`：预填要在**第一帧**就到位。放在 effect 里，商家会
  // 看到一个空的码框闪一下再被填上，而且那一帧里按下 Continue 会拿空值提交。
  // `parseSignInCodeFragment` 只接受形状对的值（片段是任何人都能写的地方），而且预填只是**填
  // 输入框**：真正的授权仍然是提交那一步、由服务器验码。
  const prefill = useState(() => (typeof window === "undefined" ? null : parseSignInCodeFragment(window.location.hash)))[0];
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [code, setCode] = useState(prefill?.code.slice(0, SIGN_IN_CODE_LENGTH) ?? "");
  const [busy, setBusy] = useState<"code" | "google" | "verify" | null>(null);
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

  async function signInWithGoogle() {
    if (busy) return;
    setBusy("google");
    setError(null);
    const { error: signInError } = await authClient.signIn.social({
      provider: "google",
      callbackURL,
      // SIGNIN-A14 —— Google 门的任何失败都必须回到**这一页**（规格 §1.4）。
      //
      // 不传这个字段时，Better Auth 用它自己的默认错误页 `${baseURL}/error`
      // （`oauth2/state.mjs` 的 `parseState`：`errorURL = onAPIError?.errorURL ?? ${baseURL}/error`），
      // 商家于是落在一张不是我们的页上 —— 或者，当拒绝发生在建会话那一刻，落在一份没有
      // Location 的 403 JSON 上。两种都在规格 §1.4 里被逐字点名为今天的缺陷。
      //
      // 值是 `/login` 而不是带 `from` 的深链：失败之后要回的是登录页本身，商家在这一页重试
      // 或改用 email；`from` 那个目的地在下一次成功登录时由 `callbackURL` 重新带上。
      errorCallbackURL: "/login",
    });
    if (signInError) {
      setBusy(null);
      setError({ source: "social", message: "Sign-in failed. Try again." });
    }
  }

  function useDifferentEmail() {
    setEmail("");
    setCode("");
    setError(null);
    focusEmailAfterReset.current = true;
    go("email");
  }

  if (step === "email" || (step === "code" && !email)) {
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
            提交(`Continue with email` / 输入框里按 Enter)本来会被 `type="email" required` 的
            原生气泡先接走 —— 措辞与样式随浏览器和系统语言变,和产品自己那一句对不上。
            `noValidate` 把提交这一路交回给 `sendSignInCode` 里的检查,于是无论怎么触发,商家
            读到的都是 `SIGN_IN_CODE_INVALID_EMAIL_MESSAGE` 那一句。
            `type="email"` 与 `required` 都留着:它们仍然管键盘形态与无障碍语义,只是不再另开
            一个错误产地。围栏在 `__tests__/login-code-resend.test.tsx` 第四组。 */}
        <form noValidate onSubmit={sendSignInCode}>
          <FieldGroup className="gap-5">
            {error ? (
              <Alert role="alert" variant="destructive">
                {/* FRONT-A14 —— 邮箱步的错误标题按已批准的 Auth pattern 分成两种。

                    夹具(design-system/patterns/auth/AuthAccessJourneyReference.tsx:136)在这一步
                    只有一个错误态:商家还没给出可用的邮箱就往下走,标题写「Email needed」。生产
                    走的是同一条路 —— `noValidate` 让空的/写坏的地址交给 `sendSignInCode` 自己
                    判,所以这一态在生产**可达**,标题必须与夹具逐字一致。

                    另一种是服务端故障(reason "unknown",signin-code-contract.ts 两种 reason 之一),
                    夹具没有这一态。按 Founder 裁决②,生产必需而设计没有的错误态沿用设计的样式呈现,
                    标题保留主干原句 —— 那时邮箱本身是好的,写「Email needed」会指错地方。 */}
                <AlertTitle>
                  {error.source === "sign_in_code" && error.reason === "invalid_email"
                    ? "Email needed"
                    : error.source === "sign_in_code" && error.reason === "rate_limited"
                      ? SIGN_IN_CODE_RATE_LIMITED_TITLE
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
                  {error.source !== "sign_in_code"
                    ? "Code not accepted"
                    : error.reason === "rate_limited"
                      ? SIGN_IN_CODE_RATE_LIMITED_TITLE
                      : SIGN_IN_CODE_FAILED_TITLE}
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

  return (
    <AuthStepCard
      title="Log in to Fikirtive"
      description="Choose how you want to continue."
      /* SIGNIN-A4 —— hub 上没有 footer,而且这里刻意**不**补一句「第一次来也按这颗」。
         没有第二个注册页(规格 §1 第 1 问),所以通往它的那句开户邀约撤掉;换一句「新来的也走
         这扇门」则是在替登录门②(SIGNIN-A1,码门对陌生人开放)先说话 —— 今天码门仍然只放行
         名单内的地址,那句话会是假的。门开了那一片再补文案。

         这段注释故意不逐字写出那句退役文案:围栏(`__tests__/auth-design-system.test.ts`)扫的
         是**源码**,注释里复述一遍就会把围栏自己染红。 */
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
