/**
 * Canvas settlement — the server writes a delivered generation job's whole batch of cards.
 *
 * WHY (#601 / #599 D3): a merchant who started a batch and closed the tab used to come back to a
 * half-empty board, because the CARDS were placed by the browser that happened to be watching.
 * Placing them is now the last step of the job's completion path, so the board is complete the
 * moment the job is delivered — whether or not any browser is open.
 *
 * WHAT THIS IS NOT — read this before touching it:
 *   - It NEVER creates or enqueues a GenJob, never calls a generation provider, never touches the
 *     credit ledger, and never writes `spent` / `spentUsd` / `idempotencyKey` / the job's status.
 *     It is not a spend path. It runs strictly AFTER the job is terminal and its charge is
 *     settled, and its own failure leaves both untouched. It READS the idempotency key for one
 *     thing only — whether it is a server-minted `canvas:` key, which records which surface bought
 *     the job — and never derives, compares or writes a key.
 *   - It never resurrects a card the merchant deleted: tombstones are honoured by the projection,
 *     and every write happens under the same per-job advisory lock the browser-side placement
 *     takes, so the two writers converge instead of racing.
 *
 * This file is only the I/O half. WHAT should be on the board is decided by the single pure
 * projection in `@fikirtive/core` (`planCanvasSettlement`) — so a card cannot mean one thing in
 * the tab that made it and another thing after a reload.
 *
 * SCOPE (#601 T2b): the delivered (DONE) path only. Projecting failed / cancelled / timed-out
 * terminals onto a card is T2c and lands with the code that writes them.
 */
import {
  CANVAS_JOB_KEY_PATTERN,
  canvasJobOrigin,
  newId,
  planCanvasSettlement,
  type CanvasRect,
  type SettlementCard,
} from "@fikirtive/core";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./index.js";

export type CanvasSettlementOutcome = {
  /** "settled" = the board matches the job. The others are the honest reasons for doing nothing. */
  status: "settled" | "not-a-canvas-job" | "not-settled" | "nothing-to-place" | "job-missing" | "suppressed";
  /** Card ids the job owns after this run — anchor first, then siblings in batch order. */
  nodeIds: string[];
  created: number;
  updated: number;
};

type Tx = Prisma.TransactionClient;

const CARD_SELECT = {
  id: true, type: true, x: true, y: true, w: true, h: true, prompt: true,
  generationId: true, genJobId: true, status: true, sourceNodeId: true, threadId: true,
} as const;

/** Every writer for one paid job's cards shares this lock, browser-side or worker-side. */
export function canvasJobPlacementLockKey(ownerId: string, projectId: string, genJobId: string): string {
  return `canvas-job-placement:${ownerId}:${projectId}:${genJobId}`;
}

/**
 * Write every canvas card a delivered generation job owns, exactly once.
 *
 * Idempotent: run it again (a redelivery, the reaper's resume, or a browser that also placed the
 * cards) and the projection returns "keep" for everything, so nothing is written twice.
 */
