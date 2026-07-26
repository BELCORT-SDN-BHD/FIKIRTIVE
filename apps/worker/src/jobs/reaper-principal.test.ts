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
  const creditLedgerFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const queryRaw = vi.fn();
  const transaction = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findMany: genJobFindMany, update: vi.fn(async () => ({})), updateMany: genJobUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: transaction,
    $queryRaw: queryRaw,
  };
  return {
    prisma, genJobFindMany, genJobUpdateMany, chatMessageFindFirst, chatMessageCreate,
    creditLedgerFindFirst, refundReservation, settleCredits, queryRaw, transaction,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: db.prisma,
  refundReservation: db.refundReservation,
  settleCredits: db.settleCredits,
}));
// import-time deps these reapers never exercise
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../generation.js", () => ({ provider: { name: "mock" } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));

import { reapStaleGenJobs } from "./gen.js";
import { reapStaleLlmReservations } from "./llm-reservation-reaper.js";

const at = (label: string) => seen.find((s) => s.at === label)?.principal;
const all = (label: string) => seen.filter((s) => s.at === label).map((s) => s.principal);

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db.prisma));
  db.genJobFindMany.mockImplementation(async () => { note("genJob.findMany"); return []; });
  db.genJobUpdateMany.mockImplementation(async () => { note("genJob.updateMany"); return { count: 1 }; });
  db.chatMessageFindFirst.mockImplementation(async () => { note("chatMessage.findFirst"); return { seq: 5 }; });
  db.chatMessageCreate.mockImplementation(async () => { note("chatMessage.create"); return { id: "msg1" }; });
  db.creditLedgerFindFirst.mockResolvedValue(null);
  db.refundReservation.mockImplementation(async () => { note("refundReservation"); });
  db.queryRaw.mockImplementation(async () => { note("$queryRaw"); return []; });
});

describe("reapStaleGenJobs carries a two-phase principal", () => {
  beforeEach(() => {
    // scan 1 = one stuck GENERATING job for org o1; scans 2 and 3 empty.
    let call = 0;
    db.genJobFindMany.mockImplementation(async () => {
      note("genJob.findMany");
      call += 1;
      return call === 1 ? [{ id: "g1", ownerId: "o1", threadId: "t1", kind: "IMAGE", model: "m" }] : [];
    });
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
    db.queryRaw.mockImplementation(async () => {
      note("$queryRaw");
      return [
        { orgId: "o1", refId: "otto-turn:t1:5" },
        { orgId: "o2", refId: "research:card-9" },
      ];
    });
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
