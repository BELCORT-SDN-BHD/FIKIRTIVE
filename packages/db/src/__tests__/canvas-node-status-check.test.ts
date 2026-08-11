/**
 * #602 T3 — the card status column is a FINITE SET, and the database is what says so.
 *
 * Everything else in this ticket is a rule that lives in TypeScript: a derivation, a set of
 * writers, a validated action. All of it is true only for as long as every future writer keeps
 * agreeing with it, and the writer that motivated this constraint is the one that did not — a
 * server action that passed the browser's status string to the column unread, for as long as it
 * has existed. So the vocabulary is written down where a writer cannot argue with it.
 *
 * Two things are asserted against a real database: every word the writers legitimately produce is
 * accepted, and a word from outside the set is refused. The second is the whole point — before
 * this migration it was accepted, and a row carrying a word no renderer knows renders as an
 * eternal spinner (F21).
 *
 * Zero money: only Organization / Project / CanvasNode rows are touched here.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { canvasCardRowAdvances } from "@fikirtive/core";
import { prisma } from "../index.js";
import { settleCanvasCardsForGenJob } from "../canvas-settlement.js";
import { seedOrg } from "../../test/setup.js";

/** The set the constraint enforces — kept here as literals on purpose. Importing it from the same
 *  module the production code uses would make this test agree with itself; spelling it out means
 *  a change to either side has to be made twice, deliberately. */
const ROW_STATUSES = [
  "pending",
  "done",
  "failed",
  "cancelled",
  "timeout",
  "missing",
  "deleted",
  "unknown",
] as const;

let orgId: string;
let projectId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  projectId = `proj_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "state algebra" } });
});

async function insertCard(status: string): Promise<void> {
  await prisma.canvasNode.create({
    data: {
      id: `node_${randomUUID()}`,
      ownerId: orgId,
      projectId,
      type: "image",
      x: 0, y: 0, w: 320, h: 320,
      status,
    },
  });
}

describe("what a canvas card row is allowed to say", () => {
  it.each(ROW_STATUSES)("stores %s — every word a writer legitimately produces", async (status) => {
    await expect(insertCard(status)).resolves.toBeUndefined();
    const row = await prisma.canvasNode.findFirst({ where: { ownerId: orgId, projectId }, select: { status: true } });
    expect(row?.status).toBe(status);
  });

  it.each([
    // The shape that started this: the create action's unvalidated client string.
    ["generating"],
    ["GENERATING"],
    ["queued"],
    ["ready"],
    [""],
  ])("refuses %s — a word outside the set cannot reach the column", async (status) => {
    await expect(insertCard(status)).rejects.toThrow();
    expect(await prisma.canvasNode.count({ where: { ownerId: orgId, projectId } })).toBe(0);
  });

  it("refuses an out-of-set word on an UPDATE too, not only on insert", async () => {
    await insertCard("pending");
    const card = await prisma.canvasNode.findFirstOrThrow({ where: { ownerId: orgId, projectId }, select: { id: true } });

    await expect(
      prisma.canvasNode.updateMany({ where: { id: card.id, ownerId: orgId }, data: { status: "generating" } }),
    ).rejects.toThrow();

    const after = await prisma.canvasNode.findFirstOrThrow({
      where: { id: card.id, ownerId: orgId },
      select: { status: true },
    });
    expect(after.status).toBe("pending");
  });

  it("names the constraint the migration created, so a silent drop is visible here", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
       WHERE conrelid = '"CanvasNode"'::regclass AND contype = 'c'`;
    expect(rows.map((row) => row.conname)).toContain("CanvasNode_status_check");
  });
});

/**
 * #602 r2 (judge P2) — FORWARD-ONLY, EXERCISED.
 *
 * The pure ordering (`canvasCardRowAdvances`) says what a writer may do. Restating each writer's
 * WHERE clause beside it in a table proves nothing: the table and the code can drift, and the
 * table is the thing the test reads. So these cases run the REAL settlement against the REAL
 * database, over the two transitions the r2 review found had no WHERE-level guard at all, and
 * assert the ordering on what actually landed in the column.
 *
 * The transition under test is the dangerous one: `deleted` is absorbing. A card the merchant took
 * away must not come back — nothing on the board can ever remove it a second time, so a
 * resurrected card haunts them for good.
 */
