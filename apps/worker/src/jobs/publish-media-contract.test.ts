/**
 * RED TEST (工单 B, epoch claude-20260711-02) — L1 Instagram publish media contract for video assets.
 *
 * Suspected contract violation: the scheduler allows a video Generation to be attached to an
 * Instagram ScheduledPost, but `buildMediaUrls` in ./publish.ts routes ANY non-jpg/jpeg asset —
 * video included — through `transcodeToJpeg`, which runs `ffmpeg -frames:v 1 ...` (a single-frame
 * extraction). That would silently turn a scheduled VIDEO post into a static JPEG-first-frame IMAGE
 * post, with no `video_url`/`media_type: VIDEO|REELS` ever sent to Meta.
 *
 * This file does NOT touch product code. It unit-tests the exported `buildMediaUrls` with prisma,
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
}));
vi.mock("../storage.js", () => ({ storage: storageMocks }));

const execaMock = vi.hoisted(() => vi.fn());
vi.mock("execa", () => ({ execa: execaMock }));

import { buildMediaUrls } from "./publish.js";

const OWNER = "owner1";
const CONTENT_HASH = "a".repeat(64); // storageKey() requires a 64-char hex contentHash

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

function mockSingleAsset(ext: string, mime: string) {
  m.scheduledPostMediaFindMany.mockResolvedValue([{ generationId: "gen1" }]);
  m.generationFindMany.mockResolvedValue([{ id: "gen1", asset: { ownerId: OWNER, contentHash: CONTENT_HASH, ext, mime } }]);
}

describe("buildMediaUrls — IG media contract for video assets (publish.ts:190-224)", () => {
  it("CONTRACT: a video/mp4 asset must be refused (mediaContractRefused), never ffmpeg-frame-extracted into a static JPEG for Instagram", async () => {
    mockSingleAsset("mp4", "video/mp4");

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result).toBe(false);
    expect("mediaContractRefused" in result && result.mediaContractRefused).toBe(true);
    // transcodeToJpeg() shells out to ffmpeg with `-frames:v 1` (single-frame extraction). A video
    // asset reaching Instagram publish must be refused deterministically instead of being reduced
    // to one frame — buildMediaUrls must never shell out to ffmpeg (nor call Meta) to do it.
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("CONTRACT: an empty/unknown mime is refused the same way — the whitelist is Asset.mime, not the extension", async () => {
    // ext "jpg" would pass the pre-existing extension check; only the mime whitelist catches this.
    mockSingleAsset("jpg", "");

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result).toBe(false);
    expect("mediaContractRefused" in result && result.mediaContractRefused).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("sanity control: a non-JPEG IMAGE (png, image/png mime) legitimately IS transcoded to JPEG for Instagram", async () => {
    mockSingleAsset("png", "image/png");

    const result = await buildMediaUrls(OWNER, "sp1", "instagram");

    expect("urls" in result).toBe(true);
    // Proves the harness genuinely exercises transcodeToJpeg()/execa when it SHOULD run (images),
    // so the video test's `not.toHaveBeenCalled()` above is a real negative, not a broken mock.
    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, args] = execaMock.mock.calls[0]!;
    expect(bin).toBe("ffmpeg");
    expect(args).toContain("-frames:v");
  });
});
