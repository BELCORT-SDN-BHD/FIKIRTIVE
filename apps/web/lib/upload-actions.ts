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
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import {
  authorizeUploadInput,
  signPartInput,
  abortUploadInput,
  finalizeUploadsInput,
  storageKey,
  mimeOf,
  newId,
  INGEST_QUEUE,
  UPLOAD_SINGLE_MAX_BYTES,
  UPLOAD_PART_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  expectedPartLength,
  type AuthorizeUploadResult,
} from "@fikirtive/core";
import { storage } from "@/lib/storage";
import { getBoss } from "@/lib/queue";
import { buildEntitySnapshot } from "@/lib/entity-snapshot";
import { requireOwner } from "@/lib/auth-guard";

export async function authorizeUpload(raw: unknown): Promise<AuthorizeUploadResult | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  if (!storage.supportsDirectUpload) return { error: "Direct upload is not available on this storage driver." };
  const parsed = authorizeUploadInput.safeParse(raw);
  if (!parsed.success) return { error: "That file can't be uploaded (type or size out of bounds)." };
  const { sha256, ext, sizeBytes } = parsed.data;
  const key = storageKey(ownerId, sha256, ext);
  if (await storage.exists(key)) return { kind: "exists" };
  if (sizeBytes <= UPLOAD_SINGLE_MAX_BYTES) {
    return { kind: "single", url: await storage.presignedPut(key, sizeBytes, UPLOAD_URL_TTL_SECONDS) };
  }
  const uploadId = await storage.createMultipart(key);
  return { kind: "multipart", uploadId, partSizeBytes: UPLOAD_PART_BYTES };
}

export async function signUploadPart(raw: unknown): Promise<{ url: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
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
  const { ownerId } = gate;
  if (!storage.supportsDirectUpload) return { error: "Direct upload is not available on this storage driver." };
  const parsed = abortUploadInput.safeParse(raw);
  if (!parsed.success) return { error: "Malformed abort request." };
  const { sha256, ext, uploadId } = parsed.data;
  await storage.abortMultipart(storageKey(ownerId, sha256, ext), uploadId);
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
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) return { error: "Project not found." };
  const parsed = finalizeUploadsInput.safeParse(raw);
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

  const assetIds: string[] = [];
  const generationIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { file } of verified) {
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
          mime: mimeOf(file.ext),
          sizeBytes: BigInt(file.sizeBytes),
          originalFilename: file.originalFilename,
        },
        create: {
          id: newId(),
          ownerId,
          contentHash: file.sha256,
          ext: file.ext,
          mime: mimeOf(file.ext),
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
        payload: { count: verified.length, entityIds, direct: true },
      },
    });
  });

  // hash re-verification + metadata probe for EVERY direct upload — the
  // claimed sha256 named the key, the worker PROVES it (D19 rule 3). Unlike
  // the legacy path (where the server hashed the bytes it stored, so the hash
  // is already trusted), here the hash is a client claim and this dispatch is
  // load-bearing. If it fails the rows still exist but unverified — logged at
  // error level for the reconciliation sweep to re-dispatch (proper fix:
  // Asset.verifiedAt + hide-until-verified, deferred while single-tenant).
  try {
    const boss = await getBoss();
    for (const id of assetIds) await boss.send(INGEST_QUEUE, { assetId: id });
  } catch (e) {
    console.error("[upload] UNVERIFIED — ingest dispatch failed for", assetIds, ":", e instanceof Error ? e.message : e);
  }
  revalidatePath("/", "layout");
  return { ok: true, count: verified.length, failures, generationIds };
}