describe("no writer can move a card backwards — driven through the real settlement", () => {
  async function seedJob(status: string, outputs: number): Promise<{ jobId: string; generationIds: string[] }> {
    const generationIds: string[] = [];
    for (let i = 0; i < outputs; i += 1) {
      const asset = await prisma.asset.create({
        data: {
          id: `ast_${randomUUID()}`, ownerId: orgId, contentHash: randomUUID().replace(/-/g, "").repeat(2),
          ext: "png", mime: "image/png", sizeBytes: BigInt(64), source: "GENERATED",
        },
      });
      const generation = await prisma.generation.create({
        data: {
          id: `gen_${randomUUID()}`, ownerId: orgId, projectId, assetId: asset.id,
          source: "GENERATED", entitySnapshot: {},
        },
      });
      generationIds.push(generation.id);
    }
    const jobId = `gjb_${randomUUID()}`;
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, prompt: "a cup steaming", kind: "IMAGE", model: "seedream",
        count: Math.max(1, outputs), status: status as never, generationIds, finishedAt: new Date(),
      },
    });
    return { jobId, generationIds };
  }

  /** The card the merchant deleted while the job was still running: a job-wide tombstone. */
  async function seedTombstone(jobId: string): Promise<string> {
    const id = `node_${randomUUID()}`;
    await prisma.canvasNode.create({
      data: {
        id, ownerId: orgId, projectId, type: "image",
        x: 0, y: 0, w: 320, h: 320, genJobId: jobId, status: "deleted",
      },
    });
    return id;
  }

  it.each([
    ["DONE — the delivered path's own update", "DONE"],
    ["FAILED — the terminal path's update", "FAILED"],
    ["CANCELLED — the merchant's own ending", "CANCELLED"],
  ])("leaves a deleted card deleted when the job settles (%s)", async (_name, jobStatus) => {
    const { jobId } = await seedJob(jobStatus, jobStatus === "DONE" ? 1 : 0);
    const cardId = await seedTombstone(jobId);
    const before = await prisma.canvasNode.findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { status: true } });

    await settleCanvasCardsForGenJob(jobId, orgId);

    const after = await prisma.canvasNode.findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { status: true } });
    expect(after.status).toBe("deleted");
    expect(canvasCardRowAdvances(before.status, after.status)).toBe(true);
  });

  it("moves a running job's card FORWARD to the job's ending, never back", async () => {
    const { jobId } = await seedJob("FAILED", 0);
    const cardId = `node_${randomUUID()}`;
    await prisma.canvasNode.create({
      data: {
        id: cardId, ownerId: orgId, projectId, type: "image",
        x: 0, y: 0, w: 320, h: 320, genJobId: jobId, status: "pending",
      },
    });

    await settleCanvasCardsForGenJob(jobId, orgId);

    const after = await prisma.canvasNode.findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { status: true } });
    expect(after.status).toBe("failed");
    expect(canvasCardRowAdvances("pending", after.status)).toBe(true);
    // …and the settled card cannot then be dragged back by a second settlement.
    await settleCanvasCardsForGenJob(jobId, orgId);
    const again = await prisma.canvasNode.findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { status: true } });
    expect(again.status).toBe("failed");
  });
});

/**
 * #602 r3 (judge P2) — the guard is proved AT THE WRITE, by forcing the race it exists for.
 *
 * The r2 round added `status: { not: "deleted" }` to the settlement's place-path update, and the
 * r2 tests did not actually reach it: a tombstoned card is filtered out by the PROJECTION long
 * before any write is planned (`planCanvasSettlement` reads tombstones and plans around them), so
 * those cases proved the projection, not the guard.
 *
 * The guard exists for the one case the projection cannot see: the card is live when the board is
 * read and deleted by the time the write lands. Under the job's advisory lock that window is
 * closed for today's writers — which is exactly why it has to be forced to be tested. It is forced
 * here by blocking the settlement on a table it reads BETWEEN the board read and the write
 * (`ChatThread`, via `liveThreadId`), tombstoning the card from a second connection while it
 * waits, then letting it go. The settlement then runs its real, planned UPDATE against a row the
 * database now says is deleted — and must change nothing.
 */
