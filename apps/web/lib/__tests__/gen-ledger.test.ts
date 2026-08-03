/**
 * gen-ledger — the account-layer FULL-REAL ledger proof for W-B3-E-P (spec §5.2 E-P / §6.1).
 *
 * The DIRECT startGen spend chain (`pricedGenCredits` quote → confirm → `startGen` reserve →
 * worker settle/refund), proven on real Postgres (*_test), real Prisma, real credit ledger —
 * the factory-batch layer already has this proof through `runVariantBatch`/`runBulkGrid`
 * (factory-batch-ledger.test.ts, W-B3-F-P); THIS file proves the same invariants for the
 * plain-key path every canvas/cowork/direct caller uses, plus the cancel route.
 *
 * The worker's terminal outcomes are exercised via the SAME settleCredits / refundReservation
 * the worker calls (the worker reads the released amount FROM the RESERVE row and never
 * recomputes a price — see apps/worker/src/jobs/gen.ts; precedent: factory-batch-ledger).
 * Zero provider calls, zero real spend. Only the web plumbing around startGen is mocked
 * (auth guard, impersonation, queue, guardian, model registry, next/cache).
 *
 * Proves (EP-A2/A3/A5 + EP-A4 route ④ + 六态②):
 *  - quote == reserve == settle for a plain image batch (count 1-4) AND a plain video job;
 *  - the same idempotency key replays while ACTIVE (sequential AND concurrent) without a second charge;
 *  - under D-035, reusing a plain key after DONE/FAILED is an authorized new generation;
 *  - a retry after FAILED is a NEW job that settles once — the failed job's late finalizers no-op;
 *  - across a count 1-4 job set with partial failure: reserved == settled + refunded, and ONLY
 *    the failed jobs are refunded (each failed job releases its FULL count-hold);
 *  - insufficient balance fails closed with no job, no ledger row, no balance change;
 *  - cancel refunds a QUEUED job exactly once, refuses an in-flight job honestly ("stop button"
 *    verdict 2026-07-14: no new action + queued refund + honest "too late"), and never claws
 *    back a settled charge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, pricedGenCredits } from "@fikirtive/core";

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
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => new Set()) }));

const { startGen } = await import("../gen-actions");
const { cancelGenJob } = await import("../cowork-actions");
const { prisma, settleCredits, refundReservation } = await import("@fikirtive/db");

const IMG = INTERNAL_PER_DISPLAY; // 1 displayed credit per image = 10 internal

// ── real-DB helpers (factory-batch-ledger pattern) ───────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Gen ledger test" } });
  return id;
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
async function ledger(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}
async function jobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({ where: { ownerId, projectId }, select: { id: true, status: true, count: true, kind: true, videoOptions: true } });
}
// The worker's terminal outcomes, via the SAME ledger fns the worker calls.
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "DONE", spent: true, finishedAt: new Date() } });
}
async function workerRefund(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "FAILED", error: "provider failed", finishedAt: new Date() } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
/** Unwrap a StartGenResult or fail the test with its error. */
function idOf(res: Awaited<ReturnType<typeof startGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("W-B3-E-P ledger — EP-A2: quote == reserve == settle, plain image batch (count 1-4)", () => {
  it("a count=4 image job reserves exactly the pricedGenCredits quote and settles the same number", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    // ① QUOTE — the single pricing authority, pinned to the literal price sheet.
    const quote = pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, referenceVideoGenerationId: null, videoOptions: null });
    expect(quote).toBe(4 * IMG);

    // ② RESERVE — the real startGen against real Postgres.
    const res = idOf(await startGen({
      projectId, prompt: "product hero on white", entityIds: [], count: 4,
      kind: "image", model: "seedream", idempotencyKey: `img4-${randomUUID().slice(0, 8)}`,
    }));
    expect(res.disposition).toBe("fresh");
    const reserveRow = (await ledger(ownerId)).find((r) => r.kind === "RESERVE" && r.refId === res.id);
    expect(reserveRow).toBeDefined();
    expect(reserveRow!.reservedDelta).toBe(quote); // reserve == quote
    expect(reserveRow!.balanceDelta).toBe(-quote);
    expect((await account(ownerId)).reserved).toBe(quote);
    expect((await account(ownerId)).balance).toBe(1000 - quote);

    // ③ SETTLE — the worker's commit reads the RESERVE row; net charge == quote.
    await workerSettle(ownerId, res.id);
    const rows = await ledger(ownerId);
    const settleRow = rows.find((r) => r.kind === "SETTLE" && r.refId === res.id);
    expect(settleRow).toBeDefined();
    expect(settleRow!.reservedDelta).toBe(-quote); // settle releases exactly the reserve
    expect(settleRow!.balanceDelta).toBe(0); // GEN path: A == B, nothing given back
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - quote); // charged exactly the quote — 三数一致
  });
});

