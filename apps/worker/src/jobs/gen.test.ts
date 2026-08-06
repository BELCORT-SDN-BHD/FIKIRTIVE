/**
 * gen.test.ts — handleGen VIDEO branch, whole-clip reference video (整段视频参考)
 * resolution: an owned, in-project, video-ext Generation must resolve before the
 * paid provider.generateVideo call; a set-but-unresolvable reference must fail
 * closed (failClosedWithRefund) and the provider must NEVER be called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEN_PRICE_USD_PER_IMAGE } from "@fikirtive/core/gen";

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
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const assetUpsert = vi.fn();
  const generationCreate = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate },
    asset: { upsert: assetUpsert },
    entity: { findMany: entityFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    entityFindMany, chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits, generateVideo,
    generateImages, creditLedgerFindFirst, storagePresignedGet, storagePut, assetUpsert,
    generationCreate, storage,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, // #601: the delivery path ends by writing the job's canvas cards. Stubbed so these suites
  // exercise the money path they are about, not a swallowed canvas error.
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })) }));
vi.mock("../storage.js", () => ({ storage: m.storage }));
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
  m.storage.presignedGet = m.storagePresignedGet;
  m.storage.put = m.storagePut;
  m.prisma.asset = { upsert: m.assetUpsert };
  m.prisma.generation = { findFirst: m.generationFindFirst, create: m.generationCreate };
  m.genJobFindUnique.mockResolvedValue(job);
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // wins the QUEUED→GENERATING claim
  m.entityFindMany.mockResolvedValue([]); // no @mentioned entities in these tests
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null); // no REFUND row by default
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.generationCreate.mockResolvedValue({ id: "gen_out1" });
});

/**
 * #602 r2 (judge P1-2) — a job's status is decided ONCE, by whoever gets there first.
 *
 * `handleGen` snapshots the job row at the top and then runs a long sequence of gates against
 * that snapshot. A merchant can press Cancel anywhere in that window. Every terminal write here
 * is therefore conditional on the row still being in flight: `count === 0` means someone else
 * already ended the job, wrote the truth, and did their own money and messaging.
 *
 * (Money is unaffected either way — `refundReservation` is idempotent on `refund:<jobId>`. What
 * an unconditional write destroyed was the TRUTH about who stopped the job, and it put an
 * apology for a failure on top of the merchant's own decision.)
 */
