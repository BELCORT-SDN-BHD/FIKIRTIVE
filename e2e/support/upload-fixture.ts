/**
 * A genuinely-new PNG on every call (#941).
 *
 * Before this ticket the resident e2e suite had ZERO upload coverage — no fixture, static or
 * otherwise, ever drove a file through the composer's attach path. So `freshPng()` is not a fix
 * for some prior fixture that let #931 (a production CORS defect in the browser→R2 presigned-PUT
 * path) slip through — there was no such fixture, and no such coverage, for anything to slip
 * through in the first place. Two more facts hold independent of that history, worth stating so
 * a static fixture is never assumed "obviously fine" here either:
 *   - `authorizeUpload`'s content-addressed dedup keys on (ownerId, sha256), and every seeded
 *     workspace mints a fresh random orgId — so identical bytes across two different runs would
 *     never land on the same key regardless of whether the bytes themselves were static.
 *   - on CI, `storage.supportsDirectUpload` is false (LocalDiskStorage — see the journey's own
 *     coverage-boundary note), and `authorizeUpload`'s unsupported-driver check returns BEFORE
 *     the dedup check ever runs. Dedup is not reachable from this fixture on today's suite at all.
 *
 * `freshPng()` exists to keep that failure mode foreclosed permanently rather than lean on either
 * fact staying true: a fresh random pixel — and therefore a fresh sha256 and storage key — on
 * every call means a future e2e run against a real R2/MinIO backend (where dedup DOES execute)
 * can never quietly start coasting on a stale hash the way a static fixture eventually could.
 *
 * The bytes are a real, fully valid 1×1 truecolour-with-alpha PNG (correct IHDR, a real
 * zlib-deflated IDAT scanline, correct CRC32 on every chunk) — not a hand-waved stub. Anything
 * downstream that actually decodes the image (a `<img>` tag rendering the Library thumbnail, a
 * future stricter validator) sees a real picture, not a shape that only fools a byte-sniffer.
 */
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Standard PNG/zlib CRC-32 table (ISO 3309 / ITU-T V.42), built once.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** A real, valid 1×1 RGBA PNG whose single pixel is a fresh random colour. */
export function freshPng(): Buffer {
  const [r, g, b, a] = randomBytes(4);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type 6 = truecolor + alpha
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  // One scanline: filter-type byte (0 = none) + the one RGBA pixel.
  const scanline = Buffer.from([0, r!, g!, b!, a!]);
  const idatData = deflateSync(scanline);

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A filename Uppy/the file input will accept unmodified (`uploadExtFromFilename` reads the
 *  extension only — the leading random slug just keeps repeated runs' names distinct in any
 *  UI list that shows the filename). */
export function freshPngFilename(): string {
  return `e2e-fresh-${randomBytes(6).toString("hex")}.png`;
}
