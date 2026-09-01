import { describe, it, expect, vi, beforeEach } from "vitest";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

// Unit test (no DB): mock prisma so the invariants — founder exclusion, org→owner join,
// internal→displayed credit mapping, newest-first ordering, guard-exempt groupBy shape —
// are pinned deterministically. The isolation.test.ts DB test covers the real read path.

// ONLY the methods called by tenant-admin are provided — stray writes would throw
// "is not a function", guarding the read-only contract by construction.
const organizationFindMany = vi.fn();
const organizationFindFirst = vi.fn();
const membershipFindMany = vi.fn();
const membershipFindFirst = vi.fn();
const creditAccountFindMany = vi.fn();
const creditAccountFindUnique = vi.fn();
const generationGroupBy = vi.fn();
const generationCount = vi.fn();
const allowedEmailFindMany = vi.fn();
const creditLedgerFindMany = vi.fn();
const genJobAggregate = vi.fn();
const refGenJobAggregate = vi.fn();
const projectCount = vi.fn();
const actionEventFindMany = vi.fn();
/** MONEY-A14:人工调账 30 天累计 —— 报表与闸读同一条谓词,所以这里也是钱服务的函数。 */
const adjustWindowTotals = vi.fn();

vi.mock("@fikirtive/db", () => ({
  adjustWindowTotals,
  prisma: {
    organization: { findMany: organizationFindMany, findFirst: organizationFindFirst },
    membership: { findMany: membershipFindMany, findFirst: membershipFindFirst },
    creditAccount: { findMany: creditAccountFindMany, findUnique: creditAccountFindUnique },
    generation: { groupBy: generationGroupBy, count: generationCount },
    allowedEmail: { findMany: allowedEmailFindMany },
    creditLedger: { findMany: creditLedgerFindMany },
    genJob: { aggregate: genJobAggregate },
    refGenJob: { aggregate: refGenJobAggregate },
    project: { count: projectCount },
    actionEvent: { findMany: actionEventFindMany },
  },
}));

const { listTenants, getTenantDetail } = await import("@/lib/tenant-admin");

// displayCredits divides internal by 10
const DISPLAY = (n: number) => n / 10;

beforeEach(() => {
  organizationFindMany.mockReset();
  organizationFindFirst.mockReset();
  membershipFindMany.mockReset();
  membershipFindFirst.mockReset();
  creditAccountFindMany.mockReset();
  creditAccountFindUnique.mockReset();
  generationGroupBy.mockReset();
  generationCount.mockReset();
  allowedEmailFindMany.mockReset();
  creditLedgerFindMany.mockReset();
  genJobAggregate.mockReset();
  refGenJobAggregate.mockReset();
  projectCount.mockReset();
  actionEventFindMany.mockReset();
  adjustWindowTotals.mockReset();
  adjustWindowTotals.mockResolvedValue(new Map());
});