describe("handleGen — a cancellation that lands after the job snapshot", () => {
  it("is left alone: no overwrite, no second refund, no failure message", async () => {
    // Pre-claim fail-closed branch (the project was deleted), reached after the merchant's cancel
    // already set CANCELLED and refunded.
    m.projectFindFirst.mockResolvedValue(null);
    m.genJobUpdateMany.mockResolvedValue({ count: 0 }); // no in-flight row left to terminal-fail

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.genJobUpdate).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("still fails closed + refunds + tells the merchant when the job IS still in flight", async () => {
    m.projectFindFirst.mockResolvedValue(null);
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // we won: the row was still ours to end

    await handleGen({ genJobId: "g1" }, 0);

    const terminal = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(terminal).toBeTruthy();
    // The guard is spelled in the WHERE, so it holds in the database rather than between reads.
    expect(terminal![0].where).toMatchObject({ id: "g1", ownerId: "o1", status: { in: ["QUEUED", "GENERATING"] } });
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
  });
});

describe("handleGen VIDEO — reference video resolution (fail-closed)", () => {
  it("reference video set but not found → fail closed, no spend", async () => {
    m.generationFindFirst.mockResolvedValue(null); // the reference video Generation doesn't resolve
    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).not.toHaveBeenCalled();
    // failClosedWithRefund: a GUARDED FAILED write (#602 r2) + refund + TURN_ERROR
    expect(m.genJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "g1", ownerId: "o1", status: { in: ["QUEUED", "GENERATING"] } } }),
    );
    const updateCall = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
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
    const updateCall = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
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

// ── #646 修复轮 P0-1:尾帧无首帧,是钱路上的静默降级 ────────────────────────────
// 判官 r1 抓到的洞:zod 闸只问模型支不支持尾帧,worker 的尾帧解析又被
// `job.tailGenerationId && sourceAsset` 短路 —— 首帧缺席时尾帧被消隐,适配器那道守卫
// 连原请求都看不到,于是引擎出一支普通视频、商家按尾帧那一单付钱。上一轮只测了适配器
// 接口,没测这条真钱路。这里走**真** handleGen。
describe("handleGen VIDEO — 尾帧无首帧(#646 P0-1 钱缝纵深)", () => {
  const tailNoSourceJob = {
    ...job,
    referenceVideoGenerationId: null,
    sourceGenerationId: null, // 没有显式首帧
    shotId: null,             // 也没有能取到首帧的分镜格
    tailGenerationId: "gen_tail",
  };

  it("尾帧但无首帧来源 ⇒ provider 一次都不调、失败退款,而不是静默降级成普通视频照常扣费", async () => {
    m.genJobFindUnique.mockResolvedValue(tailNoSourceJob);

    await handleGen({ genJobId: "g1" }, 0);

    // 这一行就是本条的全部要害:钱路上不许出现「尾帧没了但片子照出」。
    expect(m.generateVideo).not.toHaveBeenCalled();
    const updateCall = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(updateCall).toBeTruthy();
    expect(updateCall![0].data.error).toMatch(/start frame/);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.chatMessageCreate).toHaveBeenCalledTimes(1);
    expect(m.chatMessageCreate.mock.calls[0]![0].data).toMatchObject({ kind: "TURN_ERROR", genJobId: "g1" });
  });

  it("首帧在场时这道守卫不挡路 —— 尾帧照常解析并随请求进引擎", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...tailNoSourceJob, sourceGenerationId: "gen_src" });
    // 首帧与尾帧两次 findFirst 都命中
    m.generationFindFirst.mockResolvedValue({ id: "gen_x", asset: { ownerId: "o1", contentHash: "a".repeat(64), ext: "png" } });
    const storageModule = await import("../storage.js");
    (storageModule.storage as unknown as { presignedGet: (k: string, t: number) => Promise<string> }).presignedGet = vi.fn(async () => "https://signed/frame.png");
    (storageModule.storage as unknown as { put: (b: Uint8Array, e: string) => Promise<{ contentHash: string; ext: string }> }).put = vi.fn(async () => ({ contentHash: "outhash", ext: "mp4" }));
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), ext: "mp4" });
    m.prisma.asset = { upsert: vi.fn(async () => ({ id: "asset1" })) };
    m.prisma.generation.create = vi.fn(async () => ({ id: "gen_out1" }));

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).toHaveBeenCalledTimes(1);
    expect(m.generateVideo.mock.calls[0]![0].tailImageUrl).toBe("https://signed/frame.png");
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

    const failedUpdate = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
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
    expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeFalsy();
    expect(m.chatMessageCreate).not.toHaveBeenCalled();
  });

  it("a pre-charge rejection on the LAST retry terminal-fails + refunds once (spent stays false)", async () => {
    m.genJobFindUnique.mockResolvedValue(imageJob);
    m.generateImages.mockRejectedValue(new Error("provider validation refused the prompt"));

    await expect(handleGen({ genJobId: "g1" }, GEN_RETRY_LIMIT)).rejects.toThrow();

    const failedUpdate = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
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
    expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED")).toBeTruthy();
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
    const failedUpdate = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
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

describe("handleGen — count 2-4 exactly-count guard (D-035 / issue #311)", () => {
  // D-035 裁定：一个 image GenJob 是「一笔 hold、一次 provider 调用、一个 finalizer」。
  // provider 已收费却少返/多返时，worker 必须把整单 terminal fail-closed：全额释放 hold、
  // 零 settle、零影子资产、零 provider retry，同时保留 spent/spentUsd 成本审计。
  const countJob = { ...imageJob, count: 4 };

  it("the real BytePlus charged partial form fail-closes the whole job with a full refund", async () => {
    m.genJobFindUnique.mockResolvedValue(countJob);
    m.generateImages.mockRejectedValue(Object.assign(new Error("byteplus image: only 2/4 usable"), { charged: true }));

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow(/only 2\/4/);

    const failedUpdate = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![0].data.spent).toBe(true); // the billed sub-images stay auditable (paid-but-undelivered)
    expect(m.refundReservation).toHaveBeenCalledTimes(1); // the FULL count-hold releases — not "only the failed cells"
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.settleCredits).not.toHaveBeenCalled(); // and no partial settle for the 2 usable sub-images
  });

  it("commits and settles a normal exact count=4 return", async () => {
    m.genJobFindUnique.mockResolvedValue(countJob);
    m.generateImages.mockResolvedValue([1, 2, 3, 4].map((byte) => ({ bytes: new Uint8Array([byte]), ext: "png" })));
    m.storagePut.mockImplementation(async (_owner, bytes: Uint8Array) => ({ contentHash: `hash-${bytes[0]}` }));
    let created = 0;
    m.generationCreate.mockImplementation(async () => ({ id: `gen_out${++created}` }));

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateImages).toHaveBeenCalledTimes(1);
    expect(m.storagePut).toHaveBeenCalledTimes(4);
    expect(m.assetUpsert).toHaveBeenCalledTimes(4);
    expect(m.generationCreate).toHaveBeenCalledTimes(4);
    expect(m.settleCredits).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.generationIds)).toBeTruthy();
    expect(m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE")).toBeTruthy();
  });

  it.each([
    ["empty", []],
    ["short", [
      { bytes: new Uint8Array([1]), ext: "png" },
      { bytes: new Uint8Array([2]), ext: "png" },
      { bytes: new Uint8Array([3]), ext: "png" },
    ]],
    ["over", [
      { bytes: new Uint8Array([1]), ext: "png" },
      { bytes: new Uint8Array([2]), ext: "png" },
      { bytes: new Uint8Array([3]), ext: "png" },
      { bytes: new Uint8Array([4]), ext: "png" },
      { bytes: new Uint8Array([5]), ext: "png" },
    ]],
  ])("R-EP-02b regression: a silent %s return terminal-fails before storage or DB output commit", async (_label, outputs) => {
    m.genJobFindUnique.mockResolvedValue(countJob);
    m.generateImages.mockResolvedValue(outputs);

    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow(/expected 4 outputs/);

    expect(m.generateImages).toHaveBeenCalledTimes(1); // paid provider is never retried
    expect(m.storagePut).not.toHaveBeenCalled();
    expect(m.assetUpsert).not.toHaveBeenCalled();
    expect(m.generationCreate).not.toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: "o1", refId: "g1" });

    const failedUpdate = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![0].data).toMatchObject({ status: "FAILED", spent: true });
    // frozen count=4 COGS remains auditable. Derived from the constant, not a literal, so a
    // COGS re-basing (#644: $0.04 → $0.035/张) can never leave a stale number asserted here.
    expect(failedUpdate![0].data.spentUsd).toBeCloseTo(GEN_PRICE_USD_PER_IMAGE * 4);
    expect(m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "DONE")).toBeFalsy();
    expect(m.genJobUpdateMany.mock.calls.some((c) => Array.isArray(c[0]?.data?.generationIds))).toBe(false);
    expect(m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "QUEUED")).toBeFalsy();
    expect(m.chatMessageCreate.mock.calls.some((c) => c[0]?.data?.kind === "GEN_RESULT")).toBe(false);
  });
});
