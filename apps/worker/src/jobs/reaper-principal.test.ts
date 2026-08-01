/**
 * #463 — reaper principal wiring.
 *
 * The seven existing reaper tests fully mock `@fikirtive/db`, so they would pass with the
 * principal pipeline entirely absent. This file mocks the BARREL but deliberately uses the
 * REAL `@fikirtive/db/principal`, then records `getPrincipal()` from inside each mocked Prisma
 * call. That is the only way to prove the two-phase shape actually holds at runtime:
 *
 *   scan segment  → kind "system", the reaper's own reason, ownerId null (cross-tenant by design)
 *   write segment → same reason, ownerId = the row's tenant
 *
 * #463 enforces nothing; this asserts only that the identity is CARRIED.
 *
 * ── WHY THE PRISMA MOCKS ARE LAZY THENABLES (substitute review P1-1) ───────────────────────────
 * A real `prisma.x.op(…)` returns a LAZY `PrismaPromise`: the query — and every `$extends` hook
 * that would read the principal — is dispatched only when `.then()` is called. So the call site
 * shape decides which frame the query lands in:
 *
 *   runAsTenant(id, () => prisma.x.op(…))            ← run() returns the thenable and POPS the
 *                                                      frame; the outer await dispatches it in
 *                                                      the ENCLOSING frame. Tenant LOST.
 *   runAsTenant(id, async () => { await prisma.x.op(…) })  ← dispatched inside. Tenant carried.
 *
 * An eager `vi.fn(async () => …)` mock resolves at CALL time, so it reports the right frame under
 * BOTH shapes and is structurally blind to that bug — which is exactly how the research-reaper
 * defect shipped past the first version of this file. `lazyThenable` below records the principal
 * at DISPATCH time, so these cases fail against the broken shape. Verified red→green by reverting
 * research.ts to the non-async arrow: "writes each row under the row's tenant" then reports
 * `ownerId: null`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPrincipal, type Principal } from "@fikirtive/db/principal";

// Recorded at call time by the mocked Prisma surface below.
const seen: Array<{ at: string; principal: Principal | undefined }> = [];
const note = (at: string) => seen.push({ at, principal: getPrincipal() });

const db = vi.hoisted(() => {
  const genJobFindMany = vi.fn();
  const genJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const chatMessageUpdateMany = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const researchJobFindMany = vi.fn();
  const researchJobUpdateMany = vi.fn();
  const publishAttemptFindMany = vi.fn();
  const publishAttemptUpdateMany = vi.fn();
  const scheduledPostFindUnique = vi.fn();
  const scheduledPostUpdateMany = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const queryRaw = vi.fn();
  const transaction = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findMany: genJobFindMany, update: vi.fn(async () => ({})), updateMany: genJobUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate, updateMany: chatMessageUpdateMany },
    creditLedger: { findFirst: creditLedgerFindFirst },
    researchJob: { findMany: researchJobFindMany, updateMany: researchJobUpdateMany },
    publishAttempt: { findMany: publishAttemptFindMany, updateMany: publishAttemptUpdateMany },
    scheduledPost: { findUnique: scheduledPostFindUnique, updateMany: scheduledPostUpdateMany },
    $transaction: transaction,
    $queryRaw: queryRaw,
  };
  return {
    prisma, genJobFindMany, genJobUpdateMany, chatMessageFindFirst, chatMessageCreate,
    chatMessageUpdateMany, creditLedgerFindFirst, researchJobFindMany, researchJobUpdateMany,
    publishAttemptFindMany, publishAttemptUpdateMany, scheduledPostFindUnique,
    scheduledPostUpdateMany, refundReservation, settleCredits, queryRaw, transaction,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: db.prisma,
  refundReservation: db.refundReservation,
  settleCredits: db.settleCredits,
  // #601: the delivery path ends by writing the job's canvas cards. Stubbed so this suite
  // exercises the tenant framing it is about, not a swallowed canvas error.
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
// import-time deps these reapers never exercise
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));

import { reapStaleGenJobs } from "./gen.js";
import { reapStaleLlmReservations } from "./llm-reservation-reaper.js";
import { reapStaleResearchJobs } from "./research.js";
import { reapStalePublishAttempts } from "./publish.js";

/**
 * A stand-in for `PrismaPromise`: it records the ambient principal when the caller DISPATCHES it
 * (`.then()`), never when the model method is called. `await`, `Promise.all` and
 * `$transaction([…])` all reach it through `then`, so this is the whole surface needed.
 */
function lazyThenable<T>(at: string, produce: () => T): PromiseLike<T> {
  return {
    then(onFulfilled, onRejected) {
      note(at); // ← DISPATCH time: this is the frame the real query would run in
      return Promise.resolve(produce()).then(onFulfilled, onRejected);
    },
  };
}

