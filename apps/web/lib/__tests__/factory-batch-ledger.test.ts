/**
 * factory-batch-ledger — the account-layer FULL-REAL ledger test for W-B3-F-P (spec §6.1).
 *
 * Real Postgres (*_test), real Prisma, real credit ledger (reserveCredits via the real startGen),
 * and the worker's settle/refund simulated by calling the SAME settleCredits / refundReservation
 * the worker calls (MockProvider path — zero real provider calls, zero real spend). Only the web
 * plumbing around startGen is mocked (auth guard, impersonation, queue, guardian, model registry,
 * next/cache), exactly like gen-actions.test.ts + the isolation.test.ts real-DB pattern.
 *
 * Proves: quote == reserve == settle per cell + batch sum; replay dedups (no double charge);
 * partial failure refunds ONLY failed cells (no batch-level rollback); text cells are $0;
 * out-of-credits fails closed per cell; cancel refunds only the cancelled cell; a 20-cell batch
 * enqueues fast without blocking on generation (F1 structural).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({ getBoss: vi.fn(async () => ({ send: vi.fn(async () => "queue-job-1") })) }));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => new Set()) }));

const { runVariantBatch, runBulkGrid } = await import("../factory-actions");
const { batchCellStatuses } = await import("../factory-batch");
const { prisma, reserveCredits, settleCredits, refundReservation } = await import("@fikirtive/db");

const IMG = INTERNAL_PER_DISPLAY; // one image cell = 1 displayed credit = 10 internal

// ── real-DB helpers ──────────────────────────────────────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Batch test" } });
  return id;
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
async function ledger(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}
async function jobsFor(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({ where: { ownerId, projectId }, select: { id: true, status: true, idempotencyKey: true } });
}
// The worker's terminal outcomes, via the SAME ledger fns the worker uses.
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId }, data: { status: "DONE", spent: true, finishedAt: new Date() } });
}
async function workerRefund(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId }, data: { status: "FAILED", error: "provider failed", finishedAt: new Date() } });
}
// cancel = the QUEUED→FAILED + refund path (cancelGenJob core), refund-only.
async function cancelQueued(ownerId: string, jobId: string) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.genJob.updateMany({ where: { id: jobId, ownerId, status: "QUEUED" }, data: { status: "FAILED", error: "Cancelled by you" } });
    if (count > 0) await refundReservation(tx, { orgId: ownerId, refId: jobId });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  mockRequireOwner.mockReset();
});

function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}

describe("W-B3-F-P ledger — quote == reserve == settle (per cell + batch sum)", () => {
  it("reserves each cell's quote, and settling charges exactly that quote", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runVariantBatch({ batchId, projectId, base: { prompt: "product on white" }, variants: [{}, {}, {}] });
    if ("error" in res) throw new Error(res.error);

    // QUOTE: batch total = Σ per-cell pricedGenCredits
    expect(res.totalCredits).toBe(3 * IMG);
    expect(res.cells.every((c) => c.credits === IMG)).toBe(true);

    // RESERVE == QUOTE: the account holds exactly the batch quote in `reserved`
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(3 * IMG);
    expect(acct.balance).toBe(1000 - 3 * IMG);

    // per-cell RESERVE ledger row == that cell's quote
    const rows = await ledger(ownerId);
    const jobIds = res.cells.map((c) => c.jobId!);
    for (const jid of jobIds) {
      const reserve = rows.find((r) => r.refId === jid && r.kind === "RESERVE");
      expect(reserve).toBeDefined();
      expect(reserve!.reservedDelta).toBe(IMG);
      expect(reserve!.balanceDelta).toBe(-IMG);
    }

    // SETTLE == RESERVE == QUOTE: settle all three; net charge per cell == its quote.
    for (const jid of jobIds) await workerSettle(ownerId, jid);
    const after = await account(ownerId);
    expect(after.reserved).toBe(0);
    expect(after.balance).toBe(1000 - 3 * IMG); // charged exactly the batch quote, nothing more

    const rows2 = await ledger(ownerId);
    for (const jid of jobIds) {
      const cellRows = rows2.filter((r) => r.refId === jid);
      const netCharge = -cellRows.reduce((s, r) => s + r.balanceDelta, 0);
      expect(netCharge).toBe(IMG); // reserve(-10) + settle(0) → charged 10 == quote
    }
  });
});

describe("W-B3-F-P ledger — replay with the same batchId does not double-charge", () => {
  it("re-running the same batch reuses the in-flight jobs and reserves nothing extra", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = [{ type: "gen" as const, prompt: "a" }, { type: "gen" as const, prompt: "b" }];

    const first = await runBulkGrid({ batchId, projectId, cells });
    if ("error" in first) throw new Error(first.error);
    expect((await account(ownerId)).reserved).toBe(2 * IMG);
    expect((await jobsFor(ownerId, projectId)).length).toBe(2);
    const reserveRows1 = (await ledger(ownerId)).filter((r) => r.kind === "RESERVE").length;
    expect(reserveRows1).toBe(2);

    // Replay: identical batchId → identical per-cell keys → startGen dedups.
    const second = await runBulkGrid({ batchId, projectId, cells });
    if ("error" in second) throw new Error(second.error);

    expect((await account(ownerId)).reserved).toBe(2 * IMG); // NOT 4×
    expect((await jobsFor(ownerId, projectId)).length).toBe(2); // no new jobs
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE").length).toBe(2); // no new reserves
    // both runs point at the same job ids
    expect(new Set(second.cells.map((c) => c.jobId)).size).toBe(2);
    expect(second.cells.map((c) => c.jobId).sort()).toEqual(first.cells.map((c) => c.jobId).sort());
  });
});

describe("W-B3-F-P ledger — N=4, 2 fail: refund only the failed cells", () => {
  it("settles the 2 successes and refunds ONLY the 2 failures (no batch-level rollback)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId,
      projectId,
      cells: [
        { type: "gen", prompt: "a" },
        { type: "gen", prompt: "b" },
        { type: "gen", prompt: "c" },
        { type: "gen", prompt: "d" },
      ],
    });
    if ("error" in res) throw new Error(res.error);
    expect((await account(ownerId)).reserved).toBe(4 * IMG);

    const [j0, j1, j2, j3] = res.cells.map((c) => c.jobId!);
    await workerSettle(ownerId, j0);
    await workerSettle(ownerId, j1);
    await workerRefund(ownerId, j2);
    await workerRefund(ownerId, j3);

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 2 * IMG); // charged for 2 successes only

    const rows = await ledger(ownerId);
    expect(rows.filter((r) => r.kind === "SETTLE").length).toBe(2);
    expect(rows.filter((r) => r.kind === "REFUND").length).toBe(2); // exactly the 2 failures, never 4
    // refunds are the failed refIds only
    expect(new Set(rows.filter((r) => r.kind === "REFUND").map((r) => r.refId))).toEqual(new Set([j2, j3]));

    const rollup = await batchCellStatuses(prisma, ownerId, batchId);
    expect(rollup).toMatchObject({ done: 2, failed: 2, total: 4 });
  });
});

describe("W-B3-F-P ledger — text cells are $0", () => {
  it("a text cell never reserves and never mints a GenJob", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId,
      projectId,
      cells: [
        { type: "text", text: "Summer Sale" },
        { type: "gen", prompt: "product hero" },
      ],
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.totalCredits).toBe(IMG); // only the gen cell
    expect(res.cells[0]).toMatchObject({ type: "text", status: "text", credits: 0 });

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(IMG); // 1 gen cell reserved, text cell $0
    expect((await jobsFor(ownerId, projectId)).length).toBe(1); // no GenJob for the text cell
  });
});

describe("W-B3-F-P ledger — fail-closed per cell", () => {
  it("out-of-credits mid-batch refuses the remaining cells without double-charging", async () => {
    const ownerId = await seedOrg(IMG); // enough for exactly ONE cell
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId,
      projectId,
      cells: [
        { type: "gen", prompt: "a" },
        { type: "gen", prompt: "b" },
        { type: "gen", prompt: "c" },
      ],
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.dispatched).toBe(1);
    expect(res.failed).toBe(2);
    expect(res.cells[0].status).toBe("queued");
    expect(res.cells[1].status).toBe("error");
    expect(res.cells[2].status).toBe("error");

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(IMG); // only the one affordable cell reserved
    expect(acct.balance).toBe(0);
    expect((await jobsFor(ownerId, projectId)).length).toBe(1); // no jobs for the refused cells
  });

  it("cancelling a queued cell refunds ONLY that cell", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({ batchId, projectId, cells: [{ type: "gen", prompt: "a" }, { type: "gen", prompt: "b" }] });
    if ("error" in res) throw new Error(res.error);
    expect((await account(ownerId)).reserved).toBe(2 * IMG);

    const [j0, j1] = res.cells.map((c) => c.jobId!);
    await cancelQueued(ownerId, j0);

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(IMG); // j1 still reserved
    expect(acct.balance).toBe(1000 - IMG); // j0 refunded back
    const rollup = await batchCellStatuses(prisma, ownerId, batchId);
    expect(rollup).toMatchObject({ queued: 1, failed: 1, total: 2 });
    expect((await ledger(ownerId)).filter((r) => r.kind === "REFUND" && r.refId === j1).length).toBe(0); // j1 NOT refunded
  });
});

describe("W-B3-F-P ledger — F1 structural: 20 cells enqueue without blocking", () => {
  it("dispatches 20 cells fast and returns them all queued (never waits for generation)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = Array.from({ length: 20 }, (_, i) => ({ type: "gen" as const, prompt: `cell ${i}` }));

    const t0 = Date.now();
    const res = await runBulkGrid({ batchId, projectId, cells });
    const elapsed = Date.now() - t0;
    if ("error" in res) throw new Error(res.error);

    expect(res.dispatched).toBe(20);
    expect(res.cells.every((c) => c.status === "queued")).toBe(true); // none 'done' → didn't block on the worker
    expect((await account(ownerId)).reserved).toBe(20 * IMG);
    const rollup = await batchCellStatuses(prisma, ownerId, batchId);
    expect(rollup).toMatchObject({ queued: 20, generating: 0, done: 0, failed: 0, total: 20 });
    // mock-level 20-cell enqueue is ≪ the 30-minute full-chain budget
    expect(elapsed).toBeLessThan(30000);
  });
});
