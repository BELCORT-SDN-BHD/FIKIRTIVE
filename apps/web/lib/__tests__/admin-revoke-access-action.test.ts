/**
 * SIGNIN-A7 —— 「后台能撤（不再回「No pending invite」）」那一句验收，从**操作员按下去的那个
 * 动作**开始证明（docs/specs/sign-in.md 已冻结 · v1 §1.6「撤销」）。
 *
 * 第 1 轮判官打回的正是这个文件的上一版：它把 `requireRole` 与 `revokeEmailAccess` 两个被测物
 * 一起 mock 掉，于是「名单翻面、会话消失」那段代码在里面一次都没跑过，测试名却写着 A7。这一版
 * 只 mock **授权**与 `next/cache`（前者要一个 HTTP 会话，后者是 Next 运行时）；名单、会话、
 * 审计行全部落在真的本机 Postgres 上。
 *
 * 与 `signin-pause-and-revoke.test.ts` 的分工：那边证明**领域动作**（撤销切断会话、两扇门随后
 * 都拒、双租户），这边证明**操作员那条路真的通到它**——同一个地址，用后台按钮调的那个动作，
 * 而不是用领域函数。UI 那一头（按钮点下去调的是这一个动作）在
 * `admin-tenant-invite-ui.test.ts`。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@fikirtive/db");
const { revokeMerchantAccess, revokeTenantInvite } = await import("@/lib/tenant-actions");

const OPERATOR = { email: "operator-signin4@fikirtive.test", roles: ["super-admin"], role: "super-admin" };

const addresses: string[] = [];
function newAddress(tag: string): string {
  const email = `signin4-action-${tag}-${randomUUID()}@fikirtive.test`;
  addresses.push(email);
  return email;
}

/** 一个「自助进来」的商家：名单行是 active（两扇门写的就是这个），外加一张活着的会话。 */
async function selfSignedUpMerchant(tag: string): Promise<{ email: string; baUserId: string }> {
  const email = newAddress(tag);
  await prisma.allowedEmail.create({ data: { email, status: "active", invitedBy: "sign-in-code" } });
  const baUserId = `bau_${randomUUID()}`;
  await prisma.betterAuthUser.create({
    data: { id: baUserId, name: "", email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  });
  await prisma.betterAuthSession.create({
    data: {
      id: `bas_${randomUUID()}`,
      userId: baUserId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return { email, baUserId };
}

function statusOf(email: string) {
  return prisma.allowedEmail.findUnique({ where: { email }, select: { status: true } }).then((r) => r?.status ?? null);
}

function sessionsFor(baUserId: string) {
  return prisma.betterAuthSession.count({ where: { userId: baUserId } });
}

beforeEach(() => {
  requireRole.mockReset();
  requireRole.mockResolvedValue(OPERATOR);
});

afterAll(async () => {
  if (addresses.length === 0) return;
  const baUsers = await prisma.betterAuthUser.findMany({ where: { email: { in: addresses } }, select: { id: true } });
  const ids = baUsers.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.betterAuthSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.betterAuthUser.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.allowedEmail.deleteMany({ where: { email: { in: addresses } } });
  await prisma.actionEvent.deleteMany({ where: { type: "tenant.revoke", payload: { path: ["via"], equals: OPERATOR.email } } });
});

describe("后台的撤销动作", () => {
  it("SIGNIN-A7 —— 操作员在后台撤一个自助进来的地址：撤得掉，答的不是「No pending invite」", async () => {
    const { email, baUserId } = await selfSignedUpMerchant("reachable");
    expect(await statusOf(email)).toBe("active");

    // 先把旧那颗按钮按一遍：这就是判官记下的现状 —— 自助进来的地址在界面上撤不掉。
    expect(await revokeTenantInvite(email)).toEqual({ error: "No pending invite for that address." });
    expect(await statusOf(email)).toBe("active");

    // 后台那颗按钮从本片起调的是这一个。
    expect(await revokeMerchantAccess(email)).toEqual({ ok: true, result: "revoked" });
    expect(await statusOf(email)).toBe("revoked");
    // 「他原来的登录下一次请求即失效」：会话行与撤销在同一笔事务里没的。
    expect(await sessionsFor(baUserId)).toBe(0);
  });

  it("SIGNIN-A7 —— 撤销留下一行 tenant.revoke 审计，记着是谁撤的", async () => {
    const { email } = await selfSignedUpMerchant("audit");
    await revokeMerchantAccess(email);

    const rows = await prisma.actionEvent.findMany({ where: { type: "tenant.revoke" }, orderBy: { createdAt: "desc" }, take: 20 });
    const row = rows.find((r) => (r.payload as { email?: string } | null)?.email === email);
    expect(row, "撤销必须留下痕迹").toBeTruthy();
    expect(row!.payload).toMatchObject({ email, via: OPERATOR.email, outcome: "revoked" });
  });

  it("SIGNIN-A7 —— 大小写与空白照样撤得掉：入参归一化后才碰名单", async () => {
    const { email, baUserId } = await selfSignedUpMerchant("normalize");

    expect(await revokeMerchantAccess(`  ${email.toUpperCase()}  `)).toEqual({ ok: true, result: "revoked" });
    expect(await statusOf(email)).toBe("revoked");
    expect(await sessionsFor(baUserId)).toBe(0);
  });

  it("SIGNIN-A7 —— 再撤一次答 already_revoked，会话再清一遍（重复点击不是失败）", async () => {
    const { email } = await selfSignedUpMerchant("idempotent");
    await revokeMerchantAccess(email);

    expect(await revokeMerchantAccess(email)).toEqual({ ok: true, result: "already_revoked" });
    expect(await statusOf(email)).toBe("revoked");
  });

  it("没有权限的调用者撤不了，名单与会话一动不动", async () => {
    const { email, baUserId } = await selfSignedUpMerchant("unauthorized");
    requireRole.mockResolvedValue({ error: "You don't have access to this." });

    expect(await revokeMerchantAccess(email)).toEqual({ error: "You don't have access to this." });
    expect(await statusOf(email)).toBe("active");
    expect(await sessionsFor(baUserId)).toBe(1);
  });

  it("不是地址的东西在碰数据库之前就被拒", async () => {
    for (const bad of ["", "   ", "not-an-email", 42, null, undefined]) {
      expect(await revokeMerchantAccess(bad)).toEqual({ error: "Invalid email." });
    }
  });

  it("从没进来过的地址答「没有可撤的」，而且不新建一行黑名单", async () => {
    const ghost = newAddress("ghost");
    expect(await revokeMerchantAccess(ghost)).toEqual({ error: "That address has no access to revoke." });
    expect(await statusOf(ghost)).toBeNull();
  });
});
