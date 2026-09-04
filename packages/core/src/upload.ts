/**
 * Direct-upload contract (T4b, design doc D19) — browser → R2 presigned
 * upload, server never holds the bytes. The browser hashes the file
 * (hash-wasm), asks the server to AUTHORIZE the upload, PUTs directly to
 * object storage, then FINALIZEs (DB rows + ingest dispatch).
 *
 * D19 hardening encoded here:
 *  - issuance constraints: ext allow-list, size cap, hash shape — all
 *    validated BEFORE any URL is signed
 *  - owner-namespaced keys: ownerId comes from the session server-side,
 *    never from this contract (no field for it, by design)
 *  - server-side hash re-check: the worker re-hashes the object during
 *    ingest and deletes mismatches (claimed sha256 is untrusted input)
 *  - mime is NOT client input anywhere: ContentType derives from the
 *    allow-listed ext server-side (a stored text/html ContentType on an
 *    "image" key would defeat download/nosniff protections)
 *
 * Enforcement model (codex round, no server-side session state):
 * every claimed value is re-checked where it has teeth — R2 itself binds
 * uploadId↔key (cross-key part PUTs fail), finalize re-derives the key from
 * the session owner, validates the parts list shape against the claimed
 * size, and MUST HeadObject-verify the actual stored byte count before any
 * DB row exists; the ingest worker then re-hashes the bytes. Lying about
 * sizeBytes therefore buys nothing: the object is deleted at finalize
 * (size mismatch) or at ingest (hash mismatch).
 */
import { z } from "zod";
import { EXT_BY_TYPE } from "./timeline.js";

/** Everything a creator may upload: candidate stills/clips + soundtrack. */
export const UPLOAD_EXTS: readonly string[] = [
  ...EXT_BY_TYPE.image,
  ...EXT_BY_TYPE.video,
  ...EXT_BY_TYPE.audio,
];

/** Product cap — generous for AI-generated clips, far under R2's 5 GiB
 *  single-PUT ceiling once multipart kicks in. */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
/** Files at or under this go up in one presigned PUT; larger go multipart. */
export const UPLOAD_SINGLE_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
/** S3/R2 invariants: every part except the last ≥ 5 MiB, ≤ 10000 parts,
 *  non-last parts equal-sized, complete list strictly ascending. */
export const UPLOAD_MIN_PART_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MAX_PARTS = 10_000;
/** Uniform multipart part size (last part may be smaller). 64 MiB keeps the
 *  cap-sized file at 32 parts — far from the 10000-part ceiling. */
export const UPLOAD_PART_BYTES = 64 * 1024 * 1024;
/** Presigned upload URLs stay valid this long — long enough for a slow
 *  residential uplink to move one part, short enough to limit replay. */
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/** How many parts a well-formed multipart upload of `sizeBytes` has. */
export function expectedPartCount(sizeBytes: number): number {
  return Math.ceil(sizeBytes / UPLOAD_PART_BYTES);
}

/** Exact byte length part `partNumber` (1-indexed) must carry for `sizeBytes`
 *  — every part is UPLOAD_PART_BYTES except the last (the remainder). Signing
 *  this as ContentLength bounds each part (codex round: stops oversized parts
 *  leaking storage on abandoned uploads). Returns null if the part is out of
 *  range for the claimed size. */
export function expectedPartLength(sizeBytes: number, partNumber: number): number | null {
  const count = expectedPartCount(sizeBytes);
  if (partNumber < 1 || partNumber > count) return null;
  return partNumber < count ? UPLOAD_PART_BYTES : sizeBytes - (count - 1) * UPLOAD_PART_BYTES;
}

/** ContentType always derives from the allow-listed ext — never from client
 *  input (a stored text/html ContentType on an image key would defeat the
 *  download/nosniff posture of presigned serving). */
export function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", avif: "image/avif", mp4: "video/mp4", mov: "video/quicktime",
    webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg", wav: "audio/wav",
    m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Allow-listed extension from a filename, or null when not uploadable —
 *  shared by the browser (early rejection with a clear message) and the
 *  server (authoritative check via the zod schemas above). */
export function uploadExtFromFilename(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return UPLOAD_EXTS.includes(ext) ? ext : null;
}

const sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { message: "sha256 must be 64 lowercase hex chars" });

const uploadExt = z
  .string()
  .regex(/^[a-z0-9]{1,8}$/)
  .refine((e) => UPLOAD_EXTS.includes(e), { message: "extension not allowed for upload" });

/** S3 UploadId — opaque vendor string; bound to its key by R2 itself. */
const uploadId = z.string().min(1).max(1024);

/** What the browser must present to get an upload authorized. */
export const authorizeUploadInput = z
  .object({
    sha256: sha256Hex,
    ext: uploadExt,
    sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
  })
  .strict();
export type AuthorizeUploadInput = z.infer<typeof authorizeUploadInput>;

/** Server's answer to an authorize request. */
export type AuthorizeUploadResult =
  | { kind: "exists" } // content-addressed dedup: blob already stored, skip the wire
  | { kind: "single"; url: string }
  | { kind: "multipart"; uploadId: string; partSizeBytes: number }
  // F41: driver can't presign (dev local disk) — client falls back to the
  // server-action upload path (uploadFileFallback) instead of dead-ending.
  | { kind: "unsupported" };

/** Per-part URL signing request. sizeBytes is re-claimed so the server can
 *  bound partNumber without holding session state; the binding that matters
 *  happens at finalize (HEAD size check) and ingest (re-hash). */
export const signPartInput = z
  .object({
    sha256: sha256Hex,
    ext: uploadExt,
    sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
    uploadId,
    partNumber: z.number().int().min(1).max(UPLOAD_MAX_PARTS),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.partNumber > expectedPartCount(v.sizeBytes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `partNumber ${v.partNumber} exceeds the ${expectedPartCount(v.sizeBytes)} parts a ${v.sizeBytes}-byte upload needs`,
      });
    }
  });
export type SignPartInput = z.infer<typeof signPartInput>;

export const abortUploadInput = z
  .object({ sha256: sha256Hex, ext: uploadExt, uploadId })
  .strict();
export type AbortUploadInput = z.infer<typeof abortUploadInput>;

/** One uploaded part's receipt, echoed back for CompleteMultipartUpload. */
export const uploadPart = z
  .object({
    partNumber: z.number().int().min(1).max(UPLOAD_MAX_PARTS),
    etag: z.string().min(1).max(200),
  })
  .strict();
export type UploadPart = z.infer<typeof uploadPart>;

/**
 * One finalized file: metadata for the Asset row plus how its bytes arrived.
 * The server re-derives the storage key from (session owner, sha256, ext),
 * completes multipart uploads, and re-checks the object server-side —
 * nothing here is trusted beyond shaping rows. No mime field: ContentType
 * and Asset.mime derive from ext.
 */
export const finalizedUpload = z
  .object({
    sha256: sha256Hex,
    ext: uploadExt,
    sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
    originalFilename: z.string().min(1).max(300),
    upload: z.discriminatedUnion("mode", [
      // blob already existed (dedup) — nothing moved on the wire
      z.object({ mode: z.literal("existed") }).strict(),
      // one presigned PUT carried it
      z.object({ mode: z.literal("single") }).strict(),
      // multipart: receipts for CompleteMultipartUpload
      z.object({ mode: z.literal("multipart"), uploadId, parts: z.array(uploadPart).min(1).max(UPLOAD_MAX_PARTS) }).strict(),
    ]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.upload.mode === "single" && v.sizeBytes > UPLOAD_SINGLE_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `single-PUT uploads are capped at ${UPLOAD_SINGLE_MAX_BYTES} bytes`,
      });
    }
    if (v.upload.mode === "multipart") {
      if (v.sizeBytes <= UPLOAD_SINGLE_MAX_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "multipart claimed for a file small enough that authorize would have issued a single PUT",
        });
        return;
      }
      const expected = expectedPartCount(v.sizeBytes);
      const parts = v.upload.parts;
      if (parts.length !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `expected ${expected} parts for ${v.sizeBytes} bytes, got ${parts.length}`,
        });
        return;
      }
      // complete list must be exactly 1..N ascending (S3 InvalidPartOrder)
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]?.partNumber !== i + 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `parts must be exactly 1..${expected} in ascending order`,
          });
          return;
        }
      }
    }
  });
