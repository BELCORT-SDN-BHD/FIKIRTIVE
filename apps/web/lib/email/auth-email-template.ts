import "server-only";

/**
 * #939 — the shared HTML+text builder for every branded auth email (verify-email,
 * password-reset, sign-in-link/magic-link). One function, one look: the three call sites in
 * better-auth/sender.ts and better-auth/server.ts all route through this, so a future purpose
 * cannot drift into its own copy of the layout, the escaping or the wording.
 *
 * Deliberately dependency-free. An email client renders whatever markup it is handed with no
 * bundler, often no JS and no external stylesheet — so this writes inline-styled, single-column
 * table markup by hand rather than reaching for a templating library that assumes a browser.
 * No external resources (images, fonts, stylesheets) are referenced.
 */

export interface AuthEmailContent {
  /** Short action phrase, reused as both the CTA button label and the paragraph's subject —
   *  e.g. "Verify your email", "Reset your password", "Sign in to Fikirtive". */
  action: string;
  /** The verification/reset/sign-in link. Injected verbatim: this function only wraps it for
   *  display, it never re-derives, re-encodes or truncates the token itself. */
  url: string;
  /** How long the link stays live, in seconds — the real number for THIS purpose, not a
   *  restated guess. Converted to a friendly label ("15 minutes", "1 hour", …). */
  validitySeconds: number;
}

/** Minimal HTML escaping for both attribute values and text nodes. `&` must go first, or a
 *  later replacement's own `&` would get escaped a second time. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatValidity(seconds: number): string {
  if (seconds > 0 && seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Builds both parts of a branded auth email. The URL passed in is used byte-for-byte — HTML-
 *  escaped only where markup requires it (the href attribute and the visible link text), which
 *  a browser/mail client decodes back to the exact same string; the plain-text version carries
 *  it completely unescaped. */
export function renderAuthEmail({ action, url, validitySeconds }: AuthEmailContent): {
  html: string;
  text: string;
} {
  const validity = formatValidity(validitySeconds);
  const safeUrl = escapeHtml(url);
  const safeAction = escapeHtml(action);

  const text = [
    `${action} using the link below.`,
    "",
    url,
    "",
    `This link is valid for ${validity}. If you didn't request this, you can safely ignore this email.`,
    "",
    "— The Fikirtive team",
  ].join("\n");

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:32px 32px 0 32px;font-family:${FONT_STACK};">
<span style="font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.02em;">Fikirtive</span>
</td></tr>
<tr><td style="padding:24px 32px 0 32px;font-family:${FONT_STACK};">
<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${safeAction} using the button below.</p>
</td></tr>
<tr><td align="center" style="padding:24px 32px 0 32px;">
<a href="${safeUrl}" style="display:inline-block;background-color:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;font-family:${FONT_STACK};">${safeAction}</a>
</td></tr>
<tr><td style="padding:24px 32px 0 32px;font-family:${FONT_STACK};">
<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
<p style="margin:8px 0 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:#2563eb;">${safeUrl}</a></p>
</td></tr>
<tr><td style="padding:24px 32px 0 32px;font-family:${FONT_STACK};">
<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">This link is valid for ${validity}. If you didn't request this, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:${FONT_STACK};">
<p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">— The Fikirtive team</p>
</td></tr>
</table>
</td></tr>
</table>`;

  return { html, text };
}
