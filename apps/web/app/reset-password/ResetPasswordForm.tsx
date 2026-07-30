"use client";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/app/signup/SignupForm";

/** Consumes a one-time reset token and sets a new password. On success the merchant is sent
 *  to the sign-in page — the reset itself does not mint a session. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    }

    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) {
      setError(error.message ?? "We couldn't set that password. Request a new link and try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 text-center shadow-xs">
        <p className="text-[15px] font-semibold text-foreground">Password updated</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          Sign in with your new password.
        </p>
        <a
          href="/login"
          className="mt-3.5 inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-card)] border border-border text-[14px] font-semibold text-foreground hover:bg-muted"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      {error && (
        <p role="alert" className="text-[13.5px] font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className="text-[13px] font-semibold text-foreground/85">
          New password
        </label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
