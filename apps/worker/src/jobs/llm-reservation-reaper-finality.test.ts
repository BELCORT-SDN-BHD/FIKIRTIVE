/**
 * #524 r8 (judge r7 P1) — "refund the leak, then fix the card" as a DECIDABLE terminal protocol,
 * proven against the real ledger.
 *
 * Every other test around this reaper mocks `@fikirtive/db`, which is right when the claim is
 * about control flow. The claims here are not: they are about which of two finalizers won a race
 * that a database unique index decides, and about a sweep that has to converge over TWO ticks.
 * A mocked `refundReservation` can be told to answer anything, so it can prove neither. This file
 * uses the real client, the real `CreditLedger_finalizer_once` index, and real approval cards.
 *
 * The one seam: `$queryRaw` can be stubbed for a single case, so the reaper works from the scan
 * snapshot it took a moment BEFORE a concurrent settle committed. That is the interleave itself —
 * every other moving part (the refund, the finalizer index, the card CAS) stays real.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Same guard as apps/web's suite: never run this against a database that is not a test database.
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (process.env.DATABASE_URL && !dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

/** Set by a test to answer ONE scan from a snapshot; `null` from it = run the real query. */
let scanStub: ((sql: string) => unknown[] | null) | null = null;

// The real db module with ONE property intercepted. A Proxy rather than `vi.spyOn` because the
// Prisma client's own members are not ordinary writable properties.
vi.mock("@fikirtive/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fikirtive/db")>();
  const real = actual.prisma;
  const prisma = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "$queryRaw" && typeof value === "function") {
        return (strings: TemplateStringsArray, ...values: unknown[]) => {
          const stubbed = scanStub?.(Array.from(strings).join("?")) ?? null;
          return stubbed ?? (value as (...a: unknown[]) => unknown).call(target, strings, ...values);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...actual, prisma };
});

const { prisma } = await import("@fikirtive/db");
const { reapStaleLlmReservations } = await import("./llm-reservation-reaper.js");

const HOUR = 1000 * 60 * 60;
const HOLD = 40; // internal credits held by the leaked reservation
const START = 1000; // starting balance
/** Written by the reaper onto its own REFUND rows; pass 2 keys on it. */
const REAPER_REASON = "llm-reservation-reaper";

const orgIds: string[] = [];

/** One org with a live thread and one `approved` approval card, plus the refId of its hold. */
async function seedApprovedAction(): Promise<{ orgId: string; cardId: string; refId: string }> {
  const orgId = `p524r8-${randomUUID()}`;
  const threadId = `t-${randomUUID()}`;
  const cardId = `c-${randomUUID()}`;
  orgIds.push(orgId);
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START - HOLD, reserved: HOLD } });
  await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId: `pr-${randomUUID()}` } });
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId,
      ownerId: orgId,
      role: "AGENT",
      kind: "APPROVAL_CARD",
      seq: 1,
      payload: { toolName: "generateReferences", ref: "e1", status: "approved", attempt: 1 },
    },
  });
  return { orgId, cardId, refId: `otto-approve:${threadId}:${cardId}:a1` };
}

/** The RESERVE row a crash left behind: old enough for the sweep, with no finalizer. */
async function seedStaleHold(orgId: string, refId: string, ageMs = 3 * HOUR): Promise<void> {
  await prisma.creditLedger.create({
    data: {
      id: randomUUID(),
      orgId,
      balanceDelta: -HOLD,
      reservedDelta: HOLD,
      kind: "RESERVE",
      source: "SYSTEM",
      refId,
      idempotencyKey: `reserve:${refId}`,
      createdAt: new Date(Date.now() - ageMs),
    },
  });
}

/** A finalizer written by somebody other than this reaper's current tick. */
async function seedFinalizer(
  orgId: string,
  refId: string,
  kind: "SETTLE" | "REFUND",
  reason = "",
): Promise<void> {
  const amount = kind === "SETTLE" ? 0 : HOLD;
  await prisma.creditLedger.create({
    data: {
      id: randomUUID(),
      orgId,
      balanceDelta: amount,
      reservedDelta: -HOLD,
      kind,
      source: "SYSTEM",
      reason,
      refId,
      idempotencyKey: `${kind === "SETTLE" ? "settle" : "refund"}:${refId}`,
    },
  });
  await prisma.creditAccount.update({
    where: { orgId },
    data: { balance: { increment: amount }, reserved: { decrement: HOLD } },
  });
}

const cardStatus = (orgId: string, cardId: string) =>
  prisma.chatMessage
    .findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { payload: true } })
    .then((row) => row.payload as { status?: string; chargeVerdict?: string });

