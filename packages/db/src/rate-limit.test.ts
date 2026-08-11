/**
 * #795 —— 跨实例限流计数器(打真库)。
 *
 * 这一族测试钉的是三条性质,而不是「限流大致能用」:
 *   ① 被拒的一次不加计数、不推窗口(#757 已经买过一次教训:让拒绝推窗口,窗口就永远不结束,
 *      同一个出口后面的其他人被连坐);
 *   ② 多个桶要么一起记账要么都不记(否则还有余额的那个桶会替被另一个桶拒掉的请求买单);
 *   ③ 两种判决做同样的事(拒绝也写一次行),所以外面量不出「这次是被拒了还是放行了」。
 *
 * 还有一条不是性质而是事实:计数在**库里**。同一个 key 从两个「实例」打过来,共用一份预算。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./index.js";
import { consumeRateLimit, pruneRateLimitCounters } from "./rate-limit.js";

const MINUTE = 60_000;

beforeEach(async () => {
  await prisma.rateLimitCounter.deleteMany({});
});

/** 直接读行,用来核对「拒绝没有动过计数/窗口」这类断言。 */
async function row(key: string) {
  const found = await prisma.rateLimitCounter.findUnique({ where: { key } });
  return found ? { count: found.count, expiresAt: Number(found.expiresAt) } : null;
}

describe("#795 consumeRateLimit — 基本额度", () => {
  it("窗口内放行 max 次,第 max+1 次被拒", async () => {
    const bucket = { key: "door:a", max: 3, windowMs: 10 * MINUTE };
    const now = 1_000_000;
    for (let i = 1; i <= 3; i += 1) {
      const v = await consumeRateLimit([bucket], { now });
      expect(v.granted, `第 ${i} 次应放行`).toBe(true);
      expect(v.retryAfterMs).toBe(0);
    }
    const refused = await consumeRateLimit([bucket], { now });
    expect(refused.granted).toBe(false);
    expect(refused.retryAfterMs).toBe(10 * MINUTE); // 窗口从第一次放行时开始
  });

  it("窗口过去之后重新开始 —— 不是永久封禁", async () => {
    const bucket = { key: "door:b", max: 1, windowMs: MINUTE };
    const now = 2_000_000;
    expect((await consumeRateLimit([bucket], { now })).granted).toBe(true);
    expect((await consumeRateLimit([bucket], { now: now + 1 })).granted).toBe(false);
    expect((await consumeRateLimit([bucket], { now: now + MINUTE + 1 })).granted).toBe(true);
  });
});

describe("#795 性质① 被拒的一次不加计数、不推窗口", () => {
  it("连续拒绝不会把窗口往后拖 —— 一直按也一直到点就恢复", async () => {
    const bucket = { key: "door:c", max: 2, windowMs: 5 * MINUTE };
    const start = 3_000_000;
    await consumeRateLimit([bucket], { now: start });
    await consumeRateLimit([bucket], { now: start + 1000 });
    const afterGrants = await row("door:c");
    expect(afterGrants).toEqual({ count: 2, expiresAt: start + 5 * MINUTE });

    // 在窗口内疯狂重试 20 次,全部被拒。
    for (let i = 0; i < 20; i += 1) {
      const v = await consumeRateLimit([bucket], { now: start + 2000 + i });
      expect(v.granted).toBe(false);
    }
    const afterRefusals = await row("door:c");
    // 计数没涨(还是 2,不是 22),窗口终点还是第一次放行时定下的那个。
    expect(afterRefusals).toEqual(afterGrants);

    // 到点就恢复,不因为「你一直在按」而顺延。
    expect((await consumeRateLimit([bucket], { now: start + 5 * MINUTE + 1 })).granted).toBe(true);
  });
});

describe("#795 性质② 一起记账,或者都不记", () => {
  it("紧桶拒了整次请求,松桶不许把这一次记在自己头上", async () => {
    // 真实形状:一个「同一出口 + 同一地址」的紧桶,和一个「同一出口,所有地址」的松桶。
    const tight = { key: "ip:1.2.3.4|a@shop.test", max: 2, windowMs: 30 * MINUTE };
    const loose = { key: "ip:1.2.3.4", max: 10, windowMs: 30 * MINUTE };
    const now = 4_000_000;

    await consumeRateLimit([loose, tight], { now });
    await consumeRateLimit([loose, tight], { now });
    expect((await row(loose.key))?.count).toBe(2);

    // 紧桶已满 → 整次请求被拒 → 松桶的 2 不许变成 3。
    for (let i = 0; i < 5; i += 1) {
      expect((await consumeRateLimit([loose, tight], { now })).granted).toBe(false);
    }
    expect((await row(loose.key))?.count).toBe(2);
    expect((await row(tight.key))?.count).toBe(2);

    // 同一出口后面的**另一个**地址仍然走得通 —— 前一个人的重试循环没有把邻居锁死。
    const neighbour = { key: "ip:1.2.3.4|b@shop.test", max: 2, windowMs: 30 * MINUTE };
    expect((await consumeRateLimit([loose, neighbour], { now })).granted).toBe(true);
  });

  it("松桶满了同样拒整次,紧桶也不记账", async () => {
    const loose = { key: "ip:9.9.9.9", max: 1, windowMs: MINUTE };
    const a = { key: "ip:9.9.9.9|x@shop.test", max: 5, windowMs: MINUTE };
    const b = { key: "ip:9.9.9.9|y@shop.test", max: 5, windowMs: MINUTE };
    const now = 5_000_000;
    expect((await consumeRateLimit([loose, a], { now })).granted).toBe(true);
    expect((await consumeRateLimit([loose, b], { now })).granted).toBe(false);
    expect((await row(b.key))?.count).toBe(0); // 行写了,数没加
  });
});

