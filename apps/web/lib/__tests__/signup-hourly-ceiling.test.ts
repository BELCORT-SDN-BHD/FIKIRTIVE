/**
 * SIGNIN-A17 —— 全站每小时新账号上限与告警（docs/specs/sign-in.md 已冻结 · v1 §1.5，验收表
 * 第 17 格后半句）。
 *
 * 为什么需要它：码门对陌生人打开之后，开户不再需要任何邀请，而每一个新工作区都会拿到一笔
 * `SIGNUP_GRANT_CREDITS` 的真实供应商成本。归一化的赠金键挡掉了「同一个真实收件箱的一堆变体」
 * （signup-grant-exactly-once.test.ts 的 A17 三条），这条闸挡的是另一半：一千个**互不相同**的
 * 真实地址。
 *
 * 三件事在这里被钉住，第三件最容易被忘：
 *   ① 前 50 个新账号进得来，第 51 个进不来；
 *   ② 撞到上限会**触发告警**（Sentry），因为未公测零商家，一小时 50 个新注册本身就是异常；
 *   ③ **老用户登录不受影响** —— 计数只发生在「真的建一个新账号」那一刻。
 *
 * 真库、真 Better Auth、真限流计数器；只有邮件传输与 Sentry 是替身。
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", () => ({ captureMessage }));

type SentEmail = { to: string; devPreview?: string };
const inbox: SentEmail[] = [];
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailPort: { send: vi.fn(async (m: SentEmail) => { inbox.push(m); }) },
  };
});

process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
/** 一个老商家，用来证明第 51 格的拒绝只挡开户、不挡登录。 */
const REGULAR = `a17-regular-${randomUUID()}@fikirtive.test`;
process.env.AUTH_ALLOWED_EMAILS = REGULAR;
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

const { prisma } = await import("@fikirtive/db");
const { clearRateLimitCounters } = await import("@fikirtive/db/rate-limit");
const { auth } = await import("@/lib/better-auth/server");
const { NEW_ACCOUNTS_PER_HOUR } = await import("@/lib/rate-limit-gates");
const {
  enqueueAuthEmail,
  authEmailQueueSettled,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
} = await import("@/lib/better-auth/sender");

const ORIGIN = "http://localhost:3100";
const addresses: string[] = [REGULAR];

async function signIn(email: string): Promise<Response> {
  inbox.length = 0;
  enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
  await authEmailQueueSettled();
  const otp = inbox.find((m) => m.to === email.toLowerCase())?.devPreview;
  return auth.handler(
    new Request(`${ORIGIN}/api/better-auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, otp: otp ?? "000000" }),
    }),
  );
}

function newAddress(): string {
  const email = `a17-new-${randomUUID()}@fikirtive.test`;
  addresses.push(email);
  return email;
}

beforeEach(async () => {
  captureMessage.mockClear();
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  await __resetAuthEmailCapsForTests();
  await clearRateLimitCounters("signup:site");
});

describe("SIGNIN-A17 —— 全站每小时新账号上限", () => {
  /**
   * 上限默认 50，把它跑满要开 50 个真账号（每个都带工作区、成员身份和一笔赠金），在真库上太慢。
   * 所以这里把桶**预先花掉**到只剩一格：花的是同一个 key、同一个计数器，跑的是同一条闸 ——
   * 与「真开 50 个号」在这条闸看来是同一件事。
   */
  async function spendCeilingToLastSlot() {
    const { consumeNewAccountGate } = await import("@/lib/rate-limit-gates");
    for (let i = 0; i < NEW_ACCOUNTS_PER_HOUR - 1; i++) {
      expect(await consumeNewAccountGate()).toBe(true);
    }
  }

  it("SIGNIN-A17 —— 上限内的新账号照常建立", async () => {
    await spendCeilingToLastSlot();
    const email = newAddress();
    expect((await signIn(email)).status).toBe(200);
    expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(1);
  });

  it("SIGNIN-A17 —— 撞上上限之后，下一个新账号进不来、一行都没写，并触发告警", async () => {
    await spendCeilingToLastSlot();
    expect((await signIn(newAddress())).status).toBe(200); // 最后一格

    const refused = newAddress();
    const res = await signIn(refused);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("session_token");
    // 一行都没写下去：账号、名单、工作区都没有他。
    expect(await prisma.betterAuthUser.count({ where: { email: refused } })).toBe(0);
    expect(await prisma.allowedEmail.count({ where: { email: refused } })).toBe(0);

    // 告警要人看一眼，而且不许把邮箱写进告警文本（#575 日志纪律）。
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [title, options] = captureMessage.mock.calls[0]!;
    expect(String(title)).toContain("New accounts per hour ceiling reached");
    expect(String(title)).not.toContain(refused);
    expect(JSON.stringify(options)).not.toContain(refused);
  });

  it("SIGNIN-A17 —— 上限撞满之后，老用户照常登录（这条闸只挡开户）", async () => {
    // 老商家先登录一次，让账号存在。
    expect((await signIn(REGULAR)).status).toBe(200);

    // 现在把这一小时的开户额度整个花光。
    const { consumeNewAccountGate } = await import("@/lib/rate-limit-gates");
    for (let i = 0; i < NEW_ACCOUNTS_PER_HOUR; i++) await consumeNewAccountGate();
    expect(await consumeNewAccountGate()).toBe(false);
    captureMessage.mockClear();

    // 陌生人此刻进不来……
    expect((await signIn(newAddress())).status).toBeGreaterThanOrEqual(400);
    // ……而老商家的下一次登录完全不受影响，也不该多出一条告警。
    captureMessage.mockClear();
    expect((await signIn(REGULAR)).status).toBe(200);
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

afterAll(async () => {
  __configureAuthEmailQueueForTests({});
  await clearRateLimitCounters("signup:site");
  try {
    await prisma.betterAuthVerification.deleteMany({
      where: { identifier: { contains: "a17-" } },
    });
    const users = await prisma.betterAuthUser.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
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
    await prisma.signupGrantClaim.deleteMany({ where: { canonicalEmail: { in: addresses } } });
  } catch {
    /* best-effort cleanup */
  }
});
