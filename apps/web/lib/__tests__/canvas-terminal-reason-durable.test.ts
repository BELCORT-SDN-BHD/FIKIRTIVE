/**
 * #827 — THE EXPLANATION SURVIVES THE REFRESH.
 *
 * #765 taught the system to recognise one refusal a merchant can act on — their reference image
 * showed a recognisable face, so no retry can help — and to say so in plain words. But the saying
 * was LIVE: a toast, and a poll running inside the tab that pressed generate. Reload the page and
 * the card fell back to the generic resting face: "That didn't finish. You weren't charged. Try
 * again." True, and an invitation to repeat the one thing that cannot work.
 *
 * This file is the durable half, and it is deliberately harsh about what counts as proof:
 *
 *   · REAL DATABASE, REAL SERVER ACTIONS. Only the session is mocked (same dialect as
 *     canvas-terminal-settlement.test.ts). The only thing carrying the explanation from the
 *     worker to the card is the `GenJob` row, which is the whole claim.
 *   · EVERY READ IS A COLD ONE. `listCanvasNodes` is called fresh, with no component, no poll and
 *     no client state anywhere. That IS a refresh — and calling it twice is a second device.
 *   · THE WORDS ARE CHECKED WHERE THE MERCHANT READS THEM. The DTO's reason is fed through
 *     `terminalCardCopy`, the same function the real card component renders from
 *     (canvas-terminal-card-ui.test.ts drives that half through ImageNode/VideoNode), so "the
 *     read produces the reason" and "the card shows the reason" are one chain rather than two
 *     claims that happen to agree.
 *
 * Nothing here spends: no GenJob is started, no provider is called, no credit moves.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin: () => false, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { listCanvasNodes } = await import("@/lib/canvas-actions");
const { syncOttoCanvasNodes } = await import("@/lib/otto-canvas-bridge");
const { terminalCardCopy } = await import("@/lib/canvas-terminal-copy");
const { REFERENCE_IMAGE_PERSON_REJECTED } = await import("@fikirtive/core/gen-failure");
const { redactProviderNames } = await import("@fikirtive/core/provider-secrecy");

const EMAIL = `canvas827-${randomUUID()}@fikirtive.test`;
let ownerId: string;
let projectId: string;

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = EMAIL;
  await prisma.user.upsert({ where: { email: EMAIL }, update: {}, create: { id: `usr_${randomUUID()}`, email: EMAIL } });
  mockAuth.mockResolvedValue({ user: { email: EMAIL } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  ownerId = gate.ownerId;
});

beforeEach(async () => {
  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Refused board" } });
});

afterAll(async () => {
  await prisma.canvasNode.deleteMany({ where: { ownerId } });
});

/**
 * A job exactly as the worker leaves a refusal: terminal, no outputs, refunded (nothing spent),
 * and the merchant's own sentence written onto `error`. That last part is not a fixture
 * convenience — `apps/worker/src/jobs/gen-reference-person.test.ts` proves the worker writes this
 * string, so what is seeded here is what production persists.
 */
async function seedFailedJob(error: string, status: "FAILED" | "CANCELLED" = "FAILED"): Promise<string> {
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId, projectId, prompt: "make it walk towards camera", kind: "VIDEO",
      model: "seedance-2-mini", count: 1, status, generationIds: [], spent: false,
      startedAt: new Date(), finishedAt: new Date(), error,
    },
  });
  return jobId;
}

/** The card the browser placed when the merchant pressed generate, left exactly as it was. */
async function seedCard(jobId: string, type: "image" | "video" = "video"): Promise<string> {
  const id = `cnd_${randomUUID()}`;
  await prisma.canvasNode.create({
    data: {
      id, ownerId, projectId, type, x: 100, y: 50, w: 320, h: 320,
      prompt: "make it walk towards camera", genJobId: jobId, status: "pending",
    },
  });
  return id;
}

type BoardCard = { id: string; status: string; failureReason: string };

/** A COLD board read — nothing but the database answers it. This is what a refresh does. */
async function coldRead(read: typeof listCanvasNodes | typeof syncOttoCanvasNodes): Promise<BoardCard[]> {
  const cards = await read(projectId);
  expect(Array.isArray(cards), `board read refused: ${JSON.stringify(cards)}`).toBe(true);
  return cards as unknown as BoardCard[];
}