describe("the settlement's own write refuses a card that was deleted after the board was read", () => {
  /**
   * Poll until the settlement is parked on THIS test's `ChatThread` lock.
   *
   * The whole race rests on this wait meaning one specific thing: the settlement has finished
   * reading the board and has reached the thread lookup behind it. It used to be spelled as
   * "some backend, somewhere, is waiting for some lock" — `pg_stat_activity` with no filter on
   * the database, the relation or the process. Every developer machine and every CI runner
   * shares one PostgreSQL server with other work, and any lock wait anywhere in the CLUSTER —
   * another database entirely — satisfied that. When it did, the deletion below landed BEFORE
   * the settlement's board read instead of after it, the projection saw a tombstone, and the
   * settlement correctly answered `suppressed` for a case this test meant to force into the
   * write. A green run then meant "the machine was quiet", and a red one meant nothing at all.
   *
   * So the wait now names the lock it is actually waiting for: a request for a lock on
   * `ChatThread`, in THIS database, that has not been granted — which is the settlement's own
   * read blocked behind the ACCESS EXCLUSIVE lock the blocker is holding, and nothing else. The
   * blocker's own lock is granted, so it never counts itself.
   */
  async function waitForLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n
          FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE NOT l.granted
           AND l.locktype = 'relation'
           AND l.relation = to_regclass('"ChatThread"')
           AND a.datname = current_database()`;
      if (Number(rows[0]!.n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("the settlement never blocked on the ChatThread lock — the race was not forced");
  }

  it("changes zero rows, and the card stays deleted", async () => {
    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId, title: "board" } });

    const asset = await prisma.asset.create({
      data: {
        id: `ast_${randomUUID()}`, ownerId: orgId, contentHash: randomUUID().replace(/-/g, "").repeat(2),
        ext: "png", mime: "image/png", sizeBytes: BigInt(64), source: "GENERATED",
      },
    });
    const generation = await prisma.generation.create({
      data: { id: `gen_${randomUUID()}`, ownerId: orgId, projectId, assetId: asset.id, source: "GENERATED", entitySnapshot: {} },
    });
    const jobId = `gjb_${randomUUID()}`;
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, threadId, prompt: "a cup steaming", kind: "IMAGE",
        model: "seedream", count: 1, status: "DONE", generationIds: [generation.id], finishedAt: new Date(),
      },
    });
    // A LIVE anchor: this is what the settlement's board read will see, and what it plans an
    // `update` for (bind the output, flip to done).
    const cardId = `node_${randomUUID()}`;
    await prisma.canvasNode.create({
      data: {
        id: cardId, ownerId: orgId, projectId, type: "image",
        x: 0, y: 0, w: 320, h: 320, genJobId: jobId, status: "pending",
      },
    });

    // Second connection: hold ChatThread so the settlement parks after its board read, delete the
    // card, then let go. Its own transaction commits the tombstone before the settlement resumes.
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "ChatThread" IN ACCESS EXCLUSIVE MODE');
      await waitForLockWait();
      await tx.$executeRawUnsafe(`UPDATE "CanvasNode" SET "status" = 'deleted' WHERE "id" = $1`, cardId);
    }, { timeout: 20_000, maxWait: 20_000 });

    const [outcome] = await Promise.all([settleCanvasCardsForGenJob(jobId, orgId), blocker]);

    // THE WRITE WAS REACHED — this is what separates "the guard held" from "nothing was planned".
    // The settlement planned an update for THIS card and counted it as written…
    expect(outcome.status).toBe("settled");
    expect(outcome.nodeIds).toContain(cardId);
    expect(outcome.updated).toBeGreaterThanOrEqual(1);
    // …and the database changed nothing, because the row now says deleted.
    const after = await prisma.canvasNode.findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { status: true, generationId: true } });
    expect(after.status).toBe("deleted");
    expect(after.generationId).toBeNull();
    expect(canvasCardRowAdvances("deleted", "done")).toBe(false);
  }, 30_000);
});
