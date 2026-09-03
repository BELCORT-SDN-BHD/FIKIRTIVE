"use client";
/**
 * Browser side of T4b direct upload: hash → authorize → PUT straight to R2
 * (Uppy orchestrates parts/retries/progress) → hand receipts to finalize.
 *
 * hash-wasm streams the file (no whole-file memory); the sha256 names the
 * storage key, so identical content short-circuits to "exists" and never
 * moves on the wire.
 *
 * 2026-09-03 staging 走查修的两条（S2 文案 / S3 留痕）——两条都住在这一层,因为这一层
 * 是三个上传入口（Otto 附件 / EditDesk 配乐 / TemplateModal 源图）唯一的公共祖先:
 *
 *   S2 **每一条失败都带上分类,并且分类决定商家读到哪一句**。走查那次商家读到的是
 *      「Unknown error」——上传库自己的原话,从 `result.failed[].error` 一路直出。现在
 *      `reason` 只可能是两种东西:{@link UPLOAD_FAILURE_COPY} 里的两句之一,或者由我们
 *      自己的 server action 写好的那几句商家话(限流、未授权……)。底层字符串一律止步于此。
 *
 *   S3 **每一条失败都向服务端报一笔**。直传的字节走「浏览器 → 存储桶」,服务器不在路上,
 *      所以走查那次 web 日志里一行都没有。`reportDirectUploadFailure` 把这条缺失的边补回来
 *      (只送枚举与数字,详见它的注释)。
 */
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import { createSHA256 } from "hash-wasm";
import {
  mimeOf,
  uploadExtFromFilename,
  UPLOAD_FAILURE_COPY,
  UPLOAD_MAX_BYTES,
  UPLOAD_SINGLE_MAX_BYTES,
  UPLOAD_PART_BYTES,
  type FinalizedUpload,
  type UploadFailureCategory,
  type UploadPart,
} from "@fikirtive/core/upload";
import { authorizeUpload, signUploadPart, abortDirectUpload, uploadFileFallback, reportDirectUploadFailure } from "./upload-actions";

export interface DirectUploadFailure {
  filename: string;
  /**
   * 商家读的那一句。**永远**是商家话:要么 {@link UPLOAD_FAILURE_COPY} 的两句之一,要么
   * server action 自己写的那几句(限流、未授权)。上传库、供应商、异常对象的原话到不了这里。
   */
  reason: string;
  /** `rejected` = 换个文件才有救;`blocked` = 再试一次就有救。界面按它决定语气与出路。 */
  category: UploadFailureCategory;
}

export interface DirectUploadOutcome {
  files: FinalizedUpload[];
  failures: DirectUploadFailure[];
}

async function hashFile(file: File): Promise<string> {
  const hasher = await createSHA256();
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest("hex");
}

type FileMeta = {
  sha256: string;
  ext: string;
  sizeBytes: number;
  singleUrl?: string;
  uploadId?: string;
  storKey: string;
};

/**
 * 一笔失败的留痕（S3）。**留痕失败绝不能盖掉上传失败本身** —— 商家已经在看一条错误了,
 * 再从这里抛一个异常上去,只会把那条错误换成另一条更没头绪的。所以整段吞掉。
 */
async function reportFailure(
  stage: "precheck" | "authorize" | "transfer",
  category: UploadFailureCategory,
  ext: string | null,
  sizeBytes: number,
  httpStatus: number | null,
): Promise<void> {
  try {
    await reportDirectUploadFailure({ stage, category, ext, sizeBytes, httpStatus });
  } catch {
    // 服务端也够不着(整段断网就是这种情形)。商家那一句已经在路上了,这里到此为止。
  }
}

/**
 * Upload files browser→R2. onProgress reports 0..100 per filename (hashing
 * counts as the first tick so big files show life immediately).
 */
