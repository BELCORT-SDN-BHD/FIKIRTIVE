/**
 * #678 r3 — the sign-in request path performs the SAME WORK for every address.
 *
 * Three rounds, three leaks, one root. Round 1 made the two answers read alike, so the CLOCK gave
 * it away. Round 2 moved delivery to the background, so the background job's SYNCHRONOUS PREFIX
 * gave it away: an address on FOUNDER_ADMIN_EMAILS or AUTH_ALLOWED_EMAILS resolved out of a string
 * list without ever suspending, so the budget check and the send were dispatched before the
 * response was built, while an address that had to be looked up in the database stopped at the
 * query. Same words, different amount of work.
 *
 * So this file stops testing outcomes and tests the SHAPE. The central case (①) records every
 * await and every database call the server action makes, for three addresses chosen to be as
 * different as the system allows — one on an environment list (answerable with no I/O at all),
 * one in the database allowlist (one query, a hit), one nobody has ever heard of (one query, a
 * miss) — and demands the recorded sequences be identical item for item. A request that cannot
 * be told apart cannot be timed apart.
 *
 * Real Better Auth, real database, real queue throughout; only the mail transport is a mock. A
 * mocked endpoint could not fail these.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

// ── the trace ────────────────────────────────────────────────────────────────────────────────
// Every awaited step and every database call we can observe, in the order it was reached. The
// wrappers below all delegate to the REAL implementation — this records, it does not replace.
const trace: string[] = [];

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@fikirtive/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fikirtive/db")>();
  return {
    ...actual,
    // Records at DISPATCH time (Prisma promises are lazy), which is exactly when the request
    // would start paying for the query.
    prisma: actual.prisma.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            trace.push(`db:${model}.${operation}`);
            return query(args);
          },
        },
      },
    }),
  };
});

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailPort: {
      send: (...args: unknown[]) => {
        trace.push("email-send");
        return mockSend(...args);
      },
    },
  };
});

vi.mock("@/lib/allowlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/allowlist")>();
  return {
    ...actual,
    isAllowedEmail: async (email: string | null | undefined) => {
      trace.push("allowlist-lookup");
      return actual.isAllowedEmail(email);
    },
  };
});

vi.mock("@/lib/better-auth/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/better-auth/sender")>();
  return {
    ...actual,
    enqueueAuthEmail: (job: Parameters<typeof actual.enqueueAuthEmail>[0]) => {
      trace.push("enqueue");
      return actual.enqueueAuthEmail(job);
    },
  };
});

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => {
    trace.push("headers");
    return mockHeaders();
  },
}));

// The three address kinds, chosen so the access question costs as differently as it can.
const ENV_ALLOWED = `p678-env-${randomUUID()}@fikirtive.test`;   // answered from a string list
const DB_ALLOWED = `p678-db-${randomUUID()}@fikirtive.test`;     // one query, a hit
const UNKNOWN = `p678-unknown-${randomUUID()}@fikirtive.test`;   // one query, a miss

// The password door needs a REAL account with a REAL credential (see ⑤).
const PASSWORD_ACCOUNT = `p678-pw-${randomUUID()}@fikirtive.test`;
const PASSWORD_UNKNOWN = `p678-pw-stranger-${randomUUID()}@fikirtive.test`;
// A real account with a real credential that is on NO list — the fail-closed gate's subject.
const PASSWORD_UNLISTED = `p678-pw-unlisted-${randomUUID()}@fikirtive.test`;
const REAL_PASSWORD = "the-actual-password-9f2a";
const WRONG_PASSWORD = "not-the-password";

// Set BEFORE the dynamic imports below, not in a hook: better-auth reads these at construction,
// and the imports are evaluated while the module loads — long before beforeAll runs.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.AUTH_ALLOWED_EMAILS = `${ENV_ALLOWED},${PASSWORD_ACCOUNT}`;
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

/** The credential accounts ⑤ creates; declared here so afterAll can clean them up. */
const createdUserIds: string[] = [];

