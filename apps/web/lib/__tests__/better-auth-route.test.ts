import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import { PASSWORD_DOOR_PER_CALLER_PER_HOUR } from "@/lib/rate-limit-gates";

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
 * #795 —— 密码门的每小时闸。
 *
 * Better Auth 自带的规则是「10 秒 3 次」。它挡得住冲量,对**耐心**的那种完全无效:
 * 3 次/10 秒 就是一个地址一小时一千多次,而且可以一直这样下去。每小时闸必须写在这一层
 * 而不是 BA 的 customRules —— 那张表是「替换」不是「叠加」,在那里写一条每小时规则等于
 * 把它本来要加固的那条突发规则删掉。
 *
 * 计数只按**出口地址**,永远不看提交上来的邮箱:429 绝不能被读成「这个账号存在」。
 */
describe("#795 密码门:耐心型攻击也有上限", () => {
  const post = async (path: string, ip: string, body: unknown = {}) => {
    const { POST } = await import("@/app/api/better-auth/[...all]/route");
    return POST(
      new Request(`http://localhost:3100/api/better-auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body),
      }),
    );
  };

  beforeEach(async () => {
    await prisma.rateLimitCounter.deleteMany({});
  });

  it("同一出口地址打满之后回 429,并带 X-Retry-After", async () => {
    const ip = "203.0.113.60";
    for (let i = 0; i < PASSWORD_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      const res = await post("/sign-in/email", ip, { email: "nobody@shop.test", password: "wrong-password-x" });
      // 凭据本身当然是错的;这里只要求**不是**被闸拦下的那个状态码。
      expect(res.status).not.toBe(429);
    }
    const refused = await post("/sign-in/email", ip, { email: "nobody@shop.test", password: "wrong-password-x" });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("X-Retry-After"))).toBeGreaterThan(0);
    // BA 自己那句话,逐字 —— 客户端读到的东西不因为是哪一层拒的而改变。
    await expect(refused.json()).resolves.toEqual({ message: "Too many requests. Please try again later." });
  }, 120_000);

  it("计数与提交的邮箱无关 —— 换邮箱不换预算,而且键里没有邮箱", async () => {
    const ip = "203.0.113.61";
    for (let i = 0; i < PASSWORD_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      await post("/sign-in/email", ip, { email: `probe-${i}@shop.test`, password: "wrong-password-x" });
    }
    const refused = await post("/sign-in/email", ip, { email: "brand-new@shop.test", password: "wrong-password-x" });
    expect(refused.status).toBe(429);
    const keys = (await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: "pw:" } } })).map((r) => r.key);
    expect(keys).toEqual(["pw:203.0.113.61"]);
  }, 120_000);
});
