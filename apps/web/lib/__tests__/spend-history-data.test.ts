/**
 * spend-history-data.test.ts — #555 round-2: the QUERY layer, not just the pure fold.
 *
 * Round-1 review (P2): the zero-delta-SETTLE rule was only tested against the pure function,
 * so re-adding a `balanceDelta != 0` filter in the query would have stayed green while
 * silently turning finished generations back into "on hold". These tests assert the SQL-shaped
 * facts: no delta filter, tenant scoping on every read, and the honest truncation window.
 *
 * Read-only by construction: the prisma mock exposes ONLY read methods, so any write would
 * throw "is not a function".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));

const organizationFindFirst = vi.fn();
const creditAccountFindUnique = vi.fn();
const creditLedgerFindMany = vi.fn();
const genJobFindMany = vi.fn();
const refGenJobFindMany = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    organization: { findFirst: organizationFindFirst },
    creditAccount: { findUnique: creditAccountFindUnique },
    creditLedger: { findMany: creditLedgerFindMany },
    genJob: { findMany: genJobFindMany },
    refGenJob: { findMany: refGenJobFindMany },
  },
}));

const { getSpendOverview, SPEND_HISTORY_TASK_LIMIT } = await import("@/lib/spend-history-data");

type Row = {
  id: string;
  kind: string;
  source: string;
  reason: string;
  refId: string | null;
  balanceDelta: number;
  reservedDelta: number;
  createdAt: Date;
};

function row(over: Partial<Row> & { id: string }): Row {
  return {
    kind: "RESERVE",
    source: "SYSTEM",
    reason: "",
    refId: null,
    balanceDelta: 0,
    reservedDelta: 0,
    createdAt: new Date("2026-07-30T13:00:00.000Z"),
    ...over,
  };
}

/** Two ledger rows per task: a hold and its settle. `settleDelta` 0 = charged exactly the hold. */
function task(n: number, settleDelta: number | null): Row[] {
  const at = new Date(Date.UTC(2026, 6, 30, 0, 0, n));
  const rows = [
    row({ id: `r${n}`, kind: "RESERVE", refId: `job${n}`, balanceDelta: -10, reservedDelta: 10, createdAt: at }),
  ];
  if (settleDelta !== null) {
    rows.unshift(row({
      id: `s${n}`, kind: "SETTLE", refId: `job${n}`, balanceDelta: settleDelta, reservedDelta: -10,
      createdAt: new Date(at.getTime() + 1000),
    }));
  }
  return rows;
}

/** Wire the two-pass fetch the way Postgres would: pass 1 selects {id, refId} over the whole
 *  table; pass 2 returns only the rows whose task key the caller asked for. Honouring the
 *  second where-clause is what makes the 50/51 boundary assertions meaningful — a mock that
 *  ignored it would hand back every row and hide a broken window. */
function serveLedger(rows: Row[]) {
  creditLedgerFindMany.mockImplementation(async (args: {
    select?: Record<string, unknown>;
    where?: { OR?: Array<{ refId?: { in: string[] }; id?: { in: string[] } }> };
  }) => {
    const isKeyScan = !!args.select && !("balanceDelta" in args.select);
    if (isKeyScan) return rows.map((r) => ({ id: r.id, refId: r.refId }));
    const refIds = new Set(args.where?.OR?.flatMap((c) => c.refId?.in ?? []) ?? []);
    const ids = new Set(args.where?.OR?.flatMap((c) => c.id?.in ?? []) ?? []);
    return rows.filter((r) => (r.refId ? refIds.has(r.refId) : ids.has(r.id)));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "org_1", email: "o@x.test" });
  organizationFindFirst.mockResolvedValue({ settings: {} });
  creditAccountFindUnique.mockResolvedValue({ balance: 785, reserved: 0 });
  genJobFindMany.mockResolvedValue([]);
  refGenJobFindMany.mockResolvedValue([]);
  serveLedger([]);
});

