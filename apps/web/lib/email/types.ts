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
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}
