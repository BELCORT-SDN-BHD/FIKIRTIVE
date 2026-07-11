import { describe, it, expect } from "vitest";
import {
  classifyImageBytes,
  resolveUploadMime,
  normalizeImageMime,
  isStaticImageExt,
  MEDIA_SNIFF_BYTES,
} from "./media-sniff.js";

/* ── byte fixtures ── */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);

function png(chunks: Uint8Array = new Uint8Array()): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return new Uint8Array([...sig, ...chunks]);
}
/** Build a PNG chunk: [len][type][data][crc(zeroed — the sniffer ignores CRC)]. */
function chunk(type: string, dataLen = 0): number[] {
  const len = [(dataLen >>> 24) & 0xff, (dataLen >>> 16) & 0xff, (dataLen >>> 8) & 0xff, dataLen & 0xff];
  const t = Array.from(type, (c) => c.charCodeAt(0));
  return [...len, ...t, ...new Array(dataLen).fill(0), 0, 0, 0, 0];
}
const IHDR = chunk("IHDR", 13);
const PNG_STATIC = png(new Uint8Array([...IHDR, ...chunk("IDAT", 4)]));
const PNG_APNG = png(new Uint8Array([...IHDR, ...chunk("acTL", 8), ...chunk("IDAT", 4)]));

function webp(fourcc: string, flagsByte?: number): Uint8Array {
  const head = [0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]; // RIFF <size> WEBP
  const tag = Array.from(fourcc, (c) => c.charCodeAt(0));
  const rest = flagsByte === undefined ? [0, 0, 0, 0] : [0, 0, 0, 0, flagsByte, 0, 0, 0, 0, 0];
  return new Uint8Array([...head, ...tag, ...rest]);
}
const WEBP_SIMPLE = webp("VP8 ");
const WEBP_LOSSLESS = webp("VP8L");
const WEBP_STATIC_X = webp("VP8X", 0x10); // alpha flag only, no animation
const WEBP_ANIMATED = webp("VP8X", 0x02); // animation flag set
const WEBP_VP8X_TRUNC = webp("VP8X"); // VP8X FourCC but no feature-flags byte (20 bytes < 21)
const WEBP_JUNK = webp("JUNK"); // RIFF/WEBP container with an unrecognized first chunk
// VP8 /VP8L FourCC visible but the chunk-size field (offset 16-19) is truncated — not a proven header.
const WEBP_VP8_NO_SIZE = new Uint8Array([...webp("VP8 ")].slice(0, 16)); // FourCC only, 0 size bytes
const WEBP_VP8L_PARTIAL_SIZE = new Uint8Array([...webp("VP8L")].slice(0, 18)); // FourCC + 2 of 4 size bytes

const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const AVIF = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