describe("W-B3-E-P ledger — EP-A2: quote == reserve == settle, plain video job", () => {
  it("a seedance-2-fast 720p/10s job reserves exactly the 14-displayed-credit quote and settles the same", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const quote = pricedGenCredits({ kind: "VIDEO", model: "seedance-2-fast", count: 1, referenceVideoGenerationId: null, videoOptions: { seconds: 10, resolution: "720p" } });
    expect(quote).toBe(14 * IMG); // flat 720p/10s tier

    const res = idOf(await startGen({
      projectId, prompt: "product spin, longer take", entityIds: [], count: 1,
      kind: "video", model: "seedance-2-fast", durationSeconds: 10, resolution: "720p",
      idempotencyKey: `vid10-${randomUUID().slice(0, 8)}`,
    }));
    expect(res.disposition).toBe("fresh");

    // the persisted job carries the options the quote was computed from (worker settles the frozen row)
    const [job] = await jobs(ownerId, projectId);
    expect(job).toMatchObject({ id: res.id, kind: "VIDEO", count: 1 });
    expect(job.videoOptions).toMatchObject({ seconds: 10, resolution: "720p" });

    const reserveRow = (await ledger(ownerId)).find((r) => r.kind === "RESERVE" && r.refId === res.id);
    expect(reserveRow!.reservedDelta).toBe(quote);
    expect((await account(ownerId)).reserved).toBe(quote);

    await workerSettle(ownerId, res.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - quote); // settle == reserve == quote
  });
});

describe("W-B3-E-P ledger — EP-A5(在途面): same-key replay while the first job is ACTIVE never double-charges", () => {
  // Scope honesty (NODE-307-R1 item 1): these two cases cover the IN-FLIGHT (QUEUED/GENERATING)
  // replay only — the dedup class the active-only partial index implements. Under D-035, a
  // TERMINAL-state (post-DONE/FAILED) same-key replay is a new authorized generation; see below.
  // Do not read this title as "all replays are deduped".
  it("a sequential double-submit of the same key reuses the in-flight job — one job, one RESERVE", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `dup-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "same request", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const first = idOf(await startGen(req));
    const second = idOf(await startGen(req));

    expect(first.disposition).toBe("fresh");
    expect(second).toEqual({ id: first.id, disposition: "reused" });
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    expect((await account(ownerId)).reserved).toBe(IMG); // held once, never twice
  });

  it("a CONCURRENT double-submit of the same key charges once — the partial-unique index is the race-proof backstop", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `race-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "double-click", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const [left, right] = (await Promise.all([startGen(req), startGen(req)])).map(idOf);

    expect(left.id).toBe(right.id); // both callers land on the SAME job
    expect([left.disposition, right.disposition].sort()).toEqual(["fresh", "reused"]);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(1); // the loser's tx rolled back
    expect((await account(ownerId)).reserved).toBe(IMG);
    expect((await account(ownerId)).balance).toBe(1000 - IMG);
  });
});