const ledgerRows = (orgId: string) =>
  prisma.creditLedger.findMany({
    where: { orgId },
    select: { kind: true, reason: true },
    orderBy: { createdAt: "asc" },
  });

beforeEach(() => {
  scanStub = null;
});

afterAll(async () => {
  // Orgs cascade to CreditLedger; threads and cards are removed explicitly (RESTRICT).
  await prisma.chatMessage.deleteMany({ where: { ownerId: { in: orgIds } } });
  await prisma.chatThread.deleteMany({ where: { ownerId: { in: orgIds } } });
  await prisma.creditAccount.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("#524 r8 — a settle that lands after the scan is a SUCCESS, not a leak", () => {
  it("never fails the card of a run that committed between the scan and the refund", async () => {
    const { orgId, cardId, refId } = await seedApprovedAction();
    await seedStaleHold(orgId, refId);

    // The scan runs (the reservation really has no finalizer at this instant), and only then does
    // the execution everybody assumed was dead commit its SETTLE. The reaper is now holding a
    // snapshot that is one statement out of date — exactly the shape the judge described.
    const snapshot = [{ orgId, refId }];
    await seedFinalizer(orgId, refId, "SETTLE");
    scanStub = (sql) => (sql.includes("NOT EXISTS") ? snapshot : null);

    const reaped = await reapStaleLlmReservations();

    // THE assertion: the card still says what is true. r7 CAS'd this one to `failed` and showed
    // the merchant their finished work as a failure.
    expect((await cardStatus(orgId, cardId)).status).toBe("approved");
    // The refund no-ops on the finalizer index — the merchant stays charged for work they got.
    expect(await ledgerRows(orgId)).toEqual([
      { kind: "RESERVE", reason: "" },
      { kind: "SETTLE", reason: "" },
    ]);
    expect(reaped).toBe(0);
  });
});

describe("#524 r8 — a refund whose card write never landed heals on the next tick", () => {
  it("retires the orphaned card on a later pass, without refunding twice", async () => {
    const { orgId, cardId, refId } = await seedApprovedAction();
    await seedStaleHold(orgId, refId);
    // The state a crash between the refund and the card write leaves behind: our REFUND is
    // committed (so the first pass's NOT EXISTS filter will never look at this row again) and the
    // card is still reading `approved` over a run that never happened.
    await seedFinalizer(orgId, refId, "REFUND", REAPER_REASON);

    const reaped = await reapStaleLlmReservations();

    expect(reaped).toBe(0); // nothing left to refund — this tick only finishes the card
    expect(await ledgerRows(orgId)).toEqual([
      { kind: "RESERVE", reason: "" },
      { kind: "REFUND", reason: REAPER_REASON },
    ]);
    expect(await cardStatus(orgId, cardId)).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
  });

  it("leaves a card alone when the refund was the LIVE path's, not ours", async () => {
    // A resume that ran and used up its turns refunds its own hold and correctly leaves the card
    // `approved` — the work DID happen. Sweeping on "has a REFUND" would fail that card.
    const { orgId, cardId, refId } = await seedApprovedAction();
    await seedStaleHold(orgId, refId);
    await seedFinalizer(orgId, refId, "REFUND");

    await reapStaleLlmReservations();

    expect((await cardStatus(orgId, cardId)).status).toBe("approved");
  });
});

describe("#524 r8 — the ordinary leak is still swept, and replays cannot double it", () => {
  it("refunds the hold, labels the row, and retires the card", async () => {
    const { orgId, cardId, refId } = await seedApprovedAction();
    await seedStaleHold(orgId, refId);

    const reaped = await reapStaleLlmReservations();

    expect(reaped).toBe(1);
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
    expect(account).toMatchObject({ balance: START, reserved: 0 });
    expect(await ledgerRows(orgId)).toEqual([
      { kind: "RESERVE", reason: "" },
      { kind: "REFUND", reason: REAPER_REASON },
    ]);
    expect(await cardStatus(orgId, cardId)).toMatchObject({ status: "failed", chargeVerdict: "unknown" });
  });

  it("is a no-op on the second and third tick — one refund, one card write", async () => {
    const { orgId, cardId, refId } = await seedApprovedAction();
    await seedStaleHold(orgId, refId);

    await reapStaleLlmReservations();
    const after = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
    expect(await reapStaleLlmReservations()).toBe(0);
    expect(await reapStaleLlmReservations()).toBe(0);

    expect(await prisma.creditAccount.findUniqueOrThrow({ where: { orgId } })).toMatchObject({
      balance: after.balance,
      reserved: after.reserved,
    });
    expect((await ledgerRows(orgId)).filter((r) => r.kind === "REFUND")).toHaveLength(1);
    expect((await cardStatus(orgId, cardId)).status).toBe("failed");
  });
});
