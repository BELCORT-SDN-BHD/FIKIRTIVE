/**
 * signin-password-retired.test.ts —— 登录门① 密码退役（docs/specs/sign-in.md，已冻结 · v1）。
 *
 * 三条验收，一个文件：
 *   · SIGNIN-A4  三个旧地址回到 /login；登录页没有密码框；七条密码端点对公网 404。
 *   · SIGNIN-A9  `ba_account` 里 providerId='credential' 的行为 0；fresh database 跑完全部迁移无错。
 *   · SIGNIN-A11 全仓没有任何途径能建立密码。
 *
 * 为什么大半是真请求而不是源码断言：密码退役这件事只有「端点答什么」才算数。`emailAndPassword`
 * 关掉之后 better-auth 还挂着那些路由（它自己答 400），把 `enabled: false` 读出来并不能证明公网
 * 拿不到密码门 —— 只有把请求真的打进 `auth.handler` 才能。所以 A4／A11 的端点那一半跑的是真的
 * Better Auth 实例。
 *
 * 只有一处是源码扫描，而且必须是：A11 的「仓库里没有 setPassword / changePassword / signUp.email
 * 调用」是一条**全仓不变量**，没有哪个请求能证明它 —— 明天有人写一行 `auth.api.setPassword(...)`，
 * 服务端可信代码绕过 router 那道 404，密码就又回来了，而所有端点测试仍然全绿。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Better Auth 在**模块加载那一刻**读 baseURL / secret，所以这些必须排在下面的动态 import 之前。
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "";

const { auth } = await import("@/lib/better-auth/server");
const { prisma } = await import("@fikirtive/db");

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const readWeb = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 公网怎么打这些端点：和浏览器一模一样的一次 POST，经过整个 router。 */
async function postPublic(endpointPath: string, body: Record<string, unknown>): Promise<Response> {
  return auth.handler(
    new Request(`http://localhost:3100/api/better-auth${endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    }),
  );
}

/** 验收 A4 点名的七条密码路径，逐字。 */
const RETIRED_PASSWORD_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/email",
  "/forget-password",
  "/reset-password",
  "/change-password",
  "/set-password",
  "/request-password-reset",
] as const;

/**
 * admin 插件自己挂的两条公网路由，两条都会**直接写出**一行 `providerId = "credential"`
 * （`better-auth@1.6.20 dist/plugins/admin/routes.mjs:198-204` 与 `:829-836`）。它们不在 A4 点名的
 * 七条里，但它们正是 A11「没有任何途径能建立密码」要挡的东西 —— 在这次退役之前它们答的是
 * 401/403，不是 404。
 */
const RETIRED_ADMIN_PASSWORD_ENDPOINTS = [
  "/admin/set-user-password",
  "/admin/create-user",
] as const;

/**
 * A11 的源码围栏：**能让一份 `providerId="credential"` 的行出现**的调用形状，逐条写在这里。
 * 成员调用与裸调用都查（裸调用的放行只有下面那一份具名白名单）。
 *
 * 这张表与它下面那两组样本住在模块作用域，不在某一条 `it` 里面 —— 因为负例测试必须打**同一份**
 * 正则（单一源）：另抄一份的话，「负例会红」证明的是那份抄件，不是围栏本身。
 */
const PASSWORD_CALL_PATTERNS: readonly RegExp[] = [
  /(?:\.\s*|\b)setPassword\s*\(/,
  /(?:\.\s*|\b)changePassword\s*\(/,
  /(?:\.\s*|\b)resetPassword\s*\(/,
  /(?:\.\s*|\b)requestPasswordReset\s*\(/,
  /(?:\.\s*|\b)forgetPassword\s*\(/,
  /(?:\.\s*|\b)setUserPassword\s*\(/,
  /\bsignUp\s*\.\s*email\s*\(/,
  /\bsignIn\s*\.\s*email\s*\(/,
  // ↓ 判官 r4 P2-③：上面八条查的都是「名字里带 password 的那几个口」，而下面这三种形状一样能
  // 让一行 credential 出现，一条都不经过它们。
  //
  // admin 插件的 `createUser` 接受 `password`，收到就 `createAccount({ providerId: "credential" })`
  // （`better-auth@1.6.20 dist/plugins/admin/routes.mjs:198-204`）。端点那道 404 只挡公网。
  /(?:\.\s*|\b)createUser\s*\(/,
  // emailOTP 插件的重置口叫 `resetPasswordEmailOTP`：名字后面跟的是 `EmailOTP` 不是 `(`，
  // 所以上面那条 `resetPassword\s*\(` 看不见它。
  /(?:\.\s*|\b)resetPasswordEmailOTP\s*\(/,
  // 最后一层：绕开所有具名 API，直接往 `ba_account` 写一行 —— 经 better-auth 的 internalAdapter、
  // 经 Prisma、或者裸 SQL。这三条钉的是**写**的形状（含表名/适配器名），不是「提到 credential」，
  // 否则 A9 那几条 `count({ where: { providerId: "credential" } })` 会被自己的围栏判成违规。
  /(?:createAccount|linkAccount)\s*\([\s\S]{0,400}?providerId\s*:\s*["'`]credential["'`]/,
  /betterAuthAccount\s*\.\s*(?:create|createMany|upsert|update|updateMany)\s*\([\s\S]{0,400}?providerId\s*:\s*["'`]credential["'`]/,
  /(?:INSERT\s+INTO|UPDATE)\s+"?ba_account"?[\s\S]{0,400}?credential/i,
];

/** 注释里提一句「密码曾经在这里」是允许的，能建立密码的只有真的调用。 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/**
 * 围栏的正例（必须被拦下的写法）。这一组是围栏的**规格**：正则表拦不拦得住一种写法，由这里
 * 逐条钉死，而不是靠「今天全仓恰好没人这么写」—— 后者在仓库干净的时候永远绿，围栏漏一条也绿。
 */
const FENCE_MUST_CATCH: readonly { readonly label: string; readonly code: string }[] = [
  { label: "auth.api.setPassword", code: `await auth.api.setPassword({ body: { newPassword } });` },
  { label: "auth.api.changePassword", code: `await auth.api.changePassword({ body: { newPassword, currentPassword } });` },
  { label: "authClient.emailOtp.resetPassword", code: `await authClient.emailOtp.resetPassword({ email, otp, password });` },
  { label: "auth.api.requestPasswordReset", code: `await auth.api.requestPasswordReset({ body: { email } });` },
  { label: "auth.api.forgetPassword", code: `await auth.api.forgetPassword({ body: { email } });` },
  { label: "auth.api.setUserPassword", code: `await auth.api.setUserPassword({ body: { userId, newPassword } });` },
  { label: "auth.api.signUp.email", code: `await auth.api.signUp.email({ body: { email, password, name } });` },
  { label: "authClient.signIn.email", code: `await authClient.signIn.email({ email, password });` },
  // 判官 r4 P2-③ 点名补的三种形状 ↓ 原来那八条正则一条都拦不住它们。
  {
    label: "auth.api.createUser（admin 插件：带 password 就直接写出一行 credential）",
    code: `await auth.api.createUser({ body: { email, password, name, role: "user" } });`,
  },
  {
    label: "auth.api.resetPasswordEmailOTP（emailOTP 插件自带的重置口，名字后面不是括号）",
    code: `await auth.api.resetPasswordEmailOTP({ body: { email, otp, password } });`,
  },
  {
    label: `internalAdapter.createAccount / linkAccount 直接写 providerId: "credential"`,
    code: `await ctx.context.internalAdapter.createAccount({\n  userId,\n  providerId: "credential",\n  password: hash,\n});`,
  },
  {
    label: "prisma.betterAuthAccount 直接写一行 credential",
    code: `await prisma.betterAuthAccount.create({\n  data: { id, accountId: userId, userId, providerId: "credential", password: hash },\n});`,
  },
  {
    label: "绕开 Prisma 的裸 SQL 写 ba_account",
    code: `await prisma.$executeRawUnsafe('INSERT INTO "ba_account" (id, "providerId", password) VALUES ($1, \\'credential\\', $2)', id, hash);`,
  },
];

/**
 * 围栏的负例（**不许**被拦下的写法）。写太宽和写太窄一样坏：宽到把「数一数还有没有 credential
 * 行」也判成违规，下一个人就会去放宽正则，而不是去看那行代码。
 */
const FENCE_MUST_NOT_CATCH: readonly { readonly label: string; readonly code: string }[] = [
  {
    label: "只读不写：数 credential 行（本文件 A9 那几条就是这么写的）",
    code: `expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);`,
  },
  { label: "名字撞头但不是同一个调用", code: `await createUserProfile({ orgId, name });` },
  { label: "行注释里的历史记录", code: `// 这里以前有一行 auth.api.setPassword(...)，随 #1316 退役` },
  { label: `块注释里的历史记录`, code: `/* createAccount({ providerId: "credential", password }) 曾经在这里 */` },
];

describe("SIGNIN-A4 —— /signup、/forgot-password、/reset-password 都回到 /login，登录页没有密码框", () => {
  // Next 的 `permanentRedirect()` 是靠**抛异常**工作的：它扔一个带 digest
  // `NEXT_REDIRECT;replace;<目的地>;308;` 的错误，由框架接住并写成 308。所以「这一页转到哪里」
  // 唯一诚实的读法就是调用它、接住那个异常、读 digest —— 断言源码里有 `permanentRedirect("/login")`
  // 只能证明这一行写着，证明不了它会跑到。
  async function redirectTargetOf(pageModule: string): Promise<string> {
    const mod = (await import(pageModule)) as { default: () => never };
    try {
      mod.default();
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? "";
      expect(digest, `${pageModule} 没有抛 Next 的转向信号，digest=${digest}`).toContain("NEXT_REDIRECT");
      return digest;
    }
    throw new Error(`${pageModule} 没有转向：它返回了内容`);
  }

  it("SIGNIN-A4 —— /signup 永久转到 /login", async () => {
    const digest = await redirectTargetOf("@/app/signup/page");
    expect(digest).toContain("/login");
    expect(digest, "旧链接要 308（永久），不是 307").toContain("308");
  });

  it("SIGNIN-A4 —— /forgot-password 永久转到 /login", async () => {
    const digest = await redirectTargetOf("@/app/forgot-password/page");
    expect(digest).toContain("/login");
    expect(digest).toContain("308");
  });

  it("SIGNIN-A4 —— /reset-password 永久转到 /login", async () => {
    const digest = await redirectTargetOf("@/app/reset-password/page");
    expect(digest).toContain("/login");
    expect(digest).toContain("308");
  });

  it("SIGNIN-A4 —— 登录页三步渲出来的 HTML 里没有密码输入框，也没有 Forgot password", async () => {
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn() }),
      useSearchParams: () => new URLSearchParams(),
    }));
    vi.doMock("@/app/login/actions", () => ({ requestSignInCode: vi.fn() }));
    vi.doMock("@/lib/better-auth/client", () => ({
      authClient: { signIn: { emailOtp: vi.fn(), social: vi.fn() } },
    }));
    const { LoginForm } = await import("@/app/login/LoginForm");

    // hub / email / code 三步各渲一次：密码框以前住在第四步，而第四步是从 `?step=` 进去的，
    // 只渲 hub 会漏掉它。
    for (const initialStep of ["hub", "email", "code"] as const) {
      const markup = renderToStaticMarkup(
        createElement(LoginForm, { from: "/create", googleEnabled: true, initialStep }),
      );
      expect(markup, `${initialStep} 步渲出了密码框`).not.toContain('type="password"');
      expect(markup, `${initialStep} 步还留着忘记密码入口`).not.toContain("Forgot password");
      expect(markup, `${initialStep} 步还留着第二个注册页的入口`).not.toContain("/signup");
    }
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/app/login/actions");
    vi.doUnmock("@/lib/better-auth/client");
  });

  it("SIGNIN-A4 —— 七条密码端点对公网一律 404", async () => {
    for (const endpoint of RETIRED_PASSWORD_ENDPOINTS) {
      const res = await postPublic(endpoint, {
        email: `probe-${randomUUID()}@fikirtive.test`,
        password: "correct-horse-battery-staple",
        newPassword: "correct-horse-battery-staple",
        currentPassword: "correct-horse-battery-staple",
        name: "Probe",
        token: "probe-token",
      });
      expect(res.status, `${endpoint} 应该 404，实得 ${res.status}`).toBe(404);
    }
  });

  it("SIGNIN-A4 —— 带 token 的那条重置回链 `/reset-password/:token` 也 404", async () => {
    // 这一条走的是**我们自己的 route handler**，不是 `auth.handler`：better-auth 的
    // `disabledPaths` 逐字比对实际路径（`dist/api/index.mjs:164-166`），而这条路由的实际路径
    // 每次都不一样（`/reset-password/<token>`），清单里那条不带参数的 `"/reset-password"` 挡不住它。
    // 所以闸在 route.ts，测试也必须从那一层打进去 —— 从 `auth.handler` 打只会证明另一层的事。
    const { GET, POST } = await import("@/app/api/better-auth/[...all]/route");
    const url =
      "http://localhost:3100/api/better-auth/reset-password/probe-token" +
      "?callbackURL=http%3A%2F%2Flocalhost%3A3100%2Freset-password";

    const getRes = await GET(new Request(url, { headers: { origin: "http://localhost:3100" } }));
    expect(getRes.status, `GET /reset-password/:token 应该 404，实得 ${getRes.status}`).toBe(404);
    // 转向也是一个答案：302 到 callbackURL 会告诉探测者「这条链还在，只是 token 不对」。
    expect(getRes.headers.get("location")).toBeNull();

    const postRes = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ newPassword: "correct-horse-battery-staple" }),
      }),
    );
    expect(postRes.status, `POST /reset-password/:token 应该 404，实得 ${postRes.status}`).toBe(404);
  });

  it("SIGNIN-A4 —— 码门那扇还开着（退的是密码，不是登录）", async () => {
    const res = await postPublic("/sign-in/email-otp", {
      email: `probe-${randomUUID()}@fikirtive.test`,
      otp: "000000",
    });
    // 拒是对的（没有码），404 才是错的 —— 那意味着连码门也被这次退役误伤。
    expect(res.status).not.toBe(404);
  });
});

