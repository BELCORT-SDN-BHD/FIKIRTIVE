"use client";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";

/** Interactive sign-in surface. Magic-link stays the primary path (passwordless,
 *  matching the prior UX); Google and email+password are added beneath. All three
 *  go through authClient (Better Auth). `from` preserves the post-login redirect. */
export function LoginForm({ from }: { from: string }) {
  const callbackURL = from && from.startsWith("/") ? from : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"magic" | "google" | "password" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy("magic");
    setError(null);
    const { error } = await authClient.signIn.magicLink({ email: email.trim(), callbackURL });
    setBusy(null);
    if (error) setError(error.message ?? "Sign-in failed — try again.");
    else setSent(true);
  }

  async function signInWithGoogle() {
    if (busy) return;
    setBusy("google");
    setError(null);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL });
    // On success the browser is redirected to Google; only reachable on error.
    if (error) {
      setBusy(null);
      setError(error.message ?? "Google sign-in failed — try again.");
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy("password");
    setError(null);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(null);
    if (error) setError(error.message ?? "Wrong email or password.");
    else window.location.assign(callbackURL);
  }

  if (sent) {
    return (
      <a
        href="/login"
        style={{ font: "var(--text-small)", color: "var(--fg-2)", textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        Use a different email
      </a>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && (
        <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: "0 0 2px" }}>
          {error}
        </p>
      )}

      <form onSubmit={sendMagicLink} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </span>
        </label>

        <label className="al-field">
          <span className="al-field-label">Password (optional)</span>
          <span className="al-input-wrap">
            <input
              type="password"
              name="password"
              placeholder="Leave blank to use a magic link"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </span>
        </label>

        {password ? (
          <button
            type="button"
            onClick={signInWithPassword}
            disabled={!!busy}
            className="al-btn al-btn-primary al-btn-md al-btn-full"
          >
            {busy === "password" ? "Signing in…" : "Sign in"}
          </button>
        ) : (
          <button type="submit" disabled={!!busy} className="al-btn al-btn-primary al-btn-md al-btn-full">
            {busy === "magic" ? "Sending…" : "Send magic link"}
          </button>
        )}
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 10, font: "var(--text-small)", color: "var(--fg-3)" }}>
        <span style={{ flex: 1, height: 1, background: "var(--line-2)" }} />
        or
        <span style={{ flex: 1, height: 1, background: "var(--line-2)" }} />
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={!!busy}
        className="al-btn al-btn-glass al-btn-md al-btn-full"
      >
        {busy === "google" ? "Redirecting…" : "Continue with Google"}
      </button>
    </div>
  );
}
