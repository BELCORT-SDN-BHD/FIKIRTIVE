/**
 * THE SIGN-IN-CODE DOOR, END TO END (2026-08-18 — Founder ruling: the mailed link becomes a
 * mailed code).
 *
 * Every case here runs the REAL Better Auth instance against the REAL local Postgres. Only the
 * mail transport is mocked, and it is mocked as an inbox rather than as a spy: the code these
 * cases type back in is the one that was actually delivered, so nothing passes because a stub
 * agreed with itself.
 *
 * What it pins, in the order a merchant meets it:
 *   ① asking for a code puts ONE email in the inbox, and that email carries a six-digit code;
 *   ② a wrong code is refused and does not mint a session;
 *   ③ the right code signs them in — and converges their tenant, exactly as the link did;
 *   ④ a code is single-use, and three wrong guesses burn it;
 *   ⑤ the doors that must stay shut: no session for an address off the allowlist even with the
 *      correct code, no session without one, and no reaching into another tenant.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type SentEmail = { to: string; subject: string; text?: string; html?: string; devPreview?: string };
const inbox: SentEmail[] = [];

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailPort: {
      send: vi.fn(async (m: SentEmail) => {
        inbox.push(m);
      }),
    },
  };
});

/**
 * SIGNIN-A15 —— 「让首登在建号中途失败一次」的那个开关。
 *
 * 开户是一笔事务（org + membership + 赠金），住在 `auth-guard.ts`；convergence 用**动态 import**
 * 去拿它。所以这里包一层：默认原样转发给真实实现，只有在某条用例把 `failBootstrapOnce` 拨起来
 * 的那一次抛。抛的是真的 —— convergence 会照它自己的规矩把这次失败当成 non-fatal 咽下去，
 * `BetterAuthUser` 那一行留下、org 与赠金整个不存在，正是规格 §1.4「事务事实」写的孤儿状态。
 *
 * 为什么不 `vi.spyOn(prisma, "$transaction")`：Prisma 的客户端是 Proxy，那个属性不可重定义
 * （实测 `$transaction does not exist`）。
 */
let bootstrapFailuresLeft = 0;
vi.mock("@/lib/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guard")>();
  return {
    ...actual,
    bootstrapPersonalOrg: async (...args: Parameters<typeof actual.bootstrapPersonalOrg>) => {
      if (bootstrapFailuresLeft > 0) {
        bootstrapFailuresLeft -= 1;
        throw new Error("database connection lost");
      }
      return actual.bootstrapPersonalOrg(...args);
    },
  };
});

// Better Auth reads these at construction, which happens during the imports below.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";

/** On the allowlist, and the merchant every happy-path case belongs to. */
const MERCHANT = `otp-merchant-${randomUUID()}@fikirtive.test`;
/** A REAL, verified account whose address the operator REVOKED — the fail-closed gate's subject.
 *  It used to be «on no list», which is no longer a refusal at all: the spec's three-step door
 *  admits any address that is neither revoked nor a stranger during a pause (§1.6). */
const UNLISTED = `otp-unlisted-${randomUUID()}@fikirtive.test`;
/** A second allowlisted merchant, so "one code, one merchant" can be shown rather than assumed. */
const NEIGHBOUR = `otp-neighbour-${randomUUID()}@fikirtive.test`;
process.env.AUTH_ALLOWED_EMAILS = [MERCHANT, NEIGHBOUR].join(",");
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");
const { auth } = await import("@/lib/better-auth/server");
const {
  enqueueAuthEmail,
  authEmailQueueSettled,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
} = await import("@/lib/better-auth/sender");

const ORIGIN = "http://localhost:3100";
const createdUserIds: string[] = [];
/** SIGNIN-A1 —— 每一条陌生人用例真的会建出账号、工作区和赠金行，所以它们要留下自己的地址给
 *  afterAll 收拾。跑一次留一堆孤儿工作区，下一个人读这个库的时候会读到一团噪音。 */
const strangerAddresses: string[] = [];

