"use client";

import { useEffect } from "react";
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authDestination, authRouteHref } from "@/lib/auth-journey";

/** Paints an immediate state before forwarding to Better Auth's real verification endpoint. */
export function VerifyEmailLanding({
  token,
  callbackURL,
}: {
  token?: string;
  callbackURL?: string;
}) {
  const destination = authDestination(callbackURL);

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams({ token });
    params.set("callbackURL", destination);
    window.location.replace(`/api/better-auth/verify-email?${params.toString()}`);
  }, [token, destination]);

  if (!token) {
    return (
      <AuthPageShell>
        <AuthStepCard
          title="This link no longer works"
          description="It may have expired or already been used."
        >
          <Link
            href={authRouteHref("/login", destination)}
            className={buttonVariants({ variant: "secondary", className: "w-full" })}
          >
            Back to login
          </Link>
        </AuthStepCard>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <AuthStepCard
        title="Signing you in…"
        description="Confirming your email and setting up your workspace."
      >
        <div className="flex justify-center" aria-live="polite">
          <Spinner />
        </div>
      </AuthStepCard>
    </AuthPageShell>
  );
}