describe("listTenants", () => {
  it("excludes the founder org and returns tenants newest-first with joined owner+balance+gen", async () => {
    const now = new Date("2026-06-20T12:00:00Z");
    const earlier = new Date("2026-06-10T08:00:00Z");

    // organizationFindMany returns orgs newest-first (orderBy createdAt desc) — verify the where
    organizationFindMany.mockResolvedValue([
      { id: "orgB", name: "Org B", createdAt: now },
      { id: "orgA", name: "Org A", createdAt: earlier },
    ]);
    membershipFindMany.mockResolvedValue([
      { orgId: "orgA", status: "active", user: { email: "a@test.com" } },
      { orgId: "orgB", status: "active", user: { email: "b@test.com" } },
    ]);
    creditAccountFindMany.mockResolvedValue([
      { orgId: "orgA", balance: 5000 },  // 500 displayed
      { orgId: "orgB", balance: 1000 },  // 100 displayed
    ]);
    // groupBy — the guard-exempt aggregate
    generationGroupBy.mockResolvedValue([
      { ownerId: "orgA", _count: { _all: 3 }, _max: { createdAt: earlier } },
      { ownerId: "orgB", _count: { _all: 7 }, _max: { createdAt: now } },
    ]);
    allowedEmailFindMany.mockResolvedValue([
      { email: "invite@test.com", status: "invited", invitedBy: "founder@test.com", createdAt: now },
    ]);

    const { tenants, invited } = await listTenants();

    // Verify founder exclusion is passed to DB, not post-filtered
    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: FOUNDER_OWNER_ID } }) })
    );
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: { not: FOUNDER_OWNER_ID } }) })
    );

    // Verify gen groupBy uses guard-exempt deletedAt filter and excludes founder
    expect(generationGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, ownerId: { not: FOUNDER_OWNER_ID } } })
    );

    // Tenants are in the same order orgs came back (newest-first from DB)
    expect(tenants).toHaveLength(2);
    expect(tenants[0].orgId).toBe("orgB");
    expect(tenants[1].orgId).toBe("orgA");

    // Owner email joined
    expect(tenants[0].ownerEmail).toBe("b@test.com");
    expect(tenants[1].ownerEmail).toBe("a@test.com");

    // Internal→displayed credit conversion (÷10)
    expect(tenants[0].balance).toBe(DISPLAY(1000)); // 100
    expect(tenants[1].balance).toBe(DISPLAY(5000)); // 500

    // Gen aggregate joined
    expect(tenants[0].genCount).toBe(7);
    expect(tenants[1].genCount).toBe(3);
    expect(tenants[0].lastActiveAt).toBe(now.toISOString());
    expect(tenants[1].lastActiveAt).toBe(earlier.toISOString());

    // Invited list
    expect(invited).toHaveLength(1);
    expect(invited[0]).toMatchObject({ email: "invite@test.com", status: "invited", invitedBy: "founder@test.com" });
    expect(invited[0].createdAt).toBe(now.toISOString());
  });

  it("handles orgs with no membership, no balance, no gens gracefully", async () => {
    organizationFindMany.mockResolvedValue([{ id: "orgX", name: "X", createdAt: new Date() }]);
    membershipFindMany.mockResolvedValue([]);
    creditAccountFindMany.mockResolvedValue([]);
    generationGroupBy.mockResolvedValue([]);
    allowedEmailFindMany.mockResolvedValue([]);

    const { tenants, invited } = await listTenants();
    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({ orgId: "orgX", ownerEmail: "", status: "unknown", balance: 0, genCount: 0, lastActiveAt: null });
    expect(invited).toHaveLength(0);
  });
});

describe("getTenantDetail", () => {
  it("returns null for the founder org without any DB read", async () => {
    const result = await getTenantDetail(FOUNDER_OWNER_ID);
    expect(result).toBeNull();
    expect(organizationFindFirst).not.toHaveBeenCalled();
  });

  it("returns null when the org does not exist", async () => {
    organizationFindFirst.mockResolvedValue(null);
    const result = await getTenantDetail("orgMissing");
    expect(result).toBeNull();
  });

  it("returns scoped detail with internal→displayed credit mapping and per-org tenant guard", async () => {
    const now = new Date("2026-06-20T10:00:00Z");
    organizationFindFirst.mockResolvedValue({ id: "orgA", name: "Org A" });
    membershipFindFirst.mockResolvedValue({ status: "active", user: { email: "a@test.com" } });
    creditAccountFindUnique.mockResolvedValue({ balance: 9990, reserved: 100 });
    creditLedgerFindMany.mockResolvedValue([
      { id: "l1", kind: "GRANT", balanceDelta: 10000, reason: "beta signup", createdAt: now },
      { id: "l2", kind: "RESERVE", balanceDelta: -10, reason: "", createdAt: now },
    ]);
    genJobAggregate.mockResolvedValue({ _sum: { spentUsd: 0.04 } });
    refGenJobAggregate.mockResolvedValue({ _sum: { spentUsd: 0.01 } });
    projectCount.mockResolvedValue(2);
    generationCount.mockResolvedValue(5);
    actionEventFindMany.mockResolvedValue([
      { id: "ae1", type: "generation.attach", createdAt: now },
    ]);

    const detail = await getTenantDetail("orgA");
    expect(detail).not.toBeNull();

    // Per-org reads are scoped to the requested org
    expect(organizationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "orgA" }) })
    );
    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "orgA" }) })
    );
    expect(creditAccountFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "orgA" } })
    );

    // Internal→displayed mapping; spentUsd = genJob + refGenJob
    expect(detail!.balance).toBe(DISPLAY(9990));   // 999
    expect(detail!.reserved).toBe(DISPLAY(100));   // 10
    expect(detail!.spentUsd).toBeCloseTo(0.05); // 0.04 + 0.01

    // Ledger entries mapped with displayedDelta
    expect(detail!.ledger).toHaveLength(2);
    expect(detail!.ledger[0]).toMatchObject({ id: "l1", kind: "GRANT", displayedDelta: DISPLAY(10000), reason: "beta signup" });
    expect(detail!.ledger[1]).toMatchObject({ id: "l2", kind: "RESERVE", displayedDelta: DISPLAY(-10) });

    expect(detail!.projectCount).toBe(2);
    expect(detail!.genCount).toBe(5);
    expect(detail!.audit).toHaveLength(1);
    expect(detail!.audit[0]).toMatchObject({ id: "ae1", type: "generation.attach" });
    expect(detail!.audit[0].createdAt).toBe(now.toISOString());
  });

  it("handles null spentUsd sum and missing creditAccount as zeros", async () => {
    organizationFindFirst.mockResolvedValue({ id: "orgZ", name: "Z" });
    membershipFindFirst.mockResolvedValue(null);
    creditAccountFindUnique.mockResolvedValue(null);
    creditLedgerFindMany.mockResolvedValue([]);
    genJobAggregate.mockResolvedValue({ _sum: { spentUsd: null } });
    refGenJobAggregate.mockResolvedValue({ _sum: { spentUsd: null } });
    projectCount.mockResolvedValue(0);
    generationCount.mockResolvedValue(0);
    actionEventFindMany.mockResolvedValue([]);

    const detail = await getTenantDetail("orgZ");
    expect(detail).not.toBeNull();
    expect(detail!.balance).toBe(0);
    expect(detail!.reserved).toBe(0);
    expect(detail!.spentUsd).toBe(0);
    expect(detail!.ownerEmail).toBe("");
    expect(detail!.status).toBe("unknown");
  });
});

