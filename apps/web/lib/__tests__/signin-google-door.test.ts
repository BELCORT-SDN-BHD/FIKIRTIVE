/**
 * GOOGLE 门，端到端（登录门③，issue #1318；规格 docs/specs/sign-in.md 已冻结 · v1）。
 *
 * 每一条用例都驱动**真的** Better Auth 实例打**真的**本地 Postgres。被替身掉的只有 Google 自己
 * 那一段网络：`https://oauth2.googleapis.com/token` 换成一个可控的应答，里面放一个可解码的
 * id_token。这不是为了省事，而是因为这条路上 Google 唯一说的话就是那个 id_token 的载荷 ——
 * `@better-auth/core/dist/social-providers/google.mjs:83-101` 的 `getUserInfo` 直接 `decodeJwt`
 * 它，`email` 与 `email_verified` 全部来自那里。替身换掉的是 Google，不是我们的任何一道闸：
 * state 是库自己签的、cookie 是库自己下的、建号建会话与四个数据库钩子全程照跑。
 *
 * 覆盖：SIGNIN-A2（陌生 Google 账号直接进产品且建号）、SIGNIN-A3（同邮箱两扇门进同一个账号）、
 * SIGNIN-A13（Google 报邮箱未验证一律拒绝且不建任何用户行）、SIGNIN-A14（Google 门任何失败都回
 * `/login` 页内提示）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// betterAuth() 在下面的动态 import 里就构造好了，env 必须先于它。
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
// #681 —— 没有这两个变量 Google 供应商根本不会注册（`googleSignInConfigured()`）。值是假的，
// 它们只进 token 请求的 body，而 token 端点在这个文件里由替身应答。
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
// 门的判定必须只由数据库那一行决定：环境名单空着，founder 是别人。
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
delete process.env.SIGNUPS_PAUSED;

const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");
const { clearRateLimitCounters } = await import("@fikirtive/db/rate-limit");
const { auth } = await import("@/lib/better-auth/server");

const ORIGIN = "http://localhost:3100";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** 每条用例留下的地址，afterAll 照单收拾（真库，跑完不许留噪音）。 */
const addresses: string[] = [];
function newAddress(prefix: string): string {
  const email = `google-${prefix}-${randomUUID()}@fikirtive.test`;
  addresses.push(email);
  return email;
}

/** 一个形状对的 id_token。签名是垃圾，因为这条路上没有人验它（见文件头）。 */
function idToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT", kid: "test" })}.${part(claims)}.not-a-signature`;
}

let googleTokenPayload: Record<string, unknown> = {};
const realFetch = globalThis.fetch;

/** LoginForm 按下 Continue with Google 的那一刻：库签一个 state、下一个 cookie、给出授权地址。 */
async function beginGoogle(errorCallbackURL: string | undefined): Promise<{ state: string; cookie: string }> {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/better-auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL }),
    }),
  );
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  expect(state).toBeTruthy();
  // 浏览器会带回来的那几块 cookie（state 的签名副本就在里面）。
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { state: state as string, cookie };
}

type GoogleReturn = {
  email?: string;
  emailVerified?: boolean;
  name?: string;
  sub?: string;
  /** Google 自己带回来的失败（商家在同意页按了取消 → `error=access_denied`）。 */
  error?: string;
  /** 不传＝完全不给 errorCallbackURL，用来证明「不传就落在 better-auth 自带错误页」。 */
  errorCallbackURL?: string;
};

/** 走完一整趟 Google 回调，返回商家浏览器真正收到的那个响应。 */
async function googleReturns(input: GoogleReturn): Promise<Response> {
  const { state, cookie } = await beginGoogle(
    "errorCallbackURL" in input ? input.errorCallbackURL : "/login",
  );
  if (input.error) {
    return auth.handler(
      new Request(
        `${ORIGIN}/api/better-auth/callback/google?state=${encodeURIComponent(state)}&error=${encodeURIComponent(input.error)}`,
        { headers: { cookie } },
      ),
    );
  }
  googleTokenPayload = {
    token_type: "Bearer",
    access_token: `gat-${randomUUID()}`,
    expires_in: 3600,
    scope: "openid email profile",
    id_token: idToken({
      iss: "https://accounts.google.com",
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: input.sub ?? `google-sub-${randomUUID()}`,
      email: input.email,
      email_verified: input.emailVerified ?? true,
      name: input.name ?? "Aisha Rahman",
      picture: "https://lh3.googleusercontent.com/test",
    }),
  };
  return auth.handler(
    new Request(
      `${ORIGIN}/api/better-auth/callback/google?state=${encodeURIComponent(state)}&code=auth-code-${randomUUID()}`,
      { headers: { cookie } },
    ),
  );
}

