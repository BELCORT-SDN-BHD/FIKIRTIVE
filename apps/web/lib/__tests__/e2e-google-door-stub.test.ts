/**
 * Google 门 E2E 替身的三把锁（SIGNIN-A12；`packages/core/src/e2e-google-door-stub.ts`）。
 *
 * 这个模块存在的全部理由，是让 A12 的旅程在一台没有 Google 的机器上走完第二扇门。它因此也是
 * 这个产品里**唯一**一段「在对的条件下接受一个不是 Google 签的身份断言」的代码，所以它的三把锁
 * 必须自己有测试 —— 一个替身如果在没武装时也说是，或者对任何字符串都说是，那么 A12 那条绿旅程
 * 证明的只是「这个套件能给自己发会话」。
 *
 * 五件事逐条钉住：默认（不设开关）什么都不挂；连着真库的进程一律武装不起来（开关开着也不行）；
 * 武装了才验签；签名不对一律拒；短密钥一律拒。
 */
import { describe, it, expect } from "vitest";
import {
  E2E_GOOGLE_DOOR_STUB_ENV,
  e2eGoogleDoorStubArmed,
  e2eGoogleDoorStubProviderOptions,
  mintE2eGoogleIdToken,
  verifyE2eGoogleIdToken,
} from "@fikirtive/core/e2e-google-door-stub";

const SECRET = "e2e-google-door-stub-test-secret-long-enough";
/** 武装的第二把锁：这个进程得指着一个用完就扔的 `_test` 库（跑道上是 `e2eDatabaseUrl()`）。 */
const TEST_DB = "postgresql://u:p@127.0.0.1:5432/fikirtive_e2e_test";
const LIVE_DB = "postgresql://u:p@ep-x-pooler.neon.tech:5432/merchant_live";
const ARMED = { [E2E_GOOGLE_DOOR_STUB_ENV]: "1", BETTER_AUTH_SECRET: SECRET, DATABASE_URL: TEST_DB };

const claims = { iss: "https://accounts.google.com", email: "aisha@example.com", email_verified: true };

