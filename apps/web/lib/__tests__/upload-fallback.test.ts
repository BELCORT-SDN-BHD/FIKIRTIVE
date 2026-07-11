/**
 * upload-fallback.test.ts — F41(a): the server-action upload fallback for storage
 * drivers without direct upload (dev local disk). authorizeUpload reports
 * kind:"unsupported" (not an error), and uploadFileFallback puts the bytes
 * server-side and returns a FinalizedUpload-shaped receipt (mode:"existed") so
 * finalizeCandidateUploads works unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const { mockOwner, mockStorage } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockStorage: {
    supportsDirectUpload: false,
    exists: vi.fn(),
    put: vi.fn(),
    presignedPut: vi.fn(),
    createMultipart: vi.fn(),
    sizeOf: vi.fn(),
    readStream: vi.fn(),
  },
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@/lib/storage", () => ({ storage: mockStorage }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: vi.fn() })) }));
vi.mock("@/lib/entity-snapshot", () => ({ buildEntitySnapshot: vi.fn(async () => null) }));
vi.mock("@fikirtive/db", () => {
  const prisma = {
    project: { findFirst: vi.fn(async () => ({ id: "proj_1" })) },
    asset: { upsert: vi.fn(async () => ({ id: "asset_1" })), count: vi.fn(async () => 0) },
    generation: { create: vi.fn(async () => ({ id: "gen_1" })) },
    actionEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { authorizeUpload, uploadFileFallback, finalizeCandidateUploads } from "../upload-actions";

// A valid static-PNG prefix (signature + IHDR + a zero-length IDAT) so finalize's 工单 F byte-check
// reads a real image (the sniffer requires reaching IDAT before it calls a PNG static).
const PNG_PREFIX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockStorage.supportsDirectUpload = false;
  mockStorage.readStream.mockImplementation(async () =>
    (async function* () {
      yield PNG_PREFIX;
    })(),
  );
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_SHA = createHash("sha256").update(PNG_BYTES).digest("hex");

function fileForm(name: string, bytes: Uint8Array): FormData {
  const fd = new FormData();
  fd.set("file", new File([bytes as unknown as BlobPart], name, { type: "image/png" }));
  return fd;
}

describe("authorizeUpload on a driver without direct upload", () => {
  it("returns kind:'unsupported' (not an error) so the client can fall back", async () => {
    const res = await authorizeUpload({ sha256: PNG_SHA, ext: "png", sizeBytes: PNG_BYTES.length });
    expect(res).toEqual({ kind: "unsupported" });
  });

  it("still rejects a malformed request before reporting unsupported", async () => {
    const res = await authorizeUpload({ sha256: "nope", ext: "png", sizeBytes: 1 });
    expect(res).toMatchObject({ error: expect.any(String) });
  });
});

describe("uploadFileFallback", () => {
  it("puts the bytes server-side and returns a FinalizedUpload receipt (mode:'existed', server-computed hash)", async () => {
    mockStorage.put.mockResolvedValue({ contentHash: PNG_SHA, key: `u/u1/${PNG_SHA}.png` });
    const res = await uploadFileFallback(fileForm("cat.png", PNG_BYTES));
    expect(res).toEqual({
      ok: {
        sha256: PNG_SHA,
        ext: "png",
        sizeBytes: PNG_BYTES.length,
        originalFilename: "cat.png",
        upload: { mode: "existed" },
      },
    });
    expect(mockStorage.put).toHaveBeenCalledTimes(1);
    const [owner, bytes, ext] = mockStorage.put.mock.calls[0];
    expect(owner).toBe("u1");
    expect(ext).toBe("png");
    expect(Buffer.from(bytes)).toEqual(Buffer.from(PNG_BYTES));
  });

  it("rejects when the driver supports direct upload (no alternate upload path on prod)", async () => {
    mockStorage.supportsDirectUpload = true;
    const res = await uploadFileFallback(fileForm("cat.png", PNG_BYTES));
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockStorage.put).not.toHaveBeenCalled();
  });

  it("rejects a disallowed extension", async () => {
    const res = await uploadFileFallback(fileForm("evil.exe", PNG_BYTES));
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(mockStorage.put).not.toHaveBeenCalled();
  });

  it("rejects an empty file / missing file field", async () => {
    expect(await uploadFileFallback(fileForm("cat.png", new Uint8Array()))).toMatchObject({
      error: expect.any(String),
    });
    expect(await uploadFileFallback(new FormData())).toMatchObject({ error: expect.any(String) });
    expect(mockStorage.put).not.toHaveBeenCalled();
  });
});

describe("finalizeCandidateUploads receipt shape (F41 QA find)", () => {
  // Every component caller passes the receipts ARRAY (outcome.files) — the action
  // must accept it. Unwrapped safeParse rejected EVERY finalize with "Malformed
  // finalize request.", killing the attach flow on prod r2 too.
  it("accepts the bare receipts array the components send", async () => {
    mockStorage.sizeOf.mockResolvedValue(PNG_BYTES.length);
    const receipt = {
      sha256: PNG_SHA,
      ext: "png",
      sizeBytes: PNG_BYTES.length,
      originalFilename: "cat.png",
      upload: { mode: "existed" as const },
    };
    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt]);
    expect(res).toMatchObject({ ok: true, count: 1 });
    expect((res as { generationIds: string[] }).generationIds).toHaveLength(1);
  });

  it("still rejects a malformed receipt", async () => {
    const res = await finalizeCandidateUploads("proj_1", "", [], [{ nope: true }]);
    expect(res).toEqual({ error: "Malformed finalize request." });
  });
});