export async function settleCanvasCardsForGenJob(
  genJobId: string,
  ownerId: string,
): Promise<CanvasSettlementOutcome> {
  const nothing = { nodeIds: [] as string[], created: 0, updated: 0 };
  const job = await prisma.genJob.findFirst({
    where: { id: genJobId, ownerId },
    select: {
      id: true, ownerId: true, projectId: true, threadId: true, status: true,
      kind: true, prompt: true, generationIds: true, sourceGenerationId: true,
      // READ-ONLY, and never as money: the key's SHAPE is the durable record of which surface
      // bought this job. Nothing here derives, compares or writes an idempotency key.
      idempotencyKey: true,
    },
  });
  if (!job) return { status: "job-missing", ...nothing };
  // Cheap pre-check outside the lock: an unfinished job is the common case and must not queue
  // behind another writer only to be told there is nothing to do. The projection decides this
  // again inside the transaction from the same field, so this is an optimisation, not authority.
  if (job.status !== "DONE") return { status: "not-settled", ...nothing };

  return prisma.$transaction(async (tx) => {
    // Every owner-scoped query below is pinned to the ownerId the CALLER authenticated, never to
    // the value read back off the job row. They are equal by construction (the job was found by
    // that ownerId) — using the authenticated one keeps the rule un-arguable at every line.
    const lockKey = canvasJobPlacementLockKey(ownerId, job.projectId, job.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;

    // Read the board INSIDE the lock: the job's own cards (tombstones included — deletion is a
    // durable instruction the projection must see) plus every live rectangle, so a batch nobody
    // ever placed can be given a free spot.
    const boardCards = await tx.canvasNode.findMany({
      where: { ownerId, projectId: job.projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: CARD_SELECT,
    });
    const ownCards: SettlementCard[] = boardCards
      .filter((node) => node.genJobId === job.id)
      .map((node) => ({
        id: node.id, x: node.x, y: node.y, w: node.w, h: node.h,
        prompt: node.prompt, generationId: node.generationId,
        status: node.status, sourceNodeId: node.sourceNodeId,
      }));
    const occupied: CanvasRect[] = boardCards
      .filter((node) => node.status !== "deleted")
      .map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }));

    // One lookup, used for both questions it answers: which chat the cards are attributed to, and
    // (with the job's own key) whether this job belongs on a board at all.
    const threadId = await liveThreadId(tx, ownerId, job);
    const plan = planCanvasSettlement({
      job: {
        status: job.status,
        generationIds: job.generationIds,
        kind: job.kind === "VIDEO" ? "VIDEO" : "IMAGE",
        prompt: job.prompt,
        origin: canvasJobOrigin({ idempotencyKey: job.idempotencyKey, hasLiveThread: threadId !== null }),
      },
      cards: ownCards,
      occupied,
    });
    if (plan.kind === "skip") return { status: plan.reason, ...nothing };

    const nodeIds: string[] = [];
    let created = 0;
    let updated = 0;
    // The anchor is always planned first, so by the time a sibling needs it, its id is known.
    let anchorNodeId: string | null = null;

    for (const entry of plan.cards) {
      if (entry.action === "keep") {
        nodeIds.push(entry.id);
        if (entry.role === "anchor") anchorNodeId = entry.id;
        continue;
      }
      if (entry.action === "update") {
        await tx.canvasNode.updateMany({
          where: { id: entry.id, ownerId, projectId: job.projectId },
          data: entry.patch,
        });
        nodeIds.push(entry.id);
        if (entry.role === "anchor") anchorNodeId = entry.id;
        updated += 1;
        continue;
      }
      // "Made from" is a fact of the PAID JOB, never of a neighbouring card: only the anchor of a
      // job that was conditioned on an earlier output points at that output's card. A sibling
      // points at its batch anchor, which is layout, not lineage.
      const sourceNodeId = entry.role === "anchor"
        ? await sourceCardForJob(tx, ownerId, job)
        : entry.layoutSourceNodeId ?? anchorNodeId;
      const node = await tx.canvasNode.create({
        data: {
          id: newId(),
          ownerId,
          projectId: job.projectId,
          type: entry.type,
          x: entry.x,
          y: entry.y,
          w: entry.w,
          h: entry.h,
          text: null,
          prompt: entry.prompt,
          generationId: entry.generationId,
          genJobId: job.id,
          status: "done",
          sourceNodeId,
          threadId,
        },
        select: { id: true },
      });
      nodeIds.push(node.id);
      if (entry.role === "anchor") anchorNodeId = node.id;
      created += 1;
    }

    return { status: "settled" as const, nodeIds, created, updated };
  });
}

export type CanvasSettlementBacklogJob = { id: string; ownerId: string; projectId: string };

/**
 * THE RETRY RECORD — one row per board that is still giving trouble, in the DATABASE.
 *
 * The sweep used to keep this in the worker process: a Map of "board → try again after", plus a
 * cursor into a 24-hour window. Three review rounds killed that design one symptom at a time —
 * a board could slip out of the window while it waited (#601 r4), be evicted when the book filled
 * (#601 r5), or sit behind more failing boards than one tick's share could ever reach (#601 r6).
 * They were one root cause with three faces: the to-do list was in memory while the truth was in
 * the database, so the two could disagree and a merchant's paid outputs went missing between them.
 * The Founder's ruling (2026-08-02) is this file: the sweep asks the database what to repair, and
 * the only durable thing it writes is HOW A BOARD'S REPAIR IS GOING.
 *
 * WHERE IT LIVES. The Founder's zero-migration Design A reserves `GenJob.videoOptions` key
 * `__canvasRepair` for this bookkeeping. Every other key remains paid request material;
 * `factoryMaterialMatches` ignores this key alone. A repair that works removes only the reserved
 * key and restores an originally-null value to null. A board written off keeps the record, with
 * `terminalAt`, so retirement is visible and reversible rather than silent loss.
 */
