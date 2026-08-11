/**
 * #795 r2 —— 「谁在被数」这件事本身要能被证伪。
 *
 * 每一道 per-caller 闸都拿请求头里的一个值当 key,而请求头是调用方说了算的。上一版取
 * `x-forwarded-for` 的**第一段** —— 那正是客户端自己写的那段。于是匿名调用方可以自选桶:
 * 每次换一个编造的地址,每一道 per-caller 上限就都是新的。什么都不会报错,闸只是不再是闸。
 */
import { describe, it, expect, afterEach } from "vitest";
import { callerKey, foldIPv6ToPrefix64, UNKNOWN_CALLER } from "@/lib/caller-identity";

const xff = (value: string) => new Headers({ "x-forwarded-for": value });

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
});

describe("#795 r2 伪造的转发头拿不到自己的桶", () => {
  it("取的是**最右**那一段(可信代理写的),不是客户端自己写的第一段", () => {
    // 客户端谎称自己是 1.1.1.1,我们的边缘随后追加了它真实的地址。
    expect(callerKey(xff("1.1.1.1, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("往左边塞多少段都改不了结果 —— 追加只发生在右边", () => {
    const real = "203.0.113.7";
    const forged = ["9.9.9.9", "8.8.8.8", "7.7.7.7"].join(", ");
    expect(callerKey(xff(`${forged}, ${real}`))).toBe(real);
    // 每次换一批伪造前缀,桶必须还是同一个(否则就是「自选 key」)。
    expect(callerKey(xff(`5.5.5.5, ${real}`))).toBe(callerKey(xff(`6.6.6.6, ${real}`)));
  });

  it("代理跳数可配,按跳数从右边数", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(callerKey(xff("1.1.1.1, 203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("认不出来的一律并到同一个桶 —— 绝不发新预算", () => {
    expect(callerKey(new Headers())).toBe(UNKNOWN_CALLER);
    expect(callerKey(xff("not-an-ip"))).toBe(UNKNOWN_CALLER);
    expect(callerKey(xff("   "))).toBe(UNKNOWN_CALLER);
    expect(callerKey(xff("1.1.1.1, still-not-an-ip"))).toBe(UNKNOWN_CALLER);
  });

  it("头名可配(不同平台的边缘写不同的头)", () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(callerKey(new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "203.0.113.9",
    );
  });
});

describe("#795 r2 IPv6 按 /64 归并", () => {
  it("同一个 /64 里的不同地址是同一个桶", () => {
    // 一条普通的家用/主机 IPv6 线路就是一个 /64:不归并的话,一个调用方手上有几十亿个地址,
    // 每个都是一份新预算 —— 「自选 key」换个合法途径又回来了。
    const a = callerKey(xff("2001:db8:abcd:1234::1"));
    const b = callerKey(xff("2001:db8:abcd:1234:ffff:ffff:ffff:ffff"));
    expect(a).toBe(b);
    expect(a).toBe("2001:0db8:abcd:1234:0000:0000:0000:0000");
  });

  it("不同 /64 是不同的桶 —— 归并不能归过头", () => {
    expect(callerKey(xff("2001:db8:abcd:1234::1"))).not.toBe(callerKey(xff("2001:db8:abcd:1235::1")));
  });

  it("压缩写法、大小写、zone、方括号带端口都归一到同一个键", () => {
    const expected = "2001:0db8:0000:0000:0000:0000:0000:0000";
    for (const form of ["2001:db8::1", "2001:DB8::1", "2001:db8::1%eth0", "[2001:db8::1]:443"]) {
      expect(callerKey(xff(form)), form).toBe(expected);
    }
  });

  it("IPv4-mapped 当成它本来就是的那个 IPv4 数", () => {
    expect(callerKey(xff("::ffff:203.0.113.7"))).toBe("203.0.113.7");
  });

  it("IPv4 带端口也认得出来", () => {
    expect(callerKey(xff("203.0.113.7:51234"))).toBe("203.0.113.7");
  });

  it("折叠函数本身:前四组保留,后四组清零", () => {
    expect(foldIPv6ToPrefix64("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe(
      "2001:0db8:85a3:08d3:0000:0000:0000:0000",
    );
    expect(foldIPv6ToPrefix64("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0000");
  });
});
