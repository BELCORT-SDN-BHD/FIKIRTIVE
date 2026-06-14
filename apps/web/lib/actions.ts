"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import {
  artlioEdit,
  editDuration,
  newId,
  storageKey,
  storageKeyToSrc,
  INGEST_QUEUE,
  RENDER_QUEUE,
  type ArtlioEdit,
  type RenderJobData,
} from "@artlio/core";
import type { EntityType, ShotStatus } from "@artlio/db";
import { storage, extFromFilename, mimeOf, FOUNDER_OWNER_ID } from "./storage";
import { getBoss } from "./queue";
import { buildEntitySnapshot } from "./entity-snapshot";
import { buildBoardEdit, transitionFor } from "./edit";
import { getShots, getCandidates } from "./data";

/**
 * M0 server actions. Conventions:
 *  - every substantive action writes an ActionEvent (D23 gate instrumentation)
 *  - deletes are soft (deletedAt) — sweep is the worker's job (D21)
 *  - Generation rows are immutable outside the whitelist: shotId, version,
 *    attachedAt, deletedAt
 *  - every mutation is owner-scoped: rows are looked up with ownerId before
 *    being touched, so a forged ID can never reach another owner's data
 *  - user-recoverable failures return { error } (never throw) so the UI can
 *    render inline recovery per the state-grid contract
 */

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;

const ENTITY_TYPES = new Set(["CHARACTER", "LOCATION", "PRODUCT", "BRAND"]);
const SHOT_STATUSES = new Set(["DRAFT", "EXPORTED", "ATTACHED", "FINAL"]);

async function logAction(type: string, projectId: string | null, payload?: object) {
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type, payload: payload ?? {} },
  });
}

/** Hash + store bytes; returns the row data for a later transactional upsert. */
async function ingestFile(file: File) {
  const ext = extFromFilename(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // content-addressed blobs are idempotent — safe outside the DB transaction
  // ContentType derives from ext inside the driver — client file.type is untrusted
  const { contentHash } = await storage.put(FOUNDER_OWNER_ID, bytes, ext);
  return {
    contentHash,
    create: {
      id: newId(),
      ownerId: FOUNDER_OWNER_ID,
      contentHash,
      ext,
      mime: file.type || mimeOf(ext),
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: file.name,
      source: "UPLOAD" as const,
    },
  };
}

function assetUpsert(ingested: Awaited<ReturnType<typeof ingestFile>>) {
  return prisma.asset.upsert({
    where: {
      ownerId_contentHash: { ownerId: FOUNDER_OWNER_ID, contentHash: ingested.contentHash },
    },
    update: { deletedAt: null }, // re-upload inside the 30-day window resurrects
    create: ingested.create,
  });
}

// ---------- projects ----------

export async function createProject(name: string) {
  const project = await prisma.project.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, name: name.trim() || "Untitled Project" },
  });
  await logAction("project.create", project.id, { name: project.name });
  revalidatePath("/", "layout");
  return { id: project.id };
}

/** Soft-delete a project (sets deletedAt → drops out of getProjects' notDeleted filter).
 *  Reversible, touches no generated assets/billing — just hides the project + its surfaces. */
export async function deleteProject(projectId: string): Promise<{ ok: true } | { error: string }> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED }, select: { id: true, name: true } });
  if (!project) return { error: "Project not found." };
  await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
  await logAction("project.delete", project.id, { name: project.name });
  revalidatePath("/", "layout");
  return { ok: true };
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
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const files = acceptRefFiles(formData, 0);
  if (!name) return { error: "Name is required." };
  if (!ENTITY_TYPES.has(type)) return { error: "Unknown entity type." };

  const entity = await prisma.entity.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, name, type: type as EntityType },
  });
  for (const [i, file] of files.entries()) {
    const asset = await assetUpsert(await ingestFile(file));
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId: entity.id, assetId: asset.id, position: i },
    });
  }
  await logAction("entity.create", null, { entityId: entity.id, name, type, refCount: files.length });
  revalidatePath("/", "layout");
  return { id: entity.id };
}

