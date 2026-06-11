import { describe, expect, it } from "vitest";
import {
  authorizeUploadInput,
  signPartInput,
  abortUploadInput,
  finalizedUpload,
  finalizeUploadsInput,
  uploadPart,
  expectedPartCount,
  UPLOAD_MAX_BYTES,
  UPLOAD_SINGLE_MAX_BYTES,
  UPLOAD_PART_BYTES,
  UPLOAD_MIN_PART_BYTES,
  UPLOAD_MAX_PARTS,
} from "./upload.js";

const HASH = "a".repeat(64);
const ok = { sha256: HASH, ext: "mp4", sizeBytes: 1024 };

describe("authorizeUploadInput (D19 issuance constraints)", () => {
  it("accepts a well-formed request", () => {
    expect(authorizeUploadInput.parse(ok)).toEqual(ok);
  });

  it("rejects hash variants that could smuggle a different key", () => {
    expect(() => authorizeUploadInput.parse({ ...ok, sha256: HASH.toUpperCase() })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, sha256: HASH.slice(1) })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, sha256: HASH + "a" })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, sha256: "../" + HASH.slice(3) })).toThrow();
  });

  it("rejects extensions outside the allow-list (and traversal tricks)", () => {
    for (const ext of ["exe", "html", "svg", "js", "PNG", "p/g", "png.", "", "verylongext"]) {
      expect(() => authorizeUploadInput.parse({ ...ok, ext }), ext).toThrow();
    }
    for (const ext of ["png", "mp4", "mov", "wav", "flac"]) {
      expect(authorizeUploadInput.parse({ ...ok, ext }).ext).toBe(ext);
    }
  });

  it("rejects sizes that are zero, negative, fractional, or over the cap", () => {
    expect(() => authorizeUploadInput.parse({ ...ok, sizeBytes: 0 })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, sizeBytes: -5 })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, sizeBytes: 1.5 })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, sizeBytes: UPLOAD_MAX_BYTES + 1 })).toThrow();
    expect(authorizeUploadInput.parse({ ...ok, sizeBytes: UPLOAD_MAX_BYTES }).sizeBytes).toBe(UPLOAD_MAX_BYTES);
  });

  it("rejects unknown fields — no owner/key/mime smuggling", () => {
    expect(() => authorizeUploadInput.parse({ ...ok, ownerId: "evil" })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, key: "u/evil/x.png" })).toThrow();
    expect(() => authorizeUploadInput.parse({ ...ok, mime: "text/html" })).toThrow();
  });

  it("survives prototype-pollution shaped payloads", () => {
    // zod strips __proto__ rather than throwing — the invariant that matters
    // is a clean result and an unpolluted global prototype
    const polluted = JSON.parse(`{"sha256":"${HASH}","ext":"png","sizeBytes":10,"__proto__":{"admin":true}}`);
    const parsed = authorizeUploadInput.parse(polluted) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["ext", "sha256", "sizeBytes"]);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(parsed.admin).toBeUndefined();
    const ctor = JSON.parse(`{"sha256":"${HASH}","ext":"png","sizeBytes":10,"constructor":{}}`);
    expect(() => authorizeUploadInput.parse(ctor)).toThrow(); // ordinary unknown key
  });
});

describe("signPartInput", () => {
  const sign = { ...ok, sizeBytes: UPLOAD_PART_BYTES * 3, uploadId: "u-1", partNumber: 3 };

  it("accepts parts within the window the claimed size needs", () => {
    expect(signPartInput.parse(sign).partNumber).toBe(3);
  });

  it("rejects part numbers beyond what the claimed size needs", () => {
    expect(() => signPartInput.parse({ ...sign, partNumber: 4 })).toThrow(/exceeds/);
    expect(() => signPartInput.parse({ ...sign, sizeBytes: 1024, partNumber: 2 })).toThrow(/exceeds/);
  });

  it("rejects out-of-window part numbers and empty upload ids", () => {
    expect(() => signPartInput.parse({ ...sign, partNumber: 0 })).toThrow();
    expect(() => signPartInput.parse({ ...sign, partNumber: UPLOAD_MAX_PARTS + 1 })).toThrow();
    expect(() => signPartInput.parse({ ...sign, uploadId: "" })).toThrow();
  });
});

describe("abortUploadInput", () => {
  it("is strict", () => {
    expect(abortUploadInput.parse({ sha256: HASH, ext: "mp4", uploadId: "u-1" }).uploadId).toBe("u-1");
    expect(() => abortUploadInput.parse({ sha256: HASH, ext: "mp4", uploadId: "u-1", extra: 1 })).toThrow();
  });
});

