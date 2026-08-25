import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import "../login/r22-auth.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset your password · Fikirtive" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ fixture?: string; state?: string }> }) {
  const { fixture: fixtureParam, state } = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && fixtureParam === "r22";
  const fixtureState = state === "error" || state === "rate-limit" || state === "provider-error" || state === "no-access" || state === "unknown" ? state : "success";
  return (
    <main className="r22-auth-gate">
      <div className="r22-auth-stage">
        <div className="r22-auth-brand" aria-label="Fikirtive">
          <Image src="/brand/r22-mark.svg" width={23} height={28} alt="" priority />
          <span>fikirtive</span>
        </div>
        <div className="r22-auth-card">
          <div className="r22-auth-state-icon r22-auth-state-icon-sky" aria-hidden="true"><Mail /></div>
          <h1>Reset your password</h1>
          <p className="r22-auth-subtitle">
            Enter the email you sign in with and we&apos;ll send you a one-time link.
          </p>
          <ForgotPasswordForm fixture={fixture} fixtureState={fixtureState} />
        </div>
        <p className="r22-auth-switch"><Link href={fixture ? "/login?fixture=r22" : "/login"}>Back to sign in</Link></p>
      </div>
    </main>
  );
}
