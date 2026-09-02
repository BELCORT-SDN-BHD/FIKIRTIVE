import Link from "next/link";
import { redirect } from "next/navigation";
import { SIGNUP_GRANT_CREDITS, displayCredits } from "@fikirtive/core";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { buttonVariants } from "@/components/ui/button";
import { authDestination, authRouteHref } from "@/lib/auth-journey";
import { auth } from "@/lib/better-auth/compat";
import { signupsPaused, SIGNUPS_PAUSED_MESSAGE } from "@/lib/signup-gate";

import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create your account · Fikirtive" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const { from } = await searchParams;
  const destination = authDestination(from);
  const paused = signupsPaused();
  const starterCredits = displayCredits(SIGNUP_GRANT_CREDITS);

  return (
    <AuthPageShell>
      {paused ? (
        <AuthStepCard
          title="Signups are paused"
          description={SIGNUPS_PAUSED_MESSAGE}
          footer={
            <Link
              href={authRouteHref("/login", destination)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Back to login
            </Link>
          }
        >
          <p className="text-center text-sm leading-6 text-muted-foreground">
            We aren&apos;t taking new accounts at the moment. Existing accounts can still log in.
          </p>
        </AuthStepCard>
      ) : (
        <SignupForm from={destination} starterCredits={starterCredits} />
      )}
    </AuthPageShell>
  );
}
