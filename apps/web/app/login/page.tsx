import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth/compat";
import { googleSignInConfigured } from "@/lib/better-auth/social-config";
import { publicPublishLine } from "@fikirtive/core/schedule-draft";
import { LoginForm, type R22AuthFixtureState } from "./LoginForm";
import "./r22-auth.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Fikirtive" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in failed. Try again.",
  Verification: "That link expired or was already used. Request a new one.",
  Configuration: "Sign-in is misconfigured. Check the server logs.",
  Default: "Sign-in failed. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string; fixture?: string; state?: string }>;
}) {
  const { error, from, fixture: fixtureParam, state } = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && fixtureParam === "r22";
  if (!fixture) {
    const session = await auth();
    if (session) redirect("/");
  }
  const fixtureState: R22AuthFixtureState = state === "error" || state === "rate-limit" || state === "provider-error" || state === "expired" || state === "used" || state === "no-access" || state === "unknown" ? state : "success";

  return (
    <main className="r22-auth-gate">
      <div className="r22-auth-stage">
        <div className="r22-auth-brand" aria-label="Fikirtive">
          <Image src="/brand/r22-mark.svg" width={23} height={28} alt="" priority />
          <span>fikirtive</span>
        </div>
        {error ? <p className="r22-auth-page-error" role="alert">{ERRORS[error] ?? ERRORS.Default}</p> : null}
        <LoginForm from={from ?? "/"} googleEnabled={googleSignInConfigured()} fixture={fixture} fixtureState={fixtureState} />
        {/* 发布口径的唯一权威在 packages/core 的 PUBLISHING_AVAILABLE 开关上。这一页不写自己的
            版本 —— 开关一翻,这句话跟着翻,没有第二处措辞要找。 */}
        <p className="r22-auth-public-fact">{publicPublishLine()}</p>
        <nav className="r22-auth-footer" aria-label="Legal">
          <a href="/terms">Terms</a><i>·</i><a href="/privacy">Privacy</a><i>·</i><a href="/status">Status</a>
        </nav>
      </div>
    </main>
  );
}
