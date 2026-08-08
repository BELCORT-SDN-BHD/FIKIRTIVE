/**
 * #678 — the throttle that sits on the door the product actually uses.
 *
 * An earlier round put a per-IP rule in Better Auth's `rateLimit` config. Those rules only run
 * inside `auth.handler`, and the login page calls a server action, so the rule guarded a door
 * nobody used while the real one had no cap at all. This is the replacement, in our own layer.
 *
 * It has to hold three properties at once, and the first two pull against each other:
 *   · it bounds an anonymous caller,
 *   · it says nothing about the address — INCLUDING through how much work it does when it
 *     refuses (r4: skipping the hand-over for an over-budget request was itself a timing
 *     difference, the same defect rebuilt inside its own fix),
 *   · and its own bookkeeping cannot be turned into a weapon: an attacker picks the keys, so the
 *     map must be bounded, and nothing may traverse it on the request thread.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const queued: Array<Record<string, unknown>> = [];

vi.mock("@/lib/better-auth/sender", () => ({
  enqueueAuthEmail: (job: Record<string, unknown>) => {
    queued.push(job);
  },
}));

const {
  acceptMagicLinkRequest,
  __resetMagicLinkThrottleForTests,
  __sweepMagicLinkThrottleForTests,
  __magicLinkThrottleSizeForTests,
  MAX_TRACKED_BUCKETS,
} = await import("@/lib/better-auth/magic-link-request");

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });
const press = (email: string, ip = "203.0.113.10", callbackURL = "/") =>
  acceptMagicLinkRequest({ email, callbackURL, requestHeaders: from(ip) });
/** Jobs the background will actually act on — the rest are handed over and dropped there. */
const deliverable = () => queued.filter((j) => j.overBudget === false);

beforeEach(() => {
  queued.length = 0;
  __resetMagicLinkThrottleForTests();
});

describe("the caller-and-address budget", () => {
  it("marks five presses for one address deliverable, and the rest over budget", () => {
    for (let i = 0; i < 6; i++) expect(press("owner@shop.test")).toBe("accepted");
    expect(deliverable()).toHaveLength(5);
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
    // RED without normalisation: six keys, six deliverable jobs.
    expect(deliverable()).toHaveLength(5);
    expect(new Set(queued.map((j) => j.email))).toEqual(new Set(["owner@shop.test"]));
  });

  it("does not let one exhausted address lock the same caller out of another", () => {
    for (let i = 0; i < 6; i++) press("first@shop.test");
    queued.length = 0;
    // The second merchant on the same cafe wifi is unaffected by the first one's retrying.
    expect(press("second@shop.test")).toBe("accepted");
    expect(deliverable()).toHaveLength(1);
  });
});

describe("the shared-egress bound", () => {
  it("lets sixty distinct addresses through one egress address in an hour, and stops the next", () => {
    for (let i = 0; i < 60; i++) press(`merchant-${i}@shop.test`);
    expect(deliverable()).toHaveLength(60);
    expect(press("merchant-60@shop.test")).toBe("accepted");
    expect(deliverable()).toHaveLength(60); // bounded — this is the anti-enumeration half
  });

  it("keeps one caller's spending off another caller's budget", () => {
    for (let i = 0; i < 6; i++) press("owner@shop.test", "203.0.113.10");
    queued.length = 0;
    expect(press("owner@shop.test", "198.51.100.7")).toBe("accepted");
    expect(deliverable()).toHaveLength(1);
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
    expect(deliverable()).toHaveLength(2); // different buckets, both under budget
  });
});

