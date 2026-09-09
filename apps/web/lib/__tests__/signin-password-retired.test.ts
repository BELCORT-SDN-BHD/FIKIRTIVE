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
    for (const endpoint of RETIRED_PASSWORD_ENDPOINTS) {
      expect(server, `CLOSED_PASSWORD_PATHS 少了 ${endpoint}`).toContain(`"${endpoint}"`);
    }
  });

  it("SIGNIN-A11 —— 仓库里没有 setPassword / changePassword / signUp.email 这类调用", () => {
    // 端点 404 只挡公网；`auth.api.*` 是服务端可信代码，router 那道闸对它无效。所以这一条查的
    // 是**调用点**，不是端点。扫的是会跑的代码，不含测试自己与文档。
    const roots = ["app", "lib", "components", "design-system"];
    const skipDirs = new Set(["node_modules", "__tests__", ".next"]);
    const offenders: string[] = [];
    // 一律要求**成员调用**（`x.setPassword(...)`），因为能建立密码的只有 Better Auth 的
    // client / server API，而它们全是成员调用。裸的 `setPassword(...)` 故意不查：那几乎总是
    // React 的 `useState` setter（已批准的 Auth 设计夹具里就有一个），把它算成违规，围栏就会
    // 被人当噪音关掉，那才是真正的失守。
    const callPatterns = [
      /\.\s*setPassword\s*\(/,
      /\.\s*changePassword\s*\(/,
      /\.\s*resetPassword\s*\(/,
      /\.\s*requestPasswordReset\s*\(/,
      /\.\s*forgetPassword\s*\(/,
      /\bsignUp\s*\.\s*email\s*\(/,
      /\bsignIn\s*\.\s*email\s*\(/,
    ];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          walk(path.join(dir, entry.name));
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
        const full = path.join(dir, entry.name);
        const src = readFileSync(full, "utf8");
        // 注释里提一句「密码曾经在这里」是允许的，能建立密码的只有真的调用。
        const code = src
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("//"))
          .join("\n");
        for (const pattern of callPatterns) {
          if (pattern.test(code)) offenders.push(`${path.relative(WEB_ROOT, full)} — ${pattern}`);
        }
      }
    }
    for (const root of roots) walk(path.join(WEB_ROOT, root));

    expect(offenders, `还有能建立/使用密码的调用：\n${offenders.join("\n")}`).toEqual([]);
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
