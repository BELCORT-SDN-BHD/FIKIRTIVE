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
 *
 * 2026-08-18 追加第五道:**Otto 对话**。额度管得住一轮能花多少(冻结那一步管的),管不住一个
 * 卡死的客户端能起多少轮 —— 而每一轮都是一次真的模型调用。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@fikirtive/db";
import {
  callerKey,
  consumePasswordDoor,
  consumeGenerationGate,
  consumeOttoTurnGate,
  consumeUploadGate,
  consumeMediaProxyGate,
  consumeSharePreviewDoor,
  SHARE_PREVIEW_PER_CALLER_PER_HOUR,
  PASSWORD_DOOR_PER_CALLER_PER_HOUR,
  GENERATION_PER_TENANT_PER_HOUR,
  OTTO_TURN_PER_TENANT_PER_HOUR,
  OTTO_TURN_RATE_LIMIT_MESSAGE,
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

// ── Otto 对话闸 —— 数的是「起了多少轮」,不是「花了多少钱」 ────────────────────────────────
//
// 钱由冻结那一步管:一轮对话在模型被调用之前先向余额冻结,余额不够就起不来。这道闸补的是另一
// 半 —— 没有任何东西在数一个卡死的客户端能起多少轮,而每一轮都是一次真的模型调用。
describe("Otto 对话闸(只管量,不管钱)", () => {
  it("按租户计数 —— 一个商家聊得多不影响另一个", async () => {
    await consumeOttoTurnGate("org-a");
    await consumeOttoTurnGate("org-b");
    const rows = await prisma.rateLimitCounter.findMany({
      where: { key: { startsWith: "otto:" } },
      select: { key: true, count: true },
    });
    expect(rows.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: "otto:org-a", count: 1 },
      { key: "otto:org-b", count: 1 },
    ]);
  });

  it("一小时给一个商家六十轮,第六十一轮拒", async () => {
    for (let i = 0; i < OTTO_TURN_PER_TENANT_PER_HOUR; i += 1) {
      expect(await consumeOttoTurnGate("org-chatty"), `第 ${i + 1} 轮应放行`).toBe(true);
    }
    expect(await consumeOttoTurnGate("org-chatty")).toBe(false);
  }, 60_000);

  it("额度必须容得下一场真实的长对话 —— 闸拒到真人身上就是我们自己造的故障", async () => {
    // beta 里最长的一场实测远低于二十轮;六十≈一小时里每分钟一条。
    expect(OTTO_TURN_PER_TENANT_PER_HOUR).toBeGreaterThanOrEqual(60);
  });

  it("拒绝语只说等一会儿,一个字都不提 credits —— 什么都没扣,暗示扣了就是撒谎", () => {
    expect(OTTO_TURN_RATE_LIMIT_MESSAGE).toMatch(/try again/i);
    expect(OTTO_TURN_RATE_LIMIT_MESSAGE).not.toMatch(/credit/i);
    expect(OTTO_TURN_RATE_LIMIT_MESSAGE).not.toMatch(/pay|upgrade|top up/i);
  });

  it("两个对话入口共用同一个桶 —— 换一扇门不该重新发一份预算", async () => {
    // 流式路由与 ottoTurn 都调用同一个函数、同一个键;这里钉的是「同一个租户只有一份预算」。
    await consumeOttoTurnGate("org-two-doors");
    await consumeOttoTurnGate("org-two-doors");
    const row = await prisma.rateLimitCounter.findFirstOrThrow({ where: { key: "otto:org-two-doors" } });
    expect(row.count).toBe(2);
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

// ── 存储故障:对话闸放行,生成与上传照旧拒(产品负责人裁定 2026-08-18)─────────────────────
//
// 计数器够不到的时候放行还是拒,是逐道门的产品判断,不是一个全局开关。对话这道门放行是安全的:
// 钱本来就由冻结那一步守着,而冻结自己 fail closed —— 数据库答不了这个计数器,也答不了那笔
// 冻结,所以放行不可能多花一分钱,只可能多起几轮。拒了却等于「Otto 挂了」。
describe("计数器够不到的时候:对话闸放行,生成与上传照旧拒", () => {
  /** 把表挪走,制造一次**真实**的存储故障(而不是 mock 一个 Error),用完原样挪回来。 */
  async function withCounterTableMissing<T>(fn: () => Promise<T>): Promise<T> {
    await prisma.$executeRawUnsafe(`ALTER TABLE "rate_limit_counter" RENAME TO "rate_limit_counter_gates"`);
    try {
      return await fn();
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "rate_limit_counter_gates" RENAME TO "rate_limit_counter"`);
    }
  }

  it("对话闸放行 —— 计数表抖一下不许变成「Otto 挂了」(钱另有冻结守着)", async () => {
    expect(await withCounterTableMissing(() => consumeOttoTurnGate("org-blip"))).toBe(true);
  });

  it("生成闸照旧 fail closed —— 花商家额度那一路,闸够不到就不许开", async () => {
    expect(await withCounterTableMissing(() => consumeGenerationGate("org-blip"))).toBe(false);
  });

  it("上传闸照旧 fail closed —— 同理,那一路要写我们自己的桶", async () => {
    expect(await withCounterTableMissing(() => consumeUploadGate("org-blip"))).toBe(false);
  });

  // B0-28。分享预览门也 fail closed,而它是这几道里唯一一条**免登录**的路,所以这一条必须钉住:
  // 它长得最像媒体代理(同样没有会话),而媒体代理是故意放行的。两者的区别不在「有没有会话」,
  // 在「拒了要付什么代价」—— 分享页的授权本来就要 Postgres(铸造行就是权威层),数据库答不了
  // 这个计数器,也答不了那次授权,所以拒绝一分钱不多花;媒体代理拒了却会打断一次商家已经付过
  // 钱的发布。少了这一条,以后谁按「跟媒体代理一样」把它改成放行,没有任何东西会红。
  it("分享预览门照旧 fail closed —— 免登录不等于该跟媒体代理一样放行", async () => {
    expect(await withCounterTableMissing(() => consumeSharePreviewDoor(from("198.51.100.77")))).toBe(false);
  });

  it("故障过去之后照常计数 —— 放行不留坏状态", async () => {
    await withCounterTableMissing(() => consumeOttoTurnGate("org-blip-2"));
    expect(await consumeOttoTurnGate("org-blip-2")).toBe(true);
    const row = await prisma.rateLimitCounter.findFirstOrThrow({ where: { key: "otto:org-blip-2" } });
    expect(row.count).toBe(1); // 故障那一次没记上,恢复之后这一次记上了
  });
});

// ── B0-28 分享预览门 ───────────────────────────────────────────────────────────────────────
//
// 产品里第二条按设计就没有会话的路,也是第一条**给人走**的:商家给一条帖子铸一条只读链接发给
// 客户,客户在没有账号的浏览器里打开。授权是链接自己的 HMAC + 那一行还活着的铸造记录;这道闸
// 只管一个地址能多快地花掉那份授权。
describe("B0-28 分享预览门(免登录公开页)", () => {
  it("按出口地址计数,自己一个桶", async () => {
    expect(await consumeSharePreviewDoor(from("198.51.100.44"))).toBe(true);
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: "sharepv:" } } });
    expect(rows.map((r) => r.key)).toEqual(["sharepv:198.51.100.44"]);
  });

  it("额度容得下一整间办公室反复打开同一条链接", () => {
    expect(SHARE_PREVIEW_PER_CALLER_PER_HOUR).toBeGreaterThanOrEqual(60);
  });
});

describe("#795 每道闸各数各的", () => {
  it("键前缀两两不同 —— 一道门的流量不许花掉另一道门的预算", async () => {
    await consumePasswordDoor(from("203.0.113.30"));
    await consumeGenerationGate("203.0.113.30");
    await consumeOttoTurnGate("203.0.113.30");
    await consumeUploadGate("203.0.113.30");
    await consumeMediaProxyGate(from("203.0.113.30"));
    await consumeSharePreviewDoor(from("203.0.113.30"));
    const rows = await prisma.rateLimitCounter.findMany({ select: { key: true, count: true } });
    // 同一个字符串,六道门六行,每行各 1 —— 没有任何一道门在替另一道记账。
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.count))).toEqual(new Set([1]));
    expect(new Set(rows.map((r) => r.key.split(":")[0]))).toEqual(
      new Set(["pw", "gen", "otto", "upload", "media", "sharepv"]),
    );
  });
});
