"use server";
/**
 * Browser-direct upload actions (T4b, D19). The bytes never touch this
 * server: authorize signs constrained URLs, the browser PUTs straight to R2,
 * finalize completes multiparts + re-checks reality + writes the same DB
 * rows the legacy path wrote.
 *
 * D19 enforcement lives here:
 *  - issuance constraints: contract zod parse BEFORE any URL is signed
 *  - owner-namespaced keys: ownerId is the session owner, never client input
 *  - size re-check: finalize HEADs the object — actual bytes must equal the
 *    claimed size or the object is deleted on the spot
 *  - hash re-check: every finalized asset gets an INGEST job; the worker
 *    re-hashes the stream and deletes mismatches (see worker/jobs/ingest)
 */
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/node";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import {
  authorizeUploadInput,
  signPartInput,
  abortUploadInput,
  directUploadFailureReport,
  finalizeUploadsInput,
  storageKey,
  mimeOf,
  resolveUploadMime,
  isStaticImageExt,
  MEDIA_SNIFF_BYTES,
  newId,
  uploadExtFromFilename,
  UPLOAD_SINGLE_MAX_BYTES,
  UPLOAD_PART_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  expectedPartLength,
  type AuthorizeUploadResult,
  type FinalizedUpload,
} from "@fikirtive/core";
import { readBoundedPrefix } from "@fikirtive/storage";
import { storage } from "@/lib/storage";
import { dispatchIngest } from "@/lib/ingest-dispatch";
import { buildEntitySnapshot } from "@/lib/entity-snapshot";
import { requireOwner, resolveUserPrincipal } from "@/lib/auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { consumeUploadGate } from "@/lib/rate-limit-gates";

export async function authorizeUpload(raw: unknown): Promise<AuthorizeUploadResult | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  // 租户围栏切片②（规格 docs/specs/tenant-isolation.md，#1377，TENANT-A1/A2）。
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, () => authorizeUploadInFrame(gate.ownerId, raw));
}

async function authorizeUploadInFrame(
  ownerId: string,
  raw: unknown,
): Promise<AuthorizeUploadResult | { error: string }> {
  // #795 — the upload gate, per tenant, per hour. Every call to this action mints a presigned URL
  // into our own bucket, and until now nothing counted them. Placed after the owner is known and
  // before anything is signed, so a refusal hands out no URL and reserves no key. Sized well above
  // a bulk product import (see UPLOAD_PER_TENANT_PER_HOUR).
  if (!(await consumeUploadGate(ownerId))) {
    return { error: "You've uploaded a lot of files in the last hour. Try again a little later." };
  }
  const parsed = authorizeUploadInput.safeParse(raw);
  if (!parsed.success) return { error: "That file can't be uploaded (type or size out of bounds)." };
  // F41: not an error — the client falls back to the server-action upload path
  // (uploadFileFallback below), which is how dev's local-disk driver uploads.
  if (!storage.supportsDirectUpload) return { kind: "unsupported" };
  const { sha256, ext, sizeBytes } = parsed.data;
  const key = storageKey(ownerId, sha256, ext);
  if (await storage.exists(key)) return { kind: "exists" };
  if (sizeBytes <= UPLOAD_SINGLE_MAX_BYTES) {
    return { kind: "single", url: await storage.presignedPut(key, sizeBytes, UPLOAD_URL_TTL_SECONDS) };
  }
  const uploadId = await storage.createMultipart(key);
  return { kind: "multipart", uploadId, partSizeBytes: UPLOAD_PART_BYTES };
}

/**
 * F41: server-action upload for drivers WITHOUT direct upload (dev local disk).
 * The bytes come through the action body (next.config bodySizeLimit 256mb was
 * reserved for exactly this path), the hash is computed SERVER-side (stronger
 * than the direct path's client claim), and the receipt is FinalizedUpload-
 * shaped (mode:"existed") so finalizeCandidateUploads works unchanged.
 * Refused when the driver supports direct upload — no alternate upload path on prod.
 */
export async function uploadFileFallback(
  formData: FormData,
): Promise<{ ok: FinalizedUpload } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, () => uploadFileFallbackInFrame(gate.ownerId, formData));
}

