import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Artlio" };

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
  const { sent, error, from } = await searchParams;

  async function sendLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    await signIn("resend", {
      email,
      redirect: true,
      redirectTo: from && from.startsWith("/") ? from : "/",
    });
  }

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
          artlio<span className="wordmark-dot" />
        </span>
        <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "8px 0 20px" }}>
          {sent
            ? "Check your inbox — the sign-in link is on its way."
            : "Sign in with your email. No passwords."}
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

        {!sent && (
          <form action={sendLink} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label className="al-field">
              <span className="al-field-label">Email</span>
              <span className="al-input-wrap">
                <input
                  type="email"
                  name="email"
                  required
                  autoFocus
                  placeholder="you@studio.com"
                  autoComplete="email"
                />
              </span>
            </label>
            <button type="submit" className="al-btn al-btn-primary al-btn-md al-btn-full">
              Send magic link
            </button>
          </form>
        )}

        {sent && (
          <a
            href="/login"
            style={{
              font: "var(--text-small)",
              color: "var(--fg-2)",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Use a different email
          </a>
        )}
      </div>
    </main>
  );
}
