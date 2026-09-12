/**
 * 租户围栏切片④（后台 staff 帧，#479 并案裁定）—— TENANT-A6 行为测试：真实数据库、真实守卫、
 * 真实动作函数（同 `tenant-action-cross-tenant-slice2.test.ts` 的手法，换成后台面）。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）；票 #1379。
 *
 * TENANT-A6：后台员工发一次积分、退一次款、跑一次对账 —— 三次都在 staff 帧内发生，审计行的
 * 操作者与目标租户由帧带出；跨租户铸币仍要求 requireRole("tenants","mutate") 才放行。
 *
 * 手法：不 mock `@fikirtive/db` —— 真实 Prisma、真实 tenant-guard。只 mock `@/lib/auth-guard`
 * 的 `requireRole`（按测试切换操作员/放行与拒绝），`staffPrincipal` 用 `importOriginal` 保留
 * 真实实现（它本身就是零副作用的纯映射，这份测试要钉的正是「真实 staffPrincipal 建出来的帧
 * 长什么样」，用一个 stub 反而测不到这件事）。
 *
 * 用 `vi.spyOn` 包一层已建帧的真实 Prisma 方法，在真正的查询发生那一刻读 `getPrincipal()`，
 * 证明 TENANT-A6「操作者与目标租户由帧带出」——不是伪造帧，真正的查询原样转发给保存下来的
 * 原始实现，行为不变（同 slice②「TENANT-A1 补充证明」的手法）。
 *
 * 退一次款：只钉「进了 staff 帧」这一半（`abandonManualRefund` 在「没有开着的 hold」这一支，
 * 只读账本、不碰 Stripe，是退款入口里最轻的一条真实路径）——退款的业务逻辑（预扣/成对/漂移…）
 * 已经由 `refund-actions.test.ts` 详尽覆盖，这里不重做。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOUNDER_OWNER_ID, RECONCILE_OBSERVED_TYPE, reconcileObservationId, reconcileClosureId } from "@fikirtive/core";

const mockRequireRole = vi.fn();

vi.mock("@/lib/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guard")>();
  return { ...actual, requireRole: mockRequireRole };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@fikirtive/db");
const { runAsSystem, getPrincipal } = await import("@fikirtive/db/principal");
const { grantTenantCredits } = await import("@/lib/tenant-actions");
const { grantCreditsAction } = await import("@/lib/credit-actions");
const { closeReconcileObservation } = await import("@/lib/reconcile-actions");
const { abandonManualRefund } = await import("@/lib/refund-actions");

const ORG_A = "org_staff_slice4_a";
const ORG_B = "org_staff_slice4_b";
const STAFF_GATE = { email: "ops@fikirtive.test", roles: ["super-admin"], role: "super-admin" } as const;

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}

beforeEach(async () => {
  mockRequireRole.mockReset();
  // 两家都是活的商家 org（`activeMerchantOrg` 只看 Organization.deletedAt）；warn 挡位下
  // 直接建行不需要任何帧（钱表族的执法挡位本片不动，见票面「挡位不动」）。
  await runAsSystem("test-seed", () =>
    prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }], skipDuplicates: true }),
  );
  await prisma.creditAccount.createMany({
    data: [
      { orgId: ORG_A, balance: 1000, reserved: 0 },
      { orgId: ORG_B, balance: 1000, reserved: 0 },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await prisma.creditLedger.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.creditAccount.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.actionEvent.deleteMany({ where: { ownerId: { in: [ORG_A, ORG_B, FOUNDER_OWNER_ID] } } });
  await runAsSystem("test-seed", () => prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } }));
});

describe('TENANT-A6 staff 帧 —— 后台员工发积分／对账两次都在 staff 帧内发生，操作者与目标租户由帧带出', () => {
  it("TENANT-A6 发积分：grantTenantCredits 落账那一刻，帧是完整的 kind:\"staff\" 帧，actorEmail=操作员邮箱、ownerId=目标租户", async () => {
    mockRequireRole.mockResolvedValueOnce({ ...STAFF_GATE });
    const idempotencyKey = id("staff-a6-grant");

    // `grantCredits`（@fikirtive/db）写账本那一句在 `prisma.$transaction` 的 `tx` 上，不是
    // 顶层 `prisma.creditLedger` 委托对象本身——spy 在顶层拦不到事务内部那一句。落账之后的
    // `prisma.actionEvent.create`（tenant-actions.ts:416-417）是顶层、非事务调用，同一顶
    // staff 帧下发生，一样能证明「敏感操作那一刻帧是完整的」。
    const original = prisma.actionEvent.create.bind(prisma.actionEvent) as (...args: unknown[]) => unknown;
    const seen: Array<{ kind: string | undefined; actorEmail: string | undefined; ownerId: string | null | undefined }> = [];
    vi.spyOn(prisma.actionEvent, "create").mockImplementation(((...args: unknown[]) => {
      const principal = getPrincipal();
      seen.push({
        kind: principal?.kind,
        actorEmail: (principal as { actorEmail?: string } | undefined)?.actorEmail,
        ownerId: (principal as { ownerId?: string | null } | undefined)?.ownerId,
      });
      return original(...args);
    }) as never);

    try {
      const result = await grantTenantCredits({
        orgId: ORG_A,
        displayedAmount: 50,
        reason: "TENANT-A6 staff frame check",
        idempotencyKey,
      });
      expect(result).toEqual({ ok: true, duplicate: false });
    } finally {
      prisma.actionEvent.create = original as never;
    }

    // 两条审计行（ownerId=FOUNDER_OWNER_ID 与 ownerId=orgId）都在同一顶 staff 帧下写出——
    // 帧的 actorEmail/ownerId 不随审计行自己写的字面 ownerId 变化,这正是「帧带出操作者与目标
    // 租户」的意思:帧是谁在做这件事,不是这一行审计写给了谁看。
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((frame) => frame.kind === "staff" && frame.actorEmail === STAFF_GATE.email && frame.ownerId === ORG_A)).toBe(
      true,
    );

    const row = await runAsSystem("test-seed", () =>
      prisma.creditLedger.findFirst({ where: { orgId: ORG_A, idempotencyKey }, select: { balanceDelta: true } }),
    );
    expect(row?.balanceDelta).toBeGreaterThan(0);
  });

  it('TENANT-A6 对账：closeReconcileObservation 关闭一行那一刻，帧是完整的 kind:"staff" 帧，ownerId=这行观察的目标租户', async () => {
    mockRequireRole.mockResolvedValueOnce({ ...STAFF_GATE });
    const sessionId = `cs_test_staff_slice4_${Math.random().toString(36).slice(2)}`;

    await prisma.actionEvent.create({
      data: {
        id: reconcileObservationId(sessionId),
        ownerId: ORG_A,
        type: RECONCILE_OBSERVED_TYPE,
        payload: { sessionId, orgId: ORG_A, amountTotal: 1000, currency: "myr", firstSeenAt: new Date().toISOString() },
      },
    });

    const original = prisma.actionEvent.create.bind(prisma.actionEvent) as (...args: unknown[]) => unknown;
    const seen: Array<{ kind: string | undefined; ownerId: string | null | undefined }> = [];
    vi.spyOn(prisma.actionEvent, "create").mockImplementation(((...args: unknown[]) => {
      const principal = getPrincipal();
      seen.push({ kind: principal?.kind, ownerId: (principal as { ownerId?: string | null } | undefined)?.ownerId });
      return original(...args);
    }) as never);

    try {
      const result = await closeReconcileObservation({
        sessionId,
        disposition: "other",
        note: "TENANT-A6 staff frame check — settled outside Stripe by hand.",
        confirmed: true,
      });
      expect(result).toEqual({ ok: true });
    } finally {
      prisma.actionEvent.create = original as never;
    }

    // 这个动作对账时还没读完观察行,目标租户还不知道——ownerId=null 用到底,是设计,不是漏洞
    // （见 reconcile-actions.ts 的 #1379 注释：全程只写 ActionEvent,不受影响）。
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((frame) => frame.kind === "staff" && frame.ownerId === null)).toBe(true);

    const closure = await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionId) } });
    expect(closure?.ownerId).toBe(ORG_A);
  });

  it('TENANT-A6 退款入口：abandonManualRefund（无开着的 hold 这一支）落到真实账本读那一刻，帧是完整的 kind:"staff" 帧', async () => {
    mockRequireRole.mockResolvedValueOnce({ ...STAFF_GATE });
    const refundId = `manrf_${Math.random().toString(36).slice(2)}`;

    const original = prisma.creditLedger.findMany.bind(prisma.creditLedger) as (...args: unknown[]) => unknown;
    const seen: Array<{ kind: string | undefined; ownerId: string | null | undefined }> = [];
    vi.spyOn(prisma.creditLedger, "findMany").mockImplementation(((...args: unknown[]) => {
      const principal = getPrincipal();
      seen.push({ kind: principal?.kind, ownerId: (principal as { ownerId?: string | null } | undefined)?.ownerId });
      return original(...args);
    }) as never);

    try {
      const result = await abandonManualRefund({ orgId: ORG_A, refundId });
      expect(result).toEqual({ error: "No open refund with that id in this workspace." });
    } finally {
      prisma.creditLedger.findMany = original as never;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ kind: "staff", ownerId: ORG_A });
  });
});

describe("TENANT-A6 权限不因建帧放宽 —— 跨租户铸币仍要 requireRole(\"tenants\",\"mutate\")", () => {
  it("grantCreditsAction：请求体里的 orgId 换成别家，credits.mutate 过了也不够——tenants.mutate 拒了就一分没进 B 家的账，staff 帧从未建立", async () => {
    mockRequireRole
      .mockResolvedValueOnce({ email: "finance@fikirtive.test", roles: ["finance"], role: "finance" }) // credits.mutate
      .mockResolvedValueOnce({ error: "You don't have access to this." }); // tenants.mutate — denied

    const before = await prisma.creditAccount.findUnique({ where: { orgId: ORG_B }, select: { balance: true } });

    const result = await grantCreditsAction({
      orgId: ORG_B,
      displayedAmount: 999,
      reason: "should be denied before any frame",
      idempotencyKey: id("staff-a6-denied"),
    });

    expect(result).toEqual({ error: "You don't have access to this." });
    const after = await prisma.creditAccount.findUnique({ where: { orgId: ORG_B }, select: { balance: true } });
    expect(after?.balance).toBe(before?.balance);
    expect(mockRequireRole).toHaveBeenCalledTimes(2);
  });
});
