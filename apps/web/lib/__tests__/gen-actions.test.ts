import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_PER_DISPLAY, pricedGenCredits } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));

const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const db = vi.hoisted(() => {
  const projectFindFirst = vi.fn();
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
    genJob: { findFirst: genJobFindFirst, findMany: genJobFindMany, create: genJobCreate, update: genJobUpdate },
    actionEvent: { create: actionEventCreate },
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma,
    projectFindFirst,
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

const mockBossSend = vi.fn();
vi.mock("../queue", () => ({ getBoss: vi.fn(async () => ({ send: mockBossSend })) }));

const mockCheckCast = vi.fn();
vi.mock("../cowork-guardian", () => ({ checkCast: mockCheckCast }));

const mockResolveDisabledModels = vi.fn();
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabledModels }));

const { startGen } = await import("../gen-actions");

const prevDefaultVideoModel = process.env.OTTO_DEFAULT_VIDEO_MODEL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OTTO_DEFAULT_VIDEO_MODEL = "seedance-2-fast";
  mockRequireOwner.mockResolvedValue({ email: "owner@example.test", ownerId: "org_ref" });
  mockIsImpersonating.mockResolvedValue(false);
  db.projectFindFirst.mockResolvedValue({ id: "p1" });
  db.genJobFindFirst.mockResolvedValue(null);
  db.genJobFindMany.mockResolvedValue([]);
  db.genJobCreate.mockResolvedValue({ id: "job_ref" });
  db.genJobUpdate.mockResolvedValue({});
  db.actionEventCreate.mockResolvedValue({});
  db.reserveCredits.mockResolvedValue({ ok: true });
  db.refundReservation.mockResolvedValue({ ok: true });
  db.executeRaw.mockResolvedValue(undefined);
  mockBossSend.mockResolvedValue("queue-job-1");
  mockCheckCast.mockResolvedValue(null);
  mockResolveDisabledModels.mockResolvedValue(new Set());
});

afterEach(() => {
  if (prevDefaultVideoModel === undefined) delete process.env.OTTO_DEFAULT_VIDEO_MODEL;
  else process.env.OTTO_DEFAULT_VIDEO_MODEL = prevDefaultVideoModel;
});

describe("startGen", () => {
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
    expect(mockBossSend).toHaveBeenCalledWith("gen", { genJobId: "job_ref" });
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
});
