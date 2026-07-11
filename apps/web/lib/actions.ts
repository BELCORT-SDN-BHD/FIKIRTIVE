"use server";

import { revalidatePath } from "next/cache";
import { prisma, refundReservation } from "@fikirtive/db";
import {
  fikirtiveEdit,
  captionCue,
  editDuration,
  newId,
  parseStorageKey,
  keyOwnerMatches,
  srcToStorageKey,
  storageKey,
  storageKeyToSrc,
  resolveUploadMime,
  MEDIA_SNIFF_BYTES,
  INGEST_QUEUE,
  RENDER_QUEUE,
  CAPTION_QUEUE,
  type FikirtiveEdit,
  type CaptionCue,
  type CaptionJobData,
  type RenderJobData,
} from "@fikirtive/core";
import type { EntityType, ShotStatus } from "@fikirtive/db";
import { storage, extFromFilename } from "./storage";
import { getBoss } from "./queue";
import { buildEntitySnapshot } from "./entity-snapshot";
import { buildBoardEdit, transitionFor } from "./edit";
import { getShots, getLooseVideoClips, getMediaPage, type MediaPage } from "./data";
import { requireOwner } from "./auth-guard";

/**
 * M0 server actions. Conventions:
 *  - every substantive action writes an ActionEvent (D23 gate instrumentation)
 *  - most deletes are soft (deletedAt) — project management's explicit delete is the hard-delete exception
 *  - Generation rows are immutable outside the whitelist: shotId, version,
 *    attachedAt, deletedAt
 *  - every mutation is owner-scoped: rows are looked up with ownerId before
 *    being touched, so a forged ID can never reach another owner's data
 *  - user-recoverable failures return { error } (never throw) so the UI can
 *    render inline recovery per the state-grid contract
 */

const ENTITY_TYPES = new Set(["CHARACTER", "LOCATION", "PRODUCT", "BRANDMARK"]);
const SHOT_STATUSES = new Set(["DRAFT", "EXPORTED", "ATTACHED", "FINAL"]);

async function logAction(ownerId: string, type: string, projectId: string | null, payload?: object) {
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId, projectId, type, payload: payload ?? {} },
  });
}