describe("W-B3-E-P ledger — EP-A5: a retry is a NEW job that settles once; the failed job's late finalizers no-op", () => {
  it("FAILED job refunded; retry key charges once; late settle/refund of the dead job change nothing", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    // job A fails at the provider → the worker refunds its full hold
    const a = idOf(await startGen({ projectId, prompt: "retry material", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `try-a-${randomUUID().slice(0, 8)}` }));
    await workerRefund(ownerId, a.id);
    expect((await account(ownerId)).reserved).toBe(0);
    expect((await account(ownerId)).balance).toBe(1000); // fully restored

    // the user retries with a fresh key → a NEW job, a NEW reserve — never a resurrection of A
    const b = idOf(await startGen({ projectId, prompt: "retry material", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `try-b-${randomUUID().slice(0, 8)}` }));
    expect(b.disposition).toBe("fresh");
    expect(b.id).not.toBe(a.id);
    await workerSettle(ownerId, b.id);

    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000 - IMG); // charged exactly once across the whole retry story
    expect(acct.reserved).toBe(0);
    const rows = await ledger(ownerId);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(2);
    expect(rows.filter((r) => r.kind === "REFUND").map((r) => r.refId)).toEqual([a.id]);
    expect(rows.filter((r) => r.kind === "SETTLE").map((r) => r.refId)).toEqual([b.id]);

    // 六态⑥恢复 no-double: late redelivery finalizers against the DEAD job are pure no-ops
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: a.id }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: a.id }));
    const after = await account(ownerId);
    expect(after.balance).toBe(1000 - IMG); // unchanged
    expect(after.reserved).toBe(0);
    expect(await ledger(ownerId)).toHaveLength(rows.length); // not one row more
  });
});

describe("W-B3-E-P ledger — D-035 terminal-state plain-key replay starts a new authorized generation", () => {
  // D-035 defines plain keys as IN-FLIGHT double-submit guards, not exactly-once-ever keys:
  // the fast path matches QUEUED/GENERATING and the partial-unique index is active-only.
  // Reuse after DONE/FAILED therefore represents explicit new consumption, with a new job and
  // reservation. Cowork and factory keys retain their separate durable replay semantics.
  it("D-035: after DONE, the same plain key creates a NEW job and a SECOND reservation", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `term-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "same request", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const first = idOf(await startGen(req));
    await workerSettle(ownerId, first.id); // DONE — the first charge settled

    const replay = idOf(await startGen(req)); // SAME key, after the terminal state

    // D-035 authority behavior — terminal replay is a new authorized generation:
    expect(replay.disposition).toBe("fresh");
    expect(replay.id).not.toBe(first.id);
    expect(await jobs(ownerId, projectId)).toHaveLength(2);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(2); // second reservation
    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000 - 2 * IMG); // first charged AND second held
    expect(acct.reserved).toBe(IMG);
  });

  it("D-035: after FAILED(+refund), the same plain key creates a new job with only the new hold", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `termf-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "same request", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const first = idOf(await startGen(req));
    await workerRefund(ownerId, first.id); // FAILED — the hold fully refunded

    const replay = idOf(await startGen(req));

    expect(replay.disposition).toBe("fresh");
    expect(replay.id).not.toBe(first.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(IMG); // only the new job's hold
    expect(acct.balance).toBe(1000 - IMG); // net charge so far = 0 (refund restored the first hold)
  });
});

describe("W-B3-E-P ledger — across INDEPENDENT jobs: reserved == settled + refunded, only failed JOBS refunded", () => {
  // Scope honesty (NODE-307-R1 item 2): this proves the PER-JOB accounting identity across a
  // set of independent count-1..4 jobs — it is NOT a sub-cell partial-failure proof for a
  // single count=2-4 GenJob. The authority has no sub-cell settle/refund (one provider call,
  // one hold, one finalizer per job). The worker layer now pins D-035's exact-count,
  // all-or-nothing behavior for a single count=2-4 GenJob (gen.test.ts).
  it("across count=1/2/4 image jobs + a video job, 2 failed JOBS release exactly their own full holds", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const mk = (over: Record<string, unknown>) => ({
      projectId, prompt: "cell", entityIds: [], kind: "image", model: "seedream",
      idempotencyKey: `cell-${randomUUID().slice(0, 8)}`, ...over,
    });

    const j1 = idOf(await startGen(mk({ count: 1 })));                                              // 10 — settles
    const j2 = idOf(await startGen(mk({ count: 2, prompt: "cell two" })));                          // 20 — fails
    const j3 = idOf(await startGen(mk({ count: 4, prompt: "cell three" })));                        // 40 — fails
    const j4 = idOf(await startGen(mk({ count: 1, kind: "video", model: "seedance-2-fast", durationSeconds: 5, resolution: "720p", prompt: "cell four" }))); // 80 — settles
    expect((await account(ownerId)).reserved).toBe(10 + 20 + 40 + 80);

    await workerSettle(ownerId, j1.id);
    await workerRefund(ownerId, j2.id);
    await workerRefund(ownerId, j3.id);
    await workerSettle(ownerId, j4.id);

    const rows = await ledger(ownerId);
    // ONLY the failed JOBS are refunded, each for its FULL count-hold (a failed 4-variant job
    // releases all 4 units — nothing is silently retained)
    const refunds = rows.filter((r) => r.kind === "REFUND");
    expect(new Set(refunds.map((r) => r.refId))).toEqual(new Set([j2.id, j3.id]));
    expect(refunds.map((r) => r.balanceDelta).sort((x, y) => x - y)).toEqual([20, 40]);
    // the settled jobs kept exactly their quotes
    const settles = rows.filter((r) => r.kind === "SETTLE");
    expect(new Set(settles.map((r) => r.refId))).toEqual(new Set([j1.id, j4.id]));

    // 分账精确: reserved == settled + refunded (internal credits, per the ledger itself)
    const reserved = rows.filter((r) => r.kind === "RESERVE").reduce((s, r) => s + r.reservedDelta, 0);
    const settled = settles.reduce((s, r) => s - r.reservedDelta, 0);
    const refunded = refunds.reduce((s, r) => s - r.reservedDelta, 0);
    expect(reserved).toBe(150);
    expect(settled).toBe(90);
    expect(refunded).toBe(60);
    expect(reserved).toBe(settled + refunded);

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 90); // charged for the successes only
  });
});