describe("a refusal the merchant can act on is still on the card after a reload", () => {
  it("comes back out of the database, on a read with no client state behind it", async () => {
    const jobId = await seedFailedJob(REFERENCE_IMAGE_PERSON_REJECTED);
    await seedCard(jobId);

    const [card] = await coldRead(listCanvasNodes);

    expect(card!.status).toBe("failed");
    expect(card!.failureReason).toBe("referenceImagePerson");
    // And this is the sentence that reaches the merchant's eyes, from the one whitelist.
    expect(terminalCardCopy("failed", "referenceImagePerson").detail).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  it("says the same on a second, independent read — the other device, an hour later", async () => {
    const jobId = await seedFailedJob(REFERENCE_IMAGE_PERSON_REJECTED);
    await seedCard(jobId);

    const first = await coldRead(listCanvasNodes);
    const second = await coldRead(listCanvasNodes);

    expect(second.map((c) => [c.status, c.failureReason])).toEqual(first.map((c) => [c.status, c.failureReason]));
    expect(second[0]!.failureReason).toBe("referenceImagePerson");
  });

  it("reads identically on the Otto-side board, so the two boards cannot disagree", async () => {
    const jobId = await seedFailedJob(REFERENCE_IMAGE_PERSON_REJECTED);
    await seedCard(jobId);

    const [viaOtto] = await coldRead(syncOttoCanvasNodes);

    expect(viaOtto!.status).toBe("failed");
    expect(viaOtto!.failureReason).toBe("referenceImagePerson");
  });

  it("does not put the raw job error anywhere on the wire", async () => {
    // `GenJob.error` is an OPS column as much as a merchant one. Only the NAME crosses; the card
    // looks the sentence up from core. A DTO that carried the column would be one refactor away
    // from showing "conditioning refs unreachable (0/1) — refusing to spend" as advice.
    const jobId = await seedFailedJob("conditioning refs unreachable (0/1) — refusing to spend");
    await seedCard(jobId);

    const cards = await coldRead(listCanvasNodes);

    expect(JSON.stringify(cards)).not.toContain("conditioning refs");
    expect(cards[0]!.failureReason).toBe("unexplained");
  });

  it("names no engine, model or vendor on the card a merchant reads", async () => {
    const jobId = await seedFailedJob(REFERENCE_IMAGE_PERSON_REJECTED);
    await seedCard(jobId);

    const [card] = await coldRead(listCanvasNodes);
    const shown = terminalCardCopy("failed", card!.failureReason as "referenceImagePerson");

    expect(redactProviderNames(shown.detail)).toBe(shown.detail);
    expect(redactProviderNames(shown.title)).toBe(shown.title);
  });
});

describe("a card with no recorded reason says the honest generic thing", () => {
  it("keeps the words it has always had for an ordinary failure", async () => {
    const jobId = await seedFailedJob("generation provider video submit failed (500)");
    await seedCard(jobId, "image");

    const [card] = await coldRead(listCanvasNodes);

    expect(card!.status).toBe("failed");
    expect(card!.failureReason).toBe("unexplained");
    expect(terminalCardCopy("failed", "unexplained").detail).toBe("You weren't charged. Try again.");
  });

  it("invents nothing for a job that ended before any of this existed", async () => {
    // Every card on every board today: `error` empty, and no reason was ever recorded for it.
    const jobId = await seedFailedJob("");
    await seedCard(jobId, "image");

    const [card] = await coldRead(listCanvasNodes);

    expect(card!.failureReason).toBe("unexplained");
  });

  it("refuses to explain a CANCEL, even when the sentence is sitting on the job row", async () => {
    // A cancel is the merchant's own decision, not a refusal — and the sentence ends "You weren't
    // charged", a promise the cancel path proves separately and must not borrow. Fail closed:
    // only the `failed` face may carry a reason.
    const jobId = await seedFailedJob(REFERENCE_IMAGE_PERSON_REJECTED, "CANCELLED");
    await seedCard(jobId);

    const [card] = await coldRead(listCanvasNodes);

    expect(card!.status).toBe("cancelled");
    expect(card!.failureReason).toBe("unexplained");
  });
});
