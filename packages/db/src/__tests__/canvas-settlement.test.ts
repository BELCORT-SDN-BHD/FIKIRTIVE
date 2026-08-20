/**
 * #601 T2b — settling a delivered job's canvas cards against a REAL database.
 *
 * The merchant behaviour under test: start a batch, close the tab, come back later and find every
 * paid output on the board. No browser participates in any of these cases — the only writer is
 * the completion path the worker runs.
 *
 * Division of labour with `packages/core/src/canvas-settlement-plan.test.ts`: the projection there
 * owns the state space (how many cards, which status, which batch slot) and needs no database.
 * This file owns what only a database can show — that the lock, the tombstone read, the thread and
 * source-card lookups and the writes themselves are wired to that projection correctly. Each case
 * here costs a full-schema TRUNCATE, so cases that a pure test can carry belong over there.
 *
 * Money is deliberately part of the assertions: the job's spend columns and the credit ledger are
 * snapshotted before settlement and compared after, so a future edit that quietly gives this path
 * a money side effect fails here rather than in production.
 *
 * SCOPE: the delivered (DONE) path. Failed / cancelled / timed-out terminals are T2c — pinned
 * below as "left alone", so this slice cannot half-project them.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { CANVAS_JOB_KEY_PREFIX } from "@fikirtive/core";
import { prisma } from "../index.js";
import {
  CANVAS_SETTLEMENT_DEFAULT_LOCK_TIMEOUT_MS,
  CANVAS_SETTLEMENT_DEFAULT_STATEMENT_TIMEOUT_MS,
  CANVAS_SETTLEMENT_LOCK_TIMEOUT_MS,
  canvasJobPlacementLockKey,
  canvasRepairLockKey,
  clearCanvasRepairRecord,
  noteCanvasRepairFailure,
  settleCanvasCardsForGenJob,
} from "../canvas-settlement.js";
import { seedOrg } from "../../test/setup.js";

const CARD = { w: 320, h: 320 };
const TEST_BACKFILL_TIMEOUTS = {
  statementTimeoutMs: 250,
  advisoryLockTimeoutMs: CANVAS_SETTLEMENT_LOCK_TIMEOUT_MS,
  transactionMaxWaitMs: 500,
  transactionTimeoutMs: 1_000,
} as const;

let orgId: string;
let projectId: string;

// Pay the pool + query-engine start-up here rather than inside the first timed hook. The shared
// per-test TRUNCATE already takes seconds on a full schema; adding a cold connect on top of it
// tips the first test past vitest's hook limit for reasons unrelated to what it checks.
beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Settlement board" } });
});

// CanvasNode has no organization FK, so the suite-wide TRUNCATE does not reach it. Clear this
// workspace's cards ourselves rather than leaving orphans behind in a shared local test DB.
afterEach(async () => {
  if (!orgId) return;
  await prisma.canvasNode.deleteMany({ where: { ownerId: orgId } });
});

async function seedThread(): Promise<string> {
  const id = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id, ownerId: orgId, projectId, title: "Otto" } });
  return id;
}

/** One paid output: an Asset + the Generation row the worker's commit transaction writes. */
async function seedGeneration(): Promise<string> {
  const contentHash = randomUUID().replace(/-/g, "").repeat(2);
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgId, contentHash, ext: "png",
      mime: "image/png", sizeBytes: BigInt(64), source: "GENERATED",
    },
  });
  const generation = await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgId, projectId, assetId: asset.id,
      source: "GENERATED", entitySnapshot: {},
    },
  });
  return generation.id;
}

