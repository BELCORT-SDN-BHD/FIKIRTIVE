import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth/compat";
import { signupsPaused, SIGNUPS_PAUSED_MESSAGE } from "@/lib/signup-gate";
import { SIGNUP_GRANT_CREDITS, displayCredits } from "@fikirtive/core";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create your account · Fikirtive" };

export default async function SignupPage() {
  const session = await auth();
  if (session) redirect("/");
  const paused = signupsPaused();
  const starterCredits = displayCredits(SIGNUP_GRANT_CREDITS);

  return (
    <main className="gb flex min-h-[100dvh] w-full items-center justify-center bg-card p-8 sm:p-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-1.5 flex items-center gap-2.5">
          <OttoMark size={30} />
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-foreground">
            {paused ? "Signups are paused" : "Create your account"}
          </h1>
        </div>

        {paused ? (
          <>
            <p className="mb-6 text-[14.5px] leading-[1.55] text-muted-foreground">
              {SIGNUPS_PAUSED_MESSAGE} We aren&apos;t taking new accounts at the moment, so there is
              nothing to sign up for yet. If you already have an account you can still sign in.
            </p>
            <Link
              href="/login"
              className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-card)] border border-border text-[14px] font-semibold text-foreground hover:bg-muted"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            {/* #805 — "meet Otto" sold an introduction; the ruling sells the work getting done.
                The priced promise after the dash is unchanged on purpose: #810 pins it to the
                three things the live price list actually quotes. */}
            <p className="mb-6 text-[14.5px] leading-[1.55] text-muted-foreground">
              Set up your shop and put Otto to work. Confirm your email and you start with{" "}
              {starterCredits} free credits — enough for a full run: a conversation with Otto, an
              image, and a short video.
            </p>
            <SignupForm />
          </>
        )}

        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>

        <p className="mt-4 text-center text-[12px] leading-[1.6] text-muted-foreground">
          By creating an account you agree to our{" "}
          <a href="/terms" className="underline">Terms</a> and{" "}
          <a href="/privacy" className="underline">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}

/** OTTO — the coral cloud mark. Coral is OTTO's colour only. */
function OttoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 22) / 24} viewBox="0 0 120 110" aria-hidden>
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
      <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
    </svg>
  );
}
