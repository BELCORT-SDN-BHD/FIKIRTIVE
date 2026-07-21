import "server-only";
import { emailPort } from "@/lib/email";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

function rateLimit(key: string) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    throw new Error("Too many sign-in links requested — try again in an hour.");
  }
  recent.push(now);
  attempts.set(key, recent);
}

export async function sendAuthEmail(opts: { to: string; subject: string; url: string; intro: string }): Promise<void> {
  const { to, subject, url, intro } = opts;
  rateLimit(to);
  await emailPort.send({
    to,
    subject,
    text: `${intro}:\n${url}\n\nIf you didn't request this, ignore this email.`,
    devPreview: url,
  });
}
