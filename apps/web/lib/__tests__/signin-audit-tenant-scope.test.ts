/**
 * signin-audit-tenant-scope.test.ts —— FSE-209 登录审计挂当次登录的租户。
 *
 * 走查（`docs/audits/fullstack-staging-2026-09-11/findings-catalog.md` FSE-209，证据
 * `backend-evidence.md` §2.8）：`ActionEvent` 里 `type='auth.signin'` 的 `ownerId` 全库 26/26
 * 写死 `founder`，包括两个新租户自己的登录。行数是对的（SIGNIN-A10「登录审计各恰好一行」），
 * **归属**是错的：按租户查审计，谁都查不到自己那一行。S5 批量裁决 2026-09-12
 * （`docs/specs/sign-in.md` §5）：审计行改挂当次登录的租户；复测＝两个不同租户各登录一次，
 * 各自按自己的 `ownerId` 查得到且只查得到自己那一行，并同时确认 founder 侧读审计的路径。
 *
 * 这两半都在下面，用的是真 Prisma、真本地 `*_test` 库、真的 `convergeIdentity` 与真的
 * `getAdminV2Data`（只有角色闸被换掉 —— 那是 founder 控制台自己的门，不是本条要证的事）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = "";
  process.env.FOUNDER_ADMIN_EMAILS = "";
});

// founder 控制台的角色闸 —— 只换它。`convergeIdentity` 会动态 import 同一个模块去拿
// `bootstrapPersonalOrg`（开户那笔事务），把整份 mock 掉就等于把本条要测的写路一起换走。
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  requireRole: vi.fn(async () => ({
    email: "founder@fikirtive.test",
    roles: ["super-admin"],
    role: "super-admin",
  })),
}));

const { prisma } = await import("@fikirtive/db");
const { FOUNDER_OWNER_ID } = await import("@fikirtive/core");
const { convergeIdentity } = await import("@/lib/better-auth/converge");
const { getAdminV2Data } = await import("@/lib/admin-v2");

const emails: string[] = [];

function freshEmail(tag: string): string {
  const email = `fse209-${tag}-${randomUUID()}@fikirtive.test`;
  emails.push(email);
  return email;
}

/** 一次真登录：better-auth 的 session.create.after 递下来的那个会话 id。 */
async function signIn(email: string): Promise<{ orgId: string }> {
  await convergeIdentity({ email, emailVerified: true, sessionId: `ba_sess_${randomUUID()}` });
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const membership = await prisma.membership.findFirstOrThrow({
    where: { userId: user.id },
    select: { orgId: true },
  });
  return { orgId: membership.orgId };
}

/** 一个租户按**自己的** ownerId 去查登录审计时，读到的东西。 */
async function signinRowsOfTenant(orgId: string) {
  return prisma.actionEvent.findMany({
    where: { ownerId: orgId, type: "auth.signin" },
    select: { id: true, ownerId: true, payload: true },
  });
}

beforeAll(async () => {
  // ActionEvent.ownerId 是指向 Organization 的外键；founder 那一行是迁移里种好的，本地
  // 测试库里先确保它在（下面要断言登录行**不再**落在它名下）。
  await prisma.organization.upsert({
    where: { id: FOUNDER_OWNER_ID },
    update: {},
    create: { id: FOUNDER_OWNER_ID, name: "Fikirtive" },
  });
});

afterAll(async () => {
  for (const email of emails) {
    await prisma.actionEvent.deleteMany({
      where: { type: "auth.signin", payload: { path: ["email"], equals: email } },
    });
  }
});

describe("FSE-209 —— 登录审计挂当次登录的租户", () => {
  it("FSE-209: two tenants sign in once each — each reads exactly one row under their own org, and nothing of the other's", async () => {
    const emailA = freshEmail("a");
    const emailB = freshEmail("b");

    const { orgId: orgA } = await signIn(emailA);
    const { orgId: orgB } = await signIn(emailB);
    expect(orgA).not.toBe(orgB);
    expect(orgA).not.toBe(FOUNDER_OWNER_ID);

    const rowsA = await signinRowsOfTenant(orgA);
    const rowsB = await signinRowsOfTenant(orgB);

    // 各自恰好一行（SIGNIN-A10 的行数口径不变）……
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    // ……而且那一行是自己的那一次登录，不是别人的。
    expect(rowsA[0]!.payload).toEqual({ email: emailA });
    expect(rowsB[0]!.payload).toEqual({ email: emailB });
    expect(JSON.stringify(rowsA)).not.toContain(emailB);
    expect(JSON.stringify(rowsB)).not.toContain(emailA);
  });

  it("FSE-209: a merchant's sign-in no longer lands in the founder org's stream", async () => {
    const email = freshEmail("not-founder");
    await signIn(email);

    const underFounder = await prisma.actionEvent.findMany({
      where: {
        ownerId: FOUNDER_OWNER_ID,
        type: "auth.signin",
        payload: { path: ["email"], equals: email },
      },
      select: { id: true },
    });
    expect(underFounder).toHaveLength(0);
  });

  it("FSE-209: the founder-side audit read still lists both tenants' sign-ins, each under its own org", async () => {
    // 复测口径的后半句：「并同时确认 founder 侧读审计的路径」。那条路读的是**平台流**
    // （`lib/admin-v2.ts`：`where: { ownerId: { not: "" } }`，不按 founder org 过滤），所以
    // 把登录行搬到租户名下之后它仍然读得到 —— 这一条就是钉这件事，别让修 FSE-209 顺手把
    // founder 控制台的登录审计弄丢。
    const emailA = freshEmail("admin-a");
    const emailB = freshEmail("admin-b");
    const { orgId: orgA } = await signIn(emailA);
    const { orgId: orgB } = await signIn(emailB);

    const data = await getAdminV2Data();
    const signins = data.audit.filter((row) => row.type === "auth.signin");
    const rowA = signins.find((row) => row.actor === emailA);
    const rowB = signins.find((row) => row.actor === emailB);

    expect(rowA, "founder 侧读不到 A 的登录行").toBeDefined();
    expect(rowB, "founder 侧读不到 B 的登录行").toBeDefined();
    expect(rowA!.ownerId).toBe(orgA);
    expect(rowB!.ownerId).toBe(orgB);
  });

  it("FSE-209: the founder's own sign-in stays on the founder org — that IS his tenant", async () => {
    const founderEmail = freshEmail("founder");
    process.env.FOUNDER_ADMIN_EMAILS = founderEmail;
    try {
      await convergeIdentity({
        email: founderEmail,
        emailVerified: true,
        sessionId: `ba_sess_${randomUUID()}`,
      });
    } finally {
      process.env.FOUNDER_ADMIN_EMAILS = "";
    }

    const rows = await prisma.actionEvent.findMany({
      where: { type: "auth.signin", payload: { path: ["email"], equals: founderEmail } },
      select: { ownerId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ownerId).toBe(FOUNDER_OWNER_ID);
  });
});
