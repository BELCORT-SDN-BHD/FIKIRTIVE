"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import type { R22AuthFixtureState } from "@/app/login/LoginForm";

/** Password-reset request. The confirmation is deliberately NEUTRAL — it never reveals
 *  whether an address has an account (the same rule the sign-in-code form follows). */
export function ForgotPasswordForm({ fixture = false, fixtureState = "success" }: { fixture?: boolean; fixtureState?: R22AuthFixtureState }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim().toLowerCase();
    if (!address) return setError("Enter your email address.");

    setBusy(true);
    setError(null);
    if (fixture) {
      window.setTimeout(() => {
        setBusy(false);
        if (fixtureState === "rate-limit") return setError("Too many reset requests. Wait before trying again; no email was sent.");
        if (fixtureState === "provider-error") return setError("The email provider did not confirm delivery. Nothing was marked sent.");
        if (fixtureState === "no-access") return setError("Password recovery is unavailable for this account policy.");
        if ((fixtureState === "error" || fixtureState === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          return setError(fixtureState === "unknown" ? "Reset request outcome is unknown. Check this same request before starting another." : "The request could not be confirmed. Retry safely; no email was sent.");
        }
        setSent(true);
      }, 360);
      return;
    }
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
      <div className="r22-auth-confirm" role="status">
        <p className="r22-auth-confirm-title">Check your email</p>
        <p className="r22-auth-subtitle">
          {fixture ? <>Fixture receipt for <strong>{email.trim()}</strong>. No email was sent and no account existence was revealed.</> : <>If <strong>{email.trim()}</strong> has an account, a reset link is on its way. The link works once and expires in an hour.</>}
        </p>
        <p className="r22-auth-fact">{fixture ? "Production still requires a confirmed provider delivery before this receipt can be shown." : "Check spam if it does not arrive. This message does not reveal whether an account exists."}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="r22-auth-form">
      <p role="alert" className="r22-auth-error">{error ?? ""}</p>
      <div>
        <label htmlFor="email" className="r22-auth-label">
          Email
        </label>
        <Input unstyled
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          placeholder="you@yourbrand.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="r22-auth-input"
        />
      </div>
      <Button unstyled type="submit" disabled={busy} className="r22-auth-primary">
        {busy ? "Sending…" : fixtureState === "unknown" && fixtureFailedOnce ? "Check request status" : "Email me a reset link"}
      </Button>
    </form>
  );
}
