/**
 * Google 门的 **E2E 替身**：一条只有测试跑道上才存在的路，用来在没有 Google 的机器上走完
 * 「按 Continue with Google」之后那一整段（docs/specs/sign-in.md 已冻结 · v1，SIGNIN-A12）。
 *
 * 为什么需要它。A12 的旅程要求「码门登录 → 生成 → 登出 → **同邮箱 Google 登录** → 看到同一个
 * 工作区」。E2E 跑道上没有 Google，也永远不该有（`e2e/support/env.ts` 逐条挡掉一切能打出这台
 * 机器的凭据），而真 Google 那一趟有两段是我们够不着的网络：浏览器跳 `accounts.google.com`，
 * 服务端 POST `oauth2.googleapis.com/token`。Better Auth 的 Google 供应商把这两个地址**写死**
 * 在库里（`@better-auth/core/dist/social-providers/google.mjs`），换不掉。
 *
 * 替身换掉的是**哪一段**，说清楚。Better Auth 自己就有第二条 Google 入口：`/sign-in/social`
 * 带 `idToken`（Google One Tap 走的那条，`api/routes/sign-in.mjs:76-126`）。它跳过的只有
 * 「跳转到 Google、再拿 code 换 token」这一段网络；换来的 id_token 之后的每一步都是产品自己的：
 * `handleOAuthUserInfo` 的账号合并（A3/A12 成立的机制）、`databaseHooks.user.create.before`
 * 的三步判定与 A13 的邮箱验证断言、`session.create.before` 的复查、身份收敛、会话 cookie。
 * 这条路上唯一被替掉的，是 **Google 那个签名**——`verifyIdToken`。
 *
 * 三把锁，缺一不开：
 *   ① `E2E_GOOGLE_DOOR_STUB` 必须逐字等于 `"1"`。默认不设＝这个模块什么都不做，供应商配置与
 *      今天**逐字相同**（`server.ts` 里那一处是展开一个空对象）。它在 env 契约里登记为
 *      「生产不许出现」（`packages/core/src/env-contract.ts`，`productionValues` 空数组），
 *      而且那条围栏打了 `warnImmune`：**不可降级** —— 带着它的 serving 生产进程一律拒绝启动，
 *      `FIKIRTIVE_ENV_CONTRACT=warn` 的逃生门也降不了它。这一格与 `AUTH_EMAIL_TRANSPORT=stub`
 *      分道扬镳：那一条是「这个部署寄不出信」，可用性，逃生门够得着。
 *   ② 这个进程必须指着一个**用完就扔的 `_test` 库**（`pointsAtThrowawayTestDatabase`：配上的
 *      每一个数据库地址——直连与池化两个——库名都得以 `_test` 结尾）。它不是一个新开关（新开关
 *      会变成新的误设面），是一个结构性事实：`next start` 自己把 NODE_ENV 设成 production，
 *      跑道那个进程在开机检查眼里与真部署一模一样，靠这一条才分得开。
 *      同一个判据出现在两处，是刻意的分工：env 契约用它做 `productionExemptWhen`（让跑道那个
 *      进程起得来，而别的生产进程起不来），`e2eGoogleDoorStubArmed()` 用它做武装前提（让「只有
 *      指向 `_test` 库的进程可武装」在**非**生产进程上同样成立——开机检查那一格只在生产判，
 *      单靠它，一个连着正式库的开发进程照样能挂上替身。判官 #1349 P2）。
 *   ③ 替身 token 必须带一个用 `BETTER_AUTH_SECRET` 算出来的 HMAC。
 *
 * 围栏到底靠什么成立，说准，别说过头。③ **不是**「反正也不产生新攻击面」：武装之后，
 * `BETTER_AUTH_SECRET` **单独一把**就能换到一个属于任意邮箱的会话——它本来也是签会话 cookie
 * 的那把密钥，但那条路要求先有一个会话可签，这条路不要求，只要一个 HMAC 和一个邮箱。所以真正
 * 的围栏只有两条，两条都在上面①②那两格与运维纪律里：**服务真商家数据的进程一律武装不起来**
 * （生产侧是不可降级的开机检查，非生产侧是 `e2eGoogleDoorStubArmed()` 自己那道 `_test` 库
 * 判据），以及**这把密钥保密**。③在跑道上的作用是别的：它让替身不是一个谁都能敲的门（同机器上
 * 跑着的别的进程、浏览器里的页面脚本都递不出一个能过的 token），也让「签名不对就是拒绝」在
 * 旅程里证得出来。
 *
 * NODE_ENV 不在锁里是刻意的，不是漏了：`next start`（e2e 跑的正是它）自己把 NODE_ENV 设成
 * production，所以「非生产」在这个进程里根本不是一个观察得到的事实（同一个理由逐字写在
 * `e2e/support/env.ts` 的 AUTH_EMAIL_TRANSPORT 那一段）。
 *
 * 为什么住在 `packages/core` 而不是 `apps/web/lib/better-auth/`：签名的形状必须**只有一份**。
 * 验它的是 web（`lib/better-auth/server.ts` 把 `verifyIdToken` 挂上去），铸它的是 E2E 套件
 * （`e2e/support/auth.ts`），两边各写一遍 HMAC 就是两份会各自漂移的真相。`e2e/` 不是 pnpm
 * workspace 项目，按路径吃各个包的 dist（理由逐字在 `e2e/support/db.ts`），而 apps/web 是
 * CommonJS 编译出来的——所以「两边都够得着的同一份」只有这里。它的生产围栏（`E2E_GOOGLE_DOOR_STUB`
 * 的 productionValues 空数组）也正好住在同一个包的 `env-contract.ts` 里。
 *
 * 刻意**不**进 `index.ts` 的主 barrel：它是一条测试跑道上的路，不是领域词汇。走自己的子路径
 * 导出（`@fikirtive/core/e2e-google-door-stub`），谁 import 它谁在 diff 里看得见。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { pointsAtThrowawayTestDatabase } from "./env-contract.js";

/** 武装开关的变量名，只有一处字面量。 */
export const E2E_GOOGLE_DOOR_STUB_ENV = "E2E_GOOGLE_DOOR_STUB";

