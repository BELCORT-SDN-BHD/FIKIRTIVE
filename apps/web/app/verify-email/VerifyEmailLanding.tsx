"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Clock3, LoaderCircle, ShieldX } from "lucide-react";
import type { R22AuthFixtureState } from "@/app/login/LoginForm";

export function VerifyEmailLanding({ token, callbackURL, fixture = false, fixtureState = "success" }: { token?: string; callbackURL?: string; fixture?: boolean; fixtureState?: R22AuthFixtureState }) {
  useEffect(() => {
    if (!token || fixture) return;
    const params = new URLSearchParams({ token });
    if (callbackURL) params.set("callbackURL", callbackURL);
    window.location.replace(`/api/better-auth/verify-email?${params.toString()}`);
  }, [token, callbackURL, fixture]);

  const fixtureTitle = fixtureState === "success" ? "Email verified" : fixtureState === "used" ? "This link was already used" : fixtureState === "no-access" ? "No workspace access" : fixtureState === "unknown" ? "Verification outcome is unknown" : fixtureState === "provider-error" || fixtureState === "error" ? "Verification unavailable" : "This link expired";
  const fixtureCopy = fixtureState === "success" ? "Fixture success only. No session or workspace access was created." : fixtureState === "used" ? "A one-time link can only be accepted once. Nothing changed on this attempt." : fixtureState === "no-access" ? "The email can be verified without granting access to the requested workspace." : fixtureState === "unknown" ? "Check this same verification receipt before opening another link. No session is assumed." : fixtureState === "provider-error" || fixtureState === "error" ? "The provider did not confirm verification. No session was created; retry the same link safely." : "The preview link is no longer valid. Request a fresh one from sign in.";
  const activeToken = Boolean(token) && !fixture;

  return (
    <main className="r22-auth-gate">
      <div className="r22-auth-stage">
        <div className="r22-auth-brand" aria-label="Fikirtive">
          <Image src="/brand/r22-mark.svg" width={23} height={28} alt="" priority />
          <span>fikirtive</span>
        </div>
        <section className="r22-auth-card">
          <div className={`r22-auth-state-icon ${activeToken || (fixture && fixtureState === "success") ? "r22-auth-state-icon-sky" : "r22-auth-state-icon-peach"}`} aria-hidden="true">
            {activeToken ? <LoaderCircle className="r22-auth-loader animate-spin" size={22} strokeWidth={1.8} /> : fixtureState === "success" && fixture ? <Check size={22} strokeWidth={1.8} /> : fixtureState === "no-access" ? <ShieldX size={22} strokeWidth={1.6} /> : <Clock3 size={22} strokeWidth={1.6} />}
          </div>
          <h1>{fixture ? fixtureTitle : token ? "Signing you in…" : "This link no longer works"}</h1>
          <p className="r22-auth-subtitle">
            {fixture ? fixtureCopy : token ? "Confirming your email and preparing your workspace." : "Links work for 15 minutes and only once. Return to sign in and request a fresh email."}
          </p>
          {activeToken ? <p className="r22-auth-fact" role="status" aria-live="polite">Keep this page open. It will continue automatically.</p> : fixture && (fixtureState === "provider-error" || fixtureState === "error" || fixtureState === "unknown") ? <Link href="/verify-email?fixture=r22&token=fixture" className="r22-auth-primary">{fixtureState === "unknown" ? "Check verification status" : "Retry verification"}</Link> : <Link href={fixture ? "/login?fixture=r22" : "/login"} className="r22-auth-primary">{fixtureState === "success" && fixture ? "Back to auth preview" : "Back to sign in"}</Link>}
        </section>
      </div>
    </main>
  );
}
