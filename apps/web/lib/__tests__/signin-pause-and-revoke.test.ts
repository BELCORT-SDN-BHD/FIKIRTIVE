/**
 * 暂停新注册（SIGNIN-A6）与撤销（SIGNIN-A7）—— docs/specs/sign-in.md 已冻结 · v1，切片④
 * （issue #1319）。
 *
 * 每一条用例都跑**真的** Better Auth 与**真的**本机 Postgres；只有邮件传输是假的，而且它假成
 * 一个收件箱而不是一个 spy —— 「暂停期间不寄码」在这里是「收件箱里一封都没有」，不是「某个
 * mock 没被调用」。
 *
 * 为什么两扇门要各自出现在这里：规格 §1.6 写的是「两扇门一致，三处名单检查同一函数」。码门
 * 走的是 `/sign-in/email-otp` 那条真路；Google 门的回调没法在单测里伪造（要签名的 OAuth state
 * 加上 Google 的 token/userinfo 两个端点），所以它走的是**它自己在库里那条缝**：
 * `internalAdapter.createOAuthUser` —— better-auth 的 `link-account.mjs` 在回调里调的正是它，
 * 而 `databaseHooks.user.create.before`（门）就挂在它下面。
 *
 * ⚠️ 本文件不证明 A6 的「页顶横幅」那一半：横幅落在 `app/login/page.tsx`，不在切片④的写集内
 * （见 PR 描述的未做项）。测试名只挂它真的证明的那部分。
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";

type SentEmail = { to: string; subject: string; text?: string; html?: string; devPreview?: string };
const inbox: SentEmail[] = [];

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailPort: { send: vi.fn(async (m: SentEmail) => { inbox.push(m); }) },
  };
});

// Better Auth reads these at construction, which happens during the imports below.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
// A founder that is nobody in this file, and an empty env allowlist: every verdict below must
// owe itself to the switch or to the AllowedEmail row, never to a name in an env variable.
process.env.FOUNDER_ADMIN_EMAILS = "nobody-signin4@fikirtive.test";
process.env.AUTH_ALLOWED_EMAILS = "";

const { prisma } = await import("@fikirtive/db");
const { auth } = await import("@/lib/better-auth/server");
const { isAllowedEmail } = await import("@/lib/allowlist");
const { revokeEmailAccess } = await import("@/lib/signup-gate");
const {
  enqueueAuthEmail,
  authEmailQueueSettled,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
} = await import("@/lib/better-auth/sender");
const { clearRateLimitCounters } = await import("@fikirtive/db/rate-limit");

const ORIGIN = "http://localhost:3100";

/** Every address this file touches, so teardown can take its rows back out of the shared DB. */
const addresses: string[] = [];
function newAddress(tag: string): string {
  const email = `signin4-${tag}-${randomUUID()}@fikirtive.test`;
  addresses.push(email);
  return email;
}

/** Ask for a code the way the login page does — through the queue — and read what arrived. */
async function requestCode(email: string): Promise<string | undefined> {
  inbox.length = 0;
  enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
  await authEmailQueueSettled();
  return inbox.find((m) => m.to === email.trim().toLowerCase())?.devPreview;
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

/** Walk a stranger all the way in through the code door, and hand back their session cookie. */
async function signInThroughCodeDoor(email: string): Promise<string> {
  const code = await requestCode(email);
  expect(code).toMatch(/^\d{6}$/);
  const res = await submitCode(email, code!);
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("session_token");
  return setCookie.split(";")[0] as string;
}

const sessionsFor = (email: string) => prisma.betterAuthSession.count({ where: { user: { email } } });
const usersFor = (email: string) => prisma.betterAuthUser.count({ where: { email } });
const statusOf = (email: string) =>
  prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } }).then((r) => r?.status ?? null);

/**
 * Google 门那条缝。`link-account.mjs` 在回调里调的是 `internalAdapter.createOAuthUser`，
 * 所以拿它当 Google 门的替身不是近似 —— 它就是回调自己走的那一步，`user.create.before`
 * （三步判定）挂在它下面。
 */
async function googleDoorCreateUser(email: string): Promise<unknown> {
  const ctx = await auth.$context;
  return ctx.internalAdapter
    .createOAuthUser(
      { email, name: "Google Person", emailVerified: true, image: null },
      { providerId: "google", accountId: `google-${randomUUID()}`, scope: "openid email profile" },
    )
    .then(() => null)
    .catch((e: unknown) => e);
}

beforeAll(async () => {
  await clearRateLimitCounters("signup:site");
});

beforeEach(async () => {
  inbox.length = 0;
  delete process.env.SIGNUPS_PAUSED;
  process.env.AUTH_ALLOWED_EMAILS = "";
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  await __resetAuthEmailCapsForTests();
  await clearRateLimitCounters("signup:site");
  await prisma.betterAuthVerification.deleteMany({ where: { identifier: { contains: "signin4-" } } });
});

