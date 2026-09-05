import "server-only";
import { EmailSendError } from "./types";
import type { EmailMessage, EmailPort } from "./types";

/**
 * Resend REST API adapter (#393). 1:1 port of the direct-fetch logic formerly inline in
 * better-auth/sender.ts — same env vars (RESEND_API_KEY / AUTH_EMAIL_FROM), same request shape.
 *
 * IT ONLY SPEAKS TO RESEND NOW. The keyless fallback that used to live in this function moved out
 * whole to `lib/email/stub-adapter.ts`, and which of the two runs is decided once, by name, in
 * `lib/email/transport.ts` — the same decision the login page reads to know whether it may promise
 * a code at all (Founder 2026-09-05 裁决①). This adapter is therefore only ever chosen WITH a key;
 * the guard below is what makes calling it without one a loud fault rather than a `Bearer
 * undefined` request the provider answers 401 to.
 */
export function createResendEmailPort(): EmailPort {
  return {
    async send(message: EmailMessage): Promise<void> {
      const { to, subject, text, html, from, signal, idempotencyKey } = message;

      if (!process.env.RESEND_API_KEY) {
        throw new EmailSendError("RESEND_API_KEY is not configured.", "config_missing");
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        // #678 — the caller's deadline. Without it a connection the provider accepts and never
        // answers hangs here for as long as the socket stays open.
        signal,
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          // #757 — the provider's own de-duplication. `signal` above cancels our WAIT; it cannot
          // un-accept a request already on the wire, so after a deadline we do not know whether
          // this email went out. This header is what makes the answer to that not matter: the
          // same key is the same email, so a re-send collapses instead of minting a second live
          // link. Omitted when the caller has no stable key to offer — an adapter must not invent
          // one, because a made-up key de-duplicates nothing.
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: from ?? process.env.AUTH_EMAIL_FROM ?? "Fikirtive <onboarding@resend.dev>",
          to,
          subject,
          text,
          // #939 — Resend's REST API accepts both parts on one request; `html` is simply
          // omitted from the JSON body (JSON.stringify drops `undefined` values) when a caller
          // sends text-only.
          html,
        }),
      });
      if (!res.ok) {
        const kind = res.status === 429 || res.status >= 500 ? "retryable" : "non_retryable";
        throw new EmailSendError(`Auth email failed (${res.status}).`, kind);
      }
    },
  };
}
