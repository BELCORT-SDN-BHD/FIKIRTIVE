/**
 * Storage port (design doc D8/D14) — ONE key scheme, two drivers:
 *
 *   u/<ownerId>/<sha256>.<ext>
 *
 *   local — .data/storage on disk (dev; web+worker share the repo dir)
 *   r2    — Cloudflare R2 via the S3 API (prod; MinIO stands in for tests)
 *
 * Driver selection is env-only (STORAGE_DRIVER) so prod activation is a
 * config flip, zero code change. The DB never stores locations; keys are
 * always derived from content hashes (D14).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, access, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseStorageKey, storageKey, mimeOf } from "@artlio/core";

export { mimeOf };

export interface UploadPartReceipt {
  partNumber: number;
  etag: string;
}

export interface Storage {
  /** True when the driver can issue browser-direct presigned uploads (r2).
   *  The UI falls back to the server-action upload path when false. */
  readonly supportsDirectUpload: boolean;
  /** Content-addressed write. Returns the hash + derived key (dedup by content). */
  /** Single-shot, in-memory put — right for small uploads and render outputs
   *  (≤ tens of MB). Large files go browser→R2 direct (T4b presigned
   *  multipart; the server never holds those bytes). */
  put(ownerId: string, bytes: Uint8Array, ext: string): Promise<{ contentHash: string; key: string }>;
  /** Whole-object read into memory — small objects only. In r2 mode no code
   *  path calls this today (reads go via presigned URLs); revisit with a
   *  streaming variant before adding one. */
  get(key: string): Promise<Uint8Array>;
  /** Browser-reachable URL for <img>/<video>. App-relative: /files/<key>. */
  url(key: string): string;
  /** Something ffmpeg/ffprobe can open directly: a file path (local) or a
   *  presigned https URL (r2 — D10: range reads against presigned URLs). */
  ffmpegInput(key: string): Promise<string>;
  /** For the /files route in r2 mode: a short-lived presigned GET. */
  presignedGet(key: string, expiresSeconds?: number): Promise<string | null>;
  /** Does the object exist? (HeadObject / fs access) */
  exists(key: string): Promise<boolean>;
  /** Actual stored byte count, or null if absent — finalize's size re-check
   *  (D19: claimed sizes are untrusted). */
  sizeOf(key: string): Promise<number | null>;
  /** Bytes as an async stream — the worker's hash re-verification reads this
   *  (D19: claimed hashes are untrusted). */
  readStream(key: string): Promise<AsyncIterable<Uint8Array>>;
  /** Remove the object (hash/size-mismatch cleanup). Missing object is a no-op. */
  deleteObject(key: string): Promise<void>;
  /* ---- browser-direct upload (r2 only; local throws — gate on
     supportsDirectUpload) ---- */
  presignedPut(key: string, contentLength: number, expiresSeconds?: number): Promise<string>;
  createMultipart(key: string): Promise<string>;
  signPart(key: string, uploadId: string, partNumber: number, expiresSeconds?: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: UploadPartReceipt[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* ---------------- local disk ---------------- */

export class LocalDiskStorage implements Storage {
  readonly supportsDirectUpload = false;

  constructor(private root: string) {}

  private fileFor(key: string): string {
    parseStorageKey(key); // validates shape — no path traversal possible
    return path.join(this.root, key);
  }

  async put(ownerId: string, bytes: Uint8Array, ext: string) {
    const contentHash = hashOf(bytes);
    const key = storageKey(ownerId, contentHash, ext);
    const file = this.fileFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await access(file); // dedup: same content already stored
    } catch {
      await writeFile(file, bytes);
    }
    return { contentHash, key };
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.fileFor(key));
  }

  url(key: string): string {
    return `/files/${key}`;
  }

  async ffmpegInput(key: string): Promise<string> {
    const file = this.fileFor(key);
    await access(file);
    return file;
  }

  async presignedGet(): Promise<string | null> {
    return null; // local mode streams through the /files route
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.fileFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async sizeOf(key: string): Promise<number | null> {
    try {
      return (await stat(this.fileFor(key))).size;
    } catch {
      return null;
    }
  }

  async readStream(key: string): Promise<AsyncIterable<Uint8Array>> {
    const file = this.fileFor(key);
    await access(file);
    return createReadStream(file);
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await unlink(this.fileFor(key));
    } catch {
      // missing object is a no-op by contract
    }
  }

  private directUploadUnsupported(): never {
    throw new Error("direct upload requires the r2 driver — gate on storage.supportsDirectUpload");
  }
  async presignedPut(): Promise<string> {
    this.directUploadUnsupported();
  }
  async createMultipart(): Promise<string> {
    this.directUploadUnsupported();
  }
  async signPart(): Promise<string> {
    this.directUploadUnsupported();
  }
  async completeMultipart(): Promise<void> {
    this.directUploadUnsupported();
  }
  async abortMultipart(): Promise<void> {
    this.directUploadUnsupported();
  }
}

/* ---------------- R2 (S3 API; MinIO-compatible) ---------------- */

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** default true (MinIO needs it; R2 accepts it). Set false if a custom
   *  domain / virtual-host endpoint ever requires it. */
  forcePathStyle?: boolean;
}