/**
 * 一次**裸的**回调请求：`state` 与 cookie 由调用方自己决定。
 *
 * `googleReturns` 每次都先 `beginGoogle` 铸一个新鲜 state，所以它量不到「state 解不开」那一类
 * 失败（回调被刷新／后退重放、state 过期、有人直接打回调地址）。那一类恰恰是 A14 最容易破的
 * 一半：state 读不出来的时候，`errorCallbackURL` 还躺在 state 里面，库拿不到它。
 */
async function callbackGoogle(query: string, cookie?: string): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/better-auth/callback/google?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

/** 码门那一趟，用库自己的服务端端点铸码（值是加密存的，手工塞一行验不过去）。 */
async function signInWithCode(email: string): Promise<Response> {
  const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
  return auth.handler(
    new Request(`${ORIGIN}/api/better-auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, otp }),
    }),
  );
}

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.startsWith(GOOGLE_TOKEN_ENDPOINT)) {
      return new Response(JSON.stringify(googleTokenPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input as RequestInfo, init);
  });
});

beforeEach(async () => {
  delete process.env.SIGNUPS_PAUSED;
  // SIGNIN-A17 的全站每小时新账号桶是共享的，别让别的文件（或本文件上一条）把它花光。
  await clearRateLimitCounters("signup:site");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  try {
    await prisma.signupGrantClaim.deleteMany({
      where: { canonicalEmail: { in: addresses.map((e) => e.toLowerCase()) } },
    });
    await prisma.betterAuthVerification.deleteMany({ where: { identifier: { contains: "google-" } } });
    const baUsers = await prisma.betterAuthUser.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    const ids = baUsers.map((u) => u.id);
    await prisma.betterAuthSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthUser.deleteMany({ where: { email: { in: addresses } } });
    const canonical = await prisma.user.findMany({
      where: { email: { in: addresses } },
      select: { id: true },
    });
    for (const { id } of canonical) {
      await prisma.creditLedger.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.creditAccount.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.membership.deleteMany({ where: { orgId: `org_${id}` } });
      await prisma.organization.deleteMany({ where: { id: `org_${id}` } });
    }
    await prisma.user.deleteMany({ where: { email: { in: addresses } } });
    await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  } catch {
    /* best-effort cleanup */
  }
});

describe("Google 门 —— 陌生人进得来", () => {
  it("SIGNIN-A2 —— 一个从未出现过的 Google 账号按 Continue with Google：直接进产品，账号与工作区当场建立", async () => {
    const stranger = newAddress("a2");

    const res = await googleReturns({ email: stranger });

    // 「直接进产品」：回调把商家转到他原本要去的地方，并且手上有会话 cookie。
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.getSetCookie().join("; ")).toContain("session_token");

    // 「账号与工作区已建立」，一次回调之内。
    const baUser = await prisma.betterAuthUser.findUnique({ where: { email: stranger } });
    expect(baUser?.emailVerified).toBe(true);
    const user = await prisma.user.findUnique({ where: { email: stranger } });
    expect(user).not.toBeNull();
    const org = await prisma.organization.findUnique({ where: { id: `org_${user!.id}` } });
    expect(org).not.toBeNull();
    // SIGNIN-A10 —— 工作区名一律为空，即使 Google 把「Aisha Rahman」这个人名带了进来。
    expect(org!.name).toBe("");
    expect(user!.name).toBe("Aisha Rahman");

    // 赠金恰好一笔，幂等键仍是 signup:<orgId>（登录门②立的规矩，换门不换键）。
    const grants = await prisma.creditLedger.findMany({ where: { orgId: `org_${user!.id}`, kind: "GRANT" } });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.balanceDelta).toBe(SIGNUP_GRANT_CREDITS);
    expect(grants[0]!.idempotencyKey).toBe(`signup:org_${user!.id}`);

    // 「注册即邀请」那一行，来源门写着 google（A10 的「只差来源门标记」）。
    const admitted = await prisma.allowedEmail.findUnique({ where: { email: stranger } });
    expect(admitted?.status).toBe("active");
    expect(admitted?.invitedBy).toBe("google");
  });
});

describe("Google 门 —— 同一个邮箱，两扇门进同一个账号", () => {
  it("SIGNIN-A3 —— 先用码登录过的邮箱改按 Google：同一个账号、同一个工作区，库里只有一个用户", async () => {
    const email = newAddress("a3-code-first");

    expect((await signInWithCode(email)).status).toBe(200);
    const afterCode = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(afterCode?.emailVerified).toBe(true);

    const res = await googleReturns({ email });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    // 合并而不是另开一户：同一个 ba_user 行，多出来的只是一条 google 凭据。
    expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(1);
    const afterGoogle = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(afterGoogle!.id).toBe(afterCode!.id);
    const providers = (
      await prisma.betterAuthAccount.findMany({ where: { userId: afterGoogle!.id }, select: { providerId: true } })
    ).map((a) => a.providerId);
    expect(providers).toContain("google");

    // 一个用户、一个工作区、一笔赠金。
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const user = (await prisma.user.findUnique({ where: { email } }))!;
    expect(await prisma.organization.count({ where: { id: `org_${user.id}` } })).toBe(1);
    expect(await prisma.creditLedger.count({ where: { orgId: `org_${user.id}`, kind: "GRANT" } })).toBe(1);
  });

  it("SIGNIN-A3 —— 反过来：先按 Google 后用码，进的还是同一个账号、同一个工作区", async () => {
    const email = newAddress("a3-google-first");

    expect((await googleReturns({ email })).status).toBe(302);
    const afterGoogle = await prisma.betterAuthUser.findUnique({ where: { email } });
    expect(afterGoogle).not.toBeNull();
    const user = (await prisma.user.findUnique({ where: { email } }))!;

    expect((await signInWithCode(email)).status).toBe(200);

    expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(1);
    expect((await prisma.betterAuthUser.findUnique({ where: { email } }))!.id).toBe(afterGoogle!.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect((await prisma.user.findUnique({ where: { email } }))!.id).toBe(user.id);
    expect(await prisma.organization.count({ where: { id: `org_${user.id}` } })).toBe(1);
    expect(await prisma.creditLedger.count({ where: { orgId: `org_${user.id}`, kind: "GRANT" } })).toBe(1);
  });
});

describe("Google 门 —— 未验证的邮箱一行都写不下", () => {
  it("SIGNIN-A13 —— Google 报 email_verified: false：回 /login 提示改用 email，数据库里不建任何用户行", async () => {
    const unverified = newAddress("a13");

    const res = await googleReturns({ email: unverified, emailVerified: false });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/login?")).toBe(true);
    expect(new URL(location, ORIGIN).searchParams.get("error")).toBe("sign_in_email_unverified");

    // 「数据库里没有为它建任何用户行」—— 两张用户表都要空。
    expect(await prisma.betterAuthUser.count({ where: { email: unverified } })).toBe(0);
    expect(await prisma.user.count({ where: { email: unverified } })).toBe(0);
    // 名单行也没有：`admitSelfSignup` 挂在 user.create.after 上，那一步根本没到。
    expect(await prisma.allowedEmail.count({ where: { email: unverified } })).toBe(0);
    // 没有会话。
    expect(res.headers.getSetCookie().join("; ")).not.toContain("session_token");
  });
});

/**
 * SIGNIN-A14 —— 「Google 门失败一次（取消授权、撤销邮箱、暂停期陌生人各一次）→ 每次都回到
 * `/login` 页内提示；从不落在 better-auth 自带错误页，从不出现裸 JSON」。
 *
 * ## 核对过的错误键（better-auth 1.6.20，本仓库 node_modules 里的 dist）
 *
 * 键从三个地方来，全部经 `oauth2/errors.mjs` 的 `redirectOnError(ctx, errorURL, error)` 写成
 * `?error=<键>`。`errorURL` 有两个来源，**两个都得在**，否则这条验收有一半是假的：
 *   · state 解得开时，用 state 里那份 —— 也就是 LoginForm 传下去的 `errorCallbackURL`
 *     （`oauth2/state.mjs` 的 `generateState`/`parseState`）；
 *   · state 解**不**开时（下面第 ② 条里的五个 `state_*` 键），那份值就在解不开的 state 里，
 *     库只能退回 `options.onAPIError?.errorURL || ${baseURL}/error`
 *     （`dist/oauth2/state.mjs:33`）。所以 `lib/better-auth/server.ts` 配了
 *     `onAPIError: { errorURL: "/login" }` 当地板，围栏是本文件最后那四条。
 *
 *   ① Google 自己带回来的 `error` 参数，**原样**当键（`api/routes/callback.mjs:56`）。商家在
 *      同意页按取消就是 `access_denied`。
 *   ② 回调自己的失败（同文件）：`invalid_callback_request`、`no_code`、
 *      `oauth_provider_not_found`、`invalid_code`、`unable_to_get_user_info`、`no_callback_url`、
 *      `email_not_found`；state 那一段还有 `state_not_found`、`state_mismatch`、`state_invalid`、
 *      `state_generation_error`、`internal_server_error`（`state.mjs` 的 StateError.code，经
 *      `oauth2/state.mjs:parseState`）。
 *   ③ `handleOAuthUserInfo` 的返回值（`oauth2/link-account.mjs`）被 `callback.mjs:156-158` 做
 *      `split(" ").join("_")` 之后当键：`account_not_linked`、`unable_to_link_account`、
 *      `signup_disabled`、`unable_to_create_user`、`unable_to_create_session`。**我们自己的拒绝
 *      也走这条**：`link-account.mjs:107-111` 的 catch 把 APIError 变成 `{ error: e.message }`。
 *   ④ 建**会话**那一刻的拒绝走的是另一条：APIError 穿到 `callback.mjs:152-155` 的
 *      `isAPIError(e) && e.body?.code`，读的是 `body.code`。没有 code 就不转向 —— 那正是规格
 *      §1.4 记下来的「没有 Location 的 403 JSON」。
 *
 * ③ 与 ④ 读的是同一个 APIError 的两个不同字段，所以 `lib/better-auth/signin-refusal.ts` 把
 * `message` 与 `code` 定成同一个不含空格的常量。下面两条用例各走其中一条路，键必须一样。
 *
 * 页面文案不在这里分岔：`app/login/page.tsx` 对**任何**键都只说同一句（规格 §1.3 防枚举），
 * 围栏在 `app/login/__tests__/login-google-door-errors.test.tsx`。
 */
describe("Google 门 —— 每一种失败都回登录页", () => {
  function expectsLandsOnLogin(res: Response, error: string) {
    // 转向，不是裸 JSON。
    //
    // 「裸 JSON」是有形状的：规格 §1.4 说的那一份是 **403 且没有 Location** —— 浏览器无处可去，
    // 只好把 body 画出来。所以这里量的是那两件事，而不是 content-type：better-call 给每一个响应
    // 都盖 `application/json`（转向那一份的 body 是空的，浏览器根本不会读它），拿它当判据会把
    // 一次正确的转向也判成裸 JSON。
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBeTruthy();
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/login?")).toBe(true);
    // 从不落在 better-auth 自带错误页。
    expect(location).not.toContain("/api/better-auth/error");
    expect(new URL(location, ORIGIN).searchParams.get("error")).toBe(error);
  }

  it("SIGNIN-A14 —— 取消授权（Google 回 access_denied）：回 /login，不落在 better-auth 自带错误页", async () => {
    expectsLandsOnLogin(await googleReturns({ error: "access_denied" }), "access_denied");
  });

  it("SIGNIN-A14 —— 被撤销的邮箱：回 /login，不再是一份没有 Location 的 403 JSON", async () => {
    // 一个真的、已验证的既有账号，被操作员撤销。撤销的人早就有用户行，所以这一趟被拒在
    // **建会话**那一刻（上面注释里的第 ④ 条路）。
    const revoked = newAddress("a14-revoked");
    await prisma.betterAuthUser.create({
      data: { id: `bau_${randomUUID()}`, email: revoked, name: "Revoked Shop", emailVerified: true },
    });
    await prisma.allowedEmail.create({
      data: { email: revoked, status: "revoked", invitedBy: "operator@fikirtive.test" },
    });

    const res = await googleReturns({ email: revoked });

    expectsLandsOnLogin(res, "sign_in_revoked");
    expect(res.headers.getSetCookie().join("; ")).not.toContain("session_token");
    expect(await prisma.betterAuthSession.count({ where: { user: { email: revoked } } })).toBe(0);
  });

  it("SIGNIN-A14 —— 暂停期的陌生人：回 /login，且一行账号都没写下", async () => {
    // 陌生人 + 暂停开关 → 被拒在**建号**那一刻（第 ③ 条路，键从 message 来）。
    const stranger = newAddress("a14-paused");
    process.env.SIGNUPS_PAUSED = "1";

    const res = await googleReturns({ email: stranger });

    expectsLandsOnLogin(res, "sign_in_paused");
    expect(await prisma.betterAuthUser.count({ where: { email: stranger } })).toBe(0);
    expect(await prisma.user.count({ where: { email: stranger } })).toBe(0);
  });

  it("SIGNIN-A14 —— Google 报邮箱未验证：同样回 /login，不落在自带错误页、不出现裸 JSON", async () => {
    // 验收表 A14 的括号里点名了三种失败，这是第四种：A13 那条用例量的是「一行都没写下」，
    // 这条量的是同一趟的**落点** —— 拒绝发生在建号那一刻（第 ③ 条路，键从 message 来），
    // 所以它和「暂停期陌生人」共用同一条回家的路，必须同样回到登录页。
    expectsLandsOnLogin(
      await googleReturns({ email: newAddress("a14-unverified"), emailVerified: false }),
      "sign_in_email_unverified",
    );
  });

  it("SIGNIN-A14 —— 不传 errorCallbackURL 也仍然回 /login：地板是 onAPIError.errorURL，不是 state 里那个字段", async () => {
    // 这条以前反着写（「不传就落在自带错误页」），量的是缺地板时的现状。地板补上之后它必须
    // 反过来：`errorCallbackURL` 只是 state 里的一份**副本**，真正兜底的是配置里那一行
    // （`parseState`：`parsedData.errorURL ||= options.onAPIError?.errorURL || baseURL/error`）。
    // LoginForm 那一行自己的围栏在 app/login/__tests__/login-google-door-errors.test.tsx 第一条。
    const stranger = newAddress("a14-no-error-url");
    process.env.SIGNUPS_PAUSED = "1";

    expectsLandsOnLogin(
      await googleReturns({ email: stranger, errorCallbackURL: undefined }),
      "sign_in_paused",
    );
  });

  /**
   * 以下四条量的是**state 解不开**那一类失败 —— A14 里最容易破的一半。
   *
   * 上面每一条都先 `beginGoogle` 铸一个新鲜 state，所以 `errorCallbackURL` 一直读得出来。真实
   * 旅程里有一整族失败读不出来：商家在回调页刷新或后退（state 行已被消费）、把回调地址收藏了
   * 下次再打、state 过了十分钟、或者有人裸打 `/api/better-auth/callback/google`。这时候
   * `errorCallbackURL` 还躺在解不开的那个 state 里面，库只能退回配置里的那一行
   * （`better-auth@1.6.20 dist/oauth2/state.mjs:33`）—— 没有它，商家看到的就是库自带的、
   * 没有品牌的 `<title>Error</title>` 页面，验收 A14 那句「从不落在 better-auth 自带错误页」
   * 在这五个键（state_not_found / state_mismatch / state_invalid / state_generation_error /
   * internal_server_error）上全是假的。
   */
  it("SIGNIN-A14 —— 回调里根本没有 state（有人直接打回调地址）：回 /login，不落在自带错误页", async () => {
    expectsLandsOnLogin(await callbackGoogle("code=whatever"), "state_not_found");
  });

  it("SIGNIN-A14 —— state 认不出来（过期／被清）：回 /login，不落在自带错误页", async () => {
    expectsLandsOnLogin(
      await callbackGoogle(`state=${encodeURIComponent(`no-such-state-${randomUUID()}`)}&code=whatever`),
      "state_mismatch",
    );
  });

  it("SIGNIN-A14 —— 回调被重放（刷新／后退，同一个 state 第二次）：回 /login，不落在自带错误页", async () => {
    // 第一趟是**真的成功登录**（state 行在这一趟被消费掉），第二趟才是商家按刷新的那一下。
    const replayed = newAddress("a14-replay");
    const { state, cookie } = await beginGoogle("/login");
    googleTokenPayload = {
      token_type: "Bearer",
      access_token: `gat-${randomUUID()}`,
      expires_in: 3600,
      scope: "openid email profile",
      id_token: idToken({
        iss: "https://accounts.google.com",
        aud: process.env.GOOGLE_CLIENT_ID,
        sub: `google-sub-${randomUUID()}`,
        email: replayed,
        email_verified: true,
        name: "Replay Shop",
        picture: "https://lh3.googleusercontent.com/test",
      }),
    };
    const query = `state=${encodeURIComponent(state)}&code=auth-code-${randomUUID()}`;

    const first = await callbackGoogle(query, cookie);
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");

    expectsLandsOnLogin(await callbackGoogle(query, cookie), "state_mismatch");
  });

  it("SIGNIN-A14 —— 库自带的错误页本身也被弹回 /login：它不再是任何一条路的落点", async () => {
    // 最后一道。上面三条走的是转向**之前**那一步；这条量的是自带错误页那个端点本身 ——
    // 将来任何一条我们没数到的路转到它，商家也不会停在 `<title>Error</title>` 上
    // （`dist/api/routes/error.mjs:371-375`：配了 errorURL 就 302 过去）。
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/better-auth/error?error=state_mismatch`),
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/login?")).toBe(true);
    expect(new URL(location, ORIGIN).searchParams.get("error")).toBe("state_mismatch");
  });
});