afterAll(async () => {
  delete process.env.SIGNUPS_PAUSED;
  __configureAuthEmailQueueForTests({});
  // 每条用例都真的开了账号、工作区和一笔赠金；跑完不收拾，下一个读这个库的人会读到一团噪音。
  // 与 signin-code-door.test.ts 的收尾同款（含它那句 try/catch：收拾失败不许把绿的用例弄红）。
  try {
    await prisma.signupGrantClaim.deleteMany({ where: { canonicalEmail: { in: addresses } } });
    await prisma.betterAuthVerification.deleteMany({ where: { identifier: { contains: "signin4-" } } });
    await prisma.betterAuthUser.deleteMany({ where: { email: { in: addresses } } }); // cascades sessions + accounts
    const canonical = await prisma.user.findMany({ where: { email: { in: addresses } }, select: { id: true } });
    for (const { id } of canonical) {
      await prisma.creditLedger.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.creditAccount.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.membership.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.organization.deleteMany({ where: { id: `org_${id}` } });
    }
    await prisma.user.deleteMany({ where: { email: { in: addresses } } });
    await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  } catch {
    // best-effort teardown
  }
});

// ── SIGNIN-A6 ────────────────────────────────────────────────────────────────────────────────
describe("SIGNIN-A6 —— 暂停新注册", () => {
  /**
   * 「陌生人两扇门都进不来、不建账号、不寄码」的**码门**那一半。
   *
   * RED before this slice: `SIGNUPS_PAUSED` 在密码退役之后没有任何调用点（规格 §5 登记，
   * PR #1336），开关拨到 1 也照寄照建 —— 这条用例正是那句登记的反面。
   */
  it("SIGNIN-A6 —— 暂停期间陌生邮箱按 Continue with email：一封信都不寄，也不建账号", async () => {
    const stranger = newAddress("paused-code");
    process.env.SIGNUPS_PAUSED = "1";

    expect(await requestCode(stranger)).toBeUndefined();
    expect(inbox).toHaveLength(0);
    expect(await prisma.betterAuthVerification.count({ where: { identifier: `sign-in-otp-${stranger}` } })).toBe(0);
    expect(await usersFor(stranger)).toBe(0);
    expect(await statusOf(stranger)).toBeNull();
  });

  /** 同一件事的 **Google 门**那一半，在回调自己走的那条缝上。两扇门同一个函数，所以同一个答案。 */
  it("SIGNIN-A6 —— 暂停期间陌生 Google 账号在建号那一刻被拦，库里不留任何用户行", async () => {
    const stranger = newAddress("paused-google");
    process.env.SIGNUPS_PAUSED = "1";

    const err = await googleDoorCreateUser(stranger);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
    expect(await usersFor(stranger)).toBe(0);
    expect(await statusOf(stranger)).toBeNull();
  });

  /** 「老用户正常进入」—— 开关只关陌生人这一扇，不关已经在里面的人。 */
  it("SIGNIN-A6 —— 暂停期间老商家照常登录、登出、再登录", async () => {
    const merchant = newAddress("paused-regular");
    const firstCookie = await signInThroughCodeDoor(merchant); // 暂停之前先进来一次
    expect(await statusOf(merchant)).toBe("active");

    process.env.SIGNUPS_PAUSED = "1";

    // 登出：会话行消失。
    await auth.handler(
      new Request(`${ORIGIN}/api/better-auth/sign-out`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: firstCookie },
      }),
    );
    expect(await sessionsFor(merchant)).toBe(0);

    // 再登录：暂停期间照样收得到码、照样进得来，而且没有开出第二个账号。
    await __resetAuthEmailCapsForTests();
    const secondCookie = await signInThroughCodeDoor(merchant);
    expect(secondCookie).not.toBe(firstCookie);
    expect(await sessionsFor(merchant)).toBe(1);
    expect(await usersFor(merchant)).toBe(1);
  });
});

