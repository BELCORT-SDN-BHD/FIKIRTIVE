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
import type { StartGenPort } from "../factory-batch";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { runVariantBatch, runBulkGrid } = await import("../factory-actions");
const { batchCellStatuses, orchestrateBatch } = await import("../factory-batch");
const { factoryAttemptKey } = await import("../batch-idempotency");
const { startGen } = await import("../gen-actions");
const { prisma, reserveCredits, settleCredits, refundReservation } = await import("@fikirtive/db");

const IMG = INTERNAL_PER_DISPLAY; // one image cell = 1 displayed credit = 10 internal
const VID = 11 * INTERNAL_PER_DISPLAY; // seedance-2-mini 720p/5s = 11 displayed credits (flat-priced video; #644 裁决 2026-08-06)
const ATTEMPT_A = "approval-card-a";
const ATTEMPT_B = "approval-card-b";

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
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "DONE", spent: true, finishedAt: new Date() } });
}
async function workerRefund(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "FAILED", error: "provider failed", finishedAt: new Date() } });
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

/** Hold the first two calls until both orchestrations have completed their read-only factory
 * precheck. Releasing them together forces the money decision onto startGen's transaction lock. */
function afterTwoPrechecks(realStartGen: StartGenPort): StartGenPort {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return async (req) => {
    arrived += 1;
    if (arrived === 2) release();
    await gate;
    return realStartGen(req);
  };
}

describe("W-B3-F-P ledger — quote == reserve == settle (per cell + batch sum)", () => {
  it("reserves each cell's quote, and settling charges exactly that quote", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runVariantBatch({ batchId, projectId, attemptId: ATTEMPT_A, base: { prompt: "product on white" }, variants: [{}, {}, {}] });
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

    const first = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in first) throw new Error(first.error);
    expect((await account(ownerId)).reserved).toBe(2 * IMG);
    expect((await jobsFor(ownerId, projectId)).length).toBe(2);
    const reserveRows1 = (await ledger(ownerId)).filter((r) => r.kind === "RESERVE").length;
    expect(reserveRows1).toBe(2);

    // Replay: identical batchId → identical per-cell keys → startGen dedups.
    const second = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in second) throw new Error(second.error);

    expect((await account(ownerId)).reserved).toBe(2 * IMG); // NOT 4×
    expect((await jobsFor(ownerId, projectId)).length).toBe(2); // no new jobs
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE").length).toBe(2); // no new reserves
    // both runs point at the same job ids
    expect(new Set(second.cells.map((c) => c.jobId)).size).toBe(2);
    expect(second.cells.map((c) => c.jobId).sort()).toEqual(first.cells.map((c) => c.jobId).sort());
  });
});

