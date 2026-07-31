import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth/compat";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Fikirtive" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in failed. Try again.",
  Verification: "That link expired or was already used. Request a new one.",
  Configuration: "Sign-in is misconfigured. Check the server logs.",
  Default: "Sign-in failed. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; from?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");
  const { error, from } = await searchParams;

  return (
    <main className="gb flex min-h-[100dvh] w-full">
      {/* LEFT — the confident half (hidden on small screens) */}
      <section className="relative hidden flex-[1.15] flex-col overflow-hidden bg-[#F7F5F2] p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-[520px] w-[520px]"
          style={{ background: "radial-gradient(closest-side, rgba(236,88,40,0.13), transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -left-20 h-[420px] w-[420px]"
          style={{ background: "radial-gradient(closest-side, rgba(236,88,40,0.06), transparent 70%)" }}
        />

        <div className="relative z-10 flex items-center gap-2.5">
          <OttoMark size={26} />
          <span className="text-[19px] font-bold tracking-[-0.01em]">fikirtive</span>
        </div>

        <div className="relative z-10 my-auto max-w-[480px]">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-[13px] font-semibold text-brand-soft-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
              <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10z" />
            </svg>
            Meet Otto, your marketing operator
          </span>
          <h1 className="text-[42px] font-extrabold leading-[1.08] tracking-[-0.025em] text-[#141412]">
            Run real campaigns without becoming a <span className="text-brand">marketer</span>.
          </h1>
          <p className="mt-[18px] max-w-[430px] text-[16px] leading-[1.55] text-[#5A5A56]">
            Tell Otto what you&apos;re launching. It researches your brand, writes the copy, designs the
            images, films the video, and gets it ready to post. You just approve.
          </p>
          <ul className="mt-7 flex flex-col gap-[11px]">
            {[
              "From idea to a ready-to-post ad pack in minutes",
              "You only pay when a generation finishes, never on errors",
              "Schedules across Instagram and Facebook — direct publish is coming soon",
            ].map((t) => (
              <li key={t} className="flex items-center gap-[11px] text-[14.5px] font-medium text-[#3A3A38]">
                <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="size-[13px]">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[13.5px] text-[#86867F]">
          Trusted by small brands shipping their own marketing.
        </p>
      </section>

      {/* RIGHT — the form */}
      <section className="flex flex-1 items-center justify-center bg-card p-8 sm:p-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-1.5 flex items-center gap-2.5">
            <OttoFace size={30} />
            <h2 className="text-[25px] font-bold tracking-[-0.02em] text-foreground">Welcome back</h2>
          </div>
          <p className="mb-6 text-[14.5px] text-muted-foreground">
            Sign in to pick up where you and Otto left off.
          </p>

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-error-soft px-3.5 py-2.5 text-[13.5px] font-medium text-error-soft-foreground"
            >
              {ERRORS[error] ?? ERRORS.Default}
            </p>
          )}

          <LoginForm from={from ?? "/"} />

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            New here?{" "}
            <a href="/signup" className="font-semibold text-foreground underline underline-offset-4">
              Create an account
            </a>
          </p>

          <p className="mt-4 text-center text-[12px] leading-[1.6] text-muted-foreground">
            By continuing you agree to our{" "}
            <a href="/terms" className="underline">Terms</a> and{" "}
            <a href="/privacy" className="underline">Privacy Policy</a>.
          </p>
        </div>
      </section>
    </main>
  );
}

/** OTTO — the coral cloud mark. Coral is OTTO's colour only. */
function OttoMark({ size = 26 }: { size?: number }) {
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

/** OTTO with happy eyes — used where OTTO greets. */
function OttoFace({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 27) / 30} viewBox="0 0 120 110" aria-hidden>
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <path d="M49 50 q5.5 -7 11 0" fill="none" stroke="#2B1308" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M64 50 q5.5 -7 11 0" fill="none" stroke="#2B1308" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}