/** Hash + store bytes; returns the row data for a later transactional upsert. */
async function ingestFile(ownerId: string, file: File) {
  const ext = extFromFilename(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // content-addressed blobs are idempotent — safe outside the DB transaction
  // ContentType derives from ext inside the driver — client file.type is untrusted
  const { contentHash } = await storage.put(ownerId, bytes, ext);
  return {
    contentHash,
    create: {
      id: newId(),
      ownerId,
      contentHash,
      ext,
      // 工单 F: persist the mime the BYTES prove, not client File.type. A confirmed static image →
      // its canonical mime; an image-ext file whose bytes aren't that image → application/octet-
      // stream (a caught lie, naturally unpublishable); video/audio keep their ext→mime mapping.
      // File.type is only a hint now and is no longer stored. The worker publish gate re-verifies
      // bytes at the IG boundary regardless.
      mime: resolveUploadMime(bytes.subarray(0, MEDIA_SNIFF_BYTES), ext),
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: file.name,
      source: "UPLOAD" as const,
    },
  };
}

function assetUpsert(ownerId: string, ingested: Awaited<ReturnType<typeof ingestFile>>) {
  const { ext, mime, sizeBytes, originalFilename } = ingested.create;
  return prisma.asset.upsert({
    where: {
      ownerId_contentHash: { ownerId, contentHash: ingested.contentHash },
    },
    // re-upload inside the 30-day window resurrects AND realigns the row to the byte-derived
    // canonical values — a previously poisoned Asset (client-trusted ext/mime) is repaired by
    // re-upload (mirrors upload-actions.ts's direct-upload path).
    update: { deletedAt: null, ext, mime, sizeBytes, originalFilename },
    create: ingested.create,
  });
}

/** Attach a (base-level) ReferenceImage, swallowing the live-uniqueness P2002.
 *  Content-addressed upload dedups identical bytes to one Asset, so re-picking or
 *  re-uploading the same image would attach it twice; ReferenceImage_live_entity_
 *  asset_variant_key rejects the dup and we skip it (already attached) instead of
 *  500-ing the upload. Mirrors attachOutputs' skip in apps/worker/src/jobs/refgen.ts. */
async function createRefSkippingDup(data: { id: string; ownerId: string; entityId: string; assetId: string; position: number }): Promise<void> {
  try {
    await prisma.referenceImage.create({ data });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return;
    throw e;
  }
}

// ---------- projects ----------

/** Placeholder names a fresh campaign carries until its first conversation names it. */
const DEFAULT_CAMPAIGN_NAMES = new Set(["New campaign", "Untitled Project"]);

async function findReusableEmptyDefaultProject(ownerId: string, name: string): Promise<{ id: string } | null> {
  if (!DEFAULT_CAMPAIGN_NAMES.has(name)) return null;
  const candidates = await prisma.project.findMany({
    where: { ownerId, name, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, editJson: true, coworkBrief: true, brandId: true, campaignId: true },
    take: 12,
  });
  for (const candidate of candidates) {
    const hasProjectLevelWork = Boolean(
      candidate.editJson ||
      candidate.coworkBrief?.trim() ||
      candidate.brandId?.trim() ||
      candidate.campaignId?.trim(),
    );
    if (hasProjectLevelWork) continue;
    const [threads, shots, scheduledPosts, nodes, genJobs, generations] = await Promise.all([
      prisma.chatThread.count({ where: { ownerId, projectId: candidate.id, deletedAt: null } }),
      prisma.shot.count({ where: { ownerId, projectId: candidate.id, deletedAt: null } }),
      prisma.scheduledPost.count({ where: { ownerId, projectId: candidate.id, deletedAt: null } }),
      prisma.canvasNode.count({ where: { ownerId, projectId: candidate.id } }),
      prisma.genJob.count({ where: { ownerId, projectId: candidate.id } }),
      prisma.generation.count({ where: { ownerId, projectId: candidate.id, deletedAt: null } }),
    ]);
    if (threads === 0 && shots === 0 && scheduledPosts === 0 && nodes === 0 && genJobs === 0 && generations === 0) return candidate;
  }
  return null;
}

/** Idempotent: returns the owner's oldest non-deleted project, or creates one named
 *  "My Videos" if none exist. Used by the /m (Simple Mode) route. Never throws — the
 *  caller surfaces any auth failure via the {error} contract. */
export async function getOrCreateDefaultProject(): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const existing = await prisma.project.findFirst({
    where: { ownerId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return { id: existing.id };
  const project = await prisma.project.create({
    data: { id: newId(), ownerId, name: "My Videos" },
  });
  await logAction(ownerId, "project.create", project.id, { name: project.name, via: "simple-mode" });
  return { id: project.id };
}

export async function createProject(name: string): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const cleanName = name.trim() || "Untitled Project";
  const reusable = await findReusableEmptyDefaultProject(ownerId, cleanName);
  if (reusable) return { id: reusable.id };
  const project = await prisma.project.create({
    data: { id: newId(), ownerId, name: cleanName },
  });
  await logAction(ownerId, "project.create", project.id, { name: project.name });
  revalidatePath("/", "layout");
  return { id: project.id };
}

/** Permanently delete a project and its project-scoped work.
 *  Global assets/entities/ledger rows are intentionally not deleted here. */
export async function deleteProject(projectId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true, name: true } });
  if (!project) return { error: "Project not found." };
  try {
    await prisma.$transaction(async (tx) => {
      const projectLockKey = `project:${project.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectLockKey}, 0::bigint))`;
      const activeJobs = await tx.genJob.findMany({
        where: { ownerId, projectId: project.id, status: { in: ["QUEUED", "GENERATING"] } },
        select: { id: true, status: true },
      });
      if (activeJobs.some((job) => job.status === "GENERATING")) {
        throw new Error("GENERATION_RUNNING_DURING_DELETE");
      }
      for (const job of activeJobs) {
        const { count } = await tx.genJob.updateMany({
          where: { id: job.id, ownerId, status: "QUEUED" },
          data: { status: "FAILED", error: "Cancelled by campaign deletion", finishedAt: new Date() },
        });
        if (count !== 1) throw new Error("GENERATION_STARTED_DURING_DELETE");
        await refundReservation(tx, { orgId: ownerId, refId: job.id });
      }

      const threads = await tx.chatThread.findMany({
        where: { ownerId, projectId: project.id },
        select: { id: true },
      });
      const threadIds = threads.map((t) => t.id);
      if (threadIds.length > 0) {
        for (const threadId of threadIds) {
          const threadLockKey = `thread:${threadId}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${threadLockKey}, 0::bigint))`;
        }
        const activeResearch = await tx.researchJob.findFirst({
          where: { ownerId, threadId: { in: threadIds }, status: { in: ["QUEUED", "RUNNING"] } },
          select: { id: true },
        });
        if (activeResearch) throw new Error("RESEARCH_RUNNING_DURING_DELETE");
        await tx.researchJob.deleteMany({ where: { ownerId, threadId: { in: threadIds } } });
        await tx.chatMessage.deleteMany({ where: { ownerId, threadId: { in: threadIds } } });
        await tx.chatThread.deleteMany({ where: { ownerId, id: { in: threadIds } } });
      }

      const shots = await tx.shot.findMany({
        where: { ownerId, projectId: project.id },
        select: { id: true },
      });
      const shotIds = shots.map((s) => s.id);

      await tx.canvasNode.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.renderJob.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.captionJob.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.scheduledPost.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.generationBatch.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.genJob.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.generation.deleteMany({ where: { ownerId, projectId: project.id } });
      if (shotIds.length > 0) {
        await tx.shotEntityRef.deleteMany({ where: { ownerId, shotId: { in: shotIds } } });
      }
      await tx.shot.deleteMany({ where: { ownerId, projectId: project.id } });
      await tx.actionEvent.deleteMany({ where: { ownerId, projectId: project.id } });
      const deleted = await tx.project.deleteMany({ where: { id: project.id, ownerId } });
      if (deleted.count !== 1) throw new Error("Project delete lost owner scope.");
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId,
          projectId: null,
          type: "project.delete",
          payload: { projectId: project.id, name: project.name, hardDelete: true },
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "GENERATION_RUNNING_DURING_DELETE") {
      return { error: "A generation is still running in this campaign. Delete it after the generation finishes." };
    }
    if (e instanceof Error && e.message === "GENERATION_STARTED_DURING_DELETE") {
      return { error: "A generation started while deleting this campaign. Delete it after the generation finishes." };
    }
    if (e instanceof Error && e.message === "RESEARCH_RUNNING_DURING_DELETE") {
      return { error: "Research is still running in this campaign. Delete it after research finishes." };
    }
    console.error("[deleteProject] failed:", e);
    return { error: "Couldn't delete the campaign — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Rename a project (campaign). Owner-scoped, fail-closed; display-only metadata. */
export async function renameProject(projectId: string, name: string): Promise<{ ok: true; name: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const clean = name.trim().slice(0, 80);
  if (!clean) return { error: "Name required." };
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) return { error: "Project not found." };
  await prisma.project.update({ where: { id: project.id }, data: { name: clean } });
  await logAction(ownerId, "project.rename", project.id, { name: clean });
  revalidatePath("/", "layout");
  return { ok: true, name: clean };
}

/** Pin/unpin a campaign in the sidebar. Owner-scoped display metadata only. */
export async function setProjectPinned(projectId: string, pinned: boolean): Promise<{ ok: true; pinnedAt: string | null } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) return { error: "Project not found." };
  const pinnedAt = pinned ? new Date() : null;
  const { count } = await prisma.project.updateMany({ where: { id: project.id, ownerId }, data: { pinnedAt } });
  if (!count) return { error: "Project not found." };
  await logAction(ownerId, pinned ? "project.pin" : "project.unpin", project.id);
  revalidatePath("/", "layout");
  return { ok: true, pinnedAt: pinnedAt ? pinnedAt.toISOString() : null };
}