async function seedJob(input: {
  status: "DONE" | "FAILED" | "GENERATING";
  outputs?: number;
  threadId?: string | null;
  kind?: "IMAGE" | "VIDEO";
  sourceGenerationId?: string | null;
  /** The server-minted key. A `canvas:` one is the durable proof the Canvas UI bought this job. */
  idempotencyKey?: string | null;
  finishedAt?: Date | null;
}): Promise<{ jobId: string; generationIds: string[] }> {
  const generationIds: string[] = [];
  for (let i = 0; i < (input.outputs ?? 0); i += 1) generationIds.push(await seedGeneration());
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "a cup steaming",
      kind: input.kind ?? "IMAGE", model: "seedream", count: Math.max(1, input.outputs ?? 1),
      status: input.status, generationIds,
      threadId: input.threadId ?? null,
      sourceGenerationId: input.sourceGenerationId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      spent: input.status === "DONE", spentUsd: input.status === "DONE" ? 0.12 : null,
      startedAt: new Date(),
      finishedAt: input.status === "GENERATING"
        ? null
        : input.finishedAt ?? new Date(),
    },
  });
  return { jobId, generationIds };
}

/** A key of the shape startCanvasGen mints server-side for a Canvas press. */
function canvasKey(): string {
  return `${CANVAS_JOB_KEY_PREFIX}${randomUUID().replace(/-/g, "").repeat(2)}`;
}

async function seedCard(input: {
  jobId: string | null;
  x: number;
  y: number;
  status?: string;
  generationId?: string | null;
}): Promise<string> {
  const id = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id, ownerId: orgId, projectId, type: "image", x: input.x, y: input.y, w: CARD.w, h: CARD.h,
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
    select: {
      id: true, x: true, y: true, status: true, generationId: true, threadId: true, type: true,
      batchIndex: true, batchSize: true, layoutAnchorNodeId: true, madeFromNodeId: true,
    },
  });
}

/** Everything about this job that a money reviewer cares about, plus the workspace's balance. */
async function moneySnapshot(jobId: string) {
  const job = await prisma.genJob.findFirstOrThrow({
    where: { id: jobId, ownerId: orgId },
    select: { status: true, spent: true, spentUsd: true, generationIds: true, idempotencyKey: true, finishedAt: true },
  });
  const ledger = await prisma.creditLedger.findMany({
    where: { orgId, refId: jobId },
    orderBy: { id: "asc" },
    select: { kind: true, balanceDelta: true, reservedDelta: true },
  });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { job, ledger, account };
}