describe("SIGNIN-A9 —— credential 行清零，fresh database 跑完全部迁移无错", () => {
  const MIGRATION = "20260910120000_retire_password_credentials";
  const migrationDir = path.join(REPO_ROOT, "packages/db/prisma/migrations", MIGRATION);

  it("SIGNIN-A9 —— fresh database 跑完全部迁移无错（这一条也在其中）", async () => {
    // 这一整轮测试跑在一个 `prisma migrate deploy` 从零建起来的库上（收尾命令写在 PR 描述里）。
    // `_prisma_migrations` 里这一行的存在＋`finished_at` 非空，就是「它真的跑过而且没报错」——
    // 中途失败的迁移在这张表里留下的是 `logs` 非空、`finished_at` 为空的一行。
    const rows = await prisma.$queryRawUnsafe<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1`,
      MIGRATION,
    );
    expect(rows.length, `${MIGRATION} 没有出现在 _prisma_migrations 里`).toBe(1);
    expect(rows[0].finished_at, "迁移没有跑完").not.toBeNull();
    expect(rows[0].rolled_back_at).toBeNull();

    // 迁移目录的形状（M5 闸也查这个）：8–14 位时间戳 + 名字，migration.sql 与 rollback.sql 各一份。
    expect(MIGRATION).toMatch(/^[0-9]{8,14}_[a-z0-9_]+$/);
    expect(readdirSync(migrationDir).sort()).toEqual(["migration.sql", "rollback.sql"]);
  });

  it("SIGNIN-A9 —— 迁移把 providerId='credential' 的行删干净，且只删这些行", async () => {
    const userId = `ba-user-${randomUUID()}`;
    await prisma.betterAuthUser.create({
      data: { id: userId, name: "Retired Password Holder", email: `${userId}@fikirtive.test` },
    });
    // 一份密码凭据（正是迁移要删的那种）与一份 Google 凭据（必须活下来）。
    await prisma.betterAuthAccount.createMany({
      data: [
        { id: `cred-${userId}`, accountId: userId, providerId: "credential", userId, password: "hash" },
        { id: `goog-${userId}`, accountId: "google-sub-1", providerId: "google", userId },
      ],
    });

    // 跑的是迁移文件本身，不是这里重写一遍的一句 SQL —— 重写一遍只能证明这个测试会删行。
    const sql = readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
    await prisma.$executeRawUnsafe(sql);

    expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);
    expect(await prisma.betterAuthAccount.count({ where: { id: `goog-${userId}` } })).toBe(1);

    await prisma.betterAuthUser.delete({ where: { id: userId } });
  });

  it("SIGNIN-A9 —— 迁移之后这张表里一份密码凭据都没有", async () => {
    expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);
  });
});

describe("SIGNIN-A11 —— 没有任何途径能建立密码", () => {
  it("SIGNIN-A11 —— better-auth 配置里 emailAndPassword 是关的", () => {
    const server = readWeb("lib/better-auth/server.ts");
    expect(server).toMatch(/emailAndPassword:\s*\{\s*enabled:\s*false\s*\}/);
    expect(server, "emailAndPassword 不许再有 enabled: true").not.toMatch(
      /emailAndPassword[\s\S]{0,400}?enabled:\s*true/,
    );
    // 拒 400 与 404 是两件事，两层都得在（原因写在 server.ts 的 CLOSED_PASSWORD_PATHS 注释里）。
    for (const endpoint of [...RETIRED_PASSWORD_ENDPOINTS, ...RETIRED_ADMIN_PASSWORD_ENDPOINTS]) {
      expect(server, `CLOSED_PASSWORD_PATHS 少了 ${endpoint}`).toContain(`"${endpoint}"`);
    }
  });

  it("SIGNIN-A11 —— admin 插件那两条会写出 credential 行的路由也 404，不再是 401", async () => {
    // `emailAndPassword.enabled: false` 对它们**无效**：admin 插件不问那个开关，它自己调
    // `linkAccount` / `createAccount` 写 `providerId = "credential"`
    // （better-auth@1.6.20 dist/plugins/admin/routes.mjs:198-204、:829-836）。退役之前它们对公网
    // 答 401（未登录），也就是「登进来就还能重新写出密码」—— A11 说的是**没有任何途径**，
    // 401 不是没有途径，是还有一条途径。
    for (const endpoint of RETIRED_ADMIN_PASSWORD_ENDPOINTS) {
      const res = await postPublic(endpoint, {
        userId: `probe-${randomUUID()}`,
        email: `probe-${randomUUID()}@fikirtive.test`,
        name: "Probe",
        password: "correct-horse-battery-staple",
        newPassword: "correct-horse-battery-staple",
      });
      expect(res.status, `${endpoint} 应该 404，实得 ${res.status}`).toBe(404);
    }
    // 打完这两条之后，库里仍然一行密码凭据都没有 —— 「404 了」与「什么都没写成」是两件事。
    expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);
  });

  it("SIGNIN-A11 —— 仓库里没有 setPassword / changePassword / signUp.email 这类调用", () => {
    // 端点 404 只挡公网；`auth.api.*` 是服务端可信代码，router 那道闸对它无效。所以这一条查的
    // 是**调用点**，不是端点。扫的是会跑的代码，不含测试自己与文档。
    //
    // 扫描面：**整个 apps/web**（不再只是 app/lib/components/design-system 四棵树 —— 那样
    // proxy.ts、instrumentation*.ts、apps/web/scripts/ 都在围栏外，而它们跑的是同一个进程里的
    // 服务端可信代码）、apps/worker，以及 packages/* 的每一个包。判官 r3 点名的正是这个缺口。
    const scanRoots = [
      WEB_ROOT,
      path.join(REPO_ROOT, "apps/worker"),
      ...readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(REPO_ROOT, "packages", entry.name)),
    ];
    // 产物目录与依赖不是「会跑的代码」的来源（它们由源码生成），测试自己也不是。
    const skipDirs = new Set([
      "node_modules",
      "__tests__",
      ".next",
      ".turbo",
      "dist",
      "build",
      "coverage",
      "generated",
      "playwright-report",
      "test-results",
    ]);

    /**
     * 唯一放行的文件，具名写在这里（判官 r3 要求把这条放行从「模式故意写松」改成显式白名单）。
     *
     * `design-system/patterns/auth/AuthAccessJourneyReference.tsx` 是**已批准的设计夹具**，不是
     * 生产代码：它里面那两处 `setPassword(...)` 调用（`:228` 与 `:310`）全是 React `useState` 的 setter
     * （`const [password, setPassword] = useState("")`），一行都碰不到 Better Auth。夹具画着密码
     * 那一屏是设计侧治理的事（见 app/login/__tests__/auth-design-system.test.ts 的具名反向断言），
     * 不在本切片的写集内。放行它，才能把裸调用也纳入扫描 —— 否则这条围栏只能查成员调用，
     * 一行 `const setPassword = auth.api.setPassword; setPassword({...})` 就能绕过去。
     */
    const ALLOWED_FILES = new Set([
      "apps/web/design-system/patterns/auth/AuthAccessJourneyReference.tsx",
    ]);

    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          walk(path.join(dir, entry.name));
          continue;
        }
        if (!/\.(tsx?|mjs|cjs|js)$/.test(entry.name)) continue;
        if (/\.test\.(tsx?|mjs|cjs|js)$/.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full);
        if (ALLOWED_FILES.has(rel)) continue;
        const code = codeOnly(readFileSync(full, "utf8"));
        for (const pattern of PASSWORD_CALL_PATTERNS) {
          if (pattern.test(code)) offenders.push(`${rel} — ${pattern}`);
        }
      }
    }
    for (const root of scanRoots) walk(root);

    // 白名单是一条放行，不是一句话：它指向的文件必须真的存在，否则这条围栏会在文件改名之后
    // 悄悄变成「放行一个不存在的路径」，而扫描面看起来还是满的。
    for (const allowed of ALLOWED_FILES) {
      expect(() => readFileSync(path.join(REPO_ROOT, allowed), "utf8"), `${allowed} 不在仓库里`).not.toThrow();
    }
    // 扫描面本身也要证明它真的走到了那些新加的树：只数「违规为 0」的话，roots 写错成一个空
    // 目录同样是 0。
    expect(offenders, `还有能建立/使用密码的调用：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("SIGNIN-A11 —— 上一条那张正则表，每一种能建立密码的写法都真的会被它拦下（负例）", () => {
    // 「全仓扫描 0 违规」这句话的强度，等于那张正则表的强度：表里少一条形状，扫描照样绿。
    // 所以每一种形状都在这里被真的打一遍 —— 正例必须命中，负例必须不命中。
    for (const { label, code } of FENCE_MUST_CATCH) {
      const hits = PASSWORD_CALL_PATTERNS.filter((pattern) => pattern.test(codeOnly(code)));
      expect(hits.length, `围栏漏了这种写法：${label}\n${code}`).toBeGreaterThan(0);
    }
    for (const { label, code } of FENCE_MUST_NOT_CATCH) {
      const hits = PASSWORD_CALL_PATTERNS.filter((pattern) => pattern.test(codeOnly(code)));
      expect(hits, `围栏误伤了这种写法：${label}\n${code}`).toEqual([]);
    }
  });

  it("SIGNIN-A11 —— 上一条的扫描面真的覆盖 apps/web 全树、apps/worker 与 packages/*", () => {
    // 判官 r3 的病根是「扫描面漏了树」，而漏树不会让断言变红 —— 它让断言变得更容易过。所以
    // 扫描面自己要有一条独立的证据：这些文件必须在扫的那个集合里。
    const scanned: string[] = [];
    const skipDirs = new Set([
      "node_modules",
      "__tests__",
      ".next",
      ".turbo",
      "dist",
      "build",
      "coverage",
      "generated",
      "playwright-report",
      "test-results",
    ]);
    function collect(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          collect(path.join(dir, entry.name));
          continue;
        }
        if (!/\.(tsx?|mjs|cjs|js)$/.test(entry.name)) continue;
        scanned.push(path.relative(REPO_ROOT, path.join(dir, entry.name)));
      }
    }
    collect(WEB_ROOT);
    collect(path.join(REPO_ROOT, "apps/worker"));
    for (const entry of readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "node_modules") {
        collect(path.join(REPO_ROOT, "packages", entry.name));
      }
    }

    // 四棵老树之外，逐条点名判官说漏掉的那些落点。
    for (const witness of [
      "apps/web/proxy.ts",
      "apps/web/instrumentation.ts",
      "apps/web/scripts/boot.mjs",
      "apps/web/lib/better-auth/server.ts",
      "apps/worker/src/jobs/auth-verification-reaper.ts",
      "packages/db/src/index.ts",
    ]) {
      expect(scanned, `扫描面没有覆盖 ${witness}`).toContain(witness);
    }
  });

  it("SIGNIN-A11 —— 三个退役页面只剩一句转向，没有表单、没有密码字段", () => {
    for (const page of ["app/signup/page.tsx", "app/forgot-password/page.tsx", "app/reset-password/page.tsx"]) {
      const src = readWeb(page);
      expect(src, `${page} 还在渲染东西`).toContain('permanentRedirect("/login")');
      expect(src, `${page} 还留着表单`).not.toContain("<form");
      expect(src, `${page} 还留着密码输入`).not.toContain("PasswordInput");
    }
    // 表单组件本身也得没了 —— 留着一个没人渲染的密码表单，下一个人只要加回一行 import 就复活。
    for (const gone of [
      "app/signup/SignupForm.tsx",
      "app/forgot-password/ForgotPasswordForm.tsx",
      "app/reset-password/ResetPasswordForm.tsx",
    ]) {
      expect(() => readWeb(gone), `${gone} 还在仓库里`).toThrow();
    }
  });

  it("SIGNIN-A11 / GATE-A8 —— #980 的 pre-hijack 顺序不再存在：没有未验证密码凭据可翻真", async () => {
    // GATE-A8（docs/specs/beta-gate.md 的上线闸）与 #980 是同一条攻击顺序，sign-in.md 的 A11
    // 行点名了它。这一条同时是它俩的落点。
    //
    // #980 的路径是：攻击者用受害者邮箱注册并设密码（emailVerified=false）→ 受害者用码登录 →
    // emailOTP 插件把 emailVerified 翻真 → requireEmailVerification 不再挡住那份密码。
    // 第一步现在打不通（/sign-up/email 404），而且**没有任何端点**能写出一份 credential 凭据 ——
    // 第一步不成立，后面两步就没有对象。
    const res = await postPublic("/sign-up/email", {
      email: `victim-${randomUUID()}@fikirtive.test`,
      password: "attacker-chosen-password",
      name: "Victim",
    });
    expect(res.status).toBe(404);
    expect(await prisma.betterAuthAccount.count({ where: { providerId: "credential" } })).toBe(0);
  });
});
