import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { authDestination } from "@/lib/auth-journey";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset your password · Fikirtive" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <AuthPageShell>
      <ForgotPasswordForm from={authDestination(from)} />
    </AuthPageShell>
  );
}
