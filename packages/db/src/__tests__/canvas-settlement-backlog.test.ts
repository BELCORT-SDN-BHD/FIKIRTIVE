/**
 * #601 T2b r2 — what happens after the board write FAILS.
 *
 * Writing a delivered job's cards is best-effort on purpose: it runs after the merchant has been
 * charged and the job says DONE, and it must never be able to undo either. The cost of that choice
 * is the case this file owns: the write threw, the money is right, the job is finished — and the
 * merchant is looking at a board that is missing work they paid for.
 *
 * A job in that state is invisible to every existing sweep (they all look for jobs that are still
 * running), so without the backlog below "it can be written again later" is a comment, not a
 * mechanism. What these cases pin:
 *   1. A failed board write leaves the money and the job exactly as they were.
 *   2. The job is FOUND again afterwards, and repairing it writes the missing cards.
 *   3. Repairing lands EXACTLY once — a second sweep finds nothing left to do.
 *   4. Boards that are already right, jobs the merchant suppressed, and jobs that have no board
 *      at all are never in the worklist, so the sweep cannot churn or resurrect anything.
 *
 * The failed write is reproduced by its OBSERVABLE result — the cards were not written — which is
 * exactly the state `settleCanvasBoard`'s swallowed exception leaves behind in production.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { CANVAS_JOB_KEY_PREFIX } from "@fikirtive/core";
import { prisma } from "../index.js";
import { findCanvasSettlementBacklog, settleCanvasCardsForGenJob } from "../canvas-settlement.js";
import { seedOrg } from "../../test/setup.js";

const CARD = { w: 320, h: 320 };
const HOUR = 60 * 60_000;

let orgId: string;
let projectId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Backlog board" } });
});

afterEach(async () => {
  if (!orgId) return;
  await prisma.canvasNode.deleteMany({ where: { ownerId: orgId } });
});

/** The window a sweep uses: everything delivered in the last day, bar the last two minutes. */
function sweepWindow(now = Date.now()) {
  return { finishedAfter: new Date(now - 24 * HOUR), finishedBefore: new Date(now - 2 * 60_000), limit: 200 };
}

async function seedGeneration(): Promise<string> {
  const contentHash = randomUUID().replace(/-/g, "").repeat(2);
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgId, contentHash, ext: "png",
      mime: "image/png", sizeBytes: BigInt(64), source: "GENERATED",
    },
  });
  const generation = await prisma.generation.create({
    data: { id: `gen_${randomUUID()}`, ownerId: orgId, projectId, assetId: asset.id, source: "GENERATED", entitySnapshot: {} },
  });
  return generation.id;
}

/** A delivered, paid, settled job — the only state this sweep ever looks at. */
async function seedDeliveredJob(input: {
  outputs: number;
  minutesAgo?: number;
  threadId?: string | null;
  canvasKey?: boolean;
}): Promise<{ jobId: string; generationIds: string[] }> {
  const generationIds: string[] = [];
  for (let i = 0; i < input.outputs; i += 1) generationIds.push(await seedGeneration());
  const jobId = `gjb_${randomUUID()}`;
  const finishedAt = new Date(Date.now() - (input.minutesAgo ?? 30) * 60_000);
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "a cup steaming", kind: "IMAGE", model: "seedream",
      count: input.outputs, status: "DONE", generationIds,
      threadId: input.threadId ?? null,
      idempotencyKey: input.canvasKey === false ? null : `${CANVAS_JOB_KEY_PREFIX}${randomUUID().replace(/-/g, "")}`,
      spent: true, spentUsd: 0.12, startedAt: new Date(Date.now() - HOUR), finishedAt,
    },
  });
  return { jobId, generationIds };
}

async function seedCard(input: { jobId: string | null; x: number; status?: string; generationId?: string | null }): Promise<string> {
  const id = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id, ownerId: orgId, projectId, type: "image", x: input.x, y: 0, w: CARD.w, h: CARD.h,
      prompt: "a cup steaming", genJobId: input.jobId, generationId: input.generationId ?? null,
      status: input.status ?? "pending",
    },
  });
  return id;
}

async function cardsForJob(jobId: string) {
  return prisma.canvasNode.findMany({
    where: { ownerId: orgId, projectId, genJobId: jobId },
    orderBy: [{ y: "asc" }, { x: "asc" }],
    select: { id: true, x: true, y: true, status: true, generationId: true, sourceNodeId: true },
  });
}

