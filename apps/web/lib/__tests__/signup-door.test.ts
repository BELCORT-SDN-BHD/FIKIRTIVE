/**
 * signup-door.test.ts — 自助注册那扇门，今天的答案是「关着」(integration)。
 *
 * SIGNIN-A4 —— #543 曾经在 `/sign-up/email` 上开了一扇自助注册门（邮箱 + 密码 + 店名），这个
 * 文件当时钉的是它开着时的全部性质。docs/specs/sign-in.md（已冻结 · v1）把密码整体退役之后，
 * 那扇门连同它的验证信、欢迎赠金落点、以及「注册即邀请」的写入一起没了：路径在 router 层
 * 404（`CLOSED_PASSWORD_PATHS`）。
 *
 * 文件留在原地，主语换成现在这一件事 —— 这扇门是**怎么关的**，以及关掉之后哪些性质必须原样
 * 不动。删掉它会连带删掉后面三段仍然为真、而且没有第二个地方看着的围栏：
 *   · 退役页面不在登录墙后面（旧链接进得来，才转得到 /login）；
 *   · 码门仍然是 invite-only —— 陌生地址拿不到码，也不会因此得到一行 AllowedEmail；
 *   · 三道公开门的每小时闸各自一个桶，且不在 BA 的 customRules 里。
 *
 * 「暂停开关」那一段留下的是它**纯函数**的那一半（`signupsPaused()` 的取值口径）：开关本身
 * 由登录门④（SIGNIN-A6）接手，那时它要管的是码门与 Google 门，不再是密码注册。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type SentEmail = { to: string; subject: string; text?: string; devPreview?: string };
const sent: SentEmail[] = [];

vi.mock("@/lib/email", () => ({
  emailPort: { send: vi.fn(async (m: SentEmail) => { sent.push(m); }) },
  EmailSendError: class EmailSendError extends Error {},
}));

// Set BEFORE the top-level dynamic imports below — Better Auth reads baseURL/secret at
// construction time, which happens at module load, not in beforeAll.
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "";
delete process.env.SIGNUPS_PAUSED;

const { auth } = await import("@/lib/better-auth/server");
const { prisma } = await import("@fikirtive/db");
const { SIGNUP_GRANT_CREDITS } = await import("@fikirtive/core");
const { enqueueAuthEmail, authEmailQueueSettled, __configureAuthEmailQueueForTests } = await import(
  "@/lib/better-auth/sender"
);

beforeEach(() => {
  sent.length = 0;
  delete process.env.SIGNUPS_PAUSED;
  // #678 — auth emails leave on a background queue that jitters each job and holds its worker
  // for a fixed floor, so that the arrival time of one merchant's email cannot be read as an
  // answer about another merchant's address. This file is about the SIGN-UP door, not that
  // queue (whose own properties are asserted in auth-email-queue-executor), so it takes the
  // delays out.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
});

/** 探针用的一份「像样的」密码：这扇门已经不看它了，写出来只是为了让请求长得和当年一样。 */
const PASSWORD = "correct-horse-battery-staple";
/** 一个没人用过的地址。退役之后它唯一的用途是证明「打这扇门什么都不会发生」。 */
const newEmail = () => `merchant-${randomUUID()}@fikirtive.test`;

