/**
 * #678 r3 — the throttle that sits on the door the product actually uses.
 *
 * Round 2 put a per-IP rule in Better Auth's `rateLimit` config. Those rules only run inside
 * `auth.handler`, and the login page calls a server action, so the rule guarded a door nobody
 * used while the real one had no cap at all. This is the replacement, in our own layer, and these
 * cases pin the two properties it has to have: it bounds an anonymous caller, and it says nothing
 * about the address.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const queued: Array<Record<string, unknown>> = [];

vi.mock("@/lib/better-auth/sender", () => ({
  enqueueAuthEmail: (job: Record<string, unknown>) => {
    queued.push(job);
  },
}));

const { acceptMagicLinkRequest, __resetMagicLinkThrottleForTests } = await import(
  "@/lib/better-auth/magic-link-request"
);

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });
const press = (email: string, ip = "203.0.113.10", callbackURL = "/") =>
  acceptMagicLinkRequest({ email, callbackURL, requestHeaders: from(ip) });

beforeEach(() => {
  queued.length = 0;
  __resetMagicLinkThrottleForTests();
});

describe("the caller-and-address budget", () => {
  it("queues five presses for one address from one caller, then stops queueing", () => {
    for (let i = 0; i < 6; i++) expect(press("owner@shop.test")).toBe("accepted");
    expect(queued).toHaveLength(5);
  });

  it("gives every case and whitespace variant of one address the SAME budget", () => {
    const variants = [
      "owner@shop.test",
      "OWNER@shop.test",
      "owner@SHOP.test",
      "Owner@Shop.Test",
      "  owner@shop.test  ",
      "OWNER@SHOP.TEST",
    ];
    for (const email of variants) expect(press(email)).toBe("accepted");
    // RED without normalisation: six keys, six jobs.
    expect(queued).toHaveLength(5);
    // …and every queued job carries the one normalised form the background will bill.
    expect(new Set(queued.map((j) => j.email))).toEqual(new Set(["owner@shop.test"]));
  });

  it("does not let one exhausted address lock the same caller out of another", () => {
    for (let i = 0; i < 6; i++) press("first@shop.test");
    queued.length = 0;
    // The second merchant on the same cafe wifi is unaffected by the first one's retrying.
    expect(press("second@shop.test")).toBe("accepted");
    expect(queued).toHaveLength(1);
  });
});

describe("the shared-egress bound", () => {
  it("lets sixty distinct addresses through one egress address in an hour, and stops the next", () => {
    for (let i = 0; i < 60; i++) press(`merchant-${i}@shop.test`);
    expect(queued).toHaveLength(60);
    expect(press("merchant-60@shop.test")).toBe("accepted");
    expect(queued).toHaveLength(60); // bounded — this is the anti-enumeration half
  });

  it("keeps one caller's spending off another caller's budget", () => {
    for (let i = 0; i < 6; i++) press("owner@shop.test", "203.0.113.10");
    queued.length = 0;
    expect(press("owner@shop.test", "198.51.100.7")).toBe("accepted");
    expect(queued).toHaveLength(1);
  });

  it("falls back to x-real-ip, and shares one bucket when a request carries neither", () => {
    expect(
      acceptMagicLinkRequest({
        email: "owner@shop.test",
        callbackURL: "/",
        requestHeaders: new Headers({ "x-real-ip": "192.0.2.5" }),
      }),
    ).toBe("accepted");
    expect(
      acceptMagicLinkRequest({
        email: "owner@shop.test",
        callbackURL: "/",
        requestHeaders: new Headers(),
      }),
    ).toBe("accepted");
    expect(queued).toHaveLength(2); // different buckets, both under budget
  });
});

describe("what the caller is allowed to learn", () => {
  it("answers a throttled press exactly like an accepted one", () => {
    const answers = Array.from({ length: 8 }, () => press("owner@shop.test"));
    expect(new Set(answers)).toEqual(new Set(["accepted"]));
    expect(queued).toHaveLength(5);
  });

  it("refuses a malformed address before it touches a budget at all", () => {
    expect(press("not-an-email")).toBe("invalid_email");
    expect(queued).toHaveLength(0);
    // The malformed press did not spend anything: five real ones still get through.
    for (let i = 0; i < 5; i++) press("owner@shop.test");
    expect(queued).toHaveLength(5);
  });

  it("hands the background a normalised address and a same-origin callback only", () => {
    press("  Owner@Shop.Test ", "203.0.113.10", "//evil.example.com");
    expect(queued).toEqual([
      { purpose: "sign-in-link", email: "owner@shop.test", callbackURL: "/" },
    ]);
  });
});
