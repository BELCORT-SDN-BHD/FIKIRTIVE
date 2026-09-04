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
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseStorageKey, storageKey, mimeOf } from "@fikirtive/core";

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
  signPart(key: string, uploadId: string, partNumber: number, contentLength: number, expiresSeconds?: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: UploadPartReceipt[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read at most `maxBytes` from the START of an object, then stop — the bounded prefix the byte-sniff
 * media gate (工单 F) and ingest hand to the classifier. Reads via `readStream` and caps client-side,
 * so it is correct even if the driver ignores Range: the whole-object GET is abandoned once the cap
 * is reached (its iterator is closed by breaking the loop). Storage / network / auth failures THROW
 * — a failed read is an operational error the caller must treat as retryable, never as a media
 * verdict, and never a reason to fall back to a client-reported MIME.
 */
export async function readBoundedPrefix(
  store: Pick<Storage, "readStream">,
  key: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const stream = await store.readStream(key);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const remaining = maxBytes - total;
    if (remaining <= 0) break;
    // Cap EACH chunk before retaining it: a driver that returns the whole object in one giant chunk
    // must not park it in memory. `.slice()` COPIES (a `.subarray()` view would pin the whole source
    // buffer alive), so a single multi-GB chunk shrinks to at most `remaining` bytes right here.
    const piece = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    chunks.push(piece);
    total += piece.length;
    if (total >= maxBytes) break; // closes the underlying stream (async iterator .return())
  }
  const out = new Uint8Array(total); // total is now guaranteed ≤ maxBytes
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
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
    } catch (e) {
      // 2026-09-03 判官第一轮复审 P1-4:只有「本来就不在」(ENOENT)才是这份合同承诺的
      // no-op —— 别的失败(权限、磁盘、目录当文件之类的 EACCES/EPERM/EISDIR/EIO)吞下去会
      // 让调用方(asset-purge.ts 的删除类改动)误以为字节真的没了,实际字节还在磁盘上。
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw e;
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
    // Three constraints ride inside the signature so the browser's PUT can't
    // deviate: ContentType + ContentLength pin type and size (the edge
    // rejects a wrong-length body — finalize's HEAD is the authoritative
    // re-check), and IfNoneMatch:"*" makes the URL single-shot — once bytes
    // land it can't be replayed with different content before its TTL
    // (codex round: closes the post-verification replay-overwrite hole;
    // legit dedup never reaches here, authorize returns "exists" first).
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: mimeOf(ext),
        ContentLength: contentLength,
        IfNoneMatch: "*",
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

  async signPart(
    key: string,
    uploadId: string,
    partNumber: number,
    contentLength: number,
    expiresSeconds = 3600,
  ): Promise<string> {
    parseStorageKey(key);
    // sign the exact part length so a client can't upload oversized parts and
    // abandon the upload to leak storage (codex round; symmetric with the
    // single-PUT ContentLength). Uppy sends exactly this many bytes per part.
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        ContentLength: contentLength,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async completeMultipart(key: string, uploadId: string, parts: UploadPartReceipt[]): Promise<void> {
    parseStorageKey(key);
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          UploadId: uploadId,
          // IfNoneMatch:"*" makes completion refuse to overwrite an existing
          // object — same single-shot guarantee as the single-PUT path
          IfNoneMatch: "*",
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    } catch (err) {
      // object already there (concurrent same-content upload won the race):
      // content-addressed, so the bytes are identical — treat as success
      const name = (err as { name?: string })?.name ?? "";
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === "PreconditionFailed" || status === 412) {
        await this.abortMultipart(key, uploadId); // release the now-redundant parts
        return;
      }
      throw err;
    }
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

/* ---------------- ops bucket (backups/ — OUTSIDE the u/ content scheme) ---------------- */

/**
 * Ops-artifact surface for the `backups/` prefix (P0-1② nightly DB backups).
 * Keys live under `backups/` — deliberately OUTSIDE the u/<ownerId>/
 * content-addressed scheme: parseStorageKey rejects them, and the web /files
 * route serves only keys that pass keyOwnerMatches (u/<owner>/…), so an ops
 * object can never be reached from any browser-facing path. This class is the
 * only surface allowed to touch non-u/ keys, and it refuses anything outside
 * its own prefix.
 *
 * #794 — the CREDENTIALS are no longer necessarily the content bucket's. See
 * {@link opsR2Config}: when the R2_BACKUP_* family is set, backups are written
 * with a key that the app's content path does not hold.
 */
export const OPS_PREFIX = "backups/";

export interface OpsObject {
  key: string;
  lastModified: Date | null;
}

export class R2OpsBucket {
  private client: S3Client;

  constructor(
    private cfg: R2Config,
    /** #794 — which credential family this instance holds; recorded on every BackupRun row. */
    readonly credentialMode: OpsCredentialMode = "shared",
  ) {
    // same client SETTINGS as R2Storage; the credentials may differ (#794, opsR2Config)
    this.client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: cfg.forcePathStyle ?? true,
    });
  }

  private checkKey(key: string): void {
    if (!key.startsWith(OPS_PREFIX)) throw new Error(`not an ops key: ${key}`);
  }

  async exists(key: string): Promise<boolean> {
    this.checkKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch (err) {
      // only a missing object means "absent" — same discipline as R2Storage.exists
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name ?? "";
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
      throw err;
    }
  }

  /** Stream a local file up (known length — no multipart machinery needed). */
  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    this.checkKey(key);
    const { size } = await stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  /**
   * ATOMIC create-if-absent (#794 P1-3, judge r1). Streams a local file up with
   * `If-None-Match: *`, which R2/S3 evaluate server-side: the write SUCCEEDS only
   * if no object exists at the key, otherwise it fails with 412 PreconditionFailed.
   *
   * This is the real exactly-once guard for the nightly backup. A HEAD-then-PUT
   * check-then-act (see `exists()`) has a race window the moment there are TWO
   * triggers — the worker's own timer and the Railway cron service can both see
   * "key absent" and both upload. Relying on the STORE's atomicity instead of a
   * prior read closes that window: whichever PUT lands first wins the key, and the
   * loser gets `{ created: false }` and records NOTHING, so a double-trigger can
   * never produce two backups (or two success rows) for the same day.
   *
   * Returns the uploaded byte count either way so the winner can record the dump
   * size (a row that can't say how big the dump was cannot tell a 4 GB dump from a
   * 200-byte truncated one).
   */
  async putFileIfAbsent(
    key: string,
    filePath: string,
    contentType: string,
  ): Promise<{ created: boolean; sizeBytes: number }> {
    this.checkKey(key);
    const { size } = await stat(filePath);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
          IfNoneMatch: "*",
        }),
      );
      return { created: true, sizeBytes: size };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name ?? "";
      // The object already existed — another trigger won the race. Not an error.
      if (status === 412 || name === "PreconditionFailed") return { created: false, sizeBytes: size };
      throw err;
    }
  }

  async list(prefix: string): Promise<OpsObject[]> {
    this.checkKey(prefix);
    const out: OpsObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) out.push({ key: obj.Key, lastModified: obj.LastModified ?? null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deleteObject(key: string): Promise<void> {
    this.checkKey(key);
    // S3 DeleteObject is idempotent — deleting a missing key succeeds
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

/**
 * Which key family the backup writer is using.
 *  - "isolated" — the R2_BACKUP_* family: a token minted separately from the
 *    app's content key. Stealing the app's key does not let you erase backups.
 *  - "shared"   — the content bucket's own key (the pre-#794 shape). Still
 *    works; it just means one stolen credential reaches both the content and
 *    the backups that exist to survive losing the content.
 */
export type OpsCredentialMode = "isolated" | "shared";

export interface OpsR2Config extends R2Config {
  mode: OpsCredentialMode;
}

/**
 * #794 ④ — resolve the credentials the `backups/` prefix writes with.
 *
 * The isolated family is `R2_BACKUP_ACCESS_KEY_ID` + `R2_BACKUP_SECRET_ACCESS_KEY`
 * (the credential; mandatory for isolation), plus the OPTIONAL `R2_BACKUP_BUCKET`
 * / `R2_BACKUP_ENDPOINT` (default to the content bucket's — a scoped token against
 * the SAME bucket is already the whole point; a second bucket is allowed, not
 * required).
 *
 * ANY PARTIAL `R2_BACKUP_*` IS A HARD ERROR, never a silent fall back to the shared
 * key (judge r1 P1-5). The one failure this function exists to prevent is "we
 * thought backups were isolated". That belief is produced not only by a half-set
 * credential but by a LONE routing var: setting `R2_BACKUP_BUCKET` (or
 * `R2_BACKUP_ENDPOINT`) with no credential silently ignores the routing and writes
 * with the shared key — the operator asked to send backups somewhere isolated and
 * we quietly did not. So the rule is: if ANY `R2_BACKUP_*` is present, the
 * credential PAIR must be complete; otherwise refuse. Bucket/endpoint stay optional
 * only once the credential is there.
 */
export function opsR2Config(): OpsR2Config {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error("STORAGE_DRIVER=r2 but R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET are not all set");
  }
  const backupKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID;
  const backupSecret = process.env.R2_BACKUP_SECRET_ACCESS_KEY;
  const backupBucket = process.env.R2_BACKUP_BUCKET;
  const backupEndpoint = process.env.R2_BACKUP_ENDPOINT;
  const anyBackupVar = Boolean(backupKeyId || backupSecret || backupBucket || backupEndpoint);
  const credentialComplete = Boolean(backupKeyId && backupSecret);
  if (anyBackupVar && !credentialComplete) {
    throw new Error(
      "R2_BACKUP_* is only partially set. An isolated backup credential REQUIRES both " +
        "R2_BACKUP_ACCESS_KEY_ID and R2_BACKUP_SECRET_ACCESS_KEY (R2_BACKUP_BUCKET / " +
        "R2_BACKUP_ENDPOINT are optional and default to the content bucket's). Set the full " +
        "credential or unset every R2_BACKUP_* — a lone or half-set value never silently falls " +
        "back to the shared content key.",
    );
  }
  const forcePathStyle = process.env.R2_FORCE_PATH_STYLE !== "false";
  if (!credentialComplete) {
    return {
      mode: "shared",
      endpoint: R2_ENDPOINT,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
      forcePathStyle,
    };
  }
  return {
    mode: "isolated",
    endpoint: backupEndpoint || R2_ENDPOINT,
    accessKeyId: backupKeyId!,
    secretAccessKey: backupSecret!,
    bucket: backupBucket || R2_BUCKET,
    forcePathStyle,
  };
}

/**
 * Env-driven ops bucket. Returns null when the storage driver isn't r2 (local
 * dev): there is no backup target, and callers are expected to no-op.
 *
 * The returned bucket carries `credentialMode` so the caller can RECORD which
 * key family actually wrote tonight's backup (#794 ③) instead of re-reading env
 * somewhere else and reporting a guess.
 */
export function createOpsBucket(): R2OpsBucket | null {
  if (process.env.STORAGE_DRIVER !== "r2") return null;
  const cfg = opsR2Config();
  return new R2OpsBucket(cfg, cfg.mode);
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