/** `vi.fn()` implementation returning a lazy thenable — the faithful Prisma model-method mock. */
const lazyImpl =
  <T>(at: string, produce: () => T) =>
  () =>
    lazyThenable(at, produce);

const at = (label: string) => seen.find((s) => s.at === label)?.principal;
const all = (label: string) => seen.filter((s) => s.at === label).map((s) => s.principal);

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  // interactive form `$transaction(cb)` AND batch form `$transaction([…])` (publish uses the batch)
  db.transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(db.prisma),
  );
  db.genJobFindMany.mockImplementation(lazyImpl("genJob.findMany", () => []));
  db.genJobUpdateMany.mockImplementation(lazyImpl("genJob.updateMany", () => ({ count: 1 })));
  db.chatMessageFindFirst.mockImplementation(lazyImpl("chatMessage.findFirst", () => ({ seq: 5 })));
  db.chatMessageCreate.mockImplementation(lazyImpl("chatMessage.create", () => ({ id: "msg1" })));
  db.chatMessageUpdateMany.mockImplementation(lazyImpl("chatMessage.updateMany", () => ({ count: 1 })));
  db.creditLedgerFindFirst.mockImplementation(() => lazyThenable("creditLedger.findFirst", () => null));
  db.refundReservation.mockImplementation(async () => { note("refundReservation"); });
  db.queryRaw.mockImplementation(lazyImpl("$queryRaw", () => []));
});

describe("reapStaleGenJobs carries a two-phase principal", () => {
  beforeEach(() => {
    // scan 1 = one stuck GENERATING job for org o1; scans 2 and 3 empty.
    let call = 0;
    db.genJobFindMany.mockImplementation(
      lazyImpl("genJob.findMany", () => {
        call += 1;
        return call === 1 ? [{ id: "g1", ownerId: "o1", threadId: "t1", kind: "IMAGE", model: "m" }] : [];
      }),
    );
  });

  it("scans under the named system identity with NO tenant", async () => {
    await reapStaleGenJobs();
    const scans = all("genJob.findMany");
    expect(scans).toHaveLength(3);
    for (const p of scans) {
      expect(p).toEqual({ kind: "system", reason: "gen-reaper", ownerId: null });
    }
  });

  it("writes under the SAME reason but scoped to the row's tenant", async () => {
    await reapStaleGenJobs();
    expect(at("genJob.updateMany")).toEqual({ kind: "system", reason: "gen-reaper", ownerId: "o1" });
    expect(at("refundReservation")).toEqual({ kind: "system", reason: "gen-reaper", ownerId: "o1" });
    // the terminal cowork message is part of the same per-row phase
    expect(at("chatMessage.create")).toEqual({ kind: "system", reason: "gen-reaper", ownerId: "o1" });
  });

  it("returns to the tenant-less scan scope after each row and leaves nothing behind", async () => {
    expect(getPrincipal()).toBeUndefined();
    await reapStaleGenJobs();
    // scans 2 and 3 run AFTER the per-row write phase — they must be tenant-less again
    expect(all("genJob.findMany").slice(1)).toEqual([
      { kind: "system", reason: "gen-reaper", ownerId: null },
      { kind: "system", reason: "gen-reaper", ownerId: null },
    ]);
    expect(getPrincipal()).toBeUndefined();
  });
});

describe("reapStaleLlmReservations carries a two-phase principal", () => {
  it("names the raw-SQL scan and re-scopes each refund to its own org", async () => {
    db.queryRaw.mockImplementation(
      lazyImpl("$queryRaw", () => [
        { orgId: "o1", refId: "otto-turn:t1:5" },
        { orgId: "o2", refId: "research:card-9" },
      ]),
    );
    await reapStaleLlmReservations();

    expect(at("$queryRaw")).toEqual({
      kind: "system",
      reason: "llm-reservation-reaper",
      ownerId: null,
    });
    expect(all("refundReservation")).toEqual([
      { kind: "system", reason: "llm-reservation-reaper", ownerId: "o1" },
      { kind: "system", reason: "llm-reservation-reaper", ownerId: "o2" },
    ]);
    expect(getPrincipal()).toBeUndefined();
  });
});

/**
 * THE regression case for substitute-review P1-1. Both per-row writes here were shipped as
 * `runAsTenant(id, () => prisma.researchJob.updateMany(…))` — a non-async arrow returning a lazy
 * PrismaPromise — so the tenant frame was popped before the query was ever dispatched. With the
 * lazy mocks above, reverting research.ts to that shape turns `researchJob.updateMany` from
 * `ownerId: "o1"/"o2"` back to `ownerId: null` and this case fails.
 */
