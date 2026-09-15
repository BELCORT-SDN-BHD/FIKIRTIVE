/**
 * 翻闸前置（#1403）—— 四颗形状雷的复现与根治，外加 TENANT-A3/A4 走**真扣费路径**的复验。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）§1.4 / §1.6 / §2 TENANT-A3、A4
 * 票:   #1403（前置雷更新见该票 2026-09-13 评论：判官核证四条受害路径）
 *
 * 这个文件钉住三件事：
 *
 *  1. **四颗雷是同一颗**。`adjustWindowFilter()`（credits.ts:565）产出
 *     `{ orgId: { in: [orgId] } }`，而守卫的 `scopeWhere` 拿它跟帧里的租户号做**字面等值**比较
 *     （tenant-guard.ts，`where[column] !== ownerId`）。一个 Prisma 过滤器对象永远不等于一个
 *     字符串，所以「我只查我自己这一家」被读成「跨租户」。四条受害路径（后台铸币两个入口、
 *     人工退款、后台租户详情页整页）都是经由这一行进来的，今天各多打一条 warn，翻 enforce 当天
 *     就是四个 500。下面四条测试各自走**那条路自己调用的那个账本函数**，帧的形状与生产一致。
 *
 *  2. **修在守卫，不修在调用点**（家规 §7.3 单一源 / Founder 常令「修根不修表」）。守卫要回答的
 *     问题是「这个 where 有没有可能碰到别家的行」，而不是「这个 where 长不长得像一个字符串」。
 *     所以判定改成：把租户列上的过滤器**归一**成「它点名了哪几个租户」，点不出确定集合就拒。
 *     单元测试同时覆盖 `ownerId` 族（早已 enforce）与 `orgId` 族（观察轮挡位），证明修的是
 *     守卫这一个源，不是钱面这一处。
 *
 *  3. **TENANT-A3/A4 走真扣费路径**（票 #1403 验收 + 判官 P2-2：不用手搓 createMany）。
 *     扣费走 `reserveCredits` / `settleCredits`，退款走 `refundReservation`，充值确认走
 *     `grantCredits` —— 全是生产代码里那几个唯一权威。
 *
 * 本文件**不翻默认挡位**：`setOrgScopedGuardMode` 仍在，默认仍是 warn（翻闸配方写在
 * docs/audits/tenant-guard-warn-baseline-2026-09-14.md 最后一节，待 Founder 定调）。
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "./index.js";
import {
  grantCredits,
  reserveCredits,
  settleCredits,
  refundReservation,
  assertWithinAdjustWindow,
  adjustWindowTotals,
  adjustWindowRows,
} from "./credits.js";
import {
  runAsStaff,
  runAsUser,
  runAsSystem,
  type StaffPrincipal,
  type UserPrincipal,
} from "./principal.js";
import { setOrgScopedGuardMode } from "./tenant-guard.js";
import { seedOrg } from "../test/setup.js";

const ORG_A = "org_1403_a";
const ORG_B = "org_1403_b";

/** 后台操作员的帧：目标租户已知（路径参数 / 请求体里的 orgId 过了 requireRole 之后）。
 *  形状逐字同 `staffPrincipal(gate, orgId)`（apps/web/lib/auth-guard.ts）。 */
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

/** 余额 + 预留 + 流水行数 —— TENANT-A4 的「分毫未变」就是这三个数。 */
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

