/**
 * upload-mime-sniff.test.ts (工单 F, commit 2) — the ingest path PERSISTS the mime the BYTES prove,
 * not the client-declared ext. Proves finalizeCandidateUploads (the browser-direct upload path):
 *   - a real image declared with its image ext → canonical image mime;
 *   - a non-image renamed with an image ext (the lie) → application/octet-stream (unpublishable);
 *   - a video declared with a video ext → keeps video/mp4 AND is never read (the static-image
 *     sniffer can't verify it; blanket octet-stream would corrupt every legit video).
 * Storage + prisma + queue mocked — no network, no filesystem, no spend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const { mockOwner, mockStorage, assetUpsert } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  assetUpsert: vi.fn(async (_args: { create: { mime: string } }) => ({ id: "asset_1" })),
  mockStorage: {
    supportsDirectUpload: true,
    sizeOf: vi.fn(),
    completeMultipart: vi.fn(),
    deleteObject: vi.fn(),
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
    asset: { upsert: assetUpsert, count: vi.fn(async () => 0) },
    generation: { create: vi.fn(async () => ({ id: "gen_1" })) },
    actionEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { finalizeCandidateUploads } from "../upload-actions";

/* ── byte fixtures ── */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  // IDAT chunk (len 0 + "IDAT" + zeroed CRC): the sniffer requires a positive IDAT before any acTL to
  // call a PNG static (APNG's acTL can precede IDAT), so a realistic fixture must include one.
  0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

function asyncIterOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
  })();
}

/** A finalize receipt (mode:"existed") whose stored object returns `storedBytes` from readStream. */
async function finalizeOne(ext: string, storedBytes: Uint8Array) {
  const sha256 = createHash("sha256").update(storedBytes).digest("hex");
  mockStorage.sizeOf.mockResolvedValue(storedBytes.length);
  mockStorage.readStream.mockImplementation(async () => asyncIterOf(storedBytes));
  const receipt = {
    sha256,
    ext,
    sizeBytes: storedBytes.length,
    originalFilename: `f.${ext}`,
    upload: { mode: "existed" as const },
  };
  const res = await finalizeCandidateUploads("proj_1", "", [], [receipt]);
  const mime = assetUpsert.mock.calls[0]?.[0]?.create?.mime as string | undefined;
  return { res, mime };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  mockStorage.supportsDirectUpload = true;
});

describe("finalizeCandidateUploads — byte-derived mime (工单 F)", () => {
  it("real png declared .png → persists image/png", async () => {
    const { res, mime } = await finalizeOne("png", PNG);
    expect(res).toMatchObject({ ok: true, count: 1 });
    expect(mime).toBe("image/png");
  });

  it("real jpeg declared .jpg → persists image/jpeg", async () => {
    const { mime } = await finalizeOne("jpg", JPEG);
    expect(mime).toBe("image/jpeg");
  });

  it("THE LIE: a real mp4 renamed x.png → persists application/octet-stream (naturally unpublishable), never image/png", async () => {
    const { res, mime } = await finalizeOne("png", MP4);
    expect(res).toMatchObject({ ok: true, count: 1 });
    expect(mime).toBe("application/octet-stream");
  });

  it("a legit video declared .mp4 → keeps video/mp4 and is NEVER byte-read (ext-gate protects video)", async () => {
    const { mime } = await finalizeOne("mp4", MP4);
    expect(mime).toBe("video/mp4");
    expect(mockStorage.readStream).not.toHaveBeenCalled();
  });

  it("a transient storage READ failure is RETRYABLE — the file is deferred, never persisted under a guessed mime", async () => {
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    mockStorage.sizeOf.mockResolvedValue(PNG.length);
    mockStorage.readStream.mockRejectedValue(new Error("R2 timeout"));
    const receipt = { sha256, ext: "png", sizeBytes: PNG.length, originalFilename: "f.png", upload: { mode: "existed" as const } };

    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt]);

    // A read failure is operational, not a verdict: never persist a guessed mime — not the client ext,
    // and not a blanket octet-stream that the resurrect-realign would smear onto a shared row. The
    // worker publish gate treats the identical read failure as retryable; the ingest path mirrors it.
    expect("error" in res).toBe(true);
    expect(assetUpsert).not.toHaveBeenCalled();
  });
});