describe("coming back to a board nobody was watching", () => {
  it("writes the whole batch when the tab closed right after the merchant pressed Make", async () => {
    const { jobId, generationIds } = await seedJob({ status: "DONE", outputs: 4 });
    // The browser placed the in-flight card and then went away: nothing else was ever written.
    const anchorId = await seedCard({ jobId, x: 100, y: 50, status: "pending" });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("settled");
    expect(outcome.created).toBe(3);
    const cards = await cardsForJob(jobId);
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => [card.x, card.y])).toEqual([[100, 50], [440, 50], [100, 390], [440, 390]]);
    expect(cards.map((card) => card.status)).toEqual(["done", "done", "done", "done"]);
    expect(cards.map((card) => card.generationId)).toEqual(generationIds);
    expect(cards[0]!.id).toBe(anchorId);
    // BATCH IDENTITY IS WRITTEN DOWN (#603 T4). Every card of the press records where it sits and
    // how many the press made, so nothing downstream has to sort by coordinate or count rows.
    expect(cards.map((card) => card.batchIndex)).toEqual([0, 1, 2, 3]);
    expect(cards.map((card) => card.batchSize)).toEqual([4, 4, 4, 4]);
    // Siblings hang off the batch ANCHOR — for layout, in a column that means only that…
    expect(cards.slice(1).map((card) => card.layoutAnchorNodeId)).toEqual([anchorId, anchorId, anchorId]);
    // …and NONE of them claims the anchor made it. One press, four siblings, no parents.
    expect(cards.every((card) => card.madeFromNodeId === null)).toBe(true);
  });

  it("keeps the batch size the merchant BOUGHT after they delete some of it", async () => {
    const { jobId, generationIds } = await seedJob({ status: "DONE", outputs: 4 });
    const anchorId = await seedCard({ jobId, x: 100, y: 50, status: "pending" });
    await settleCanvasCardsForGenJob(jobId, orgId);

    // The merchant removes two of the four. Deleting is a durable instruction, so the rows stay
    // as tombstones — and the survivors keep the batch they were born into.
    const placed = await cardsForJob(jobId);
    for (const card of placed.filter((c) => c.generationId === generationIds[1] || c.generationId === generationIds[3])) {
      await prisma.canvasNode.updateMany({ where: { id: card.id, ownerId: orgId }, data: { status: "deleted" } });
    }
    await settleCanvasCardsForGenJob(jobId, orgId);

    const survivors = (await cardsForJob(jobId)).filter((card) => card.status !== "deleted");
    expect(survivors.map((card) => card.batchIndex)).toEqual([0, 2]);
    expect(survivors.map((card) => card.batchSize)).toEqual([4, 4]);
    expect(survivors[0]!.id).toBe(anchorId);
  });

  it("brings a card settled before these facts existed up to date, then writes nothing more", async () => {
    // A row from before the migration: it carries its output but knows nothing about its batch.
    const { jobId, generationIds } = await seedJob({ status: "DONE", outputs: 2 });
    const anchorId = await seedCard({ jobId, x: 100, y: 50, status: "done", generationId: generationIds[0] });
    const siblingId = await seedCard({ jobId, x: 440, y: 50, status: "done", generationId: generationIds[1] });

    const first = await settleCanvasCardsForGenJob(jobId, orgId);
    expect(first.updated).toBe(2);
    const cards = await cardsForJob(jobId);
    expect(cards.map((card) => [card.batchIndex, card.batchSize])).toEqual([[0, 2], [1, 2]]);
    expect(cards.map((card) => card.layoutAnchorNodeId)).toEqual([null, anchorId]);
    expect(siblingId).toBe(cards[1]!.id);

    // Idempotent by shape: a board that already says the right thing is written to zero times.
    const second = await settleCanvasCardsForGenJob(jobId, orgId);
    expect(second).toMatchObject({ status: "settled", created: 0, updated: 0 });
  });

  it("creates the cards too when no browser ever opened the board — clear of existing work, attributed, and linked to what they were made from", async () => {
    const threadId = await seedThread();
    const sourceGenerationId = await seedGeneration();
    const sourceCardId = await seedCard({ jobId: null, x: 80, y: 80, status: "done", generationId: sourceGenerationId });
    const { jobId, generationIds } = await seedJob({ status: "DONE", outputs: 2, threadId, sourceGenerationId });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("settled");
    expect(outcome.created).toBe(2);
    const cards = await cardsForJob(jobId);
    expect(cards.map((card) => card.generationId)).toEqual(generationIds);
    expect(cards.every((card) => card.status === "done")).toBe(true);
    // Attributed to the chat that asked for it…
    expect(cards.every((card) => card.threadId === threadId)).toBe(true);
    // …linked to the card it was made from — a fact of the paid JOB, so EVERY card of the batch
    // carries it, while the sibling's arrangement stays in its own column…
    expect(cards.every((card) => card.madeFromNodeId === sourceCardId)).toBe(true);
    expect(cards.map((card) => card.layoutAnchorNodeId)).toEqual([null, cards[0]!.id]);
    // …and clear of the card that was already on the board.
    expect(cards.map((card) => [card.x, card.y])).not.toContainEqual([80, 80]);
  });
});

