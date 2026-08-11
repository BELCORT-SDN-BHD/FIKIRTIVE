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
 *   · and its own bookkeeping cannot be turned into a weapon.
 *
 * #795 — WHAT MOVED, AND WHAT THIS FILE NOW OWNS.
 *
 * The buckets were a `Map` in this process, which made the published cap a fiction as soon as a
 * second instance existed (two maps, twice the budget) and reset it on every deploy. They are
 * rows in Postgres now, and this file runs against the REAL counter — no double, no stub — so
 * every case below is the door's behaviour end to end.
 *
 * The cases that went away with the map are the ones that were ABOUT the map: its LRU ceiling,
 * its hourly sweep, and the exact ring/sink layout of one bucket. Their properties did not
 * disappear, they changed owner — `packages/db/src/rate-limit.test.ts` asserts, against the same
 * real database, that a refusal charges nothing, that a refused request charges no bucket at all,
 * that both verdicts write, and that expired rows are pruned.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const queued: Array<Record<string, unknown>> = [];

vi.mock("@/lib/better-auth/sender", () => ({
  enqueueAuthEmail: (job: Record<string, unknown>) => {
    queued.push(job);
  },
}));

const { acceptMagicLinkRequest, __resetMagicLinkThrottleForTests, MAX_PER_CALLER, MAX_PER_CALLER_PER_ADDRESS } =
  await import("@/lib/better-auth/magic-link-request");

/** The throttle's window. Not exported from the module — a test that wants to step over it has
 *  to name it, and naming it here keeps the cases readable. */
const HOUR = 60 * 60 * 1000;

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });
const press = (email: string, ip = "203.0.113.10", callbackURL = "/") =>
  acceptMagicLinkRequest({ email, callbackURL, requestHeaders: from(ip) });
/** Jobs the background will actually act on — the rest are handed over and dropped there. */
const deliverable = () => queued.filter((j) => j.overBudget === false);

beforeEach(async () => {
  queued.length = 0;
  await __resetMagicLinkThrottleForTests();
});

describe("the caller-and-address budget", () => {
  it("marks five presses for one address deliverable, and the rest over budget", async () => {
    for (let i = 0; i < 6; i++) expect(await press("owner@shop.test")).toBe("accepted");
    expect(deliverable()).toHaveLength(MAX_PER_CALLER_PER_ADDRESS);
  });

  it("gives every case and whitespace variant of one address the SAME budget", async () => {
    const variants = [
      "owner@shop.test",
      "OWNER@shop.test",
      "owner@SHOP.test",
      "Owner@Shop.Test",
      "  owner@shop.test  ",
      "OWNER@SHOP.TEST",
    ];
    for (const email of variants) expect(await press(email)).toBe("accepted");
    // RED without normalisation: six keys, six deliverable jobs.
    expect(deliverable()).toHaveLength(5);
    expect(new Set(queued.map((j) => j.email))).toEqual(new Set(["owner@shop.test"]));
  });

  it("does not let one exhausted address lock the same caller out of another", async () => {
    for (let i = 0; i < 6; i++) await press("first@shop.test");
    queued.length = 0;
    // The second merchant on the same cafe wifi is unaffected by the first one's retrying.
    expect(await press("second@shop.test")).toBe("accepted");
    expect(deliverable()).toHaveLength(1);
  });
});

describe("the shared-egress bound", () => {
  it("lets sixty distinct addresses through one egress address in an hour, and stops the next", async () => {
    for (let i = 0; i < MAX_PER_CALLER; i++) await press(`merchant-${i}@shop.test`);
    expect(deliverable()).toHaveLength(MAX_PER_CALLER);
    expect(await press("merchant-60@shop.test")).toBe("accepted");
    expect(deliverable()).toHaveLength(MAX_PER_CALLER); // bounded — this is the anti-enumeration half
  });

  it("keeps one caller's spending off another caller's budget", async () => {
    for (let i = 0; i < 6; i++) await press("owner@shop.test", "203.0.113.10");
    queued.length = 0;
    expect(await press("owner@shop.test", "198.51.100.7")).toBe("accepted");
    expect(deliverable()).toHaveLength(1);
  });

  it("puts every unidentifiable caller in ONE bucket — never a fresh budget each (#795 r3)", async () => {
    // WHICH header is trusted is a property of the deployment (`CALLER_IP_SOURCE`, see
    // caller-identity.ts) and is asserted shape by shape in caller-identity.test.ts. What this
    // case asserts is the part that must hold in EVERY shape: a request the shape cannot
    // identify shares one bucket with every other such request, and that shared budget really
    // does run out. An unidentifiable caller must never be handed a PRIVATE budget — that is
    // what a per-request fallback would do, and it would make the cap decorative.
    const unidentifiable = () =>
      acceptMagicLinkRequest({ email: "owner@shop.test", callbackURL: "/", requestHeaders: new Headers() });

    for (let i = 0; i < MAX_PER_CALLER_PER_ADDRESS; i++) expect(await unidentifiable()).toBe("accepted");
    expect(deliverable()).toHaveLength(MAX_PER_CALLER_PER_ADDRESS);

    // A second unidentifiable request does NOT get its own five — same bucket, already spent.
    queued.length = 0;
    await unidentifiable();
    expect(deliverable()).toHaveLength(0);
  });
});

