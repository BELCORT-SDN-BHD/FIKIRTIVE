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
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseStorageKey, storageKey } from "@artlio/core";

export interface Storage {
  /** Content-addressed write. Returns the hash + derived key (dedup by content). */
  /** Single-shot, in-memory put — right for uploads and render outputs
   *  (≤ tens of MB). Large-file streaming is T4b's job (Uppy presigned
   *  multipart, browser→R2 direct; the server never holds those bytes). */
  put(ownerId: string, bytes: Uint8Array, ext: string, mime?: string): Promise<{ contentHash: string; key: string }>;
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
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* ---------------- local disk ---------------- */

export class LocalDiskStorage implements Storage {
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

  async put(ownerId: string, bytes: Uint8Array, ext: string, mime?: string) {
    const contentHash = hashOf(bytes);
    const key = storageKey(ownerId, contentHash, ext);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      // Dedup best-effort, not a lock: two concurrent writers can both miss
      // Head and both Put — harmless, keys are content-addressed so the bytes
      // are identical and last-write metadata wins (mime derives from ext).
      return { contentHash, key };
    } catch (err) {
      // only a missing object means "upload"; auth/network/bucket errors
      // must surface, not silently fall through to a misleading Put
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name ?? "";
      const notFound = status === 404 || name === "NotFound" || name === "NoSuchKey";
      if (!notFound) throw err;
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
    return { contentHash, key };
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
    // caching, and anything non-renderable downloads instead of executing
    const renderable = /^(png|jpg|jpeg|webp|gif|avif|mp4|mov|webm|mkv|mp3|wav|m4a|aac|ogg|flac)$/.test(ext);
    return this.presignedGetUrl(key, expiresSeconds, {
      ResponseCacheControl: "private, no-store",
      ...(renderable ? {} : { ResponseContentDisposition: "attachment" }),
    });
  }

  private presignedGetUrl(
    key: string,
    expiresIn: number,
    overrides: { ResponseCacheControl?: string; ResponseContentDisposition?: string } = {},
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
