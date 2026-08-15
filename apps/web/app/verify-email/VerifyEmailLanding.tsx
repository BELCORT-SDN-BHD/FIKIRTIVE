"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

/**
 * #940 — the verification email links HERE instead of straight at Better Auth's raw
 * `/api/better-auth/verify-email` route, which has no page behind it. Clicking the old link
 * left the browser blank — no title, no spinner, nothing — for however long verification +
 * auto sign-in + workspace provisioning took server-side (measured ~11s). This component's
 * only job is to paint something readable on the very first frame, then hand off to the real
 * endpoint via a normal top-level navigation (so its Set-Cookie and redirect chain behave
 * exactly as before).
 *
 * Token validation itself is untouched: `token` and `callbackURL` are forwarded verbatim, never
 * inspected or re-encoded here.
 */
export function VerifyEmailLanding({ token, callbackURL }: { token?: string; callbackURL?: string }) {
  useEffect(() => {
    if (!token) return; // nothing to forward — the missing-token view below stays up
    const params = new URLSearchParams({ token });
    if (callbackURL) params.set("callbackURL", callbackURL);
    window.location.replace(`/api/better-auth/verify-email?${params.toString()}`);
  }, [token, callbackURL]);

  if (!token) {
    return (
      <main className="gb flex min-h-[100dvh] w-full items-center justify-center bg-card p-8 sm:p-10">
        <div className="w-full max-w-[380px] text-center">
          <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em] text-foreground">
            This link no longer works
          </h1>
          <p className="mb-6 text-[14.5px] leading-[1.55] text-muted-foreground">
            It may have expired or already been used. Sign in and we can send you a fresh one.
          </p>
          <Link
            href="/login"
            className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-card)] border border-border text-[14px] font-semibold text-foreground hover:bg-muted"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="gb flex min-h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-card p-8 text-center sm:p-10"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle className="size-7 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-[15px] font-semibold text-foreground">Signing you in…</p>
      <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-muted-foreground">
        Confirming your email and setting up your workspace.
      </p>
    </main>
  );
}
