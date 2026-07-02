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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst },
    entity: { findMany: entityFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    entityFindMany, chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits, generateVideo,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits }));
vi.mock("../storage.js", () => ({ storage: { presignedGet: vi.fn(), put: vi.fn() } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: vi.fn() } }));
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

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

  it("reference video longer than the 2–10s window → fail closed, no spend (margin guard)", async () => {
    // The client gates 2–10s, but a hand-crafted request could attach a long clip: BytePlus
    // bills by input duration while we charge flat per resolution — a margin leak. Ingest's
    // ffprobe stores Asset.durationS; enforce the window server-side when the probe value exists.
    const asset = { ownerId: "o1", contentHash: "a".repeat(64), ext: "mp4", durationS: 25 };
    m.generationFindFirst.mockResolvedValue({ id: "gen_ref_long", asset });

    await handleGen({ genJobId: "g1" }, 0);

    expect(m.generateVideo).not.toHaveBeenCalled();
    const updateCall = m.genJobUpdate.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(updateCall).toBeTruthy();
    expect(updateCall![0].data.error).toMatch(/2.*10/);
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