export async function updateEntity(
  entityId: string,
  fields: { name?: string; notes?: string; negativeConstraints?: string },
) {
  const data: Record<string, string> = {};
  if (fields.name !== undefined && fields.name.trim()) data.name = fields.name.trim();
  if (fields.notes !== undefined) data.notes = fields.notes;
  if (fields.negativeConstraints !== undefined) data.negativeConstraints = fields.negativeConstraints;
  if (Object.keys(data).length === 0) return { ok: true };
  const { count } = await prisma.entity.updateMany({ where: { id: entityId, ...OWNED }, data });
  if (count === 0) return { error: "Entity not found." };
  await logAction("entity.update", null, { entityId, fields: Object.keys(data) });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Aliases mutate as server-side deltas, never client-supplied full arrays —
 * a stale tab replacing the whole array would silently erase edits made
 * elsewhere (lost-update).
 */
export async function addEntityAlias(entityId: string, alias: string) {
  const clean = alias.trim();
  if (!clean) return { error: "Alias is empty." };
  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Entity not found." };
  // atomic append guarded against dupes — NOT read-modify-write, so two concurrent
  // adds can't lose one (the prior delta-from-client design left this server race) (#9)
  await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_append("aliases", ${clean}) WHERE "id" = ${entityId} AND "ownerId" = ${FOUNDER_OWNER_ID} AND "deletedAt" IS NULL AND NOT (${clean} = ANY("aliases"))`;
  await logAction("entity.update", null, { entityId, addAlias: clean });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeEntityAlias(entityId: string, alias: string) {
  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Entity not found." };
  // atomic remove (same lost-update guard as the add above) (#9)
  await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_remove("aliases", ${alias}) WHERE "id" = ${entityId} AND "ownerId" = ${FOUNDER_OWNER_ID} AND "deletedAt" IS NULL`;
  await logAction("entity.update", null, { entityId, removeAlias: alias });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Remove one reference image from an entity (soft — asset row is a tombstone). */
export async function softDeleteReferenceImage(refImageId: string) {
  const ref = await prisma.referenceImage.findFirst({ where: { id: refImageId, ...OWNED } });
  if (!ref) return { error: "Reference image not found." };
  await prisma.referenceImage.update({
    where: { id: refImageId },
    data: { deletedAt: new Date() },
  });
  await logAction("entity.update", null, { entityId: ref.entityId, refImageId, action: "ref-delete" });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addReferenceImages(entityId: string, formData: FormData) {
  const entity = await prisma.entity.findFirst({ where: { id: entityId, ...OWNED } });
  if (!entity) return { error: "Entity not found." };
  const existing = await prisma.referenceImage.count({ where: { entityId, deletedAt: null } });
  const files = acceptRefFiles(formData, existing);
  if (files.length === 0) return { error: "No valid images — PNG, JPG or WebP, ≤ 10 MB, up to 10 per element." };
  const last = await prisma.referenceImage.findFirst({
    where: { entityId, deletedAt: null },
    orderBy: { position: "desc" },
  });
  let position = (last?.position ?? -1) + 1;
  for (const file of files) {
    const asset = await assetUpsert(await ingestFile(file));
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, entityId, assetId: asset.id, position: position++ },
    });
  }
  await logAction("entity.update", null, { entityId, addedRefs: files.length });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function softDeleteEntity(entityId: string) {
  const refCount = await prisma.shotEntityRef.count({ where: { entityId } });
  const { count } = await prisma.entity.updateMany({
    where: { id: entityId, ...OWNED },
    data: { deletedAt: new Date() },
  });
  if (count === 0) return { error: "Entity not found." };
  await logAction("entity.update", null, { entityId, action: "soft-delete", shotRefsAtDelete: refCount });
  revalidatePath("/", "layout");
  // History stays intact (snapshots); shots referencing it show a stale chip until edited.
  return { ok: true, shotRefs: refCount };
}

// ---------- shots ----------

export async function createShot(projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  // number = max+1; @@unique([projectId, number]) backstops concurrent creates
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.shot.findFirst({
      where: { projectId },
      orderBy: { number: "desc" },
    });
    try {
      const shot = await prisma.shot.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, number: (last?.number ?? 0) + 1 },
      });
      await logAction("shot.create", projectId, { shotId: shot.id, number: shot.number });
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
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  const uniqueIds = [...new Set(entityIds)];
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
    prisma.shotEntityRef.deleteMany({ where: { shotId } }),
    ...(uniqueIds.length
      ? [prisma.shotEntityRef.createMany({
          data: uniqueIds.map((entityId) => ({ shotId, entityId, ownerId: FOUNDER_OWNER_ID })),
        })]
      : []),
  ]);
  await logAction("shot.update", shot.projectId, { shotId, entityIds: uniqueIds });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateShotTitle(shotId: string, title: string) {
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  await prisma.shot.update({ where: { id: shotId }, data: { title: title.trim() } });
  await logAction("shot.update", shot.projectId, { shotId, field: "title" });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateShotStatus(shotId: string, status: string) {
  if (!SHOT_STATUSES.has(status)) return { error: "Unknown shot status." };
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  await prisma.shot.update({ where: { id: shotId }, data: { status: status as ShotStatus } });
  await logAction("shot.update", shot.projectId, { shotId, status });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function softDeleteShot(shotId: string) {
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  const attached = await prisma.generation.count({ where: { shotId, deletedAt: null } });
  if (attached > 0) {
    return { error: `This shot has ${attached} attached generation(s). Detach them first.` };
  }
  await prisma.$transaction([
    prisma.shot.update({ where: { id: shotId }, data: { deletedAt: new Date() } }),
    // derived index — drop with the shot so entity usage counts stay honest
    prisma.shotEntityRef.deleteMany({ where: { shotId } }),
  ]);
  await logAction("shot.update", shot.projectId, { shotId, action: "soft-delete" });
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
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "No files received." };
  const promptText = String(formData.get("promptText") ?? "");
  const entityIds = formData.getAll("entityIds").map(String).filter(Boolean);
  const entitySnapshot = await buildEntitySnapshot(entityIds);

  const ingested: Awaited<ReturnType<typeof ingestFile>>[] = [];
  for (const file of files) ingested.push(await ingestFile(file));

  await prisma.$transaction(async (tx) => {
    for (const item of ingested) {
      const asset = await tx.asset.upsert({
        where: {
          ownerId_contentHash: { ownerId: FOUNDER_OWNER_ID, contentHash: item.contentHash },
        },
        update: { deletedAt: null },
        create: item.create,
      });
      await tx.generation.create({
        data: {
          id: newId(),
          ownerId: FOUNDER_OWNER_ID,
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
        ownerId: FOUNDER_OWNER_ID,
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
      where: { ownerId: FOUNDER_OWNER_ID, contentHash: { in: ingested.map((i) => i.contentHash) } },
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
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  const file = formData.getAll("files").find((f): f is File => f instanceof File && f.size > 0);
  if (!file) return { error: "No image received." };
  const ext = extFromFilename(file.name);
  if (!REF_IMAGE_EXTS.has(ext)) return { error: "Reference must be a PNG, JPG, or WEBP image." };
  if (!(await looksLikeImage(file))) return { error: "That file isn't a valid PNG / JPG / WEBP image." };
  const item = await ingestFile(file);
  let genId = "";
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.upsert({
      where: { ownerId_contentHash: { ownerId: FOUNDER_OWNER_ID, contentHash: item.contentHash } },
      update: { deletedAt: null },
      create: item.create,
    });
    const gen = await tx.generation.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, shotId: null, assetId: asset.id, source: "UPLOAD", promptText: "", entitySnapshot: { entities: [] } },
    });
    genId = gen.id;
  });
  revalidatePath("/", "layout");
  return { id: genId, src: storageKeyToSrc(storageKey(FOUNDER_OWNER_ID, item.contentHash, ext)) };
}

/** Manual attach: candidate → shot, next version number, shot goes ATTACHED. */
export async function attachGeneration(generationId: string, shotId: string) {
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ...OWNED } });
  if (!gen) return { error: "Generation not found." };
  if (gen.shotId) return { error: "Already attached to a shot — detach it first." };
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED } });
  if (!shot) return { error: "Shot not found." };
  if (shot.projectId !== gen.projectId) {
    return { error: "That shot belongs to a different project." };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const top = await prisma.generation.findFirst({
      where: { shotId },
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
  await logAction("generation.attach", gen.projectId, { generationId, shotId });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Detach back to the candidate zone (whitelist fields only). */
export async function detachGeneration(generationId: string) {
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ...OWNED } });
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
          where: { id: shotId, status: "ATTACHED" },
          data: { status: "DRAFT" },
        })]
      : []),
  ]);
  await logAction("generation.detach", gen.projectId, { generationId, shotId });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Soft-delete a generation from the Assets library. If it was a shot's last
 *  live render, the shot drops back to DRAFT (same "last one out" rule). */