describe("W-B3-F-P ledger — lock-time factory attempt concurrency", () => {
  it("two first calls for one attempt create/reserve once and report fresh vs reused accurately", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const guardedStart = afterTwoPrechecks(startGen);
    const args = {
      ownerId,
      projectId,
      batchId,
      attemptId: ATTEMPT_A,
      cells: [{ type: "gen" as const, prompt: "same material" }],
    };

    const [left, right] = await Promise.all([
      orchestrateBatch({ startGen: guardedStart, prisma }, args),
      orchestrateBatch({ startGen: guardedStart, prisma }, args),
    ]);
    if ("error" in left) throw new Error(left.error);
    if ("error" in right) throw new Error(right.error);

    expect([left.cells[0].status, right.cells[0].status].sort()).toEqual(["queued", "reused"]);
    expect([left.totalCredits, right.totalCredits].sort((a, b) => a - b)).toEqual([0, IMG]);
    expect(left.cells[0].jobId).toBe(right.cells[0].jobId);
    expect(await jobsFor(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(1);
    expect((await account(ownerId)).reserved).toBe(IMG);
  });

  it("two explicit retries after FAILED create/reserve one new attempt and reuse it on the other call", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = [{ type: "gen" as const, prompt: "retry material" }];

    const initial = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in initial) throw new Error(initial.error);
    await workerRefund(ownerId, initial.cells[0].jobId!);
    expect((await account(ownerId)).reserved).toBe(0);

    const guardedStart = afterTwoPrechecks(startGen);
    const retryArgs = { ownerId, projectId, batchId, attemptId: ATTEMPT_B, cells };
    const [left, right] = await Promise.all([
      orchestrateBatch({ startGen: guardedStart, prisma }, retryArgs),
      orchestrateBatch({ startGen: guardedStart, prisma }, retryArgs),
    ]);
    if ("error" in left) throw new Error(left.error);
    if ("error" in right) throw new Error(right.error);

    expect([left.cells[0].status, right.cells[0].status].sort()).toEqual(["queued", "reused"]);
    expect([left.totalCredits, right.totalCredits].sort((a, b) => a - b)).toEqual([0, IMG]);
    expect(left.cells[0].jobId).toBe(right.cells[0].jobId);
    expect(await jobsFor(ownerId, projectId)).toHaveLength(2); // FAILED A + exactly one B
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(2);
    expect((await account(ownerId)).reserved).toBe(IMG);
  });

  it("concurrent different content for one logical cell fails one call closed with no second reserve", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const guardedStart = afterTwoPrechecks(startGen);
    const common = { ownerId, projectId, batchId, attemptId: ATTEMPT_A };

    const [left, right] = await Promise.all([
      orchestrateBatch({ startGen: guardedStart, prisma }, { ...common, cells: [{ type: "gen", prompt: "material A" }] }),
      orchestrateBatch({ startGen: guardedStart, prisma }, { ...common, cells: [{ type: "gen", prompt: "material B" }] }),
    ]);
    if ("error" in left) throw new Error(left.error);
    if ("error" in right) throw new Error(right.error);

    expect([left.cells[0].status, right.cells[0].status].sort()).toEqual(["error", "queued"]);
    expect([left.totalCredits, right.totalCredits].sort((a, b) => a - b)).toEqual([0, IMG]);
    const refused = [left, right].find((result) => result.cells[0].status === "error")!;
    expect(refused.cells[0].error).toMatch(/different content/i);
    expect(await jobsFor(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(1);
  });

  it("the same structural logical/attempt key is independent across owners", async () => {
    const ownerA = await seedOrg(1000);
    const ownerB = await seedOrg(1000);
    const projectA = await seedProject(ownerA);
    const projectB = await seedProject(ownerB);
    const idempotencyKey = factoryAttemptKey("shared-logical", 0, ATTEMPT_A).key;
    const request = { prompt: "same", kind: "image", model: "seedream", count: 1, idempotencyKey };

    asOwner(ownerA);
    const first = await startGen({ ...request, projectId: projectA });
    asOwner(ownerB);
    const second = await startGen({ ...request, projectId: projectB });
    if ("error" in first) throw new Error(first.error);
    if ("error" in second) throw new Error(second.error);

    expect(first.disposition).toBe("fresh");
    expect(second.disposition).toBe("fresh");
    expect(first.id).not.toBe(second.id);
    expect(await jobsFor(ownerA, projectA)).toHaveLength(1);
    expect(await jobsFor(ownerB, projectB)).toHaveLength(1);
    expect((await account(ownerA)).reserved).toBe(IMG);
    expect((await account(ownerB)).reserved).toBe(IMG);
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
      attemptId: ATTEMPT_A,
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
      attemptId: ATTEMPT_A,
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
      attemptId: ATTEMPT_A,
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

    const res = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells: [{ type: "gen", prompt: "a" }, { type: "gen", prompt: "b" }] });
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
    const res = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
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

describe("W-B3-F-P ledger — replay after DONE does not re-charge (NODE-280 item 1)", () => {
  it("re-running a fully-DONE batch reuses every cell and reserves nothing new", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = [{ type: "gen" as const, prompt: "a" }, { type: "gen" as const, prompt: "b" }];

    const first = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in first) throw new Error(first.error);
    const jobIds = first.cells.map((c) => c.jobId!);
    for (const jid of jobIds) await workerSettle(ownerId, jid); // both DONE
    expect((await account(ownerId)).reserved).toBe(0);
    expect((await account(ownerId)).balance).toBe(1000 - 2 * IMG);

    // Replay the SAME attempt now that both cells are DONE: startGen's lock-time history decision
    // returns reused, so the orchestration reports zero new reservation.
    const second = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in second) throw new Error(second.error);
    expect(second.cells.every((c) => c.status === "reused")).toBe(true);
    expect(second.totalCredits).toBe(0); // zero NEW charge
    expect(second.dispatched).toBe(0);
    expect(second.reused).toBe(2);
    expect((await jobsFor(ownerId, projectId)).length).toBe(2); // no new jobs
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 2 * IMG); // unchanged — no double charge
    expect(second.cells.map((c) => c.jobId).sort()).toEqual([...jobIds].sort());
  });
});

