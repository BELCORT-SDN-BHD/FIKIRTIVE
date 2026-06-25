import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth/compat";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Fikirtive" };

const ERRORS: Record<string, string> = {
  AccessDenied: "This email isn't on the allowlist.",
  Verification: "That link expired or was already used — request a new one.",
  Configuration: "Sign-in is misconfigured — check the server logs.",
  Default: "Sign-in failed — try again.",
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
    <main
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div className="glass-raised fade-rise" style={{ width: "min(400px, 100%)", padding: 28 }}>
        <span className="wordmark" style={{ marginBottom: 6, display: "inline-flex" }}>
          fikirtive<span className="wordmark-dot" />
        </span>
        <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "8px 0 20px" }}>
          Sign in with a magic link, Google, or your password.
        </p>

        {error && (
          <p
            role="alert"
            style={{
              font: "var(--text-small)",
              color: "var(--danger)",
              margin: "0 0 14px",
            }}
          >
            {ERRORS[error] ?? ERRORS.Default}
          </p>
        )}

        <LoginForm from={from ?? "/"} />
      </div>
    </main>
  );
}
