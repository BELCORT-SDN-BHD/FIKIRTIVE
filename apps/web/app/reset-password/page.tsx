import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set a new password · Fikirtive" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const usable = !!token && !error;

  return (
    <main className="gb flex min-h-[100dvh] w-full items-center justify-center bg-card p-8 sm:p-10">
      <div className="w-full max-w-[380px]">
        <h1 className="mb-1.5 text-[25px] font-bold tracking-[-0.02em] text-foreground">
          {usable ? "Set a new password" : "This link no longer works"}
        </h1>

        {usable ? (
          <>
            <p className="mb-6 text-[14.5px] leading-[1.55] text-muted-foreground">
              Choose a new password for your account. You&apos;ll be signed out everywhere else.
            </p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <p className="mb-6 text-[14.5px] leading-[1.55] text-muted-foreground">
              Reset links work once and expire after an hour. Request a fresh one and we&apos;ll
              send it straight away.
            </p>
            <Link
              href="/forgot-password"
              className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-card)] border border-border text-[14px] font-semibold text-foreground hover:bg-muted"
            >
              Request a new link
            </Link>
          </>
        )}

        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          <Link href="/login" className="font-semibold text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
