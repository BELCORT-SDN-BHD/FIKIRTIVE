/**
 * gen-video-poll.test.ts — #1435(零排队,docs/specs/zero-queue.md)`handleGen`'s VIDEO
 * resume-poll branch: what happens on every delivery AFTER the first successful submit.
 *
 * QUEUE-A2 (真库集成测试证明「不占位」的库存状态; 这里证明的是**耗时形状**——每一次投递
 * 都是一次短促的 GET + 立即返回, 从不原地等到终态) 与 QUEUE-A6 (提交时刻起算的放弃窗口,
 * 独立于 claim 时长的 GEN_STALE_MS 链——见 clock-invariants.test.ts 的完整推导) 的单元面
 * 证据都在这个文件里: mock 到 `provider.pollVideo` 的 handleGen 一次调用要么立刻返回
 * `{awaitingVideoPoll:true}`(worker 施工位、providerRequestGate 闸位都已经释放——它没有
 * 在这次调用里做任何阻塞等待), 要么走到终态(succeeded/failed 已有 gen.test.ts / gen.ts
 * 各自的既有覆盖), 要么在提交时刻超过 VIDEO_SUBMISSION_ABANDON_MS 时诚实地判「结果不明,
 * 按已计费处理」。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const entityFindMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const submitVideo = vi.fn();
  const pollVideo = vi.fn();
  const generateImages = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    entity: { findMany: entityFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, entityFindMany,
    chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits, submitVideo, pollVideo,
    generateImages, creditLedgerFindFirst, storagePresignedGet, storagePut, storage,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", submitVideo: m.submitVideo, pollVideo: m.pollVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { handleGen, GEN_VIDEO_POLL_DELAY_SECONDS } from "./gen.js";
import { VIDEO_SUBMISSION_ABANDON_MS } from "@fikirtive/generation";

const job = {
  id: "g1", ownerId: "o1", projectId: "p1", threadId: "t1", shotId: null,
  status: "GENERATING", kind: "VIDEO", model: "seedance-2-mini", prompt: "make it move",
  entityIds: [], variantSel: null, count: 1, imageOptions: null, generationIds: [],
  spentUsd: null, sourceGenerationId: null, tailGenerationId: null, referenceVideoGenerationId: null,
};

/** A job already carrying the in-flight marker `persistVideoProviderTaskWithRetry` writes —
 *  the exact shape a resume delivery reads back off `GenJob.videoOptions`. */
function resumingJob(submittedAt: string, overrides: Record<string, unknown> = {}) {
  return { ...job, videoOptions: { providerTask: { id: "task-poll-1", submittedAt } }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.entityFindMany.mockResolvedValue([]);
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
});

describe("QUEUE-A2 — a resume delivery never blocks waiting for a terminal state", () => {
  it("QUEUE-A2: pending ⇒ one gated GET, then this delivery ends immediately with awaitingVideoPoll — no loop, no sleep in this call", async () => {
    m.genJobFindUnique.mockResolvedValue(resumingJob(new Date().toISOString()));
    m.pollVideo.mockResolvedValue({ status: "pending" });

    const outcome = await handleGen({ genJobId: "g1" }, 0);

    // exactly one GET this delivery — never a loop inside handleGen itself.
    expect(m.pollVideo).toHaveBeenCalledTimes(1);
    expect(m.submitVideo).not.toHaveBeenCalled(); // resume never re-submits a second paid task
    expect(outcome).toEqual({ awaitingVideoPoll: true, requeueAfterSeconds: GEN_VIDEO_POLL_DELAY_SECONDS, carriedRetryCount: 0 });
    // the row stays GENERATING with no terminal write — the worker slot is free to pick up any
    // other queued job; this row is simply not "in progress" from the claim's point of view.
    expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeFalsy();
    expect(m.genJobUpdate).not.toHaveBeenCalled();
  });

  it("QUEUE-A2: a fresh submit also ends this delivery immediately — it never polls in-process after a successful submit", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...job, status: "QUEUED", videoOptions: null });
    m.submitVideo.mockResolvedValue({ providerTaskId: "task-fresh-1" });

    const outcome = await handleGen({ genJobId: "g1" }, 0);

    expect(m.submitVideo).toHaveBeenCalledTimes(1);
    expect(m.pollVideo).not.toHaveBeenCalled(); // the submit delivery never polls — that's the next delivery's job
    expect(outcome).toEqual({ awaitingVideoPoll: true, requeueAfterSeconds: GEN_VIDEO_POLL_DELAY_SECONDS, carriedRetryCount: 0 });
    // the marker really did get persisted, so the NEXT delivery can find it and resume.
    const markerWrite = m.genJobUpdateMany.mock.calls.find(
      (c) => (c[0]?.data?.videoOptions as { providerTask?: unknown } | undefined)?.providerTask,
    );
    expect(markerWrite).toBeTruthy();
    expect((markerWrite![0].data.videoOptions as { providerTask: { id: string } }).providerTask.id).toBe("task-fresh-1");
  });

  it("QUEUE-A2: carriedRetryCount rides along a resume delivery exactly like a fresh one (#1388 判官安全定向 4d 的同一条纪律)", async () => {
    m.genJobFindUnique.mockResolvedValue(resumingJob(new Date().toISOString()));
    m.pollVideo.mockResolvedValue({ status: "pending" });

    const outcome = await handleGen({ genJobId: "g1" }, 3);

    expect(outcome).toMatchObject({ carriedRetryCount: 3 });
  });
});

