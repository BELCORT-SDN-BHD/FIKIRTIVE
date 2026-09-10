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

/**
 * THE RECORDER, installed ONCE at the client both paths share (#795 r2).
 *
 * The client lives in its own module (`@fikirtive/db/client`) so the limiter can reach the
 * database even in the many suites that replace the `@fikirtive/db` barrel wholesale. That same
 * split used to make this file blind: tracing the barrel recorded the allowlist query and missed
 * every statement the limiter ran, so a query branching on the EMAIL could have been added inside
 * the limiter and this fence would still have been green. A step this file cannot see is a step
 * the defect can hide in — which is the one thing it exists to prevent.
 *
 * So the recorder goes on the client, and the barrel below simply re-exports it. Every database
 * call on the request path — allowlist, counter, transaction control — lands in `trace`, exactly
 * once, in dispatch order.
 *
 * TOP-LEVEL `$allOperations`, not `$allModels`: the model-scoped hook never fires for raw SQL
 * (a raw operation arrives with `model === undefined`), and the counter is raw SQL.
 */
vi.mock("@fikirtive/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fikirtive/db/client")>();
  return {
    ...actual,
    // Records at DISPATCH time (Prisma promises are lazy), which is exactly when the request
    // would start paying for the query.
    prisma: actual.prisma.$extends({
      query: {
        async $allOperations({ model, operation, args, query }) {
          trace.push(`db:${model ?? "raw"}.${operation}`);
          return query(args);
        },
      },
    }),
  };
});

// The barrel is left alone on purpose: it re-exports the very client mocked above, so extending
// it a second time here would record every call twice and the sequences would stop meaning
// "one entry per database call".

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
const { authEmailQueueSettled, __resetAuthEmailCapsForTests, __configureAuthEmailQueueForTests } =
  await import("@/lib/better-auth/sender");
const { __resetSignInCodeThrottleForTests } = await import("@/lib/better-auth/signin-code-request");
const { requestSignInCode } = await import("@/app/login/actions");
const { POST: betterAuthPost } = await import("@/app/api/better-auth/[...all]/route");

const NEUTRAL = {
  status: "success",
  message: "If this email has access, a sign-in code is on its way — check your inbox.",
};

const CALLER = new Headers({ origin: "http://localhost:3100", "x-forwarded-for": "203.0.113.10" });

/** Rows minted for one address. The ADDRESS lives in `identifier` (the email-OTP plugin writes
 *  `sign-in-otp-<email>` there) and the `value` is the encrypted code — the opposite way round
 *  from the magic link this replaced, which is worth stating because an earlier version of this
 *  file matched on the wrong column and silently counted nothing. */
const rowsFor = (email: string) =>
  prisma.betterAuthVerification.count({ where: { identifier: { contains: email } } });

beforeAll(async () => {
  await prisma.allowedEmail.upsert({
    where: { email: DB_ALLOWED },
    create: { email: DB_ALLOWED, status: "active", invitedBy: "p678-test@fikirtive.test" },
    update: { status: "active" },
  });
});

beforeEach(async () => {
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
  mockHeaders.mockReset();
  mockHeaders.mockReturnValue(CALLER);
  // #795 — both budgets are shared rows with an hour-long window. Reset them so each case
  // starts from a known state; this file is about the SHAPE of the path, and the two files that
  // own the budgets (better-auth-sender / signin-code-throttle) test them without any reset.
  await __resetSignInCodeThrottleForTests();
  await __resetAuthEmailCapsForTests();
  // This file is about the REQUEST path, whose whole claim is that it waits on none of this.
  // The executor's per-job jitter and its slot floor would only add real seconds to every case
  // here; both have their own file (auth-email-queue-executor) where they are the thing being
  // asserted.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  // LAST, on purpose: the two resets above are themselves database calls, and the tracer records
  // every one. Clearing before them would leave their rows in the first case's trace.
  trace.length = 0;
});

/**
 * THE WHOLE REQUEST PATH, as a sequence. Named once so every case below asserts the same list and
 * a change to the path has to be made deliberately, in one place, rather than absorbed test by
 * test. #795 added the middle items: the throttle's counter used to be a process-local Map, which
 * made the published cap a fiction as soon as a second instance existed.
 *
 * Those two entries ARE that counter's transaction — one statement that locks every bucket and
 * reads it, one that writes every bucket back. Both are keyed on strings normalised before they
 * were hashed, so both cost the same for an address with an account, one on a list, and one
 * nobody has ever heard of; and both are RECORDED, so a query added inside the limiter that
 * branched on the address would change this list and fail every case below.
 */