describe("W-B3-F-P ledger — FAILED retry requires a new explicit attempt", () => {
  it("delayed attempt A reuses FAILED/0; attempt B reuses DONE and re-reserves only FAILED", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = [{ type: "gen" as const, prompt: "a" }, { type: "gen" as const, prompt: "b" }];

    const first = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in first) throw new Error(first.error);
    const [j0, j1] = first.cells.map((c) => c.jobId!);
    await workerSettle(ownerId, j0); // cell 0 DONE
    await workerRefund(ownerId, j1); // cell 1 FAILED (refunded)
    expect((await account(ownerId)).reserved).toBe(0);
    expect((await account(ownerId)).balance).toBe(1000 - IMG); // only cell 0 charged

    const delayedReplay = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in delayedReplay) throw new Error(delayedReplay.error);
    expect(delayedReplay.cells[0]).toMatchObject({ status: "reused", jobId: j0, credits: 0 });
    expect(delayedReplay.cells[1]).toMatchObject({ status: "reused", jobId: j1, credits: 0 });
    expect(delayedReplay.totalCredits).toBe(0);

    const second = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_B, cells });
    if ("error" in second) throw new Error(second.error);
    expect(second.cells[0]).toMatchObject({ status: "reused", jobId: j0, credits: 0 });
    expect(second.cells[1].status).toBe("queued");
    expect(second.cells[1].jobId).not.toBe(j1); // a NEW job for the retried cell
    expect(second.reused).toBe(1);
    expect(second.dispatched).toBe(1);
    expect(second.totalCredits).toBe(IMG); // only the re-dispatched cell reserved anew

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(IMG); // the retried cell holds a fresh reserve
    expect(acct.balance).toBe(1000 - 2 * IMG); // cell0 charged + retry reserve held
  });
});

describe("W-B3-F-P ledger — video cell quote == reserve == settle (NODE-280 item 2)", () => {
  it("a real video model (seedance-2-mini) reserves exactly its quote and settles the same", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells: [{ type: "gen", prompt: "product spin", kind: "video", model: "seedance-2-mini" }] });
    if ("error" in res) throw new Error(res.error);
    expect(res.totalCredits).toBe(VID); // quote = 11 displayed × 10 internal
    expect(res.cells[0]).toMatchObject({ status: "queued", credits: VID });

    expect((await account(ownerId)).reserved).toBe(VID); // reserve == quote
    const jid = res.cells[0].jobId!;
    await workerSettle(ownerId, jid);
    const after = await account(ownerId);
    expect(after.reserved).toBe(0);
    expect(after.balance).toBe(1000 - VID); // settle == reserve == quote
  });

  it("a video cell with a missing model is a clean per-cell error — no crash, prior charged cells keep their BatchResult", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId,
      projectId,
      attemptId: ATTEMPT_A,
      cells: [
        { type: "gen", prompt: "hero image" },                     // image → dispatched + charged
        { type: "gen", prompt: "no model video", kind: "video" },  // invalid video model → per-cell error, no crash
        { type: "gen", prompt: "another image" },                  // still dispatched after the bad cell
      ],
    });
    if ("error" in res) throw new Error(res.error); // MUST return a BatchResult (no mid-loop throw)
    expect(res.cells[0].status).toBe("queued");
    expect(res.cells[1]).toMatchObject({ status: "error", credits: 0 });
    expect(res.cells[2].status).toBe("queued");
    expect(res.dispatched).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.totalCredits).toBe(2 * IMG); // only the two image cells

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(2 * IMG); // two image cells reserved; the bad video cell never reserved
    expect((await jobsFor(ownerId, projectId)).length).toBe(2); // no GenJob for the invalid cell
  });
});

describe("W-B3-F-P ledger — video replay after DONE reuses (full-field compare vs REAL persisted row)", () => {
  it("a DONE seedance-2-mini cell (non-default 10s) replays as reused — the cell-side videoOptions mapping matches what startGen actually persisted", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const VID10 = 22 * INTERNAL_PER_DISPLAY; // seedance-2-mini 720p/10s flat = 22 displayed(#644 裁决 2026-08-06)
    const cells = [{ type: "gen" as const, prompt: "product spin", kind: "video" as const, model: "seedance-2-mini", durationSeconds: 10 }];

    const first = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in first) throw new Error(first.error);
    expect(first.cells[0]).toMatchObject({ status: "queued", credits: VID10 });
    await workerSettle(ownerId, first.cells[0].jobId!); // DONE

    // Replay the SAME cell: the precheck's full-field compare (incl. videoOptions built via the
    // shared cellVideoOptions mapping) must MATCH the row the real startGen persisted — reuse,
    // never a false-positive "different content" refusal, zero new reserve.
    const second = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in second) throw new Error(second.error);
    expect(second.cells[0]).toMatchObject({ status: "reused", jobId: first.cells[0].jobId, credits: 0 });
    expect(second.totalCredits).toBe(0);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - VID10); // charged once, never twice
  });
});

