/**
 * EmailPort — neutral email-send contract (#393). Extracted from the former direct-fetch
 * Resend call in better-auth/sender.ts so the transport can be swapped (self-hosted SMTP,
 * another provider) without touching call sites. Scope is transport only: composing subject/
 * body text and any send-rate policy stay with the caller (e.g. better-auth/sender.ts).
 */

/** Error classification an adapter attaches to a thrown EmailSendError:
 *  - "config_missing": the adapter isn't configured to send at all (e.g. no API key in prod).
 *  - "retryable": the send failed in a way a caller could plausibly retry (e.g. 5xx/429).
 *  - "non_retryable": the send failed in a way retrying won't fix (e.g. 4xx other than 429). */
export type EmailErrorKind = "config_missing" | "retryable" | "non_retryable";

export class EmailSendError extends Error {
  readonly kind: EmailErrorKind;
  constructor(message: string, kind: EmailErrorKind) {
    super(message);
    this.name = "EmailSendError";
    this.kind = kind;
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  /** Optional value a local/dev fallback (no credentials configured) persists and logs
   *  INSTEAD of the full text/html body — e.g. the bare link a developer needs to click.
   *  Falls back to `text` (then `html`) when omitted. */
  devPreview?: string;
  /** #678 — abort the in-flight send. A provider that accepts the connection and then never
   *  answers would otherwise hold its caller forever; the auth-email queue passes a signal that
   *  fires on its own deadline so one stuck send cannot become every tenant's stuck send. */
  signal?: AbortSignal;
  /** #757 — the same value for the same logical email, so an adapter can ask the provider to
   *  deliver it at most once however many times it is dispatched.
   *
   *  It exists because `signal` has a hard limit: aborting stops us WAITING, it does not un-accept
   *  a request the provider has already taken. After an abort we genuinely do not know whether
   *  that email went out, and the only safe recovery from "we don't know" is a re-send that
   *  cannot become a second email. Callers derive it from the message's own content, so it is
   *  stable across dispatches and different for a different message. */
  idempotencyKey?: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}