describe("reapStaleResearchJobs carries a two-phase principal", () => {
  beforeEach(() => {
    // scan 1 = one stranded RUNNING job (org o1); scan 2 = one stale QUEUED job (org o2).
    let call = 0;
    db.researchJobFindMany.mockImplementation(
      lazyImpl("researchJob.findMany", () => {
        call += 1;
        return call === 1
          ? [{ id: "r1", ownerId: "o1", cardId: "card1" }]
          : [{ id: "r2", ownerId: "o2", cardId: "card2" }];
      }),
    );
    db.researchJobUpdateMany.mockImplementation(lazyImpl("researchJob.updateMany", () => ({ count: 1 })));
    // failResearchCard's RMW re-read
    db.chatMessageFindFirst.mockImplementation(
      lazyImpl("chatMessage.findFirst", () => ({ payload: { status: "running" } })),
    );
    // the pg-boss liveness probe: no live message, so the QUEUED row is reapable
    db.queryRaw.mockImplementation(lazyImpl("$queryRaw", () => []));
  });

  it("scans both segments under the named system identity with NO tenant", async () => {
    await reapStaleResearchJobs();
    const scans = all("researchJob.findMany");
    expect(scans).toHaveLength(2);
    for (const p of scans) {
      expect(p).toEqual({ kind: "system", reason: "research-reaper", ownerId: null });
    }
    // the pg-boss liveness check is platform state, deliberately outside any tenant frame
    expect(at("$queryRaw")).toEqual({ kind: "system", reason: "research-reaper", ownerId: null });
  });

  it("writes each row under the row's own tenant (P1-1: the write must not escape the frame)", async () => {
    await reapStaleResearchJobs();
    expect(all("researchJob.updateMany")).toEqual([
      { kind: "system", reason: "research-reaper", ownerId: "o1" }, // RUNNING → FAILED
      { kind: "system", reason: "research-reaper", ownerId: "o2" }, // QUEUED  → FAILED
    ]);
  });

  it("carries the tenant into the card write too, and leaves nothing behind", async () => {
    expect(getPrincipal()).toBeUndefined();
    const reaped = await reapStaleResearchJobs();
    expect(reaped).toBe(2);
    expect(all("chatMessage.findFirst")).toEqual([
      { kind: "system", reason: "research-reaper", ownerId: "o1" },
      { kind: "system", reason: "research-reaper", ownerId: "o2" },
    ]);
    expect(all("chatMessage.updateMany")).toEqual([
      { kind: "system", reason: "research-reaper", ownerId: "o1" },
      { kind: "system", reason: "research-reaper", ownerId: "o2" },
    ]);
    expect(getPrincipal()).toBeUndefined();
  });
});

/**
 * publish-reaper is the most fragile of the six: PublishAttempt carries NO ownerId column, so the
 * tenant is reached TRANSITIVELY through the parent post, and the frame wraps an external Meta
 * call (reconcileAttempt) as well as the CAS batch. Fixtures: a facebook attempt with no
 * creationId and no metaPostId — reconcileAttempt short-circuits to "needs_attention" with no
 * network and no query, so this case tests the frame, not Meta.
 */
describe("reapStalePublishAttempts carries a two-phase principal", () => {
  beforeEach(() => {
    db.publishAttemptFindMany.mockImplementation(
      lazyImpl("publishAttempt.findMany", () => [
        { id: "a1", scheduledPostId: "p1", creationId: null },
      ]),
    );
    db.scheduledPostFindUnique.mockImplementation(
      lazyImpl("scheduledPost.findUnique", () => ({
        ownerId: "o7",
        channel: "facebook",
        metaTargetId: null,
        metaPostId: null,
        status: "PUBLISHING",
      })),
    );
    db.publishAttemptUpdateMany.mockImplementation(lazyImpl("publishAttempt.updateMany", () => ({ count: 1 })));
    db.scheduledPostUpdateMany.mockImplementation(lazyImpl("scheduledPost.updateMany", () => ({ count: 1 })));
  });

  it("scans attempts AND resolves the parent post outside any tenant frame", async () => {
    await reapStalePublishAttempts();
    expect(at("publishAttempt.findMany")).toEqual({
      kind: "system", reason: "publish-reaper", ownerId: null,
    });
    // the parent-post lookup is what RESOLVES the tenant, so it necessarily precedes the frame
    expect(at("scheduledPost.findUnique")).toEqual({
      kind: "system", reason: "publish-reaper", ownerId: null,
    });
  });

  it("runs the CAS batch under the tenant reached transitively through the post", async () => {
    const reaped = await reapStalePublishAttempts();
    expect(reaped).toBe(1);
    // both legs of the $transaction([…]) batch — dispatched by Promise.all INSIDE the frame
    expect(at("publishAttempt.updateMany")).toEqual({
      kind: "system", reason: "publish-reaper", ownerId: "o7",
    });
    expect(at("scheduledPost.updateMany")).toEqual({
      kind: "system", reason: "publish-reaper", ownerId: "o7",
    });
    expect(getPrincipal()).toBeUndefined();
  });
});
