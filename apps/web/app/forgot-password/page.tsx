import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset your password · Fikirtive" };

export default function ForgotPasswordPage() {
  return (
    <main className="gb flex min-h-[100dvh] w-full items-center justify-center bg-card p-8 sm:p-10">
      <div className="w-full max-w-[380px]">
        <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em] text-foreground">
          Reset your password
        </h1>
        <p className="mb-6 text-[14.5px] leading-[1.55] text-muted-foreground">
          Enter the email you sign in with and we&apos;ll send you a link to set a new password.
        </p>

        <ForgotPasswordForm />

        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          <Link href="/login" className="font-semibold text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