async function moneySnapshot(jobId: string) {
  const job = await prisma.genJob.findFirstOrThrow({
    where: { id: jobId, ownerId: orgId },
    select: { status: true, spent: true, spentUsd: true, generationIds: true, finishedAt: true },
  });
  const ledger = await prisma.creditLedger.findMany({
    where: { orgId, refId: jobId }, orderBy: { id: "asc" },
    select: { kind: true, balanceDelta: true, reservedDelta: true },
  });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { job, ledger, account };
}

describe("a delivered job whose board write fell over", () => {
  it("is still found later, and repairing it writes the missing cards exactly once", async () => {
    const { jobId, generationIds } = await seedDeliveredJob({ outputs: 3 });
    // The browser had placed the in-flight card; the completion path's board write then threw.
    await seedCard({ jobId, x: 100, status: "pending" });
    const money = await moneySnapshot(jobId);
    expect((await cardsForJob(jobId)).filter((card) => card.status === "done")).toHaveLength(0);

    const first = await findCanvasSettlementBacklog(sweepWindow());
    expect(first.map((job) => job.id)).toContain(jobId);
    for (const job of first) await settleCanvasCardsForGenJob(job.id, job.ownerId);

    const cards = await cardsForJob(jobId);
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.generationId)).toEqual(generationIds);
    expect(cards.every((card) => card.status === "done")).toBe(true);

    // The next sweep has nothing left to do — the repair is once, not once per tick.
    const second = await findCanvasSettlementBacklog(sweepWindow());
    expect(second.map((job) => job.id)).not.toContain(jobId);
    for (const job of second) await settleCanvasCardsForGenJob(job.id, job.ownerId);
    expect(await cardsForJob(jobId)).toEqual(cards);

    // …and none of it was money. The charge, the job row and the balance are untouched throughout.
    expect(await moneySnapshot(jobId)).toEqual(money);
  });

  it("finds a job whose cards were never placed at all", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 2 });

    const backlog = await findCanvasSettlementBacklog(sweepWindow());

    expect(backlog.map((job) => job.id)).toContain(jobId);
  });
});

describe("what the sweep must leave alone", () => {
  it("ignores a board that is already complete", async () => {
    const { jobId, generationIds } = await seedDeliveredJob({ outputs: 2 });
    await seedCard({ jobId, x: 0, status: "done", generationId: generationIds[0] });
    await seedCard({ jobId, x: 340, status: "done", generationId: generationIds[1] });

    expect((await findCanvasSettlementBacklog(sweepWindow())).map((job) => job.id)).not.toContain(jobId);
  });

  it("ignores a batch the merchant deleted while it was still running", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 4 });
    await seedCard({ jobId, x: 0, status: "deleted", generationId: null });

    expect((await findCanvasSettlementBacklog(sweepWindow())).map((job) => job.id)).not.toContain(jobId);
  });

  it("ignores a storyboard job — no board, no chat, no canvas key", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 2, canvasKey: false });

    expect((await findCanvasSettlementBacklog(sweepWindow())).map((job) => job.id)).not.toContain(jobId);
  });

  it("ignores a job that has only just been delivered — its own completion path is still running", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 2, minutesAgo: 0 });

    expect((await findCanvasSettlementBacklog(sweepWindow())).map((job) => job.id)).not.toContain(jobId);
  });

  it("ignores a job older than the sweep's window", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 2, minutesAgo: 60 * 25 });

    expect((await findCanvasSettlementBacklog(sweepWindow())).map((job) => job.id)).not.toContain(jobId);
  });

  it("ignores a job that is not delivered", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 2 });
    await prisma.genJob.update({ where: { id: jobId }, data: { status: "FAILED" } });

    expect((await findCanvasSettlementBacklog(sweepWindow())).map((job) => job.id)).not.toContain(jobId);
  });
});

describe("one workspace's backlog is never another's", () => {
  it("reports each job under its own owner, and repairing with the wrong one does nothing", async () => {
    const { jobId } = await seedDeliveredJob({ outputs: 2 });
    const otherOrg = `org_${randomUUID()}`;
    await seedOrg(otherOrg, 1_000);

    const entry = (await findCanvasSettlementBacklog(sweepWindow())).find((job) => job.id === jobId);
    expect(entry).toEqual({ id: jobId, ownerId: orgId });

    expect((await settleCanvasCardsForGenJob(jobId, otherOrg)).status).toBe("job-missing");
    expect(await cardsForJob(jobId)).toHaveLength(0);
  });
});