// ---------------------------------------------------------------------------
// #777 组图接工厂批量 —— **钱路复审重点全在这一节**。
//
// 供应商侧的形状变了(count 张从 count 次调用变成一次调用),所以这一节要证明的正好是
// 「什么**没有**变」:
//   1. 报价 == 预扣 == 结算,与散图逐字相同(count 是唯一的乘数,组图一格没碰它);
//   2. 一次调用出 N 张仍然 exactly-once —— 重放不新建任务、不新预扣(靠的仍是
//      GenJob 的 (ownerId, projectId, idempotencyKey) 唯一约束 + CreditLedger 的
//      (orgId, refId, kind) 唯一约束,本票一条约束都没加、没改);
//   3. 「一组连贯图」与「N 张散图」是**不同内容**:同一格上互换会被照实拒,
//      而不是静默交付另一样东西;
//   4. 中途失败仍是**逐格**退款,组图那一格整格退(它就是一个任务),
//      与今日一格不差。
// ---------------------------------------------------------------------------
describe("#777 组图 — 报价/预扣/结算与散图逐字相同(收费口径没有第二套)", () => {
  it("一组四张 == 四张散图:同一个数被报价、被预扣、被结算", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const setBatch = `bat_${randomUUID()}`;
    const set = await runBulkGrid({
      batchId: setBatch, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "the same model, four angles", count: 4, coherentSet: true }],
    });
    if ("error" in set) throw new Error(set.error);
    expect(set.totalCredits).toBe(4 * IMG);
    expect((await account(ownerId)).reserved).toBe(4 * IMG);

    const spreadBatch = `bat_${randomUUID()}`;
    const spread = await runBulkGrid({
      batchId: spreadBatch, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "four different hooks", count: 4 }],
    });
    if ("error" in spread) throw new Error(spread.error);
    // 这一行就是「商家积分口径不变」:组图与散图报的是同一个数。
    expect(set.totalCredits).toBe(spread.totalCredits);
    expect((await account(ownerId)).reserved).toBe(8 * IMG);

    // 结算:预扣多少就结多少,组图那一单一格不差。
    await workerSettle(ownerId, set.cells[0].jobId!);
    await workerSettle(ownerId, spread.cells[0].jobId!);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 8 * IMG);
    const settles = (await ledger(ownerId)).filter((row) => row.kind === "SETTLE");
    expect(settles).toHaveLength(2);
    expect(settles.every((row) => row.reservedDelta === -4 * IMG)).toBe(true);
  });

  it("组图的规格真的落进了任务快照(worker 照着它发一次请求,而不是发四次)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "same product, three sizes", count: 3, aspectRatio: "9:16", coherentSet: true }],
    });
    if ("error" in res) throw new Error(res.error);
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: res.cells[0].jobId!, ownerId }, select: { count: true, imageOptions: true } });
    expect(job.count).toBe(3);
    expect(job.imageOptions).toEqual({ aspectRatio: "9:16", coherentSet: true });
  });

  it("散图任务的快照里**没有**这一格 —— 既有行与新散图行逐字同形(幂等不回归)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [
        { type: "gen", prompt: "plain", count: 2 },
        { type: "gen", prompt: "explicit off", count: 2, coherentSet: false },
        { type: "gen", prompt: "one image can't be a set", count: 1, coherentSet: true },
      ],
    });
    if ("error" in res) throw new Error(res.error);
    for (const cell of res.cells) {
      const job = await prisma.genJob.findFirstOrThrow({ where: { id: cell.jobId!, ownerId }, select: { imageOptions: true } });
      expect(job.imageOptions).toEqual({ aspectRatio: "1:1" });
    }
  });
});