export async function deleteGeneration(generationId: string): Promise<{ ok: true } | { error: string }> {
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ...OWNED } });
  if (!gen) return { error: "Generation not found." };
  const shotId = gen.shotId;
  const remaining = shotId
    ? await prisma.generation.count({ where: { shotId, deletedAt: null, id: { not: generationId } } })
    : 0;
  await prisma.$transaction([
    prisma.generation.update({ where: { id: generationId }, data: { deletedAt: new Date() } }),
    // clear any segment keyframe pointing at this generation so deleting it can't
    // leave a Shot with a dangling first/last-frame id (③B cleanup)
    prisma.shot.updateMany({ where: { firstFrameGenerationId: generationId }, data: { firstFrameGenerationId: null } }),
    prisma.shot.updateMany({ where: { lastFrameGenerationId: generationId }, data: { lastFrameGenerationId: null } }),
    ...(shotId && remaining === 0
      ? [prisma.shot.updateMany({ where: { id: shotId, status: "ATTACHED" }, data: { status: "DRAFT" } })]
      : []),
  ]);
  await logAction("generation.delete", gen.projectId, { generationId, shotId });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- editor (phase-③ tracer: contract → queue → worker → asset) ----------

/** Persist the working cut (replaces the phase-② localStorage mock). */
export async function saveProjectEdit(projectId: string, editJsonString: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  let edit: ArtlioEdit;
  try {
    // canonicalizing parse — only the parsed value is ever persisted
    edit = artlioEdit.parse(JSON.parse(editJsonString));
  } catch {
    return { error: "That cut is out of contract — fix the flagged clip first." };
  }
  await prisma.project.update({ where: { id: projectId }, data: { editJson: edit } });
  await logAction("edit.save", projectId, { seconds: Math.round(editDuration(edit)) });
  revalidatePath("/", "layout");
  return { ok: true };
}

