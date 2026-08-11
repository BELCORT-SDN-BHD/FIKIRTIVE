/**
 * #795 —— Better Auth 的限流台账落库,以及 Google 令牌不再明文。
 *
 * 这两件事都只是配置里的一行,而「配置里的一行」正是最容易在下一次编辑里被顺手删掉、
 * 而且删掉之后**什么都不会报错**的东西:限流退回进程内存,不报错,只是数字变假;
 * 令牌退回明文,不报错,只是备份里多了一把每个商家的 Google 钥匙。所以两行都上钉板。
 *
 * 第二组用例钉的是另一件事:BA 的 database storage 会对这张表做哪几种操作。它按自己的
 * 契约写(key/count/lastRequest,lastRequest 是 epoch 毫秒的 bigint),而毫秒是 JS 的
 * number —— number 能不能写进 bigint 列、能不能在 where 里跟 bigint 比大小,不是读代码
 * 能确定的事,所以这里对真库跑一遍它那三种操作。
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
});

describe("#795 Better Auth 限流不再活在进程内存里", () => {
  it("storage=database,并指向我们自己的表", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(auth.options.rateLimit?.storage).toBe("database");
    expect(auth.options.rateLimit?.modelName).toBe("BetterAuthRateLimit");
  });

  /**
   * r2 判词 P1-1 的围栏。
   *
   * Better Auth 的 database storage 清理过期行时用的截止时间是
   *   max(rateLimit.window, ...它自带的 special rules) = max(10s, 10s, 60s) = 60s,
   * 而且它**不看**当时命中的那条 customRule。所以任何窗口大于 60 秒的 customRule 都是假的:
   * 行会在最后一次请求之后 61 秒被删掉,「每小时 5 次」实际执行成「每分钟 5 次」。
   *
   * 这条断言把那个陷阱变成机器规则:谁再往 customRules 里写一条一小时的规则,这里当场红。
   * 小时级的门在 app/api/better-auth/[...all]/route.ts,走我们自己的计数器。
   */
  it("customRules 里没有任何窗口超过库自己清理截止时间的规则", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    const rules: Array<[string, unknown]> = Object.entries(auth.options.rateLimit?.customRules ?? {});
    const PRUNE_CUTOFF_SECONDS = 60;
    for (const [path, rule] of rules) {
      // 只有「静态规则对象」才有可核对的窗口;函数形式的规则在请求时才定,不在这条围栏的射程内。
      const window = (rule as { window?: unknown } | null)?.window;
      if (typeof window !== "number") continue;
      expect(
        window,
        `${path} 的窗口是 ${window}s,超过库的 ${PRUNE_CUTOFF_SECONDS}s 清理截止 —— 它执行不出这个数`,
      ).toBeLessThanOrEqual(PRUNE_CUTOFF_SECONDS);
    }
  });

  it("密码门**不**在 customRules 里 —— 那里写一条会把 BA 自带的突发规则替换掉", async () => {
    // customRules 是「替换」不是「叠加」。密码门的每小时闸因此活在路由层
    // (app/api/better-auth/[...all]/route.ts),BA 自带的 10 秒 3 次留在原处。
    const { auth } = await import("@/lib/better-auth/server");
    const rules = (auth.options.rateLimit?.customRules ?? {}) as Record<string, unknown>;
    expect(rules["/sign-in/email"]).toBeUndefined();
  });
});

describe("#795 Google 令牌不再明文入库", () => {
  it("encryptOAuthTokens 打开", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });
});

describe("#795 ba_rate_limit 的读写契约(BA 的 database storage 真会这么用)", () => {
  beforeEach(async () => {
    await prisma.betterAuthRateLimit.deleteMany({});
  });

  it("epoch 毫秒(JS number)写得进 bigint 列,读回来还是同一个数", async () => {
    const now = Date.now();
    await prisma.betterAuthRateLimit.create({ data: { id: "rl-1", key: "1.2.3.4/sign-in", count: 1, lastRequest: now } });
    const row = await prisma.betterAuthRateLimit.findFirst({ where: { key: "1.2.3.4/sign-in" } });
    expect(Number(row?.lastRequest)).toBe(now);
    expect(row?.count).toBe(1);
  });

  it("带守卫的自增(BA 的原子步骤)：窗口内且未满才 +1", async () => {
    const now = Date.now();
    await prisma.betterAuthRateLimit.create({ data: { id: "rl-2", key: "k2", count: 1, lastRequest: now } });
    const windowStart = now - 10_000;

    // 未满 → 命中一行并 +1(BA 用 lastRequest > windowStart 且 count < max 做守卫)。
    const hit = await prisma.betterAuthRateLimit.updateMany({
      where: { key: "k2", lastRequest: { gt: windowStart }, count: { lt: 3 } },
      data: { count: { increment: 1 }, lastRequest: now },
    });
    expect(hit.count).toBe(1);

    // 已满 → 守卫不命中,一行都不动(这就是「超额」被判出来的方式)。
    await prisma.betterAuthRateLimit.update({ where: { key: "k2" }, data: { count: 3 } });
    const miss = await prisma.betterAuthRateLimit.updateMany({
      where: { key: "k2", lastRequest: { gt: windowStart }, count: { lt: 3 } },
      data: { count: { increment: 1 }, lastRequest: now },
    });
    expect(miss.count).toBe(0);
  });

  it("过期行按 lastRequest 清理(BA 自己会清,清的是这张表)", async () => {
    const now = Date.now();
    await prisma.betterAuthRateLimit.createMany({
      data: [
        { id: "rl-3", key: "old", count: 1, lastRequest: now - 24 * 60 * 60 * 1000 },
        { id: "rl-4", key: "live", count: 1, lastRequest: now },
      ],
    });
    const deleted = await prisma.betterAuthRateLimit.deleteMany({ where: { lastRequest: { lt: now - 60_000 } } });
    expect(deleted.count).toBe(1);
    expect(await prisma.betterAuthRateLimit.count()).toBe(1);
  });

  it("key 唯一 —— 一个(地址,路径)只可能有一行计数", async () => {
    await prisma.betterAuthRateLimit.create({ data: { id: "rl-5", key: "dup", count: 1, lastRequest: Date.now() } });
    await expect(
      prisma.betterAuthRateLimit.create({ data: { id: "rl-6", key: "dup", count: 1, lastRequest: Date.now() } }),
    ).rejects.toThrow();
  });
});