describe("a board bought without ever opening a chat", () => {
  // The Canvas promptbar does not need a thread: a merchant can press Make on a bare board. The
  // job's own server-minted `canvas:` key says so — nothing on the board has to be inspected.
  it("writes the batch for a canvas job with no chat and no card at all", async () => {
    const { jobId, generationIds } = await seedJob({
      status: "DONE", outputs: 2, threadId: null, idempotencyKey: canvasKey(),
    });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("settled");
    expect(outcome.created).toBe(2);
    const cards = await cardsForJob(jobId);
    expect(cards.map((card) => card.generationId)).toEqual(generationIds);
    expect(cards.every((card) => card.status === "done")).toBe(true);
  });

  it("still places the surviving output when the first card was deleted and there is no chat", async () => {
    const { jobId, generationIds } = await seedJob({
      status: "DONE", outputs: 2, threadId: null, idempotencyKey: canvasKey(),
    });
    // The merchant deleted the first output's card. That is an instruction about THAT output —
    // the second one is paid for and must still arrive.
    await seedCard({ jobId, x: 0, y: 0, status: "deleted", generationId: generationIds[0] });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("settled");
    const live = (await cardsForJob(jobId)).filter((card) => card.status !== "deleted");
    expect(live.map((card) => card.generationId)).toEqual([generationIds[1]]);
  });

  it("still leaves a storyboard job alone — it has no board, no chat and no key", async () => {
    const { jobId } = await seedJob({ status: "DONE", outputs: 2, threadId: null, idempotencyKey: null });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("not-a-canvas-job");
    expect(await cardsForJob(jobId)).toHaveLength(0);
  });
});

/**
 * ONE LOCK KEY, AND IT MUST STILL BE THE OLD ONE.
 *
 * `canvasJobPlacementLockKey` was defined twice — here and, byte for byte, in
 * `apps/web/lib/canvas-node-placement.ts` — and the second copy has been deleted in favour of this
 * one. That collapse is only safe if the surviving function produces EXACTLY what the deleted one
 * produced: this key is what makes the worker's settlement and the browser's placement take turns
 * over one paid job's cards, and a key that shifts by a single character means both writers run at
 * once and one paid picture lands on two cards.
 *
 * So the deleted body is written out again below and the two are compared over inputs that could
 * plausibly tell them apart — including ids carrying the separator itself, which is where a naive
 * "join with colons" rewrite would first diverge. This is a pure string comparison; it takes no
 * lock and touches no row.
 */
describe("one lock key: the surviving derivation equals the copy that was removed", () => {
  /** Verbatim body of the copy deleted from apps/web/lib/canvas-node-placement.ts. */
  const removedWebCopy = (ownerId: string, projectId: string, genJobId: string): string =>
    `canvas-job-placement:${ownerId}:${projectId}:${genJobId}`;

  const cases: Array<[string, string, string]> = [
    ["owner-1", "project-1", "job-1"],
    ["org_01HTEST", "prj_01HTEST", "gj_01HTEST"],
    // A separator inside an id: the two must agree on this too, or a future "tidier" rewrite
    // (splitting, escaping, re-joining) would look equivalent on ordinary ids and not be.
    ["owner:1", "project:1", "job:1"],
    ["", "", ""],
    ["商家-1", "项目-1", "任务-1"],
  ];

  it.each(cases)("derives the same key for (%s, %s, %s)", (ownerId, projectId, genJobId) => {
    expect(canvasJobPlacementLockKey(ownerId, projectId, genJobId))
      .toBe(removedWebCopy(ownerId, projectId, genJobId));
  });
});

