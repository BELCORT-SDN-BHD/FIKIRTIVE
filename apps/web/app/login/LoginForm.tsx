"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Mail } from "lucide-react";
import { authClient } from "@/lib/better-auth/client";
import { sanitizeCallbackURL } from "@/lib/safe-redirect";
import {
  SIGN_IN_CODE_INVALID_EMAIL_MESSAGE,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_REJECTED_MESSAGE,
  SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE,
  normalizeSignInEmail,
  type SignInCodeFailure,
  type SignInCodeRequestResult,
} from "@/lib/better-auth/signin-code-contract";
import { requestSignInCode } from "./actions";

type LoginFormError =
  | ({ source: "sign_in_code" } & SignInCodeFailure)
  | { source: "code_entry"; message: string };

export type R22AuthFixtureState = "success" | "error" | "rate-limit" | "provider-error" | "expired" | "used" | "no-access" | "unknown";

export function LoginForm({ from, fixture = false, fixtureState = "success" }: { from: string; googleEnabled: boolean; fixture?: boolean; fixtureState?: R22AuthFixtureState }) {
  const callbackURL = sanitizeCallbackURL(from);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"code" | "verify" | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(30);
  const [error, setError] = useState<LoginFormError | null>(null);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);
  const [fixtureVerified, setFixtureVerified] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusEmailAfterReset = useRef(false);
  const normalizedEmail = normalizeSignInEmail(email);
  const emailIsValid = Boolean(normalizedEmail);
  const digits = useMemo(
    () => Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, index) => code[index] ?? ""),
    [code],
  );

  useEffect(() => {
    if (!codeSent && focusEmailAfterReset.current) {
      focusEmailAfterReset.current = false;
      emailInputRef.current?.focus();
    }
  }, [codeSent]);

  useEffect(() => {
    if (!codeSent || resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [codeSent, resendSeconds]);

  async function sendSignInCode(event?: React.SyntheticEvent) {
    event?.preventDefault();
    if (busy) return;
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
    if (fixture) {
      window.setTimeout(() => {
        setBusy(null);
        if (fixtureState === "rate-limit") return setError({ source: "code_entry", message: "Too many requests. Wait before trying again; no email was sent." });
        if (fixtureState === "provider-error") return setError({ source: "code_entry", message: "The email provider did not confirm delivery. Nothing was marked sent." });
        if (fixtureState === "no-access") return setError({ source: "code_entry", message: "This account cannot access the requested workspace." });
        if ((fixtureState === "error" || fixtureState === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          return setError({ source: "code_entry", message: fixtureState === "unknown" ? "Sign-in request outcome is unknown. Check this same request before starting another." : "The request could not be confirmed. Retry safely; no email was sent." });
        }
        setCode("");
        setResendSeconds(0);
        setCodeSent(true);
      }, 360);
      return;
    }
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

    setCode("");
    setResendSeconds(30);
    setCodeSent(true);
    window.requestAnimationFrame(() => digitRefs.current[0]?.focus());
  }

  async function verifySignInCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const otp = code.trim();
    if (!normalizedEmail || otp.length !== SIGN_IN_CODE_LENGTH) {
      setError({ source: "code_entry", message: SIGN_IN_CODE_REJECTED_MESSAGE });
      digitRefs.current[Math.min(otp.length, SIGN_IN_CODE_LENGTH - 1)]?.focus();
      return;
    }

    setBusy("verify");
    setError(null);
    if (fixture) {
      window.setTimeout(() => {
        setBusy(null);
        if (fixtureState === "expired") return setError({ source: "code_entry", message: "That code expired. Request a fresh sign-in preview." });
        if (fixtureState === "used") return setError({ source: "code_entry", message: "That code was already used. One code can only be accepted once." });
        if (fixtureState === "no-access") return setError({ source: "code_entry", message: "The verified account cannot access the requested workspace." });
        if (fixtureState === "provider-error") return setError({ source: "code_entry", message: "Verification could not be confirmed. No session was created." });
        setFixtureVerified(true);
      }, 360);
      return;
    }
    const { error: signInError } = await authClient.signIn.emailOtp({ email: normalizedEmail, otp });
    setBusy(null);
    if (signInError) {
      setError({ source: "code_entry", message: SIGN_IN_CODE_REJECTED_MESSAGE });
      digitRefs.current[0]?.focus();
      return;
    }
    window.location.assign(callbackURL);
  }

  function updateDigit(index: number, value: string) {
    const nextDigit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = nextDigit;
    setCode(next.join(""));
    setError(null);
    if (nextDigit && index < SIGN_IN_CODE_LENGTH - 1) digitRefs.current[index + 1]?.focus();
  }

  function handleDigitKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = "";
      setCode(next.join(""));
      digitRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) digitRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < SIGN_IN_CODE_LENGTH - 1) digitRefs.current[index + 1]?.focus();
  }

  function handleCodePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    setCode(pasted);
    digitRefs.current[Math.min(pasted.length, SIGN_IN_CODE_LENGTH) - 1]?.focus();
  }

  function useDifferentEmail() {
    setEmail("");
    setCode("");
    setError(null);
    focusEmailAfterReset.current = true;
    setCodeSent(false);
  }

  if (fixtureVerified) {
    return (
      <div className="r22-auth-card r22-auth-confirm" role="status">
        <div className="r22-auth-state-icon r22-auth-state-icon-sky" aria-hidden="true"><Check /></div>
        <h1>Email verified</h1>
        <p className="r22-auth-subtitle">Fixture success only. No session, email delivery, or workspace access was created.</p>
        <a className="r22-auth-primary" href={callbackURL}>Preview return path</a>
      </div>
    );
  }

  if (codeSent) {
    return (
      <form onSubmit={verifySignInCode} className="r22-auth-card">
        <div className="r22-auth-state-icon r22-auth-state-icon-sky" aria-hidden="true">
          <Mail size={22} strokeWidth={1.6} />
        </div>
        <h1>Check your email</h1>
        <p className="r22-auth-subtitle">
          {fixture ? <>Fixture code entry for <strong>{normalizedEmail}</strong>. No email was sent and no account existence was revealed.</> : <>If that email has an account, the link is on its way to <strong>{normalizedEmail}</strong>. The link works for 15 minutes.</>}
        </p>

        <span className="r22-auth-label" id="sign-in-code-label">Code</span>
        <div className="r22-auth-code" role="group" aria-labelledby="sign-in-code-label" aria-describedby="sign-in-code-error" onPaste={handleCodePaste}>
          {digits.map((digit, index) => (
            <span key={index} className={index === 3 ? "r22-auth-code-break" : undefined}>
              <Input unstyled
                ref={(node) => { digitRefs.current[index] = node; }}
                value={digit}
                onChange={(event) => updateDigit(index, event.target.value)}
                onKeyDown={(event) => handleDigitKeyDown(index, event)}
                maxLength={1}
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${index + 1}`}
                autoFocus={index === 0}
              />
            </span>
          ))}
        </div>
        <p className="r22-auth-error" id="sign-in-code-error" role="alert" aria-live="polite">{error?.message ?? ""}</p>

        <Button unstyled className="r22-auth-primary" type="submit" disabled={Boolean(busy) || code.length !== 6}>
          {busy === "verify" ? "Signing in…" : "Continue"}
        </Button>
        <p className="r22-auth-resend">
          <span>Didn’t get it?</span>{" "}
          <Button unstyled type="button" onClick={() => sendSignInCode()} disabled={Boolean(busy) || resendSeconds > 0}>
            {busy === "code" ? "Sending…" : resendSeconds > 0 ? `Resend in ${resendSeconds} seconds` : "Resend now"}
          </Button>
        </p>
        <p className="r22-auth-fact">{fixture ? "Enter any six digits to inspect the requested auth state. Production still requires a real one-time code." : "Check your spam folder. Opening the link on another device signs you in there instead — one link, one use."}</p>
        <Button unstyled className="r22-auth-secondary" type="button" onClick={useDifferentEmail}>Use a different email</Button>
      </form>
    );
  }

  return (
    <form onSubmit={sendSignInCode} className="r22-auth-card">
      <h1>Sign in to Fikirtive</h1>
      <p className="r22-auth-subtitle">New here? We’ll create your workspace after you confirm your email.</p>
      <label className="r22-auth-label" htmlFor="email">Email</label>
      <div className={`r22-auth-field${emailIsValid ? " is-valid" : ""}`}>
        <Input unstyled ref={emailInputRef} id="email" type="email" name="email" required autoFocus placeholder="you@yourshop.com" autoComplete="email" aria-describedby="sign-in-email-error" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} />
        <span aria-hidden="true"><Check /></span>
      </div>
      <p className="r22-auth-error" id="sign-in-email-error" role="alert" aria-live="polite">{error?.message ?? ""}</p>
      <Button unstyled className="r22-auth-primary" type="submit" disabled={!emailIsValid || Boolean(busy)}>{busy === "code" ? "Sending…" : fixtureState === "unknown" && fixtureFailedOnce ? "Check request status" : "Continue"}</Button>
      <p className="r22-auth-fact">One email carries both a link and a six-digit code. Use whichever device is closer to hand.</p>
    </form>
  );
}