const { prisma } = await import("@fikirtive/db");
const { auth } = await import("@/lib/better-auth/server");
const { authEmailQueueSettled, __resetAuthEmailCapsForTests } = await import(
  "@/lib/better-auth/sender"
);
const { __resetMagicLinkThrottleForTests } = await import("@/lib/better-auth/magic-link-request");
const { requestMagicLink } = await import("@/app/login/actions");
const { POST: betterAuthPost } = await import("@/app/api/better-auth/[...all]/route");

const NEUTRAL = {
  status: "success",
  message: "If this email has access, a sign-in link is on its way — check your inbox.",
};

const CALLER = new Headers({ origin: "http://localhost:3100", "x-forwarded-for": "203.0.113.10" });

/** Rows minted for one address. The token lives in `identifier`; the ADDRESS lives in `value`
 *  (magic-link/index.mjs stores `JSON.stringify({email, name})` there), which is why an earlier
 *  version of this file matched on the wrong column and never cleaned anything up. */
const rowsFor = (email: string) =>
  prisma.betterAuthVerification.count({ where: { value: { contains: email } } });

beforeAll(async () => {
  await prisma.allowedEmail.upsert({
    where: { email: DB_ALLOWED },
    create: { email: DB_ALLOWED, status: "active", invitedBy: "p678-test@fikirtive.test" },
    update: { status: "active" },
  });
});

beforeEach(() => {
  trace.length = 0;
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
  mockHeaders.mockReset();
  mockHeaders.mockReturnValue(CALLER);
  // Both budgets are process memory with an hour-long window. Reset them so each case starts
  // from a known state — this file is about the SHAPE of the path, and the two files that own
  // the budgets (better-auth-sender / magic-link-throttle) test them without any reset.
  __resetMagicLinkThrottleForTests();
  __resetAuthEmailCapsForTests();
});

// ── ① the request path is blind to what kind of address it was handed ────────────────────────
describe("#678 r3 ① — the request performs identical work for every kind of address", () => {
  it("records the same awaits and the same database calls for all three", async () => {
    const walk = async (email: string) => {
      trace.length = 0;
      const answer = await requestMagicLink({ email, callbackURL: "/" });
      const recorded = [...trace]; // snapshot AT THE MOMENT the merchant has their answer
      await authEmailQueueSettled(); // let the background finish before the next address starts
      return { answer, recorded };
    };

    const env = await walk(ENV_ALLOWED);
    const db = await walk(DB_ALLOWED);
    const unknown = await walk(UNKNOWN);

    // The central claim. Item for item, in order.
    expect(db.recorded).toEqual(env.recorded);
    expect(unknown.recorded).toEqual(env.recorded);

    // And what that sequence IS: read the caller, hand over an opaque job. No allowlist lookup,
    // no database call, no send — none of the work whose cost depends on the answer.
    expect(env.recorded).toEqual(["headers", "enqueue"]);

    // The answers are the same too, which was round 1's claim and is still required.
    expect(env.answer).toEqual(NEUTRAL);
    expect(db.answer).toEqual(NEUTRAL);
    expect(unknown.answer).toEqual(NEUTRAL);
  });

  it("still delivers to exactly the two addresses that have access, silently", async () => {
    for (const email of [ENV_ALLOWED, DB_ALLOWED, UNKNOWN]) {
      await requestMagicLink({ email, callbackURL: "/" });
      await authEmailQueueSettled();
    }
    const written = mockSend.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(written).toEqual([DB_ALLOWED, ENV_ALLOWED].sort());
  });
});

