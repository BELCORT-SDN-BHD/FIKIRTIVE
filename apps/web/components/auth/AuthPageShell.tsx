import type { ReactNode } from "react";
import Link from "next/link";

import { FikirtiveMark } from "@/components/brand/FikirtiveMark";

/** Shared visual shell for every public account door. Product identity belongs to Fikirtive. */
export function AuthPageShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="gb relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-5 py-16 sm:px-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_50%_0%,var(--brand-soft),transparent_68%)] opacity-55"
      />
      <div className="relative w-full max-w-[410px]">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <FikirtiveMark size={30} />
          <span className="text-[19px] font-bold tracking-[-0.015em]">fikirtive</span>
        </div>

        {children}

        <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