/** Auto-title a still-default campaign from its first conversation's title (Grok
 *  pattern: a new agent gets named from the first prompt). Owner-scoped, fail-closed,
 *  idempotent (no-op once the project has a real name); writes only project.name —
 *  touches no credits/generation. Safe to call repeatedly from the client. */
export async function autoTitleProjectIfDefault(projectId: string): Promise<{ ok: true; name?: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true, name: true } });
  if (!project) return { error: "Project not found." };
  if (!DEFAULT_CAMPAIGN_NAMES.has(project.name)) return { ok: true }; // already named
  const thread = await prisma.chatThread.findFirst({
    where: { ownerId, projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: { title: true },
  });
  const title = thread?.title?.trim();
  if (!title || DEFAULT_CAMPAIGN_NAMES.has(title)) return { ok: true }; // nothing to adopt yet
  const clean = title.slice(0, 80);
  await prisma.project.update({ where: { id: project.id }, data: { name: clean } });
  await logAction(ownerId, "project.autotitle", project.id, { name: clean });
  revalidatePath("/", "layout");
  return { ok: true, name: clean };
}

// ---------- entities ----------

const REF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per source image
const REF_MAX_FILES = 10;
const REF_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Server-side ref-image gate (the client acceptImages is UX only — direct or
 *  stale calls must not bypass it): png/jpg/webp, ≤10MB, within remaining room. */
function acceptRefFiles(formData: FormData, existing: number): File[] {
  const room = Math.max(0, REF_MAX_FILES - existing);
  return formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0 && f.size <= REF_MAX_BYTES && REF_MIME.has(f.type))
    .slice(0, room);
}

export async function createEntity(formData: FormData) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const files = acceptRefFiles(formData, 0);
  if (!name) return { error: "Name is required." };
  if (!ENTITY_TYPES.has(type)) return { error: "Unknown entity type." };

  const entity = await prisma.entity.create({
    data: { id: newId(), ownerId, name, type: type as EntityType },
  });
  let firstAssetId: string | null = null;
  for (const [i, file] of files.entries()) {
    const asset = await assetUpsert(ownerId, await ingestFile(ownerId, file));
    if (i === 0) firstAssetId = asset.id;
    // content-addressed upload dedups identical files to one Asset, so the same
    // image picked twice would attach the same asset twice — the live-uniqueness
    // index (ReferenceImage_live_entity_asset_variant_key) rejects the dup with
    // P2002; skip it (already attached) rather than 500 the upload.
    await createRefSkippingDup({ id: newId(), ownerId, entityId: entity.id, assetId: asset.id, position: i });
  }
  // the first reference becomes the locked base (same invariant as addReferenceImages + the migration backfill)
  if (firstAssetId) await prisma.entity.update({ where: { id: entity.id }, data: { baseAssetId: firstAssetId } });
  await logAction(ownerId, "entity.create", null, { entityId: entity.id, name, type, refCount: files.length });
  revalidatePath("/", "layout");
  return { id: entity.id };
}

export async function updateEntity(
  entityId: string,
  fields: { name?: string; notes?: string; negativeConstraints?: string },
) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const data: Record<string, string> = {};
  if (fields.name !== undefined && fields.name.trim()) data.name = fields.name.trim();
  if (fields.notes !== undefined) data.notes = fields.notes;
  if (fields.negativeConstraints !== undefined) data.negativeConstraints = fields.negativeConstraints;
  if (Object.keys(data).length === 0) return { ok: true };
  const { count } = await prisma.entity.updateMany({ where: { id: entityId, ownerId, deletedAt: null }, data });
  if (count === 0) return { error: "Entity not found." };
  await logAction(ownerId, "entity.update", null, { entityId, fields: Object.keys(data) });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Aliases mutate as server-side deltas, never client-supplied full arrays —
 * a stale tab replacing the whole array would silently erase edits made
 * elsewhere (lost-update).
 */
export async function addEntityAlias(entityId: string, alias: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const clean = alias.trim();
  if (!clean) return { error: "Alias is empty." };
  const entity = await prisma.entity.findFirst({ where: { id: entityId, ownerId, deletedAt: null } });
  if (!entity) return { error: "Entity not found." };
  // atomic append guarded against dupes — NOT read-modify-write, so two concurrent
  // adds can't lose one (the prior delta-from-client design left this server race) (#9)
  await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${clean}) WHERE "id" = ${entityId} AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL AND NOT (${clean} = ANY("aliases"))`;
  await logAction(ownerId, "entity.update", null, { entityId, addAlias: clean });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeEntityAlias(entityId: string, alias: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const entity = await prisma.entity.findFirst({ where: { id: entityId, ownerId, deletedAt: null } });
  if (!entity) return { error: "Entity not found." };
  // atomic remove (same lost-update guard as the add above) (#9)
  await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_remove("aliases", ${alias}) WHERE "id" = ${entityId} AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL`;
  await logAction(ownerId, "entity.update", null, { entityId, removeAlias: alias });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Remove one reference image from an entity (soft — asset row is a tombstone). */
