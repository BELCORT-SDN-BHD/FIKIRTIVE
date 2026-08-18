/**
 * #939 — the shared HTML+text builders for auth emails. Pure-function unit tests: no mocks,
 * no database. The call sites that actually wire these into verify-email/password-reset/
 * sign-in code are exercised in lib/__tests__/auth-email-branding.test.ts, which proves the
 * shared functions are really reached from both places rather than duplicated.
 */
import { describe, it, expect } from "vitest";
import { renderAuthCodeEmail, renderAuthEmail } from "../auth-email-template";

/** Decodes an HTML attribute value the same way a browser does — the inverse of the escaping
 *  `renderAuthEmail` applies before embedding a URL in `href="…"`. */
function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

describe("renderAuthEmail", () => {
  const url = "https://x.test/api/better-auth/verify-email?token=abc123&callbackURL=https%3A%2F%2Fx.test%2Fdash";

  it("puts the URL in the CTA button's href, and it decodes back byte-for-byte", () => {
    const { html } = renderAuthEmail({ action: "Verify your email", url, validitySeconds: 3600 });
    const hrefMatches = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefMatches.length).toBeGreaterThanOrEqual(1);
    for (const href of hrefMatches) {
      expect(decodeHtmlAttr(href)).toBe(url);
    }
  });

  it("does not let & in the URL corrupt the surrounding markup — every & is properly escaped", () => {
    const { html } = renderAuthEmail({ action: "Verify your email", url, validitySeconds: 3600 });
    // A raw, un-escaped `&` immediately followed by a HTML-attribute string is the corruption
    // this guards against. Every ampersand belonging to the URL must appear as `&amp;`.
    const rawAmpersandCount = (url.match(/&/g) ?? []).length;
    const escapedAmpersandCount = (html.match(/&amp;/g) ?? []).length;
    expect(rawAmpersandCount).toBeGreaterThan(0);
    expect(escapedAmpersandCount).toBeGreaterThanOrEqual(rawAmpersandCount);
    // And no bare `&` (not part of an entity) sits where the URL was written.
    expect(html).not.toMatch(/token=abc123&callbackURL/); // would be the un-escaped form
  });

  it("carries the bare, completely unescaped link in the text fallback", () => {
    const { text } = renderAuthEmail({ action: "Verify your email", url, validitySeconds: 3600 });
    expect(text).toContain(url);
  });

  it("states the real validity window it was given — 1 hour for 3600s, 15 minutes for 900s", () => {
    const hourly = renderAuthEmail({ action: "Verify your email", url, validitySeconds: 3600 });
    expect(hourly.html).toContain("This link is valid for 1 hour.");
    expect(hourly.text).toContain("This link is valid for 1 hour.");

    const quarterHour = renderAuthEmail({ action: "Sign in to Fikirtive", url, validitySeconds: 900 });
    expect(quarterHour.html).toContain("This link is valid for 15 minutes.");
    expect(quarterHour.text).toContain("This link is valid for 15 minutes.");
  });

  it("carries the Fikirtive wordmark and no external image/script/stylesheet resources", () => {
    const { html } = renderAuthEmail({ action: "Verify your email", url, validitySeconds: 3600 });
    expect(html).toContain("Fikirtive");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toContain("http://fonts.");
  });

  it("shows the action as both the CTA label and the explanatory sentence", () => {
    const { html, text } = renderAuthEmail({ action: "Reset your password", url, validitySeconds: 3600 });
    expect(html).toContain(">Reset your password<");
    expect(html).toContain("Reset your password using the button below.");
    expect(text).toContain("Reset your password using the link below.");
  });

  it("HTML-escapes an action phrase that contains markup-sensitive characters", () => {
    const { html } = renderAuthEmail({ action: 'Verify <you> & "confirm"', url, validitySeconds: 3600 });
    expect(html).not.toContain("<you>");
    expect(html).toContain("&lt;you&gt;");
  });
});

/**
 * The code variant. Same shell, different middle — and the differences that matter are the ones
 * asserted here: the code is present and readable, the validity line says CODE rather than link,
 * and there is nothing clickable anywhere. A sign-in mail with no link is a sign-in mail phishing
 * has nothing to copy.
 */
describe("renderAuthCodeEmail", () => {
  const code = "418902";

  it("shows the code in both parts, and states the real validity window", () => {
    const { html, text } = renderAuthCodeEmail({
      action: "Sign in to Fikirtive",
      code,
      validitySeconds: 900,
    });
    expect(html).toContain(code);
    expect(text).toContain(code);
    expect(html).toContain("This code is valid for 15 minutes.");
    expect(text).toContain("This code is valid for 15 minutes.");
    // The link email's sentence must not leak into the code email.
    expect(html).not.toContain("This link is valid");
    expect(text).not.toContain("This link is valid");
  });

  it("carries nothing to click — no href, no URL, not even in the text part", () => {
    const { html, text } = renderAuthCodeEmail({
      action: "Sign in to Fikirtive",
      code,
      validitySeconds: 900,
    });
    expect(html).not.toContain("href=");
    expect(html).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("carries the Fikirtive wordmark and no external image/script/stylesheet resources", () => {
    const { html } = renderAuthCodeEmail({
      action: "Sign in to Fikirtive",
      code,
      validitySeconds: 900,
    });
    expect(html).toContain("Fikirtive");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<link/i);
  });

  it("HTML-escapes both the action phrase and the code", () => {
    const { html } = renderAuthCodeEmail({
      action: 'Sign <in> & "confirm"',
      code: "<b>0</b>",
      validitySeconds: 900,
    });
    expect(html).not.toContain("<in>");
    expect(html).toContain("&lt;in&gt;");
    // A code is digits in practice; escaping it anyway means a future generator that is not
    // cannot inject markup into a merchant's inbox.
    expect(html).not.toContain("<b>0</b>");
    expect(html).toContain("&lt;b&gt;0&lt;/b&gt;");
  });
});