describe("getSpendOverview — fail-closed tenancy", () => {
  it("returns an error and reads NOTHING when the session cannot be resolved", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });

    const res = await getSpendOverview();

    expect(res).toEqual({ error: "Not authorized." });
    expect(creditLedgerFindMany).not.toHaveBeenCalled();
    expect(creditAccountFindUnique).not.toHaveBeenCalled();
  });

  it("scopes every read to the authenticated org", async () => {
    serveLedger(task(1, 0));
    genJobFindMany.mockResolvedValue([{ id: "job1", kind: "IMAGE" }]);

    await getSpendOverview();

    for (const call of creditLedgerFindMany.mock.calls) {
      expect(call[0].where.orgId).toBe("org_1");
    }
    expect(creditAccountFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: "org_1" } }));
    expect(genJobFindMany.mock.calls[0][0].where.ownerId).toBe("org_1");
    expect(refGenJobFindMany.mock.calls[0][0].where.ownerId).toBe("org_1");
  });
});

describe("getSpendOverview — the zero-delta SETTLE rule lives in the QUERY, not just the fold", () => {
  it("never filters ledger rows by balanceDelta", async () => {
    serveLedger(task(1, 0));

    await getSpendOverview();

    expect(creditLedgerFindMany).toHaveBeenCalled();
    for (const call of creditLedgerFindMany.mock.calls) {
      expect(JSON.stringify(call[0].where)).not.toContain("balanceDelta");
    }
  });

  it("shows a generation that settled at exactly its hold as CHARGED, not still on hold", async () => {
    serveLedger(task(1, 0));
    genJobFindMany.mockResolvedValue([{ id: "job1", kind: "IMAGE" }]);

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ category: "image", delta: -1, pending: false });
  });

  it("still marks a real unsettled hold as pending", async () => {
    serveLedger(task(1, null));
    genJobFindMany.mockResolvedValue([{ id: "job1", kind: "IMAGE" }]);

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res.entries[0]).toMatchObject({ pending: true });
  });
});

describe("getSpendOverview — the window is reported honestly (round-1 P1①)", () => {
  it("says there is no more when the workspace has fewer tasks than the limit", async () => {
    serveLedger([...task(2, 0), ...task(1, 0)]);

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res.window).toEqual({ taskLimit: SPEND_HISTORY_TASK_LIMIT, returned: 2, hasMore: false });
  });

  it("at exactly the limit reports no more (the 50 boundary)", async () => {
    const rows = Array.from({ length: SPEND_HISTORY_TASK_LIMIT }, (_, i) => task(i + 1, 0)).flat().reverse();
    serveLedger(rows);

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res.entries).toHaveLength(SPEND_HISTORY_TASK_LIMIT);
    expect(res.window).toEqual({ taskLimit: SPEND_HISTORY_TASK_LIMIT, returned: SPEND_HISTORY_TASK_LIMIT, hasMore: false });
  });

  it("one past the limit truncates AND admits it (the 51 boundary)", async () => {
    const rows = Array.from({ length: SPEND_HISTORY_TASK_LIMIT + 1 }, (_, i) => task(i + 1, 0)).flat().reverse();
    serveLedger(rows);

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res.entries).toHaveLength(SPEND_HISTORY_TASK_LIMIT);
    expect(res.window).toEqual({ taskLimit: SPEND_HISTORY_TASK_LIMIT, returned: SPEND_HISTORY_TASK_LIMIT, hasMore: true });
  });
});

describe("getSpendOverview — balance", () => {
  it("reports the spendable balance and any hold in DISPLAYED credits", async () => {
    creditAccountFindUnique.mockResolvedValue({ balance: 785, reserved: 120 });

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res.balance).toBe(78.5);
    expect(res.reserved).toBe(12);
  });

  it("treats a missing credit account as zero rather than throwing", async () => {
    creditAccountFindUnique.mockResolvedValue(null);

    const res = await getSpendOverview();
    if ("error" in res) throw new Error(res.error);

    expect(res).toMatchObject({ balance: 0, reserved: 0 });
  });
});
