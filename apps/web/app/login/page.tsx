import { redirect } from "next/navigation";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { auth } from "@/lib/better-auth/compat";
import { googleSignInConfigured } from "@/lib/better-auth/social-config";
import { emailDeliveryAvailable } from "@/lib/email/transport";
import { authDestination, parseLoginStep } from "@/lib/auth-journey";

import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log in · Fikirtive" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in failed. Try again.",
  Verification: "That link expired or was already used. Request a new one.",
  Configuration: "Sign-in is unavailable right now. Try again later.",
  Default: "Sign-in failed. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string; step?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const { error, from, step } = await searchParams;

  return (
    <AuthPageShell>
      <LoginForm
        from={authDestination(from)}
        googleEnabled={googleSignInConfigured()}
        signInCodesAvailable={emailDeliveryAvailable()}
        initialError={error ? ERRORS[error] ?? ERRORS.Default : null}
        initialStep={parseLoginStep(step)}
      />
    </AuthPageShell>
  );
}
