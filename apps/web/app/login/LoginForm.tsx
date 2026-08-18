"use client";

import { useEffect, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestSignInCode } from "./actions";

type LoginFormError =
  | ({ source: "sign_in_code" } & SignInCodeFailure)
  | { source: "password" | "social" | "code_entry"; message: string };

/** Interactive sign-in surface. Email + password is the primary path; a mailed sign-in code
 *  (passwordless) and Google sit beneath as alternatives. Password/social/code-entry use
 *  authClient; asking for a code uses the typed server action backed by Better Auth.
 *  `from` preserves the post-login redirect.
 *
 *  WHY THE CODE STEP LIVES ON THIS PAGE rather than behind a link in an email: the merchant
 *  finishes signing in in the tab they started in. A mailed link had to guess where they wanted
 *  to end up and carry it through the mail; a code carries nothing, so the redirect below is the
 *  same one the password path uses.
 *
 *  `googleEnabled` is decided on the SERVER from the actual OAuth credentials (#681) and
 *  handed down — this component never reads env and never guesses. False means the server
 *  has no Google provider registered, so offering the button would promise a road that
 *  ends in a 500 and a generic "Sign-in failed. Try again." */
export function LoginForm({ from, googleEnabled }: { from: string; googleEnabled: boolean }) {
  const callbackURL = sanitizeCallbackURL(from);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<"code" | "google" | "password" | "verify" | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<LoginFormError | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const focusEmailAfterReset = useRef(false);

  useEffect(() => {
    if (!codeSent && focusEmailAfterReset.current) {
      focusEmailAfterReset.current = false;
      emailInputRef.current?.focus();
    }
  }, [codeSent]);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy("password");
    setError(null);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(null);
    if (error) setError({ source: "password", message: error.message ?? "Wrong email or password." });
    else window.location.assign(callbackURL);
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
        status: "error" as const,
        reason: "unknown" as const,
        message: SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE,
      };
    }
    setBusy(null);
    if (result.status === "error") {
      setError({ source: "sign_in_code", ...result });
    } else {
      setCode("");
      setCodeSent(true);
    }
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
    const { error } = await authClient.signIn.emailOtp({ email: normalizedEmail, otp });
    setBusy(null);
    if (error) {
      // ONE message for every refusal Better Auth can return here — see
      // SIGN_IN_CODE_REJECTED_MESSAGE for why the three are not told apart.
      setError({ source: "code_entry", message: SIGN_IN_CODE_REJECTED_MESSAGE });
      codeInputRef.current?.focus();
    } else {
      window.location.assign(callbackURL);
    }
  }

  async function signInWithGoogle() {
    if (busy) return;
    setBusy("google");
    setError(null);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL });
    // On success the browser is redirected to Google; only reachable on error.
    if (error) {
      setBusy(null);
      setError({ source: "social", message: error.message ?? "Sign-in failed. Try again." });
    }
  }

  function useDifferentEmail() {
    setEmail("");
    setPassword("");
    setCode("");
    setError(null);
    focusEmailAfterReset.current = true;
    setCodeSent(false);
  }

  if (codeSent) {
    return (
      <form
        onSubmit={verifySignInCode}
        className="flex flex-col gap-3.5 rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-xs"
      >
        <div className="text-center">
          <p className="text-[15px] font-semibold text-foreground">Check your email</p>
          <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
            If <span className="font-medium text-foreground">{email.trim()}</span> has access, a
            sign-in code is on its way — enter it below.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-center text-[13.5px] font-medium text-destructive">
            {error.message}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="sr-only">
            Sign-in code
          </label>
          <Input
            ref={codeInputRef}
            id="code"
            name="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={SIGN_IN_CODE_LENGTH}
            placeholder="123456"
            aria-label="Sign-in code"
            className="text-center text-[19px] font-semibold tracking-[0.4em]"
            value={code}
            // Digits only, and never longer than a real code: a paste that brings spaces or a
            // stray letter along would otherwise be submitted as-is and refused for a reason the
            // merchant cannot see.
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH))
            }
          />
        </div>

        <Button type="submit" disabled={!!busy} className="w-full">
          {busy === "verify" ? "Signing in…" : "Sign in"}
        </Button>

        <div className="flex items-center justify-center gap-3 text-[13.5px]">
          <Button
            type="button"
            variant="link"
            onClick={() => sendSignInCode()}
            disabled={!!busy}
            className="h-auto w-auto p-0 font-semibold text-muted-foreground underline hover:text-foreground"
          >
            {busy === "code" ? "Sending…" : "Send it again"}
          </Button>
          <span className="text-muted-foreground/50">·</span>
          <Button
            type="button"
            variant="link"
            onClick={useDifferentEmail}
            className="h-auto w-auto p-0 font-semibold text-muted-foreground underline hover:text-foreground"
          >
            Use a different email
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {error && (
        <p role="alert" className="text-[13.5px] font-medium text-destructive">
          {error.message}
        </p>
      )}

      <form onSubmit={signInWithPassword} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[13px] font-semibold text-foreground/85">
            Email
          </label>
          <Input
            ref={emailInputRef}
            id="email"
            type="email"
            name="email"
            required
            autoFocus
            placeholder="you@yourbrand.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[13px] font-semibold text-foreground/85">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPw ? "text" : "password"}
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              className="pr-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-1.5 top-1/2 size-9 -translate-y-1/2 rounded-[10px] text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              {showPw ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="size-[18px]">
                  <path d="M9.9 4.2A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.2 3M6.1 6.1A13.3 13.3 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 3.9-.9M3 3l18 18" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="size-[18px]">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </Button>
          </div>
        </div>

        <a
          href="/forgot-password"
          className="-mt-1 self-start text-[12.5px] font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Forgot your password?
        </a>

        <Button type="submit" disabled={!!busy} className="mt-0.5 w-full">
          {busy === "password" ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-[12.5px] font-medium text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2.5">
        <Button type="button" variant="secondary" onClick={() => sendSignInCode()} disabled={!!busy} className="w-full">
          {busy === "code" ? (
            "Sending…"
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m2 7 10 6 10-6" />
              </svg>
              Email me a sign-in code
            </>
          )}
        </Button>
        {googleEnabled && (
          <Button type="button" variant="secondary" onClick={signInWithGoogle} disabled={!!busy} className="w-full">
            {busy === "google" ? (
              "Redirecting…"
            ) : (
              <>
                <svg viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-7.8z" />
                  <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.3-1.9-6.2-4.6H2.2v2.8A11 11 0 0 0 12 23z" />
                  <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z" />
                  <path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
                </svg>
                Continue with Google
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
