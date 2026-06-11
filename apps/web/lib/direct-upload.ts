"use client";
/**
 * Browser side of T4b direct upload: hash → authorize → PUT straight to R2
 * (Uppy orchestrates parts/retries/progress) → hand receipts to finalize.
 *
 * hash-wasm streams the file (no whole-file memory); the sha256 names the
 * storage key, so identical content short-circuits to "exists" and never
 * moves on the wire.
 */
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import { createSHA256 } from "hash-wasm";
import {
  mimeOf,
  uploadExtFromFilename,
  UPLOAD_MAX_BYTES,
  UPLOAD_SINGLE_MAX_BYTES,
  UPLOAD_PART_BYTES,
  type FinalizedUpload,
  type UploadPart,
} from "@artlio/core";
import { authorizeUpload, signUploadPart, abortDirectUpload } from "./upload-actions";

export interface DirectUploadFailure {
  filename: string;
  reason: string;
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
      failures.push({ filename: file.name, reason: "file type not supported" });
      continue;
    }
    if (file.size === 0 || file.size > UPLOAD_MAX_BYTES) {
      failures.push({ filename: file.name, reason: "file is empty or over the 2 GiB cap" });
      continue;
    }
    onProgress(file.name, 1);
    const sha256 = await hashFile(file);
    const auth = await authorizeUpload({ sha256, ext, sizeBytes: file.size });
    if ("error" in auth) {
      failures.push({ filename: file.name, reason: auth.error });
      continue;
    }
    if (auth.kind === "exists") {
      onProgress(file.name, 100);
      done.push({ sha256, ext, sizeBytes: file.size, originalFilename: file.name, upload: { mode: "existed" } });
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
  }

  if (pending.length === 0) return { files: done, failures };

  // receipts collected as parts complete, keyed by our sha-derived pseudo-key
  const partReceipts = new Map<string, UploadPart[]>();

  const uppy = new Uppy({ autoProceed: false, allowMultipleUploadBatches: false });
  uppy.use(AwsS3, {
    shouldUseMultipart: (f) => (f.size ?? 0) > UPLOAD_SINGLE_MAX_BYTES,
    getChunkSize: () => UPLOAD_PART_BYTES,

    // single PUT — URL was signed at authorize time with ContentType+Length
    getUploadParameters: (f) => {
      const meta = f.meta as unknown as FileMeta;
      return {
        method: "PUT" as const,
        url: meta.singleUrl!,
        headers: { "Content-Type": mimeOf(meta.ext) },
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

  for (const { file, meta } of pending) {
    uppy.addFile({ name: file.name, type: mimeOf(meta.ext), data: file, meta: meta as unknown as Record<string, unknown> });
  }

  const result = await uppy.upload();
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
  for (const f of result?.failed ?? []) {
    failures.push({ filename: f.name ?? "upload", reason: f.error ?? "upload failed" });
  }
  uppy.destroy();

  return { files: done, failures };
}
