/**
 * gen.test.ts — handleGen VIDEO branch, whole-clip reference video (整段视频参考)
 * resolution: an owned, in-project, video-ext Generation must resolve before the
 * paid provider.generateVideo call; a set-but-unresolvable reference must fail
 * closed (failClosedWithRefund) and the provider must NEVER be called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const entityFindMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateVideo = vi.fn();
  const generateImages = vi.fn();
  const creditLedgerFindFirst = vi.fn();
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
    entityFindMany, chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits, generateVideo,
    generateImages, creditLedgerFindFirst,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits }));
vi.mock("../storage.js", () => ({ storage: { presignedGet: vi.fn(), put: vi.fn() } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { GEN_RETRY_LIMIT } from "@fikirtive/core";
import { handleGen } from "./gen.js";

const job = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: "t1",
  shotId: null,
  status: "QUEUED",
  kind: "VIDEO",
  model: "seedance-2-fast",
  prompt: "make it move",
  entityIds: [],
  variantSel: null,
  count: 1,
  videoOptions: null,
  generationIds: [],
  spentUsd: null,
  sourceGenerationId: null,
  tailGenerationId: null,
  referenceVideoGenerationId: "gen_ref_missing",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.genJobFindUnique.mockResolvedValue(job);
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // wins the QUEUED→GENERATING claim
  m.entityFindMany.mockResolvedValue([]); // no @mentioned entities in these tests
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null); // no REFUND row by default
});

describe("handleGen VIDEO — reference video resolution (fail-closed)", () => {
  it("reference video set but not found → fail closed, no spend", async () => {
    m.generationFindFirst.mockResolvedValue(null); // the reference video Generation doesn't resolve
    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).not.toHaveBeenCalled();
    // failClosedWithRefund: FAILED + refund + TURN_ERROR
    expect(m.genJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "g1" } }),
    );
    const updateCall = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(updateCall).toBeTruthy();
    expect(updateCall![0].data.error).toContain("reference video");
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1" });
  });

  it("reference video longer than the 2–6s window → fail closed, no spend (margin guard)", async () => {
    // The client gates 2–6s, but a hand-crafted request could attach a long clip: BytePlus
    // bills by input duration while we charge flat per resolution — a margin leak. Ingest's
    // ffprobe stores Asset.durationS; enforce the window server-side when the probe value exists.
    const asset = { ownerId: "o1", contentHash: "a".repeat(64), ext: "mp4", durationS: 25 };
    m.generationFindFirst.mockResolvedValue({ id: "gen_ref_long", asset });

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).not.toHaveBeenCalled();
    const updateCall = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(updateCall).toBeTruthy();
    expect(updateCall![0].data.error).toMatch(/2.*6/);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
  });

  it("reference video with durationS null (ingest probe pending/failed) → allowed (client already gated)", async () => {
    const asset = { ownerId: "o1", contentHash: "a".repeat(64), ext: "mp4", durationS: null };
    m.generationFindFirst.mockResolvedValue({ id: "gen_ref_noprobe", asset });
    const storageModule = await import("../storage.js");
    (storageModule.storage as unknown as { presignedGet: (k: string, t: number) => Promise<string> }).presignedGet = vi.fn(async () => "https://signed/ref.mp4");
    (storageModule.storage as unknown as { put: (b: Uint8Array, e: string) => Promise<{ contentHash: string; ext: string }> }).put = vi.fn(async () => ({ contentHash: "outhash", ext: "mp4" }));
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), ext: "mp4" });
    m.prisma.asset = { upsert: vi.fn(async () => ({ id: "asset1" })) };
    m.prisma.generation.create = vi.fn(async () => ({ id: "gen_out1" }));

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).toHaveBeenCalledTimes(1);
  });

  it("reference video resolved → refVideoUrl passed to provider.generateVideo", async () => {
    const asset = { ownerId: "o1", contentHash: "a".repeat(64), ext: "mp4" };
    m.generationFindFirst.mockResolvedValue({ id: "gen_ref_missing", asset });
    const presignedGet = vi.fn(async () => "https://signed/ref.mp4");
    // reach into the mocked storage module to stub presignedGet's return value
    const storageModule = await import("../storage.js");
    (storageModule.storage as unknown as { presignedGet: typeof presignedGet }).presignedGet = presignedGet;
    const storagePut = vi.fn(async () => ({ contentHash: "outhash", ext: "mp4" }));
    (storageModule.storage as unknown as { put: typeof storagePut }).put = storagePut;

    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), ext: "mp4" });
    m.prisma.asset = { upsert: vi.fn(async () => ({ id: "asset1" })) };
    m.prisma.generation.create = vi.fn(async () => ({ id: "gen_out1" }));

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).toHaveBeenCalledTimes(1);
    const arg = m.generateVideo.mock.calls[0]![0];
    expect(arg.refVideoUrl).toBe("https://signed/ref.mp4");
  });
});

// ── W-B3-E-P 查漏 (2026-07-14): EP-A4 fail-closed 四路中的 worker 三路 ──────────────
// provider 拒绝(①) / 超时(②) / worker 崩溃恢复(③) —— 每路断言终态、退款恰一次、无双扣、
// provider 永不重调。第四路(取消 cancelGenJob)是 web 动作,unit 面在 cancel-gen-job.test.ts,
// 真账本面在 apps/web/lib/__tests__/gen-ledger.test.ts。真账本退款算术同在 gen-ledger.test.ts;
// 这里钉的是 worker 的路由:哪条失败走 refund、哪条走 settle、哪条谁都不许碰。

const imageJob = {
  ...job,
  kind: "IMAGE",
  model: "seedream",
  count: 1,
  referenceVideoGenerationId: null,
};

describe("handleGen — provider rejection fail-closed (EP-A4 route ①)", () => {
  it("a charged provider error terminal-fails, refunds exactly once, records spent, never settles", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.generateImages.mockRejectedValue(Object.assign(new Error("provider rejected the request"), { charged: true }));

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow(/rejected/);

    const failedUpdate = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![0].data.spent).toBe(true); // paid-but-undelivered stays auditable
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.settleCredits).not.toHaveBeenCalled();
    // the terminal "not charged" message reaches the user exactly once
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1" });
  });

  it("a pre-charge rejection with retries left requeues and KEEPS the hold — no refund, no settle, no terminal message", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.generateImages.mockRejectedValue(new Error("429 too many requests"));

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();

    // requeued via the F04 status-guarded updateMany, never terminal
    const requeue = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "QUEUED");
    expect(requeue).toBeTruthy();
    expect(requeue![0].where.status).toEqual({ in: ["QUEUED", "GENERATING"] });
    expect(m.refundReservation).not.toHaveBeenCalled(); // the hold survives for the retry / a later finalizer
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeFalsy();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("a pre-charge rejection on the LAST retry terminal-fails + refunds once (spent stays false)", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.generateImages.mockRejectedValue(new Error("provider validation refused the prompt"));

    await expect(handleGen({ genJobId: "g1" }, GEN_RETRY_LIMIT)).rejects.toThrow();

    const failedUpdate = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![0].data.spent).toBe(false); // a free pre-charge failure, told apart from a paid one
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).not.toHaveBeenCalled();
  });
});

describe("handleGen — provider timeout fail-closed (EP-A4 route ②)", () => {
  it("a timeout on the last delivery terminal-fails + refunds exactly once", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.generateImages.mockRejectedValue(new Error("fal request timed out after 20 minutes"));

    await expect(handleGen({ genJobId: "g1" }, GEN_RETRY_LIMIT)).rejects.toThrow(/timed out/);

    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeTruthy();
  });

  it("an expired in-flight call (lost claim, STALE owner) fails closed + refunds once — provider never re-called", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.genJobUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // lost the QUEUED→GENERATING claim
      .mockResolvedValueOnce({ count: 1 }); // ...and the stale fail-close wins the stuck row

    await handleGen({ genJobId: "g1" }, 1);

    expect(m.generateImages).not.toHaveBeenCalled(); // a possibly-paid call is never repeated
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR" });
    expect(m.chatMessageCreate.mock.calls[0]![0].data.text).toMatch(/weren't charged/);
  });

  it("a lost claim with a RECENT owner leaves the live winner alone — no refund, no message (no false double-refund)", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.genJobUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // lost the claim
      .mockResolvedValueOnce({ count: 0 }); // stale filter matches nothing → the winner is actively running

    await handleGen({ genJobId: "g1" }, 1);

    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });
});

describe("handleGen — worker-crash recovery (EP-A4 route ③ / 六态⑥恢复)", () => {
  const committedJob = {
    ...imageJob,
    status: "GENERATING",
    generationIds: ["gen_done1"],
    spent: true,
    spentUsd: 0.04,
  };

  it("a redelivery of a committed job resumes: provider never re-called, settle exactly once, no refund, DONE", async () => {
    m.genJobFindUnique.mockResolvedValue(committedJob);
    m.creditLedgerFindFirst.mockResolvedValue(null); // no REFUND row → deliverable

    await handleGen({ genJobId: "g1" }, 1);

    expect(m.generateImages).not.toHaveBeenCalled(); // exactly-once spend: a resume never re-spends
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE")).toBeTruthy();
    // the user gets the RESULT message, never a spurious error
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "GEN_RESULT", genJobId: "g1" });
  });

  it("free-delivery guard: outputs recorded but a REFUND won — fail closed, never deliver, never touch money again", async () => {
    m.genJobFindUnique.mockResolvedValue(committedJob);
    m.creditLedgerFindFirst.mockResolvedValue({ id: "refund-row" }); // the merchant already got their money back

    await handleGen({ genJobId: "g1" }, 1);

    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled(); // no re-settle against a refunded hold
    expect(m.refundReservation).not.toHaveBeenCalled(); // and no double refund
    const failedUpdate = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![0].data.error).toMatch(/refunded/);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR" });
    expect(m.chatMessageCreate.mock.calls[0]![0].data.text).toMatch(/weren't charged/);
  });

  it("a FAILED job with no recorded outputs is terminal — no provider call, no money movement at all", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...imageJob, status: "FAILED" });

    await handleGen({ genJobId: "g1" }, 2);

    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.genJobUpdate).not.toHaveBeenCalled();
  });
});