// ── SIGNIN-A7 ────────────────────────────────────────────────────────────────────────────────
describe("SIGNIN-A7 —— 撤销一个自助进来的邮箱", () => {
  it("SIGNIN-A7 —— 自助进来的邮箱撤得掉：名单那一行本来是 active，撤销之后是 revoked", async () => {
    const merchant = newAddress("revoke-active");
    await signInThroughCodeDoor(merchant);
    // 这一行的状态正是「只认 invited」那条旧谓词拒绝去碰的那一种（审计 [6]，
    // `revokeTenantInvite` 会回「No pending invite for that address.」）。
    expect(await statusOf(merchant)).toBe("active");

    expect(await revokeEmailAccess(merchant)).toBe("revoked");
    expect(await statusOf(merchant)).toBe("revoked");
  });

  it("SIGNIN-A7 —— 撤销之后下一次请求就没有会话了，不等 cookie 过期", async () => {
    const merchant = newAddress("revoke-session");
    const cookie = await signInThroughCodeDoor(merchant);
    const headers = new Headers({ cookie });
    expect((await auth.api.getSession({ headers }))?.user?.email).toBe(merchant);
    expect(await isAllowedEmail(merchant)).toBe(true);

    await revokeEmailAccess(merchant);

    // ① 会话行在撤销那一笔事务里就没了 —— 同一张 cookie 下一次请求什么也换不到。
    expect(await sessionsFor(merchant)).toBe(0);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    // ② 产品这一侧每个请求还会再问一次名单（requireSession / requireRole / requireOwner）。
    expect(await isAllowedEmail(merchant)).toBe(false);
  });

  it("SIGNIN-A7 —— 撤销之后两扇门都拒，而且不重新建号", async () => {
    const merchant = newAddress("revoke-doors");
    await signInThroughCodeDoor(merchant);
    // 先拿一个还没用过的真码在手上，再撤销 —— 这样「门拒绝」不会被「他没有码」冒充。
    await __resetAuthEmailCapsForTests();
    const liveCode = await requestCode(merchant);
    expect(liveCode).toMatch(/^\d{6}$/);

    await revokeEmailAccess(merchant);

    // 码门：手上的码换不到会话；再要一封码，一封都不寄。
    expect((await submitCode(merchant, liveCode!)).status).toBeGreaterThanOrEqual(400);
    expect(await sessionsFor(merchant)).toBe(0);
    await __resetAuthEmailCapsForTests();
    expect(await requestCode(merchant)).toBeUndefined();
    // Google 门：同一个地址在回调那条缝上被拦。
    expect(await googleDoorCreateUser(merchant)).toBeInstanceOf(APIError);
    // 「不重新建号」：从头到尾只有那一个用户行。
    expect(await usersFor(merchant)).toBe(1);
  });

  it("SIGNIN-A7 —— 撤销只落在那一个邮箱：隔壁商家的会话与两扇门原样", async () => {
    const target = newAddress("revoke-target");
    const neighbour = newAddress("revoke-neighbour");
    await signInThroughCodeDoor(target);
    await __resetAuthEmailCapsForTests();
    const neighbourCookie = await signInThroughCodeDoor(neighbour);

    await revokeEmailAccess(target);

    expect(await sessionsFor(target)).toBe(0);
    expect(await sessionsFor(neighbour)).toBe(1);
    expect((await auth.api.getSession({ headers: new Headers({ cookie: neighbourCookie }) }))?.user?.email).toBe(neighbour);
    expect(await statusOf(neighbour)).toBe("active");
    expect(await isAllowedEmail(neighbour)).toBe(true);
    await __resetAuthEmailCapsForTests();
    expect(await requestCode(neighbour)).toMatch(/^\d{6}$/);
  });

  /**
   * 判官在登录门② 抓到的那一刀，钉在这里：`AUTH_ALLOWED_EMAILS` 命中以前会**短路**掉撤销那一步
   * （`return { known: true, revoked: false }`），于是写在那个变量里的地址撤了等于没撤。
   *
   * RED before this slice：下面四条断言里，两扇门那两条与 `isAllowedEmail` 那条都会绿成「进得来」。
   */
  it("SIGNIN-A7 —— 环境变量名单命中仍然查撤销：AUTH_ALLOWED_EMAILS 里的地址被撤销后照样进不来", async () => {
    const merchant = newAddress("revoke-envlisted");
    await signInThroughCodeDoor(merchant);
    // 操作员把这个地址也写进了环境名单（生产里这是常有的事：先手工放行，再让他自助登录）。
    process.env.AUTH_ALLOWED_EMAILS = merchant;

    await revokeEmailAccess(merchant);

    expect(await isAllowedEmail(merchant)).toBe(false);
    expect(await sessionsFor(merchant)).toBe(0);
    await __resetAuthEmailCapsForTests();
    expect(await requestCode(merchant)).toBeUndefined();
    expect(await googleDoorCreateUser(merchant)).toBeInstanceOf(APIError);
  });

  /** 重复撤销是幂等的：第二次不改那一行的时间戳，也不该报错。 */
  it("SIGNIN-A7 —— 再撤一次答 already_revoked，从没进来过的地址答 unknown", async () => {
    const merchant = newAddress("revoke-twice");
    await signInThroughCodeDoor(merchant);
    expect(await revokeEmailAccess(merchant)).toBe("revoked");
    expect(await revokeEmailAccess(merchant)).toBe("already_revoked");
    expect(await revokeEmailAccess(`nobody-${randomUUID()}@fikirtive.test`)).toBe("unknown");
  });
});
