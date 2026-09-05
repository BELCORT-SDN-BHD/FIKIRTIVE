import { describe, expect, it } from "vitest";

import { emailDeliveryAvailable, emailTransportChoice } from "../transport";

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

  it("FRONT-A2: the answer never depends on who is asking", () => {
    // 谓词根本不收邮箱地址 —— 这条是把「它不可能变成存在性探针」写成可执行的形状:
    // 同一份 env,答案对每个商家都一样,而它连问都问不到「是谁」。
    const env = { NODE_ENV: "production" };
    expect(emailDeliveryAvailable(env)).toBe(emailDeliveryAvailable(env));
    expect(emailDeliveryAvailable.length).toBeLessThanOrEqual(1);
  });
});