export class R2Storage implements Storage {
  readonly supportsDirectUpload = true;

  private client: S3Client;
  constructor(private cfg: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // MinIO needs path-style; R2 accepts it too — overridable via config
      forcePathStyle: cfg.forcePathStyle ?? true,
    });
  }

  async put(ownerId: string, bytes: Uint8Array, ext: string) {
    const contentHash = hashOf(bytes);
    const key = storageKey(ownerId, contentHash, ext);
    if (await this.exists(key)) {
      // Dedup best-effort, not a lock: two concurrent writers can both miss
      // Head and both Put — harmless, keys are content-addressed so the bytes
      // are identical and last-write metadata wins (mime derives from ext).
      return { contentHash, key };
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: bytes,
        ContentType: mimeOf(ext),
      }),
    );
    return { contentHash, key };
  }

  async exists(key: string): Promise<boolean> {
    parseStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch (err) {
      // only a missing object means "absent"; auth/network/bucket errors
      // must surface, not silently read as a miss
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name ?? "";
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
      throw err;
    }
  }

  async sizeOf(key: string): Promise<number | null> {
    parseStorageKey(key);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name ?? "";
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
      throw err;
    }
  }

  async readStream(key: string): Promise<AsyncIterable<Uint8Array>> {
    parseStorageKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error(`empty object: ${key}`);
    return res.Body as unknown as AsyncIterable<Uint8Array>; // Node runtime: Body is a Readable
  }

  async deleteObject(key: string): Promise<void> {
    parseStorageKey(key);
    // S3 DeleteObject is idempotent — deleting a missing key succeeds
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  /* ---- browser-direct upload ---- */

  async presignedPut(key: string, contentLength: number, expiresSeconds = 3600): Promise<string> {
    const { ext } = parseStorageKey(key);
    // ContentType + ContentLength ride inside the signature: the browser's
    // PUT must carry exactly these headers or R2 rejects it (first line of
    // the D19 size defense; finalize's HEAD re-check is the authoritative one)
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: mimeOf(ext),
        ContentLength: contentLength,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async createMultipart(key: string): Promise<string> {
    const { ext } = parseStorageKey(key);
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: mimeOf(ext),
      }),
    );
    if (!res.UploadId) throw new Error("CreateMultipartUpload returned no UploadId");
    return res.UploadId;
  }

  async signPart(key: string, uploadId: string, partNumber: number, expiresSeconds = 3600): Promise<string> {
    parseStorageKey(key);
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async completeMultipart(key: string, uploadId: string, parts: UploadPartReceipt[]): Promise<void> {
    parseStorageKey(key);
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    parseStorageKey(key);
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({ Bucket: this.cfg.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (err) {
      // aborting an already-completed/aborted upload is a no-op by contract
      const name = (err as { name?: string })?.name ?? "";
      if (name !== "NoSuchUpload") throw err;
    }
  }

  async get(key: string): Promise<Uint8Array> {
    parseStorageKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`empty object: ${key}`);
    return bytes;
  }

  url(key: string): string {
    return `/files/${key}`; // the route redirects to a presigned GET
  }

  async ffmpegInput(key: string): Promise<string> {
    parseStorageKey(key);
    // long enough for a full render; D10: ffmpeg range-reads presigned URLs.
    // Worker-only — never log argv containing this URL.
    return this.presignedGetUrl(key, 60 * 60);
  }

  async presignedGet(key: string, expiresSeconds = 300): Promise<string> {
    const { ext } = parseStorageKey(key);
    // response-header overrides ride inside the signature: conservative
    // caching, ContentType pinned to the ext (the stored ContentType is
    // client-influenced on direct uploads — presigned PUTs don't enforce the
    // content-type header), and anything non-renderable downloads instead of
    // executing
    const renderable = /^(png|jpg|jpeg|webp|gif|avif|mp4|mov|webm|mkv|mp3|wav|m4a|aac|ogg|flac)$/.test(ext);
    return this.presignedGetUrl(key, expiresSeconds, {
      ResponseCacheControl: "private, no-store",
      ResponseContentType: mimeOf(ext),
      ...(renderable ? {} : { ResponseContentDisposition: "attachment" }),
    });
  }

  private presignedGetUrl(
    key: string,
    expiresIn: number,
    overrides: { ResponseCacheControl?: string; ResponseContentDisposition?: string; ResponseContentType?: string } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ...overrides }),
      { expiresIn },
    );
  }
}

/* ---------------- env factory ---------------- */

/**
 * STORAGE_DRIVER=r2 needs R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
 * / R2_BUCKET. Anything else falls back to local disk at `localRoot`.
 * Misconfigured r2 throws loudly — a silent local fallback in prod would
 * scatter files across container disks.
 */
export function createStorage(localRoot: string): Storage {
  if (process.env.STORAGE_DRIVER === "r2") {
    const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
      throw new Error("STORAGE_DRIVER=r2 but R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET are not all set");
    }
    return new R2Storage({
      endpoint: R2_ENDPOINT,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
      forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
    });
  }
  return new LocalDiskStorage(localRoot);
}
