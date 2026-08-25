"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import { Eye, EyeOff } from "lucide-react";

export const MIN_PASSWORD_LENGTH = 8;
export type R22SignupFixtureState = "success" | "error" | "rate-limit" | "provider-error" | "unknown" | "no-access";

/** Self-service registration: shop name + email + password. Nothing is promised that the
 *  product doesn't do — the credits land after the email is verified, and the copy says so. */
export function SignupForm({ fixture = false, fixtureState = "success" }: { fixture?: boolean; fixtureState?: R22SignupFixtureState }) {
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = shopName.trim();
    const address = email.trim().toLowerCase();
    if (!name) return setError("Enter your shop name.");
    if (!address) return setError("Enter your email address.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    }

    setBusy(true);
    setError(null);
    if (fixture) {
      window.setTimeout(() => {
        setBusy(false);
        if (fixtureState === "rate-limit") return setError("Too many account requests. Wait before trying again; no account or email was created.");
        if (fixtureState === "provider-error") return setError("The email provider did not confirm delivery. Nothing was marked sent.");
        if (fixtureState === "no-access") return setError("Workspace creation is not available to this account policy. Nothing was created.");
        if ((fixtureState === "error" || fixtureState === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          return setError(fixtureState === "unknown" ? "Account creation outcome is unknown. Check this same request before starting another." : "Account creation was not confirmed. Nothing was added; retry this same request safely.");
        }
        setSentTo(address);
      }, 360);
      return;
    }
    // Email confirmation returns to the real onboarding gate; it does not imply onboarding is done.
    const { error } = await authClient.signUp.email({ email: address, password, name, callbackURL: "/onboarding" });
    setBusy(false);
    if (error) {
      setError(error.message ?? "We couldn't create the account. Try again.");
      return;
    }
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <div className="r22-auth-confirm" role="status">
        <p className="r22-auth-confirm-title">Confirm your email</p>
        <p className="r22-auth-subtitle">
          {fixture ? "Fixture receipt for " : "We sent a confirmation link to "}
          <strong>{sentTo}</strong>. {fixture ? `No account, email, workspace, or starter credits were created for ${shopName.trim()}.` : <>Open it to finish setting up {shopName.trim()} — your free starter credits are added once the email is confirmed.</>}
        </p>
        <p className="r22-auth-fact">
          {fixture ? "Inspect another address, or " : "Nothing in your inbox? Check spam, or "}
          <Button unstyled
            type="button"
            onClick={() => { setSentTo(null); setPassword(""); }}
            className="r22-auth-inline"
          >
            {fixture ? "return to the form" : "try a different email"}
          </Button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="r22-auth-form">
      <p role="alert" className="r22-auth-error">{error ?? ""}</p>
      <div>
        <label htmlFor="shopName" className="r22-auth-label">
          Shop name
        </label>
        <Input unstyled
          id="shopName"
          name="shopName"
          required
          autoFocus
          maxLength={80}
          placeholder="Kopi Corner"
          autoComplete="organization"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          className="r22-auth-input"
        />
        <p className="r22-auth-help">This names your workspace. You can change it later.</p>
      </div>
      <div>
        <label htmlFor="email" className="r22-auth-label">
          Email
        </label>
        <Input unstyled
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@yourbrand.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="r22-auth-input"
        />
      </div>
      <div>
        <label htmlFor="password" className="r22-auth-label">
          Password
        </label>
        <div className="r22-auth-password">
          <Input unstyled
            id="password"
            name="password"
            type={showPw ? "text" : "password"}
            required
            minLength={MIN_PASSWORD_LENGTH}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            className="r22-auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button unstyled
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="r22-auth-icon-button"
          >
            {showPw ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <Button unstyled type="submit" disabled={busy} className="r22-auth-primary">
        {busy ? "Creating your account…" : fixtureState === "unknown" && fixtureFailedOnce ? "Check account status" : "Create account"}
      </Button>
    </form>
  );
}
