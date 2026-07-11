/**
 * RED TEST (工单 F, epoch claude-20260711-02) — L1 Instagram publish media BYTE contract.
 *
 * Suspected gap after #229: the media-contract guard in `buildMediaUrls` (./publish.ts) trusts
 * `Asset.mime`, which is CLIENT-reported (stored from File.type / the client filename extension at
 * upload). A real video whose Asset.mime lies "image/png" therefore passes the `mime.startsWith
 * ("image/")` whitelist and is routed through `transcodeToJpeg` (ffmpeg `-frames:v 1`) — the exact
 * #229 "video silently becomes a static first frame" bug, just reached through a mislabelled mime
 * instead of a mislabelled extension.
 *
 * The fix must byte-verify the ACTUAL stored object that will be published: read a bounded prefix,
 * classify it, and require the bytes to (1) be a whitelist static image AND (2) match the stored
 * mime. A storage READ failure is a retryable operational error, never a media verdict.
 *
 * This file does NOT touch product code. It unit-tests exported `buildMediaUrls` with prisma,
 * storage, and execa (ffmpeg) mocked — no network, no filesystem, no real ffmpeg binary, no spend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => {
  const scheduledPostMediaFindMany = vi.fn();
  const generationFindMany = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPostMedia: { findMany: scheduledPostMediaFindMany },
    generation: { findMany: generationFindMany },
  };
  return { prisma, scheduledPostMediaFindMany, generationFindMany };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "user-token", signMediaToken: () => "sig" }));

const storageMocks = vi.hoisted(() => ({
  ffmpegInput: vi.fn().mockResolvedValue("https://presigned.example/input"),
  put: vi.fn(),
  readStream: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: storageMocks }));

const execaMock = vi.hoisted(() => vi.fn());
vi.mock("execa", () => ({ execa: execaMock }));

import { buildMediaUrls } from "./publish.js";

const OWNER = "owner1";
const CONTENT_HASH = "a".repeat(64); // storageKey() requires a 64-char hex contentHash

/* ── byte fixtures (leading magic numbers only; enough for classification) ── */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
// PNG signature + a minimal IHDR chunk (len 13, "IHDR", 13 data, 4 crc) — no acTL → static PNG.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
// WebP: "RIFF" <size> "WEBP" "VP8 " (simple lossy, non-animated).
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0,
]);
// MP4/MOV: box size + "ftyp" + "isom" — a real video whose Asset.mime will lie "image/png".
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d,
]);

function toAsyncIter(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
  })();
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUBLIC_BASE_URL = "https://app.example.com";
  process.env.MEDIA_PROXY_SECRET = "test-secret";
  execaMock.mockResolvedValue({ stdout: Buffer.from("fake-jpeg-frame-bytes") });
  storageMocks.put.mockResolvedValue({ key: `${OWNER}/${CONTENT_HASH}.jpg` });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** One asset attached to the post; its stored bytes come back from readStream. */
function mockSingleAsset(ext: string, mime: string, bytes: Uint8Array) {
  m.scheduledPostMediaFindMany.mockResolvedValue([{ generationId: "gen1" }]);
  m.generationFindMany.mockResolvedValue([{ id: "gen1", asset: { ownerId: OWNER, contentHash: CONTENT_HASH, ext, mime } }]);
  storageMocks.readStream.mockImplementation(async () => toAsyncIter(bytes));
}

describe("buildMediaUrls — IG media BYTE contract (工单 F)", () => {
  it("REPRO/CONTRACT: a real mp4 whose Asset.mime LIES image/png is refused by the bytes, never ffmpeg-frame-extracted", async () => {
    // ext "png" + mime "image/png" both pass every string-level check; only the bytes betray the lie.
    mockSingleAsset("png", "image/png", MP4);

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result).toBe(false);
    expect("mediaContractRefused" in result && result.mediaContractRefused).toBe(true);
    // The whole point: the guard must catch the lie from the bytes BEFORE shelling out to ffmpeg.
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("unknown/garbage bytes (mime image/png) are refused — the classifier never guesses", async () => {
    mockSingleAsset("png", "image/png", new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("mediaContractRefused" in result && result.mediaContractRefused).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("byte↔mime disagreement between two images (png bytes, mime image/jpeg) is refused", async () => {
    mockSingleAsset("png", "image/jpeg", PNG);

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("mediaContractRefused" in result && result.mediaContractRefused).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("a storage READ failure is a RETRYABLE operational error — not a media refusal, never trusts stored mime, zero ffmpeg", async () => {
    m.scheduledPostMediaFindMany.mockResolvedValue([{ generationId: "gen1" }]);
    m.generationFindMany.mockResolvedValue([{ id: "gen1", asset: { ownerId: OWNER, contentHash: CONTENT_HASH, ext: "png", mime: "image/png" } }]);
    storageMocks.readStream.mockRejectedValue(new Error("R2 timeout"));

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("mediaContractRefused" in result).toBe(false);
    expect("urls" in result).toBe(false);
    expect("error" in result && "retryable" in result && result.retryable).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("legit jpeg (mime image/jpeg) passes — jpg needs no transcode", async () => {
    mockSingleAsset("jpg", "image/jpeg", JPEG);

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result && result.urls.length).toBe(1);
    expect(execaMock).not.toHaveBeenCalled(); // jpg is already JPEG
  });

  it("legit png (mime image/png) passes and is transcoded to JPEG for IG", async () => {
    mockSingleAsset("png", "image/png", PNG);

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result && result.urls.length).toBe(1);
    expect(execaMock).toHaveBeenCalledTimes(1); // non-jpeg image → transcode
  });

  it("legit webp (mime image/webp) passes", async () => {
    mockSingleAsset("webp", "image/webp", WEBP);

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result && result.urls.length).toBe(1);
  });

  it("Facebook channel does NOT byte-gate (IG-only contract) — a video passes buildMediaUrls unread", async () => {
    mockSingleAsset("mp4", "video/mp4", MP4);

    const result = await buildMediaUrls(OWNER, "sp1", "facebook");

    expect("urls" in result && result.urls.length).toBe(1);
    expect(storageMocks.readStream).not.toHaveBeenCalled();
  });
});