// ── ① 四颗形状雷（复现 → 根治后全绿） ────────────────────────────────────────────
describe("#1403 四颗形状雷 —— 合法 staff 帧 + 同一个租户，enforce 下必须放行", () => {
  beforeEach(() => setOrgScopedGuardMode("enforce"));

  it("雷① 后台发积分 grantTenantCredits（apps/web/lib/tenant-actions.ts:390 → grantCredits）在自己的 staff 帧里成功落账", async () => {
    await expect(
      runAsStaff(staff(ORG_A), () =>
        grantCredits({
          orgId: ORG_A,
          amount: 500,
          reason: "goodwill",
          source: "ADMIN",
          createdBy: "ops@fikirtive.test",
          idempotencyKey: `grant-tenant:${randomUUID()}`,
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(await moneySnapshot(ORG_A)).toMatchObject({ balance: 1500, ledgerRows: 1 });
  });

  it("雷② 后台铸币 grantCreditsAction（apps/web/lib/credit-actions.ts:43 → grantCredits）在自己的 staff 帧里成功落账", async () => {
    await expect(
      runAsStaff(staff(ORG_B), () =>
        grantCredits({
          orgId: ORG_B,
          amount: 300,
          reason: "admin mint",
          source: "ADMIN",
          createdBy: "ops@fikirtive.test",
          idempotencyKey: `admin-mint:${randomUUID()}`,
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(await moneySnapshot(ORG_B)).toMatchObject({ balance: 2300, ledgerRows: 1 });
  });

  it("雷③ 人工退款 refundCreditsAction（apps/web/lib/refund-actions.ts:497 → assertWithinAdjustWindow）在自己的 staff 帧里过闸", async () => {
    await expect(
      runAsStaff(staff(ORG_A), () =>
        prisma.$transaction((tx) => assertWithinAdjustWindow(tx, ORG_A, 100)),
      ),
    ).resolves.toBeUndefined();
  });

  it("雷④ 后台租户详情页 /admin/tenants/[orgId]（apps/web/lib/tenant-admin.ts:237 → adjustWindowTotals([orgId])）整页不再 500", async () => {
    const totals = await runAsStaff(staff(ORG_A), () => adjustWindowTotals([ORG_A]));
    expect(totals.get(ORG_A)).toBeUndefined(); // 窗口内还没有人工钱行 —— 拿到的是空表，不是异常
  });

  it("雷④b 同一条谓词在扫描域（admin 平台报表，runAsSystem）里照旧可读全 org", async () => {
    await runAsStaff(staff(ORG_A), () =>
      grantCredits({
        orgId: ORG_A,
        amount: 100,
        source: "ADMIN",
        createdBy: "ops@fikirtive.test",
        idempotencyKey: `scan:${randomUUID()}`,
      }),
    );
    const rows = await runAsSystem("admin:platform-read", () => adjustWindowRows(50));
    expect(rows.map((r) => r.orgId)).toEqual([ORG_A]);
  });
});

// ── ② 守卫这一个源的单元判定（两个租户列族一起） ──────────────────────────────
describe("守卫归一化：租户列过滤器点名了哪几个租户（根治点，tenant-guard.ts scopeWhere）", () => {
  beforeEach(() => setOrgScopedGuardMode("enforce"));

  it("单元素 in 数组 = 自己那一家 → 放行（钱表族 orgId）", async () => {
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditAccount.findMany({ where: { orgId: { in: [ORG_A] } }, select: { orgId: true } }),
      ),
    ).resolves.toEqual([{ orgId: ORG_A }]);
  });

  it("in 数组里混进别家 → enforce 当场拒（钱表族 orgId）", async () => {
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditAccount.findMany({ where: { orgId: { in: [ORG_A, ORG_B] } } }),
      ),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
  });

  it("in 数组里混进别家 → warn 挡位只记一条警告、不拦（观察轮语义一个字没变）", async () => {
    setOrgScopedGuardMode("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await runAsUser(merchant(ORG_A), () =>
      prisma.creditAccount.findMany({ where: { orgId: { in: [ORG_A, ORG_B] } }, select: { orgId: true } }),
    );
    expect(rows.map((r) => r.orgId).sort()).toEqual([ORG_A, ORG_B]); // 放行 = 两家都读到了
    expect(warn.mock.calls.flat().join(" ")).toMatch(/CreditAccount\.findMany.*outside the active tenant/);
  });

  it("空 in 数组 → 拒。它点名了**零**个租户，而守卫下一步会把租户号写回 where —— 那会把「一行都不匹配」悄悄变成「我这一家全部」", async () => {
    await expect(
      runAsUser(merchant(ORG_A), () => prisma.creditAccount.findMany({ where: { orgId: { in: [] } } })),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
  });

  it("equals 等值形状：自己那一家放行、别家拒", async () => {
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditAccount.findMany({ where: { orgId: { equals: ORG_A } }, select: { orgId: true } }),
      ),
    ).resolves.toEqual([{ orgId: ORG_A }]);
    await expect(
      runAsUser(merchant(ORG_A), () => prisma.creditAccount.findMany({ where: { orgId: { equals: ORG_B } } })),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
  });

  it("没被放宽的形状仍然拒：in ＋ 第二个键、notIn、startsWith、not", async () => {
    const cases: Record<string, unknown>[] = [
      { orgId: { in: [ORG_A], not: ORG_B } },
      { orgId: { notIn: [ORG_B] } },
      { orgId: { startsWith: ORG_A } },
      { orgId: { not: "" } },
    ];
    for (const where of cases) {
      await expect(
        runAsUser(merchant(ORG_A), () => prisma.creditAccount.findMany({ where: where as never })),
      ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
    }
  });

  it("关系过滤器与布尔组合器不被顺手放宽（它们不叫租户列，判定一个字没碰）", async () => {
    // AND 里写自己那一家：顶层没有 orgId 键 → 守卫照旧注入自己的租户号，行为与本片之前逐字相同。
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditAccount.findMany({ where: { AND: [{ orgId: ORG_A }] }, select: { orgId: true } }),
      ),
    ).resolves.toEqual([{ orgId: ORG_A }]);
    // 写别家：AND 里的那一条不是守卫判的那一列，但注入之后两条相与 ⇒ 读不到 B 的任何一行。
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.creditAccount.findMany({ where: { AND: [{ orgId: ORG_B }] }, select: { orgId: true } }),
      ),
    ).resolves.toEqual([]);
  });

  it("根治落在守卫这一个源：`ownerId` 族（早已 enforce，与钱面同一段代码）同样认单元素 in、同样拒混家", async () => {
    await runAsUser(merchant(ORG_A), () =>
      prisma.project.create({ data: { id: randomUUID(), ownerId: ORG_A, name: "p" } }),
    );
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.project.findMany({ where: { ownerId: { in: [ORG_A] } }, select: { ownerId: true } }),
      ),
    ).resolves.toEqual([{ ownerId: ORG_A }]);
    await expect(
      runAsUser(merchant(ORG_A), () => prisma.project.findMany({ where: { ownerId: { in: [ORG_A, ORG_B] } } })),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
  });

  it("无帧兜底（严格档，钱表族）：单元素 in 认，两家的 in 不认，空 in 不认", async () => {
    await expect(
      prisma.creditAccount.findMany({ where: { orgId: { in: [ORG_A] } }, select: { orgId: true } }),
    ).resolves.toEqual([{ orgId: ORG_A }]);
    await expect(
      prisma.creditAccount.findMany({ where: { orgId: { in: [ORG_A, ORG_B] } } }),
    ).rejects.toThrow(/tenant-guard.*no orgId filter/);
    await expect(prisma.creditAccount.findMany({ where: { orgId: { in: [] } } })).rejects.toThrow(
      /tenant-guard.*no orgId filter/,
    );
  });
});

// ── ③ TENANT-A3：无帧即拒 + 伪造过滤器不过关（真钱路径） ──────────────────────
describe("TENANT-A3（真钱路径）—— 无帧即拒，伪造过滤器不再过关", () => {
  beforeEach(() => setOrgScopedGuardMode("enforce"));

  it("TENANT-A3 无帧调用一个真钱动作（adjustWindowRows —— admin 人工钱报表的读取权威）被拒", async () => {
    await expect(adjustWindowRows(50)).rejects.toThrow(/tenant-guard.*no orgId filter/);
  });

  it("TENANT-A3 喂一个 `{ orgId: { not: \"\" } }` 形状的伪造过滤器（钱表族）被拒", async () => {
    await expect(prisma.creditLedger.findMany({ where: { orgId: { not: "" } } })).rejects.toThrow(
      /tenant-guard.*no orgId filter/,
    );
    await expect(prisma.creditAccount.updateMany({ where: { orgId: { not: "" } }, data: { balance: 0 } })).rejects.toThrow(
      /tenant-guard.*no orgId filter/,
    );
  });

  it("TENANT-A3 `{ ownerId: { not: \"\" } }` 在商家面（宽松档）仍然放行 —— 这是 125 个未建帧老站点活着的那条兜底，本片不动它", async () => {
    await expect(prisma.project.findMany({ where: { ownerId: { not: "" } } })).resolves.toEqual([]);
  });
});

// ── ④ TENANT-A4：钱守恒，全程走真扣费路径 ───────────────────────────────────
describe("TENANT-A4（真扣费路径 reserve/settle/refund/grant）—— 跨租户三次全败、钱分毫未变；同租户恰好一笔、重放不重复", () => {
  beforeEach(() => setOrgScopedGuardMode("enforce"));

  it("TENANT-A4 跨租户伪造一次充值确认（grantCredits 落 B 家）失败，两边余额与流水行数分毫未变", async () => {
    const before = { a: await moneySnapshot(ORG_A), b: await moneySnapshot(ORG_B) };
    await expect(
      runAsUser(merchant(ORG_A), () =>
        grantCredits({
          orgId: ORG_B,
          amount: 500,
          source: "PURCHASE",
          createdBy: "forged",
          idempotencyKey: `forged-topup:${randomUUID()}`,
        }),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_A)).toEqual(before.a);
    expect(await moneySnapshot(ORG_B)).toEqual(before.b);
  });

  it("TENANT-A4 跨租户伪造一次扣费（真 reserveCredits 落 B 家）失败，两边余额与流水行数分毫未变", async () => {
    const before = { a: await moneySnapshot(ORG_A), b: await moneySnapshot(ORG_B) };
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG_B, refId: `forged:${randomUUID()}`, cost: 200 })),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_A)).toEqual(before.a);
    expect(await moneySnapshot(ORG_B)).toEqual(before.b);
  });

  it("TENANT-A4 跨租户伪造一次退款（真 refundReservation 落 B 家）失败，两边余额与流水行数分毫未变", async () => {
    const refId = `gen:${randomUUID()}`;
    await runAsUser(merchant(ORG_B), () =>
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG_B, refId, cost: 300 })),
    );
    const before = { a: await moneySnapshot(ORG_A), b: await moneySnapshot(ORG_B) };
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG_B, refId })),
      ),
    ).rejects.toThrow(/tenant-guard/);
    expect(await moneySnapshot(ORG_A)).toEqual(before.a);
    expect(await moneySnapshot(ORG_B)).toEqual(before.b);
  });

  it("TENANT-A4 同租户正常扣费（真 reserve → settle）恰好一笔；重放同一幂等键不产生第二笔", async () => {
    const refId = `gen:${randomUUID()}`;
    const charge = () =>
      runAsUser(merchant(ORG_A), () =>
        prisma.$transaction(async (tx) => {
          await reserveCredits(tx, { orgId: ORG_A, refId, cost: 100 });
        }),
      );
    const finalize = () =>
      runAsUser(merchant(ORG_A), () =>
        prisma.$transaction(async (tx) => {
          await settleCredits(tx, { orgId: ORG_A, refId });
        }),
      );
    await charge();
    await finalize();
    expect(await moneySnapshot(ORG_A)).toEqual({ balance: 900, reserved: 0, ledgerRows: 2 });

    // 重放：同一把 `settle:<refId>` 幂等键 —— 唯一键吃掉,账本与余额一个字不动。
    await finalize();
    expect(await moneySnapshot(ORG_A)).toEqual({ balance: 900, reserved: 0, ledgerRows: 2 });

    // 重放预扣：同一把 `reserve:<refId>` 幂等键 —— 撞唯一键,整笔事务回滚,不会扣第二次。
    await expect(charge()).rejects.toThrow();
    expect(await moneySnapshot(ORG_A)).toEqual({ balance: 900, reserved: 0, ledgerRows: 2 });
  });
});