describe("what it must refuse to do", () => {
  it("runs twice without duplicating a single card", async () => {
    const { jobId } = await seedJob({ status: "DONE", outputs: 3 });
    await seedCard({ jobId, x: 0, y: 0, status: "pending" });

    const first = await settleCanvasCardsForGenJob(jobId, orgId);
    const second = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(first.created).toBe(2);
    expect(second).toMatchObject({ status: "settled", created: 0, updated: 0 });
    expect(await cardsForJob(jobId)).toHaveLength(3);

    // Two writers place a job's cards: this one and the browser-side placement in
    // apps/web/lib/canvas-node-placement.ts. They only take turns if they ask for the SAME lock.
    // That file used to derive the key with its own hand-written copy of this function; it now
    // imports this one, and the byte-for-byte equality of the two derivations is pinned in the
    // "one lock key" block below. This case keeps the shape pinned where the settlement itself is.
    expect(canvasJobPlacementLockKey("owner-1", "project-1", "job-1"))
      .toBe("canvas-job-placement:owner-1:project-1:job-1");
  });

  it("does not bring back a batch the merchant deleted while it was still running", async () => {
    const { jobId } = await seedJob({ status: "DONE", outputs: 4 });
    // Deleting the in-flight card is a job-wide instruction: none of its outputs may return.
    await seedCard({ jobId, x: 0, y: 0, status: "deleted", generationId: null });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("suppressed");
    expect((await cardsForJob(jobId)).filter((card) => card.status !== "deleted")).toHaveLength(0);
  });

  // A job still in flight decides nothing about its cards; a job that has ENDED settles them to
  // that one ending (#612 T2c). Which status means which is settled exhaustively in the
  // projection's own suite; here it is the shell's early return that is under test.
  it("leaves a running job's card alone", async () => {
    const { jobId } = await seedJob({ status: "GENERATING", outputs: 0 });
    await seedCard({ jobId, x: 0, y: 0, status: "pending" });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome.status).toBe("not-settled");
    const cards = await cardsForJob(jobId);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe("pending");
  });

  it("settles a failed job's waiting card to that one ending, and only once", async () => {
    const { jobId } = await seedJob({ status: "FAILED", outputs: 0 });
    await seedCard({ jobId, x: 0, y: 0, status: "pending" });

    const first = await settleCanvasCardsForGenJob(jobId, orgId);
    const second = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(first).toMatchObject({ status: "settled", created: 0, updated: 1 });
    expect(second).toMatchObject({ status: "settled", created: 0, updated: 0 });
    const cards = await cardsForJob(jobId);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe("failed");
    expect(cards[0]!.generationId).toBeNull();
  });

  it("cannot take a paid output off a card, whatever the job's row now says", async () => {
    const { jobId, generationIds } = await seedJob({ status: "DONE", outputs: 2 });
    await seedCard({ jobId, x: 0, y: 0, status: "pending" });
    await settleCanvasCardsForGenJob(jobId, orgId);
    const delivered = await cardsForJob(jobId);
    await prisma.genJob.update({ where: { id: jobId, ownerId: orgId }, data: { status: "FAILED" } });

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);

    expect(outcome).toMatchObject({ status: "nothing-to-place", created: 0, updated: 0 });
    expect(await cardsForJob(jobId)).toEqual(delivered);
    expect(delivered.map((card) => card.generationId).sort()).toEqual([...generationIds].sort());
  });

  it("refuses a job that belongs to another workspace", async () => {
    const otherOrg = `org_${randomUUID()}`;
    await seedOrg(otherOrg, 1_000);
    const { jobId } = await seedJob({ status: "DONE", outputs: 2 });
    await seedCard({ jobId, x: 0, y: 0, status: "pending" });

    const outcome = await settleCanvasCardsForGenJob(jobId, otherOrg);

    expect(outcome.status).toBe("job-missing");
    expect((await cardsForJob(jobId)).every((card) => card.status === "pending")).toBe(true);
  });
});

describe("money stays exactly where it was", () => {
  it("changes no spend column, no ledger row and no balance", async () => {
    const threadId = await seedThread();
    const { jobId } = await seedJob({ status: "DONE", outputs: 4, threadId });
    const before = await moneySnapshot(jobId);

    const outcome = await settleCanvasCardsForGenJob(jobId, orgId);
    await settleCanvasCardsForGenJob(jobId, orgId); // a redelivery runs it again

    expect(outcome.status).toBe("settled");
    expect(await cardsForJob(jobId)).toHaveLength(4);
    expect(await moneySnapshot(jobId)).toEqual(before);
  });
});