async function uploadFileFallbackInFrame(
  ownerId: string,
  formData: FormData,
): Promise<{ ok: FinalizedUpload } | { error: string }> {
  if (storage.supportsDirectUpload) return { error: "Use direct upload on this storage driver." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file in the upload request." };
  const ext = uploadExtFromFilename(file.name);
  if (!ext) return { error: "file type not supported" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Same authoritative bounds as the direct path (type + size), one contract.
  const parsed = authorizeUploadInput.safeParse({ sha256, ext, sizeBytes: bytes.byteLength });
  if (!parsed.success) return { error: "That file can't be uploaded (type or size out of bounds)." };
  const { contentHash } = await storage.put(ownerId, bytes, ext);
  return {
    ok: {
      sha256: contentHash,
      ext,
      sizeBytes: bytes.byteLength,
      originalFilename: file.name,
      upload: { mode: "existed" },
    },
  };
}

export async function signUploadPart(raw: unknown): Promise<{ url: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, () => signUploadPartInFrame(gate.ownerId, raw));
}

async function signUploadPartInFrame(ownerId: string, raw: unknown): Promise<{ url: string } | { error: string }> {
  if (!storage.supportsDirectUpload) return { error: "Direct upload is not available on this storage driver." };
  const parsed = signPartInput.safeParse(raw);
  if (!parsed.success) return { error: "Malformed part-signing request." };
  const { sha256, ext, sizeBytes, uploadId, partNumber } = parsed.data;
  const partLength = expectedPartLength(sizeBytes, partNumber);
  if (partLength === null) return { error: "Part number out of range for the declared size." };
  const key = storageKey(ownerId, sha256, ext);
  return { url: await storage.signPart(key, uploadId, partNumber, partLength, UPLOAD_URL_TTL_SECONDS) };
}

export async function abortDirectUpload(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, () => abortDirectUploadInFrame(gate.ownerId, raw));
}

async function abortDirectUploadInFrame(ownerId: string, raw: unknown): Promise<{ ok: true } | { error: string }> {
  if (!storage.supportsDirectUpload) return { error: "Direct upload is not available on this storage driver." };
  const parsed = abortUploadInput.safeParse(raw);
  if (!parsed.success) return { error: "Malformed abort request." };
  const { sha256, ext, uploadId } = parsed.data;
  await storage.abortMultipart(storageKey(ownerId, sha256, ext), uploadId);
  return { ok: true };
}

/**
 * 直传失败的留痕（2026-09-03 staging 走查 S3）。
 *
 * 病根:直传的字节走「浏览器 → 存储桶」,我们的服务器**完全不在这条路上**。所以 staging
 * 那次桶的 CORS 把商家挡在门外时,web 日志里连一行都没有 —— 商家撞了墙,我们零感知。
 * 这个 action 就是把那条缺失的边补回来:传不动的那一刻,浏览器主动回报一笔。
 *
 * 三件事刻意为之:
 *   ① **租户身份不收客户端的**。`requireOwner()` 出来的 `ownerId` 才是这条日志上的 org;
 *      报告体里根本没有 orgId 字段可填(见 `directUploadFailureReport`)。
 *   ② **不收原始错误串**。预签名 URL 的 query 带签名,一旦让底层 message 搭车,凭据就
 *      从浏览器流进日志。报告体只有枚举与数字,夹带不进任意字符串。
 *   ③ **只记录,不改变任何东西**。没有数据库写、没有钱路、没有存储动作 —— 一次失败的
 *      上传本来就没留下要清理的东西(multipart 由 `abortDirectUpload` 收尾)。
 *
 * 日志行按本文件既有的 `[upload] …` 形状写,可直接 grep `DIRECT-UPLOAD-FAILED`;同时补一条
 * Sentry(与 `lib/ingest-dispatch.ts` 的 `reportUndispatchedIngest` 同一约定:没配 DSN 就只留 stdout,本地/CI 零副作用)。
 */
export async function reportDirectUploadFailure(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, () => reportDirectUploadFailureInFrame(gate, raw));
}

async function reportDirectUploadFailureInFrame(
  gate: { email: string; ownerId: string },
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const parsed = directUploadFailureReport.safeParse(raw);
  if (!parsed.success) return { error: "Malformed upload failure report." };
  const { stage, category, ext, sizeBytes, httpStatus } = parsed.data;
  const line = `[upload] DIRECT-UPLOAD-FAILED org=${gate.ownerId} stage=${stage} category=${category} ext=${ext ?? "unknown"} sizeBytes=${sizeBytes} httpStatus=${httpStatus ?? "none"}`;
  console.error(line);
  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(line, {
      level: "error",
      tags: { probe: "direct-upload", stage, category },
      extra: { orgId: gate.ownerId, ext: ext ?? "unknown", sizeBytes, httpStatus },
    });
  }
  return { ok: true };
}

/**
 * Same DB effects as the legacy uploadCandidates (asset upsert + Generation
 * carrying the composer context + audit event + ingest dispatch), with the
 * bytes already sitting in object storage. Files are verified independently:
 * good files land, bad files are deleted and reported.
 */
