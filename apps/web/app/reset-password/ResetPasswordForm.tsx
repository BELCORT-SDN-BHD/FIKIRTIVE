"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import { MIN_PASSWORD_LENGTH } from "@/app/signup/SignupForm";
import type { R22AuthFixtureState } from "@/app/login/LoginForm";

/** Consumes a one-time reset token and sets a new password. On success the merchant is sent
 *  to the sign-in page — the reset itself does not mint a session. */
export function ResetPasswordForm({ token, fixture = false, fixtureState = "success" }: { token: string; fixture?: boolean; fixtureState?: R22AuthFixtureState }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    }

    setBusy(true);
    setError(null);
    if (fixture) {
      window.setTimeout(() => {
        setBusy(false);
        if (fixtureState === "provider-error") return setError("Password update could not be confirmed. No account was changed.");
        if ((fixtureState === "error" || fixtureState === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          return setError(fixtureState === "unknown" ? "Password update outcome is unknown. Check this same request before starting another." : "The update could not be confirmed. Retry safely; no account was changed.");
        }
        setDone(true);
      }, 360);
      return;
    }
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
      <div className="r22-auth-confirm" role="status">
        <p className="r22-auth-confirm-title">Password updated</p>
        <p className="r22-auth-subtitle">{fixture ? "Fixture success only. No password or session was changed." : "Sign in with your new password."}</p>
        <a
          href="/login"
          className="r22-auth-primary"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="r22-auth-form">
      <p role="alert" className="r22-auth-error">{error ?? ""}</p>
      <div>
        <label htmlFor="newPassword" className="r22-auth-label">
          New password
        </label>
        <Input unstyled
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
          className="r22-auth-input"
        />
      </div>
      <Button unstyled type="submit" disabled={busy} className="r22-auth-primary">
        {busy ? "Saving…" : fixtureState === "unknown" && fixtureFailedOnce ? "Check update status" : "Save new password"}
      </Button>
    </form>
  );
}