export const CANVAS_REPAIR_JSON_KEY = "__canvasRepair";
/** How long a board waits after its first failed repair; it doubles per consecutive failure. */
export const CANVAS_REPAIR_WAIT_BASE_MS = 15 * 60_000;
/** …up to this, so a board that will never write still gets a look a few times a day. */
export const CANVAS_REPAIR_WAIT_MAX_MS = 4 * 60 * 60_000;
/**
 * How many failed repairs before a board is written off — roughly three days of trying.
 *
 * Written off is NOT thrown away, and the difference is the whole point: the record stays, with
 * the attempt count, the moment it was written off and the last failure's reason, so a board that
 * stopped being swept is a row someone can find and act on. Clearing that row puts the board back
 * in the sweep. Silently dropping a merchant's paid board is what the last three rounds were about.
 */
export const CANVAS_REPAIR_MAX_ATTEMPTS = 20;

/** What one troubled board's row says. Written here and read by the scan's SQL — nowhere else. */
export type CanvasRepairRecord = {
  genJobId: string;
  /** Consecutive failed repairs, counting the one that just happened. */
  attempts: number;
  /** ISO-8601 UTC. The sweep leaves this board alone until then. */
  nextAt: string;
  /** ISO-8601 UTC once the board is written off; `null` while it is still being tried. */
  terminalAt: string | null;
  /** Why the last attempt did not finish the board — for the human who reads this row. */
  reason: string;
  /** Restores the paid material exactly when the reserved record is removed. */
  videoOptionsWasNull: boolean;
};

/** The wait after the Nth consecutive failure: doubling, capped. */
export function canvasRepairWaitMs(attempts: number): number {
  const doublings = Math.max(0, Math.floor(attempts) - 1);
  return Math.min(CANVAS_REPAIR_WAIT_BASE_MS * 2 ** doublings, CANVAS_REPAIR_WAIT_MAX_MS);
}

/** How many candidates to gather before the budget is shared out between workspaces. */
const BACKLOG_FAIRNESS_OVERSCAN = 4;

/**
 * Delivered jobs whose board is still missing something — the worklist for the worker's canvas
 * backfill sweep (apps/worker/src/jobs/canvas-backfill.ts), oldest-due first.
 *
 * READ-ONLY, and money-free by construction: it reads finished jobs, their cards, their chats and
 * their repair records, and writes nothing at all.
 *
 * WHAT MAKES A BOARD A CANDIDATE. Every clause below is the SQL twin of a rule that already exists
 * in `@fikirtive/core`, and `canvas-settlement-backlog.test.ts` pins the two against each other
 * over a matrix of board shapes so they cannot drift:
 *   - delivered and past the grace period — its own completion path is no longer running;
 *   - it belongs on a board at all (`canvasJobBelongsOnBoard`): bought from the board with a
 *     server-minted `canvas:` key, or bought in a chat that is still live, or already showing a
 *     card the merchant can see, whatever made it;
 *   - the merchant did not delete the in-flight card, which suppresses the whole job for ever;
 *   - something is actually missing (`canvasBoardNeedsSettlement`): a paid output with no card of
 *     its own, or a card that is not finished;
 *   - and its repair record either does not exist (never tried), or says the wait is over and the
 *     board has not been written off.
 *
 * GETTING THROUGH THE QUEUE — the property three review rounds were spent on. The order is "whose
 * turn has been waiting longest": a board that was never tried is due at its delivery time, a
 * board that failed is due when its wait ends, and the scan takes the earliest first. That single
 * ordering is what makes starvation impossible. A board the budget could not take this tick keeps
 * its due time, so it is at the FRONT next tick; a board that was tried is pushed behind everything
 * still due. There is no window to slip out of, no book to be evicted from, and no share of the
 * budget reserved for retries that the rest of the queue has to wait behind (#601 r4 / r5 / r6).
 *
 * WHY RAW SQL. Three of the clauses are cross-table `EXISTS` tests against `CanvasNode` and
 * `ChatThread`, which carry no foreign key to `GenJob` and so have no Prisma relation to traverse;
 * the ordering is over a value that is half a column and half a JSON field. Doing it in the
 * database is what makes the tick's cost one query plus at most a budget's worth of repairs,
 * instead of paging every finished job through the process. This is the cross-tenant half of the
 * two-phase reaper shape (#463): it selects rows from every workspace and pins nothing to one
 * owner — the CALLER re-enters as each row's own tenant to repair it. Being raw, it is also
 * outside the tenant guard's backstop, which is a documented blind spot of that guard; the owner
 * and project are carried on every joined predicate below so no workspace's rows can answer for
 * another's.
 */
