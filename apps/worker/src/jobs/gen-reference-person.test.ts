/**
 * gen-reference-person.test.ts — #765: the engine refuses the merchant's reference image
 * because it shows a recognisable real person, and the product has to CATCH that.
 *
 * The defect this pins shut had three faces and one cause — the adapter's error reached the
 * worker as an anonymous 4xx:
 *   1. it was RETRIED. A rate limit deserves a retry; this does not — the same picture comes
 *      back refused every time — so the merchant waited out the whole retry budget first.
 *   2. what they were finally told was "That generation didn't go through", which is true and
 *      useless: no reason, no way forward.
 *   3. both merchant surfaces said it, and both said the same nothing.
 *
 * These tests run the REAL handleGen against a provider that throws exactly what the adapter
 * now throws for the measured engine reply (packages/generation/src/byteplus.test.ts pins that
 * the measured reply really does produce this error).
 *
 * The money rule is unchanged and asserted here too: a task-create rejection is provably free,
 * so the hold is refunded and NO spend is recorded. A retry that never happens cannot double
 * charge, and a refund that always happens is what makes "You weren't charged" true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFERENCE_IMAGE_PERSON_REJECTED } from "@fikirtive/core";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const entityFindMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateVideo = vi.fn();
  const generateImages = vi.fn();
  const storagePresignedGet = vi.fn(async () => "https://signed/frame.png");
  const storage = { presignedGet: storagePresignedGet, put: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst },
    entity: { findMany: entityFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    entityFindMany, chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst,
    refundReservation, settleCredits, generateVideo, generateImages, storage,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));

import { handleGen } from "./gen.js";

/** Exactly what the adapter throws for the measured engine reply: the merchant's own sentence,
 *  marked permanent (a retry cannot fix it) and NOT charged (rejected before the engine ran). */
const refusal = () => Object.assign(new Error(REFERENCE_IMAGE_PERSON_REJECTED), { permanent: true as const });

/** A video job started FROM THE CHAT — it has a threadId, so the merchant's account of the turn
 *  is the durable TURN_ERROR message Otto's conversation renders. */
const ottoJob = {
  id: "g1", ownerId: "o1", projectId: "p1", threadId: "t1", shotId: null,
  status: "QUEUED", kind: "VIDEO", model: "seedance-2-mini", prompt: "make it move",
  entityIds: [], variantSel: null, count: 1, videoOptions: null, generationIds: [],
  spent: false, spentUsd: null, sourceGenerationId: "gen_src", tailGenerationId: null,
  referenceVideoGenerationId: null,
};

/** The same job started FROM THE CANVAS — no chat to post into. Its merchant-facing account is
 *  the job row's own `error`, which `getGenJob` hands the board (see the web test). */
const canvasJob = { ...ottoJob, threadId: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // wins every conditional write
  m.entityFindMany.mockResolvedValue([]);
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  // the i2v source still resolves fine — the picture is only refused by the engine
  m.generationFindFirst.mockResolvedValue({ id: "gen_src", asset: { ownerId: "o1", contentHash: "a".repeat(64), ext: "png" } });
  m.generateVideo.mockRejectedValue(refusal());
});

/** The FAILED write this delivery made, if it made one. */
const terminalWrite = () => m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED")?.[0];
/** The requeue write (status back to QUEUED) — the thing that must NOT happen here. */
const requeueWrite = () => m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "QUEUED")?.[0];

describe("#765 the engine refuses a reference image showing a real person", () => {
  it("gives up on the FIRST attempt — no requeue, no retry budget spent", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });

    // retryCount 0: with the old anonymous-4xx handling this took the recoverable branch and
    // requeued, so the merchant waited through every remaining attempt for the same refusal.
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    expect(requeueWrite()).toBeUndefined();
    expect(terminalWrite()).toBeTruthy();
    expect(m.generateVideo).toHaveBeenCalledTimes(1);
  });

  it("refunds the hold and records NO spend — the engine never ran", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.settleCredits).not.toHaveBeenCalled();
    // A task-create rejection is provably free: marking it spent would invent COGS in the audit
    // and make "You weren't charged" a lie in the same breath as we say it.
    expect(terminalWrite()!.data.spent).toBeFalsy();
    expect(terminalWrite()!.data.spentUsd).toBeUndefined();
  });

  it("keeps the terminal write conditional, so a cancel that landed first is not overwritten", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    expect(terminalWrite()!.where).toMatchObject({ id: "g1", ownerId: "o1", status: { in: ["QUEUED", "GENERATING"] } });
  });

  // ── ENTRY 1: started in the conversation. What Otto shows is the durable TURN_ERROR. ──────
  it("ENTRY Otto: the chat turn ends with the reason and the way out, not a generic apology", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    const message = m.chatMessageCreate.mock.calls[0]![0].data;
    expect(message).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1", threadId: "t1" });
    expect(message.text).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  // ── ENTRY 2: started on the board. Its account is the job row the board reads back. ───────
  it("ENTRY canvas: the job row carries the same sentence, word for word", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...canvasJob });

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    // ONE sentence, one source: what the board reads back is byte-identical to what the chat
    // posted above. Any drift between the two is the thing this ticket exists to prevent.
    expect(terminalWrite()!.data.error).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
    // No chat to post into, and none invented.
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("says nothing about the engine, the model, or the error code on either entry", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    const shown = [terminalWrite()!.data.error, m.chatMessageCreate.mock.calls[0]![0].data.text].join(" ").toLowerCase();
    for (const secret of ["seedance", "seedream", "byteplus", "dreamina", "inputimagesensitive", "request id", "400"]) {
      expect(shown).not.toContain(secret);
    }
  });

  // ── FAIL CLOSED: an ordinary failure must be untouched by all of the above. ───────────────
  it("an ordinary provider failure still retries and still gets the generic apology", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });
    m.generateVideo.mockRejectedValue(new Error("generation provider video submit failed (429)"));

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    // recoverable: requeued, no terminal write, nothing said yet
    expect(requeueWrite()).toBeTruthy();
    expect(terminalWrite()).toBeUndefined();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("an ordinary failure that exhausts its retries says the generic thing, not merchant advice", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...ottoJob });
    m.generateVideo.mockRejectedValue(new Error("generation provider video submit failed (429)"));

    await expect(handleGen({ genJobId: "g1" }, 99)).rejects.toThrow();

    const text: string = m.chatMessageCreate.mock.calls[0]![0].data.text;
    expect(text).toBe("That generation didn't go through — you can try again.");
    // The whitelist is what keeps an internal error string out of a merchant's view: this job's
    // persisted error is an engine status line, and it must never be offered as advice.
    expect(text).not.toContain("429");
  });
});
