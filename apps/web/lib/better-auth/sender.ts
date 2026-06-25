import "server-only";

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
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not configured.");
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "..", "..", ".data");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "last-magic-link.txt"), url, "utf8");
    console.log(`[better-auth] ${subject} for ${to}: ${url}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM ?? "Fikirtive <onboarding@resend.dev>",
      to,
      subject,
      text: `${intro}:\n${url}\n\nIf you didn't request this, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Auth email failed (${res.status}).`);
}
