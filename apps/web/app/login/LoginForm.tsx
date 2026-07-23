"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import { sanitizeCallbackURL } from "@/lib/safe-redirect";
import {
  MAGIC_LINK_INVALID_EMAIL_MESSAGE,
  MAGIC_LINK_UNKNOWN_FAILED_MESSAGE,
  normalizeMagicLinkEmail,
  type MagicLinkFailure,
  type MagicLinkRequestResult,
} from "@/lib/better-auth/magic-link-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestMagicLink } from "./actions";

type LoginFormError =
  | ({ source: "magic_link" } & MagicLinkFailure)
  | { source: "password" | "social"; message: string };

/** Interactive sign-in surface. Email + password is the primary path; magic link
 *  (passwordless) and Google sit beneath as alternatives. Password/social use
 *  authClient; magic link uses the typed server action backed by Better Auth.
 *  `from` preserves the post-login redirect. */
export function LoginForm({ from }: { from: string }) {
  const callbackURL = sanitizeCallbackURL(from);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<"magic" | "google" | "password" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<LoginFormError | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const focusEmailAfterReset = useRef(false);

  useEffect(() => {
    if (!sent && focusEmailAfterReset.current) {
      focusEmailAfterReset.current = false;
      emailInputRef.current?.focus();
    }
  }, [sent]);

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

  async function sendMagicLink(e?: React.SyntheticEvent) {
    e?.preventDefault();
    if (busy) return;
    const normalizedEmail = normalizeMagicLinkEmail(email);
    if (!normalizedEmail) {
      setError({
        source: "magic_link",
        status: "error",
        reason: "invalid_email",
        message: MAGIC_LINK_INVALID_EMAIL_MESSAGE,
      });
      emailInputRef.current?.focus();
      return;
    }
    setBusy("magic");
    setError(null);
    let result: MagicLinkRequestResult;
    try {
      result = await requestMagicLink({ email: normalizedEmail, callbackURL });
    } catch {
      result = {
        status: "error" as const,
        reason: "unknown" as const,
        message: MAGIC_LINK_UNKNOWN_FAILED_MESSAGE,
      };
    }
    setBusy(null);
    if (result.status === "error") {
      setError({ source: "magic_link", ...result });
    } else {
      setSent(true);
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
    setError(null);
    focusEmailAfterReset.current = true;
    setSent(false);
  }

  if (sent) {
    return (
      <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 text-center shadow-xs">
        <p className="text-[15px] font-semibold text-foreground">Check your email</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          If <span className="font-medium text-foreground">{email.trim()}</span> has access, a
          sign-in link is on its way — check your inbox.
        </p>
        <button
          type="button"
          onClick={useDifferentEmail}
          className="mt-3.5 text-[13.5px] font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Use a different email
        </button>
      </div>
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
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] font-semibold text-foreground/85">
              Password
            </label>
            <button
              type="button"
              onClick={() => sendMagicLink()}
              className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Email me a sign-in link
            </button>
          </div>
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
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:text-foreground"
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
            </button>
          </div>
        </div>

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
        <Button type="button" variant="secondary" onClick={() => sendMagicLink()} disabled={!!busy} className="w-full">
          {busy === "magic" ? (
            "Sending…"
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m2 7 10 6 10-6" />
              </svg>
              Email me a sign-in link
            </>
          )}
        </Button>
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
      </div>
    </div>
  );
}