describe("W-B3-E-P ledger — 六态②: insufficient balance fails closed", () => {
  it("an underfunded startGen leaves NO job, NO ledger row, and the balance untouched", async () => {
    const ownerId = await seedOrg(IMG - 1); // one internal credit short of a single image
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const res = await startGen({ projectId, prompt: "over budget", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `broke-${randomUUID().slice(0, 8)}` });

    expect(res).toEqual({ error: expect.stringMatching(/credits/i) });
    expect(await jobs(ownerId, projectId)).toHaveLength(0); // the whole tx rolled back — no job
    expect(await ledger(ownerId)).toHaveLength(0); // and no ledger residue
    const acct = await account(ownerId);
    expect(acct.balance).toBe(IMG - 1); // untouched
    expect(acct.reserved).toBe(0);
  });
});

describe("W-B3-E-P ledger — EP-A4 route ④: cancel (the stop button)", () => {
  it("cancelling a QUEUED job refunds exactly once; a second cancel is an honest no-op", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const res = idOf(await startGen({ projectId, prompt: "stop me", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `stop-${randomUUID().slice(0, 8)}` }));
    expect((await account(ownerId)).reserved).toBe(IMG);

    const first = await cancelGenJob({ jobId: res.id });
    expect(first).toEqual({ refunded: true });
    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000); // fully restored
    expect(acct.reserved).toBe(0);
    const job = await prisma.genJob.findUniqueOrThrow({ where: { id: res.id, ownerId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toBe("Cancelled by you");

    // double-click on the stop button: at-most-once refund
    const second = await cancelGenJob({ jobId: res.id });
    expect(second).toEqual({ alreadyStarted: true });
    expect((await ledger(ownerId)).filter((r) => r.kind === "REFUND")).toHaveLength(1);
    expect((await account(ownerId)).balance).toBe(1000); // not one credit more
  });

  it("cancelling an in-flight job refuses honestly ('too late') — the hold survives and the settle keeps the charge", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const res = idOf(await startGen({ projectId, prompt: "too late", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `late-${randomUUID().slice(0, 8)}` }));

    // the worker claimed it (QUEUED → GENERATING) before the user clicked stop
    await prisma.genJob.update({ where: { id: res.id, ownerId }, data: { status: "GENERATING", startedAt: new Date() } });

    const result = await cancelGenJob({ jobId: res.id });
    expect(result).toEqual({ alreadyStarted: true }); // honest "too late" — never a fake refund
    expect((await ledger(ownerId)).filter((r) => r.kind === "REFUND")).toHaveLength(0);
    expect((await account(ownerId)).reserved).toBe(IMG); // the hold belongs to the running job

    // the run finishes → the charge settles normally; cancel never clawed anything back
    await workerSettle(ownerId, res.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - IMG);
  });
});
