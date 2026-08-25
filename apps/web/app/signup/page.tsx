import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth/compat";
import { signupsPaused, SIGNUPS_PAUSED_MESSAGE } from "@/lib/signup-gate";
import { SIGNUP_GRANT_CREDITS, displayCredits } from "@fikirtive/core";
import { publicPublishLine } from "@fikirtive/core/schedule-draft";
import { SignupForm, type R22SignupFixtureState } from "./SignupForm";
import "../login/r22-auth.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create your account · Fikirtive" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ fixture?: string; state?: string }> }) {
  const { fixture: fixtureParam, state } = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && fixtureParam === "r22";
  if (!fixture) {
    const session = await auth();
    if (session) redirect("/");
  }
  const paused = signupsPaused();
  const starterCredits = displayCredits(SIGNUP_GRANT_CREDITS);
  const fixtureState: R22SignupFixtureState = state === "error" || state === "rate-limit" || state === "provider-error" || state === "unknown" || state === "no-access" ? state : "success";

  return (
    <main className="r22-auth-gate">
      <div className="r22-auth-stage">
        <div className="r22-auth-brand" aria-label="Fikirtive">
          <Image src="/brand/r22-mark.svg" width={23} height={28} alt="" priority />
          <span>fikirtive</span>
        </div>
        <div className="r22-auth-card">
          <h1>{paused && !fixture ? "Signups are paused" : "Create your workspace"}</h1>
          {paused && !fixture ? (
            <>
              <p className="r22-auth-subtitle">
              {SIGNUPS_PAUSED_MESSAGE} We aren&apos;t taking new accounts at the moment, so there is
              nothing to sign up for yet. If you already have an account you can still sign in.
              </p>
            <Link
              href="/login"
              className="r22-auth-secondary"
            >
              Sign in
            </Link>
            </>
          ) : (
            <>
              <p className="r22-auth-subtitle">
                Confirm your email, then name and prepare one workspace. You&apos;ll start with{" "}
                {starterCredits} free credits after confirmation.
              </p>
              <SignupForm fixture={fixture} fixtureState={fixtureState} />
            </>
          )}
        </div>
        {/* 同登录页:发布口径只有 packages/core 那一个开关,注册页不留自己的版本。 */}
        <p className="r22-auth-public-fact">{publicPublishLine()}</p>
        <p className="r22-auth-switch">
          Already have an account?{" "}
          <Link href="/login">
            Sign in
          </Link>
        </p>
        <p className="r22-auth-terms">
          By creating an account you agree to our{" "}
          <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}
