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

/** How many leading bytes callers should sniff. 64 KiB — large enough that a real static PNG's first
 *  `IDAT` (which trails the header plus any ancillary chunks, e.g. a multi-KB `iCCP` colour profile)
 *  is virtually always inside the window, and that an APNG's `acTL` (which must precede that `IDAT`)
 *  is seen and rejected. Still bounds the read/allocation on multi-GB objects. When the window is
 *  exhausted before `IDAT` we fail CLOSED (unknown), never guess static — so a larger window only
 *  ever REDUCES false rejections of legitimate images. */
export const MEDIA_SNIFF_BYTES = 64 * 1024;

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

  // PNG — 8-byte signature. Static ONLY if we positively reach the first `IDAT` with no `acTL`
  // (APNG animation-control chunk) before it. An acTL-first stream, or a window exhausted before
  // IDAT, fails closed (unknown); we never call a PNG static without proof.
  if (matches(prefix, PNG_SIG)) return pngIsStatic(prefix) ? "image/png" : "unknown";

  // WebP — "RIFF" <size> "WEBP" followed by a recognizable first chunk. Simple `VP8 ` / lossless
  // `VP8L` are always a single static frame; extended `VP8X` is static only if its feature-flags byte
  // is present AND the animation flag is clear. A truncated VP8X, or any unrecognized first chunk,
  // fails closed (unknown) — we never call a WebP static without proof.
  if (fourCC(prefix, 0, "RIFF") && fourCC(prefix, 8, "WEBP")) {
    return classifyWebp(prefix);
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

/** Walk the PNG chunk stream within the sniff window looking for PROOF of a static image. The PNG
 *  spec permits the `acTL` (APNG animation-control) chunk anywhere before the first `IDAT`, so we scan
 *  chunk-by-chunk: reaching `IDAT` with no `acTL` seen → static (true); an `acTL` first → APNG
 *  (false). Exhausting the window — or a malformed/oversized chunk length that overshoots it — before
 *  `IDAT` → fail closed (false): with a 64 KiB window this only strikes pathological files, and
 *  guessing "static" there is exactly the #229 first-frame-of-an-animation bug we refuse to reopen. */
function pngIsStatic(prefix: Uint8Array): boolean {
  let pos = PNG_SIG.length; // first chunk starts right after the 8-byte signature
  // each chunk = [4-byte length][4-byte type][length bytes of data][4-byte CRC]
  while (pos + 8 <= prefix.length) {
    const len = u32be(prefix, pos);
    const type = String.fromCharCode(prefix[pos + 4]!, prefix[pos + 5]!, prefix[pos + 6]!, prefix[pos + 7]!);
    if (type === "acTL") return false; // animation control chunk before IDAT → APNG
    if (type === "IDAT") return true; // reached image data with no acTL → static PNG
    pos += 12 + len; // 4 (len) + 4 (type) + len (data) + 4 (crc)
  }
  return false; // window exhausted before IDAT → not proven static → fail closed
}

/** Classify the first chunk of a "RIFF"…"WEBP" container. Simple `VP8 ` (lossy) and lossless `VP8L`
 *  are always a single static frame → image/webp. Extended `VP8X` carries a feature-flags byte at
 *  offset 20 (12 + 4 FourCC + 4 chunk-size); the animation flag is bit 1 (0x02). A VP8X truncated
 *  before that byte can't be proven static → unknown. Any other (or absent — container truncated
 *  before the FourCC) first chunk is unrecognized → unknown. */
function classifyWebp(prefix: Uint8Array): SniffResult {
  if (fourCC(prefix, 12, "VP8 ") || fourCC(prefix, 12, "VP8L")) return "image/webp";
  if (fourCC(prefix, 12, "VP8X")) {
    if (prefix.length < 21) return "unknown"; // truncated before the feature-flags byte
    return (prefix[20]! & 0x02) !== 0 ? "unknown" : "image/webp"; // animation flag set → animated
  }
  return "unknown"; // unrecognized first chunk
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
