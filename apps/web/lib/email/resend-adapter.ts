import "server-only";
import { EmailSendError } from "./types";
import type { EmailMessage, EmailPort } from "./types";

/**
 * Resend REST API adapter (#393). 1:1 port of the direct-fetch logic formerly inline in
 * better-auth/sender.ts — same env vars (RESEND_API_KEY / AUTH_EMAIL_FROM), same dev fallback
 * (no key + non-production → write <repo>/.data/last-magic-link.txt + console.log instead of
 * sending), same request shape. No behavior change; only the transport moved behind EmailPort.
 */
export function createResendEmailPort(): EmailPort {
  return {
    async send(message: EmailMessage): Promise<void> {
      const { to, subject, text, from, signal } = message;
      const preview = message.devPreview ?? text ?? message.html ?? "";

      if (!process.env.RESEND_API_KEY) {
        if (process.env.NODE_ENV === "production") {
          throw new EmailSendError("RESEND_API_KEY is not configured.", "config_missing");
        }
        const { writeFile, mkdir } = await import("node:fs/promises");
        const path = await import("node:path");
        const dir = path.join(process.cwd(), "..", "..", ".data");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "last-magic-link.txt"), preview, "utf8");
        console.log(`[better-auth] ${subject} for ${to}: ${preview}`);
        return;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        // #678 — the caller's deadline. Without it a connection the provider accepts and never
        // answers hangs here for as long as the socket stays open.
        signal,
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: from ?? process.env.AUTH_EMAIL_FROM ?? "Fikirtive <onboarding@resend.dev>",
          to,
          subject,
          text,
        }),
      });
      if (!res.ok) {
        const kind = res.status === 429 || res.status >= 500 ? "retryable" : "non_retryable";
        throw new EmailSendError(`Auth email failed (${res.status}).`, kind);
      }
    },
  };
}
