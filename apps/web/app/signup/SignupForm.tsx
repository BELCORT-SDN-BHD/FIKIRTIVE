"use client";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const MIN_PASSWORD_LENGTH = 8;

/** Self-service registration: shop name + email + password. Nothing is promised that the
 *  product doesn't do — the credits land after the email is verified, and the copy says so. */
export function SignupForm() {
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

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
    // #940 — callbackURL goes straight to /otto rather than "/": the root route is nothing but
    // a server redirect to /otto, so landing there directly drops one full round trip out of the
    // already-slow post-verification chain.
    const { error } = await authClient.signUp.email({ email: address, password, name, callbackURL: "/otto" });
    setBusy(false);
    if (error) {
      setError(error.message ?? "We couldn't create the account. Try again.");
      return;
    }
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 text-center shadow-xs">
        <p className="text-[15px] font-semibold text-foreground">Confirm your email</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-medium text-foreground">{sentTo}</span>. Open it to finish setting
          up {shopName.trim()} — your free starter credits are added once the email is confirmed.
        </p>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Nothing in your inbox? Check spam, or{" "}
          <Button
            type="button"
            variant="link"
            onClick={() => { setSentTo(null); setPassword(""); }}
            className="h-auto w-auto p-0 align-baseline text-[12.5px] font-semibold text-muted-foreground underline hover:text-foreground"
          >
            try a different email
          </Button>
          .
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
        <label htmlFor="shopName" className="text-[13px] font-semibold text-foreground/85">
          Shop name
        </label>
        <Input
          id="shopName"
          name="shopName"
          required
          autoFocus
          maxLength={80}
          placeholder="Kopi Corner"
          autoComplete="organization"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
        />
        <p className="text-[12px] text-muted-foreground">This names your workspace. You can change it later.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] font-semibold text-foreground/85">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
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
            name="password"
            type={showPw ? "text" : "password"}
            required
            minLength={MIN_PASSWORD_LENGTH}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
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

      <Button type="submit" disabled={busy} className="mt-0.5 w-full">
        {busy ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