// ── MONEY-A14:租户页读的「30 天人工调账累计」与闸同源 ───────────────────────────
describe("getTenantDetail — 人工调账累计(MONEY-A14)", () => {
  it("累计与上限一起给出来,数字来自钱服务的同一条谓词", async () => {
    organizationFindFirst.mockResolvedValue({ id: "org_1", name: "Shop" });
    membershipFindFirst.mockResolvedValue({ status: "active", user: { email: "a@b.test" } });
    creditAccountFindUnique.mockResolvedValue({ balance: 100, reserved: 0 });
    creditLedgerFindMany.mockResolvedValue([]);
    genJobAggregate.mockResolvedValue({ _sum: { spentUsd: null } });
    refGenJobAggregate.mockResolvedValue({ _sum: { spentUsd: null } });
    projectCount.mockResolvedValue(0);
    generationCount.mockResolvedValue(0);
    actionEventFindMany.mockResolvedValue([]);
    // 18000 内部 = 1800 显示。
    adjustWindowTotals.mockResolvedValue(new Map([["org_1", { internalTotal: 18_000, movements: 4, lastAt: new Date("2026-09-01T00:00:00Z") }]]));

    const detail = await getTenantDetail("org_1");

    expect(adjustWindowTotals).toHaveBeenCalledWith(["org_1"]);
    expect(detail!.adjustRolling30dDisplay).toBe(1800);
    expect(detail!.adjustRolling30dLimitDisplay).toBe(2000);
    // 复审二 P1-2d:未收口的退款单由账本列出(这个 org 一张都没有)。
    expect(detail!.openManualRefunds).toEqual([]);
  });
});

