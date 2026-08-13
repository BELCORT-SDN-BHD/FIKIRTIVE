/**
 * #795 —— 产品自己那四道闸(打真库)。
 *
 * Better Auth 守它自己的端点;这四道门它一概不知道,而且此前**一个数字都没有**:
 *   · 密码门 —— BA 的内建规则只有「10 秒 3 次」,挡得住快的,对慢的完全无效
 *     (3 次/10 秒 = 一个地址一小时 1080 次,永远);
 *   · 生成 —— 付费派发口。额度管得住**花多少钱**,管不住一个卡死的客户端循环在花光之前
 *     能造出多少 job、多少行、多少队列消息;
 *   · 上传 —— 每调用一次就签出一个进我们自己桶的 URL,没有任何东西在数;
 *   · 外链 —— 签名媒体代理,产品里唯一一条按设计就没有会话的路。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import {
  callerKey,
  consumePasswordDoor,
  consumeGenerationGate,
  consumeUploadGate,
  consumeMediaProxyGate,
  PASSWORD_DOOR_PER_CALLER_PER_HOUR,
  GENERATION_PER_TENANT_PER_HOUR,
  UPLOAD_PER_TENANT_PER_HOUR,
  MEDIA_PROXY_PER_CALLER_PER_10_MIN,
} from "@/lib/rate-limit-gates";

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });

beforeEach(async () => {
  await prisma.rateLimitCounter.deleteMany({});
});

// 「谁在被数」本身的规则(取最右一段、IPv6 归 /64、认不出就并桶)在 caller-identity.test.ts,
// 那是它自己的文件。这里只钉一件事:这些闸确实用的是那个函数,而不是各自另起炉灶。
describe("#795 r2 闸门用的是同一个可信调用方身份", () => {
  it("单段转发头 = 那一段;伪造的左侧前缀改不了桶", async () => {
    expect(callerKey(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    await consumePasswordDoor(new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }));
    const keys = (await prisma.rateLimitCounter.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys).toEqual(["pw:203.0.113.9"]);
  });
});

describe("#795 密码门(耐心型攻击那一半)", () => {
  it("一小时给一个出口地址三十次,第三十一次拒,并给出重试时刻", async () => {
    const ip = "203.0.113.20";
    for (let i = 0; i < PASSWORD_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      expect(await consumePasswordDoor(from(ip)), `第 ${i + 1} 次应放行`).toBeNull();
    }
    const refused = await consumePasswordDoor(from(ip));
    expect(refused).not.toBeNull();
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThanOrEqual(60 * 60 * 1000);
  }, 60_000);

  it("换一个出口地址预算是自己的 —— 不因为别人被拒就连坐", async () => {
    const ip = "203.0.113.21";
    for (let i = 0; i < PASSWORD_DOOR_PER_CALLER_PER_HOUR + 1; i += 1) await consumePasswordDoor(from(ip));
    expect(await consumePasswordDoor(from("203.0.113.22"))).toBeNull();
  }, 60_000);

  it("计数键里没有邮箱 —— 429 绝不能被读成「这个账号存在」", async () => {
    await consumePasswordDoor(from("203.0.113.23"));
    const keys = (await prisma.rateLimitCounter.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys).toEqual(["pw:203.0.113.23"]);
    for (const key of keys) expect(key).not.toContain("@");
  });
});

describe("#795 生成闸", () => {
  it("按租户计数 —— 一个商家用满不影响另一个", async () => {
    // 用满一个租户要 600 次调用,太慢也没必要:这里钉的是**键按租户分开**这件事,
    // 额度本身由 packages/db 的定额测试覆盖。
    await consumeGenerationGate("org-a");
    await consumeGenerationGate("org-b");
    const rows = await prisma.rateLimitCounter.findMany({ select: { key: true, count: true } });
    expect(rows.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: "gen:org-a", count: 1 },
      { key: "gen:org-b", count: 1 },
    ]);
  });

  it("额度必须容得下一整批 —— 一次 factory batch 最多 24 格,一起派发", async () => {
    // 这条是防「把闸拧太紧,结果自己把合法的批量生成掐掉」。24 是 MAX_BATCH_CELLS。
    expect(GENERATION_PER_TENANT_PER_HOUR).toBeGreaterThanOrEqual(24 * 10);
  });
});

describe("#795 上传闸", () => {
  it("按租户计数,额度容得下一次批量商品导入", async () => {
    await consumeUploadGate("org-a");
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: "upload:" } } });
    expect(rows.map((r) => r.key)).toEqual(["upload:org-a"]);
    expect(UPLOAD_PER_TENANT_PER_HOUR).toBeGreaterThanOrEqual(500);
  });
});

describe("#795 外链闸(签名媒体代理)", () => {
  it("按出口地址计数,额度远在任何真实抓取节奏之上", async () => {
    expect(await consumeMediaProxyGate(from("198.51.100.9"))).toBe(true);
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: "media:" } } });
    expect(rows.map((r) => r.key)).toEqual(["media:198.51.100.9"]);
    expect(MEDIA_PROXY_PER_CALLER_PER_10_MIN).toBeGreaterThanOrEqual(300);
  });
});

describe("#795 四道闸各数各的", () => {
  it("键前缀两两不同 —— 一道门的流量不许花掉另一道门的预算", async () => {
    await consumePasswordDoor(from("203.0.113.30"));
    await consumeGenerationGate("203.0.113.30");
    await consumeUploadGate("203.0.113.30");
    await consumeMediaProxyGate(from("203.0.113.30"));
    const rows = await prisma.rateLimitCounter.findMany({ select: { key: true, count: true } });
    // 同一个字符串,四道门四行,每行各 1 —— 没有任何一道门在替另一道记账。
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.count))).toEqual(new Set([1]));
    expect(new Set(rows.map((r) => r.key.split(":")[0]))).toEqual(new Set(["pw", "gen", "upload", "media"]));
  });
});
