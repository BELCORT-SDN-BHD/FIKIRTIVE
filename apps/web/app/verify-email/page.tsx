import { VerifyEmailLanding } from "./VerifyEmailLanding";
import type { R22AuthFixtureState } from "@/app/login/LoginForm";
import "../login/r22-auth.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signing you in… · Fikirtive" };

/** #940 — see VerifyEmailLanding for why this page exists. */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; callbackURL?: string; fixture?: string; state?: string }>;
}) {
  const { token, callbackURL, fixture: fixtureParam, state } = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && fixtureParam === "r22";
  const fixtureState: R22AuthFixtureState = state === "error" || state === "provider-error" || state === "expired" || state === "used" || state === "no-access" || state === "unknown" ? state : "success";
  return <VerifyEmailLanding token={token} callbackURL={callbackURL} fixture={fixture} fixtureState={fixtureState} />;
}