export async function softDeleteReferenceImage(refImageId: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const ref = await prisma.referenceImage.findFirst({ where: { id: refImageId, ownerId, deletedAt: null } });
  if (!ref) return { error: "Reference image not found." };
  await prisma.referenceImage.update({
    where: { id: refImageId },
    data: { deletedAt: new Date() },
  });
  // if we just removed the entity's base ref, repoint baseAssetId to the next live
  // base-level ref (or null) — otherwise it dangles at an orphaned asset and variant
  // generation would still condition on a base the user no longer has.
  const entity = await prisma.entity.findFirst({ where: { id: ref.entityId, ownerId, deletedAt: null }, select: { baseAssetId: true } });
  if (entity?.baseAssetId === ref.assetId) {
    const next = await prisma.referenceImage.findFirst({
      where: { ownerId, entityId: ref.entityId, deletedAt: null, variantId: null },
      orderBy: { position: "asc" },
      select: { assetId: true },
    });
    await prisma.entity.updateMany({ where: { id: ref.entityId, ownerId, deletedAt: null }, data: { baseAssetId: next?.assetId ?? null } });
  }
  await logAction(ownerId, "entity.update", null, { entityId: ref.entityId, refImageId, action: "ref-delete" });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addReferenceImages(entityId: string, formData: FormData) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const entity = await prisma.entity.findFirst({ where: { id: entityId, ownerId, deletedAt: null } });
  if (!entity) return { error: "Entity not found." };
  const existing = await prisma.referenceImage.count({ where: { entityId, deletedAt: null } });
  const files = acceptRefFiles(formData, existing);
  if (files.length === 0) return { error: "No valid images — PNG, JPG or WebP, ≤ 10 MB, up to 10 per element." };
  const last = await prisma.referenceImage.findFirst({
    where: { ownerId, entityId, deletedAt: null },
    orderBy: { position: "desc" },
  });
  let position = (last?.position ?? -1) + 1;
  for (const file of files) {
    const asset = await assetUpsert(ownerId, await ingestFile(ownerId, file));
    // re-uploading an already-attached image dedups to the same Asset → the
    // live-uniqueness index rejects the dup with P2002; skip it (already attached).
    await createRefSkippingDup({ id: newId(), ownerId, entityId, assetId: asset.id, position: position++ });
  }
  // an entity's base defaults to its first (lowest-position) live reference — so
  // "Upload photo" locks the base in one step, matching the migration backfill.
  if (!entity.baseAssetId) {
    const first = await prisma.referenceImage.findFirst({
      where: { ownerId, entityId, deletedAt: null },
      orderBy: { position: "asc" },
      select: { assetId: true },
    });
    if (first) await prisma.entity.update({ where: { id: entityId }, data: { baseAssetId: first.assetId } });
  }
  await logAction(ownerId, "entity.update", null, { entityId, addedRefs: files.length });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function softDeleteEntity(entityId: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const refCount = await prisma.shotEntityRef.count({ where: { entityId } });
  const { count } = await prisma.entity.updateMany({
    where: { id: entityId, ownerId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count === 0) return { error: "Entity not found." };
  await logAction(ownerId, "entity.update", null, { entityId, action: "soft-delete", shotRefsAtDelete: refCount });
  revalidatePath("/", "layout");
  // History stays intact (snapshots); shots referencing it show a stale chip until edited.
  return { ok: true, shotRefs: refCount };
}

// ---------- shots ----------

export async function createShot(projectId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return { error: "Project not found." };
  // number = max+1; @@unique([projectId, number]) backstops concurrent creates
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.shot.findFirst({
      where: { ownerId, projectId },
      orderBy: { number: "desc" },
    });
    try {
      const shot = await prisma.shot.create({
        data: { id: newId(), ownerId, projectId, number: (last?.number ?? 0) + 1 },
      });
      await logAction(ownerId, "shot.create", projectId, { shotId: shot.id, number: shot.number });
      revalidatePath("/", "layout");
      return { id: shot.id, number: shot.number };
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return { error: "Could not allocate a shot number — retry." };
}

/**
 * Persist the composer doc. promptDoc (Tiptap JSON, chips = entity IDs) is the
 * source of truth; promptText is the resolved plain-text cache; ShotEntityRef
 * is a derived index rebuilt on every save (schema comment).
 *
 * The doc crosses the wire as a JSON STRING, not an object: ProseMirror builds
 * node attrs with Object.create(null), and React Flight silently DROPS
 * null-prototype objects when serializing server-action arguments — chips
 * arrived as bare {"type":"mention"} and lost their entity IDs. Strings have
 * no such semantics.
 */
export async function saveShotPrompt(
  shotId: string,
  promptDocJson: string,
  promptText: string,
  entityIds: string[],
) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
  if (!shot) return { error: "Shot not found." };
  const uniqueIds = [...new Set(entityIds)];
  // IDOR guard: every @-referenced entity MUST belong to the caller's org. Without this a
  // caller could link (and then read via getShots' entityRefs.entity include) a FOREIGN
  // tenant's entity by passing its id. Reject the whole save if any id isn't owned.
  if (uniqueIds.length) {
    const owned = await prisma.entity.count({ where: { id: { in: uniqueIds }, ownerId, deletedAt: null } });
    if (owned !== uniqueIds.length) return { error: "One or more referenced entities were not found." };
  }
  let doc: object;
  try {
    doc = JSON.parse(promptDocJson) as object;
    if (typeof doc !== "object" || doc === null) throw new Error("not an object");
  } catch {
    return { error: "Malformed prompt document." };
  }
  await prisma.$transaction([
    prisma.shot.update({
      where: { id: shotId },
      data: { promptDoc: doc, description: promptText },
    }),
    prisma.shotEntityRef.deleteMany({ where: { shotId, ownerId } }),
    ...(uniqueIds.length
      ? [prisma.shotEntityRef.createMany({
          data: uniqueIds.map((entityId) => ({ shotId, entityId, ownerId })),
        })]
      : []),
  ]);
  await logAction(ownerId, "shot.update", shot.projectId, { shotId, entityIds: uniqueIds });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateShotTitle(shotId: string, title: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
  if (!shot) return { error: "Shot not found." };
  await prisma.shot.update({ where: { id: shotId }, data: { title: title.trim() } });
  await logAction(ownerId, "shot.update", shot.projectId, { shotId, field: "title" });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateShotStatus(shotId: string, status: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  if (!SHOT_STATUSES.has(status)) return { error: "Unknown shot status." };
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
  if (!shot) return { error: "Shot not found." };
  await prisma.shot.update({ where: { id: shotId }, data: { status: status as ShotStatus } });
  await logAction(ownerId, "shot.update", shot.projectId, { shotId, status });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function softDeleteShot(shotId: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
  if (!shot) return { error: "Shot not found." };
  const attached = await prisma.generation.count({ where: { shotId, deletedAt: null } });
  if (attached > 0) {
    return { error: `This shot has ${attached} attached generation(s). Detach them first.` };
  }
  await prisma.$transaction([
    prisma.shot.update({ where: { id: shotId }, data: { deletedAt: new Date() } }),
    // derived index — drop with the shot so entity usage counts stay honest
    prisma.shotEntityRef.deleteMany({ where: { shotId, ownerId } }),
  ]);
  await logAction(ownerId, "shot.update", shot.projectId, { shotId, action: "soft-delete" });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- generations (candidate zone + manual attach) ----------

/**
 * M0 manual flow: user generates in ComfyUI with the copied prompt, then drops
 * the result here. Lands in the candidate zone (shotId = null). The whole
 * batch commits atomically — a mid-batch failure leaves nothing half-recorded.
 */
export async function uploadCandidates(projectId: string, formData: FormData) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return { error: "Project not found." };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "No files received." };
  const promptText = String(formData.get("promptText") ?? "");
  const entityIds = formData.getAll("entityIds").map(String).filter(Boolean);
  const entitySnapshot = await buildEntitySnapshot(ownerId, entityIds);

  const ingested: Awaited<ReturnType<typeof ingestFile>>[] = [];
  for (const file of files) ingested.push(await ingestFile(ownerId, file));

  await prisma.$transaction(async (tx) => {
    for (const item of ingested) {
      const asset = await tx.asset.upsert({
        where: {
          ownerId_contentHash: { ownerId, contentHash: item.contentHash },
        },
        // resurrect AND realign to the byte-derived canonical values (repairs a poisoned prior row)
        update: {
          deletedAt: null,
          ext: item.create.ext,
          mime: item.create.mime,
          sizeBytes: item.create.sizeBytes,
          originalFilename: item.create.originalFilename,
        },
        create: item.create,
      });
      await tx.generation.create({
        data: {
          id: newId(),
          ownerId,
          projectId,
          shotId: null,
          assetId: asset.id,
          source: "UPLOAD",
          promptText,
          entitySnapshot,
        },
      });
    }
    await tx.actionEvent.create({
      data: {
        id: newId(),
        ownerId,
        projectId,
        type: "generation.upload",
        payload: { count: ingested.length, entityIds },
      },
    });
  });
  // best-effort metadata probe (real durations for the editor) — the upload
  // itself must never fail on queue hiccups
  try {
    const boss = await getBoss();
    const assets = await prisma.asset.findMany({
      where: { ownerId, contentHash: { in: ingested.map((i) => i.contentHash) } },
      select: { id: true, durationS: true },
    });
    for (const a of assets) {
      if (a.durationS == null) await boss.send(INGEST_QUEUE, { assetId: a.id });
    }
  } catch (e) {
    console.warn("[upload] ingest dispatch skipped:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/", "layout");
  return { ok: true, count: files.length };
}

// only the exts the i2v worker can animate (kept in sync with the worker's
// source-image filter): png / jpg / webp
const REF_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

/** Sniff the leading bytes so a non-image renamed `x.png` can't be stored as an
 *  image (and later waste a paid i2v call). PNG / JPEG / WEBP magic numbers. */
async function looksLikeImage(file: File): Promise<boolean> {
  const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
  const jpg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  const webp = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  return png || jpg || webp;
}

/** Upload one image as a candidate Generation and return it, so Gen space can
 *  use it as an image-to-video source. Mirrors uploadCandidates for a single
 *  image; the i2v itself is a separate (paid) gen job. */
export async function uploadReference(projectId: string, formData: FormData): Promise<{ id: string; src: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return { error: "Project not found." };
  const file = formData.getAll("files").find((f): f is File => f instanceof File && f.size > 0);
  if (!file) return { error: "No image received." };
  const ext = extFromFilename(file.name);
  if (!REF_IMAGE_EXTS.has(ext)) return { error: "Reference must be a PNG, JPG, or WEBP image." };
  if (file.size > REF_MAX_BYTES) return { error: "Reference image must be 10 MB or smaller." };
  if (!(await looksLikeImage(file))) return { error: "That file isn't a valid PNG / JPG / WEBP image." };
  const item = await ingestFile(ownerId, file);
  let genId = "";
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.upsert({
      where: { ownerId_contentHash: { ownerId, contentHash: item.contentHash } },
      // resurrect AND realign to the byte-derived canonical values (repairs a poisoned prior row)
      update: {
        deletedAt: null,
        ext: item.create.ext,
        mime: item.create.mime,
        sizeBytes: item.create.sizeBytes,
        originalFilename: item.create.originalFilename,
      },
      create: item.create,
    });
    const gen = await tx.generation.create({
      data: { id: newId(), ownerId, projectId, shotId: null, assetId: asset.id, source: "UPLOAD", promptText: "", entitySnapshot: { entities: [] } },
    });
    genId = gen.id;
  });
  revalidatePath("/", "layout");
  return { id: genId, src: storageKeyToSrc(storageKey(ownerId, item.contentHash, ext)) };
}

/** Manual attach: candidate → shot, next version number, shot goes ATTACHED. */
export async function attachGeneration(generationId: string, shotId: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ownerId, deletedAt: null } });
  if (!gen) return { error: "Generation not found." };
  if (gen.shotId) return { error: "Already attached to a shot — detach it first." };
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
  if (!shot) return { error: "Shot not found." };
  if (shot.projectId !== gen.projectId) {
    return { error: "That shot belongs to a different project." };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const top = await prisma.generation.findFirst({
      where: { ownerId, shotId },
      orderBy: { version: "desc" },
    });
    try {
      await prisma.$transaction([
        prisma.generation.update({
          where: { id: generationId },
          data: { shotId, version: (top?.version ?? 0) + 1, attachedAt: new Date() },
        }),
        prisma.shot.update({ where: { id: shotId }, data: { status: "ATTACHED" } }),
      ]);
      break;
    } catch (e) {
      if (attempt === 2) throw e; // @@unique([shotId, version]) race — retry
    }
  }
  await logAction(ownerId, "generation.attach", gen.projectId, { generationId, shotId });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Detach back to the candidate zone (whitelist fields only). */
export async function detachGeneration(generationId: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ownerId, deletedAt: null } });
  if (!gen || !gen.shotId) return { error: "Generation is not attached." };
  const shotId = gen.shotId;
  const remaining = await prisma.generation.count({
    where: { shotId, deletedAt: null, id: { not: generationId } },
  });
  await prisma.$transaction([
    prisma.generation.update({
      where: { id: generationId },
      data: { shotId: null, version: 1, attachedAt: null },
    }),
    // last one out turns the ATTACHED badge off (manual EXPORTED/FINAL stays)
    ...(remaining === 0
      ? [prisma.shot.updateMany({
          where: { id: shotId, ownerId, status: "ATTACHED" },
          data: { status: "DRAFT" },
        })]
      : []),
  ]);
  await logAction(ownerId, "generation.detach", gen.projectId, { generationId, shotId });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Soft-delete a generation from the Assets library. If it was a shot's last
 *  live render, the shot drops back to DRAFT (same "last one out" rule). */
