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

  // #678 — the cap is UNCHANGED (5 per address per hour); what changed is that being over it is
  // no longer something the caller — and therefore the merchant — can tell apart from a normal
  // send. Both halves are asserted here, because relaxing either one is a regression: the first
  // would re-open the account-existence oracle, the second would uncap outbound mail.
  it("stops sending after 5 per address per hour — the gate itself is untouched", async () => {
    const { sendAuthEmail } = await import("@/lib/better-auth/sender");
    const send = (n: number) =>
      sendAuthEmail({ to: "rl@x.test", subject: "S", url: `https://x.test/link/${n}`, intro: "i" });

    for (let i = 1; i <= 5; i++) await send(i);
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/link/5");

    await send(6);
    // The 6th link never left the building: the dev transport still holds the 5th.
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/link/5");
  });

  it("returns normally when over the cap, so no caller can render a rate-limit answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendAuthEmail } = await import("@/lib/better-auth/sender");
    const send = () => sendAuthEmail({ to: "quiet@x.test", subject: "S", url: "u", intro: "i" });

    for (let i = 0; i < 5; i++) await send();
    // RED before #678: this rejected with MagicLinkRateLimitError, and login/actions.ts turned
    // that into "Too many sign-in links requested — try again in an hour." — copy that only an
    // address WITH access could ever produce.
    await expect(send()).resolves.toBeUndefined();
    await expect(send()).resolves.toBeUndefined();

    // The operator still learns about it, and the log carries no address (#575 log discipline).
    expect(warn).toHaveBeenCalled();
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain("quiet@x.test");
  });

  it("exports no rate-limit error type or copy for a caller to surface", async () => {
    const sender = await import("@/lib/better-auth/sender");
    expect(Object.keys(sender)).toEqual(["sendAuthEmail"]);
  });
});