/**
 * 武装了吗。**两个条件同时成立才算**：
 *
 *   ① `E2E_GOOGLE_DOOR_STUB` 逐字等于 `"1"`。任何别的值（包括 "true"、"yes"）一律视为没开
 *      —— 与 `SIGNUPS_PAUSED` 那种「除了明确的关都算开」相反，因为这一条开着是**放宽**，
 *      放宽的开关必须 fail closed。
 *   ② 这个进程指着一个用完就扔的 `_test` 库（`pointsAtThrowawayTestDatabase`，与 env 契约里
 *      那条豁免同一个判据、同一份代码）。
 *
 * ② 为什么在**这里**而不是只在开机检查里（判官 #1349 P2）：开机检查那一格只在
 * `opts.production` 为真时判，于是一个 `NODE_ENV=development`、却连着正式库的进程，开机照过，
 * 替身照挂 —— 「只有指向 `_test` 库的进程可武装」就成了一句只有生产才算数的话。武装与否是
 * **这个模块自己**的事实，判据就该由这个模块自己执行：条件不成立，`verifyIdToken` 根本不会被
 * 挂上去，一个签得再对的替身 token 也不作数。开机检查仍然是必要的另一半 —— 它让一个会武装的
 * 生产进程**根本起不来**，而不是起来之后安静地少一扇门。
 */
export function e2eGoogleDoorStubArmed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if ((env[E2E_GOOGLE_DOOR_STUB_ENV] ?? "").trim() !== "1") return false;
  return pointsAtThrowawayTestDatabase(env);
}

function signature(headerAndPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(headerAndPayload).digest("base64url");
}

/**
 * 铸一个形状对的替身 id_token：`<header>.<payload>.<HMAC>`。
 *
 * 载荷的字段名是 Google 的（`sub` / `email` / `email_verified` / `name` / `picture`）——
 * 库自己的 `getUserInfo` 直接 `decodeJwt` 它，读的就是这几个（google.mjs:82-100）。
 */
export function mintE2eGoogleIdToken(
  claims: Readonly<Record<string, unknown>>,
  secret: string,
): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const headerAndPayload = `${part({ alg: "HS256", typ: "JWT", kid: "e2e-google-door-stub" })}.${part(claims)}`;
  return `${headerAndPayload}.${signature(headerAndPayload, secret)}`;
}

/**
 * 替身 token 的校验。**三把锁都过才为真**，任何一把没过一律 false —— false 在库里的意思是
 * 「这个 id_token 不作数」，拒绝，不是放行（sign-in.mjs:82-85）。
 */
export function verifyE2eGoogleIdToken(
  token: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!e2eGoogleDoorStubArmed(env)) return false;
  const secret = (env.BETTER_AUTH_SECRET ?? "").trim();
  // 与 `server.ts` 顶上那道警戒线同一个门槛：短密钥签不出可信的东西。
  if (secret.length < 32) return false;
  const [header, payload, given] = token.split(".");
  if (header === undefined || payload === undefined || given === undefined) return false;
  if (token.split(".").length !== 3) return false;
  const expected = Buffer.from(signature(`${header}.${payload}`, secret), "utf8");
  const actual = Buffer.from(given, "utf8");
  // 长度不同就不比：timingSafeEqual 对不等长会抛，而抛出去会变成 500 而不是一次干净的拒绝。
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * 给 `socialProviders.google` 展开的那一小块配置。
 *
 * 没武装就是**空对象** —— 生产上的供应商配置因此与今天逐字相同，这一段代码在那里不存在。
 * 「没武装」包括开关开着、但这个进程连的不是 `_test` 库的那一类（判官 #1349 P2）：覆写压根
 * 挂不上去，而不是挂上去之后再去判。武装了才挂 `verifyIdToken` 覆写（覆写的是库对 Google
 * 签名的校验，`google.mjs:62-79`）。
 */
export function e2eGoogleDoorStubProviderOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { verifyIdToken?: (token: string) => Promise<boolean> } {
  if (!e2eGoogleDoorStubArmed(env)) return {};
  return { verifyIdToken: async (token: string) => verifyE2eGoogleIdToken(token, env) };
}
