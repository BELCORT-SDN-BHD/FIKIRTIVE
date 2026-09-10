import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } from "@/lib/rate-limit-gates";
import { HOURLY_PUBLIC_DOORS } from "@/lib/public-auth-doors";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});
describe("better-auth route handler", () => {
  it("exports GET and POST", async () => {
    const mod = await import("@/app/api/better-auth/[...all]/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});

/**
 * SIGNIN-A4 —— 密码门的每小时闸随密码一起退役。
 *
 * #795 曾在这一层给 `/sign-in/email` 加过一道「每出口地址每小时 30 次」的闸,补 Better Auth
 * 「10 秒 3 次」挡不住的耐心型撞库。密码整体退役之后(docs/specs/sign-in.md 已冻结 · v1)那条
 * 路径在 router 层就 404,闸没有门可守 —— 而且闸跑在**转发之前**,留着它,第 31 次请求读到的
 * 会是 429 而不是验收 A4 要的「一律 404」,等于给一个已退役的端点留一个可探测的回声。
 *
 * 所以这个 describe 钉的是退役之后的性质:打多少次都还是 404,而且不留计数行。
 */
describe("SIGNIN-A4 退役的密码路径:打多少次都是 404,不是 429", () => {
  const RETIRED = ["/sign-in/email", "/sign-up/email", "/request-password-reset"] as const;
  const post = async (path: string, ip: string) => {
    const { POST } = await import("@/app/api/better-auth/[...all]/route");
    return POST(
      new Request(`http://localhost:3100/api/better-auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: "nobody@shop.test", password: "wrong-password-x", redirectTo: "/" }),
      }),
    );
  };

  beforeEach(async () => {
    await prisma.rateLimitCounter.deleteMany({});
    await prisma.betterAuthRateLimit.deleteMany({});
  });

  it("SIGNIN-A4 —— 同一出口地址连打,远超旧额度,次次 404", async () => {
    const ip = "203.0.113.60";
    for (const path of RETIRED) {
      for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR + 3; i += 1) {
        const res = await post(path, ip);
        expect(res.status, `${path} 第 ${i + 1} 次不是 404,而是 ${res.status}`).toBe(404);
      }
    }
  }, 120_000);

  it("SIGNIN-A4 —— 退役路径一行计数都不留(闸已经不在它们前面)", async () => {
    const ip = "203.0.113.61";
    for (const path of RETIRED) await post(path, ip);
    expect(await prisma.rateLimitCounter.findMany({ select: { key: true } })).toEqual([]);
  }, 120_000);
});

/**
 * #795 r2 判词 P1-1 —— 公开门的**每小时**闸,以及它为什么必须在这一层。
 *
 * 这些门原本是 Better Auth 的 customRules(每小时 5 次)。把它的计数挪进数据库之后,那个数
 * 字就成了假的:它清理过期行的截止时间是 max(全局 window, 自带规则) = 60 秒,而且清理时**不看**
 * 当时命中的那条规则 —— 行在最后一次请求之后 61 秒被删,「每小时 5 次」执行成「每分钟 5 次」。
 *
 * 下面第二条就是照着这个形状做的:先把额度用满,然后按 Better Auth 自己的清理语义把它那张表里
 * 超过 60 秒的行删掉,再打一次。小时桶必须还在。
 *
 * SIGNIN-A4 —— 清单原本三道门,密码那两道随密码退役(见上一个 describe 与 lib/public-auth-doors.ts),
 * 今天只剩验证信重发这一道。门的名字从**唯一那份清单**读出来,少一道当场红。
 */
describe("#795 r2 公开门的每小时闸", () => {
  const DOOR = HOURLY_PUBLIC_DOORS[0];
  const post = async (path: string, ip: string) => {
    const { POST } = await import("@/app/api/better-auth/[...all]/route");
    return POST(
      new Request(`http://localhost:3100/api/better-auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: "nobody@shop.test", redirectTo: "/" }),
      }),
    );
  };

  beforeEach(async () => {
    await prisma.rateLimitCounter.deleteMany({});
    await prisma.betterAuthRateLimit.deleteMany({});
  });

  it("门的清单就是 HOURLY_PUBLIC_DOORS —— 少一道就是少一道闸", () => {
    expect([...HOURLY_PUBLIC_DOORS]).toEqual(["/send-verification-email"]);
  });

  it("同一出口地址打满之后回 429,并带 X-Retry-After", async () => {
    const ip = "203.0.113.70";
    for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      expect((await post(DOOR, ip)).status, `第 ${i + 1} 次不该被闸拦`).not.toBe(429);
    }
    const refused = await post(DOOR, ip);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("X-Retry-After"))).toBeGreaterThan(0);
    // BA 自己那句话,逐字 —— 客户端读到的东西不因为是哪一层拒的而改变。
    await expect(refused.json()).resolves.toEqual({ message: "Too many requests. Please try again later." });
  }, 120_000);

  it("计数只按出口地址,键里没有邮箱", async () => {
    const ip = "203.0.113.71";
    await post(DOOR, ip);
    const keys = (await prisma.rateLimitCounter.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys).toEqual([`authdoor:${DOOR}:${ip}`]);
    for (const key of keys) expect(key).not.toContain("@");
  }, 120_000);

  it("Better Auth 按它自己的 60 秒截止清完表之后,小时桶仍然拦得住", async () => {
    const ip = "203.0.113.72";
    for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR; i += 1) await post(DOOR, ip);
    expect((await post(DOOR, ip)).status).toBe(429);

    // Better Auth 的 deleteExpiredRows,逐字同形:lastRequest 早于 now-60s 的行全删。
    await prisma.betterAuthRateLimit.deleteMany({ where: { lastRequest: { lt: Date.now() - 60_000 } } });
    // 再狠一点:把它那张表整个清空(等价于「61 秒过去了」的极端情形)。
    await prisma.betterAuthRateLimit.deleteMany({});

    // RED 的是上一版:小时额度活在 ba_rate_limit 里,清掉就等于重新发一份预算。
    expect((await post(DOOR, ip)).status).toBe(429);
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: "authdoor:" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBeGreaterThanOrEqual(PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR);
  }, 120_000);
});
