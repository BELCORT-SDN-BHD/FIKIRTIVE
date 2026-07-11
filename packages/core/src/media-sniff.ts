/**
 * Media byte classifier (工单 F) — the ONE shared source of truth for "what is this file, really",
 * derived from its leading bytes rather than a client-reported MIME or filename extension (both are
 * attacker-controlled). `Asset.mime` is persisted from client input at upload, so a real mp4 can
 * claim `image/png` and slip past any mime-string whitelist (#229). Only the bytes don't lie.
 *
 * Scope is deliberately NARROW: positively identify the three STATIC raster images Instagram's image
 * path accepts (JPEG / PNG / WebP). Everything else — video, audio, GIF (animation-capable), animated
 * PNG (APNG) / animated WebP, empty, truncated, unknown — returns "unknown". We never GUESS a type we
 * cannot prove from a magic number; a static first frame of an animation on the image path is the
 * exact #229 bug class, so animations fail closed.
 *
 * Isomorphic + dependency-free (byte comparisons only) so both the worker publish gate and the web
 * ingest paths share it.
 */
import { mimeOf } from "./upload.js";

/** How many leading bytes callers should sniff. Large enough that a PNG's `acTL` (APNG marker), which
 *  sits among the first chunks, is virtually always inside the window; an `acTL` beyond it is a KNOWN
 *  RESIDUAL (admitted as static PNG). Also bounds the read/allocation on multi-GB objects. */
export const MEDIA_SNIFF_BYTES = 4096;

export type CanonicalImageMime = "image/jpeg" | "image/png" | "image/webp";
export type SniffResult = CanonicalImageMime | "unknown";

/** The extensions whose bytes THIS classifier can positively verify. A file DECLARED with one of
 *  these exts is expected to sniff to the matching image; if it sniffs to "unknown" it is lying (a
 *  renamed non-image) and ingest persists application/octet-stream. Image exts we do NOT byte-verify
 *  (gif/avif) and non-image exts (video/audio) keep their server ext→mime mapping instead. */
const VERIFIABLE_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

export function isStaticImageExt(ext: string): boolean {
  return VERIFIABLE_IMAGE_EXTS.has(ext.replace(/^\./, "").toLowerCase());
}

/** Canonicalize a stored/looked-up MIME so a byte-derived string and a legacy client-derived string
 *  compare equal despite aliases/casing/parameters. Only the three whitelist image types matter. */
export function normalizeImageMime(mime: string): string {
  const base = mime.trim().toLowerCase().split(";")[0]!.trim();
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  if (base === "image/x-png") return "image/png";
  return base;
}

function matches(b: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}

/** ASCII FourCC compare at `offset` (used for RIFF/WEBP/VP8X chunk tags). */
function fourCC(b: Uint8Array, offset: number, ascii: string): boolean {
  return matches(b, Array.from(ascii, (c) => c.charCodeAt(0)), offset);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Classify a bounded byte prefix into a whitelist static-image MIME, or "unknown". */
export function classifyImageBytes(prefix: Uint8Array): SniffResult {
  // JPEG — SOI + first marker: FF D8 FF
  if (matches(prefix, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG — 8-byte signature; reject APNG (an `acTL` chunk appears before the first `IDAT`).
  if (matches(prefix, PNG_SIG)) return pngIsApng(prefix) ? "unknown" : "image/png";

  // WebP — "RIFF" <size> "WEBP"; reject the animated variant (VP8X with the animation flag set).
  if (fourCC(prefix, 0, "RIFF") && fourCC(prefix, 8, "WEBP")) {
    return webpIsAnimated(prefix) ? "unknown" : "image/webp";
  }

  // GIF, MP4/MOV (`ftyp`), AVIF (`ftyp` brand), audio, empty, truncated, anything else → not a
  // verifiable static image. Never guessed.
  return "unknown";
}

/** Unsigned 32-bit big-endian read (PNG chunk lengths). Returns a JS number (safe: PNG lengths are
 *  ≤ 2^31-1 per spec, and even a corrupt 2^32-value just overshoots the window and ends the scan). */
function u32be(b: Uint8Array, pos: number): number {
  return b[pos]! * 0x1000000 + (b[pos + 1]! << 16) + (b[pos + 2]! << 8) + b[pos + 3]!;
}

/** Walk the PNG chunk stream within the sniff window: an `acTL` chunk BEFORE the first `IDAT` marks
 *  an APNG (animation) → reject. Reaching `IDAT` first, or exhausting the window, means static PNG.
 *  An `acTL` past the window is the documented known residual (admitted as static). */
function pngIsApng(prefix: Uint8Array): boolean {
  let pos = PNG_SIG.length; // first chunk starts right after the 8-byte signature
  // each chunk = [4-byte length][4-byte type][length bytes of data][4-byte CRC]
  while (pos + 8 <= prefix.length) {
    const len = u32be(prefix, pos);
    const type = String.fromCharCode(prefix[pos + 4]!, prefix[pos + 5]!, prefix[pos + 6]!, prefix[pos + 7]!);
    if (type === "acTL") return true; // animation control chunk → APNG
    if (type === "IDAT") return false; // reached image data with no acTL → static PNG
    pos += 12 + len; // 4 (len) + 4 (type) + len (data) + 4 (crc)
  }
  return false; // window exhausted before acTL/IDAT → treat as static (known residual)
}

/** VP8X extended WebP with the animation flag (0x02) set in its feature byte → animated → reject.
 *  Simple `VP8 ` / lossless `VP8L` WebP are never animated. */
function webpIsAnimated(prefix: Uint8Array): boolean {
  if (!fourCC(prefix, 12, "VP8X")) return false; // only the extended format can be animated
  // Layout: "VP8X"(12) + chunkSize(16..19) + flags(20). Animation flag = bit 1 (0x02).
  if (prefix.length < 21) return false;
  return (prefix[20]! & 0x02) !== 0;
}

/**
 * Resolve the MIME to PERSIST for an uploaded object, from its bytes + declared ext. Bytes win:
 *  - confirmed whitelist static image → its canonical MIME (byte-authoritative; corrects a wrong
 *    client File.type, e.g. a jpeg mislabelled application/octet-stream → image/jpeg);
 *  - declared with a VERIFIABLE image ext but the bytes are NOT that image → application/octet-stream
 *    (a caught lie — a video/garbage renamed x.png — naturally unpublishable);
 *  - otherwise (video/audio, or image exts we do not byte-verify like gif/avif) → the server ext→mime
 *    mapping. Client File.type is never consulted.
 * `prefix` should be the first MEDIA_SNIFF_BYTES of the object.
 */
export function resolveUploadMime(prefix: Uint8Array, ext: string): string {
  const sniffed = classifyImageBytes(prefix);
  if (sniffed !== "unknown") return sniffed;
  if (isStaticImageExt(ext)) return "application/octet-stream";
  return mimeOf(ext);
}