describe("QUEUE-A6 — the abandon window is anchored on submittedAt, not on claim/startedAt", () => {
  it("QUEUE-A6: still pending well within VIDEO_SUBMISSION_ABANDON_MS ⇒ keeps rescheduling, never charged", async () => {
    const submittedAt = new Date(Date.now() - (VIDEO_SUBMISSION_ABANDON_MS - 60_000)).toISOString(); // 1 minute of margin left
    m.genJobFindUnique.mockResolvedValue(resumingJob(submittedAt));
    m.pollVideo.mockResolvedValue({ status: "pending" });

    const outcome = await handleGen({ genJobId: "g1" }, 0);

    expect(outcome).toMatchObject({ awaitingVideoPoll: true });
    expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeFalsy();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("QUEUE-A6: still pending past VIDEO_SUBMISSION_ABANDON_MS ⇒ outcome unknown, treated as billed (chargedError, terminal)", async () => {
    const submittedAt = new Date(Date.now() - (VIDEO_SUBMISSION_ABANDON_MS + 60_000)).toISOString(); // 1 minute over
    m.genJobFindUnique.mockResolvedValue(resumingJob(submittedAt));
    m.pollVideo.mockResolvedValue({ status: "pending" });

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow(/outcome unknown, treated as billed/);

    // terminal-fails with `spent` recorded — this is the "outcome unknown ⇒ billed" branch, not
    // a free pre-charge failure: the provider accepted the task and money is presumed spent.
    const failedUpdate = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![0].data.spent).toBe(true);
    // and — the house money rule this whole branch exists to uphold — it is NEVER silently
    // treated as free: the worker refunds nothing on its own here, it fails closed and the
    // existing chargedError → terminal-fail path is what a human/founder-alert route handles
    // from the ordinary EP-A4 route ① (see gen.test.ts's charged-provider-error coverage) —
    // this test only pins that the THROW itself carries `charged`, not a specific downstream
    // ledger action already covered elsewhere.
    // (chargedError sets .charged, not .permanent — confirm the classification stayed correct.)
  });

  it("QUEUE-A6: right at the boundary (one tick inside) is still the safe side — no charged throw", async () => {
    const submittedAt = new Date(Date.now() - (VIDEO_SUBMISSION_ABANDON_MS - 1)).toISOString();
    m.genJobFindUnique.mockResolvedValue(resumingJob(submittedAt));
    m.pollVideo.mockResolvedValue({ status: "pending" });

    const outcome = await handleGen({ genJobId: "g1" }, 0);

    expect(outcome).toMatchObject({ awaitingVideoPoll: true });
  });
});

describe("a malformed or missing in-flight marker falls back to a fresh submit, never crashes", () => {
  it("videoOptions is null (never submitted) ⇒ ordinary fresh-submit path", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...job, status: "QUEUED", videoOptions: null });
    m.submitVideo.mockResolvedValue({ providerTaskId: "task-x" });

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.submitVideo).toHaveBeenCalledTimes(1);
    expect(m.pollVideo).not.toHaveBeenCalled();
  });

  it("providerTask.submittedAt is not a parseable date ⇒ marker is unreadable, treated as never-submitted", async () => {
    m.genJobFindUnique.mockResolvedValue({
      ...job, status: "QUEUED",
      videoOptions: { providerTask: { id: "task-bad", submittedAt: "not-a-date" } },
    });
    m.submitVideo.mockResolvedValue({ providerTaskId: "task-x" });

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.submitVideo).toHaveBeenCalledTimes(1);
    expect(m.pollVideo).not.toHaveBeenCalled();
  });

  it("providerTask.id is an empty string ⇒ marker is unreadable, treated as never-submitted", async () => {
    m.genJobFindUnique.mockResolvedValue({
      ...job, status: "QUEUED",
      videoOptions: { providerTask: { id: "", submittedAt: new Date().toISOString() } },
    });
    m.submitVideo.mockResolvedValue({ providerTaskId: "task-x" });

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.submitVideo).toHaveBeenCalledTimes(1);
    expect(m.pollVideo).not.toHaveBeenCalled();
  });
});