export async function uploadFilesDirect(
  files: File[],
  onProgress: (filename: string, pct: number) => void,
): Promise<DirectUploadOutcome> {
  const done: FinalizedUpload[] = [];
  const failures: DirectUploadFailure[] = [];
  type Pending = { file: File; meta: FileMeta };
  const pending: Pending[] = [];

  // hash + authorize serially — hashing saturates one core anyway, and the
  // authorize round-trips are cheap next to the uploads themselves
  for (const file of files) {
    const ext = uploadExtFromFilename(file.name);
    if (!ext) {
      failures.push({ filename: file.name, reason: UPLOAD_FAILURE_COPY.rejected, category: "rejected" });
      await reportFailure("precheck", "rejected", null, file.size, null);
      continue;
    }
    if (file.size === 0 || file.size > UPLOAD_MAX_BYTES) {
      failures.push({ filename: file.name, reason: UPLOAD_FAILURE_COPY.rejected, category: "rejected" });
      await reportFailure("precheck", "rejected", ext, file.size, null);
      continue;
    }
    try {
      onProgress(file.name, 1);
      const sha256 = await hashFile(file);
      const auth = await authorizeUpload({ sha256, ext, sizeBytes: file.size });
      if ("error" in auth) {
        // server action 自己写的商家话(限流、未授权、越界)——比通用句更有指向,原样用。
        // 它出自服务端,所以那一边已经有日志了;这里仍报一笔,让「授权被拒」在直传这条
        // 时间线上也看得见。
        failures.push({ filename: file.name, reason: auth.error, category: "rejected" });
        await reportFailure("authorize", "rejected", ext, file.size, null);
        continue;
      }
      if (auth.kind === "exists") {
        onProgress(file.name, 100);
        done.push({ sha256, ext, sizeBytes: file.size, originalFilename: file.name, upload: { mode: "existed" } });
        continue;
      }
      // F41: driver can't presign (dev local disk) — upload through the server
      // action instead. The server hashes + bounds-checks the bytes itself and
      // returns the same FinalizedUpload receipt shape.
      if (auth.kind === "unsupported") {
        const fd = new FormData();
        fd.set("file", file);
        const res = await uploadFileFallback(fd);
        if ("error" in res) {
          failures.push({ filename: file.name, reason: res.error, category: "rejected" });
          await reportFailure("authorize", "rejected", ext, file.size, null);
        } else {
          onProgress(file.name, 100);
          done.push(res.ok);
        }
        continue;
      }
      pending.push({
        file,
        meta: {
          sha256,
          ext,
          sizeBytes: file.size,
          storKey: `${sha256}.${ext}`,
          ...(auth.kind === "single" ? { singleUrl: auth.url } : { uploadId: auth.uploadId }),
        },
      });
    } catch {
      // 断网、server action 够不着、读文件流中途出错 —— 这一路以前原样冒到组件的 catch,
      // 由那里把 `err.message` 送上屏(走查 S2 的第二条泄漏路)。就地收成一句商家话。
      failures.push({ filename: file.name, reason: UPLOAD_FAILURE_COPY.blocked, category: "blocked" });
      await reportFailure("authorize", "blocked", ext, file.size, null);
    }
  }

  if (pending.length === 0) return { files: done, failures };

  // receipts collected as parts complete, keyed by our sha-derived pseudo-key
  const partReceipts = new Map<string, UploadPart[]>();

  const uppy = new Uppy({ autoProceed: false, allowMultipleUploadBatches: false });
  uppy.use(AwsS3, {
    shouldUseMultipart: (f) => (f.size ?? 0) > UPLOAD_SINGLE_MAX_BYTES,
    getChunkSize: () => UPLOAD_PART_BYTES,

    // single PUT — URL was signed with ContentType + ContentLength +
    // IfNoneMatch, so the browser must echo exactly those headers
    getUploadParameters: (f) => {
      const meta = f.meta as unknown as FileMeta;
      return {
        method: "PUT" as const,
        url: meta.singleUrl!,
        headers: { "Content-Type": mimeOf(meta.ext), "If-None-Match": "*" },
      };
    },

    // multipart — authorize already created the upload; report its handle
    createMultipartUpload: (f) => {
      const meta = f.meta as unknown as FileMeta;
      return { uploadId: meta.uploadId!, key: meta.storKey };
    },
    signPart: async (f, { uploadId, partNumber }) => {
      const meta = f.meta as unknown as FileMeta;
      const res = await signUploadPart({
        sha256: meta.sha256,
        ext: meta.ext,
        sizeBytes: meta.sizeBytes,
        uploadId,
        partNumber,
      });
      if ("error" in res) throw new Error(res.error);
      return { url: res.url };
    },
    completeMultipartUpload: (f, { parts }) => {
      const meta = f.meta as unknown as FileMeta;
      partReceipts.set(
        meta.storKey,
        parts.map((p, i) => ({ partNumber: p.PartNumber ?? i + 1, etag: p.ETag ?? "" })),
      );
      return {}; // the server completes it inside finalize (HEAD-verified)
    },
    abortMultipartUpload: async (f, { uploadId }) => {
      const meta = f.meta as unknown as FileMeta;
      await abortDirectUpload({ sha256: meta.sha256, ext: meta.ext, uploadId });
    },
    listParts: () => [],
  });

  uppy.on("upload-progress", (f, progress) => {
    if (!f || !progress.bytesTotal) return;
    onProgress(f.name ?? "", Math.max(1, Math.round((progress.bytesUploaded / progress.bytesTotal) * 99)));
  });

  /**
   * 传输层拿得到的 HTTP 状态码,按文件名记下来（S3）。
   *
   * 为什么值得单收一手:被 CORS 掐掉的请求在浏览器里**没有**状态码(拿到 0 或干脆没有
   * response),真正的 4xx/5xx 才有。运维看到「stage=transfer httpStatus=none」就知道
   * 该去查桶的 CORS,而不是去查我们的签名 —— 那正是这次 staging 走查烧掉的时间。
   * 只留一个数字:错误原文里可能带着预签名 URL(query 里有签名),一律不收。
   */
  const transferStatus = new Map<string, number | null>();
  uppy.on("upload-error", (f, _error, response) => {
    transferStatus.set(f?.name ?? "", typeof response?.status === "number" ? response.status : null);
  });

  for (const { file, meta } of pending) {
    uppy.addFile({ name: file.name, type: mimeOf(meta.ext), data: file, meta: meta as unknown as Record<string, unknown> });
  }

  let result: Awaited<ReturnType<typeof uppy.upload>> | undefined;
  try {
    result = await uppy.upload();
  } catch {
    // uppy.upload() 整趟抛(而不是把失败摊进 result.failed)时,以前这一路直接冒出函数,
    // 三个入口的 catch 各自把 `err.message` 送上屏。这里收成:全部待传文件算一次 blocked。
    result = undefined;
  }
  for (const f of result?.successful ?? []) {
    const meta = f.meta as unknown as FileMeta;
    onProgress(f.name ?? "", 100);
    done.push({
      sha256: meta.sha256,
      ext: meta.ext,
      sizeBytes: meta.sizeBytes,
      originalFilename: f.name ?? "upload",
      upload: meta.uploadId
        ? { mode: "multipart", uploadId: meta.uploadId, parts: partReceipts.get(meta.storKey) ?? [] }
        : { mode: "single" },
    });
  }
  // 没传上去的那一批,一律收成同一个形状再处理。`result` 为 undefined(整趟抛)时一个文件
  // 都没落地,所以待传清单整份算失败 —— 免得那种情形既没有成功回执、也没有失败条目,
  // 被上层读成「什么都没发生」。
  const landed = new Set((result?.successful ?? []).map((f) => f.name ?? ""));
  const failedFiles: { name: string; ext: string; sizeBytes: number }[] = result
    ? (result.failed ?? []).map((f) => {
        const meta = f.meta as unknown as FileMeta;
        return { name: f.name ?? "upload", ext: meta.ext, sizeBytes: meta.sizeBytes };
      })
    : pending
        .filter((p) => !landed.has(p.file.name))
        .map((p) => ({ name: p.file.name, ext: p.meta.ext, sizeBytes: p.meta.sizeBytes }));
  for (const f of failedFiles) {
    failures.push({ filename: f.name, reason: UPLOAD_FAILURE_COPY.blocked, category: "blocked" });
    await reportFailure("transfer", "blocked", f.ext, f.sizeBytes, transferStatus.get(f.name) ?? null);
  }
  uppy.destroy();

  return { files: done, failures };
}