/** Ask for a code the way the login page does — through the queue — and read what arrived. */
async function requestCode(email: string): Promise<string | undefined> {
  inbox.length = 0;
  enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
  await authEmailQueueSettled();
  // SIGNIN-A16 —— 队列在入口就把地址归一（sender.ts 的 `enqueueAuthEmail`），所以信是寄给
  // 小写那一版的。这里照着找，否则一个大写地址的用例会读到 undefined 而不是它的码。
  const normalized = email.trim().toLowerCase();
  return inbox.find((m) => m.to === normalized)?.devPreview;
}

/** Submit a code at the one OTP door that faces the public. */
function submitCode(email: string, otp: string): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/better-auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, otp }),
    }),
  );
}

const sessionsFor = (email: string) =>
  prisma.betterAuthSession.count({ where: { user: { email } } });

beforeAll(async () => {
  // UNLISTED is a real, verified account whose address the operator revoked — the case
  // session.create.before exists for. Seeded through Prisma so `user.create.before` is bypassed:
  // we are testing the REPEAT sign-in, not registration.
  const id = randomUUID();
  createdUserIds.push(id);
  await prisma.betterAuthUser.create({
    data: { id, name: "Unlisted Shop", email: UNLISTED, emailVerified: true },
  });
  await prisma.allowedEmail.upsert({
    where: { email: UNLISTED },
    create: { email: UNLISTED, status: "revoked", invitedBy: "operator@fikirtive.test" },
    update: { status: "revoked" },
  });
});

beforeEach(async () => {
  inbox.length = 0;
  await __resetAuthEmailCapsForTests();
  // The queue's jitter and slot floor are asserted in auth-email-queue-executor; here they would
  // only add real seconds to every case.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  // A live code survives the case that made it (15 minutes), and several cases below count rows
  // or attempts — so each one starts from no outstanding codes rather than from whatever the
  // previous case left behind.
  await prisma.betterAuthVerification.deleteMany({
    where: { identifier: { contains: "otp-" } },
  });
});

// ── ① one press, one email, one six-digit code ───────────────────────────────────────────────
describe("asking for a sign-in code", () => {
  it("puts exactly one email in the merchant's inbox, carrying six digits and no link", async () => {
    const code = await requestCode(MERCHANT);

    expect(inbox.filter((m) => m.to === MERCHANT)).toHaveLength(1);
    expect(code).toMatch(/^\d{6}$/);
    const message = inbox.find((m) => m.to === MERCHANT)!;
    expect(message.subject).toBe("Your Fikirtive sign-in code");
    expect(message.text).toContain(code);
  });

  /**
   * SIGNIN-A5 —— 「点邮件里的 Log in 按钮 → 登录页打开、码已填好，按一次 Continue 即登录；
   * 同一封邮件的链接第二次点无效；15 分钟后无效」。
   *
   * 链接那一段的**构造**在这里验（落地页读片段的那一半在 login-code-resend.test.tsx）：它指向
   * 我们自己的 `/login`，码只在片段里，而且「一次性」与「15 分钟」都不是链接自己的属性 ——
   * 它们是那个码的，所以下面第二次提交同一个码就被拒。
   *
   * RED before：这封邮件里一个链接都没有（那是 #678 的防钓鱼取舍），规格 §1.2 改判。
   */
  it("SIGNIN-A5 —— 邮件带一颗 Log in 按钮：指向 /login、码在片段里，用一次就作废", async () => {
    const code = await requestCode(MERCHANT);
    const message = inbox.find((m) => m.to === MERCHANT)!;

    const href = /href="([^"]+)"/.exec(message.html ?? "")?.[1];
    expect(href).toBeTruthy();
    const link = new URL(href!.replace(/&amp;/g, "&"));
    expect(link.pathname).toBe("/login");
    expect(link.searchParams.get("step")).toBe("code");
    // 码不进查询串 —— 片段不会被浏览器送给服务器，所以它不进 access log、不随 Referer 外泄。
    expect(link.search).not.toContain(code!);
    const fragment = new URLSearchParams(link.hash.slice(1));
    expect(fragment.get("email")).toBe(MERCHANT);
    expect(fragment.get("code")).toBe(code);

    // 「按一次 Continue 即登录」：页面拿片段里的这两样去提交，就是下面这一次调用。
    expect((await submitCode(MERCHANT, fragment.get("code")!)).status).toBe(200);
    // 「同一封邮件的链接第二次点无效」：链接还在、码已经作废。
    expect((await submitCode(MERCHANT, fragment.get("code")!)).status).toBeGreaterThanOrEqual(400);
  });

  /** SIGNIN-A5 —— 「15 分钟后无效」。有效期是**码**的（server.ts 的 `expiresIn`），链接只是搬运
   *  它，所以把那一行的 `expiresAt` 拨到过去就是「十五分钟之后」。 */
  it("SIGNIN-A5 —— 15 分钟之后，同一封邮件里的码（以及那条链接）都不再管用", async () => {
    const code = await requestCode(MERCHANT);
    const before = await sessionsFor(MERCHANT);
    await prisma.betterAuthVerification.updateMany({
      where: { identifier: `sign-in-otp-${MERCHANT}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await submitCode(MERCHANT, code!)).status).toBeGreaterThanOrEqual(400);
    expect(await sessionsFor(MERCHANT)).toBe(before);
  });

  it("mints one verification row for that address, and none for anybody else", async () => {
    await requestCode(MERCHANT);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${MERCHANT}` },
      }),
    ).toBe(1);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${NEIGHBOUR}` },
      }),
    ).toBe(0);
  });

  /**
   * PRESSING AGAIN RE-SENDS THE SAME CODE — the `resendStrategy: "reuse"` decision, pinned at the
   * behaviour rather than at the config line.
   *
   * RED under Better Auth's default ("rotate"): the second press writes a SECOND row with
   * DIFFERENT digits and leaves the first in place, so the merchant holds two emails of which
   * only one works — and typing the older one spends an attempt belonging to the newer.
   */
  it("re-sends the SAME code when the merchant presses again, leaving one live code", async () => {
    const first = await requestCode(MERCHANT);
    const second = await requestCode(MERCHANT);

    expect(second).toBe(first);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${MERCHANT}` },
      }),
    ).toBe(1);
    // …and the code from the FIRST email still signs them in, which is the whole point.
    expect((await submitCode(MERCHANT, first!)).status).toBe(200);
  });
});

