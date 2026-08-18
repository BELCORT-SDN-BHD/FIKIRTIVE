/**
 * signup-door.test.ts — #543 merchant self-service signup door (integration).
 *
 * Runs the REAL Better Auth instance against the REAL local test Postgres, so the
 * assertions cover the whole door: the open `/sign-up/email` path, the pause switch,
 * the revoked-email fail-closed case, email verification, the welcome grant, and the
 * regressions that must NOT move (the sign-in code stays invite-only; existing accounts and
 * the deny-by-default session gate are untouched).
 *
 * Money: the welcome grant is a CreditLedger write. The exactly-once proof lives in
 * signup-grant-exactly-once.test.ts; here we only assert the happy path lands once.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type SentEmail = { to: string; subject: string; text?: string; devPreview?: string };
const sent: SentEmail[] = [];

vi.mock("@/lib/email", () => ({
  emailPort: { send: vi.fn(async (m: SentEmail) => { sent.push(m); }) },
  EmailSendError: class EmailSendError extends Error {},
}));

// Set BEFORE the top-level dynamic imports below — Better Auth reads baseURL/secret at
// construction time, which happens at module load, not in beforeAll.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "";
delete process.env.SIGNUPS_PAUSED;

const { auth } = await import("@/lib/better-auth/server");
const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");
const { enqueueAuthEmail, authEmailQueueSettled, __configureAuthEmailQueueForTests } = await import(
  "@/lib/better-auth/sender"
);

beforeEach(() => {
  sent.length = 0;
  delete process.env.SIGNUPS_PAUSED;
  // #678 — auth emails leave on a background queue that jitters each job and holds its worker
  // for a fixed floor, so that the arrival time of one merchant's email cannot be read as an
  // answer about another merchant's address. This file is about the SIGN-UP door, not that
  // queue (whose own properties are asserted in auth-email-queue-executor), so it takes the
  // delays out.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
});

const PASSWORD = "correct-horse-battery-staple";
const newEmail = () => `merchant-${randomUUID()}@fikirtive.test`;

/** POST the public sign-up endpoint exactly as the browser form does. */
async function postSignUp(body: { email: string; password: string; name: string }) {
  const res = await auth.handler(
    new Request("http://localhost:3100/api/better-auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    }),
  );
  // #678 — the verification email is handed to a background queue and delivered off the request
  // path, so the inbox below is only readable once that queue has settled. (Before the queue
  // existed this happened to work because the rest of the signup flow awaited enough for the
  // send to slip in; that was luck, not a guarantee.)
  await authEmailQueueSettled();
  return res;
}

/** The verification token Better Auth put in the email it just "sent". */
function verificationTokenFromInbox(email: string): string {
  const msg = [...sent].reverse().find((m) => m.to === email && m.subject.toLowerCase().includes("verify"));
  if (!msg) throw new Error(`no verification email for ${email}; inbox=${JSON.stringify(sent)}`);
  const url = new URL((msg.devPreview ?? msg.text ?? "").match(/https?:\/\/\S+/)?.[0] ?? "");
  const token = url.searchParams.get("token");
  if (!token) throw new Error(`no token in verification URL ${url.toString()}`);
  return token;
}

async function verifyEmail(token: string) {
  return auth.handler(
    new Request(`http://localhost:3100/api/better-auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { origin: "http://localhost:3100" },
    }),
  );
}

describe("#543 · the door opens — a stranger can register with email + password + shop name", () => {
  it("creates the account, admits the email, and sends a verification email — with NO session and NO credits yet", async () => {
    const email = newEmail();
    const res = await postSignUp({ email, password: PASSWORD, name: "Kopi Corner" });
    expect(res.status).toBe(200);

    // The account exists but is unverified.
    const baUser = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(baUser).not.toBeNull();
    expect(baUser?.emailVerified).toBe(false);
    expect(baUser?.name).toBe("Kopi Corner");

    // Registration IS the invite: the email admits itself so every existing
    // deny-by-default gate keeps working unchanged.
    const admitted = await prisma.allowedEmail.findUnique({ where: { email } });
    expect(admitted?.status).toBe("active");
    expect(admitted?.invitedBy).toBe("self-signup");

    // Unverified ⇒ no tenant graph and no money.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(sent.some((m) => m.to === email && m.subject.toLowerCase().includes("verify"))).toBe(true);
  });

  it("verification lands the workspace named after the shop and the 25-credit welcome grant", async () => {
    const email = newEmail();
    await postSignUp({ email, password: PASSWORD, name: "Nasi Lemak Ibu" });
    const res = await verifyEmail(verificationTokenFromInbox(email));
    expect(res.status).toBeLessThan(400);

    const baUser = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(baUser?.emailVerified).toBe(true);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    // #544 — the CANONICAL User row must also record the verification, not just the ba_user
    // mirror. The canonical column is a DateTime? (next-auth convention): "verified" = a
    // non-null timestamp, null = never verified. A null here would leave the tenant graph
    // unable to tell a verified merchant from an unverified one.
    expect(user!.emailVerified).toBeInstanceOf(Date);
    const orgId = `org_${user!.id}`;

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.name).toBe("Nasi Lemak Ibu"); // first screen shows the merchant's own shop name

    const membership = await prisma.membership.findUnique({ where: { userId_orgId: { userId: user!.id, orgId } } });
    expect(membership?.role).toBe("owner");

    const account = await prisma.creditAccount.findUnique({ where: { orgId } });
    expect(account?.balance).toBe(SIGNUP_GRANT_CREDITS);
    expect(SIGNUP_GRANT_CREDITS).toBe(250);

    const grants = await prisma.creditLedger.findMany({ where: { orgId, kind: "GRANT" } });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.balanceDelta).toBe(SIGNUP_GRANT_CREDITS);
    expect(grants[0]!.idempotencyKey).toBe(`signup:${orgId}`);
    expect(grants[0]!.createdBy).toBe("auth:bootstrap-personal-org");
  });

  it("a verified self-registered merchant can then sign in with their password", async () => {
    const email = newEmail();
    await postSignUp({ email, password: PASSWORD, name: "Warung Sedap" });
    await verifyEmail(verificationTokenFromInbox(email));

    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("#543 · the pause switch — fail-closed, honest", () => {
  it("SIGNUPS_PAUSED refuses the sign-up endpoint and writes nothing", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    const email = newEmail();

    const res = await postSignUp({ email, password: PASSWORD, name: "Too Late Cafe" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
  });

  it("treats any unrecognised value as PAUSED (fail-closed), and only explicit off values as open", async () => {
    const { signupsPaused } = await import("@/lib/signup-gate");
    for (const on of ["1", "true", "yes", "TRUE", "paused", "maybe"]) {
      process.env.SIGNUPS_PAUSED = on;
      expect(signupsPaused()).toBe(true);
    }
    for (const off of ["", "0", "false", "off", "no"]) {
      process.env.SIGNUPS_PAUSED = off;
      expect(signupsPaused()).toBe(false);
    }
    delete process.env.SIGNUPS_PAUSED;
    expect(signupsPaused()).toBe(false);
  });
});

describe("#543 · what must NOT open", () => {
  it("a REVOKED email cannot re-register itself back in", async () => {
    const email = newEmail();
    await prisma.allowedEmail.create({ data: { email, status: "revoked", invitedBy: "operator@fikirtive.test" } });

    const res = await postSignUp({ email, password: PASSWORD, name: "Banned Shop" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const row = await prisma.allowedEmail.findUnique({ where: { email } });
    expect(row?.status).toBe("revoked"); // never resurrected
    expect(row?.invitedBy).toBe("operator@fikirtive.test");
    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
  });

  it("a REJECTED signup admits nothing — no account means no AllowedEmail row to walk in with later", async () => {
    const email = newEmail();
    const res = await postSignUp({ email, password: "short", name: "Weak Password Shop" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
  });

  it("the sign-in code stays invite-only — an unknown email gets no code, and registers nothing", async () => {
    const email = newEmail();
    // Straight at the queue, because that is the only way in: the HTTP endpoint that mints a
    // code is in `disabledPaths` (see auth-enumeration-structural.test.ts for that half). This
    // is the background side's own gate — the one that decides whether an address that reached
    // the queue is allowed to be mailed at all.
    enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
    await authEmailQueueSettled();

    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
    // Asking for a code is not registration: an unknown address gets no invite row out of it.
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
  });

  it("password sign-in for a never-registered email still answers with the generic credential error", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email: newEmail(), password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
  });
});

describe("#543 · the signup pages are reachable without a session", () => {
  it("the auth wall exempts /signup, /forgot-password and /reset-password", async () => {
    const { config } = await import("@/proxy");
    const matcher = new RegExp(`^${config.matcher[0]!}$`);
    for (const walled of ["/", "/otto", "/settings"]) expect(matcher.test(walled)).toBe(true);
    for (const open of ["/signup", "/forgot-password", "/reset-password", "/login"]) {
      expect(matcher.test(open)).toBe(false);
    }
  });
});

/**
 * #543 + #795 r3 —— 三道公开门的限流,现在是**两层**,这个 describe 断言的是各自的真实位置。
 *
 * 这里原本断言三道门在 Better Auth 的 `customRules` 里各有一条每小时规则。#795 把那三条撤了,
 * 原因是库执行不出来:`storage: "database"` 时它按 `max(全局 window, 自带特殊规则窗口)` = 60 秒
 * 清理计数行,而且清理时不看命中的是哪条 customRule —— 写着「5 次/小时」,执行出来的是
 * 「5 次/分钟」。所以每小时闸搬到了我们自己的计数器上(它按自己的 expiresAt 清理),BA 那一层
 * 留下的是它自带的短窗突发规则。
 *
 * 「有一条规则」不再是可断言的事实;「哪一层拦哪一种」才是。
 */
describe("#543 · the newly public endpoints carry a rate-limit fail-safe", () => {
  // r5/r7 —— 门的清单不在这里手抄一份,而是从**唯一那份清单**读出来。r7 把它从路由文件搬到
  // lib/public-auth-doors.ts:路由是请求入口,不是别处读数据的地方(搬家的完整理由,以及
  // 「多一个导出会炸 next build」这个说法为什么在本 app 上不成立,都写在那个文件里)。
  // 第三道门(验证信重发)从清单里消失时,下面的断言会立刻红,而不是安静地少测一道门。
  let PUBLIC_DOORS: readonly string[] = [];
  beforeAll(async () => {
    ({ HOURLY_PUBLIC_DOORS: PUBLIC_DOORS } = await import("@/lib/public-auth-doors"));
  });

  it("路由清单就是这三道门 —— 少一道就是少一道闸", () => {
    expect([...PUBLIC_DOORS].sort()).toEqual(
      ["/request-password-reset", "/send-verification-email", "/sign-up/email"].sort(),
    );
  });

  beforeEach(async () => {
    const { prisma: db } = await import("@fikirtive/db");
    await db.rateLimitCounter.deleteMany({});
  });

  it("每小时闸在我们自己的计数器上,不再在 BA 的 customRules 里", async () => {
    const ctx = await auth.$context;
    const rules = (ctx.options.rateLimit?.customRules ?? {}) as Record<string, unknown>;
    for (const path of PUBLIC_DOORS) {
      // 一条库执行不出来的规则比没有规则更糟:它让人以为门是关着的。
      expect(rules[path], `${path} 又回到了 customRules —— 那里的每小时窗口执行不出来`).toBeUndefined();
    }
    const { PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } = await import("@/lib/rate-limit-gates");
    expect(PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR).toBeGreaterThan(0);
  });

  it("BA 这一层的计数落库,所以它自带的突发规则跨实例共享(而不是每个实例一份)", async () => {
    const ctx = await auth.$context;
    expect(ctx.options.rateLimit?.storage).toBe("database");
    expect(ctx.options.rateLimit?.modelName).toBe("BetterAuthRateLimit");
  });

  it("行为上:同一个出口地址把每小时闸打满之后,公开门回 429", async () => {
    // 走的是真实请求路径(路由包装层),不是配置断言。用密码重置这道门:它不建账号、不发信
    // (地址不在名单上),所以这条用例只花计数,不留下别的痕迹。
    // 注:BA 自己的限流器在测试环境是关的(它默认只在生产开),所以这里量到的就是我们这一层。
    const { POST } = await import("@/app/api/better-auth/[...all]/route");
    const { PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } = await import("@/lib/rate-limit-gates");
    const press = () =>
      POST(
        new Request("http://localhost:3100/api/better-auth/request-password-reset", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
          body: JSON.stringify({ email: newEmail(), redirectTo: "/" }),
        }),
      );

    for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      expect((await press()).status, `第 ${i + 1} 次不该被闸拦`).not.toBe(429);
    }
    const refused = await press();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("X-Retry-After"))).toBeGreaterThan(0);
  }, 120_000);

  it("每道门各有各的桶 —— 打满其中一道,另外每一道都还是满额(逐门实测)", async () => {
    const { consumePublicAuthDoor, PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } = await import("@/lib/rate-limit-gates");
    const headers = new Headers({ "x-forwarded-for": "203.0.113.78" });

    // 打满第一道。
    const [spent, ...others] = PUBLIC_DOORS;
    for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      expect(await consumePublicAuthDoor(spent!, headers)).toBeNull();
    }
    expect(await consumePublicAuthDoor(spent!, headers)).toBeGreaterThan(0);

    // 其余每一道都必须还是满额 —— r5:上一版只验了一道,第三道门(验证信重发)没人看着。
    expect(others.length).toBeGreaterThan(1);
    for (const door of others) {
      expect(await consumePublicAuthDoor(door, headers), `${door} 不该被 ${spent} 的预算连累`).toBeNull();
    }
  }, 120_000);
});
