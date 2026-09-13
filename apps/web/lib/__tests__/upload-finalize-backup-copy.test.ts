/**
 * upload-finalize-backup-copy.test.ts — MEDIA-durability(判官第二轮 P1-5,Founder 2026-09-13
 * 对谈已裁选项 (a))。
 *
 * 背景:直传上传(presigned PUT/multipart)的字节从浏览器直接进内容桶,从来不经过
 * `R2Storage.put()`,所以写路径的同步复制(`replicateToBackup`)从未跑过这些对象——判官第一
 * 轮的判红就是这个缺口。修法是在 `finalizeCandidateUploads` 的尺寸复核**通过之后**,对每个
 * 刚验完的 key 补一刀 `storage.copyToBackup(key)`(服务器端 CopyObject,字节不过 web 进程)。
 *
 * 这份文件只钉 finalize 这一侧的调用契约,不重复 packages/storage 里对 CopyObject 本身的
 * 白盒测试(见 `packages/storage/src/r2-media-backup-replication.test.ts` 的
 * "copyToBackup() 服务器端跨桶复制" 一组)——这里 mock 掉整个 storage,只看「该调的时候调了
 * 没有,调用失败会不会反过来搞砸 finalize」。
 *
 * mock 形状照抄 `upload-ingest-dispatch.test.ts`(同一个 finalizeCandidateUploads 调用面)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { storageKey, UPLOAD_SINGLE_MAX_BYTES } from "@fikirtive/core";

const { mockOwner, mockStorage, mockSend } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockStorage: {
    supportsDirectUpload: true,
    exists: vi.fn(),
    put: vi.fn(),
    presignedPut: vi.fn(),
    createMultipart: vi.fn(),
    completeMultipart: vi.fn(),
    sizeOf: vi.fn(),
    readStream: vi.fn(),
    deleteObject: vi.fn(),
    copyToBackup: vi.fn(),
  },
  mockSend: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/storage", () => ({ storage: mockStorage }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: mockSend })) }));
vi.mock("@/lib/entity-snapshot", () => ({ buildEntitySnapshot: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit-gates", () => ({ consumeUploadGate: vi.fn(async () => true) }));
vi.mock("@sentry/node", () => ({ captureMessage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let assetSeq = 0;
vi.mock("@fikirtive/db", () => {
  const prisma = {
    project: { findFirst: vi.fn(async () => ({ id: "proj_1" })) },
    asset: { upsert: vi.fn(async () => ({ id: `asset_${++assetSeq}` })), count: vi.fn(async () => 0) },
    generation: { create: vi.fn(async () => ({ id: `gen_${assetSeq}` })) },
    actionEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

import { finalizeCandidateUploads } from "../upload-actions";

const OWNER = "org_1";
const SHA = "a".repeat(64);
const SIZE = 64;
const EXT = "png";
/** 一段真的 PNG 前缀,让 finalize 的字节嗅探读到一张真图。 */
const PNG_PREFIX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0,
  1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);
const EXPECTED_KEY = storageKey(OWNER, SHA, EXT);

const receipt = (upload: { mode: "existed" } | { mode: "single" } | { mode: "multipart"; uploadId: string; parts: { partNumber: number; etag: string }[] }) => ({
  sha256: SHA,
  ext: EXT,
  sizeBytes: SIZE,
  originalFilename: "merchant.png",
  upload,
});

beforeEach(() => {
  vi.clearAllMocks();
  assetSeq = 0;
  mockOwner.mockResolvedValue({ ownerId: OWNER, email: "a@b.c" });
  mockStorage.supportsDirectUpload = true;
  mockStorage.sizeOf.mockResolvedValue(SIZE);
  mockStorage.readStream.mockImplementation(async () =>
    (async function* () {
      yield PNG_PREFIX;
    })(),
  );
  mockStorage.copyToBackup.mockResolvedValue(undefined);
  mockSend.mockResolvedValue("job-id");
});

describe("MEDIA-durability P1-5 —— finalize 尺寸复核通过后补一刀 copyToBackup", () => {
  it("mode:'single' 尺寸复核通过 → 用正确的 key 调了恰好一次 copyToBackup", async () => {
    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt({ mode: "single" })]);

    expect(res).toMatchObject({ ok: true, count: 1 });
    expect(mockStorage.copyToBackup).toHaveBeenCalledTimes(1);
    expect(mockStorage.copyToBackup).toHaveBeenCalledWith(EXPECTED_KEY);
  });

  it("mode:'multipart' 尺寸复核通过 → completeMultipart 与 copyToBackup 都调了,顺序是先收尾再复制", async () => {
    // multipart 只有 sizeBytes > UPLOAD_SINGLE_MAX_BYTES 才是合法形状(否则 authorize 本来
    // 就该发单 PUT,schema 的 superRefine 会拒收)——UPLOAD_PART_BYTES 与它同为 64 MiB,
    // 所以超过它的最小合法形状恰好是两个 part。
    const bigSize = UPLOAD_SINGLE_MAX_BYTES + 1024;
    mockStorage.sizeOf.mockResolvedValue(bigSize);
    const parts = [
      { partNumber: 1, etag: "e1" },
      { partNumber: 2, etag: "e2" },
    ];
    const callOrder: string[] = [];
    mockStorage.completeMultipart.mockImplementation(async () => {
      callOrder.push("completeMultipart");
    });
    mockStorage.copyToBackup.mockImplementation(async () => {
      callOrder.push("copyToBackup");
    });

    const res = await finalizeCandidateUploads(
      "proj_1",
      "",
      [],
      [{ ...receipt({ mode: "multipart", uploadId: "u1", parts }), sizeBytes: bigSize }],
    );

    expect(res).toMatchObject({ ok: true, count: 1 });
    expect(mockStorage.completeMultipart).toHaveBeenCalledWith(EXPECTED_KEY, "u1", parts);
    expect(mockStorage.copyToBackup).toHaveBeenCalledWith(EXPECTED_KEY);
    expect(callOrder).toEqual(["completeMultipart", "copyToBackup"]);
  });

  it("mode:'existed'(dedup 命中)→ 不调 copyToBackup,与写路径 put() 的 dedup-skip 同一个理由", async () => {
    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt({ mode: "existed" })]);

    expect(res).toMatchObject({ ok: true, count: 1 });
    expect(mockStorage.copyToBackup).not.toHaveBeenCalled();
  });

  it("copyToBackup 失败(即便违反契约意外抛出)→ finalize 仍然 ok,资产仍然落地", async () => {
    mockStorage.copyToBackup.mockRejectedValue(new Error("backup bucket unreachable"));

    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt({ mode: "single" })]);

    expect(res).toMatchObject({ ok: true, count: 1, failures: [] });
    expect((res as { generationIds: string[] }).generationIds).toHaveLength(1);
  });

  it("尺寸复核没通过(size mismatch)→ 从不调 copyToBackup —— 复制只发生在既有成功路径里", async () => {
    mockStorage.sizeOf.mockResolvedValue(SIZE + 1); // claimed 64, stored 65

    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt({ mode: "single" })]);

    expect(res).toMatchObject({ error: expect.stringContaining("size mismatch") });
    expect(mockStorage.copyToBackup).not.toHaveBeenCalled();
  });
});
