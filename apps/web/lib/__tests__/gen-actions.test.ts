import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));

const mockIsImpersonating = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const db = vi.hoisted(() => {
  const projectFindFirst = vi.fn();
  const genJobFindFirst = vi.fn();
  const genJobCreate = vi.fn();
  const genJobUpdate = vi.fn();
  const actionEventCreate = vi.fn();
  const reserveCredits = vi.fn();
  const refundReservation = vi.fn();
  const executeRaw = vi.fn();
  const prisma = {
    project: { findFirst: projectFindFirst },
    genJob: { findFirst: genJobFindFirst, create: genJobCreate, update: genJobUpdate },
    actionEvent: { create: actionEventCreate },
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma,
    projectFindFirst,
    genJobFindFirst,
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

vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => new Set()) }));

const { startGen } = await import("../gen-actions");

const prevDefaultVideoModel = process.env.OTTO_DEFAULT_VIDEO_MODEL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OTTO_DEFAULT_VIDEO_MODEL = "seedance-2-fast";
  mockRequireOwner.mockResolvedValue({ email: "owner@example.test", ownerId: "org_ref" });
  mockIsImpersonating.mockResolvedValue(false);
  db.projectFindFirst.mockResolvedValue({ id: "p1" });
  db.genJobFindFirst.mockResolvedValue(null);
  db.genJobCreate.mockResolvedValue({ id: "job_ref" });
  db.genJobUpdate.mockResolvedValue({});
  db.actionEventCreate.mockResolvedValue({});
  db.reserveCredits.mockResolvedValue({ ok: true });
  db.refundReservation.mockResolvedValue({ ok: true });
  db.executeRaw.mockResolvedValue(undefined);
  mockBossSend.mockResolvedValue("queue-job-1");
  mockCheckCast.mockResolvedValue(null);
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

    expect(result).toEqual({ id: "job_ref" });
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
});