describe("#777 组图 — exactly-once:一次调用出 N 张,重放照旧只收一次", () => {
  it("同一张批准卡重放:不新建任务、不新预扣、指回同一个任务", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = [{ type: "gen" as const, prompt: "one model, four angles", count: 4, coherentSet: true }];

    const first = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in first) throw new Error(first.error);
    expect(first.totalCredits).toBe(4 * IMG);

    const second = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in second) throw new Error(second.error);
    expect(second.cells[0]).toMatchObject({ status: "reused", jobId: first.cells[0].jobId, credits: 0 });
    expect(second.totalCredits).toBe(0);

    expect(await jobsFor(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(1);
    expect((await account(ownerId)).reserved).toBe(4 * IMG); // 不是 8×
  });

  it("做完之后再重放同样是复用(DONE 也不许被重收一次)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;
    const cells = [{ type: "gen" as const, prompt: "one model, three angles", count: 3, coherentSet: true }];

    const first = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in first) throw new Error(first.error);
    await workerSettle(ownerId, first.cells[0].jobId!);

    const second = await runBulkGrid({ batchId, projectId, attemptId: ATTEMPT_A, cells });
    if ("error" in second) throw new Error(second.error);
    expect(second.cells[0]).toMatchObject({ status: "reused", credits: 0 });
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 3 * IMG); // 收过一次,再也不收第二次
  });
});

describe("#777 组图 — 「一组连贯图」与「N 张散图」是不同内容(不许静默互换)", () => {
  it("已批一组图的那一格改成散图 ⇒ 照实拒,零新预扣", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const first = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "one model, four angles", count: 4, coherentSet: true }],
    });
    if ("error" in first) throw new Error(first.error);

    const swapped = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "one model, four angles", count: 4 }], // 同 prompt 同张数,只是不再成组
    });
    if ("error" in swapped) throw new Error(swapped.error);
    expect(swapped.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(swapped.cells[0].error).toMatch(/already in use for different content/);

    expect(await jobsFor(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(1);
    expect((await account(ownerId)).reserved).toBe(4 * IMG);
  });

  it("反向:已批散图的那一格改成组图 ⇒ 同样照实拒", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const first = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "four hooks", count: 4 }],
    });
    if ("error" in first) throw new Error(first.error);

    const swapped = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "four hooks", count: 4, coherentSet: true }],
    });
    if ("error" in swapped) throw new Error(swapped.error);
    expect(swapped.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(1);
  });
});

describe("#777 组图 — 批量中途失败:逐格结算/退款,组图那一格整格退", () => {
  it("三格里组图那一格失败 ⇒ 只退它,另两格照结(没有批级回滚)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [
        { type: "gen", prompt: "hero", count: 1 },
        { type: "gen", prompt: "one model, four angles", count: 4, coherentSet: true },
        { type: "gen", prompt: "detail", count: 1 },
      ],
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.totalCredits).toBe(IMG + 4 * IMG + IMG);
    expect((await account(ownerId)).reserved).toBe(6 * IMG);

    const [hero, set, detail] = res.cells.map((cell) => cell.jobId!);
    await workerSettle(ownerId, hero);
    // 组图短交 = 整单失败(适配器把它标成 charged,worker 终结并退款)—— 退的是**整格**
    // 四张的预扣,不是三张:商家一张都没拿到,就一分钱都不该付。
    await workerRefund(ownerId, set);
    await workerSettle(ownerId, detail);

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 2 * IMG); // 只为交付了的两格付钱

    const rows = await ledger(ownerId);
    const refunds = rows.filter((row) => row.kind === "REFUND");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.refId).toBe(set);
    expect(refunds[0]!.balanceDelta).toBe(4 * IMG); // 整组四张一起退
    expect(rows.filter((row) => row.kind === "SETTLE")).toHaveLength(2);
  });

  it("组图那一格退款是幂等的:worker 重投也不会退第二次", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "one model, two angles", count: 2, coherentSet: true }],
    });
    if ("error" in res) throw new Error(res.error);
    const jobId = res.cells[0].jobId!;

    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId })); // 重投

    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000); // 退回原样,绝不多退
    expect(acct.reserved).toBe(0);
    expect((await ledger(ownerId)).filter((row) => row.kind === "REFUND")).toHaveLength(1);
  });

  it("余额只够一格时,组图那一格照旧 fail closed —— 不建任务、不预扣", async () => {
    const ownerId = await seedOrg(2 * IMG); // 只够两张
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const batchId = `bat_${randomUUID()}`;

    const res = await runBulkGrid({
      batchId, projectId, attemptId: ATTEMPT_A,
      cells: [{ type: "gen", prompt: "one model, four angles", count: 4, coherentSet: true }],
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.cells[0]).toMatchObject({ status: "error", credits: 0 });
    expect(await jobsFor(ownerId, projectId)).toHaveLength(0);
    const acct = await account(ownerId);
    expect(acct.balance).toBe(2 * IMG);
    expect(acct.reserved).toBe(0);
  });
});