// ── ② a wrong code buys nothing ──────────────────────────────────────────────────────────────
describe("submitting the wrong code", () => {
  it("is refused, sets no cookie and writes no session", async () => {
    const code = await requestCode(MERCHANT);
    const wrong = code === "000000" ? "111111" : "000000";
    const before = await sessionsFor(MERCHANT);

    const res = await submitCode(MERCHANT, wrong);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await sessionsFor(MERCHANT)).toBe(before);
  });

  it("answers a stranger's guess exactly as it answers a merchant's wrong guess", async () => {
    // No code has ever been minted for this address, so the row simply is not there. If that
    // case read differently from "wrong digits for a real code", six random digits would be an
    // account-existence probe.
    await requestCode(MERCHANT);
    const stranger = `otp-nobody-${randomUUID()}@fikirtive.test`;

    const mine = await submitCode(MERCHANT, "000000");
    const theirs = await submitCode(stranger, "000000");

    expect(theirs.status).toBe(mine.status);
    expect(await theirs.json()).toEqual(await mine.json());
  });
});

// ── ③ the right code is a sign-in ────────────────────────────────────────────────────────────
describe("submitting the right code", () => {
  it("creates a session, sets the cookie, and converges the merchant's tenant", async () => {
    const code = await requestCode(MERCHANT);
    const res = await submitCode(MERCHANT, code!);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session_token");
    expect(await sessionsFor(MERCHANT)).toBeGreaterThan(0);

    // The same convergence the magic link produced: a canonical User and a personal workspace.
    // #680 — and still NO shop name invented from the address, because this door never asked.
    const user = await prisma.user.findUnique({ where: { email: MERCHANT } });
    expect(user).not.toBeNull();
    const org = await prisma.organization.findUnique({ where: { id: `org_${user!.id}` } });
    expect(org).not.toBeNull();
    expect(org!.name).toBe("");
  });

  it("spends the code — the same six digits do not work twice", async () => {
    const code = await requestCode(MERCHANT);
    expect((await submitCode(MERCHANT, code!)).status).toBe(200);

    const replay = await submitCode(MERCHANT, code!);
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it("belongs to the address it was mailed to — a neighbour cannot use it", async () => {
    const code = await requestCode(MERCHANT);
    const stolen = await submitCode(NEIGHBOUR, code!);
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(await sessionsFor(NEIGHBOUR)).toBe(0);
  });
});

// ── ④ the guess budget lives on the code ─────────────────────────────────────────────────────
describe("the per-code attempt budget", () => {
  it("burns the code after three wrong guesses, so the right one no longer works", async () => {
    const code = await requestCode(MERCHANT);
    const wrong = (n: number) => String(n).padStart(6, "9");
    const sessionsBefore = await sessionsFor(MERCHANT);

    for (let i = 0; i < 3; i++) {
      expect((await submitCode(MERCHANT, wrong(i))).status).toBeGreaterThanOrEqual(400);
    }

    // RED if `allowedAttempts` is ever removed from the plugin's configuration: without it a
    // caller could keep guessing one live code until they found it, and no request-level rate
    // limiter can bring that budget back — it belongs to the CODE, not to the caller.
    const withRealCode = await submitCode(MERCHANT, code!);
    expect(withRealCode.status).toBeGreaterThanOrEqual(400);
    expect(await sessionsFor(MERCHANT)).toBe(sessionsBefore);

    // …and the merchant is not locked out of the product: a fresh code works. A burnt code is
    // never reused either, however the resend strategy is configured.
    const fresh = await requestCode(MERCHANT);
    expect(fresh).not.toBe(code);
    expect((await submitCode(MERCHANT, fresh!)).status).toBe(200);
    expect(await sessionsFor(MERCHANT)).toBe(sessionsBefore + 1);
  });
});

// ── ⑤ 陌生人这一侧：门开了，账号跟着开出来 ───────────────────────────────────────────────
describe("SIGNIN-A1 —— 陌生邮箱走码门直接进产品且建号", () => {
  /**
   * 验收 A1 逐字：「一个从未出现过的邮箱：登录页按 Continue with email，收邮件，手输 6 位码 →
   * 直接进产品；账号与工作区已建立；全程没有出现第二个页面叫注册」。
   *
   * RED before：这个地址一封码都收不到（寄信队列的名单闸），就算硬塞一个码给它，
   * `user.create.before` 的名单断言也会把建号拦成 403。
   */
  it("SIGNIN-A1 —— 从未出现过的邮箱：收码、输码，账号与工作区当场建立", async () => {
    const stranger = `otp-newcomer-${randomUUID()}@fikirtive.test`;
    const code = await requestCode(stranger);
    expect(code).toMatch(/^\d{6}$/);

    const res = await submitCode(stranger, code!);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session_token");

    // SIGNIN-A10 —— 账号、工作区、赠金、emailVerified、名单行，一次首登全部到位。
    const baUser = await prisma.betterAuthUser.findUnique({ where: { email: stranger } });
    expect(baUser?.emailVerified).toBe(true);
    const user = await prisma.user.findUnique({ where: { email: stranger } });
    expect(user).not.toBeNull();
    const org = await prisma.organization.findUnique({ where: { id: `org_${user!.id}` } });
    expect(org).not.toBeNull();
    expect(org!.name).toBe(""); // 工作区名为空，等商家在设置页填店铺名
    // 「注册即邀请」：这一行是他证明了自己拥有这个邮箱的记录，来源门写在 invitedBy 上。
    const admitted = await prisma.allowedEmail.findUnique({ where: { email: stranger } });
    expect(admitted?.status).toBe("active");
    expect(admitted?.invitedBy).toBe("sign-in-code");
    strangerAddresses.push(stranger);
  });

  /**
   * SIGNIN-A10 —— 「赠金都恰好一笔 SIGNUP_GRANT_CREDITS（幂等键 signup:<orgId>）、登录审计各恰好
   * 一行」。金额写常量名不写数字（规格 §1.5）。
   */
  it("SIGNIN-A10 —— 首登恰好一笔 SIGNUP_GRANT_CREDITS、幂等键 signup:<orgId>、登录审计恰好一行", async () => {
    const newcomer = `otp-grant-${randomUUID()}@fikirtive.test`;
    strangerAddresses.push(newcomer);
    const code = await requestCode(newcomer);
    expect((await submitCode(newcomer, code!)).status).toBe(200);

    const user = (await prisma.user.findUnique({ where: { email: newcomer } }))!;
    const orgId = `org_${user.id}`;
    const grants = await prisma.creditLedger.findMany({ where: { orgId, kind: "GRANT" } });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.balanceDelta).toBe(SIGNUP_GRANT_CREDITS);
    expect(grants[0]!.idempotencyKey).toBe(`signup:${orgId}`);

    // 一次登录 = 一行审计，尽管 convergence 在这一次登录里跑了两遍（建用户钩子 + 建会话钩子）。
    const audits = await prisma.actionEvent.findMany({
      where: { type: "auth.signin", payload: { path: ["email"], equals: newcomer } },
    });
    expect(audits).toHaveLength(1);
  });

  /**
   * SIGNIN-A16 —— 「用 `Aisha@Example.com` 与 `aisha@example.com` 各登录一次 → 同一个账号；
   * `AllowedEmail` 只有一行小写」。
   */
  it("SIGNIN-A16 —— 大小写变体落到同一个账号，AllowedEmail 只有一行小写", async () => {
    const lower = `otp-case-${randomUUID()}@fikirtive.test`;
    const upper = lower.toUpperCase();
    strangerAddresses.push(lower);

    expect((await submitCode(upper, (await requestCode(upper))!)).status).toBe(200);
    expect((await submitCode(lower, (await requestCode(lower))!)).status).toBe(200);

    expect(
      await prisma.betterAuthUser.count({ where: { email: { in: [lower, upper] } } }),
    ).toBe(1);
    expect(await prisma.user.count({ where: { email: { in: [lower, upper] } } })).toBe(1);
    const rows = await prisma.allowedEmail.findMany({ where: { email: { in: [lower, upper] } } });
    expect(rows.map((r) => r.email)).toEqual([lower]);
  });

  /**
   * SIGNIN-A15 —— 「让首登在建号中途失败一次，同一邮箱再登录一次 → 第二次成功进入；库里该邮箱
   * 只有一个用户、一个工作区、一笔赠金」。
   *
   * 中途失败用 `bootstrapPersonalOrg` 抛一次来演：`prismaAdapter` 没开 transaction
   * （规格 §1.4「事务事实」），所以 `BetterAuthUser` 那一行已经写下去了，孤儿就是这么来的。
   * 规格不要求原子性，要求的是**可重试且只留一个**。
   */
  it("SIGNIN-A15 —— 建号中途失败一次，同一邮箱再登录一次成功，库里只留一个用户、一个工作区、一笔赠金", async () => {
    const retrying = `otp-retry-${randomUUID()}@fikirtive.test`;
    strangerAddresses.push(retrying);
    // 一次登录会跑两遍 convergence（建用户钩子一遍、建会话钩子一遍），所以「第一次登录整个
    // 建号失败」要让这两遍都炸；只炸一遍的话，同一次请求里的第二遍就把它补好了 —— 那是产品
    // 真实的自愈行为，但它演示不了 A15 要看的「再登录一次」。
    bootstrapFailuresLeft = 2;

    // 第一次：码验过了，用户行写下去了，开户那一半炸掉（convergence 把它当 non-fatal 咽下）。
    const first = await submitCode(retrying, (await requestCode(retrying))!);
    expect(first.status).toBe(200);
    expect(bootstrapFailuresLeft).toBe(0); // 那两次失败真的发生了，不是开关从没被读到
    const orphan = await prisma.user.findUnique({ where: { email: retrying } });
    expect(await prisma.organization.count({ where: { id: `org_${orphan!.id}` } })).toBe(0);

    // 第二次：同一个邮箱再登录一次，这一次开户跑完。
    expect((await submitCode(retrying, (await requestCode(retrying))!)).status).toBe(200);

    expect(await prisma.betterAuthUser.count({ where: { email: retrying } })).toBe(1);
    const user = (await prisma.user.findUnique({ where: { email: retrying } }))!;
    expect(user.id).toBe(orphan!.id); // 同一个用户，不是第二个
    expect(await prisma.organization.count({ where: { id: `org_${user.id}` } })).toBe(1);
    expect(
      await prisma.creditLedger.count({ where: { orgId: `org_${user.id}`, kind: "GRANT" } }),
    ).toBe(1);
  });
});

// ── ⑥ what must stay shut ────────────────────────────────────────────────────────────────────
describe("what the code door must never open", () => {
  it("refuses a session for a REVOKED address, even with the correct code", async () => {
    // The gate this must never loosen. UNLISTED is a real, verified account whose address the
    // operator revoked, and the code is genuinely correct — Better Auth would happily open the
    // door. session.create.before is what stops it, and it is still fail-closed after the door's
    // decision was rewritten to the spec's three steps.
    const otp = await auth.api.createVerificationOTP({
      body: { email: UNLISTED, type: "sign-in" },
    });

    const res = await submitCode(UNLISTED, otp);

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await sessionsFor(UNLISTED)).toBe(0);
  });

  it("never mails a code to a REVOKED address, however it reaches the queue", async () => {
    const banned = `otp-revoked-${randomUUID()}@fikirtive.test`;
    strangerAddresses.push(banned);
    await prisma.allowedEmail.create({
      data: { email: banned, status: "revoked", invitedBy: "operator@fikirtive.test" },
    });
    expect(await requestCode(banned)).toBeUndefined();
    expect(inbox.filter((m) => m.to === banned)).toHaveLength(0);
    expect(
      await prisma.betterAuthVerification.count({
        where: { identifier: `sign-in-otp-${banned}` },
      }),
    ).toBe(0);
  });

  it("leaves the magic-link endpoints unregistered — both of them, server API and HTTP", async () => {
    // The plugin is gone, not merely unused: its server API is absent…
    expect((auth.api as Record<string, unknown>).signInMagicLink).toBeUndefined();
    expect((auth.api as Record<string, unknown>).magicLinkVerify).toBeUndefined();
    // Read as strings: TypeScript already narrows `p.id` to the registered set, so comparing it
    // to "magic-link" is a compile error rather than a runtime check — which is a nice proof in
    // itself, but not one that survives into a test run.
    const pluginIds = (auth.options.plugins ?? []).map((p) => String(p.id));
    expect(pluginIds).not.toContain("magic-link");
    expect(pluginIds).toContain("email-otp");

    // …and so are its two routes.
    const post = await auth.handler(
      new Request(`${ORIGIN}/api/better-auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: MERCHANT, callbackURL: "/" }),
      }),
    );
    expect(post.status).toBe(404);

    const verify = await auth.handler(
      new Request(`${ORIGIN}/api/better-auth/magic-link/verify?token=anything`, {
        method: "GET",
        headers: { origin: ORIGIN },
      }),
    );
    expect(verify.status).toBe(404);
  });
});

afterAll(async () => {
  __configureAuthEmailQueueForTests({});
  const addresses = [MERCHANT, UNLISTED, NEIGHBOUR, ...strangerAddresses, ...strangerAddresses.map((e) => e.toUpperCase())];
  try {
    await prisma.signupGrantClaim.deleteMany({
      where: { canonicalEmail: { in: addresses.map((e) => e.toLowerCase()) } },
    });
    await prisma.betterAuthVerification.deleteMany({
      where: { OR: [...addresses, "otp-"].map((s) => ({ identifier: { contains: s } })) },
    });
    const users = await prisma.betterAuthUser.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    const ids = [...createdUserIds, ...users.map((u) => u.id)];
    await prisma.betterAuthSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthUser.deleteMany({ where: { email: { in: addresses } } });
    const canonical = await prisma.user.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    for (const { id } of canonical) {
      await prisma.creditLedger.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.creditAccount.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.membership.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.organization.deleteMany({ where: { id: `org_${id}` } });
    }
    await prisma.user.deleteMany({ where: { email: { in: addresses } } });
    await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  } catch {
    /* best-effort cleanup */
  }
});