export async function deleteGeneration(generationId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ownerId, deletedAt: null } });
  if (!gen) return { error: "Generation not found." };
  const shotId = gen.shotId;
  const remaining = shotId
    ? await prisma.generation.count({ where: { shotId, deletedAt: null, id: { not: generationId } } })
    : 0;
  await prisma.$transaction([
    prisma.generation.update({ where: { id: generationId }, data: { deletedAt: new Date() } }),
    // clear any segment keyframe pointing at this generation so deleting it can't
    // leave a Shot with a dangling first/last-frame id (③B cleanup)
    prisma.shot.updateMany({ where: { firstFrameGenerationId: generationId, ownerId }, data: { firstFrameGenerationId: null } }),
    prisma.shot.updateMany({ where: { lastFrameGenerationId: generationId, ownerId }, data: { lastFrameGenerationId: null } }),
    ...(shotId && remaining === 0
      ? [prisma.shot.updateMany({ where: { id: shotId, ownerId, status: "ATTACHED" }, data: { status: "DRAFT" } })]
      : []),
  ]);
  await logAction(ownerId, "generation.delete", gen.projectId, { generationId, shotId });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- editor (phase-③ tracer: contract → queue → worker → asset) ----------

/** Persist the working cut (replaces the phase-② localStorage mock).
 *  Optimistic concurrency (D1): when the client passes the `baseUpdatedAt` it
 *  loaded the cut at, we write ONLY if Project.updatedAt is still that value
 *  (Prisma auto-bumps it on every write) — a concurrent save from another
 *  tab/device bumps it, our conditional update matches 0 rows, and we report
 *  `conflict` instead of silently overwriting that work. Omitting baseUpdatedAt
 *  keeps the old bare write (back-compat: resetToBoard's deliberate replace). */
