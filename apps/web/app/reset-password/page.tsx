import Link from "next/link";
import Image from "next/image";
import { Clock3, KeyRound } from "lucide-react";
import { ResetPasswordForm } from "./ResetPasswordForm";
import type { R22AuthFixtureState } from "@/app/login/LoginForm";
import "../login/r22-auth.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set a new password · Fikirtive" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; fixture?: string; state?: string }>;
}) {
  const { token, error, fixture: fixtureParam, state } = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && fixtureParam === "r22";
  const fixtureState: R22AuthFixtureState = state === "error" || state === "provider-error" || state === "expired" || state === "used" || state === "no-access" || state === "unknown" ? state : "success";
  const unusableFixture = fixtureState === "expired" || fixtureState === "used" || fixtureState === "no-access";
  const usable = fixture ? !unusableFixture : !!token && !error;
  const unavailableTitle = fixtureState === "used" ? "This link was already used" : fixtureState === "no-access" ? "Password reset is not allowed" : "This link no longer works";
  const unavailableCopy = fixtureState === "used" ? "Reset links work once. Nothing changed on this second attempt." : fixtureState === "no-access" ? "The account policy does not permit password reset from this link. Nothing was changed." : "Reset links work once and expire after an hour. Request a fresh one and we’ll send it straight away.";

  return (
    <main className="r22-auth-gate">
      <div className="r22-auth-stage">
        <div className="r22-auth-brand" aria-label="Fikirtive">
          <Image src="/brand/r22-mark.svg" width={23} height={28} alt="" priority />
          <span>fikirtive</span>
        </div>
        <div className="r22-auth-card">
          <div className={`r22-auth-state-icon ${usable ? "r22-auth-state-icon-sky" : "r22-auth-state-icon-peach"}`} aria-hidden="true">
            {usable ? <KeyRound /> : <Clock3 />}
          </div>
          <h1>{usable ? "Set a new password" : unavailableTitle}</h1>
          {usable ? (
            <>
              <p className="r22-auth-subtitle">
              Choose a new password for your account. You&apos;ll be signed out everywhere else.
              </p>
              <ResetPasswordForm token={token ?? "fixture-token"} fixture={fixture} fixtureState={fixtureState} />
            </>
          ) : (
            <>
              <p className="r22-auth-subtitle">
                {unavailableCopy}
              </p>
              <Link href={fixture ? "/forgot-password?fixture=r22" : "/forgot-password"} className="r22-auth-primary">Request a new link</Link>
              <p className="r22-auth-fact">Nothing was changed. Your workspace is still where you left it.</p>
            </>
          )}
        </div>
        <p className="r22-auth-switch"><Link href={fixture ? "/login?fixture=r22" : "/login"}>Back to sign in</Link></p>
      </div>
    </main>
  );
}
