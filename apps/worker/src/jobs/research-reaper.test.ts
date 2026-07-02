/**
 * research-reaper.test.ts — reapStaleResearchJobs. RESEARCH_QUEUE is retryLimit:0, so a
 * worker SIGKILL'd mid-run (e.g. a Railway deploy) after handleResearch's QUEUED→RUNNING CAS
 * is NEVER redelivered — nothing flips the ResearchJob RUNNING→FAILED nor the RESEARCH_CARD
 * payload running→failed, and the card spins "Researching…" forever (a dead card). The user's
 * CREDITS are already recovered by reapStaleLlmReservations (the `research:%` RESERVE), so this
 * reaper is a pure UX sweep: fail-close the stranded RUNNING row + flip its card → failed, with
 * a brief "interrupted" note. It is a $0 change — it NEVER calls refundReservation/settleCredits
 * (double-refunding would be a money bug); the money is handled by the reservation reaper alone.
 *
 * Mirrors reapStaleRefGenJobs: a status-guarded conditional updateMany is the at-most-once claim
 * — a run that just finished (RUNNING→DONE) flips the row out from under us → count 0 → we skip,
 * never clobbering a completed job or double-failing. All reads/writes are owner-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const researchJobFindMany = vi.fn();
  const researchJobUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageUpdateMany = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const reserveCredits = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    researchJob: { findMany: researchJobFindMany, updateMany: researchJobUpdateMany },
    chatMessage: { findFirst: chatMessageFindFirst, updateMany: chatMessageUpdateMany },
  };
  return {
    prisma, researchJobFindMany, researchJobUpdateMany, chatMessageFindFirst, chatMessageUpdateMany,
    refundReservation, settleCredits, reserveCredits,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  reserveCredits: m.reserveCredits,
}));
// import-time deps research.ts pulls in but the reaper never exercises:
vi.mock("@fikirtive/otto", () => ({
  RESEARCH_TIERS: { standard: { maxSearches: 12, maxPages: 20, maxSteps: 12 } },
  researchAgent: { name: "Researcher" },
  withLlmBudget: vi.fn(),
  OTTO_DEFAULT_MODEL: "claude-sonnet-4-6",
  run: vi.fn(),
  MaxTurnsExceededError: class extends Error {},
  mapOttoUsage: vi.fn(),
}));
vi.mock("@fikirtive/core", () => ({
  newId: vi.fn(() => "id"),
  fetchAndExtract: vi.fn(),
  tavilySearch: vi.fn(),
  braveSearch: vi.fn(),
  searchWithFallback: vi.fn(),
}));

import { reapStaleResearchJobs } from "./research.js";

const stuck = { id: "rj1", ownerId: "o1", cardId: "c1" };
const stuck2 = { id: "rj2", ownerId: "o2", cardId: "c2" };
const CARD_PAYLOAD = { researchId: "r1", topic: "EV market", goal: "pricing", tier: "standard", questions: ["who leads?"], estimatedCredits: 25, status: "running" };

beforeEach(() => {
  vi.clearAllMocks();
  m.chatMessageFindFirst.mockResolvedValue({ payload: { ...CARD_PAYLOAD } });
  m.chatMessageUpdateMany.mockResolvedValue({ count: 1 });
});

describe("reapStaleResearchJobs", () => {
  it("fail-closes a stale RUNNING job + flips its card → failed, owner-scoped, returns 1", async () => {
    m.researchJobFindMany.mockResolvedValue([stuck]);
    m.researchJobUpdateMany.mockResolvedValue({ count: 1 }); // we won the conditional claim
    const n = await reapStaleResearchJobs();
    expect(n).toBe(1);

    // job claim is guarded on status RUNNING + a stale updatedAt cutoff (never clobber a live/finished job)
    const claim = m.researchJobUpdateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ id: "rj1", ownerId: "o1", status: "RUNNING" });
    expect(claim.where.updatedAt.lt).toBeInstanceOf(Date);
    expect(claim.data.status).toBe("FAILED");
    expect(String(claim.data.error)).toMatch(/interrupted/i);

    // card payload → failed, byte-preserving every other field, owner + kind scoped
    const cardUpd = m.chatMessageUpdateMany.mock.calls[0]![0];
    expect(cardUpd.where).toMatchObject({ id: "c1", ownerId: "o1", kind: "RESEARCH_CARD" });
    expect(cardUpd.data.payload).toMatchObject({
      researchId: "r1", topic: "EV market", goal: "pricing", tier: "standard", estimatedCredits: 25,
      status: "failed",
    });
    expect(String((cardUpd.data.payload as { error?: string }).error)).toMatch(/interrupted/i);
  });

  it("does NOT flip the card when the claim is lost (a run finished first → count 0)", async () => {
    m.researchJobFindMany.mockResolvedValue([stuck]);
    m.researchJobUpdateMany.mockResolvedValue({ count: 0 }); // lost the claim — leave it alone
    const n = await reapStaleResearchJobs();
    expect(n).toBe(0);
    expect(m.chatMessageFindFirst).not.toHaveBeenCalled();
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("no-ops when nothing is stuck", async () => {
    m.researchJobFindMany.mockResolvedValue([]);
    const n = await reapStaleResearchJobs();
    expect(n).toBe(0);
    expect(m.researchJobUpdateMany).not.toHaveBeenCalled();
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("still fail-closes the job when the card row is gone (findFirst → null): no card write, still counted", async () => {
    m.researchJobFindMany.mockResolvedValue([stuck]);
    m.researchJobUpdateMany.mockResolvedValue({ count: 1 });
    m.chatMessageFindFirst.mockResolvedValue(null); // card deleted
    const n = await reapStaleResearchJobs();
    expect(n).toBe(1);
    expect(m.chatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it("counts multiple stale jobs", async () => {
    m.researchJobFindMany.mockResolvedValue([stuck, stuck2]);
    m.researchJobUpdateMany.mockResolvedValue({ count: 1 });
    const n = await reapStaleResearchJobs();
    expect(n).toBe(2);
    expect(m.chatMessageUpdateMany).toHaveBeenCalledTimes(2);
  });

  it("$ ASSERTION: never touches credits (money is handled by reapStaleLlmReservations)", async () => {
    m.researchJobFindMany.mockResolvedValue([stuck]);
    m.researchJobUpdateMany.mockResolvedValue({ count: 1 });
    await reapStaleResearchJobs();
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.reserveCredits).not.toHaveBeenCalled();
  });
});