export async function finalizeCandidateUploads(
  projectId: string,
  promptText: string,
  entityIds: string[],
  raw: unknown,
): Promise<{ ok: true; count: number; failures: { filename: string; reason: string }[]; generationIds: string[] } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, () => finalizeCandidateUploadsInFrame(gate.ownerId, projectId, promptText, entityIds, raw));
}

async function finalizeCandidateUploadsInFrame(
  ownerId: string,
  projectId: string,
  promptText: string,
  entityIds: string[],
  raw: unknown,
): Promise<{ ok: true; count: number; failures: { filename: string; reason: string }[]; generationIds: string[] } | { error: string }> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) return { error: "Project not found." };
  // Callers (OttoChatStream / TemplateModal) pass the receipts ARRAY; the schema
  // declares the wrapped shape — wrap here so the declared contract stays intact.
  // (Unwrapped, every finalize died with "Malformed finalize request." — F41 QA find.)
  const parsed = finalizeUploadsInput.safeParse({ files: raw });
  if (!parsed.success) return { error: "Malformed finalize request." };

  const entitySnapshot = await buildEntitySnapshot(ownerId, entityIds.map(String).filter(Boolean));

  const failures: { filename: string; reason: string }[] = [];
  const verified: { key: string; file: (typeof parsed.data.files)[number] }[] = [];

  for (const file of parsed.data.files) {
    const key = storageKey(ownerId, file.sha256, file.ext);
    try {
      if (file.upload.mode === "multipart") {
        await storage.completeMultipart(key, file.upload.uploadId, file.upload.parts);
      }
      // D19 size re-check: the claimed size bought URLs, reality decides rows
      const actual = await storage.sizeOf(key);
      if (actual === null) {
        failures.push({ filename: file.originalFilename, reason: "upload never arrived" });
        continue;
      }
      if (actual !== file.sizeBytes) {
        // NEVER destroy a content-addressed blob that other rows might share: in
        // "existed" mode we didn't upload it (it pre-existed); in single/multipart
        // we did, but only reclaim the key if no live Asset references this hash —
        // a size lie on a deduped hash must not delete real, referenced bytes (#1)
        const reclaimable =
          file.upload.mode !== "existed" &&
          (await prisma.asset.count({ where: { ownerId, contentHash: file.sha256, deletedAt: null } })) === 0;
        if (reclaimable) {
          await storage.deleteObject(key);
          console.error(`[upload] SIZE MISMATCH ${key}: claimed ${file.sizeBytes}, stored ${actual} — object reclaimed`);
        } else {
          console.error(`[upload] SIZE MISMATCH ${key}: claimed ${file.sizeBytes}, stored ${actual} — kept (pre-existing or shared content)`);
        }
        failures.push({ filename: file.originalFilename, reason: "size mismatch — upload rejected" });
        continue;
      }
      verified.push({ key, file });
    } catch (e) {
      console.error(`[upload] finalize failed for ${key}:`, e instanceof Error ? e.message : e);
      failures.push({ filename: file.originalFilename, reason: "storage error during finalize" });
    }
  }

  if (verified.length === 0) {
    return { error: failures[0]?.reason ?? "No files could be finalized." };
  }

  // MEDIA-durability P1-5(判官第二轮,Founder 2026-09-13 对谈已裁选项 (a);判官第三轮
  // NEW-P1-1,并发化)—— 直传上传(presigned PUT/multipart)的字节从浏览器直接进内容桶,
  // 从不经过 storage.put(),所以 put() 里的写路径同步复制(replicateToBackup)从没跑过这些
  // 对象。这里补一刀服务器端跨桶复制(CopyObjectCommand,字节不过这个进程)。跳过
  // "existed"(dedup 命中):那个 key 第一次写入时就已经复制过一次,与 put() 自己的
  // dedup-skip 同一个理由(见 packages/storage/src/index.ts 的 P2-1 注释)。
  //
  // 判官第三轮 NEW-P1-1:这一刀曾经放在上面 for...of 循环的关键路径里,逐文件 await ——
  // 一次 finalize 最多 50 个文件、每次 copyToBackup 单次上界约 20s(P1-2 的 10s 请求超时 ×
  // 重试一次),串行等下来商家可见的挂起最坏能到 ~16.7 分钟。搬到这里、循环结束
  // (verified 已经建好)之后一次性 Promise.all 并发发起,消除这条尾部延迟。
  // copyToBackup() 自身契约是绝不抛错(重试一次仍失败只记结构化日志),这里的 .catch() 纯属
  // 防御——即便它违反契约意外抛出,也绝不能让 Promise.all 因为一个 rejection 就让其余复制
  // 半途而废,更不能让这次上传的收尾结果变成失败。
  await Promise.all(
    verified
      .filter((v) => v.file.upload.mode !== "existed")
      .map((v) =>
        storage.copyToBackup(v.key).catch((e) => {
          console.error(
            `[upload] copyToBackup unexpectedly threw for ${v.key} (contract says it never should):`,
            e instanceof Error ? e.message : e,
          );
        }),
      ),
  );

  // 工单 F: byte-verify each finalized IMAGE upload against the stored object — the browser declared
  // the ext, the bytes decide the persisted mime (a video renamed x.png → application/octet-stream,
  // not image/png). Only image exts are read (the static-image sniffer can't verify video/audio,
  // which keep their ext→mime). Read OUTSIDE the transaction. A storage READ failure is NOT a media
  // verdict — it is a retryable operational error (mirrors the worker publish gate). We never persist
  // a mime we couldn't derive from bytes: the client ext is the claim we distrust, and a blanket
  // octet-stream would poison the SHARED content-addressed row (the resurrect-realign below overwrites
  // mime). So a file we couldn't read is deferred to `failures` for the client to retry, not persisted.
  const mimeByKey = new Map<string, string>();
  const persistable: typeof verified = [];
  for (const { key, file } of verified) {
    if (!isStaticImageExt(file.ext)) {
      mimeByKey.set(key, mimeOf(file.ext));
      persistable.push({ key, file });
      continue;
    }
    try {
      const prefix = await readBoundedPrefix(storage, key, MEDIA_SNIFF_BYTES);
      mimeByKey.set(key, resolveUploadMime(prefix, file.ext));
      persistable.push({ key, file });
    } catch (e) {
      console.error(`[upload] mime byte-check read failed for ${key}, deferring (retryable):`, e instanceof Error ? e.message : e);
      failures.push({ filename: file.originalFilename, reason: "couldn't verify media — please retry" });
    }
  }

  if (persistable.length === 0) {
    return { error: failures[0]?.reason ?? "No files could be finalized." };
  }

  const assetIds: string[] = [];
  const generationIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { key, file } of persistable) {
      const mime = mimeByKey.get(key) ?? "application/octet-stream";
      const asset = await tx.asset.upsert({
        where: { ownerId_contentHash: { ownerId, contentHash: file.sha256 } },
        // resurrect AND realign to the object we just HEAD-verified: a prior
        // row for the same content could carry a different ext (the key is
        // <hash>.<ext>, but uniqueness is owner+hash) or a swept tombstone
        // key — pointing the row at the verified object keeps ext/mime/size
        // honest (codex round).
        update: {
          deletedAt: null,
          ext: file.ext,
          mime,
          sizeBytes: BigInt(file.sizeBytes),
          originalFilename: file.originalFilename,
        },
        create: {
          id: newId(),
          ownerId,
          contentHash: file.sha256,
          ext: file.ext,
          mime,
          sizeBytes: BigInt(file.sizeBytes),
          originalFilename: file.originalFilename,
          source: "UPLOAD" as const,
        },
      });
      assetIds.push(asset.id);
      const genId = newId();
      await tx.generation.create({
        data: {
          id: genId,
          ownerId,
          projectId,
          shotId: null,
          assetId: asset.id,
          source: "UPLOAD",
          promptText,
          entitySnapshot,
        },
      });
      generationIds.push(genId);
    }
    await tx.actionEvent.create({
      data: {
        id: newId(),
        ownerId,
        projectId,
        type: "generation.upload",
        payload: { count: persistable.length, entityIds, direct: true },
      },
    });
  });

  // hash re-verification + metadata probe for EVERY direct upload — the
  // claimed sha256 named the key, the worker PROVES it (D19 rule 3). Unlike
  // the legacy path (where the server hashed the bytes it stored, so the hash
  // is already trusted), here the hash is a client claim and this dispatch is
  // load-bearing.
  //
  // 这一段(整批逐个派、失败不拖垮整批、失败报警、调用方照样回 `ok`)自 C1b ③ 起一字未改,
  // 只是从这里**搬进了 `lib/ingest-dispatch.ts`** —— 画布拖放上传要派的是同一条活,而同一
  // 段逻辑写两遍就会有两套失败处置(R3-F25,家规 §7.3)。为什么这条派工承重、失败之后会
  // 发生什么、`getBoss()` 为什么留在循环里面,全部写在那个文件的函数头上。
  await dispatchIngest(assetIds);
  revalidatePath("/", "layout");
  return { ok: true, count: persistable.length, failures, generationIds };
}
