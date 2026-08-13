/**
 * #795 r7 —— Better Auth 自己的短窗闸,按**我们这一个权威地址**分桶,而且验的是**真实路由**。
 *
 * 为什么这个文件必须存在,而不是在别处多加两条断言:
 *
 *   ① BA 默认取址读 `X-Forwarded-For` 的第一段(`utils/get-request-ip.mjs`)。我们的平台
 *      (Railway)不发这个头,而 Next 会拿平台代理的 socket 地址补一个进去
 *      (`base-server.js`:`req.headers['x-forwarded-for'] ??= originalRequest.socket.remoteAddress`)。
 *      于是 BA 自带的「10 秒 3 次」会按**代理地址**分桶 —— 全部真实商家共用一个桶,登录门对
 *      所有人一起关上。这是一次全站规模的自我拒服。
 *   ② BA 的限流在测试环境默认是关的(`enabled ?? isProduction`,`context/create-context.mjs`)。
 *      所以取址错了,普通用例一声不吭。这里用**真实配置**另起一个实例,只把 `enabled` 掀开。
 *   ③ r5 的用例手工调盖章函数、再直接进实例,**绕过了路由**:把路由里的盖章调用删掉,它们
 *      照样绿。所以这里改成 mock 掉 `@/lib/better-auth/server` 的 `auth`(换成开着限流的同一
 *      份配置),然后驱动**真实的 route 导出** —— 盖章接线被删,下面立刻红。
 *
 * 红演习(r7 实跑):把 route.ts 里 `forward.POST` 的 `withCallerIdentityHeader(...)` 换成
 * 原样透传,前两条用例当场转红;还原后全绿。
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@fikirtive/db";

process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "";

/**
 * 同一份真实配置,只掀开 `enabled`。**不是**另写一份配置 —— 另写一份就只能证明那份写得对。
 */
vi.mock("@/lib/better-auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/better-auth/server")>();
  const { betterAuth } = await import("better-auth");
  return {
    ...actual,
    auth: betterAuth({
      ...actual.auth.options,
      rateLimit: { ...actual.auth.options.rateLimit, enabled: true },
    }),
  };
});

const SIGN_IN = "http://localhost:3100/api/better-auth/sign-in/email";
/** BA 自带的特殊规则:每条 /sign-in 路径 10 秒 3 次。 */
const BURST_MAX = 3;
const PASSWORD = "correct-horse-battery-staple";

beforeAll(() => {
  // 生产形态,正是取址出问题的那一个。
  process.env.CALLER_IP_SOURCE = "railway";
});

afterAll(() => {
  // 环境变量是**进程级**的:留着它,同一个 worker 里后跑的文件会按 railway 解析自己的请求头。
  delete process.env.CALLER_IP_SOURCE;
});

beforeEach(async () => {
  await prisma.betterAuthRateLimit.deleteMany({});
  await prisma.rateLimitCounter.deleteMany({}); // 我们那道每小时密码门也在这条路上(30/小时)
});

/** 走**真实路由导出**。盖章是路由的活,所以这里绝不自己盖。 */
async function press(headers: Record<string, string>) {
  const { POST } = await import("@/app/api/better-auth/[...all]/route");
  return POST(
    new Request(SIGN_IN, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email: `nobody-${randomUUID()}@fikirtive.test`, password: PASSWORD }),
    }),
  );
}

describe("#795 r7 · BA 的短窗闸跟着同一个权威地址走(经真实路由)", () => {
  it("两个真实商家 = 两个桶(不是一起被关在门外)", async () => {
    for (let i = 0; i < BURST_MAX; i += 1) {
      expect((await press({ "x-real-ip": "203.0.113.90" })).status, `第 ${i + 1} 次`).not.toBe(429);
    }
    // 第一个人用完了自己那 3 次(我们的每小时密码门是 30 次,还远没到,所以这一下是 BA 的)。
    expect((await press({ "x-real-ip": "203.0.113.90" })).status).toBe(429);
    // 第二个人一点都没被连累 —— 这正是取址错了会整站连坐的那一格。
    expect((await press({ "x-real-ip": "198.51.100.90" })).status).not.toBe(429);
  }, 120_000);

  it("伪造的 X-Forwarded-For 换不了桶(想换个身份接着敲,换不了)", async () => {
    for (let i = 0; i < BURST_MAX; i += 1) {
      await press({ "x-real-ip": "203.0.113.91", "x-forwarded-for": `9.9.9.${i}` });
    }
    expect((await press({ "x-real-ip": "203.0.113.91", "x-forwarded-for": "1.2.3.4" })).status).toBe(429);
  }, 120_000);

  it("调用方自带的合成头会被丢掉 —— 那个头只有我们能写", async () => {
    const { CALLER_IP_HEADER } = await import("@/lib/caller-identity");
    for (let i = 0; i < BURST_MAX; i += 1) await press({ "x-real-ip": "203.0.113.92" });
    // 直接伪造合成头想开一个新桶 —— 盖章先删后写,所以还是同一个桶。
    expect((await press({ "x-real-ip": "203.0.113.92", [CALLER_IP_HEADER]: "8.8.8.8" })).status).toBe(429);
  }, 120_000);

  it("认不出来的调用方共用一个桶(不是一人一份新预算)", async () => {
    // railway 形态下没有 X-Real-IP = 认不出来:路由不盖头,BA 落到它自己的共用桶
    // (`NO_TRUSTED_IP_KEY`),与我们这边的 UNKNOWN_CALLER 同义。
    for (let i = 0; i < BURST_MAX; i += 1) await press({});
    expect((await press({})).status).toBe(429);
    // 换一批伪造的 XFF 也还是同一个共用桶。
    expect((await press({ "x-forwarded-for": "5.5.5.5" })).status).toBe(429);
  }, 120_000);
});
