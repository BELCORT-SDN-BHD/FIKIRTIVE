import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { buttonVariants } from "@/components/ui/button";
import { authDestination, authRouteHref } from "@/lib/auth-journey";

import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set a new password · Fikirtive" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; from?: string }>;
}) {
  const { token, error, from } = await searchParams;
  const destination = authDestination(from);
  const usable = !!token && !error;

  return (
    <AuthPageShell>
      {usable ? (
        <ResetPasswordForm token={token} from={destination} />
      ) : (
        <AuthStepCard
          title="This link no longer works"
          description="Reset links work once and expire after an hour."
          footer={
            <Link
              href={authRouteHref("/login", destination)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <ArrowLeftIcon aria-hidden />
              Back to login
            </Link>
          }
        >
          <Link
            href={authRouteHref("/forgot-password", destination)}
            className={buttonVariants({ variant: "secondary", className: "w-full" })}
          >
            Request a new link
          </Link>
        </AuthStepCard>
      )}
    </AuthPageShell>
  );
}