export async function saveProjectEdit(projectId: string, editJsonString: string, baseUpdatedAt?: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return { error: "Project not found." };
  let edit: FikirtiveEdit;
  try {
    // canonicalizing parse — only the parsed value is ever persisted
    edit = fikirtiveEdit.parse(JSON.parse(editJsonString));
  } catch {
    return { error: "That cut is out of contract — fix the flagged clip first." };
  }
  if (baseUpdatedAt) {
    const res = await prisma.project.updateMany({ where: { id: projectId, ownerId, updatedAt: new Date(baseUpdatedAt) }, data: { editJson: edit } });
    if (res.count === 0) return { error: "This cut changed in another tab or device — reload before saving so you don't overwrite that work.", conflict: true as const };
  } else {
    await prisma.project.update({ where: { id: projectId }, data: { editJson: edit } });
  }
  await logAction(ownerId, "edit.save", projectId, { seconds: Math.round(editDuration(edit)) });
  revalidatePath("/", "layout");
  // hand back the fresh updatedAt so the client can re-base for its next save
  const fresh = await prisma.project.findFirst({ where: { id: projectId, ownerId }, select: { updatedAt: true } });
  return { ok: true, updatedAt: fresh?.updatedAt?.toISOString() };
}

const BLANK_CUT = (): FikirtiveEdit => ({
  timeline: { background: "#000000", tracks: [{ clips: [] }] },
  output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
});

/** Extract a finished storyboard segment into the editor: append its rendered
 *  video (with the segment's fade) to the END of the working cut's visual track,
 *  then persist. Base = the saved cut if any, else a fresh board cut, else blank.
 *  De-duped by src — a segment already on the timeline reports added:false and
 *  changes nothing (the board cut already carries every attached render). */