// ── r4 P1-1: refusing costs exactly what accepting costs ─────────────────────────────────────
describe("#678 r4 — an over-budget request does the SAME work as one inside its budget", () => {
  it("hands over a job every single time, in the same shape", async () => {
    // RED before r4: the enqueue was inside `if (roomForCaller && roomForPair)`, so an
    // over-budget press skipped the sanitise, the job construction, the push and the timer —
    // strictly less work, same answer, and therefore a clock again.
    const answers: string[] = [];
    for (let i = 0; i < 8; i++) answers.push(await press("owner@shop.test", "203.0.113.99", "/x"));

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

  /**
   * #757 — WHAT A REFUSAL MUST NOT DO: extend the window it was refused by.
   *
   * The ring used to slide on REQUESTS, so the sixth press of the hour overwrote the oldest of
   * the five grants with its own time. The cap then read "five in the last hour" for as long as
   * anyone kept pressing — a caller was refused until an hour after they STOPPED, not an hour
   * after their fifth link.
   *
   * That is a lockout with no end and no explanation, and the shape of the key makes it somebody
   * else's lockout: a cafe, a co-working floor and most mobile networks share one egress address,
   * so the loose sixty-per-caller bucket belongs to every merchant on that wifi at once. One
   * person's retry loop kept it renewed indefinitely, and none of the others could tell why their
   * sign-in link stopped arriving.
   *
   * The rate the cap enforces is unchanged — five per address and sixty per egress per rolling
   * hour, granted. What changes is that the hour is now measured from the GRANTS, so it actually
   * ends. (A patient prober always had the sustained rate anyway: pause for an hour, resume. All
   * the old behaviour bought was punishing the impatient by starving their neighbours.)
   */
  describe("#757 — a refused press does not renew the window", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives one address its next link an hour after the fifth GRANT, not an hour after the last try", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = new Date("2026-08-09T00:00:00Z");
      vi.setSystemTime(start);
      const ip = "203.0.113.130";

      for (let i = 0; i < 5; i++) await press("owner@shop.test", ip);
      expect(deliverable()).toHaveLength(5);

      // The merchant keeps pressing every ten minutes for the rest of the hour — the ordinary
      // behaviour of somebody whose link has not arrived. Every one of these is refused.
      for (let minute = 10; minute <= 50; minute += 10) {
        vi.setSystemTime(new Date(start.getTime() + minute * 60_000));
        await press("owner@shop.test", ip);
      }
      expect(deliverable()).toHaveLength(5);

      // One hour and a moment after the FIRST grant, a slot is genuinely free again.
      vi.setSystemTime(new Date(start.getTime() + HOUR + 1));
      await press("owner@shop.test", ip);
      // RED before #757: the refusals had overwritten the ring, so its oldest entry was 10
      // minutes old and this press was refused too — and would be, forever, while they kept
      // trying.
      expect(deliverable()).toHaveLength(6);
    });

    /**
     * r2 — THE COMBINATION STATE.
     *
     * Each bucket used to decide and write on its OWN verdict, so a press could be refused as a
     * REQUEST while still counting as a grant in one of the two buckets. The sixth press for one
     * address is exactly that shape: the address bucket is full but the shared caller bucket
     * still has room, so the request is refused — no link sent — and a fresh grant lands in the
     * shared bucket anyway.
     *
     * Which rebuilds the very defect this ticket exists to remove, one bucket over: one merchant
     * retrying one address walks the shared sixty-slot budget round and round, and everybody else
     * behind that egress address stops receiving sign-in links. Nothing they can see explains it,
     * and the retrying merchant is not doing anything abusive — they are pressing a button that
     * told them a link was on its way.
     *
     * So the two buckets must be decided TOGETHER and written TOGETHER: nothing is charged unless
     * the request as a whole was granted.
     */
    it("does not let one address's refused retries eat the shared egress budget", async () => {
      const cafe = "198.51.100.55";
      // One merchant spends their five, then keeps pressing — far more times than the shared
      // budget has room for, so if refusals charged it at all it would be full several times over.
      for (let i = 0; i < 5; i++) await press("victim@shop.test", cafe);
      for (let i = 0; i < 100; i++) await press("victim@shop.test", cafe);
      queued.length = 0;

      // The merchant at the next table, who has never pressed anything.
      expect(await press("neighbour@shop.test", cafe)).toBe("accepted");
      // RED before r2: the 100 refused retries had spent the shared budget, so the neighbour was
      // silently over budget — accepted words, no link.
      expect(deliverable()).toHaveLength(1);
    }, 60_000);

    it("charges neither bucket when the SHARED egress is the one that refuses", async () => {
      // The mirror image, so the rule is "a refused request charges nothing" rather than a patch
      // aimed at one of the two orders. A brand-new address behind a spent egress must not have
      // its own five quietly docked for a request that was never granted.
      const cafe = "198.51.100.66";
      for (let i = 0; i < MAX_PER_CALLER; i++) await press(`merchant-${i}@shop.test`, cafe);

      await press("late@shop.test", cafe); // caller bucket full, address bucket brand new
      queued.length = 0;

      // An hour later the shared budget is free again — and the late address must still have all
      // five of its own. RED before r2: its first slot had been charged for a link never sent.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + HOUR + 1));
      for (let i = 0; i < 5; i++) await press("late@shop.test", cafe);
      expect(deliverable()).toHaveLength(5);
    }, 60_000);

    it("lets the rest of a shared wifi back in an hour after the flooder's last GRANT", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = new Date("2026-08-09T00:00:00Z");
      vi.setSystemTime(start);
      const cafe = "198.51.100.44";

      // One person on the cafe wifi burns the whole shared budget…
      for (let i = 0; i < MAX_PER_CALLER; i++) await press(`probe-${i}@shop.test`, cafe);
      expect(deliverable()).toHaveLength(MAX_PER_CALLER);
      // …and then keeps pressing for the rest of the hour, well past the point where a
      // refusal-charging window would have renewed itself.
      for (let minute = 1; minute < 60; minute += 1) {
        vi.setSystemTime(new Date(start.getTime() + minute * 60_000));
        await press(`probe-late-${minute}@shop.test`, cafe);
      }
      queued.length = 0;

      // An hour after the sixtieth grant, the merchant at the next table presses their own
      // button for the first time.
      vi.setSystemTime(new Date(start.getTime() + HOUR + 1));
      expect(await press("neighbour@shop.test", cafe)).toBe("accepted");
      // RED before #757: the flooder's refusals kept the shared budget full, so the neighbour was
      // silently refused for as long as the flooder kept going.
      expect(deliverable()).toHaveLength(1);
    }, 60_000);
  });

  it("sanitises the callback on the over-budget path too", async () => {
    for (let i = 0; i < 5; i++) await press("owner@shop.test", "203.0.113.98", "/ok");
    queued.length = 0;
    await press("owner@shop.test", "203.0.113.98", "//evil.example.com");
    expect(queued).toEqual([
      { purpose: "sign-in-link", email: "owner@shop.test", callbackURL: "/", overBudget: true },
    ]);
  });
});