/** 公网怎么打这扇门：和浏览器当年一模一样的一次 POST，经过整个 router。 */
async function postSignUp(body: { email: string; password: string; name: string }) {
  const res = await auth.handler(
    new Request("http://localhost:3100/api/better-auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    }),
  );
  // 队列 settle 一次再看收件箱：寄信在请求路径之外（#678），不等它就会拿一个还没发生的空箱
  // 当作「什么都没寄」。
  await authEmailQueueSettled();
  return res;
}

describe("SIGNIN-A4 · 这扇门关了 —— 打它什么都不会发生", () => {
  it("SIGNIN-A4 —— /sign-up/email 回 404，而且一行都没写", async () => {
    const email = newEmail();
    const res = await postSignUp({ email, password: PASSWORD, name: "Kopi Corner" });
    expect(res.status).toBe(404);

    // 不建号、不发邀请、不寄信、不建租户 —— 这四件事以前是这扇门开着时的全部产物。
    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
  });

  it("SIGNIN-A4 —— 关掉的是这扇门本身，不是「零用户 = 没人注册过」", async () => {
    // 一个已经存在的地址走同一扇门，答案必须还是 404 —— 也就是说 404 来自路由，而不是来自
    // 「这个地址我们不认识」。后者会是一个新的枚举面。
    const email = newEmail();
    await prisma.betterAuthUser.create({
      data: { id: randomUUID(), name: "Existing", email, emailVerified: true },
    });
    const res = await postSignUp({ email, password: PASSWORD, name: "Kopi Corner" });
    expect(res.status).toBe(404);
    await prisma.betterAuthUser.delete({ where: { email } });
  });

  it("SIGNIN-A4 —— 欢迎赠金的落点没有跟着这扇门一起消失", async () => {
    // 赠金本身归首登副作用（`bootstrapPersonalOrg`），与走哪扇门无关；这里只钉那个常量还在，
    // 免得「注册门没了」被读成「新商家不再有开机赠金」。真正的一次性证明在
    // signup-grant-exactly-once.test.ts。
    expect(SIGNUP_GRANT_CREDITS).toBeGreaterThan(0);
  });
});

describe("#543 · the pause switch — fail-closed, honest", () => {
  // SIGNIN-A4 —— 「开关拦住注册端点」那一条随密码注册一起退役：端点先 404，开关根本轮不到
  // 说话。开关本身要管的下一件事是码门与 Google 门（SIGNIN-A6，登录门④），到那时它会有自己的
  // 行为测试。这里留下的是它今天仍然为真的那一半：取值口径 fail-closed。

  it("treats any unrecognised value as PAUSED (fail-closed), and only explicit off values as open", async () => {
    const { signupsPaused } = await import("@/lib/signup-gate");
    for (const on of ["1", "true", "yes", "TRUE", "paused", "maybe"]) {
      process.env.SIGNUPS_PAUSED = on;
      expect(signupsPaused()).toBe(true);
    }
    for (const off of ["", "0", "false", "off", "no"]) {
      process.env.SIGNUPS_PAUSED = off;
      expect(signupsPaused()).toBe(false);
    }
    delete process.env.SIGNUPS_PAUSED;
    expect(signupsPaused()).toBe(false);
  });
});

describe("#543 · what must NOT open", () => {
  it("SIGNIN-A4 —— 一个被撤销的地址仍然一条路都没有（撤销是绝对的）", async () => {
    const email = newEmail();
    await prisma.allowedEmail.create({ data: { email, status: "revoked", invitedBy: "operator@fikirtive.test" } });

    // 注册门 404。
    expect((await postSignUp({ email, password: PASSWORD, name: "Banned Shop" })).status).toBe(404);
    // 码门那一侧：被撤销的地址拿不到码，也不会被复活成 active。
    enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
    await authEmailQueueSettled();
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);

    const row = await prisma.allowedEmail.findUnique({ where: { email } });
    expect(row?.status).toBe("revoked"); // never resurrected
    expect(row?.invitedBy).toBe("operator@fikirtive.test");
    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
  });

  it("the sign-in code stays invite-only — an unknown email gets no code, and registers nothing", async () => {
    const email = newEmail();
    // Straight at the queue, because that is the only way in: the HTTP endpoint that mints a
    // code is in `disabledPaths` (see auth-enumeration-structural.test.ts for that half). This
    // is the background side's own gate — the one that decides whether an address that reached
    // the queue is allowed to be mailed at all.
    enqueueAuthEmail({ purpose: "sign-in-code", email, overBudget: false });
    await authEmailQueueSettled();

    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
    // Asking for a code is not registration: an unknown address gets no invite row out of it.
    expect(await prisma.allowedEmail.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.betterAuthUser.findUnique({ where: { email } })).toBeNull();
  });

  it("SIGNIN-A4 —— 密码登录门也没了：它答 404，不再答「凭据错误」", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email: newEmail(), password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("SIGNIN-A4 · 退役的三个地址不在登录墙后面 —— 进得来才转得到 /login", () => {
  it("SIGNIN-A4 —— the auth wall exempts /signup, /forgot-password and /reset-password", async () => {
    const { config } = await import("@/proxy");
    const matcher = new RegExp(`^${config.matcher[0]!}$`);
    for (const walled of ["/", "/otto", "/settings"]) expect(matcher.test(walled)).toBe(true);
    for (const open of ["/signup", "/forgot-password", "/reset-password", "/login"]) {
      expect(matcher.test(open)).toBe(false);
    }
  });
});

/**
 * #543 + #795 r3 —— 公开门的限流,现在是**两层**,这个 describe 断言的是各自的真实位置。
 *
 * 这里原本断言三道门在 Better Auth 的 `customRules` 里各有一条每小时规则。#795 把那三条撤了,
 * 原因是库执行不出来:`storage: "database"` 时它按 `max(全局 window, 自带特殊规则窗口)` = 60 秒
 * 清理计数行,而且清理时不看命中的是哪条 customRule —— 写着「5 次/小时」,执行出来的是
 * 「5 次/分钟」。所以每小时闸搬到了我们自己的计数器上(它按自己的 expiresAt 清理),BA 那一层
 * 留下的是它自带的短窗突发规则。
 *
 * 「有一条规则」不再是可断言的事实;「哪一层拦哪一种」才是。
 */
describe("#543 · the newly public endpoints carry a rate-limit fail-safe", () => {
  // r5/r7 —— 门的清单不在这里手抄一份,而是从**唯一那份清单**读出来。r7 把它从路由文件搬到
  // lib/public-auth-doors.ts:路由是请求入口,不是别处读数据的地方(搬家的完整理由,以及
  // 「多一个导出会炸 next build」这个说法为什么在本 app 上不成立,都写在那个文件里)。
  //
  // SIGNIN-A4 —— 清单原本三道:注册、重置密码、验证信重发。前两道随密码退役(规格 §1.4 明写
  // 「`HOURLY_PUBLIC_DOORS` 里的密码门一并撤下」),今天只剩验证信重发这一道;它们变成 404 之后
  // 的性质由 better-auth-route.test.ts 的 SIGNIN-A4 那一组钉。
  let PUBLIC_DOORS: readonly string[] = [];
  beforeAll(async () => {
    ({ HOURLY_PUBLIC_DOORS: PUBLIC_DOORS } = await import("@/lib/public-auth-doors"));
  });

  it("SIGNIN-A4 —— 路由清单只剩验证信重发这一道,密码那两道随门撤下", () => {
    expect([...PUBLIC_DOORS]).toEqual(["/send-verification-email"]);
  });

  beforeEach(async () => {
    const { prisma: db } = await import("@fikirtive/db");
    await db.rateLimitCounter.deleteMany({});
  });

  it("每小时闸在我们自己的计数器上,不再在 BA 的 customRules 里", async () => {
    const ctx = await auth.$context;
    const rules = (ctx.options.rateLimit?.customRules ?? {}) as Record<string, unknown>;
    for (const path of PUBLIC_DOORS) {
      // 一条库执行不出来的规则比没有规则更糟:它让人以为门是关着的。
      expect(rules[path], `${path} 又回到了 customRules —— 那里的每小时窗口执行不出来`).toBeUndefined();
    }
    const { PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } = await import("@/lib/rate-limit-gates");
    expect(PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR).toBeGreaterThan(0);
  });

  it("BA 这一层的计数落库,所以它自带的突发规则跨实例共享(而不是每个实例一份)", async () => {
    const ctx = await auth.$context;
    expect(ctx.options.rateLimit?.storage).toBe("database");
    expect(ctx.options.rateLimit?.modelName).toBe("BetterAuthRateLimit");
  });

  it("行为上:同一个出口地址把每小时闸打满之后,公开门回 429", async () => {
    // 走的是真实请求路径(路由包装层),不是配置断言。用验证信重发这道门:地址不在名单上,
    // 它不建账号、不发信,所以这条用例只花计数,不留下别的痕迹。
    // 注:BA 自己的限流器在测试环境是关的(它默认只在生产开),所以这里量到的就是我们这一层。
    const { POST } = await import("@/app/api/better-auth/[...all]/route");
    const { PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } = await import("@/lib/rate-limit-gates");
    const press = () =>
      POST(
        new Request("http://localhost:3100/api/better-auth/send-verification-email", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
          body: JSON.stringify({ email: newEmail(), callbackURL: "/" }),
        }),
      );

    for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR; i += 1) {
      expect((await press()).status, `第 ${i + 1} 次不该被闸拦`).not.toBe(429);
    }
    const refused = await press();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("X-Retry-After"))).toBeGreaterThan(0);
  }, 120_000);

  it("每道门各有各的桶 —— 打满一道,同一个地址在别的门上还是满额", async () => {
    // SIGNIN-A4 —— 清单今天只剩一道门,所以「另一道」拿产品里另一个真实的 authdoor 主体来比:
    // 桶是按**门的路径**分的(`authdoor:<door>:<caller>`),这一条钉的正是那个分法。上一版靠
    // 清单里恰好有三道门来验,门一撤这条就无从跑起 —— 换成直接对着分桶规则验,它不随清单长短
    // 失效。
    const { consumePublicAuthDoor, PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR } = await import("@/lib/rate-limit-gates");
    const headers = new Headers({ "x-forwarded-for": "203.0.113.78" });

    // 打满清单里的每一道门。
    for (const spent of PUBLIC_DOORS) {
      for (let i = 0; i < PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR; i += 1) {
        expect(await consumePublicAuthDoor(spent, headers)).toBeNull();
      }
      expect(await consumePublicAuthDoor(spent, headers)).toBeGreaterThan(0);
    }

    // 同一个出口地址在另一条门路径上仍然是满额 —— 预算跟着门走,不跟着地址走。
    const other = "/a-different-public-door";
    expect([...PUBLIC_DOORS]).not.toContain(other);
    expect(await consumePublicAuthDoor(other, headers), `${other} 不该被别的门的预算连累`).toBeNull();
  }, 120_000);
});