export async function findCanvasSettlementBacklog(options: {
  /** This tick's clock. Everything the scan decides is measured from it, so a test can hold it. */
  now: Date;
  /** How long a just-delivered job is left to its own completion path before the sweep looks. */
  graceMs: number;
  /** Ceiling on how many boards this tick may hand back. */
  limit: number;
}): Promise<CanvasSettlementBacklogJob[]> {
  const limit = Math.max(1, Math.floor(options.limit));
  // Every moment crosses into SQL as an ISO-8601 UTC STRING with an explicit cast, never as a Date.
  // `GenJob.finishedAt` is `timestamp without time zone` holding UTC, and how a Date parameter
  // becomes one of those is the DRIVER's business — measured today: the pg adapter does send UTC,
  // so both forms agree. Spelling it out anyway costs nothing and makes the comparison legible and
  // driver-independent; a query whose grace period silently depended on the worker's own timezone
  // would be a rotten thing to have to discover from a merchant's missing cards.
  const nowIso = options.now.toISOString();
  const finishedBeforeIso = new Date(options.now.getTime() - options.graceMs).toISOString();
  // The exact shape of a server-minted Canvas key, taken from the module that mints it rather
  // than spelled again here. POSIX and JavaScript agree on every construct it uses.
  const canvasKeyPattern = CANVAS_JOB_KEY_PATTERN.source;

  const rows = await prisma.$queryRaw<CanvasSettlementBacklogJob[]>`
    SELECT j.id, j."ownerId", j."projectId"
    FROM "GenJob" j
    WHERE j.status = 'DONE'
      -- A DONE row is not proof of a paid provider call. Only settled paid outputs are repairable.
      AND j.spent = TRUE
      AND j."finishedAt" IS NOT NULL
      AND j."finishedAt" < ${finishedBeforeIso}::timestamp
      AND COALESCE(array_length(j."generationIds", 1), 0) > 0
      -- Never tried, or its wait is over and it has not been written off. A record whose payload
      -- is missing a field is read as DUE, never as absent: a malformed row must cost an extra
      -- attempt, never a merchant's board.
      AND (
        j."videoOptions" -> ${CANVAS_REPAIR_JSON_KEY} IS NULL
        OR (
          j."videoOptions" -> ${CANVAS_REPAIR_JSON_KEY} ->> 'terminalAt' IS NULL
          AND COALESCE(j."videoOptions" -> ${CANVAS_REPAIR_JSON_KEY} ->> 'nextAt', '') <= ${nowIso}
        )
      )
      -- canvasJobBelongsOnBoard: bought from the board, bought in a live chat, or already showing
      -- a card. "No card yet" is exactly the state this sweep repairs, so it never means "no board".
      AND (
        j."idempotencyKey" ~ ${canvasKeyPattern}
        OR EXISTS (
          SELECT 1 FROM "ChatThread" t
          WHERE t.id = j."threadId" AND t."ownerId" = j."ownerId"
            AND t."projectId" = j."projectId" AND t."deletedAt" IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM "CanvasNode" n
          WHERE n."ownerId" = j."ownerId" AND n."projectId" = j."projectId"
            AND n."genJobId" = j.id AND n.status <> 'deleted'
        )
      )
      -- The merchant deleted the card while the batch was still running: that was a decision about
      -- the whole job, and the projection honours it for ever.
      AND NOT EXISTS (
        SELECT 1 FROM "CanvasNode" n
        WHERE n."ownerId" = j."ownerId" AND n."projectId" = j."projectId"
          AND n."genJobId" = j.id AND n.status = 'deleted' AND n."generationId" IS NULL
      )
      -- canvasBoardNeedsSettlement. Owner, project AND job together on every card predicate:
      -- CanvasNode.genJobId carries no foreign key, so a row in another workspace — or on the
      -- merchant's other board — can name this job, and matching it loosely once retired boards
      -- that were still missing paid work (#601 r2 P1③ / r3 P2).
      AND (
        EXISTS (
          SELECT 1 FROM unnest(j."generationIds") AS paid(generation_id)
          WHERE paid.generation_id <> '' AND NOT EXISTS (
            SELECT 1 FROM "CanvasNode" n
            WHERE n."ownerId" = j."ownerId" AND n."projectId" = j."projectId"
              AND n."genJobId" = j.id AND n."generationId" = paid.generation_id
          )
        )
        OR EXISTS (
          SELECT 1 FROM "CanvasNode" n
          WHERE n."ownerId" = j."ownerId" AND n."projectId" = j."projectId"
            AND n."genJobId" = j.id AND n.status <> 'deleted'
            AND (n.status <> 'done' OR n."generationId" IS NULL)
        )
      )
    -- Whose turn has been waiting longest. Both sides are ISO-8601 UTC, which sorts chronologically
    -- as text, so a never-tried board (due when it was delivered) compares directly against a board
    -- whose wait has run out. Rendered straight from the column, which already holds UTC: going
    -- through a timestamptz would print it in the SESSION's zone and order the queue by whatever
    -- timezone the connection happened to have.
    ORDER BY COALESCE(
      j."videoOptions" -> ${CANVAS_REPAIR_JSON_KEY} ->> 'nextAt',
      to_char(j."finishedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ASC, j.id ASC
    LIMIT ${limit * BACKLOG_FAIRNESS_OVERSCAN}
  `;

  return fairShare(rows, limit);
}

