/**
 * 租户围栏切片①（钱面）—— 守卫这一半的行为测试。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）
 * 票:   #1376
 *
 * 这个文件钉住三件事，全部是**行为**，不是形状：
 *  1. 钱表族（CreditAccount / CreditLedger / Membership）真的进了运行时守卫，
 *     而且守的是它们自己的租户列 `orgId` —— 守卫过去只认字面 `ownerId`，把 orgId 族登记成
 *     「明示豁免」，也就是零检查（见 tenant-guard.ts 的 ORG_SCOPED_TENANT_MODELS 注释）。
 *  2. 迁移期挡位**已经不存在**（#1403 翻闸 + 收开关，TENANT-A10）：钱面与 `ownerId` 族走同一段
 *     判定，没有第二条路、也没有可以在生产扳回去的开关。原来那一组「warn 挡位记警告、不拦」
 *     的用例随挡位一起退役，换成下面这一组「开关真的没了」。
 *  3. enforce 挡位下，跨租户的钱动作当场失败且**钱守恒**：两边余额与流水行数分毫未变。
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "./index.js";
import { runAsUser, runAsSystem, type UserPrincipal } from "./principal.js";
import * as tenantGuard from "./tenant-guard.js";
import { seedOrg } from "../test/setup.js";

const ORG_A = "org_slice1_a";
const ORG_B = "org_slice1_b";

/** 一行账本。`id` 与幂等键都由测试给，重放用的就是同一把键。 */
function ledgerRow(orgId: string, kind: "GRANT" | "SETTLE", balanceDelta: number, idempotencyKey: string) {
  return { id: randomUUID(), orgId, balanceDelta, reservedDelta: 0, kind, idempotencyKey } as const;
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

/** 余额 + 流水行数 —— TENANT-A4 的「分毫未变」就是这两个数。 */
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
  vi.restoreAllMocks();
});

describe("TENANT-A4 钱守恒 —— 跨租户的钱动作当场失败，两边余额与流水行数分毫未变", () => {

  it("TENANT-A4 A 商家的帧里伪造一次 B 的充值（CreditLedger.create）失败，两边钱一分没动", async () => {
    const before = { a: await moneySnapshot(ORG_A), b: await moneySnapshot(ORG_B) };
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditLedger.create({
          data: ledgerRow(ORG_B, "GRANT", 500, "forged:topup"),
        }),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_A)).toEqual(before.a);
    expect(await moneySnapshot(ORG_B)).toEqual(before.b);
  });

  it("TENANT-A4 A 商家的帧里伪造一次 B 的扣费（CreditAccount.update）失败，两边余额未变", async () => {
    const before = { a: await moneySnapshot(ORG_A), b: await moneySnapshot(ORG_B) };
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditAccount.update({ where: { orgId: ORG_B }, data: { balance: 1 } }),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_A)).toEqual(before.a);
    expect(await moneySnapshot(ORG_B)).toEqual(before.b);
  });

  it("TENANT-A4 A 商家的帧里伪造一次 B 的退款（CreditLedger.updateMany）改不到 B 的任何一行", async () => {
    await runAsUser(merchant(ORG_B), () =>
      prisma.creditLedger.create({
        data: ledgerRow(ORG_B, "SETTLE", -100, "settle:b:1"),
      }),
    );
    const before = await moneySnapshot(ORG_B);
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditLedger.updateMany({ where: { orgId: ORG_B }, data: { balanceDelta: 0 } }),
      ),
    ).rejects.toThrow(/tenant-guard/);
    const rows = await runAsSystem("test-seed", () =>
      prisma.creditLedger.findMany({ where: { orgId: ORG_B }, select: { balanceDelta: true } }),
    );
    expect(rows.map((r) => r.balanceDelta)).toEqual([-100]);
    expect(await moneySnapshot(ORG_B)).toEqual(before);
  });

  it("TENANT-A4 同租户正常扣费恰好一笔，重放同一幂等键不产生第二笔", async () => {
    const write = () =>
      runAsUser(merchant(ORG_A), () =>
        prisma.creditLedger.createMany({
          data: [ledgerRow(ORG_A, "SETTLE", -30, "settle:a:replay")],
          skipDuplicates: true,
        }),
      );
    await write();
    await write();
    expect((await moneySnapshot(ORG_A)).ledgerRows).toBe(1);
  });

  it("TENANT-A4 A 商家读自己的钱照旧放行（落闸不许伤到正常路径）", async () => {
    const account = await runAsUser(merchant(ORG_A), () =>
      prisma.creditAccount.findUnique({ where: { orgId: ORG_A }, select: { balance: true } }),
    );
    expect(account?.balance).toBe(1000);
  });
});

describe("TENANT-A3 无帧即拒 + 伪造过滤器不再过关（钱面）", () => {

  it("TENANT-A3 钱表的无帧调用被拒", async () => {
    await expect(prisma.creditLedger.findMany({ where: { kind: "SETTLE" } })).rejects.toThrow(
      /tenant-guard/,
    );
  });

  it("TENANT-A3 `{ orgId: { not: \"\" } }` 形状的伪造过滤器被拒", async () => {
    await expect(
      prisma.creditLedger.findMany({ where: { orgId: { not: "" } } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  // **现状登记，不是验收通过**（#1403）：A3 原文是「无帧即拒」，而这一条放行。兜底本片刻意
  // 不收，理由与实测清单写在
  // docs/audits/fullstack-staging-2026-09-14/local-logs/tenant-warn-baseline-2026-09-19.md §6：
  // 生产侧还有五处**结构性无帧**（resolveUserPrincipal 与四个 CRM 网关 —— 造帧那一步自己要先读
  // 一次 membership），测试侧 122 个文件靠它活着。收兜底是独立的一票，不压进翻闸这一次提交。
  it("TENANT-A3（未收口的那一半·现状登记）无帧但写明自己租户号的老调用点仍然放行", async () => {
    await expect(
      prisma.creditAccount.findUnique({ where: { orgId: ORG_A } }),
    ).resolves.toBeTruthy();
  });

  it("TENANT-A3 跨租户扫描域（system 帧 + ownerId===null）照旧可读钱账", async () => {
    const rows = await runAsSystem("ledger-conservation", () =>
      prisma.creditAccount.findMany({ select: { orgId: true } }),
    );
    expect(rows.map((r) => r.orgId).sort()).toEqual([ORG_A, ORG_B]);
  });
});

describe("迁移期挡位已经收掉（#1403 翻闸，TENANT-A10：能在生产关掉租户隔离的开关本身就是审计发现）", () => {
  it("守卫不再导出任何挡位出口：没有 setter，也没有 getter", () => {
    expect(Object.keys(tenantGuard)).not.toContain("setOrgScopedGuardMode");
    expect(Object.keys(tenantGuard)).not.toContain("getOrgScopedGuardMode");
  });

  it("钱面默认就在执法：不扳任何东西，跨租户写当场被拒、钱一分没动", async () => {
    const before = await moneySnapshot(ORG_B);
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditLedger.create({ data: ledgerRow(ORG_B, "GRANT", 500, "no-gear:refused") }),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_B)).toEqual(before);
  });

  it("`ownerId` 族照旧当场拒（两族同一段判定，收挡位没有回退既有围栏）", async () => {
    await expect(prisma.project.findMany({ where: { name: "x" } })).rejects.toThrow(/tenant-guard/);
  });
});

// S5 现场走查（人工）：钱面完整旅程 充值 → 扣费 → 退款，零 500、与落闸前同结果。
it.todo("TENANT-A5 钱面完整商家旅程（充值→扣费→退款）由 S5 现场走查判定");
