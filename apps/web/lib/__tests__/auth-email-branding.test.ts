/**
 * #939 — branded HTML auth emails, asserted at the REAL send call sites rather than only
 * against the shared template (that unit coverage lives in
 * lib/email/__tests__/auth-email-template.test.ts).
 *
 * Two call sites build the AuthEmailJob → sendAuthEmail(...) → emailPort.send(...) chain:
 *   1. runAuthEmailJob's password-reset/verify-email branch (lib/better-auth/sender.ts).
 *   2. the emailOTP plugin's `sendVerificationOTP` hook (lib/better-auth/server.ts) — reached
 *      only through the REAL Better Auth instance, so this file constructs it exactly like
 *      signup-door.test.ts / auth-email-queue-executor.test.ts do, against the real local
 *      Postgres. Only emailPort.send is mocked.
 *
 * The two kinds of auth mail differ in what the card holds — a link to click, or a code to type —
 * and the sign-in case below is where that difference is pinned: a code email must carry the code
 * and NO link at all, because a sign-in mail with nothing clickable is a sign-in mail a phisher
 * cannot imitate.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

type SentEmail = { to: string; subject: string; text?: string; html?: string; devPreview?: string };
const sent: SentEmail[] = [];

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, emailPort: { send: vi.fn(async (m: SentEmail) => { sent.push(m); }) } };
});

// Set BEFORE the top-level dynamic imports below — Better Auth reads baseURL/secret at
// construction time, which happens at module load (same rule as signup-door.test.ts).
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

const SIGNIN_ADDR = `p939-signin-${randomUUID()}@fikirtive.test`;
// password-reset re-checks the allowlist (unlike verify-email, which is the one path a
// brand-new self-service account walks before it is on any list — see sender.ts's
// runAuthEmailJob), so its test address must be allowed too, or the send is suppressed.
const RESET_ADDR = `p939-reset-${randomUUID()}@fikirtive.test`;
process.env.AUTH_ALLOWED_EMAILS = [SIGNIN_ADDR, RESET_ADDR].join(",");

// Constructs the real `auth` object, which registers the emailOTP plugin's sendVerificationOTP
// hook — sender.ts's own `runOneJob` dynamic-imports this same module path when a
// "sign-in-code" job runs, so this is the same singleton instance either way.
const { prisma } = await import("@fikirtive/db");
const { auth } = await import("@/lib/better-auth/server");
const {
  enqueueAuthEmail,
  authEmailQueueSettled,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
} = await import("@/lib/better-auth/sender");

/** The URL a browser/mail-client would see after decoding the CTA's href attribute — the
 *  inverse of the escaping renderAuthEmail applies. */
function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => decodeHtmlAttr(m[1]));
}

describe("#939 — auth emails carry branded html + text at the real send call sites", () => {
  beforeEach(async () => {
    sent.length = 0;
    await __resetAuthEmailCapsForTests();
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  });

  it("verify-email — runAuthEmailJob's queue branch passes html+text, the token link untouched, 1-hour validity", async () => {
    const email = `p939-verify-${randomUUID()}@fikirtive.test`;
    const url = "https://x.test/api/better-auth/verify-email?token=abc123&callbackURL=https%3A%2F%2Fx.test%2Fdash";

    enqueueAuthEmail({ purpose: "verify-email", email, url });
    await authEmailQueueSettled();

    const msg = sent.find((m) => m.to === email);
    expect(msg, `no email captured for ${email}; inbox=${JSON.stringify(sent)}`).toBeDefined();
    expect(msg!.html).toBeTruthy();
    expect(msg!.text).toBeTruthy();
    // the bare link, verbatim, for clients that strip the button
    expect(msg!.text).toContain(url);
    // the CTA href decodes back to the exact same link — not a mangled one
    expect(hrefsIn(msg!.html!)).toContain(url);
    expect(msg!.html).toContain("This link is valid for 1 hour.");
    expect(msg!.text).toContain("This link is valid for 1 hour.");
  });

  it("password-reset — runAuthEmailJob's queue branch passes html+text with a 1-hour validity line", async () => {
    const url = "https://x.test/reset-password?token=def456";

    enqueueAuthEmail({ purpose: "password-reset", email: RESET_ADDR, url });
    await authEmailQueueSettled();

    const msg = sent.find((m) => m.to === RESET_ADDR);
    expect(msg).toBeDefined();
    expect(msg!.html).toBeTruthy();
    expect(msg!.text).toBeTruthy();
    expect(msg!.text).toContain(url);
    expect(hrefsIn(msg!.html!)).toContain(url);
    expect(msg!.html).toContain("This link is valid for 1 hour.");
  });

  it("sign-in-code — the REAL emailOTP plugin's sendVerificationOTP hook (server.ts) passes html+text with the true 15-minute validity, not the other purposes' 1 hour", async () => {
    enqueueAuthEmail({ purpose: "sign-in-code", email: SIGNIN_ADDR, overBudget: false });
    await authEmailQueueSettled();

    const msg = sent.find((m) => m.to === SIGNIN_ADDR);
    expect(msg, `no email captured for ${SIGNIN_ADDR}; inbox=${JSON.stringify(sent)}`).toBeDefined();
    expect(msg!.html).toBeTruthy();
    expect(msg!.text).toBeTruthy();

    // The real, minted code — six digits, and the SAME six in the html, the text and the dev
    // preview. Proves what reaches the inbox is what Better Auth actually issued.
    const code = msg!.devPreview;
    expect(code).toMatch(/^\d{6}$/);
    expect(msg!.text).toContain(code);
    expect(msg!.html).toContain(code);

    // …and it is the code Better Auth STORED, not one this hook invented. The stored value is
    // ciphertext (server.ts, `storeOTP: "encrypted"`), so this reads it back through the
    // library's own decrypt — which is also the proof the row is not holding the code in the
    // clear: this call throws outright when the plugin is configured to hash, and would return
    // the digits unchanged if it were configured to store them plainly.
    await expect(
      auth.api.getVerificationOTP({ query: { email: SIGNIN_ADDR, type: "sign-in" } }),
    ).resolves.toEqual({ otp: code });
    const row = await prisma.betterAuthVerification.findFirst({
      where: { identifier: `sign-in-otp-${SIGNIN_ADDR}` },
    });
    expect(row?.value).not.toContain(code);

    // NOTHING TO CLICK. A code email with a link in it is the shape phishing copies.
    expect(hrefsIn(msg!.html!)).toEqual([]);
    expect(msg!.text).not.toMatch(/https?:\/\//);

    expect(msg!.html).toContain("This code is valid for 15 minutes.");
    expect(msg!.text).toContain("This code is valid for 15 minutes.");
    expect(msg!.html).not.toContain("1 hour");
    expect(msg!.subject).toBe("Your Fikirtive sign-in code");
  });
});

afterAll(async () => {
  __configureAuthEmailQueueForTests({});
  try {
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: "p939-" } },
    });
  } catch {
    /* best-effort cleanup */
  }
});