export async function addSegmentToCut(shotId: string): Promise<{ ok: true; added: boolean } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null }, select: { id: true, projectId: true, transition: true } });
  if (!shot) return { error: "Shot not found." };
  // the segment's render = its latest attached video, scoped to shot + owner +
  // project (defense in depth — the schema doesn't enforce gen.projectId == shot's)
  const vid = await prisma.generation.findFirst({
    where: { shotId: shot.id, projectId: shot.projectId, ownerId, deletedAt: null, asset: { ext: { in: ["mp4", "mov", "webm", "mkv"] } } },
    orderBy: { version: "desc" }, include: { asset: true },
  });
  if (!vid) return { error: "Animate this segment first — there's no video to add yet." };
  const src = storageKeyToSrc(storageKey(vid.asset.ownerId, vid.asset.contentHash, vid.asset.ext.toLowerCase()));
  const seconds = vid.asset.durationS ?? 5;

  // Optimistic concurrency: read editJson + updatedAt, append, then write ONLY if
  // updatedAt is unchanged (Prisma auto-bumps it on every write). A concurrent
  // save/append bumps it → our conditional update matches 0 rows → retry on the
  // fresh value, so neither write is silently lost (last-writer-wins is gone).
  for (let attempt = 0; attempt < 4; attempt++) {
    const project = await prisma.project.findFirst({ where: { id: shot.projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };

    // base = the VALID saved cut; on a missing/corrupt saved cut, rebuild from the
    // board (never silently blank over an existing-but-invalid cut)
    const saved = project.editJson ? fikirtiveEdit.safeParse(project.editJson) : null;
    let base: FikirtiveEdit;
    if (saved?.success) {
      base = saved.data;
    } else {
      const [shots, looseClips] = await Promise.all([getShots(ownerId, shot.projectId), getLooseVideoClips(ownerId, shot.projectId)]);
      base = buildBoardEdit(shots, looseClips).edit ?? BLANK_CUT();
    }
    const track0 = base.timeline.tracks[0];
    if (!track0) return { error: "That cut has no visual track." };
    // already on the timeline (e.g. the board cut already includes it) → no-op
    if (track0.clips.some((c) => c.asset.src === src)) return { ok: true, added: false };

    const end = track0.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
    const tr = transitionFor(shot.transition, seconds);
    track0.clips.push({ asset: { type: "video", src }, start: end, length: seconds, ...(tr ? { transition: tr } : {}) });
    const parsed = fikirtiveEdit.safeParse(base); // canonicalize before persisting (saveProjectEdit discipline)
    if (!parsed.success) return { error: "Adding that segment would put the cut out of contract." };

    const res = await prisma.project.updateMany({ where: { id: project.id, ownerId, updatedAt: project.updatedAt }, data: { editJson: parsed.data } });
    if (res.count === 1) {
      await logAction(ownerId, "edit.addSegment", project.id, { shotId, seconds: Math.round(seconds) });
      revalidatePath("/", "layout");
      return { ok: true, added: true };
    }
    // a concurrent write landed between our read and write — re-read and retry
  }
  return { error: "The cut changed while adding — please try again." };
}

/** Export: persist the RenderJob row FIRST, then dispatch (triple-insurance rule).
 *  The RenderJob carries its own editJson snapshot, so "export renders what is saved"
 *  holds by construction. Project.editJson is NOT written here — exportCut does a
 *  GUARDED saveProjectEdit before calling this (D1 optimistic-concurrency). */
export async function startRender(projectId: string, editJsonString: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return { error: "Project not found." };
  let edit: FikirtiveEdit;
  try {
    edit = fikirtiveEdit.parse(JSON.parse(editJsonString));
  } catch {
    return { error: "That cut is out of contract — fix the flagged clip first." };
  }
  // server-side in-flight guard (codex review): double-clicks and duplicate
  // tabs must not stack identical renders
  const active = await prisma.renderJob.findFirst({
    where: { projectId, ownerId, status: { in: ["QUEUED", "RENDERING"] } },
  });
  if (active) {
    return { error: "A render is already running for this project — wait for it to finish below." };
  }
  // The RenderJob carries its OWN editJson snapshot, so the worker renders the exact
  // exported cut without reading Project.editJson. We deliberately DON'T write
  // Project.editJson here — that bare update bypassed the optimistic-concurrency guard
  // (D1) and could clobber a newer cut from another tab. exportCut performs a GUARDED
  // saveProjectEdit BEFORE calling startRender (aborting on a conflict), so the project
  // is already persisted by the time we get here.
  const job = await prisma.renderJob.create({
    data: { id: newId(), ownerId, projectId, editJson: edit },
  });
  try {
    const boss = await getBoss();
    const queueJobId = await boss.send(RENDER_QUEUE, { renderJobId: job.id } satisfies RenderJobData);
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { queueJobId: queueJobId ?? "" },
    });
  } catch (e) {
    // row survives (reconciliation can re-dispatch); surface the failure loudly
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: `dispatch failed: ${message}` },
    });
    return { error: "Could not reach the render queue — is the worker database up?" };
  }
  await logAction(ownerId, "render.start", projectId, { renderJobId: job.id });
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Poll target for the editor's render strip. */
export async function getRenderJobs(projectId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const jobs = await prisma.renderJob.findMany({
    where: { projectId, ownerId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const assetIds = jobs.map((j) => j.outputAssetId).filter((x): x is string => !!x);
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds }, ownerId } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  return jobs.map((j) => {
    const asset = j.outputAssetId ? byId.get(j.outputAssetId) : null;
    return {
      id: j.id,
      status: j.status,
      progress: j.progress,
      error: j.error,
      createdAt: j.createdAt.toISOString(),
      url: asset ? storageKeyToSrc(storageKey(asset.ownerId, asset.contentHash, asset.ext)) : null,
    };
  });
}

/** Resolve a timeline clip's `/files/...` src to the OWNED Asset row behind it.
 *  The editor identifies a clip only by src (a content-addressed storage key); the
 *  caption job needs a real Asset.id + contentHash. Returns null when the src is
 *  malformed or the asset isn't owned (forged src can't reach another owner). */
async function ownedAssetFromSrc(ownerId: string, src: string): Promise<{ id: string; contentHash: string } | null> {
  let contentHash: string;
  try {
    const key = srcToStorageKey(src);
    if (!keyOwnerMatches(key, ownerId)) return null; // forged/other-owner src
    contentHash = parseStorageKey(key).contentHash;
  } catch {
    return null;
  }
  const asset = await prisma.asset.findFirst({
    where: { ownerId, contentHash, deletedAt: null },
    select: { id: true, contentHash: true },
  });
  return asset;
}

/** $0 captions: dispatch the whisper.cpp caption job for one visual-track clip.
 *  Persists the CaptionJob row FIRST, then dispatches (same triple-insurance rule
 *  as startRender). Whisper + ffmpeg only — NO spend path. `src` is the clip's
 *  content-addressed source (the only identifier the editor has for a clip); the
 *  real Asset.id/contentHash are resolved server-side so the worker can read it. */
export async function startCaption(projectId: string, src: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return { error: "Project not found." };
  const asset = await ownedAssetFromSrc(ownerId, src);
  if (!asset) return { error: "That clip isn't in your media — generate it first." };
  // in-flight guard: don't stack identical caption jobs for the same asset
  const active = await prisma.captionJob.findFirst({
    where: { projectId, ownerId, assetId: asset.id, status: { in: ["QUEUED", "RENDERING"] } },
  });
  if (active) return { error: "Captions are already being generated for this clip — wait for it to finish." };
  const job = await prisma.captionJob.create({
    data: { id: newId(), ownerId, projectId, assetId: asset.id, contentHash: asset.contentHash },
  });
  try {
    const boss = await getBoss();
    const queueJobId = await boss.send(CAPTION_QUEUE, { captionJobId: job.id } satisfies CaptionJobData);
    await prisma.captionJob.update({ where: { id: job.id }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await prisma.captionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: `dispatch failed: ${message}` },
    });
    return { error: "Could not reach the caption queue — is the worker database up?" };
  }
  await logAction(ownerId, "caption.start", projectId, { captionJobId: job.id, assetId: asset.id });
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Poll target for the editor's caption-generate flow. */
export async function getCaptionJob(jobId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const job = await prisma.captionJob.findFirst({ where: { id: jobId, ownerId } });
  if (!job) return null;
  return { id: job.id, status: job.status, progress: job.progress, error: job.error };
}

/** Read the cached whisper transcript for a clip → the editable CaptionCue[] seed
 *  the UI folds into timeline.captions after the caption job finishes. Returns []
 *  when no transcript is cached yet (or the cached transcript is empty). */
export async function getTranscript(projectId: string, src: string): Promise<CaptionCue[]> {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return [];
  const asset = await ownedAssetFromSrc(ownerId, src);
  if (!asset) return [];
  // Owner-gated by ownedAssetFromSrc above (verifies the caller owns an asset with this
  // contentHash + the src key-owner matches), so the content-addressed transcript lookup
  // is reachable only for content the caller possesses — not a cross-tenant leak. Transcript
  // is a GLOBAL content-addressed cache (@@unique([contentHash, model])); whether to make it
  // per-org is a P3 schema decision (a per-org filter here without changing that unique would
  // break a second org's write). Left global+gated for P0 (no schema change).
  const transcript = await prisma.transcript.findUnique({
    where: { contentHash_model: { contentHash: asset.contentHash, model: "base.en" } },
  });
  if (!transcript) return [];
  const parsed = captionCue.array().safeParse(transcript.cuesJson);
  return parsed.success ? parsed.data : [];
}

/** Hide from candidate zone. The row is a tombstone; the sweeper handles blobs. */
export async function softDeleteGeneration(generationId: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ownerId, deletedAt: null } });
  if (!gen) return { error: "Generation not found." };
  await prisma.$transaction([
    prisma.generation.update({ where: { id: generationId }, data: { deletedAt: new Date() } }),
    // drop any segment keyframe pointing here (no dangling first/last-frame id) (③B)
    prisma.shot.updateMany({ where: { firstFrameGenerationId: generationId, ownerId }, data: { firstFrameGenerationId: null } }),
    prisma.shot.updateMany({ where: { lastFrameGenerationId: generationId, ownerId }, data: { lastFrameGenerationId: null } }),
  ]);
  await logAction(ownerId, "generation.discard", gen.projectId, { generationId });
  revalidatePath("/", "layout");
  return { ok: true };
}