// ── r4 P1-1: refusing costs exactly what accepting costs ─────────────────────────────────────
describe("#678 r4 — an over-budget request does the SAME work as one inside its budget", () => {
  it("hands over a job every single time, in the same shape", () => {
    // RED before r4: the enqueue was inside `if (roomForCaller && roomForPair)`, so an
    // over-budget press skipped the sanitise, the job construction, the push and the timer —
    // strictly less work, same answer, and therefore a clock again.
    const answers = Array.from({ length: 8 }, () => press("owner@shop.test", "203.0.113.99", "/x"));

    expect(new Set(answers)).toEqual(new Set(["accepted"]));
    expect(queued).toHaveLength(8);
    // Every job is fully formed — the callback really was sanitised on the way past, not only
    // for the ones that will be delivered.
    for (const job of queued) {
      expect(job.purpose).toBe("sign-in-link");
      expect(job.email).toBe("owner@shop.test");
      expect(job.callbackURL).toBe("/x");
    }
    // The only thing that differs is the verdict riding along, which no caller can read.
    expect(queued.map((j) => j.overBudget)).toEqual([
      false, false, false, false, false, true, true, true,
    ]);
  });

  it("sanitises the callback on the over-budget path too", () => {
    for (let i = 0; i < 5; i++) press("owner@shop.test", "203.0.113.98", "/ok");
    queued.length = 0;
    press("owner@shop.test", "203.0.113.98", "//evil.example.com");
    expect(queued).toEqual([
      { purpose: "sign-in-link", email: "owner@shop.test", callbackURL: "/", overBudget: true },
    ]);
  });
});

// ── r4 P1-3: the bookkeeping itself cannot be turned into a weapon ───────────────────────────
describe("#678 r4 — the bucket map is bounded and never walked on the request thread", () => {
  it("never grows past its ceiling, however many addresses one caller invents", () => {
    // One caller, past its own budget after 60, inventing a fresh address every time — so every
    // press mints a brand-new `caller|address` key. RED before r4: one entry per press, forever.
    const presses = MAX_TRACKED_BUCKETS + 5_000;
    for (let i = 0; i < presses; i++) press(`victim-${i}@shop.test`, "203.0.113.200");
    expect(__magicLinkThrottleSizeForTests()).toBeLessThanOrEqual(MAX_TRACKED_BUCKETS);
    // …and it is genuinely full rather than accidentally empty.
    expect(__magicLinkThrottleSizeForTests()).toBe(MAX_TRACKED_BUCKETS);
  });

  it("leaves expired buckets alone on the request thread, and drops them on the sweep", () => {
    // Only the calendar is faked. Faking the timer wheel too would also stop the module's own
    // hourly sweep timer, which would make the "nothing swept it" half of this case true for
    // the wrong reason.
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-08-08T00:00:00Z");
    vi.setSystemTime(start);

    // 50 callers × 1 address = 100 buckets.
    for (let i = 0; i < 50; i++) press("owner@shop.test", `198.51.100.${i}`);
    expect(__magicLinkThrottleSizeForTests()).toBe(100);

    // Two hours later every one of those timestamps has aged out.
    vi.setSystemTime(new Date(start.getTime() + 2 * 60 * 60 * 1000));
    press("owner@shop.test", "203.0.113.77");

    // RED before r4: `acceptMagicLinkRequest` began with a full traversal, so this one press
    // walked and pruned all 100 entries — an event-loop stall an attacker could aim, sized by a
    // map the attacker also filled. It must now cost the same as any other press.
    expect(__magicLinkThrottleSizeForTests()).toBe(102);

    // The pruning still happens — on its own timer, off the request thread.
    __sweepMagicLinkThrottleForTests(Date.now());
    expect(__magicLinkThrottleSizeForTests()).toBe(2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("what the caller is allowed to learn", () => {
  it("answers a throttled press exactly like an accepted one", () => {
    const answers = Array.from({ length: 8 }, () => press("owner@shop.test"));
    expect(new Set(answers)).toEqual(new Set(["accepted"]));
    expect(deliverable()).toHaveLength(5);
  });

  it("refuses a malformed address before it touches a budget at all", () => {
    expect(press("not-an-email")).toBe("invalid_email");
    expect(queued).toHaveLength(0);
    // The malformed press did not spend anything: five real ones still get through.
    for (let i = 0; i < 5; i++) press("owner@shop.test");
    expect(deliverable()).toHaveLength(5);
  });

  it("hands the background a normalised address and a same-origin callback only", () => {
    press("  Owner@Shop.Test ", "203.0.113.10", "//evil.example.com");
    expect(queued).toEqual([
      { purpose: "sign-in-link", email: "owner@shop.test", callbackURL: "/", overBudget: false },
    ]);
  });
});
