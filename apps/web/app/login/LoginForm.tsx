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
  initialError = null,
  initialStep = "hub",
}: {
  from: string;
  googleEnabled: boolean;
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

  async function sendSignInCode(e?: React.SyntheticEvent) {
    e?.preventDefault();
    if (busy) return;
    const normalizedEmail = normalizeSignInEmail(email);
    if (!normalizedEmail) {
      setError({
        source: "sign_in_code",
        status: "error",
        reason: "invalid_email",
        message: SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
      });
      emailInputRef.current?.focus();
      return;
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
      return;
    }

    setEmail(normalizedEmail);
    setCode("");
    go("code");
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
    return (
      <AuthStepCard
        title="What's your email address?"
        description="We'll send a temporary login code."
        footer={<BackToLogin onClick={() => go("hub")} />}
      >
        <form onSubmit={sendSignInCode}>
          <FieldGroup className="gap-5">
            {error ? (
              <Alert role="alert" variant="destructive">
                <AlertTitle>Email could not be continued</AlertTitle>
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
            <Button type="submit" disabled={!!busy} className="w-full">
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
                <AlertTitle>Code not accepted</AlertTitle>
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
                  await sendSignInCode();
                  setCodeSentAgain(true);
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
                <AlertTitle>Sign-in failed</AlertTitle>
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
              <span aria-hidden className="text-border">
                ·
              </span>
              <Button type="button" variant="link" size="xs" onClick={() => sendSignInCode()}>
                Use a login code
              </Button>
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