describe("uploadPart", () => {
  it("bounds part numbers to the S3 window", () => {
    expect(uploadPart.parse({ partNumber: 1, etag: '"abc"' }).partNumber).toBe(1);
    expect(uploadPart.parse({ partNumber: UPLOAD_MAX_PARTS, etag: "x" }).partNumber).toBe(UPLOAD_MAX_PARTS);
    expect(() => uploadPart.parse({ partNumber: 0, etag: "x" })).toThrow();
    expect(() => uploadPart.parse({ partNumber: UPLOAD_MAX_PARTS + 1, etag: "x" })).toThrow();
    expect(() => uploadPart.parse({ partNumber: 1, etag: "" })).toThrow();
  });
});

describe("finalizedUpload (codex round: parts-list integrity)", () => {
  const meta = { sha256: HASH, ext: "mp4", originalFilename: "clip.mp4" };
  const bigSize = UPLOAD_PART_BYTES * 2 + 5; // needs exactly 3 parts
  const parts3 = [
    { partNumber: 1, etag: "e1" },
    { partNumber: 2, etag: "e2" },
    { partNumber: 3, etag: "e3" },
  ];

  it("accepts existed/single/multipart in their valid shapes", () => {
    expect(finalizedUpload.parse({ ...meta, sizeBytes: 10, upload: { mode: "existed" } }).upload.mode).toBe("existed");
    expect(finalizedUpload.parse({ ...meta, sizeBytes: 10, upload: { mode: "single" } }).upload.mode).toBe("single");
    const mp = finalizedUpload.parse({ ...meta, sizeBytes: bigSize, upload: { mode: "multipart", uploadId: "u", parts: parts3 } });
    expect(mp.upload.mode).toBe("multipart");
  });

  it("rejects single-PUT claims for files past the single cap", () => {
    expect(() =>
      finalizedUpload.parse({ ...meta, sizeBytes: UPLOAD_SINGLE_MAX_BYTES + 1, upload: { mode: "single" } }),
    ).toThrow(/single-PUT/);
  });

  it("rejects multipart claims for files authorize would single-PUT", () => {
    expect(() =>
      finalizedUpload.parse({
        ...meta,
        sizeBytes: 1024,
        upload: { mode: "multipart", uploadId: "u", parts: [{ partNumber: 1, etag: "e" }] },
      }),
    ).toThrow(/single PUT/);
  });

  it("rejects wrong part counts for the claimed size", () => {
    expect(() =>
      finalizedUpload.parse({ ...meta, sizeBytes: bigSize, upload: { mode: "multipart", uploadId: "u", parts: parts3.slice(0, 2) } }),
    ).toThrow(/expected 3 parts/);
    expect(() =>
      finalizedUpload.parse({
        ...meta,
        sizeBytes: bigSize,
        upload: { mode: "multipart", uploadId: "u", parts: [...parts3, { partNumber: 4, etag: "e4" }] },
      }),
    ).toThrow(/expected 3 parts/);
  });

  it("rejects duplicate, unsorted, or gapped parts lists (S3 InvalidPartOrder)", () => {
    const dup = [parts3[0], parts3[0], parts3[2]];
    const unsorted = [parts3[1], parts3[0], parts3[2]];
    const gapped = [parts3[0], parts3[1], { partNumber: 5, etag: "e5" }];
    for (const parts of [dup, unsorted, gapped]) {
      expect(() =>
        finalizedUpload.parse({ ...meta, sizeBytes: bigSize, upload: { mode: "multipart", uploadId: "u", parts } }),
      ).toThrow(/ascending/);
    }
  });

  it("requires a bounded filename and rejects unknown fields", () => {
    expect(() => finalizedUpload.parse({ ...meta, originalFilename: "", sizeBytes: 10, upload: { mode: "single" } })).toThrow();
    expect(() =>
      finalizedUpload.parse({ ...meta, originalFilename: "x".repeat(301), sizeBytes: 10, upload: { mode: "single" } }),
    ).toThrow();
    expect(() => finalizedUpload.parse({ ...meta, sizeBytes: 10, upload: { mode: "single" }, mime: "text/html" })).toThrow();
  });
});

describe("finalizeUploadsInput", () => {
  it("bounds the batch", () => {
    const file = { sha256: HASH, ext: "png", sizeBytes: 10, originalFilename: "a.png", upload: { mode: "existed" as const } };
    expect(finalizeUploadsInput.parse({ files: [file] }).files).toHaveLength(1);
    expect(() => finalizeUploadsInput.parse({ files: [] })).toThrow();
    expect(() => finalizeUploadsInput.parse({ files: Array(51).fill(file) })).toThrow();
  });
});

describe("size invariants", () => {
  it("part size respects the S3 minimum and the cap fits in the part window", () => {
    expect(UPLOAD_PART_BYTES).toBeGreaterThanOrEqual(UPLOAD_MIN_PART_BYTES);
    expect(expectedPartCount(UPLOAD_MAX_BYTES)).toBeLessThanOrEqual(UPLOAD_MAX_PARTS);
    expect(expectedPartCount(1)).toBe(1);
    expect(expectedPartCount(UPLOAD_PART_BYTES)).toBe(1);
    expect(expectedPartCount(UPLOAD_PART_BYTES + 1)).toBe(2);
  });
});
