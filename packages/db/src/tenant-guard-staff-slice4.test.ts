/**
 * 租户围栏切片④（后台 staff 帧，#479 并案裁定）—— 守卫这一半的行为测试。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）§1.6 / §2 TENANT-A6
 * 票:   #1379
 *
 * 这个文件钉住三件事，全部是**行为**，不是形状（同 `tenant-guard-money-slice1.test.ts` 的手法，
 * 换成 `kind:"staff"` 这个第三类帧）：
 *  1. 判定按结构不按名字（§1.6）：一个 `staff` 帧的结构规则和 `kind:"system"` 一模一样 ——
 *     `ownerId===null` 是扫描域（可读、不许写任何一张受守卫的表），`ownerId` 点了名就和
 *     user/tenant 帧一样值比对。
 *  2. **权限不因建帧放宽**：这个文件从不测 `requireRole` 本身（那是 auth-guard 的判定，
 *     不是守卫的判定）——它测的是「就算帧建对了，结构规则仍然只放行帧点名的那家店」。
 *  3. 双身份：staff 帧点名 A 家、商家（user）帧点名 A 家，两边各自动 A 家都放行、各自动 B 家都
 *     被拒 —— 帧的 KIND 不改变守卫认的是哪个 `ownerId`，这正是「staff 帧不是新权限，只是诚实
 *     身份」的结构证明。
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "./index.js";
import { runAsStaff, runAsUser, runAsSystem, type StaffPrincipal, type UserPrincipal } from "./principal.js";
import { getOrgScopedGuardMode, setOrgScopedGuardMode } from "./tenant-guard.js";
import { seedOrg } from "../test/setup.js";

const ORG_A = "org_slice4_a";
const ORG_B = "org_slice4_b";

function staff(ownerId: string | null): StaffPrincipal {
  return { kind: "staff", actorEmail: "ops@fikirtive.test", ownerId };
}

function merchant(orgId: string): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_${orgId}`,
    subjectEmail: `${orgId}@example.com`,
    ownerId: orgId,
    orgRole: "owner",
    membershipId: `mem_${orgId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}

function ledgerRow(orgId: string, kind: "GRANT" | "SETTLE", balanceDelta: number, idempotencyKey: string) {
  return { id: randomUUID(), orgId, balanceDelta, reservedDelta: 0, kind, idempotencyKey } as const;
}

async function moneySnapshot(orgId: string) {
  const [account, ledgerRows] = await runAsSystem("test-seed", async () => [
    await prisma.creditAccount.findUnique({ where: { orgId }, select: { balance: true, reserved: true } }),
    await prisma.creditLedger.count({ where: { orgId } }),
  ]);
  return { balance: account?.balance ?? null, reserved: account?.reserved ?? null, ledgerRows };
}

beforeEach(async () => {
  await seedOrg(ORG_A, 1000);
  await seedOrg(ORG_B, 2000);
});

afterEach(() => {
  setOrgScopedGuardMode("warn");
  vi.restoreAllMocks();
});

describe("TENANT-A6 staff 帧 × enforce 挡位 —— 点了名的那家店才放行，权限不因建帧放宽", () => {
  beforeEach(() => setOrgScopedGuardMode("enforce"));

  it("staff 帧点名 A 家，正常发一笔积分（CreditLedger.create）放行", async () => {
    await expect(
      runAsStaff(staff(ORG_A), () =>
        prisma.creditLedger.create({ data: ledgerRow(ORG_A, "GRANT", 500, "staff:grant:a") }),
      ),
    ).resolves.toMatchObject({ orgId: ORG_A });
    expect((await moneySnapshot(ORG_A)).ledgerRows).toBe(1);
  });

  it("staff 帧点名 A 家，伪造一次 B 家的发放（CreditLedger.create）被拒，两边钱一分没动", async () => {
    const before = { a: await moneySnapshot(ORG_A), b: await moneySnapshot(ORG_B) };
    await expect(
      runAsStaff(staff(ORG_A), () =>
        prisma.creditLedger.create({ data: ledgerRow(ORG_B, "GRANT", 500, "staff:forged:b") }),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_A)).toEqual(before.a);
    expect(await moneySnapshot(ORG_B)).toEqual(before.b);
  });

  it("staff 帧点名 A 家，读 B 家的账（CreditAccount.findUnique）被拒 —— 读也按结构值比对", async () => {
    await expect(
      runAsStaff(staff(ORG_A), () => prisma.creditAccount.findUnique({ where: { orgId: ORG_B } })),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("staff 帧 ownerId=null（平台面，没有单一目标租户）可以跨租户扫描读", async () => {
    const rows = await runAsStaff(staff(null), () => prisma.creditAccount.findMany({ select: { orgId: true } }));
    expect(rows.map((r) => r.orgId).sort()).toEqual([ORG_A, ORG_B]);
  });

  it(
    "staff 帧 ownerId=null 不许直接写任何一张受守卫的表（结构同 kind:\"system\" 的扫描域，" +
      "§1.6「判定按结构不按名字」——这正是「staff 绝不能写什么」的守卫半句答案）",
    async () => {
      await expect(
        runAsStaff(staff(null), () =>
          prisma.creditLedger.create({ data: ledgerRow(ORG_A, "GRANT", 100, "staff:platform-write") }),
        ),
      ).rejects.toThrow(/requires runAsTenant before system writes/);
    },
  );

  it("同一个 ownerId 下，staff 帧与 user（商家）帧都放行；两者对彼此的租户都被拒（双身份）", async () => {
    // staff 帧点名 A：放行
    await expect(
      runAsStaff(staff(ORG_A), () =>
        prisma.creditLedger.create({ data: ledgerRow(ORG_A, "GRANT", 10, "dual:staff:a") }),
      ),
    ).resolves.toMatchObject({ orgId: ORG_A });
    // 商家（user）帧点名 A：放行 —— 与上面那条是同一条结构规则,不是因为 staff 更宽松
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditLedger.create({ data: ledgerRow(ORG_A, "SETTLE", -5, "dual:user:a") }),
      ),
    ).resolves.toMatchObject({ orgId: ORG_A });
    // staff 帧点名 A，却想动 B：拒
    await expect(
      runAsStaff(staff(ORG_A), () => prisma.creditAccount.update({ where: { orgId: ORG_B }, data: { balance: 1 } })),
    ).rejects.toThrow(/tenant-guard/);
    // 商家（user）帧点名 A，却想动 B：同样拒 —— 同一条闸,同一个答案
    await expect(
      runAsUser(merchant(ORG_A), () => prisma.creditAccount.update({ where: { orgId: ORG_B }, data: { balance: 1 } })),
    ).rejects.toThrow(/tenant-guard/);
    expect((await moneySnapshot(ORG_B)).balance).toBe(2000); // B 家一分没动
  });
});

describe("迁移期挡位 —— staff 帧同样走 warn 观察轮（规格 §1.3 第四态；挡位不动）", () => {
  it("默认就是 warn：挡位不翻，staff 帧的落闸不生效", () => {
    expect(getOrgScopedGuardMode()).toBe("warn");
  });

  it("warn 挡位下 staff 帧伪造跨租户写不被拦，但留下一条警告", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runAsStaff(staff(ORG_A), () =>
      prisma.creditLedger.create({ data: ledgerRow(ORG_B, "GRANT", 500, "staff:warn:observed") }),
    );
    expect((await moneySnapshot(ORG_B)).ledgerRows).toBe(1);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/CreditLedger\.create/);
  });
});