describe("#795 性质③ 两种判决做同样的事", () => {
  it("拒绝也写行 —— 一个从没见过的 key 被拒之后,库里同样有它的行", async () => {
    const loose = { key: "ip:7.7.7.7", max: 1, windowMs: MINUTE };
    const fresh = { key: "ip:7.7.7.7|never-seen@shop.test", max: 5, windowMs: MINUTE };
    const now = 6_000_000;
    await consumeRateLimit([loose], { now }); // 先把松桶用满
    expect((await consumeRateLimit([loose, fresh], { now })).granted).toBe(false);
    // 关键:被拒的那次仍然为这个新 key 建了行(工作量相同),只是计数是 0。
    expect(await row(fresh.key)).toEqual({ count: 0, expiresAt: now + MINUTE });
  });
});

describe("#795 计数在库里,不在进程里", () => {
  it("同一个 key 的预算是共享的 —— 两个调用点加起来只有一份额度", async () => {
    const key = "shared:door";
    const now = 7_000_000;
    // 模拟两个实例:同一个 key,各自独立调用。若计数在进程内存里,这里会各放行 2 次。
    const instanceA = () => consumeRateLimit([{ key, max: 2, windowMs: MINUTE }], { now });
    const instanceB = () => consumeRateLimit([{ key, max: 2, windowMs: MINUTE }], { now });
    expect((await instanceA()).granted).toBe(true);
    expect((await instanceB()).granted).toBe(true);
    expect((await instanceA()).granted).toBe(false);
    expect((await instanceB()).granted).toBe(false);
  });
});

describe("#795 调用方用错了要当场说清楚", () => {
  it("零个桶 / 重复 key / 非法额度都直接抛,不是静默放行", async () => {
    await expect(consumeRateLimit([])).rejects.toThrow(/at least one bucket/u);
    await expect(
      consumeRateLimit([
        { key: "dup", max: 1, windowMs: MINUTE },
        { key: "dup", max: 2, windowMs: MINUTE },
      ]),
    ).rejects.toThrow(/duplicate bucket keys/u);
    await expect(consumeRateLimit([{ key: "k", max: 0, windowMs: MINUTE }])).rejects.toThrow(/positive integer/u);
    await expect(consumeRateLimit([{ key: "k", max: 1, windowMs: 0 }])).rejects.toThrow(/window must be positive/u);
  });
});

describe("#795 计数器够不到的时候", () => {
  /** 把表挪走,制造一次**真实**的存储故障(而不是 mock 一个 Error),用完原样挪回来。 */
  async function withCounterTableMissing<T>(fn: () => Promise<T>): Promise<T> {
    await prisma.$executeRawUnsafe(`ALTER TABLE "rate_limit_counter" RENAME TO "rate_limit_counter_x795"`);
    try {
      return await fn();
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "rate_limit_counter_x795" RENAME TO "rate_limit_counter"`);
    }
  }

  it("默认 fail closed —— 否则「把数据库打趴」就是一次性拆掉所有闸门的办法", async () => {
    const verdict = await withCounterTableMissing(() =>
      consumeRateLimit([{ key: "down:a", max: 100, windowMs: MINUTE }]),
    );
    expect(verdict.granted).toBe(false);
    expect(verdict.degraded).toBe(true);
  });

  it("只有明确写了 allow 的调用点才放行,而且照样标记 degraded", async () => {
    // 唯一的 allow 用户是签名媒体代理:那条路本来不碰数据库,授权是 HMAC 不是这道闸,
    // 数据库抖一下不该变成「商家已经付过钱的那次发布失败了」的原因。
    const verdict = await withCounterTableMissing(() =>
      consumeRateLimit([{ key: "down:b", max: 100, windowMs: MINUTE }], { onStorageFailure: "allow" }),
    );
    expect(verdict.granted).toBe(true);
    expect(verdict.degraded).toBe(true);
  });

  it("故障之后表回来了,计数照常 —— 不留下坏状态", async () => {
    await withCounterTableMissing(() => consumeRateLimit([{ key: "down:c", max: 1, windowMs: MINUTE }]));
    const now = 9_000_000;
    expect((await consumeRateLimit([{ key: "down:c", max: 1, windowMs: MINUTE }], { now })).granted).toBe(true);
    expect((await consumeRateLimit([{ key: "down:c", max: 1, windowMs: MINUTE }], { now })).granted).toBe(false);
  });
});

describe("#795 过期行会被清掉", () => {
  it("清理只删过了宽限期的行,活着的窗口一行不动", async () => {
    const now = 8_000_000;
    await consumeRateLimit([{ key: "old", max: 1, windowMs: MINUTE }], { now: now - 3 * 60 * MINUTE });
    await consumeRateLimit([{ key: "live", max: 1, windowMs: 30 * MINUTE }], { now });
    const deleted = await pruneRateLimitCounters({ now, graceMs: 60 * MINUTE });
    expect(deleted).toBe(1);
    expect(await row("old")).toBeNull();
    expect(await row("live")).not.toBeNull();
  });
});