describe("classifyImageBytes — whitelist static images", () => {
  it("identifies JPEG / PNG / WebP (simple, lossless, static-extended)", () => {
    expect(classifyImageBytes(JPEG)).toBe("image/jpeg");
    expect(classifyImageBytes(PNG_STATIC)).toBe("image/png");
    expect(classifyImageBytes(WEBP_SIMPLE)).toBe("image/webp");
    expect(classifyImageBytes(WEBP_LOSSLESS)).toBe("image/webp");
    expect(classifyImageBytes(WEBP_STATIC_X)).toBe("image/webp");
  });

  it("rejects animations: APNG, animated WebP, GIF → unknown", () => {
    expect(classifyImageBytes(PNG_APNG)).toBe("unknown");
    expect(classifyImageBytes(WEBP_ANIMATED)).toBe("unknown");
    expect(classifyImageBytes(GIF)).toBe("unknown");
  });

  it("rejects a truncated VP8X and an unrecognized WebP first chunk → unknown (never guess static)", () => {
    expect(classifyImageBytes(WEBP_VP8X_TRUNC)).toBe("unknown"); // no feature-flags byte to prove static
    expect(classifyImageBytes(WEBP_JUNK)).toBe("unknown"); // RIFF/WEBP but first chunk isn't VP8 /VP8L/VP8X
  });

  it("rejects VP8 /VP8L whose chunk-size field is truncated → unknown (FourCC alone isn't a proven header)", () => {
    expect(classifyImageBytes(WEBP_VP8_NO_SIZE)).toBe("unknown"); // FourCC visible, 0 of 4 size bytes
    expect(classifyImageBytes(WEBP_VP8L_PARTIAL_SIZE)).toBe("unknown"); // FourCC visible, 2 of 4 size bytes
  });

  it("rejects video/other containers and empty/truncated → unknown (never guesses)", () => {
    expect(classifyImageBytes(MP4)).toBe("unknown");
    expect(classifyImageBytes(AVIF)).toBe("unknown"); // ISOBMFF like mp4 — not in the whitelist
    expect(classifyImageBytes(new Uint8Array())).toBe("unknown");
    expect(classifyImageBytes(new Uint8Array([0xff, 0xd8]))).toBe("unknown"); // truncated JPEG magic
    expect(classifyImageBytes(new Uint8Array([1, 2, 3, 4, 5]))).toBe("unknown");
  });

  it("window exhausted before IDAT → unknown (fail-closed; never guess static)", () => {
    // IDAT pushed past the sniff window by a giant leading ancillary chunk (e.g. an iCCP colour
    // profile). A bounded reader hands us only the window; with no IDAT proven, we must NOT guess
    // "static PNG" — an APNG could hide its acTL just past the boundary (the #229 bug class).
    const filler = chunk("iCCP", MEDIA_SNIFF_BYTES + 4000);
    const late = png(new Uint8Array([...IHDR, ...filler, ...chunk("IDAT", 4)]));
    const windowed = late.subarray(0, MEDIA_SNIFF_BYTES); // what a bounded reader would actually pass in
    expect(classifyImageBytes(windowed)).toBe("unknown");
  });

  it("static PNG whose ancillary chunk (iCCP) fits inside the window still → image/png", () => {
    // A colour-managed PNG's ICC profile precedes IDAT; the 64 KiB window keeps such legit images green.
    const iccp = chunk("iCCP", 5000);
    const p = png(new Uint8Array([...IHDR, ...iccp, ...chunk("IDAT", 4)]));
    expect(classifyImageBytes(p)).toBe("image/png");
  });
});

describe("normalizeImageMime", () => {
  it("folds legacy aliases + casing + parameters to the canonical image type", () => {
    expect(normalizeImageMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeImageMime("IMAGE/JPEG")).toBe("image/jpeg");
    expect(normalizeImageMime("image/x-png")).toBe("image/png");
    expect(normalizeImageMime("image/png; charset=binary")).toBe("image/png");
    expect(normalizeImageMime("video/mp4")).toBe("video/mp4");
  });
});

describe("isStaticImageExt", () => {
  it("is exactly the byte-verifiable image exts (not gif/avif/video)", () => {
    for (const e of ["jpg", "jpeg", "png", "webp", "PNG", ".jpg"]) expect(isStaticImageExt(e)).toBe(true);
    for (const e of ["gif", "avif", "mp4", "mov", "mp3", "bin"]) expect(isStaticImageExt(e)).toBe(false);
  });
});

describe("resolveUploadMime — persist-time byte trust", () => {
  it("confirmed image → canonical mime, correcting a wrong client type", () => {
    expect(resolveUploadMime(JPEG, "jpg")).toBe("image/jpeg");
    expect(resolveUploadMime(JPEG, "png")).toBe("image/jpeg"); // bytes beat the declared ext
    expect(resolveUploadMime(PNG_STATIC, "png")).toBe("image/png");
    expect(resolveUploadMime(WEBP_SIMPLE, "webp")).toBe("image/webp");
  });

  it("declared image ext but bytes aren't that image → octet-stream (caught lie)", () => {
    expect(resolveUploadMime(MP4, "png")).toBe("application/octet-stream");
    expect(resolveUploadMime(GIF, "jpg")).toBe("application/octet-stream");
    expect(resolveUploadMime(new Uint8Array([1, 2, 3]), "webp")).toBe("application/octet-stream");
  });

  it("video/audio/unverified-image exts keep their server ext→mime (video never corrupted)", () => {
    expect(resolveUploadMime(MP4, "mp4")).toBe("video/mp4");
    expect(resolveUploadMime(GIF, "gif")).toBe("image/gif");
    expect(resolveUploadMime(AVIF, "avif")).toBe("image/avif");
    expect(resolveUploadMime(new Uint8Array([1, 2, 3]), "mp3")).toBe("audio/mpeg");
  });
});