describe("a contended board cannot hold the maintenance worker", () => {
  it("bounds the placement-lock wait for settlement without blocking its failure note or cleanup", async () => {
    const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("test database URL is required");
    const { jobId } = await seedJob({
      status: "DONE",
      outputs: 1,
      idempotencyKey: canvasKey(),
    });
    const board = { id: jobId, ownerId: orgId, projectId };
    const lockKey = canvasJobPlacementLockKey(orgId, projectId, jobId);
    const blocker = new Client({ connectionString });
    await blocker.connect();
    await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0::bigint))", [lockKey]);
    // A failed implementation still gives the suite its connection back instead of hanging.
    let fallbackRelease: Promise<unknown> | undefined;
    const release = setTimeout(() => {
      fallbackRelease = blocker.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))",
        [lockKey],
      );
    }, 2_500);

    try {
      const startedAt = Date.now();
      await expect(
        settleCanvasCardsForGenJob(jobId, orgId, TEST_BACKFILL_TIMEOUTS),
      ).rejects.toThrow(/lock timeout|canceling statement/i);
      expect(Date.now() - startedAt).toBeLessThan(CANVAS_SETTLEMENT_LOCK_TIMEOUT_MS + 1_000);

      await expect(noteCanvasRepairFailure(
        board,
        { now: new Date(), reason: "board write failed" },
        TEST_BACKFILL_TIMEOUTS,
      )).resolves.toMatchObject({ genJobId: jobId, attempts: 1 });
      await expect(clearCanvasRepairRecord(board, TEST_BACKFILL_TIMEOUTS)).resolves.toBeUndefined();
    } finally {
      clearTimeout(release);
      if (fallbackRelease) await fallbackRelease.catch(() => undefined);
      else {
        await blocker
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))", [lockKey])
          .catch(() => undefined);
      }
      await blocker.end();
    }
  }, 10_000);

  it("bounds the dedicated repair-lock wait for failure notes and cleanup", async () => {
    const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("test database URL is required");
    const { jobId } = await seedJob({
      status: "DONE",
      outputs: 1,
      idempotencyKey: canvasKey(),
    });
    const board = { id: jobId, ownerId: orgId, projectId };
    const lockKey = canvasRepairLockKey(orgId, projectId, jobId);
    const blocker = new Client({ connectionString });
    await blocker.connect();
    await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0::bigint))", [lockKey]);
    let fallbackRelease: Promise<unknown> | undefined;
    const release = setTimeout(() => {
      fallbackRelease = blocker.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))",
        [lockKey],
      );
    }, 2_500);

    try {
      for (const operation of [
        () => noteCanvasRepairFailure(
          board,
          { now: new Date(), reason: "board write failed" },
          TEST_BACKFILL_TIMEOUTS,
        ),
        () => clearCanvasRepairRecord(board, TEST_BACKFILL_TIMEOUTS),
      ]) {
        const startedAt = Date.now();
        await expect(operation()).rejects.toThrow(/lock timeout|canceling statement/i);
        expect(Date.now() - startedAt).toBeLessThan(CANVAS_SETTLEMENT_LOCK_TIMEOUT_MS + 1_000);
      }
    } finally {
      clearTimeout(release);
      if (fallbackRelease) await fallbackRelease.catch(() => undefined);
      else {
        await blocker
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))", [lockKey])
          .catch(() => undefined);
      }
      await blocker.end();
    }
  }, 10_000);

  it("bounds the wait for a merchant opening a board, without being asked to", async () => {
    // The retry worker names its own tight bounds. Everybody ELSE — the delivery path, and the
    // merchant whose browser opens a board and reconciles it — used to name none, which meant no
    // DB-side bound at all: the wait for a contended board ended when the client-side transaction
    // gave up, with the blocked statement still sitting in the database (#611 OPUS5 P2). A board is
    // the merchant's home; it must come back quickly even when it comes back unfinished, and the
    // sweep repairs what this call could not.
    const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("test database URL is required");
    const { jobId } = await seedJob({ status: "DONE", outputs: 1, idempotencyKey: canvasKey() });
    const lockKey = canvasJobPlacementLockKey(orgId, projectId, jobId);
    const blocker = new Client({ connectionString });
    await blocker.connect();
    await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0::bigint))", [lockKey]);
    // Held well past every client-side patience this call has, so a pass cannot come from the
    // blocker letting go: only a bound the settlement itself set can end the wait in time.
    let fallbackRelease: Promise<unknown> | undefined;
    const release = setTimeout(() => {
      fallbackRelease = blocker.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))",
        [lockKey],
      );
    }, 12_000);

    try {
      const startedAt = Date.now();
      // Two arguments: the ordinary call every non-retry caller makes.
      await expect(settleCanvasCardsForGenJob(jobId, orgId))
        .rejects.toThrow(/lock timeout|canceling statement/i);
      expect(Date.now() - startedAt)
        .toBeLessThan(CANVAS_SETTLEMENT_DEFAULT_LOCK_TIMEOUT_MS + 1_000);
    } finally {
      clearTimeout(release);
      if (fallbackRelease) await fallbackRelease.catch(() => undefined);
      else {
        await blocker
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))", [lockKey])
          .catch(() => undefined);
      }
      await blocker.end();
    }
  }, 20_000);

  it("bounds the repair bookkeeping's own wait by default too", async () => {
    const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("test database URL is required");
    const { jobId } = await seedJob({ status: "DONE", outputs: 1, idempotencyKey: canvasKey() });
    const board = { id: jobId, ownerId: orgId, projectId };
    const lockKey = canvasRepairLockKey(orgId, projectId, jobId);
    const blocker = new Client({ connectionString });
    await blocker.connect();
    await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0::bigint))", [lockKey]);
    let fallbackRelease: Promise<unknown> | undefined;
    const release = setTimeout(() => {
      fallbackRelease = blocker.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))",
        [lockKey],
      );
    }, 12_000);

    try {
      for (const operation of [
        () => noteCanvasRepairFailure(board, { now: new Date(), reason: "board write failed" }),
        () => clearCanvasRepairRecord(board),
      ]) {
        const startedAt = Date.now();
        await expect(operation()).rejects.toThrow(/lock timeout|canceling statement/i);
        expect(Date.now() - startedAt)
          .toBeLessThan(CANVAS_SETTLEMENT_DEFAULT_LOCK_TIMEOUT_MS + 1_000);
      }
    } finally {
      clearTimeout(release);
      if (fallbackRelease) await fallbackRelease.catch(() => undefined);
      else {
        await blocker
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))", [lockKey])
          .catch(() => undefined);
      }
      await blocker.end();
    }
  }, 30_000);

  it("bounds an ordinary caller's pre-read when the job table itself is blocked", async () => {
    const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("test database URL is required");
    const { jobId } = await seedJob({ status: "DONE", outputs: 1, idempotencyKey: canvasKey() });
    const blocker = new Client({ connectionString });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query('LOCK TABLE "GenJob" IN ACCESS EXCLUSIVE MODE');
    let fallbackRelease: Promise<unknown> | undefined;
    const release = setTimeout(() => {
      fallbackRelease = blocker.query("ROLLBACK");
    }, 12_000);
    const startedAt = Date.now();

    try {
      await expect(settleCanvasCardsForGenJob(jobId, orgId))
        .rejects.toThrow(/lock timeout|statement timeout|canceling statement/i);
      expect(Date.now() - startedAt)
        .toBeLessThan(CANVAS_SETTLEMENT_DEFAULT_STATEMENT_TIMEOUT_MS + 1_000);
    } finally {
      clearTimeout(release);
      if (fallbackRelease) await fallbackRelease.catch(() => undefined);
      else await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
    }
  }, 20_000);

  it("bounds the job pre-read before a backfill settlement reaches its board lock", async () => {
    const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("test database URL is required");
    const { jobId } = await seedJob({
      status: "DONE",
      outputs: 1,
      idempotencyKey: canvasKey(),
    });
    const blocker = new Client({ connectionString });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query('LOCK TABLE "GenJob" IN ACCESS EXCLUSIVE MODE');
    let fallbackRelease: Promise<unknown> | undefined;
    const release = setTimeout(() => {
      fallbackRelease = blocker.query("ROLLBACK");
    }, 1_500);
    const startedAt = Date.now();

    try {
      await expect(
        settleCanvasCardsForGenJob(jobId, orgId, TEST_BACKFILL_TIMEOUTS),
      ).rejects.toThrow(/statement timeout|canceling statement/i);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      clearTimeout(release);
      if (fallbackRelease) await fallbackRelease.catch(() => undefined);
      else await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
    }
  }, 10_000);
});
