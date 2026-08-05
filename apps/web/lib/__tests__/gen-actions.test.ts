import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_PER_DISPLAY, pricedGenCredits } from "@fikirtive/core";
import { getPrincipal, type Principal } from "@fikirtive/db/principal";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));

const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const db = vi.hoisted(() => {
  const projectFindFirst = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatThreadFindFirst = vi.fn();
  const genJobFindFirst = vi.fn();
  const genJobFindMany = vi.fn();
  const genJobCreate = vi.fn();
  const genJobUpdate = vi.fn();
  const actionEventCreate = vi.fn();
  const reserveCredits = vi.fn();
  const refundReservation = vi.fn();
  const executeRaw = vi.fn();
  const prisma = {
    project: { findFirst: projectFindFirst },
    chatMessage: { findFirst: chatMessageFindFirst },
    chatThread: { findFirst: chatThreadFindFirst },
    genJob: { findFirst: genJobFindFirst, findMany: genJobFindMany, create: genJobCreate, update: genJobUpdate },
    actionEvent: { create: actionEventCreate },
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma,
    projectFindFirst,
    chatMessageFindFirst,
    chatThreadFindFirst,
    genJobFindFirst,
    genJobFindMany,
    genJobCreate,
    genJobUpdate,
    actionEventCreate,
    reserveCredits,
    refundReservation,
    executeRaw,
  };
});

class MockInsufficientCredits extends Error {}

vi.mock("@fikirtive/db", () => ({
  prisma: db.prisma,
  reserveCredits: db.reserveCredits,
  refundReservation: db.refundReservation,
  InsufficientCredits: MockInsufficientCredits,
}));

const queue = vi.hoisted(() => {
  const send = vi.fn();
  return { send, getBoss: vi.fn(async () => ({ send })) };
});
const mockBossSend = queue.send;
const mockGetBoss = queue.getBoss;
vi.mock("../queue", () => ({ getBoss: mockGetBoss }));

const mockCheckCast = vi.fn();
vi.mock("../cowork-guardian", () => ({ checkCast: mockCheckCast }));

const mockResolveDisabledModels = vi.fn();
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));

const {
  getGenJob,
  getRecentGenResults,
  getActiveGenModels,
  startCanvasGen,
  startCoworkGen,
  startGen,
} = await import("../gen-actions");
const { canvasActionKey } = await import("../batch-idempotency");

const prevDefaultVideoModel = process.env.OTTO_DEFAULT_VIDEO_MODEL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OTTO_DEFAULT_VIDEO_MODEL = "seedance-2-fast";
  mockRequireOwner.mockResolvedValue({ email: "owner@example.test", ownerId: "org_ref" });
  mockIsImpersonating.mockResolvedValue(false);
  db.projectFindFirst.mockResolvedValue({ id: "p1" });
  db.chatMessageFindFirst.mockResolvedValue({
    threadId: "thread-1",
    payload: { estimatedCredits: 1 },
    thread: { projectId: "p1", ownerId: "org_ref", deletedAt: null },
  });
  db.chatThreadFindFirst.mockResolvedValue({ id: "thread-1" });
  db.genJobFindFirst.mockResolvedValue(null);
  db.genJobFindMany.mockResolvedValue([]);
  db.genJobCreate.mockResolvedValue({ id: "job_ref" });
  db.genJobUpdate.mockResolvedValue({});
  db.actionEventCreate.mockResolvedValue({});
  db.reserveCredits.mockResolvedValue({ ok: true });
  db.refundReservation.mockResolvedValue({ ok: true });
  db.executeRaw.mockResolvedValue(undefined);
  mockGetBoss.mockResolvedValue({ send: mockBossSend });
  // pg-boss returns the caller-supplied deterministic id on a successful insert.
  mockBossSend.mockImplementation(async (
    _name: string,
    _data: unknown,
    options: { id?: string },
  ) => options.id ?? null);
  mockCheckCast.mockResolvedValue(null);
  mockResolveDisabledModels.mockResolvedValue(new Set());
});

afterEach(() => {
  if (prevDefaultVideoModel === undefined) delete process.env.OTTO_DEFAULT_VIDEO_MODEL;
  else process.env.OTTO_DEFAULT_VIDEO_MODEL = prevDefaultVideoModel;
});