describe("what the caller is allowed to learn", () => {
  it("answers a throttled press exactly like an accepted one", async () => {
    const answers: string[] = [];
    for (let i = 0; i < 8; i++) answers.push(await press("owner@shop.test"));
    expect(new Set(answers)).toEqual(new Set(["accepted"]));
    expect(deliverable()).toHaveLength(5);
  });

  it("refuses a malformed address before it touches a budget at all", async () => {
    expect(await press("not-an-email")).toBe("invalid_email");
    expect(queued).toHaveLength(0);
    // The malformed press did not spend anything: five real ones still get through.
    for (let i = 0; i < 5; i++) await press("owner@shop.test");
    expect(deliverable()).toHaveLength(5);
  });

  it("hands the background a normalised address and a same-origin callback only", async () => {
    await press("  Owner@Shop.Test ", "203.0.113.10", "//evil.example.com");
    expect(queued).toEqual([
      { purpose: "sign-in-link", email: "owner@shop.test", callbackURL: "/", overBudget: false },
    ]);
  });
});

// ── #795: the counter is shared, and that is the whole point ─────────────────────────────────
describe("#795 — the budget is one budget, not one per process", () => {
  it("keeps counting across a fresh import of the module", async () => {
    const ip = "203.0.113.180";
    for (let i = 0; i < 5; i++) await press("shared@shop.test", ip);
    expect(deliverable()).toHaveLength(5);

    // A SECOND module instance stands in for a second web instance: same code, same database,
    // its own module-level state. RED before #795, when the buckets were a Map: this import got
    // an empty map and handed the same address five more deliverable links.
    vi.resetModules();
    const second = await import("@/lib/better-auth/magic-link-request");
    queued.length = 0;
    expect(
      await second.acceptMagicLinkRequest({
        email: "shared@shop.test",
        callbackURL: "/",
        requestHeaders: from(ip),
      }),
    ).toBe("accepted");
    expect(deliverable()).toHaveLength(0);
    vi.resetModules();
  });

  // WHERE FAIL-CLOSED IS ASSERTED: `packages/db/src/rate-limit.test.ts` takes the counter table
  // away underneath a live call and checks the verdict is a refusal. The door's half of that
  // contract — a refusal is handed over as an over-budget job and answered identically — is the
  // "hands over a job every single time" case above; the two together are the claim that a
  // database outage cannot be used to remove every cap at once.
});
