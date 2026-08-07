import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const DEV_FILE = path.join(process.cwd(), "..", "..", ".data", "last-magic-link.txt");

const job = (over: Record<string, unknown> = {}) => ({
  to: "a@x.test",
  subject: "S",
  url: "https://x.test/verify?t=1",
  intro: "Sign in",
  deliverIf: () => true,
  ...over,
});

describe("dispatchAuthEmail", () => {
  beforeEach(() => { delete process.env.RESEND_API_KEY; vi.stubEnv("NODE_ENV", "test"); });
  afterEach(async () => { await rm(DEV_FILE, { force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("returns synchronously — the caller never awaits delivery", async () => {
    const { dispatchAuthEmail, authEmailDispatchesSettled } = await import("@/lib/better-auth/sender");
    // The dev transport writes the link to a file; that write is still to come at this point.
    expect(dispatchAuthEmail(job({ to: "sync@x.test" }))).toBeUndefined();
    await expect(readFile(DEV_FILE, "utf8")).rejects.toThrow();
    await authEmailDispatchesSettled();
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/verify?t=1");
  });

  it("delivers nothing when the address has no access, having travelled the same path", async () => {
    const { dispatchAuthEmail, authEmailDispatchesSettled } = await import("@/lib/better-auth/sender");
    const deliverIf = vi.fn(async () => false);
    dispatchAuthEmail(job({ to: "stranger@x.test", deliverIf }));
    await authEmailDispatchesSettled();
    expect(deliverIf).toHaveBeenCalledTimes(1); // same job, same handover …
    await expect(readFile(DEV_FILE, "utf8")).rejects.toThrow(); // … nothing written
  });

  // The cap is UNCHANGED at 5 per address per hour. What changed is that being over it is not
  // observable from a request: it now happens on the background side, after the answer.
  it("stops sending after 5 per address per hour — the gate itself is untouched", async () => {
    const { dispatchAuthEmail, authEmailDispatchesSettled } = await import("@/lib/better-auth/sender");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // One at a time: concurrent dispatches would land in the dev file in any order.
    for (let i = 1; i <= 5; i++) {
      dispatchAuthEmail(job({ to: "rl@x.test", url: `https://x.test/link/${i}` }));
      await authEmailDispatchesSettled();
    }
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/link/5");

    dispatchAuthEmail(job({ to: "rl@x.test", url: "https://x.test/link/6" }));
    await authEmailDispatchesSettled();
    // The 6th link never left the building: the dev transport still holds the 5th.
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/link/5");
  });

  it("logs the cap for the operator, with no address in the line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dispatchAuthEmail, authEmailDispatchesSettled } = await import("@/lib/better-auth/sender");
    for (let i = 0; i < 6; i++) dispatchAuthEmail(job({ to: "quiet@x.test", url: "u" }));
    await authEmailDispatchesSettled();
    expect(warn).toHaveBeenCalled();
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain("quiet@x.test");
  });

  it("swallows a transport failure into an operator log — it never reaches the caller", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchAuthEmail, authEmailDispatchesSettled } = await import("@/lib/better-auth/sender");
    expect(dispatchAuthEmail(job({ to: "boom@x.test" }))).toBeUndefined();
    await authEmailDispatchesSettled();

    const lines = error.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email delivery failed"))).toBe(true);
    for (const line of lines) expect(line).not.toContain("boom@x.test");
  });

  it("exports no error type or copy a caller could surface", async () => {
    const sender = await import("@/lib/better-auth/sender");
    expect(Object.keys(sender).sort()).toEqual(["authEmailDispatchesSettled", "dispatchAuthEmail"]);
  });
});
