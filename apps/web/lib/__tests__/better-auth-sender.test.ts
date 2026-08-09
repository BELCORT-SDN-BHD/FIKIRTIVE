import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

/**
 * The BACKGROUND side of the auth-email path (#678 r3). Everything the request used to do and
 * must not do any more happens here: the access decision, the per-address budget, minting the
 * sign-in token, and the send itself.
 */

const DEV_FILE = path.join(process.cwd(), "..", "..", ".data", "last-magic-link.txt");

const verify = (over: Record<string, unknown> = {}) =>
  ({ purpose: "verify-email" as const, email: "a@x.test", url: "https://x.test/verify?t=1", ...over });

describe("the auth-email queue", () => {
  beforeEach(async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    const { __resetAuthEmailCapsForTests, __configureAuthEmailQueueForTests } = await import(
      "@/lib/better-auth/sender"
    );
    __resetAuthEmailCapsForTests();
    // These cases are about the per-address budget's KEY and its operator log, and they read the
    // dev transport's single-file output — so they run the queue serially with no jitter, which
    // keeps the assertions about CONTENT rather than about scheduling. The executor's own
    // properties (concurrency, jitter, deadline) are asserted in auth-email-queue-executor.
    __configureAuthEmailQueueForTests({ maxConcurrency: 1, jitterMaxMs: 0, slotFloorMs: 0 });
  });
  afterEach(async () => {
    const { __configureAuthEmailQueueForTests } = await import("@/lib/better-auth/sender");
    __configureAuthEmailQueueForTests({});
    await rm(DEV_FILE, { force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns synchronously and starts nothing — the caller never awaits any of it", async () => {
    const { enqueueAuthEmail, authEmailQueueSettled } = await import("@/lib/better-auth/sender");
    // The dev transport writes the link to a file; that write is still to come at this point.
    expect(enqueueAuthEmail(verify({ email: "sync@x.test" }))).toBeUndefined();
    await expect(readFile(DEV_FILE, "utf8")).rejects.toThrow();
    // Not even a microtask's worth of the job has run: the queue drains on a macrotask, so a
    // job whose first step answers with no I/O (an address on an env list) cannot sneak its
    // work into the request either.
    await Promise.resolve();
    await expect(readFile(DEV_FILE, "utf8")).rejects.toThrow();
    await authEmailQueueSettled();
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/verify?t=1");
  });

  // The cap is UNCHANGED at 5 per address per hour. What changed is the KEY.
  it("stops sending after 5 per address per hour", async () => {
    const { enqueueAuthEmail, authEmailQueueSettled } = await import("@/lib/better-auth/sender");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 1; i <= 5; i++) {
      enqueueAuthEmail(verify({ email: "rl@x.test", url: `https://x.test/link/${i}` }));
    }
    await authEmailQueueSettled();
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/link/5");

    enqueueAuthEmail(verify({ email: "rl@x.test", url: "https://x.test/link/6" }));
    await authEmailQueueSettled();
    // The 6th link never left the building: the dev transport still holds the 5th.
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/link/5");
  });

  /**
   * #678 r3 — the budget key is normalised.
   *
   * The key used to be the raw submitted string, while every access check lower-cased before
   * comparing. So `owner@shop.test` and `owner@SHOP.test` were one merchant to the allowlist and
   * two independent hourly budgets to the cap: flipping one letter's case bought a fresh five,
   * and the address could be mailed as many times as it has case variants.
   */
  it("treats case and whitespace variants of one address as ONE budget", async () => {
    const { enqueueAuthEmail, authEmailQueueSettled } = await import("@/lib/better-auth/sender");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const variants = [
      "cap@shop.test",
      "CAP@shop.test",
      "cap@SHOP.test",
      "Cap@Shop.Test",
      "  cap@shop.test  ",
      // The sixth variant is the same merchant, and must find the budget already spent.
      "CAP@SHOP.TEST",
    ];
    variants.forEach((email, i) =>
      enqueueAuthEmail(verify({ email, url: `https://x.test/variant/${i + 1}` })),
    );
    await authEmailQueueSettled();
    // RED before the fix: six distinct Map keys, six sends, and the file holds variant/6.
    expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/variant/5");
  });

  it("logs the cap for the operator, with no address in the line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { enqueueAuthEmail, authEmailQueueSettled } = await import("@/lib/better-auth/sender");
    for (let i = 0; i < 6; i++) enqueueAuthEmail(verify({ email: "quiet@x.test", url: "u" }));
    await authEmailQueueSettled();
    expect(warn).toHaveBeenCalled();
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain("quiet@x.test");
  });

  it("swallows a transport failure into an operator log — it never reaches the caller", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const { enqueueAuthEmail, authEmailQueueSettled } = await import("@/lib/better-auth/sender");
    expect(enqueueAuthEmail(verify({ email: "boom@x.test" }))).toBeUndefined();
    await authEmailQueueSettled();

    const lines = error.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email delivery failed"))).toBe(true);
    for (const line of lines) expect(line).not.toContain("boom@x.test");
  });

  /**
   * #757 — THE ONE THING AN ABORT CANNOT DO.
   *
   * The per-job deadline cancels our `fetch`, and that is genuinely useful: it gives the worker
   * slot back and stops us waiting on a provider that has stopped answering. What it cannot do
   * is un-accept a request the provider has already taken. Once the body is on the wire, whether
   * that email goes out is the provider's decision and no test of ours can prove otherwise — the
   * executor's "it was never delivered" is a property of the mock transport, not of the world.
   *
   * So the design admits it and puts a floor under the consequence instead: every send carries an
   * idempotency key derived from the message itself, so ONE MINTED LINK IS ONE EMAIL however many
   * times it is dispatched. That is what makes a re-send after an indeterminate abort safe —
   * without it, the recovery for "we don't know if that went out" is a second live credential for
   * the same address.
   */
  it("stamps one link with one idempotency key, all the way to the provider", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { enqueueAuthEmail, authEmailQueueSettled } = await import("@/lib/better-auth/sender");
    for (const url of ["https://x.test/link/a", "https://x.test/link/a", "https://x.test/link/b"]) {
      enqueueAuthEmail(verify({ email: "idem@x.test", url }));
      await authEmailQueueSettled();
    }

    const keys = fetchMock.mock.calls.map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    // The same link dispatched twice is one email at the provider…
    expect(keys[1]).toBe(keys[0]);
    // …and a different link is a different email, so nothing legitimate is collapsed.
    expect(keys[2]).not.toBe(keys[0]);
    // It carries no address in the clear — the key travels in a header and lands in logs.
    for (const key of keys) expect(key).not.toContain("idem@x.test");
  });

  it("exports no error type or copy a caller could surface", async () => {
    const sender = await import("@/lib/better-auth/sender");
    expect(Object.keys(sender).sort()).toEqual([
      "AUTH_EMAIL_JITTER_MAX_MS",
      "AUTH_EMAIL_JOB_TIMEOUT_MS",
      "AUTH_EMAIL_LINK_TTL_MS",
      "AUTH_EMAIL_LINK_TTL_SECONDS",
      "AUTH_EMAIL_MAX_CONCURRENCY",
      "AUTH_EMAIL_MAX_QUEUED",
      "AUTH_EMAIL_SLOT_FLOOR_MS",
      "AUTH_EMAIL_WORST_SLOT_MS",
      "__authEmailQueueDepthForTests",
      "__configureAuthEmailQueueForTests",
      "__resetAuthEmailCapsForTests",
      "authEmailQueueSettled",
      "enqueueAuthEmail",
      "sendAuthEmail",
    ]);
  });
});