describe("startGen", () => {
  it("reserves canvas: keys for startCanvasGen and rejects a caller-supplied idempotencyKey", async () => {
    const rejected = await startCanvasGen({
      actionId: "action-with-client-key",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "product hero",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "caller-must-not-control-this",
    });
    expect(rejected).toEqual({ error: "That generation request is out of bounds." });

    const result = await startCanvasGen({
      actionId: "action-1",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "product hero",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.genJobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotencyKey: canvasActionKey("action-1").key }),
    }));
  });

  it("does not let direct startGen spoof the reserved canvas key family", async () => {
    const result = await startGen({
      projectId: "p1",
      prompt: "spoofed canvas request",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: canvasActionKey("spoofed").key,
    });

    expect(result).toEqual({ error: "That generation request is out of bounds." });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("does not let direct startGen spoof the reserved cowork card key family", async () => {
    const result = await startGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "spoofed cowork request",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card-1",
    });

    expect(result).toEqual({ error: "That generation request is out of bounds." });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("binds a persisted GEN_CARD's exact displayed quote before create + reserve", async () => {
    const result = await startCoworkGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "approved card",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card-1",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.chatMessageFindFirst).toHaveBeenCalledWith({
      where: { id: "card-1", ownerId: "org_ref", kind: "GEN_CARD", deletedAt: null },
      select: {
        threadId: true,
        payload: true,
        thread: { select: { projectId: true, ownerId: true, deletedAt: true } },
      },
    });
    expect(db.genJobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: "p1",
        threadId: "thread-1",
        idempotencyKey: "cowork:card-1",
      }),
    }));
    expect(db.reserveCredits).toHaveBeenCalledWith(db.prisma, {
      orgId: "org_ref",
      refId: "job_ref",
      cost: INTERNAL_PER_DISPLAY,
    });
  });

  it.each([
    { approved: 2, count: 1, current: 1 },
    { approved: 1, count: 2, current: 2 },
  ])("refuses a fresh GEN_CARD when its approved quote changed from $approved to $current", async ({ approved, count, current }) => {
    db.chatMessageFindFirst.mockResolvedValueOnce({
      threadId: "thread-1",
      payload: { estimatedCredits: approved },
      thread: { projectId: "p1", ownerId: "org_ref", deletedAt: null },
    });

    const result = await startCoworkGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "stale card",
      entityIds: [],
      count,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card-stale",
    });

    expect(result).toEqual({
      error: `The approved price changed from ${approved} to ${current} credits. Ask Otto for an updated proposal, then review it again.`,
    });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it.each([undefined, "1", 1.5, 0])("fails closed on a missing or malformed persisted GEN_CARD quote (%s)", async (estimatedCredits) => {
    db.chatMessageFindFirst.mockResolvedValueOnce({
      threadId: "thread-1",
      payload: { estimatedCredits },
      thread: { projectId: "p1", ownerId: "org_ref", deletedAt: null },
    });

    const result = await startCoworkGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "legacy card",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:legacy-card",
    });

    expect(result).toEqual({
      error: "This generation card needs a current price. Ask Otto to propose it again, then review the new card.",
    });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("replays an accepted terminal cowork job before missing quote, thread, model, and guardian gates", async () => {
    db.chatMessageFindFirst.mockResolvedValueOnce({
      threadId: "thread-1",
      payload: {},
      thread: { projectId: "p1", ownerId: "org_ref", deletedAt: null },
    });
    db.genJobFindFirst.mockResolvedValueOnce({ id: "job-done" });
    db.chatThreadFindFirst.mockResolvedValue(null);
    mockCheckCast.mockResolvedValue({ error: "dynamic gate changed", report: { findings: [] } });

    const result = await startCoworkGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "legacy card",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:legacy-card",
    });

    expect(result).toEqual({ id: "job-done", disposition: "reused" });
    expect(db.chatThreadFindFirst).not.toHaveBeenCalled();
    expect(mockCheckCast).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("lets a lock-time cowork winner beat a stale quote without a second reserve", async () => {
    db.chatMessageFindFirst.mockResolvedValueOnce({
      threadId: "thread-1",
      payload: { estimatedCredits: 99 },
      thread: { projectId: "p1", ownerId: "org_ref", deletedAt: null },
    });
    db.genJobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "job-winner" });

    const result = await startCoworkGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "same accepted card",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card-race",
    });

    expect(result).toEqual({ id: "job-winner", disposition: "reused" });
    expect(db.executeRaw).toHaveBeenCalledTimes(1);
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("rejects a cowork request when its persisted card is from another project", async () => {
    db.chatMessageFindFirst.mockResolvedValueOnce({
      threadId: "thread-1",
      payload: { estimatedCredits: 1 },
      thread: { projectId: "other-project", ownerId: "org_ref", deletedAt: null },
    });

    const result = await startCoworkGen({
      projectId: "p1",
      threadId: "thread-1",
      prompt: "cross-project",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "cowork:card-other",
    });

    expect(result).toEqual({ error: "Generation card not found." });
    expect(db.projectFindFirst).not.toHaveBeenCalled();
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("fails before create or reserve when the displayed Canvas quote is stale", async () => {
    const result = await startCanvasGen({
      actionId: "action-stale-quote",
      expectedCredits: 2,
      projectId: "p1",
      prompt: "one image",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
    });

    expect(result).toEqual({
      error: "The confirmed price changed from 2 to 1 credits. Refresh Canvas to load the current price, then review and send again.",
    });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("requires Canvas to bind the price the owner approved", async () => {
    const result = await startCanvasGen({
      actionId: "action-without-quote",
      projectId: "p1",
      prompt: "one image",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
    });

    expect(result).toEqual({ error: "That generation request is out of bounds." });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("durably replays the same canvas action at any terminal status before dynamic gates", async () => {
    const key = canvasActionKey("action-done").key;
    db.genJobFindMany.mockResolvedValue([{
      id: "job_done",
      status: "DONE",
      idempotencyKey: key,
      prompt: "accepted material",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: [],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      threadId: "thread-1",
      videoOptions: null,
    }]);
    mockCheckCast.mockResolvedValue({ error: "dynamic gate changed", report: { findings: [] } });

    const result = await startCanvasGen({
      actionId: "action-done",
      expectedCredits: 999,
      projectId: "p1",
      prompt: "accepted material",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      threadId: "thread-1",
    });

    expect(result).toEqual({ id: "job_done", disposition: "reused" });
    expect(mockCheckCast).not.toHaveBeenCalled();
    expect(db.chatThreadFindFirst).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("rejects a reused canvas action when any frozen material changes", async () => {
    const key = canvasActionKey("action-conflict").key;
    db.genJobFindMany.mockResolvedValue([{
      id: "job_failed",
      status: "FAILED",
      idempotencyKey: key,
      prompt: "original prompt",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: [],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      threadId: "thread-1",
      videoOptions: null,
    }]);

    const result = await startCanvasGen({
      actionId: "action-conflict",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "changed prompt",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      threadId: "thread-1",
    });

    expect(result).toMatchObject({ disposition: "conflict", error: expect.stringMatching(/different content/i) });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("repeats the canvas replay decision under the project lock before create + reserve", async () => {
    const key = canvasActionKey("action-race").key;
    const winner = {
      id: "job_race_winner",
      status: "FAILED",
      idempotencyKey: key,
      prompt: "same material",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: [],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      threadId: null,
      videoOptions: null,
    };
    db.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([winner]);

    const result = await startCanvasGen({
      actionId: "action-race",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "same material",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
    });

    expect(result).toEqual({ id: "job_race_winner", disposition: "reused" });
    expect(db.executeRaw).toHaveBeenCalledTimes(1);
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("validates a provided thread before fresh gates and again under the project lock", async () => {
    const result = await startCanvasGen({
      actionId: "action-thread",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "thread attributed",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      threadId: "thread-1",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.chatThreadFindFirst).toHaveBeenCalledTimes(2);
    expect(db.chatThreadFindFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "thread-1", ownerId: "org_ref", projectId: "p1", deletedAt: null },
      select: { id: true },
    });
    expect(db.chatThreadFindFirst).toHaveBeenNthCalledWith(2, {
      where: { id: "thread-1", ownerId: "org_ref", projectId: "p1", deletedAt: null },
      select: { id: true },
    });
  });

  it("fails closed if a thread disappears between the preflight and locked check", async () => {
    db.chatThreadFindFirst.mockResolvedValueOnce({ id: "thread-1" }).mockResolvedValueOnce(null);

    const result = await startCanvasGen({
      actionId: "action-thread-race",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "thread race",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      threadId: "thread-1",
    });

    expect(result).toEqual({ error: "Thread not found." });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("reserves the fixed 16 displayed credits and persists reference video identity", async () => {
    // Regression: launch margin parity — reference-video quote/reserve/settle must agree at 16 displayed credits.
    // Found by /qa on 2026-07-04. Report: docs/review/MARGIN-PARITY-REPORT-2026-07-04.md.
    const result = await startGen({
      projectId: "p1",
      prompt: "match this reference video's camera motion",
      entityIds: [],
      count: 1,
      kind: "video",
      model: "seedance-2-fast",
      durationSeconds: 5,
      resolution: "720p",
      referenceVideoGenerationId: "gen_ref",
      idempotencyKey: "ref-video-key-1",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.genJobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: expect.any(String),
        ownerId: "org_ref",
        projectId: "p1",
        kind: "VIDEO",
        model: "seedance-2-fast",
        count: 1,
        referenceVideoGenerationId: "gen_ref",
        videoOptions: expect.objectContaining({ seconds: 5, resolution: "720p" }),
      }),
      select: { id: true },
    }));
    expect(db.reserveCredits).toHaveBeenCalledWith(db.prisma, {
      orgId: "org_ref",
      refId: "job_ref",
      cost: 16 * INTERNAL_PER_DISPLAY,
    });
    const queueJobId = db.genJobCreate.mock.calls[0]?.[0]?.data?.queueJobId as string;
    expect(queueJobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(mockBossSend).toHaveBeenCalledWith(
      "gen",
      { genJobId: "job_ref" },
      {
        id: queueJobId,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      },
    );
  });

  it("returns reused on the generic active fast path without creating or reserving", async () => {
    db.genJobFindFirst.mockResolvedValue({ id: "job_active" });

    const result = await startGen({
      projectId: "p1",
      prompt: "same request",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "generic-active-key",
    });

    expect(result).toEqual({ id: "job_active", disposition: "reused" });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("returns reused from generic P2002 recovery and never reports the rolled-back loser as fresh", async () => {
    db.genJobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job_winner" });
    db.genJobCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));

    const result = await startGen({
      projectId: "p1",
      prompt: "same request",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "generic-p2002-key",
    });

    expect(result).toEqual({ id: "job_winner", disposition: "reused" });
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("returns reused from factory P2002 recovery only after full material verification", async () => {
    const key = `batch:${"1".repeat(32)}:attempt:${"2".repeat(32)}`;
    db.genJobCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    db.genJobFindFirst.mockResolvedValueOnce({
      id: "job_factory_winner",
      status: "QUEUED",
      idempotencyKey: key,
      prompt: "same material",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: ["entity-1"],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      videoOptions: null,
    });

    const result = await startGen({
      projectId: "p1",
      prompt: "same material",
      entityIds: ["entity-1"],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: key,
    });

    expect(result).toEqual({ id: "job_factory_winner", disposition: "reused" });
    expect(db.genJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: "org_ref", projectId: "p1", idempotencyKey: key },
    }));
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("treats empty image variantSel as absent for an explicit FAILED retry and fresh persistence", async () => {
    const logical = `batch:${"3".repeat(32)}:attempt:`;
    const key = `${logical}${"4".repeat(32)}`;
    const prior = {
      id: "job_failed_without_variant_selection",
      status: "FAILED",
      idempotencyKey: `${logical}${"5".repeat(32)}`,
      prompt: "same material",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: ["entity-1"],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      videoOptions: null,
    };
    db.genJobFindMany.mockResolvedValue([prior]);

    const result = await startGen({
      projectId: "p1",
      prompt: "same material",
      entityIds: ["entity-1"],
      variantSel: {},
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: key,
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(mockCheckCast).toHaveBeenCalledWith(expect.objectContaining({ variantSel: undefined }));
    const createData = db.genJobCreate.mock.calls[0]?.[0]?.data;
    expect(createData).not.toHaveProperty("variantSel");
    expect(db.reserveCredits).toHaveBeenCalledTimes(1);
  });

  it("lets a NEW attempt start after the merchant cancelled the previous one (#602 T3)", async () => {
    // THE GUARD (#599 D4). A new attempt on the same logical cell may only be created once every
    // prior job for that cell has ENDED WITHOUT DELIVERING. That rule was spelled as
    // `status !== "FAILED"`, i.e. "failed is the only ending that frees the cell" — true only
    // while cancelling wrote the word FAILED. The moment cancel became its own word, a cancelled
    // job read as "still live" and the merchant's next press was deduped back onto the dead job:
    // they press Generate, nothing new is ever made, and the id they get back is a job that will
    // never produce anything. Nothing about money changes here — a cancelled job was already
    // refunded, and the fresh attempt reserves for itself exactly as any first attempt does.
    const logical = `batch:${"9".repeat(32)}:attempt:`;
    const key = `${logical}${"e".repeat(32)}`;
    const cancelled = {
      id: "job_cancelled_by_the_merchant",
      status: "CANCELLED",
      idempotencyKey: `${logical}${"f".repeat(32)}`,
      prompt: "same material",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: ["entity-1"],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      videoOptions: null,
    };
    db.genJobFindMany.mockResolvedValue([cancelled]);

    const result = await startGen({
      projectId: "p1",
      prompt: "same material",
      entityIds: ["entity-1"],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: key,
    });

    // A NEW job — never the cancelled one handed back as if it were still going to deliver.
    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.genJobCreate).toHaveBeenCalledTimes(1);
    // Money is untouched by the guard: the fresh attempt reserves once, like any first attempt.
    expect(db.reserveCredits).toHaveBeenCalledTimes(1);
    expect(db.refundReservation).not.toHaveBeenCalled();
  });

  it("reuses an exact factory attempt even after its job FAILED — delayed duplicate is never a retry", async () => {
    const key = `batch:${"a".repeat(32)}:attempt:${"b".repeat(32)}`;
    expect(key).toHaveLength(79);
    const prior = {
      id: "job_failed_attempt_a",
      status: "FAILED",
      idempotencyKey: key,
      prompt: "product hero",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: ["entity-1"],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      videoOptions: null,
    };
    db.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([prior]);

    const result = await startGen({
      projectId: "p1",
      prompt: "product hero",
      entityIds: ["entity-1"],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: key,
    });

    expect(result).toEqual({ id: "job_failed_attempt_a", disposition: "reused" });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1); // early miss, then exact hit under lock
  });

  it("durably reuses an exact factory attempt before guardian/admin dynamic gates can drift", async () => {
    const key = `batch:${"7".repeat(32)}:attempt:${"8".repeat(32)}`;
    db.genJobFindMany.mockResolvedValue([{
      id: "job_durable_attempt",
      status: "FAILED",
      idempotencyKey: key,
      prompt: "accepted before gates changed",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: ["entity-1"],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      videoOptions: null,
    }]);
    mockCheckCast.mockResolvedValue({ error: "entity is now unavailable", report: { findings: [] } });
    mockResolveDisabledModels.mockResolvedValue(new Set(["seedream"]));

    const result = await startGen({
      projectId: "p1",
      prompt: "accepted before gates changed",
      entityIds: ["entity-1"],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: key,
    });

    expect(result).toEqual({ id: "job_durable_attempt", disposition: "reused" });
    expect(mockCheckCast).not.toHaveBeenCalled();
    expect(mockResolveDisabledModels).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("fails closed inside the factory lock when FAILED history has different material", async () => {
    const key = `batch:${"c".repeat(32)}:attempt:${"d".repeat(32)}`;
    const prior = {
      id: "job_failed_old_material",
      status: "FAILED",
      idempotencyKey: `batch:${"c".repeat(32)}:attempt:${"e".repeat(32)}`,
      prompt: "old prompt",
      model: "seedance-2-fast",
      kind: "VIDEO",
      count: 1,
      entityIds: ["entity-old"],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: "ref-old",
      shotId: null,
      videoOptions: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 24, audio: false },
    };
    db.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([prior]);

    const result = await startGen({
      projectId: "p1",
      prompt: "new prompt",
      entityIds: ["entity-new"],
      count: 1,
      kind: "video",
      model: "seedance-2-fast",
      durationSeconds: 5,
      resolution: "720p",
      referenceVideoGenerationId: "ref-new",
      idempotencyKey: key,
    });

    expect(result).toMatchObject({ disposition: "conflict", error: expect.stringMatching(/different content/i) });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1); // conflict is repeated under lock
    expect(db.genJobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "org_ref", projectId: "p1" }),
    }));
  });

  // ── W-B3-E-P 查漏 (2026-07-14): startGen 三数一致直证(报价=预留)与余额不足 fail-closed。
  // 真 Postgres 全链三数一致(报价=预留=结账)在 gen-ledger.test.ts;这里钉住报价权威本身:
  // reserve 的 cost 必须逐字节等于 pricedGenCredits 的报价(worker 结算读 RESERVE 行,永不重算)。

  it("reserves exactly count × 1 displayed credit for a plain image batch (quote == reserve, count 1-4)", async () => {
    const result = await startGen({
      projectId: "p1",
      prompt: "product hero on white",
      entityIds: [],
      count: 4,
      kind: "image",
      model: "seedream",
      idempotencyKey: "img-count4-key",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    // quote == reserve: the reserved cost IS the pricedGenCredits quote, and the quote is
    // pinned to the literal price sheet (1 displayed credit per image) — not just tautology.
    const quote = pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, referenceVideoGenerationId: null, videoOptions: null });
    expect(quote).toBe(4 * INTERNAL_PER_DISPLAY);
    expect(db.reserveCredits).toHaveBeenCalledWith(db.prisma, { orgId: "org_ref", refId: "job_ref", cost: quote });
    expect(db.genJobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "IMAGE", count: 4 }),
      select: { id: true },
    }));
  });

  it("charges a single clip and persists count=1 for a video request with count > 1 (never over-reserves)", async () => {
    const result = await startGen({
      projectId: "p1",
      prompt: "make it move",
      entityIds: [],
      count: 2,
      kind: "video",
      model: "seedance-2-fast",
      durationSeconds: 5,
      resolution: "720p",
      idempotencyKey: "video-count2-key",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    // flat-priced seedance-2-fast 720p/5s = 8 displayed credits for ONE clip. The client fans a
    // multi-clip request out as N single-clip jobs, so startGen must reserve for count=1 — pricing
    // the raw count here would double-charge the first clip of every fan-out.
    expect(db.reserveCredits).toHaveBeenCalledWith(db.prisma, {
      orgId: "org_ref",
      refId: "job_ref",
      cost: 8 * INTERNAL_PER_DISPLAY,
    });
    expect(db.genJobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "VIDEO", count: 1 }),
      select: { id: true },
    }));
  });

  it("reserves the 14-displayed-credit 720p/10s video tier (margin-parity pin)", async () => {
    const result = await startGen({
      projectId: "p1",
      prompt: "longer product spin",
      entityIds: [],
      count: 1,
      kind: "video",
      model: "seedance-2-fast",
      durationSeconds: 10,
      resolution: "720p",
      idempotencyKey: "video-10s-key",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.reserveCredits).toHaveBeenCalledWith(db.prisma, {
      orgId: "org_ref",
      refId: "job_ref",
      cost: 14 * INTERNAL_PER_DISPLAY,
    });
  });

  it("fails closed on InsufficientCredits — friendly error, no enqueue, no audit write", async () => {
    db.reserveCredits.mockRejectedValueOnce(new MockInsufficientCredits());

    const result = await startGen({
      projectId: "p1",
      prompt: "over budget",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "broke-key",
    });

    // 六态②余额不足: the reserve threw inside the tx (job insert rolled back with it) → a
    // friendly out-of-credits error, and NOTHING downstream of the spend commit may run.
    expect(result).toEqual({ error: expect.stringMatching(/credits/i) });
    expect(mockBossSend).not.toHaveBeenCalled();
    expect(db.genJobUpdate).not.toHaveBeenCalled();
    expect(db.actionEventCreate).not.toHaveBeenCalled();
    expect(db.refundReservation).not.toHaveBeenCalled(); // nothing was reserved → nothing to refund
  });

  it("fails before create/reserve when queue preparation is unavailable, after locked replay gets first say", async () => {
    mockGetBoss.mockRejectedValueOnce(new Error("queue offline"));

    const result = await startGen({
      projectId: "p1",
      prompt: "prepare failure",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "prepare-failure-key",
    });

    expect(result).toEqual({
      error: "Generation could not start because the queue was unavailable. Nothing was charged — retry when it is available.",
    });
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
    expect(db.genJobUpdate).not.toHaveBeenCalled();
    expect(db.refundReservation).not.toHaveBeenCalled();
    expect(db.actionEventCreate).not.toHaveBeenCalled();
  });

  it("still reuses the locked concurrent winner when queue preparation failed", async () => {
    mockGetBoss.mockRejectedValueOnce(new Error("queue offline"));
    const key = canvasActionKey("prepare-race").key;
    db.genJobFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: "job-concurrent-winner",
      status: "QUEUED",
      idempotencyKey: key,
      prompt: "concurrent winner",
      model: "seedream",
      kind: "IMAGE",
      count: 1,
      entityIds: [],
      variantSel: null,
      sourceGenerationId: null,
      tailGenerationId: null,
      referenceVideoGenerationId: null,
      shotId: null,
      threadId: null,
      videoOptions: null,
    }]);

    const result = await startCanvasGen({
      actionId: "prepare-race",
      expectedCredits: 1,
      projectId: "p1",
      prompt: "concurrent winner",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
    });

    expect(result).toEqual({ id: "job-concurrent-winner", disposition: "reused" });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("still reuses an ordinary-key concurrent winner when queue preparation failed", async () => {
    mockGetBoss.mockRejectedValueOnce(new Error("queue offline"));
    db.genJobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job-ordinary-concurrent-winner" });

    const result = await startGen({
      projectId: "p1",
      prompt: "ordinary concurrent winner",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "ordinary-prepare-race",
    });

    expect(result).toEqual({ id: "job-ordinary-concurrent-winner", disposition: "reused" });
    expect(db.genJobFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        ownerId: "org_ref",
        projectId: "p1",
        idempotencyKey: "ordinary-prepare-race",
        status: { in: ["QUEUED", "GENERATING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
    expect(mockBossSend).not.toHaveBeenCalled();
  });

  it("keeps a transactional send rejection outcome unknown without refund, status clobber, or audit", async () => {
    mockBossSend.mockRejectedValueOnce(new Error("queue offline"));

    const promise = startGen({
      projectId: "p1",
      prompt: "dispatch failure",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "dispatch-failure-key",
    });

    await expect(promise).rejects.toThrow("queue offline");
    const queueJobId = db.genJobCreate.mock.calls[0]?.[0]?.data?.queueJobId as string;
    expect(mockBossSend).toHaveBeenCalledWith(
      "gen",
      { genJobId: "job_ref" },
      {
        id: queueJobId,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      },
    );
    expect(db.genJobUpdate).not.toHaveBeenCalled();
    expect(db.refundReservation).not.toHaveBeenCalled();
    expect(db.actionEventCreate).not.toHaveBeenCalled();
  });

  it("recovers a committed create + reserve + enqueue after the transaction commit ACK is lost", async () => {
    db.genJobCreate.mockImplementationOnce(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
    mockBossSend.mockImplementationOnce(async (
      _name: string,
      _data: unknown,
      options: { id: string },
    ) => options.id);
    db.genJobFindFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id ? { id: where.id } : null
    ));
    db.prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn(db.prisma);
      throw new Error("commit ACK lost");
    });

    const result = await startGen({
      projectId: "p1",
      prompt: "committed despite lost ACK",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "commit-ack-recovery-key",
    });

    const createData = db.genJobCreate.mock.calls[0]?.[0]?.data as { id: string; queueJobId: string };
    const createdId = createData.id;
    const queueJobId = createData.queueJobId;
    expect(result).toEqual({ id: createdId, disposition: "fresh" });
    expect(createdId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(queueJobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(queueJobId).not.toBe(createdId);
    expect(createData).toEqual(expect.objectContaining({
      id: createdId,
      queueJobId,
    }));
    expect(db.reserveCredits).toHaveBeenCalledWith(db.prisma, expect.objectContaining({ refId: createdId }));
    expect(mockBossSend).toHaveBeenCalledWith(
      "gen",
      { genJobId: createdId },
      {
        id: queueJobId,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      },
    );
    expect(db.genJobFindFirst).toHaveBeenLastCalledWith({
      where: { id: createdId, ownerId: "org_ref", projectId: "p1" },
      select: { id: true },
    });
    expect(db.refundReservation).not.toHaveBeenCalled();
  });

  it("keeps a lost commit ACK unknown when the owner/project/job lookup cannot prove a commit", async () => {
    db.genJobCreate.mockImplementationOnce(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
    mockBossSend.mockImplementationOnce(async (
      _name: string,
      _data: unknown,
      options: { id: string },
    ) => options.id);
    db.prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn(db.prisma);
      throw new Error("commit ACK lost");
    });

    await expect(startGen({
      projectId: "p1",
      prompt: "unknown commit outcome",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "commit-ack-unknown-key",
    })).rejects.toThrow("commit ACK lost");

    const createdId = db.genJobCreate.mock.calls[0]?.[0]?.data?.id as string;
    expect(db.genJobFindFirst).toHaveBeenLastCalledWith({
      where: { id: createdId, ownerId: "org_ref", projectId: "p1" },
      select: { id: true },
    });
    expect(db.genJobUpdate).not.toHaveBeenCalled();
    expect(db.refundReservation).not.toHaveBeenCalled();
    expect(db.actionEventCreate).not.toHaveBeenCalled();
  });

  /**
   * #464 B1 acceptance for this site — see `principal-frame-b1.test.ts` for the other seamed
   * sites and the shared rationale. It lives here rather than there because reaching the real
   * `gen-actions` module needs this file's mocks.
   *
   * `startGen` is the ONE spend authority in the app: the job row and the credit reservation are
   * created here and nowhere else. So the frame is asserted at the three steps that matter in
   * order — the owner-scoped project read, the GenJob create, and the credit reservation — not
   * merely at the entry. A refactor that opened the frame too late (or dropped it before the
   * reserve) would leave the CHARGE anonymous while the read still looked framed.
   */
  it("keeps the ambient user frame live through create AND reserve (#464 B1)", async () => {
    const seen: Record<string, Principal | undefined> = {};
    db.projectFindFirst.mockImplementation(async () => {
      seen.projectRead = getPrincipal();
      return { id: "p1" };
    });
    db.genJobCreate.mockImplementation(async () => {
      seen.genJobCreate = getPrincipal();
      return { id: "job_ref" };
    });
    db.reserveCredits.mockImplementation(async () => {
      seen.reserveCredits = getPrincipal();
      return { ok: true };
    });

    const result = await startGen({
      projectId: "p1",
      prompt: "framed spend",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "frame-b1-key-1",
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(Object.keys(seen).sort()).toEqual(["genJobCreate", "projectRead", "reserveCredits"]);
    for (const [where, principal] of Object.entries(seen)) {
      expect(principal, `ambient principal missing at ${where}`).toBeDefined();
      // Explicit kind check: a `runAsTenant` stand-in also carries `ownerId`, and it is exactly
      // the frame that has lost the actor — an anonymous charge.
      expect(principal!.kind, `frame at ${where} is not a user frame`).toBe("user");
      expect(principal).toMatchObject({
        kind: "user",
        ownerId: "org_ref",
        subjectEmail: "owner@example.test",
      });
    }
    expect(getPrincipal()).toBeUndefined();
  });

  it("opens no frame — and spends nothing — when the gate denies (#464 B1)", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Sign in required." });

    const result = await startGen({
      projectId: "p1",
      prompt: "denied",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "frame-b1-key-denied",
    });

    expect(result).toEqual({ error: "Sign in required." });
    expect(db.projectFindFirst).not.toHaveBeenCalled();
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("opens no frame — and spends nothing — while impersonating (#464 B1)", async () => {
    mockIsImpersonating.mockResolvedValue(true);

    const result = await startGen({
      projectId: "p1",
      prompt: "impersonated",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: "frame-b1-key-impersonated",
    });

    expect(result).toEqual({
      error: "Paused while impersonating a customer — exit impersonation to do this.",
    });
    expect(db.projectFindFirst).not.toHaveBeenCalled();
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });
});

describe("generation read boundaries", () => {
  const SECRET_TERMS =
    /seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b|anthropic|claude/iu;
  const persistedLeak =
    "FAL fal.ai/model FalProvider Seedance 2.0 Fast seedream BYTEPLUS BytePlusProvider ByteDance jimeng 即梦 AnthropicError claude-as-provider https://media.example.test/file?X-Amz-Signature=secret";

  it("returns only opaque capability ids and server-computed quote metadata", async () => {
    const models = await getActiveGenModels();
    const serialized = JSON.stringify(models);

    expect(models.image).toMatch(/^capability-image-\d+$/);
    expect(models.video).toMatch(/^capability-video-\d+$/);
    expect(models.imageCredits).toBeGreaterThan(0);
    expect(models.videoCredits).toBeGreaterThan(0);
    expect(serialized).not.toMatch(SECRET_TERMS);
  });

  it("resolves an opaque image capability before the unchanged create-and-reserve path", async () => {
    const models = await getActiveGenModels();

    const result = await startCanvasGen({
      actionId: "opaque-capability",
      expectedCredits: models.imageCredits,
      projectId: "p1",
      prompt: "product hero",
      entityIds: [],
      count: 1,
      kind: "image",
      model: models.image,
    });

    expect(result).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(db.genJobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ model: "seedream" }),
    }));
    expect(db.reserveCredits).toHaveBeenCalledTimes(1);
  });

  it("redacts a legacy GenJob error before returning it to the browser", async () => {
    db.genJobFindFirst.mockResolvedValueOnce({
      id: "job-leak",
      status: "FAILED",
      progress: 100,
      error: persistedLeak,
      generationIds: [],
      spent: false,
    });

    const result = await getGenJob("job-leak", "p1");

    expect(result?.error).not.toMatch(SECRET_TERMS);
    expect(result?.error).not.toContain("X-Amz-Signature");
    expect(result?.error).toContain("generation provider");
  });

  it("redacts legacy recent-result errors and does not return model identifiers", async () => {
    db.genJobFindMany.mockResolvedValueOnce([{
      id: "job-recent-leak",
      status: "FAILED",
      prompt: "product hero",
      kind: "IMAGE",
      error: persistedLeak,
      generationIds: [],
    }]);

    const [result] = await getRecentGenResults("p1");

    expect(result?.error).not.toMatch(SECRET_TERMS);
    expect(result?.error).not.toContain("X-Amz-Signature");
    expect(result).not.toHaveProperty("model");
  });
});