const BLANK_CUT = (): ArtlioEdit => ({
  timeline: { background: "#000000", tracks: [{ clips: [] }] },
  output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
});

/** Extract a finished storyboard segment into the editor: append its rendered
 *  video (with the segment's fade) to the END of the working cut's visual track,
 *  then persist. Base = the saved cut if any, else a fresh board cut, else blank.
 *  De-duped by src — a segment already on the timeline reports added:false and
 *  changes nothing (the board cut already carries every attached render). */
export async function addSegmentToCut(shotId: string): Promise<{ ok: true; added: boolean } | { error: string }> {
  const shot = await prisma.shot.findFirst({ where: { id: shotId, ...OWNED }, select: { id: true, projectId: true, transition: true } });
  if (!shot) return { error: "Shot not found." };
  // the segment's render = its latest attached video, scoped to shot + owner +
  // project (defense in depth — the schema doesn't enforce gen.projectId == shot's)
  const vid = await prisma.generation.findFirst({
    where: { shotId: shot.id, projectId: shot.projectId, ownerId: FOUNDER_OWNER_ID, deletedAt: null, asset: { ext: { in: ["mp4", "mov", "webm", "mkv"] } } },
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
    const project = await prisma.project.findFirst({ where: { id: shot.projectId, ...OWNED } });
    if (!project) return { error: "Project not found." };

    // base = the VALID saved cut; on a missing/corrupt saved cut, rebuild from the
    // board (never silently blank over an existing-but-invalid cut)
    const saved = project.editJson ? artlioEdit.safeParse(project.editJson) : null;
    let base: ArtlioEdit;
    if (saved?.success) {
      base = saved.data;
    } else {
      const [shots, candidates] = await Promise.all([getShots(shot.projectId), getCandidates(shot.projectId)]);
      base = buildBoardEdit(shots, candidates).edit ?? BLANK_CUT();
    }
    const track0 = base.timeline.tracks[0];
    if (!track0) return { error: "That cut has no visual track." };
    // already on the timeline (e.g. the board cut already includes it) → no-op
    if (track0.clips.some((c) => c.asset.src === src)) return { ok: true, added: false };

    const end = track0.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
    const tr = transitionFor(shot.transition, seconds);
    track0.clips.push({ asset: { type: "video", src }, start: end, length: seconds, ...(tr ? { transition: tr } : {}) });
    const parsed = artlioEdit.safeParse(base); // canonicalize before persisting (saveProjectEdit discipline)
    if (!parsed.success) return { error: "Adding that segment would put the cut out of contract." };

    const res = await prisma.project.updateMany({ where: { id: project.id, updatedAt: project.updatedAt }, data: { editJson: parsed.data } });
    if (res.count === 1) {
      await logAction("edit.addSegment", project.id, { shotId, seconds: Math.round(seconds) });
      revalidatePath("/", "layout");
      return { ok: true, added: true };
    }
    // a concurrent write landed between our read and write — re-read and retry
  }
  return { error: "The cut changed while adding — please try again." };
}

/** Export: persist the job row FIRST, then dispatch (triple-insurance rule).
 *  The cut snapshot and Project.editJson are written in ONE transaction, so
 *  "export renders what is saved" holds by construction (codex review). */
export async function startRender(projectId: string, editJsonString: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };
  let edit: ArtlioEdit;
  try {
    edit = artlioEdit.parse(JSON.parse(editJsonString));
  } catch {
    return { error: "That cut is out of contract — fix the flagged clip first." };
  }
  // server-side in-flight guard (codex review): double-clicks and duplicate
  // tabs must not stack identical renders
  const active = await prisma.renderJob.findFirst({
    where: { projectId, ownerId: FOUNDER_OWNER_ID, status: { in: ["QUEUED", "RENDERING"] } },
  });
  if (active) {
    return { error: "A render is already running for this project — wait for it to finish below." };
  }
  const [, job] = await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { editJson: edit } }),
    prisma.renderJob.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, editJson: edit },
    }),
  ]);
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
  await logAction("render.start", projectId, { renderJobId: job.id });
  revalidatePath("/", "layout");
  return { id: job.id };
}