export type FinalizedUpload = z.infer<typeof finalizedUpload>;

/** Finalize batch — one candidate-drop's worth of files. */
export const finalizeUploadsInput = z
  .object({ files: z.array(finalizedUpload).min(1).max(50) })
  .strict();
export type FinalizeUploadsInput = z.infer<typeof finalizeUploadsInput>;

/**
 * 上传失败时商家读到的**唯一**两句话（2026-09-03 staging 走查 S2）。
 *
 * 走查现场:staging 的存储桶 CORS 把浏览器直传挡在门外,商家看到的是上传库自己的原话
 * 「Unknown error」——既没告诉他发生了什么,也没给他下一步,而「Unknown error」这四个字
 * 本身就是我们在替一个第三方库对商家说话。同一族的漏法还有三处组件里的
 * `err.message` 直出:任何一层抛上来的字符串都能原样上屏。
 *
 * 所以话在这里定,只定两句 —— 因为商家真正需要区分的只有两件事:
 *   `blocked`  文件本身没问题,是这一趟没走通(断网、被拦、传到一半断) → 再试一次就有救。
 *   `rejected` 这个文件我们收不了(类型不在允许名单、空文件、超过上限) → 换一个文件才有救。
 * 把两者混成一句,就会让「换个文件」和「再试一次」这两条互斥的出路互相盖掉。
 *
 * 摆在 upload.ts 而不是 apps/web:这两句引用的上限就定义在本文件上面几十行
 * ({@link UPLOAD_MAX_BYTES}),放一起才不会出现「话说 2 GB、闸放 4 GB」那种漂移;
 * 而且浏览器端(direct-upload.ts)与服务端两边都能读同一份,不必抄第二遍。
 *
 * 白标纪律照旧:不出现库名、供应商名、HTTP 状态码或任何技术名词 —— 底层细节只进日志
 * (`reportDirectUploadFailure`),不进界面。
 */
export type UploadFailureCategory = "blocked" | "rejected";

/** 上限说给商家听的说法。数字算自 {@link UPLOAD_MAX_BYTES},不写第二遍。 */
export const UPLOAD_MAX_LABEL = `${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024 * 1024))} GB`;

export const UPLOAD_FAILURE_COPY: Record<UploadFailureCategory, string> = {
  blocked: "We couldn’t upload that file. Check your connection and try again.",
  rejected: `We can’t use that file. Pick an image, video, or audio file under ${UPLOAD_MAX_LABEL}.`,
};

/**
 * 直传失败向服务端报的那一笔（2026-09-03 staging 走查 S3）。
 *
 * 走查现场的第二条缺陷:直传是浏览器→存储桶,失败**完全不经过我们的服务器**,所以
 * staging 那次商家撞墙时,web 日志里一行都没有。没有日志 = 只能等商家开口 = 我们永远
 * 是最后一个知道的人。
 *
 * 字段是一份**封闭集**,不是一个自由文本通道 —— 这是刻意的:
 *   - 没有文件内容、没有文件名、没有 URL。预签名 URL 的 query 里带签名,一旦让原始错误
 *     串搭车进来,凭据就会从浏览器流进日志。所以这里连原始 message 都不收。
 *   - 没有 orgId 字段。租户身份只能来自已认证的 server principal(`requireOwner()`),
 *     客户端说自己是谁一律不算数。
 *   - `httpStatus` 是数字,`stage`/`category` 是枚举 —— 三个都无法夹带任意字符串。
 */
export const directUploadFailureReport = z
  .object({
    /** 哪一步断的:浏览器自己的预检、向服务端要授权、还是真正传字节。 */
    stage: z.enum(["precheck", "authorize", "transfer"]),
    category: z.enum(["blocked", "rejected"]),
    /** 允许名单里的扩展名;认不出扩展名的文件报 null(不回传原始文件名)。 */
    ext: z.string().regex(/^[a-z0-9]{1,8}$/).nullable(),
    sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    /** 传输层拿得到就带上(0 / 缺失 ≈ 被 CORS 或断网掐掉),拿不到就 null。 */
    httpStatus: z.number().int().min(0).max(599).nullable(),
  })
  .strict();
export type DirectUploadFailureReport = z.infer<typeof directUploadFailureReport>;