/**
 * Record that a board's repair did not finish it: wait longer next time, and write it off at the
 * cap.
 *
 * This is the ONLY thing the sweep writes about a job: one reserved JSON key. No money column, no
 * job status, no ledger, no provider. It shares the settlement lock so two workers cannot lose an
 * attempt or overwrite each other's bookkeeping.
 */
export async function noteCanvasRepairFailure(
  job: CanvasSettlementBacklogJob,
  input: { now: Date; reason: string },
): Promise<CanvasRepairRecord> {
  return prisma.$transaction(async (tx) => {
    const lockKey = canvasJobPlacementLockKey(job.ownerId, job.projectId, job.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
    const current = await tx.genJob.findFirst({
      where: { id: job.id, ownerId: job.ownerId, projectId: job.projectId, status: "DONE", spent: true },
      select: { videoOptions: true },
    });
    if (!current) throw new Error(`paid DONE canvas job not found: ${job.id}`);

    const videoOptions = editableVideoOptions(current.videoOptions, job.id);
    const prior = videoOptions[CANVAS_REPAIR_JSON_KEY];
    const attempts = priorAttempts(prior) + 1;
    const record: CanvasRepairRecord = {
      genJobId: job.id,
      attempts,
      nextAt: new Date(input.now.getTime() + canvasRepairWaitMs(attempts)).toISOString(),
      terminalAt: attempts >= CANVAS_REPAIR_MAX_ATTEMPTS ? input.now.toISOString() : null,
      // Bounded: this record is a note for a human, never a log of the failure.
      reason: input.reason.slice(0, 200),
      videoOptionsWasNull: priorVideoOptionsWereNull(prior, current.videoOptions),
    };
    const updated = await tx.genJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId, projectId: job.projectId, status: "DONE", spent: true },
      data: {
        videoOptions: { ...videoOptions, [CANVAS_REPAIR_JSON_KEY]: record } as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) throw new Error(`paid DONE canvas job changed while recording repair: ${job.id}`);
    return record;
  });
}