/** Poll target for the editor's render strip. */
export async function getRenderJobs(projectId: string) {
  const jobs = await prisma.renderJob.findMany({
    where: { projectId, ownerId: FOUNDER_OWNER_ID },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const assetIds = jobs.map((j) => j.outputAssetId).filter((x): x is string => !!x);
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } } });
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

/** Hide from candidate zone. The row is a tombstone; the sweeper handles blobs. */
export async function softDeleteGeneration(generationId: string) {
  const gen = await prisma.generation.findFirst({ where: { id: generationId, ...OWNED } });
  if (!gen) return { error: "Generation not found." };
  await prisma.$transaction([
    prisma.generation.update({ where: { id: generationId }, data: { deletedAt: new Date() } }),
    // drop any segment keyframe pointing here (no dangling first/last-frame id) (③B)
    prisma.shot.updateMany({ where: { firstFrameGenerationId: generationId }, data: { firstFrameGenerationId: null } }),
    prisma.shot.updateMany({ where: { lastFrameGenerationId: generationId }, data: { lastFrameGenerationId: null } }),
  ]);
  await logAction("generation.discard", gen.projectId, { generationId });
  revalidatePath("/", "layout");
  return { ok: true };
}

const EDITOR_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const EDITOR_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
/** A project's generated media as timeline-ready clips for the editor's Assets
 *  panel — click one to append it to the cut. `seconds` drives the clip length.
 *  Only image/video are returned; audio/unknown assets aren't timeline clips here. */
export async function getEditorMedia(projectId: string): Promise<{ id: string; src: string; kind: "image" | "video"; seconds: number }[]> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return [];
  const gens = await prisma.generation.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, projectId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
  return gens.flatMap((g) => {
    const ext = g.asset.ext.toLowerCase();
    const isVideo = EDITOR_VIDEO_EXTS.has(ext);
    if (!isVideo && !EDITOR_IMAGE_EXTS.has(ext)) return []; // skip audio/unknown
    return [{
      id: g.id,
      src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)),
      kind: isVideo ? ("video" as const) : ("image" as const),
      seconds: isVideo ? (g.asset.durationS ?? 5) : 3,
    }];
  });
}
