import "server-only";
import { emailPort } from "@/lib/email";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

/** Per-address outbound cap. Returns false once this address is over the cap for the window;
 *  the cap itself is UNCHANGED (5 auth emails per address per hour) — see sendAuthEmail for
 *  why being over it is no longer an error the merchant can read. */
function withinRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

/** #678 — being over the per-address cap SUPPRESSES the email and returns normally.
 *
 *  It used to throw, and that throw was the whole defect. The sign-in door is deliberately
 *  enumeration-safe: an address without access is answered by server.ts's before hook with the
 *  same neutral success body, and never reaches this function at all. So the counter could only
 *  ever be reached — and the "Too many sign-in links requested" copy could only ever be
 *  rendered — for an address that DOES have access. Six clicks on one address therefore told
 *  anyone whether that address is on Fikirtive, straight through the parity the login page was
 *  built to hold.
 *
 *  Every door that sends an auth email goes through here (magic link, password reset, address
 *  verification), so suppressing at this seam closes the whole class in one place instead of
 *  re-wording each caller.
 *
 *  THE GATE IS NOT LOOSENED: over the cap, nothing is sent — exactly as before. Only who gets
 *  to read about it changed: the merchant sees the same neutral answer, the operator sees the
 *  log line below. No address is logged (#575 log discipline). */
export async function sendAuthEmail(opts: { to: string; subject: string; url: string; intro: string }): Promise<void> {
  const { to, subject, url, intro } = opts;
  if (!withinRateLimit(to)) {
    console.warn("[better-auth] auth email suppressed: per-address hourly cap reached");
    return;
  }
  await emailPort.send({
    to,
    subject,
    text: `${intro}:\n${url}\n\nIf you didn't request this, ignore this email.`,
    devPreview: url,
  });
}
