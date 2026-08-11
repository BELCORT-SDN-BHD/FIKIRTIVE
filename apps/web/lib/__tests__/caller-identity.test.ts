/**
 * #795 —— 「谁在被数」这件事本身要能被证伪,而且要**按部署形态**分别证。
 *
 * 每一道 per-caller 闸都拿请求头里的一个值当 key,而请求头是调用方说了算的 —— 除非前面有
 * 东西把它覆写掉了。哪个头、头里哪一段可信,是**部署形态**的性质,所以它是配置出来的
 * (`CALLER_IP_SOURCE`),这个文件按四种形态分别把它钉死。
 *
 * 两个方向的失败都在这里有用例:
 *   · **太松** —— r1 取 `x-forwarded-for` 的第一段,那正是客户端自己写的那段:每次换一个编造的
 *     地址就是一份新预算,每一道 per-caller 闸都成了摆设。
 *   · **太紧** —— r2 改成从右边数并删掉 `x-real-ip`,而我们的平台(Railway)**根本不发**
 *     `x-forwarded-for`:线上每一个真实用户都会落进同一个 `unknown-caller` 桶,全站每小时
 *     只剩五次注册。那不是保守,那是我们自己造的一次停服。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { callerKey, foldIPv6ToPrefix64, resolveCallerIpSource, UNKNOWN_CALLER } from "@/lib/caller-identity";

const realIp = (value: string) => new Headers({ "x-real-ip": value });
const xff = (value: string) => new Headers({ "x-forwarded-for": value });

afterEach(() => {
  delete process.env.CALLER_IP_SOURCE;
  vi.unstubAllEnvs();
});

describe("#795 r3 形态一:railway —— 客户端地址只在 X-Real-IP 里", () => {
  // Railway 官方规范(docs.railway.com/networking/public-networking/specs-and-limits)列出它的
  // 边缘会设置的头:X-Real-IP「for identifying client's remote IP」、X-Forwarded-Proto、
  // X-Forwarded-Host、X-Railway-Edge、X-Request-Start、X-Railway-Request-Id。
  // **X-Forwarded-For 不在这张表上。**

  it("读 X-Real-IP", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    expect(callerKey(realIp("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("**这就是 r2 的线上停服**:两个真实用户必须落进两个桶,而不是同一个 unknown", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    // 线上真实形状:只有 X-Real-IP,没有 X-Forwarded-For。r2 在这个形状下两边都返回
    // UNKNOWN_CALLER —— 于是全站公开门共用一份每小时预算(五次注册,全部用户加起来)。
    const one = callerKey(realIp("203.0.113.7"));
    const other = callerKey(realIp("198.51.100.4"));
    expect(one).not.toBe(other);
    expect(one).not.toBe(UNKNOWN_CALLER);
    expect(other).not.toBe(UNKNOWN_CALLER);
  });

  it("调用方自己塞的 X-Forwarded-For 一个字都不看", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    // 边缘不写这个头,所以头里出现的整条链都是调用方写的 —— 从左数从右数都一样不可信。
    expect(
      callerKey(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })),
    ).toBe("203.0.113.7");
    // 换一批伪造内容,桶必须纹丝不动。
    expect(
      callerKey(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "9.9.9.9" })),
    ).toBe("203.0.113.7");
  });

  it("只有伪造的 X-Forwarded-For、没有 X-Real-IP —— 并到共用桶,不认那个伪造值", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    expect(callerKey(xff("1.1.1.1, 2.2.2.2"))).toBe(UNKNOWN_CALLER);
  });
});

describe("#795 r3 形态二:xff:<hops> —— 边缘往 X-Forwarded-For 追加", () => {
  it("默认一跳:取最右那一段(可信代理写的),不是客户端自己写的第一段", () => {
    process.env.CALLER_IP_SOURCE = "xff:1";
    expect(callerKey(xff("1.1.1.1, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("往左边塞多少段都改不了结果 —— 追加只发生在右边", () => {
    process.env.CALLER_IP_SOURCE = "xff:1";
    const real = "203.0.113.7";
    const forged = ["9.9.9.9", "8.8.8.8", "7.7.7.7"].join(", ");
    expect(callerKey(xff(`${forged}, ${real}`))).toBe(real);
    expect(callerKey(xff(`5.5.5.5, ${real}`))).toBe(callerKey(xff(`6.6.6.6, ${real}`)));
  });

  it("多层代理:按配置的跳数从右边数", () => {
    process.env.CALLER_IP_SOURCE = "xff:2";
    expect(callerKey(xff("1.1.1.1, 203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("这个形态下 X-Real-IP 不参与 —— 配置说的是哪个头就只看哪个头", () => {
    process.env.CALLER_IP_SOURCE = "xff:1";
    expect(callerKey(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe(UNKNOWN_CALLER);
  });

  it("头缺失、段数不够、不是地址 —— 一律并到共用桶,绝不发新预算", () => {
    process.env.CALLER_IP_SOURCE = "xff:1";
    expect(callerKey(new Headers())).toBe(UNKNOWN_CALLER);
    expect(callerKey(xff("not-an-ip"))).toBe(UNKNOWN_CALLER);
    expect(callerKey(xff("   "))).toBe(UNKNOWN_CALLER);
    expect(callerKey(xff("1.1.1.1, still-not-an-ip"))).toBe(UNKNOWN_CALLER);
    process.env.CALLER_IP_SOURCE = "xff:3";
    expect(callerKey(xff("1.1.1.1, 203.0.113.7"))).toBe(UNKNOWN_CALLER);
  });
});

describe("#795 r3 形态三:dev —— 本机没有代理", () => {
  it("两个头哪个在就用哪个,都不在就是共用桶", () => {
    process.env.CALLER_IP_SOURCE = "dev";
    expect(callerKey(realIp("203.0.113.7"))).toBe("203.0.113.7");
    expect(callerKey(xff("203.0.113.8"))).toBe("203.0.113.8");
    expect(callerKey(new Headers())).toBe(UNKNOWN_CALLER);
  });
});

describe("#795 r3 形态四:配置本身", () => {
  it("生产环境不配 = railway(这个产品部署在 Railway),其余环境不配 = dev", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveCallerIpSource(undefined)).toEqual({ shape: "railway" });
    vi.stubEnv("NODE_ENV", "test");
    expect(resolveCallerIpSource(undefined)).toEqual({ shape: "dev" });
  });

  it("认得三种形态,连带跳数", () => {
    expect(resolveCallerIpSource("railway")).toEqual({ shape: "railway" });
    expect(resolveCallerIpSource("XFF:2")).toEqual({ shape: "xff", hops: 2 });
    expect(resolveCallerIpSource("dev")).toEqual({ shape: "dev" });
  });

  it("写错了当场抛,不悄悄挑一个策略", () => {
    // 打错字静默选中某个策略,正是这个变量存在的理由 —— 所以它宁可炸。
    for (const bad of ["xff", "xff:0", "xff:-1", "xff:two", "railwayy", "true"]) {
      expect(() => resolveCallerIpSource(bad), bad).toThrow(/CALLER_IP_SOURCE/);
    }
  });
});

describe("#795 IPv6 按 /64 归并(与形态无关)", () => {
  it("同一个 /64 里的不同地址是同一个桶", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    // 一条普通的家用/主机 IPv6 线路就是一个 /64:不归并的话,一个调用方手上有几十亿个地址,
    // 每个都是一份新预算 —— 「自选 key」换个合法途径又回来了。
    const a = callerKey(realIp("2001:db8:abcd:1234::1"));
    const b = callerKey(realIp("2001:db8:abcd:1234:ffff:ffff:ffff:ffff"));
    expect(a).toBe(b);
    expect(a).toBe("2001:0db8:abcd:1234:0000:0000:0000:0000");
  });

  it("不同 /64 是不同的桶 —— 归并不能归过头", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    expect(callerKey(realIp("2001:db8:abcd:1234::1"))).not.toBe(callerKey(realIp("2001:db8:abcd:1235::1")));
  });

  it("压缩写法、大小写、zone、方括号带端口都归一到同一个键", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    const expected = "2001:0db8:0000:0000:0000:0000:0000:0000";
    for (const form of ["2001:db8::1", "2001:DB8::1", "2001:db8::1%eth0", "[2001:db8::1]:443"]) {
      expect(callerKey(realIp(form)), form).toBe(expected);
    }
  });

  it("IPv4-mapped 当成它本来就是的那个 IPv4 数", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    expect(callerKey(realIp("::ffff:203.0.113.7"))).toBe("203.0.113.7");
  });

  it("IPv4 带端口也认得出来", () => {
    process.env.CALLER_IP_SOURCE = "railway";
    expect(callerKey(realIp("203.0.113.7:51234"))).toBe("203.0.113.7");
  });

  it("折叠函数本身:前四组保留,后四组清零", () => {
    expect(foldIPv6ToPrefix64("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe(
      "2001:0db8:85a3:08d3:0000:0000:0000:0000",
    );
    expect(foldIPv6ToPrefix64("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0000");
  });
});
