"use client";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Password-reset request. The confirmation is deliberately NEUTRAL — it never reveals
 *  whether an address has an account (the same rule the sign-in-code form follows). */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim().toLowerCase();
    if (!address) return setError("Enter your email address.");

    setBusy(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email: address,
      redirectTo: "/reset-password",
    });
    setBusy(false);
    if (error) {
      setError(error.message ?? "We couldn't send the link. Try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 text-center shadow-xs">
        <p className="text-[15px] font-semibold text-foreground">Check your email</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          If <span className="font-medium text-foreground">{email.trim()}</span> has an account, a
          reset link is on its way. The link works once and expires in an hour.
        </p>
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
        <label htmlFor="email" className="text-[13px] font-semibold text-foreground/85">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          placeholder="you@yourbrand.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