// ---------------------------------------------------------------------------
// #642 图片形状端到端 —— 服务端全链路(gen-actions → 快照 → worker)
// ---------------------------------------------------------------------------
describe("startGen 图片规格快照", () => {
  const base = {
    projectId: "p1",
    prompt: "a poster",
    entityIds: [],
    count: 1,
    kind: "image" as const,
    model: "seedream",
  };
  const createdData = () => db.genJobCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
  /** 只让「按 generationIds 找源图那一单」这一次查询返回快照;其余 findFirst 照旧 null。 */
  type GenJobFindFirstArgs = { where?: { generationIds?: unknown } };
  const sourceSnapshot = (imageOptions: { aspectRatio: string } | null) =>
    async (args: GenJobFindFirstArgs) =>
      args?.where?.generationIds !== undefined ? { imageOptions } : null;

  it("商家选的画幅冻结进作业行(不再蒸发)", async () => {
    const r = await startGen({ ...base, aspectRatio: "9:16", idempotencyKey: "shape-1" });
    expect(r).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "9:16" });
  });

  it("没选画幅 → 落默认 1:1(与今日方图逐字节一致)", async () => {
    await startGen({ ...base, idempotencyKey: "shape-2" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "1:1" });
  });

  it("画布入口(startCanvasGen)也真的把画幅带到底 —— T2 接 UI 时链路已经通了", async () => {
    const r = await startCanvasGen({
      actionId: "action-shape", expectedCredits: 1, ...base, aspectRatio: "4:3",
    });
    expect(r).toEqual({ id: "job_ref", disposition: "fresh" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "4:3" });
  });

  it("引擎收不下的画幅在花钱之前就被拒(不创建作业、不预扣)", async () => {
    const r = await startGen({ ...base, aspectRatio: "5:7", idempotencyKey: "shape-3" });
    expect(r).toEqual({ error: "That generation request is out of bounds." });
    expect(db.genJobCreate).not.toHaveBeenCalled();
    expect(db.reserveCredits).not.toHaveBeenCalled();
  });

  it("视频作业不写图片快照(两条规格路互不串台)", async () => {
    await startGen({
      ...base, kind: "video", model: "seedance-2-fast", aspectRatio: "16:9", idempotencyKey: "shape-4",
    });
    expect(createdData().imageOptions).toBeUndefined();
    expect(createdData().videoOptions).toEqual(expect.objectContaining({ aspectRatio: "16:9" }));
  });

  it("改这张图 / 再来一张:没另选画幅就继承源图快照里的画幅(形状不被悄悄改掉)", async () => {
    db.genJobFindFirst.mockImplementation(sourceSnapshot({ aspectRatio: "9:16" }));
    await startGen({ ...base, sourceGenerationId: "gen_src", idempotencyKey: "shape-5" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "9:16" });
    // 源图查询必须带 tenant 约束
    const lookup = db.genJobFindFirst.mock.calls.map(([a]) => a as GenJobFindFirstArgs)
      .find((a) => a?.where?.generationIds !== undefined);
    expect(lookup?.where).toEqual(expect.objectContaining({ ownerId: "org_ref", kind: "IMAGE" }));
  });

  it("源图快照读不到(迁移前的老图)→ 诚实回落 1:1,不去反推像素", async () => {
    db.genJobFindFirst.mockImplementation(sourceSnapshot(null));
    await startGen({ ...base, sourceGenerationId: "gen_old", idempotencyKey: "shape-6" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "1:1" });
  });

  it("源图那一单根本不存在 → 同样回落 1:1(绝不抛、绝不挡住付费路径)", async () => {
    db.genJobFindFirst.mockImplementation(async () => null);
    await startGen({ ...base, sourceGenerationId: "gen_missing", idempotencyKey: "shape-7" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "1:1" });
  });

  it("源图快照里是个下线画幅 → 不靠继承绕过契约,回落 1:1", async () => {
    db.genJobFindFirst.mockImplementation(sourceSnapshot({ aspectRatio: "5:7" }));
    await startGen({ ...base, sourceGenerationId: "gen_legacy", idempotencyKey: "shape-9" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "1:1" });
  });

  it("商家明确另选了画幅 → 以商家为准,不被源图覆盖", async () => {
    db.genJobFindFirst.mockImplementation(sourceSnapshot({ aspectRatio: "9:16" }));
    await startGen({ ...base, sourceGenerationId: "gen_src", aspectRatio: "16:9", idempotencyKey: "shape-8" });
    expect(createdData().imageOptions).toEqual({ aspectRatio: "16:9" });
  });

  it("画幅不动价格:八个画幅报出来的预扣完全相同(引擎按张计价)", async () => {
    const costs: number[] = [];
    for (const [i, a] of ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"].entries()) {
      vi.clearAllMocks();
      db.projectFindFirst.mockResolvedValue({ id: "p1" });
      db.genJobFindFirst.mockResolvedValue(null);
      db.genJobFindMany.mockResolvedValue([]);
      db.genJobCreate.mockResolvedValue({ id: "job_ref" });
      db.reserveCredits.mockResolvedValue({ ok: true });
      mockRequireOwner.mockResolvedValue({ email: "owner@example.test", ownerId: "org_ref" });
      mockIsImpersonating.mockResolvedValue(false);
      mockCheckCast.mockResolvedValue(null);
      mockResolveDisabledModels.mockResolvedValue(new Set());
      mockGetBoss.mockResolvedValue({ send: mockBossSend });
      mockBossSend.mockImplementation(async (_n: string, _d: unknown, o: { id?: string }) => o.id ?? null);
      await startGen({ ...base, count: 2, aspectRatio: a, idempotencyKey: `price-${i}` });
      costs.push(db.reserveCredits.mock.calls[0]?.[1]?.cost as number);
    }
    expect(new Set(costs).size).toBe(1);
    expect(costs[0]).toBe(2 * INTERNAL_PER_DISPLAY);
  });
});