const REQUEST_PATH = ["headers", "db:raw.$queryRaw", "db:raw.$executeRaw", "enqueue"] as const;

// ── ① the request path is blind to what kind of address it was handed ────────────────────────
describe("#678 r3 ① — the request performs identical work for every kind of address", () => {
  it("records the same awaits and the same database calls for all three", async () => {
    const walk = async (email: string) => {
      trace.length = 0;
      const answer = await requestSignInCode({ email });
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

    // And what that sequence IS: read the caller, consult ONE shared counter, hand over an opaque
    // job. No allowlist lookup, no token mint, no send — none of the work whose cost depends on
    // the answer.
    //
    // #795 — consulting the shared counter is the only storage this path touches, and it is
    // address-blind by construction. That its statements appear in ALL THREE traces, in the same
    // positions, is the assertion above.
    expect(env.recorded).toEqual([...REQUEST_PATH]);

    // The answers are the same too, which was round 1's claim and is still required.
    expect(env.answer).toEqual(NEUTRAL);
    expect(db.answer).toEqual(NEUTRAL);
    expect(unknown.answer).toEqual(NEUTRAL);
  });

  it("records the same sequence when the caller is OVER its budget as when it is not", async () => {
    // r4 — the throttle's own verdict used to change the amount of work: an over-budget request
    // skipped the sanitise, the job, the push and the timer, and returned the same words. That
    // is the same defect one layer in, so it gets the same assertion.
    const inBudget: string[][] = [];
    const overBudget: string[][] = [];
    for (let i = 0; i < 8; i++) {
      trace.length = 0;
      const answer = await requestSignInCode({ email: ENV_ALLOWED });
      (i < 5 ? inBudget : overBudget).push([...trace]);
      expect(answer).toEqual(NEUTRAL);
      await authEmailQueueSettled();
    }

    // RED before r4: the over-budget presses recorded ["headers"] — no "enqueue" at all.
    for (const recorded of [...inBudget, ...overBudget]) {
      expect(recorded).toEqual([...REQUEST_PATH]);
    }
    // …and the throttle really did bite, so the sameness is not vacuous: the address budget is
    // 5, so exactly five of the eight presses put mail in flight.
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("still delivers to exactly the two addresses that have access, silently", async () => {
    for (const email of [ENV_ALLOWED, DB_ALLOWED, UNKNOWN]) {
      await requestSignInCode({ email });
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
    for (const email of strangers) await requestSignInCode({ email });
    await authEmailQueueSettled();

    // The token is minted AFTER the access check now, so an address nobody invited never
    // reaches Better Auth at all.
    expect(await prisma.betterAuthVerification.count()).toBe(before);
    for (const email of strangers) expect(await rowsFor(email)).toBe(0);

    // Control: a press from an address that DOES have access mints one, so the zero above is
    // the gate working and not the door being nailed shut.
    //
    // The outstanding code is cleared first because a live one is REUSED rather than replaced
    // (server.ts, `resendStrategy: "reuse"`): without this the control would press, correctly
    // reuse the row an earlier case left behind, and read as a delta of zero — a green gate
    // reporting the opposite of what it is checking.
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: ENV_ALLOWED } },
    });
    await requestSignInCode({ email: ENV_ALLOWED });
    await authEmailQueueSettled();
    expect(await rowsFor(ENV_ALLOWED)).toBe(1);
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

    const result = await requestSignInCode({ email: ENV_ALLOWED });
    expect(result).toEqual(NEUTRAL);
    // Nothing about the job had even STARTED at that point — the queue drains on a macrotask.
    expect(trace).toEqual([...REQUEST_PATH]);

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

    const known = await requestSignInCode({ email: ENV_ALLOWED });
    const stranger = await requestSignInCode({ email: UNKNOWN });
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

// ── THERE IS NO SECOND DOOR ANY MORE ─────────────────────────────────────────────────────────
/**
 * This describe used to prove that Better Auth's own `/sign-in/magic-link` endpoint answered
 * every address with the same status, the same body and the same recorded work as the login
 * page's server action — because the route file proxied it through the very same request path.
 *
 * The swap to codes removed the endpoint instead of matching it. `/email-otp/send-verification-otp`
 * is in `disabledPaths` (lib/better-auth/server.ts), so the router 404s it and the ONLY way to
 * cause a code to be minted is the server action above, which every case in this file already
 * measures. Two doors that must be kept identical is a standing invitation for them to drift;
 * one door cannot.
 *
 * What still has to be proven is that the second door is really gone — a closed path that
 * quietly reopens would restore in-request minting for anyone who knows the URL, and no other
 * case here would notice.
 */
describe("#678 r3 — the only public way to ask for a code is the server action", () => {
  const post = (path: string, body: unknown) =>
    betterAuthPost(
      new Request(`http://localhost:3100/api/better-auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100",
          "x-forwarded-for": "198.51.100.7",
        },
        body: JSON.stringify(body),
      }),
    );

  it("404s the mint endpoint for every address, and writes nothing for any of them", async () => {
    for (const email of [ENV_ALLOWED, DB_ALLOWED, UNKNOWN]) {
      const before = await rowsFor(email);
      trace.length = 0;
      const res = await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
      await authEmailQueueSettled();
      // Snapshotted before the assertions below, which query the database themselves and would
      // otherwise appear in the very trace being asserted.
      const recorded = [...trace];

      // RED if the path is ever taken out of `disabledPaths`: Better Auth would answer 200 and
      // mint a row inside the request, for an address nobody invited.
      expect(res.status, `${email} reached the mint endpoint`).toBe(404);
      expect(await rowsFor(email)).toBe(before);
      expect(mockSend).not.toHaveBeenCalled();
      // And it did no work of ours at all — not even the throttle, because there is nothing to
      // throttle: the request never reached a handler.
      expect(recorded).toEqual([]);
    }
  });

  it("closes every OTP endpoint this product does not use, and leaves the one it does open", async () => {
    const { auth: authInstance } = await import("@/lib/better-auth/server");
    // The list is read off the live configuration rather than restated, so adding a plugin
    // endpoint without deciding about it cannot slip past this.
    const disabled = authInstance.options.disabledPaths ?? [];
    expect(disabled).toContain("/email-otp/send-verification-otp");
    expect(disabled).toContain("/email-otp/request-password-reset");
    expect(disabled).toContain("/email-otp/reset-password");
    expect(disabled).toContain("/forget-password/email-otp");
    expect(disabled).toContain("/email-otp/verify-email");
    expect(disabled).toContain("/email-otp/check-verification-otp");
    expect(disabled).toContain("/email-otp/request-email-change");
    expect(disabled).toContain("/email-otp/change-email");
    // The one door a browser is allowed to knock on is NOT closed — a fence that shut everything
    // would pass the assertions above and break sign-in.
    expect(disabled).not.toContain("/sign-in/email-otp");

    // …and it really answers: a garbage code is refused (4xx), not 404'd by the router.
    const res = await post("/sign-in/email-otp", { email: UNKNOWN, otp: "000000" });
    expect(res.status).not.toBe(404);
  });
});

// ── ⑥ the door where the code is TYPED answers one refusal, whatever the row's state ─────────
/**
 * The oracle this closes, and why it needed its own describe.
 *
 * Every case above is about ASKING for a code. This one is about SUBMITTING one, and it is the
 * surface the swap from links to codes introduced: unlike the magic link's redeem door — which
 * took a token and no address, so there was nothing to key a probe on — this door takes the
 * EMAIL. A verification row exists only for an address that passed the allowlist, so any answer
 * that varies with the row's state is an answer about the account.
 *
 * Better Auth gives three: INVALID_OTP (400) when there is no row, TOO_MANY_ATTEMPTS (403) once
 * the row's three guesses are spent, OTP_EXPIRED (400) once it is past its expiry. The first
 * three guesses at a live code look exactly like guesses at nothing — which is why a test that
 * stops at three passes while the door is wide open. The two cases below are the ones that told
 * the addresses apart, taken from the judge's counter-example.
 *
 * THROUGH `betterAuthPost`, NOT `auth.handler`. The normalisation lives in the route file, so a
 * test that calls the handler directly (as signin-code-door.test.ts does, deliberately, to reach
 * Better Auth's own behaviour) walks straight past the thing under test.
 */
describe("#678 r3 ⑥ — submitting a code cannot be used to ask whether an address has an account", () => {
  const submit = (email: string, otp: string) =>
    betterAuthPost(
      new Request("http://localhost:3100/api/better-auth/sign-in/email-otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100",
          "x-forwarded-for": "198.51.100.9",
        },
        body: JSON.stringify({ email, otp }),
      }),
    );

  /** Status + body, which is everything a probe can read off one of these. */
  const answerOf = async (res: Response) => ({ status: res.status, body: await res.json() });

  const WRONG = ["111111", "222222", "333333", "444444"];

  it("answers the FOURTH guess identically for a merchant and for a stranger", async () => {
    // The merchant has a live code; the stranger has never had one. RED before the fence: the
    // fourth guess returned 403 TOO_MANY_ATTEMPTS for the merchant (the row's budget is spent)
    // and 400 INVALID_OTP for the stranger (there is no row to spend).
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: ENV_ALLOWED } },
    });
    await auth.api.createVerificationOTP({ body: { email: ENV_ALLOWED, type: "sign-in" } });
    expect(await rowsFor(ENV_ALLOWED)).toBe(1);
    expect(await rowsFor(UNKNOWN)).toBe(0);

    for (const otp of WRONG) {
      const merchant = await answerOf(await submit(ENV_ALLOWED, otp));
      const stranger = await answerOf(await submit(UNKNOWN, otp));
      expect(merchant, `guess ${otp} told the two addresses apart`).toEqual(stranger);
    }
  });

  it("answers an EXPIRED code identically for a merchant and for a stranger", async () => {
    // One request per address, no waiting — the cheaper half of the same probe. RED before the
    // fence: 400 OTP_EXPIRED for the merchant, 400 INVALID_OTP for the stranger.
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: ENV_ALLOWED } },
    });
    await auth.api.createVerificationOTP({ body: { email: ENV_ALLOWED, type: "sign-in" } });
    await prisma.betterAuthVerification.updateMany({
      where: { identifier: `sign-in-otp-${ENV_ALLOWED}` },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const merchant = await answerOf(await submit(ENV_ALLOWED, "555555"));
    const stranger = await answerOf(await submit(UNKNOWN, "555555"));
    expect(merchant).toEqual(stranger);
  });

  it("keeps exactly one refusal in the vocabulary, and it is Better Auth's own", async () => {
    // Naming the shape rather than only comparing two of them: a future edit that collapsed both
    // sides onto a NEW shape would satisfy the cases above and quietly change the client contract.
    const stranger = await answerOf(await submit(UNKNOWN, "666666"));
    expect(stranger).toEqual({
      status: 400,
      body: { message: "Invalid OTP", code: "INVALID_OTP" },
    });
  });

  it("still lets the correct code through, cookie and all", async () => {
    // The fence must refuse to be a wall. RED if the normalisation is ever widened to 2xx: the
    // session cookie rides on that response and sign-in would silently stop working.
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: ENV_ALLOWED } },
    });
    const otp = await auth.api.createVerificationOTP({
      body: { email: ENV_ALLOWED, type: "sign-in" },
    });

    const res = await submit(ENV_ALLOWED, otp);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session_token");
  });
});

// ── ⑤ 密码门退役，连同它的枚举面（SIGNIN-A4）─────────────────────────────────────────────
/**
 * 这一段原本比较的是「真账号 + 错密码」与「根本没有的地址」两个答案必须逐字相同 —— 密码门
 * 那条路上的枚举面。docs/specs/sign-in.md（已冻结 · v1）把密码整体退役之后，那两个答案都不
 * 存在了：门在 router 层就 404。
 *
 * 所以这一段不是被删掉，而是换成钉「它真的没了」。留一段空白会让下一个人以为这条性质从来
 * 没人管过；留一条 404 断言，才说得清它是怎么消失的。
 *
 * 这里也不再建任何 `providerId = "credential"` 的行 —— 建了就会和 SIGNIN-A9（这张表里一份
 * 密码凭据都没有）在同一轮里互相打架。但**用户行**要建：不建的话 `PASSWORD_ACCOUNT` 就是一个
 * 库里根本不存在的地址，下面那条「服务端也拒」会因为「查无此人」而恒绿，与密码配置无关（判官
 * r2 的变异实验证到过：把 `emailAndPassword.enabled` 改回 true，那一条照样过）。
 */
describe("SIGNIN-A4 ⑤ — 密码门与它的两种答案一起退役", () => {
  beforeAll(async () => {
    // 一个**真的存在**的账号，只有用户行，没有 credential 行 —— 这正是密码退役之后库里应有的
    // 形状，也让下面的「拒」不能靠「查无此人」蒙混过去。
    const user = await prisma.betterAuthUser.create({
      // `id` 在 schema 里是无默认值的 `@id String`（better-auth 自己生成），所以这里要给。
      data: { id: randomUUID(), email: PASSWORD_ACCOUNT, name: "p678 password door", emailVerified: true },
    });
    createdUserIds.push(user.id);
  });

  it("SIGNIN-A4 —— /sign-in/email 对公网 404：没有两种答案可比，也就没有枚举面", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email: PASSWORD_UNKNOWN, password: WRONG_PASSWORD }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("SIGNIN-A11 —— 配置层也关着：构造出来的实例上 `emailAndPassword.enabled` 是 false", async () => {
    // 编号是 A11 不是 A4：A4 判的是「公网请求那七条路径答 404」，而这一句判的是「本产品没有
    // 密码这件事在配置层就成立」——`enabled: false` 连 `auth.api.*` 那一侧的建密码入口一起关，
    // 那是 A11「没有任何途径能建立密码」的话，不是 A4 的话。router 那道闸只挡公网，配置层才是
    // 单一源；两层各答一个问题，缺一条这段就只证明了一半。
    //
    // 这一句是从**构造出来的实例**上读的，不是从源码文本上扫的：把
    // apps/web/lib/better-auth/server.ts 的 `emailAndPassword: { enabled: false }` 改成 true，
    // 这一行立刻红。**这是整个文件里唯一能感知那次变异的断言**（判官 r2 的变异实验测过；
    // 判官 r3 又指出下面那半感知不到它，所以两半在这里拆成两条，各自只署名它真的证明的东西）。
    expect(auth.options.emailAndPassword?.enabled ?? false).toBe(false);
  });

  it("SIGNIN-A9 —— 没有 credential 行，`auth.api.signInEmail` 连拒的对象都没有", async () => {
    // 诚实说明这一条**不**证明什么：它感知不到 `emailAndPassword.enabled`。一个只有用户行、
    // 没有 credential 行的地址，better-auth 无论开关开着还是关着都抛
    // `INVALID_EMAIL_OR_PASSWORD`（`dist/api/routes/sign-in.mjs` 找不到 credential 账号就抛）。
    // 那个开关的感知点是上面那一条，不是这一条 —— 判官 r3 打回的正是「用 A4 的名字挂一条恒真
    // 的行为断言」。
    //
    // 它证明的是 SIGNIN-A9 的不变量落到行为上的样子：库里没有一行 `providerId = 'credential'`
    // （下面第一句），所以哪怕这个地址在库里**真的有一个用户**（见本段 beforeAll，不是「查无
    // 此人」），密码这条路也换不到一个 session。
    expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);
    expect(await prisma.betterAuthUser.count({ where: { email: PASSWORD_ACCOUNT } })).toBe(1);
    const outcome = await auth.api
      .signInEmail({
        body: { email: PASSWORD_ACCOUNT, password: REAL_PASSWORD },
        headers: new Headers({ origin: "http://localhost:3100" }),
      })
      .then((r) => (r && "token" in r ? "session-issued" : "no-session"))
      .catch(() => "refused");
    expect(outcome).toBe("refused");
    // `in: []` 恒为 0，所以先钉住这个 where 不是空的 —— 上一版就是栽在这里。
    expect(createdUserIds.length).toBeGreaterThan(0);
    expect(await prisma.betterAuthSession.count({ where: { userId: { in: createdUserIds } } })).toBe(0);
  });

  it("SIGNIN-A9 —— 库里一份密码凭据都没有，所以连「真账号错密码」这个前提都不成立", async () => {
    // 同上：`providerId = 'credential'` 的行数是 A9 的判定，不是 A4 的。它留在这一段里，是因为
    // 「没有两种答案可比」这条性质的前提就是它——但编号只署它真的证明的那一条。
    expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);
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
  ];
  try {
    // The address lives in `identifier` (`sign-in-otp-<email>`), not in `value` — see rowsFor.
    await prisma.betterAuthVerification.deleteMany({
      where: { OR: addresses.map((email) => ({ identifier: { contains: email } })) },
    });
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: "p678-swarm-" } },
    });
    await prisma.betterAuthSession.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.betterAuthAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.betterAuthUser.deleteMany({ where: { email: { in: addresses } } });
    await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  } catch {
    /* best-effort cleanup */
  }
});