/** The board is finished: remove only the reserved record and restore its original JSON shape. */
export async function clearCanvasRepairRecord(job: CanvasSettlementBacklogJob): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const lockKey = canvasJobPlacementLockKey(job.ownerId, job.projectId, job.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
    const current = await tx.genJob.findFirst({
      where: { id: job.id, ownerId: job.ownerId, projectId: job.projectId },
      select: { videoOptions: true },
    });
    if (!current || !isJsonObject(current.videoOptions)) return;
    const record = current.videoOptions[CANVAS_REPAIR_JSON_KEY];
    if (record === undefined) return;
    const videoOptions = { ...current.videoOptions };
    delete videoOptions[CANVAS_REPAIR_JSON_KEY];
    const restoreNull = isJsonObject(record) && record.videoOptionsWasNull === true;
    await tx.genJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId, projectId: job.projectId },
      data: {
        videoOptions: restoreNull && Object.keys(videoOptions).length === 0
          ? Prisma.DbNull
          : videoOptions as Prisma.InputJsonValue,
      },
    });
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Refuse to replace unexpected paid material with bookkeeping. */
function editableVideoOptions(value: unknown, jobId: string): Record<string, unknown> {
  if (value === null) return {};
  if (isJsonObject(value)) return { ...value };
  throw new Error(`canvas repair cannot edit non-object videoOptions: ${jobId}`);
}

function priorVideoOptionsWereNull(prior: unknown, current: unknown): boolean {
  if (isJsonObject(prior) && typeof prior.videoOptionsWasNull === "boolean") {
    return prior.videoOptionsWasNull;
  }
  return current === null;
}

/** A record written by anything other than the function above is read as "never tried". */
function priorAttempts(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const attempts = (payload as { attempts?: unknown }).attempts;
  return typeof attempts === "number" && Number.isFinite(attempts) && attempts > 0
    ? Math.floor(attempts)
    : 0;
}

/**
 * Deal the tick's budget out between workspaces, a board each per round.
 *
 * Whoever's boards were due longest ago would otherwise take the lot: this is a single global
 * queue, so one workspace's backlog of broken boards was spent out of every other workspace's
 * repair budget (#601 r3 judge P1①). Rounds keep due-order WITHIN each workspace, and a board that
 * is passed over keeps its due time — so it is at the front of the next tick, not behind anything.
 *
 * Nothing here survives the call: the rotation is over the rows this one query returned.
 */
function fairShare(
  candidates: readonly CanvasSettlementBacklogJob[],
  limit: number,
): CanvasSettlementBacklogJob[] {
  const byOwner = new Map<string, CanvasSettlementBacklogJob[]>();
  for (const job of candidates) {
    const queue = byOwner.get(job.ownerId) ?? [];
    queue.push(job);
    byOwner.set(job.ownerId, queue);
  }
  const queues = [...byOwner.values()];
  const deepest = queues.reduce((most, queue) => Math.max(most, queue.length), 0);
  const chosen: CanvasSettlementBacklogJob[] = [];
  for (let round = 0; round < deepest && chosen.length < limit; round += 1) {
    for (const queue of queues) {
      if (chosen.length === limit) break;
      const job = queue[round];
      if (job) chosen.push(job);
    }
  }
  return chosen;
}

type JobFacts = { projectId: string; threadId: string | null; sourceGenerationId: string | null };

/** The thread a card is attributed to — only when it is still live in this owner+project. A
 *  chat/canvas job has one; a storyboard/Gen-space job has none, and never sprouts a card. */
async function liveThreadId(tx: Tx, ownerId: string, job: JobFacts): Promise<string | null> {
  if (!job.threadId) return null;
  const thread = await tx.chatThread.findFirst({
    where: { id: job.threadId, ownerId, projectId: job.projectId, deletedAt: null },
    select: { id: true },
  });
  return thread?.id ?? null;
}

/** For a job made FROM an earlier output (an edit, or animating a still), that output's card. */
async function sourceCardForJob(tx: Tx, ownerId: string, job: JobFacts): Promise<string | null> {
  if (!job.sourceGenerationId) return null;
  const source = await tx.canvasNode.findFirst({
    where: { ownerId, projectId: job.projectId, generationId: job.sourceGenerationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return source?.id ?? null;
}