describe("SIGNIN-A12 —— Google 门 E2E 替身的三把锁", () => {
  it("SIGNIN-A12 —— 没武装时供应商配置里一个字都不多（生产上这段代码不存在）", () => {
    expect(e2eGoogleDoorStubArmed({})).toBe(false);
    expect(e2eGoogleDoorStubProviderOptions({})).toEqual({});
    // 「差不多是开」的值一律算没开：放宽的开关必须 fail closed。
    for (const value of ["", " ", "0", "true", "yes", "on", "2"]) {
      expect(
        e2eGoogleDoorStubArmed({ [E2E_GOOGLE_DOOR_STUB_ENV]: value, DATABASE_URL: TEST_DB }),
        `"${value}" 不该武装替身`,
      ).toBe(false);
    }
    expect(e2eGoogleDoorStubArmed({ [E2E_GOOGLE_DOOR_STUB_ENV]: "1", DATABASE_URL: TEST_DB })).toBe(
      true,
    );
  });

  it("SIGNIN-A12 —— 没武装时，连一个签得对的 token 也不认", () => {
    const token = mintE2eGoogleIdToken(claims, SECRET);
    expect(verifyE2eGoogleIdToken(token, { BETTER_AUTH_SECRET: SECRET, DATABASE_URL: TEST_DB })).toBe(
      false,
    );
    expect(verifyE2eGoogleIdToken(token, ARMED)).toBe(true);
  });

  /**
   * 第二把锁：开关开着，但这个进程连的是真库 —— 一个字也挂不上（判官 #1349 P2）。
   *
   * 这一条为什么不能只靠开机检查：`bootEnvDecision` 那一格只在 `opts.production` 为真时判
   * （`packages/core/src/env-contract.ts`），所以「只有指向 `_test` 库的进程可武装」在一个
   * NODE_ENV=development、却连着正式库的进程上原本根本不成立 —— 开关一开，替身就挂上去了。
   * 判据因此落在 `e2eGoogleDoorStubArmed()` 自己身上：不问生产与否，只问库。
   */
  it("SIGNIN-A12 —— 连着真库的进程武装不起来，NODE_ENV 是什么都一样（判官 #1349 P2）", () => {
    const live = { ...ARMED, DATABASE_URL: LIVE_DB };
    expect(e2eGoogleDoorStubArmed(live)).toBe(false);
    expect(e2eGoogleDoorStubProviderOptions(live)).toEqual({});
    expect(verifyE2eGoogleIdToken(mintE2eGoogleIdToken(claims, SECRET), live)).toBe(false);
    expect(e2eGoogleDoorStubArmed({ ...live, NODE_ENV: "development" })).toBe(false);
    // 直连指着 _test、池化指着真库：web 侧实际连的是后者（`packages/db/src/client.ts:35`），
    // 所以这也是一个服务真商家的进程（判官 #1349 P1 同一个根）。
    expect(e2eGoogleDoorStubArmed({ ...ARMED, DATABASE_URL_POOLED: LIVE_DB })).toBe(false);
    // 一个库都没配 → fail closed。
    expect(
      e2eGoogleDoorStubArmed({ [E2E_GOOGLE_DOOR_STUB_ENV]: "1", BETTER_AUTH_SECRET: SECRET }),
    ).toBe(false);
  });

  it("SIGNIN-A12 —— 武装之后仍然是一道检查：签名不对、密钥不对、形状不对都进不来", () => {
    const token = mintE2eGoogleIdToken(claims, SECRET);
    const [header, payload] = token.split(".");

    // 另一把密钥签的 —— 替身认的是**这个部署自己那把** BETTER_AUTH_SECRET，别人的签名不算数。
    // （这一条不等于「误开也无害」：武装之后那把密钥单独一把就能换到会话，所以围栏是生产禁武装
    //   ＋密钥保密 —— 「生产禁武装」今天由两半合成：开机检查让那样的生产进程起不来，
    //   `e2eGoogleDoorStubArmed()` 让任何连着真库的进程武装不起来。逐条写在
    //   `packages/core/src/e2e-google-door-stub.ts` 头上。）
    expect(
      verifyE2eGoogleIdToken(mintE2eGoogleIdToken(claims, `${SECRET}-someone-else`), ARMED),
    ).toBe(false);
    // 载荷被改过（签名还是原来那一份）：同一个 token 换一个邮箱就能冒充别人，是这道锁要挡的。
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...claims, email: "victim@example.com" }),
    ).toString("base64url");
    expect(verifyE2eGoogleIdToken(`${header}.${tamperedPayload}.${token.split(".")[2]}`, ARMED)).toBe(false);
    // 一段随手写的字符串。
    expect(verifyE2eGoogleIdToken(`${header}.${payload}.not-a-signature`, ARMED)).toBe(false);
    expect(verifyE2eGoogleIdToken("not-a-jwt", ARMED)).toBe(false);
    expect(verifyE2eGoogleIdToken("", ARMED)).toBe(false);
  });

  it("SIGNIN-A12 —— 密钥短于 32 位一律拒（与 server.ts 顶上那道警戒线同一个门槛）", () => {
    const short = "too-short";
    const token = mintE2eGoogleIdToken(claims, short);
    expect(
      verifyE2eGoogleIdToken(token, { ...ARMED, BETTER_AUTH_SECRET: short }),
    ).toBe(false);
    expect(
      verifyE2eGoogleIdToken(token, { [E2E_GOOGLE_DOOR_STUB_ENV]: "1", DATABASE_URL: TEST_DB }),
    ).toBe(false);
  });

  it("SIGNIN-A12 —— 武装之后挂上去的正是库要用的那个钩子", async () => {
    const options = e2eGoogleDoorStubProviderOptions(ARMED);
    expect(typeof options.verifyIdToken).toBe("function");
    await expect(options.verifyIdToken!(mintE2eGoogleIdToken(claims, SECRET))).resolves.toBe(true);
    await expect(options.verifyIdToken!("forged")).resolves.toBe(false);
  });
});