const EDITOR_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const EDITOR_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const EDITOR_AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]); // EXT_BY_TYPE.audio
/** A project's generated media as timeline-ready clips for the editor's Assets
 *  panel — click one to append it to the cut. `seconds` drives the clip length.
 *  image/video go on the visual track; audio (EP4) goes on its own audio track. */
export async function getEditorMedia(projectId: string): Promise<{ id: string; src: string; kind: "image" | "video" | "audio"; seconds: number }[]> {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const { ownerId } = gate;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) return [];
  const gens = await prisma.generation.findMany({
    where: { ownerId, projectId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
  return gens.flatMap((g) => {
    const ext = g.asset.ext.toLowerCase();
    const isVideo = EDITOR_VIDEO_EXTS.has(ext);
    const isImage = EDITOR_IMAGE_EXTS.has(ext);
    const isAudio = EDITOR_AUDIO_EXTS.has(ext);
    if (!isVideo && !isImage && !isAudio) return []; // skip unknown
    const kind = isVideo ? ("video" as const) : isImage ? ("image" as const) : ("audio" as const);
    return [{
      id: g.id,
      src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)),
      kind,
      // audio + video carry durationS; images get a 3s still default
      seconds: kind === "image" ? 3 : (g.asset.durationS ?? 5),
    }];
  });
}

/** Assets library "load more" (scale audit 2026-06-20). Fail-closed + tenant-scoped:
 *  getMediaPage filters by the resolved ownerId, so a forged projectId from another org
 *  returns an empty page (no leak). cursor = "<iso>|<id>" from the previous page. */
export async function loadMoreMedia(projectId: string, cursor?: string | null): Promise<MediaPage | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  if (typeof projectId !== "string" || !projectId) return { error: "Invalid request." };
  return getMediaPage(owner.ownerId, projectId, cursor ?? null);
}

/** Append-only performance signal on a generated video. Generation is immutable
 *  (whitelist only) → record via ActionEvent. Read back by agent / Brand Brain. */
export async function recordGenerationOutcome(generationId: string, posted: boolean, result: string) {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const clean = result.trim().slice(0, 280);
  const gen = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null }, select: { id: true, projectId: true },
  });
  if (!gen) return { error: "Generation not found." };
  await logAction(ownerId, "generation.outcome", gen.projectId, { generationId, posted, result: clean });
  revalidatePath("/", "layout");
  return { ok: true };
}
