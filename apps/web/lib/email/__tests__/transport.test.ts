import { describe, expect, it } from "vitest";

import { emailDeliveryAvailable, emailTransportChoice } from "../transport";

/** 谓词收的那一份 env(`transport.ts` 内部同名类型不导出,这里只为变异探针的转型用)。 */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * FRONT-A12 —— 「这个部署寄不寄得出信」是一个**部署级**判断,登录页与真正去寄信的那一半读
 * 同一份答案(Founder 2026-09-05 裁决①「按环境提示」)。
 *
 * 这里每一条都传一份显式的 env,不动进程环境:这个谓词的全部意义就是「同一份配置永远得到
 * 同一个答案」,让它去读跑测试的机器上碰巧有什么,证明的就不是这件事了。
 */
describe("emailTransportChoice", () => {
  it("FRONT-A12: a configured mail provider means real mail — resend", () => {
    expect(emailTransportChoice({ RESEND_API_KEY: "re_x", NODE_ENV: "production" })).toBe("resend");
    expect(emailDeliveryAvailable({ RESEND_API_KEY: "re_x", NODE_ENV: "production" })).toBe(true);
  });

  it("FRONT-A12: a serving deployment with no provider can deliver NOTHING — none", () => {
    // 这一条就是走查看到的那个部署。以前它照样翻页说「We sent a temporary login code to …」。
    expect(emailTransportChoice({ NODE_ENV: "production" })).toBe("none");
    expect(emailDeliveryAvailable({ NODE_ENV: "production" })).toBe(false);
  });

  it("FRONT-A12: a blank key is not a configured provider (same rule the boot contract uses)", () => {
    // `isSet` 的口径:空串与纯空白都算没配。第二套「有没有配」的读法正是这条测试要挡的东西。
    expect(emailTransportChoice({ RESEND_API_KEY: "   ", NODE_ENV: "production" })).toBe("none");
    expect(emailTransportChoice({ RESEND_API_KEY: "", NODE_ENV: "production" })).toBe("none");
  });

  it("FRONT-A12: a developer's machine with no key still delivers — the local stub", () => {
    expect(emailTransportChoice({ NODE_ENV: "development" })).toBe("stub");
    expect(emailTransportChoice({})).toBe("stub");
    expect(emailDeliveryAvailable({ NODE_ENV: "development" })).toBe(true);
  });

  it("FRONT-A12: AUTH_EMAIL_TRANSPORT=stub is the explicit opt-in a test runner needs", () => {
    // e2e 跑的是 `next start`,它自己把 NODE_ENV 设成 production —— 所以「非生产」在那里
    // 根本观察不到,开关必须是显式的,否则 29 条登录旅程会因为「这个部署寄不出信」全红。
    expect(emailTransportChoice({ AUTH_EMAIL_TRANSPORT: "stub", NODE_ENV: "production" })).toBe(
      "stub",
    );
    expect(emailDeliveryAvailable({ AUTH_EMAIL_TRANSPORT: "stub", NODE_ENV: "production" })).toBe(
      true,
    );
  });

  it("FRONT-A2: an address cannot enter the judgement — every address gets the same answer", () => {
    // 变异型,不是同义反复。上一版写的是 `f(env) === f(env)`,那对**任何**实现都成立 ——
    // 包括一个按邮箱分叉的实现(判官 #1229 P2-1)。这一条把地址塞进谓词够得着的每一个位置
    // ——多出来的实参、env 上的地址形字段——再看答案:任何一版让地址进入判据的实现,
    // 这里当场红。
    const addresses = [
      "owner@example.com",
      "stranger@example.com",
      "OWNER@EXAMPLE.COM",
      "not-an-email",
      "",
    ];
    // 谓词今天只收一个 env;多传的那个实参是变异探针,现实现看不见它。
    const call = emailDeliveryAvailable as (env: Env, address?: string) => boolean;
    for (const [base, expected] of [
      [{ RESEND_API_KEY: "re_x", NODE_ENV: "production" }, true],
      [{ NODE_ENV: "production" }, false],
    ] as const) {
      const answers = new Set(
        addresses.map((address) =>
          call({ ...base, EMAIL: address, AUTH_EMAIL_ADDRESS: address }, address),
        ),
      );
      expect([...answers], `${expected ? "能" : "不能"}寄信的部署对不同地址给了不同答案`).toEqual([
        expected,
      ]);
    }
    // 上一版还断言过 `emailDeliveryAvailable.length <= 1`。那条不能留:`Function.length` 只数
    // 第一个默认值之前的形参,而这里唯一那个 env 就带默认值 —— 现值是 0,加上一个地址形参
    // 之后**还是 0**。一条对变异不会红的断言,比没有更坏。真正的判据是上面那个答案集合。
  });
});
