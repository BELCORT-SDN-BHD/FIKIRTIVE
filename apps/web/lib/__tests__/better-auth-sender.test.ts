import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const DEV_FILE = path.join(process.cwd(), "..", "..", ".data", "last-magic-link.txt");

describe("sendAuthEmail", () => {
  beforeEach(() => { delete process.env.RESEND_API_KEY; vi.stubEnv("NODE_ENV", "test"); });
  afterEach(async () => { await rm(DEV_FILE, { force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("writes the link to the dev file when RESEND_API_KEY is unset", async () => {
    const { sendAuthEmail } = await import("@/lib/better-auth/sender");
    await sendAuthEmail({ to: "a@x.test", subject: "S", url: "https://x.test/verify?t=1", intro: "Sign in" });
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/verify?t=1");
  });

  it("rate-limits after 5 sends per address per hour", async () => {
    const { MagicLinkRateLimitError, sendAuthEmail } = await import("@/lib/better-auth/sender");
    const call = () => sendAuthEmail({ to: "rl@x.test", subject: "S", url: "u", intro: "i" });
    for (let i = 0; i < 5; i++) await call();
    await expect(call()).rejects.toEqual(
      expect.objectContaining({
        name: "MagicLinkRateLimitError",
        message: "Too many sign-in links requested — try again in an hour.",
      }),
    );
    await expect(call()).rejects.toBeInstanceOf(MagicLinkRateLimitError);
  });
});