// ── MONEY-A14:未收口的退款单只能从账本读,而且只读这个租户的(复审二 P1-2d) ──────
describe("getTenantDetail — 未收口退款单(MONEY-A14)", () => {
  function baseDetailMocks() {
    organizationFindFirst.mockResolvedValue({ id: "org_1", name: "Shop" });
    membershipFindFirst.mockResolvedValue({ status: "active", user: { email: "a@b.test" } });
    creditAccountFindUnique.mockResolvedValue({ balance: 100, reserved: 0 });
    genJobAggregate.mockResolvedValue({ _sum: { spentUsd: null } });
    refGenJobAggregate.mockResolvedValue({ _sum: { spentUsd: null } });
    projectCount.mockResolvedValue(0);
    generationCount.mockResolvedValue(0);
    actionEventFindMany.mockResolvedValue([]);
    adjustWindowTotals.mockResolvedValue(new Map());
  }

  it("开着的 hold 列出来、已收口的不列;两条查询都带 orgId,别的租户的单子进不来", async () => {
    baseDetailMocks();
    const at = new Date("2026-09-02T03:00:00Z");
    creditLedgerFindMany.mockImplementation(async (args: {
      where: { orgId?: string; kind?: unknown; refId?: { startsWith?: string; notIn?: string[] } };
      take?: number;
    }) => {
      // ① 租户页自己的账本流水读(没有 refId 过滤)。
      if (!args.where.refId) return [];
      expect(args.where.orgId, "两跳都必须按 orgId 收口").toBe("org_1");
      expect(args.where.refId.startsWith).toBe("manual-refund:");
      // ② 第一跳:这个 org 收口过的退款单(全集合,不截断)。
      if (!args.take) {
        expect(args.where.kind).toEqual({ in: ["SETTLE", "REFUND"] });
        return [{ refId: "manual-refund:ticket-done" }];
      }
      // ③ 第二跳:**减完之后**才排序取页 —— 已终结的那张不许再进来。
      expect(args.where.kind).toBe("RESERVE");
      expect(args.where.refId.notIn).toEqual(["manual-refund:ticket-done"]);
      return [
        { refId: "manual-refund:ticket-open", reason: "pi:pi_1|req:1000|held:1000|minor:4166|cur:myr|partial:0", createdAt: at },
        { refId: "manual-refund:ticket-garbled", reason: "no facts here", createdAt: at },
      ];
    });

    const detail = await getTenantDetail("org_1");

    expect(detail!.openManualRefunds).toEqual([
      {
        refundId: "ticket-open",
        paymentIntentId: "pi_1",
        heldDisplay: 100,
        requestedDisplay: 100,
        amountMinor: 4166,
        currency: "myr",
        allowPartial: false,
        at: at.toISOString(),
      },
    ]);
    expect(detail!.openManualRefundsHasMore).toBe(false);
  });

  // ── 复审三 P1:先减后截 ────────────────────────────────────────────────────
  it("25 张更新且已收口 + 1 张更老仍开着 ⇒ 那张老的照样列出来(不能先截后减)", async () => {
    baseDetailMocks();
    const oldAt = new Date("2026-08-01T00:00:00Z");
    const newer = Array.from({ length: 25 }, (_, i) => `manual-refund:done-${i}`);
    creditLedgerFindMany.mockImplementation(async (args: {
      where: { refId?: { startsWith?: string; notIn?: string[] } };
      take?: number;
    }) => {
      if (!args.where.refId) return [];
      if (!args.take) return newer.map((refId) => ({ refId }));
      // 数据库照 notIn 过滤:那 25 张已收口的根本不会回来,老的那张不再被挤掉。
      expect(args.where.refId.notIn).toEqual(newer);
      return [{ refId: "manual-refund:ticket-old", reason: "pi:pi_9|req:200|held:200|minor:833|cur:myr|partial:0", createdAt: oldAt }];
    });

    const detail = await getTenantDetail("org_1");

    expect(detail!.openManualRefunds.map((h) => h.refundId)).toEqual(["ticket-old"]);
    expect(detail!.openManualRefundsHasMore).toBe(false);
  });

  it("开着的单比一页还多 ⇒ hasMore=true,页面据此提示还有更早的", async () => {
    baseDetailMocks();
    const at = new Date("2026-09-02T03:00:00Z");
    creditLedgerFindMany.mockImplementation(async (args: { where: { refId?: unknown }; take?: number }) => {
      if (!args.where.refId) return [];
      if (!args.take) return [];
      // 多取一条正是用来回答「还有没有更早的」:26 条回来 ⇒ 有。
      expect(args.take).toBe(26);
      return Array.from({ length: 26 }, (_, i) => ({
        refId: `manual-refund:open-${i}`,
        reason: `pi:pi_${i}|req:1000|held:1000|minor:4166|cur:myr|partial:0`,
        createdAt: at,
      }));
    });

    const detail = await getTenantDetail("org_1");

    expect(detail!.openManualRefunds).toHaveLength(25);
    expect(detail!.openManualRefundsHasMore).toBe(true);
  });
});