// ── ② an address without access never causes a verification row ──────────────────────────────
describe("#678 r3 ② — anonymous requests do not grow the verification table", () => {
  it("writes nothing for ten unknown addresses, and exactly one for an address with access", async () => {
    const before = await prisma.betterAuthVerification.count();
    const strangers = Array.from({ length: 10 }, () => `p678-swarm-${randomUUID()}@fikirtive.test`);
    for (const email of strangers) await requestMagicLink({ email, callbackURL: "/" });
    await authEmailQueueSettled();

    // The token is minted AFTER the access check now, so an address nobody invited never
    // reaches Better Auth at all.
    expect(await prisma.betterAuthVerification.count()).toBe(before);
    for (const email of strangers) expect(await rowsFor(email)).toBe(0);

    // Control: a press from an address that DOES have access mints one, so the zero above is
    // the gate working and not the door being nailed shut.
    const controlBefore = await rowsFor(ENV_ALLOWED);
    await requestMagicLink({ email: ENV_ALLOWED, callbackURL: "/" });
    await authEmailQueueSettled();
    expect((await rowsFor(ENV_ALLOWED)) - controlBefore).toBe(1);
  });
});

// ── ③ the response does not wait on delivery ─────────────────────────────────────────────────
describe("#678 r3 ③ — the request answers while the email is still in flight", () => {
  it("resolves with the neutral success before emailPort.send has settled", async () => {
    let release!: () => void;
    const sendStarted = new Promise<void>((resolveStarted) => {
      mockSend.mockImplementation(
        () =>
          new Promise<void>((resolveSend) => {
            resolveStarted();
            release = () => resolveSend();
          }),
      );
    });

    const result = await requestMagicLink({ email: ENV_ALLOWED, callbackURL: "/" });
    expect(result).toEqual(NEUTRAL);
    // Nothing about the job had even STARTED at that point — the queue drains on a macrotask.
    expect(trace).toEqual(["headers", "enqueue"]);

    await sendStarted;
    let settled = false;
    void authEmailQueueSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await authEmailQueueSettled();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ── ④ a broken mail provider changes nothing the merchant can see ────────────────────────────
describe("#678 r3 ④ — a 429/5xx from the shared mail provider is an operator signal only", () => {
  it.each([
    ["429 (shared provider under pressure)", "retryable"],
    ["5xx (provider outage)", "retryable"],
    ["a non-retryable rejection", "non_retryable"],
  ])("%s → the merchant still gets the one neutral answer", async (_case, kind) => {
    const { EmailSendError } = await import("@/lib/email");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValue(new EmailSendError("provider detail", kind as "retryable"));

    const known = await requestMagicLink({ email: ENV_ALLOWED, callbackURL: "/" });
    const stranger = await requestMagicLink({ email: UNKNOWN, callbackURL: "/" });
    expect(known).toEqual(NEUTRAL);
    expect(known).toEqual(stranger);

    await authEmailQueueSettled();

    const lines = log.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email delivery failed"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(ENV_ALLOWED);
      expect(line).not.toContain(UNKNOWN);
    }
    log.mockRestore();
  });
});

// ── the HTTP door is the same door ───────────────────────────────────────────────────────────
describe("#678 r3 — Better Auth's own endpoint answers every address identically too", () => {
  const post = (email: string) =>
    betterAuthPost(
      new Request("http://localhost:3100/api/better-auth/sign-in/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100",
          "x-forwarded-for": "198.51.100.7",
        },
        body: JSON.stringify({ email, callbackURL: "/" }),
      }),
    );

  it("same status, same body, and the same work for an address with access and one without", async () => {
    trace.length = 0;
    const known = await post(ENV_ALLOWED);
    const knownTrace = [...trace];
    await authEmailQueueSettled();

    trace.length = 0;
    const stranger = await post(UNKNOWN);
    const strangerTrace = [...trace];
    await authEmailQueueSettled();

    expect(known.status).toBe(200);
    expect(stranger.status).toBe(known.status);
    expect(await stranger.json()).toEqual(await known.json());
    // The endpoint takes the same four steps the login page does — no `headers()` here, because
    // the caller's headers arrived on the Request itself.
    expect(strangerTrace).toEqual(knownTrace);
    expect(knownTrace).toEqual(["enqueue"]);
  });
});

// ── ⑤ the password door compares a REAL account against an unknown one ───────────────────────
describe("#678 r3 ⑤ — a real account with a wrong password and an unknown address answer alike", () => {
  beforeAll(async () => {
    // Genuine BetterAuthUsers with genuine credential accounts. The previous version of this
    // file only put the address on an environment list, so BOTH sides of the comparison were
    // unknown users taking Better Auth's dummy-hash branch — the case that actually matters
    // ("real account, wrong password" → password.verify) was never exercised.
    const ctx = await auth.$context;
    for (const email of [PASSWORD_ACCOUNT, PASSWORD_UNLISTED]) {
      const id = randomUUID();
      createdUserIds.push(id);
      await prisma.betterAuthUser.create({
        data: { id, name: "Password Door", email, emailVerified: true },
      });
      await prisma.betterAuthAccount.create({
        data: {
          id: randomUUID(),
          accountId: id,
          providerId: "credential",
          userId: id,
          password: await ctx.password.hash(REAL_PASSWORD),
        },
      });
    }
  });

  const refusal = (email: string, password: string) =>
    auth.api
      .signInEmail({
        body: { email, password },
        headers: new Headers({ origin: "http://localhost:3100" }),
      })
      .then(() => "unexpected-success")
      .catch((e: { status?: string; body?: { code?: string; message?: string } }) =>
        JSON.stringify({ status: e.status, code: e.body?.code, message: e.body?.message }),
      );

  it("takes verify for the real account and hash for the unknown one — and answers the same", async () => {
    const ctx = await auth.$context;
    const hash = vi.spyOn(ctx.password, "hash");
    const verify = vi.spyOn(ctx.password, "verify");

    const real = await refusal(PASSWORD_ACCOUNT, WRONG_PASSWORD);
    expect(verify).toHaveBeenCalledTimes(1); // a stored hash existed, so it was compared
    expect(hash).not.toHaveBeenCalled();

    verify.mockClear();
    hash.mockClear();
    const stranger = await refusal(PASSWORD_UNKNOWN, WRONG_PASSWORD);
    // Better Auth hashes the submitted password when it finds no user, precisely so the missing
    // case costs what the wrong-password case costs. Our own before-hook used to skip that.
    expect(hash).toHaveBeenCalledTimes(1);
    expect(hash).toHaveBeenCalledWith(WRONG_PASSWORD);
    expect(verify).not.toHaveBeenCalled();

    expect(real).toBe(stranger);
    expect(real).toContain("INVALID_EMAIL_OR_PASSWORD");

    hash.mockRestore();
    verify.mockRestore();
  });

  it("refuses a session for a real credential that is on no list, even with the RIGHT password", async () => {
    // The gate the ticket must not loosen. PASSWORD_UNLISTED is a real account with a real,
    // correct password — the door Better Auth would happily open — and it is on no allowlist.
    // databaseHooks.session.create.before (assertAllowedForUserId) is what stops it, and it is
    // still fail-closed after everything this round moved.
    const outcome = await auth.api
      .signInEmail({
        body: { email: PASSWORD_UNLISTED, password: REAL_PASSWORD },
        headers: new Headers({ origin: "http://localhost:3100" }),
      })
      .then((r) => (r && "token" in r ? "session-issued" : "no-session"))
      .catch(() => "refused");
    expect(outcome).toBe("refused");
    expect(await prisma.betterAuthSession.count({ where: { userId: { in: createdUserIds } } })).toBe(0);
  });
});

afterAll(async () => {
  await authEmailQueueSettled();
  const addresses = [
    ENV_ALLOWED,
    DB_ALLOWED,
    UNKNOWN,
    PASSWORD_ACCOUNT,
    PASSWORD_UNKNOWN,
    PASSWORD_UNLISTED,
  ];
  try {
    // The address lives in `value`, not in `identifier` (which is the random token).
    await prisma.betterAuthVerification.deleteMany({
      where: { OR: addresses.map((email) => ({ value: { contains: email } })) },
    });
    await prisma.betterAuthVerification.deleteMany({ where: { value: { contains: "p678-swarm-" } } });
    await prisma.betterAuthSession.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.betterAuthAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.betterAuthUser.deleteMany({ where: { email: { in: addresses } } });
    await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  } catch {
    /* best-effort cleanup */
  }
});
