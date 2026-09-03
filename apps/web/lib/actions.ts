"use server";

import { revalidatePath } from "next/cache";
import { prisma, refundReservation } from "@fikirtive/db";
import {
  fikirtiveEdit,
  captionCue,
  editDuration,
  foreignEditSrcs,
  FOREIGN_MEDIA_MESSAGE,
  newId,
  parseStorageKey,
  keyOwnerMatches,
  srcToStorageKey,
  storageKey,
  storageKeyToSrc,
  resolveUploadMime,
  MEDIA_SNIFF_BYTES,
  RENDER_QUEUE,
  CAPTION_QUEUE,
  TRANSCRIPT_GENERATION,
  type FikirtiveEdit,
  type CaptionCue,
  type CaptionJobData,
  type RenderJobData,
} from "@fikirtive/core";
import type { EntityType, ShotStatus } from "@fikirtive/db";
import { storage, extFromFilename } from "./storage";
import { getBoss } from "./queue";
import { isCannedStarter } from "./otto-canned-starters";
import { buildBoardEdit, transitionFor } from "./edit";
import { getShots, getLooseVideoClips, getMediaPage, type MediaPage } from "./data";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { purgeOrphanedReferenceAssets, purgeAssetStorage } from "./asset-purge";

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

/** `db` is the ambient client or a transaction client — the caller decides whether this
 *  upsert has to commit together with the rows around it (#698). */
function assetUpsert(
  db: Pick<typeof prisma, "asset">,
  ownerId: string,
  ingested: Awaited<ReturnType<typeof ingestFile>>,
) {
  const { ext, mime, sizeBytes, originalFilename } = ingested.create;
  return db.asset.upsert({
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

// ---------- projects ----------

/** Placeholder names a fresh project carries until its first conversation names it.
 *  "New project" is the current default (#546 — a Project is never called a campaign;
 *  the independent Campaign object lives in campaign-actions.ts). "New campaign" and
 *  "Untitled Project" stay listed so pre-#546 DB rows keep reusing/auto-titling. */
const DEFAULT_PROJECT_NAMES = new Set(["New project", "New campaign", "Untitled Project"]);

/** Empty Chat title fallback. It is not a reusable Project placeholder, but auto-title
 *  must still refuse to copy it onto a default Project. */
const UNTITLED_CHAT_TITLE = "Untitled";

/** 自动命名往回看几条对话(#979)。见 `autoTitleProjectIfDefault` 里为什么是一个窗口。 */
const AUTOTITLE_THREAD_SCAN = 25;

/**
 * 这个对话标题能不能拿去当画布的名字(#979)。
 *
 * 三种不能,理由各不相同,但结果一样 —— 拿它命名等于没命名:
 *   · 空的 —— 商家还没打过字;
 *   · "Untitled" / 画布占位名 —— 那是我们的默认值,不是他的话;
 *   · 罐头开场白 —— 那是我们写好、他点了一下的文案(`isCannedStarter`)。
 */
function isAdoptableProjectName(title: string): boolean {
  if (!title || title === UNTITLED_CHAT_TITLE) return false;
  if (DEFAULT_PROJECT_NAMES.has(title)) return false;
  return !isCannedStarter(title);
}

async function findReusableEmptyDefaultProject(ownerId: string, name: string): Promise<{ id: string; name: string } | null> {
  if (!DEFAULT_PROJECT_NAMES.has(name)) return null;
  const candidates = await prisma.project.findMany({
    where: { ownerId, name: { in: [...DEFAULT_PROJECT_NAMES] }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, editJson: true, coworkBrief: true, brandId: true, campaignId: true },
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

/** Idempotent: returns the owner's oldest non-deleted project, or creates one with the
 *  standard "New project" placeholder name if none exist (used by /otto, the immersive
 *  canvas entry, and Otto's projects port). #546 F-18: no pre-seeded "My Videos" — the
 *  bootstrap project is
 *  indistinguishable from one the merchant created themselves: it auto-titles from its
 *  first conversation and is reused by the rail's New-project entry while still empty.
 *  Never throws — the caller surfaces any auth failure via the {error} contract. */
export async function getOrCreateDefaultProject(): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string } | { error: string }> => {
    const { ownerId } = gate;
    const existing = await prisma.project.findFirst({
      where: { ownerId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existing) return { id: existing.id };
    const project = await prisma.project.create({
      data: { id: newId(), ownerId, name: "New project" },
    });
    await logAction(ownerId, "project.create", project.id, { name: project.name, via: "bootstrap" });
    return { id: project.id };
  });
}

export async function createProject(name: string): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string } | { error: string }> => {
    const { ownerId } = gate;
    const cleanName = name.trim() || "Untitled Project";
    const reusable = await findReusableEmptyDefaultProject(ownerId, cleanName);
    if (reusable) {
      if (cleanName === "New project" && reusable.name !== cleanName) {
        const renamed = await prisma.$transaction(async (tx) => {
          const { count } = await tx.project.updateMany({
            where: { id: reusable.id, ownerId, name: reusable.name, deletedAt: null },
            data: { name: cleanName },
          });
          if (count !== 1) return false;
          await tx.actionEvent.create({
            data: {
              id: newId(),
              ownerId,
              projectId: reusable.id,
              type: "project.rename",
              payload: { name: cleanName },
            },
          });
          return true;
        });
        if (!renamed) return { error: "Project not found." };
        revalidatePath("/", "layout");
      }
      return { id: reusable.id };
    }
    const project = await prisma.project.create({
      data: { id: newId(), ownerId, name: cleanName },
    });
    await logAction(ownerId, "project.create", project.id, { name: project.name });
    revalidatePath("/", "layout");
    return { id: project.id };
  });
}

/** Permanently delete a project and its project-scoped work.
 *  Global assets/entities/ledger rows are intentionally not deleted here. */
export async function deleteProject(projectId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
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
            data: { status: "FAILED", error: "Canceled by project deletion", finishedAt: new Date() },
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
        return { error: "A generation is still running in this project. Delete it after the generation finishes." };
      }
      if (e instanceof Error && e.message === "GENERATION_STARTED_DURING_DELETE") {
        return { error: "A generation started while deleting this project. Delete it after the generation finishes." };
      }
      if (e instanceof Error && e.message === "RESEARCH_RUNNING_DURING_DELETE") {
        return { error: "Research is still running in this project. Delete it after research finishes." };
      }
      console.error("[deleteProject] failed:", e);
      return { error: "Couldn't delete the project — please try again." };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Rename a project. Owner-scoped, fail-closed; display-only metadata. */
export async function renameProject(projectId: string, name: string): Promise<{ ok: true; name: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; name: string } | { error: string }> => {
    const { ownerId } = gate;
    const clean = name.trim().slice(0, 80);
    if (!clean) return { error: "Name required." };
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
    if (!project) return { error: "Project not found." };
    await prisma.project.update({ where: { id: project.id }, data: { name: clean } });
    await logAction(ownerId, "project.rename", project.id, { name: clean });
    revalidatePath("/", "layout");
    return { ok: true, name: clean };
  });
}

/** Pin/unpin a project in the sidebar. Owner-scoped display metadata only. */
export async function setProjectPinned(projectId: string, pinned: boolean): Promise<{ ok: true; pinnedAt: string | null } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; pinnedAt: string | null } | { error: string }> => {
    const { ownerId } = gate;
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true } });
    if (!project) return { error: "Project not found." };
    const pinnedAt = pinned ? new Date() : null;
    const { count } = await prisma.project.updateMany({ where: { id: project.id, ownerId }, data: { pinnedAt } });
    if (!count) return { error: "Project not found." };
    await logAction(ownerId, pinned ? "project.pin" : "project.unpin", project.id);
    revalidatePath("/", "layout");
    return { ok: true, pinnedAt: pinnedAt ? pinnedAt.toISOString() : null };
  });
}

/** Auto-title a still-default project from its first conversation's title (Grok
 *  pattern: a new agent gets named from the first prompt). Owner-scoped, fail-closed,
 *  idempotent (no-op once the project has a real name); writes only project.name —
 *  touches no credits/generation. Safe to call repeatedly from the client. */
export async function autoTitleProjectIfDefault(projectId: string): Promise<{ ok: true; name?: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; name?: string } | { error: string }> => {
    const { ownerId } = gate;
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null }, select: { id: true, name: true } });
    if (!project) return { error: "Project not found." };
    if (!DEFAULT_PROJECT_NAMES.has(project.name)) return { ok: true }; // already named
    // #979:取最早一条**可采用**的对话,不是最早那一条。
    //
    // 只读最早一条是判官抓到的第二个洞:罐头开场白那条对话现在叫 "Untitled",而它恰恰
    // 是最早的那条 —— 于是这里每次都读到它、每次都早退,画布**永远**停在「New project」。
    // 「之后会被真正的内容命名」就成了一句假话。所以往后找:跳过还没有名字的、跳过占位名、
    // 跳过我们自己的开场白,第一条商家真正打过字的对话来命名画布。
    //
    // 取一个窗口而不是全部:这个动作只在画布还叫占位名时跑,那一刻的对话数以个位数计;
    // 窗口拉满(全是罐头/空对话)时的结果与今天一样 —— 画布保持默认名,等下一条真消息,
    // 没有比现在更差的那一档。
    const threads = await prisma.chatThread.findMany({
      where: { ownerId, projectId: project.id },
      orderBy: { createdAt: "asc" },
      take: AUTOTITLE_THREAD_SCAN,
      select: { title: true },
    });
    const title = threads.map((t) => t.title?.trim() ?? "").find(isAdoptableProjectName);
    if (!title) return { ok: true }; // nothing to adopt yet
    const clean = title.slice(0, 80);
    await prisma.project.update({ where: { id: project.id }, data: { name: clean } });
    await logAction(ownerId, "project.autotitle", project.id, { name: clean });
    revalidatePath("/", "layout");
    return { ok: true, name: clean };
  });
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
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "");
    const files = acceptRefFiles(formData, 0);
    if (!name) return { error: "Name is required." };
    if (!ENTITY_TYPES.has(type)) return { error: "Unknown entity type." };

    // #698 — the element and its images live or die together. The old order created the
    // Entity FIRST, so any later failure (a storage blip, a refused Asset write) left a
    // nameless tile in the merchant's Library with no image and no message: every retry
    // added one more. Bytes go to content-addressed storage first (idempotent, safe to
    // repeat), then EVERY row write commits in one transaction.
    const ingested: Awaited<ReturnType<typeof ingestFile>>[] = [];
    try {
      for (const file of files) ingested.push(await ingestFile(ownerId, file));
    } catch (e) {
      console.error("[entity.create] upload failed:", e instanceof Error ? e.message : e);
      return { error: "Couldn't upload those images. Please try again." };
    }

    const entityId = newId();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.entity.create({ data: { id: entityId, ownerId, name, type: type as EntityType } });
        let firstAssetId: string | null = null;
        // content-addressed upload dedups identical files to ONE Asset, so the same image
        // picked twice would attach that asset twice — the live-uniqueness index
        // (ReferenceImage_live_entity_asset_variant_key) rejects the dup with P2002, and
        // inside a transaction that P2002 aborts the whole upload. The entity is brand new
        // here, so its only possible duplicate is a repeat within THIS pick: skip it up
        // front instead of letting the database raise: a post-hoc P2002 swallow cannot help
        // inside a transaction, which is why this path skips BEFORE the insert.
        const attached = new Set<string>();
        for (const item of ingested) {
          const asset = await assetUpsert(tx, ownerId, item);
          firstAssetId ??= asset.id;
          if (attached.has(asset.id)) continue;
          await tx.referenceImage.create({
            data: { id: newId(), ownerId, entityId, assetId: asset.id, position: attached.size },
          });
          attached.add(asset.id);
        }
        // the first reference becomes the locked base (same invariant as the migration backfill)
        if (firstAssetId) {
          await tx.entity.update({
            where: { id_ownerId: { id: entityId, ownerId } },
            data: { baseAssetId: firstAssetId },
          });
        }
      });
    } catch (e) {
      console.error("[entity.create] persist failed:", e instanceof Error ? e.message : e);
      return { error: "Couldn't add this to your library. Please try again." };
    }
    await logAction(ownerId, "entity.create", null, { entityId, name, type, refCount: files.length });
    revalidatePath("/", "layout");
    return { id: entityId };
  });
}

export async function updateEntity(
  entityId: string,
  fields: { name?: string; notes?: string; negativeConstraints?: string; type?: string },
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const data: { name?: string; notes?: string; negativeConstraints?: string; type?: EntityType } = {};
    if (fields.name !== undefined && fields.name.trim()) data.name = fields.name.trim();
    if (fields.notes !== undefined) data.notes = fields.notes;
    if (fields.negativeConstraints !== undefined) data.negativeConstraints = fields.negativeConstraints;
    // beta bug 4 —— 类型从「建好就再也改不了」改成可改(Founder 方案 A)。录屏里那只瓶子被
    // 标成了人,送进引擎的机器指令就是 `Define the person in <Image_1>`,而商家没有任何改
    // 正的路 —— 只能删掉重建,连同它的参考照一起丢。
    let typeFrom: EntityType | null = null;
    if (fields.type !== undefined) {
      if (!ENTITY_TYPES.has(fields.type)) return { error: "Unknown entity type." };
      const current = await prisma.entity.findFirst({
        where: { id: entityId, ownerId, deletedAt: null },
        select: { type: true },
      });
      if (!current) return { error: "Entity not found." };
      if (current.type !== fields.type) {
        // ── 把 CHARACTER 改成别的类型:在飞的付费作业底下不许改 ────────────────────
        //
        // 与 `deleteVariant`(refgen-actions.ts)同一条规矩、同一套论证:钱路 fail-closed 闸,
        // **没有陈旧窗口**。
        //
        // 要保住的是什么:worker 那道**只对 CHARACTER 生效**的定锚闸
        // (apps/worker/src/jobs/gen.ts,`liveEntity.type === "CHARACTER" && found.length === 0`)。
        // 它挡的是「没有参考照的角色滑进一次没有条件图的付费调用」,而守望者(checkCast)
        // 是 fail-OPEN 的,所以它是最后一层。CHARACTER 一旦被改走,这道闸就在一单**已经排
        // 上队**的作业底下自己消失,那一单于是照跑照花钱 —— 不改类型的话它本会
        // `failClosedWithRefund` 退款。钱的事一律 fail closed,所以这个方向不许改。
        //
        // ── 为什么**只**拦这一个方向 ──────────────────────────────────────────────
        // 反方向(别的类型 → CHARACTER)只会给这一单**加**上那道闸,不会抽走任何东西:
        // 有参考照 → 闸不触发,什么都没变;没有参考照 → 闸触发,终态失败 + 退款。两种结
        // 果都不漏钱,所以没有理由拦。CHARACTER 之外互相改(如 PRODUCT → LOCATION)根本
        // 碰不到这道闸,同样不拦。锁定面因此只剩「CHARACTER + 有在飞作业」这一格。
        //
        // ⚠️ 这一格里**不许**再按「有没有审批快照」二次收窄 —— 那会把洞重新开出来:
        // 定锚闸读的是 `liveEntity.type`(worker 现查的活行),与 `job.approvedEntities`
        // 无关。快照只保护提示词里那个名字与类型(`approved?.type ?? liveEntity.type` 决定
        // 编号句里的名词),保护不到定锚。所以**带快照的单与不带快照的单同样要拦**;startGen
        // 的 `approvedEntityDrift` 只拦得住下一次花钱,拦不住此刻已经在队列里的这一单。
        //
        // ── 为什么没有陈旧窗口 ──────────────────────────────────────────────────
        // 与 deleteVariant 逐字同因:任何窗口都会比这条产品线自己的付费时钟链短,而链上每
        // 一档都还在花钱 —— 供应商轮询 15m < GEN_STALE_MS 18m < 队列过期 20m < 清道夫
        // GEN_REAP_MS/GEN_QUEUED_REAP_MS 25m(apps/worker/src/jobs/clock-invariants.test.ts
        // 钉死)。一个 QUEUED 了 16 分钟的单,pg-boss 照送、worker 照跑、钱照花(gen.ts 里
        // GEN_QUEUED_REAP_MS 的注释写得很白:25 分钟以内 QUEUED 都可能只是排队没轮到)。
        // 按「超时=废弃」放行,等于恰好在它还会花钱的那几分钟里把闸打开。
        //
        // 「岂不是永久锁死?」不会,而且这里不需要任何时间常量:reapStaleGenJobs 对 QUEUED
        // 与 GENERATING 都会在 ~25 分钟加一轮巡检(5 分钟一扫)里终态化并退款,之后这道闸
        // 自然放行。最坏是等半小时,不是改不回来。
        //
        // 只挡 GenJob,**不挡 RefGenJob**:参考图那条路在建单那一刻就把整句提示词冻在
        // `RefGenJob.prompt` 上,它的 worker(apps/worker/src/jobs/refgen.ts)从头到尾
        // 一次都没读过 `entity.type` —— 挡它属于凭空立规矩,不是防护。
        //
        // 已知未闭合(不在本票范围):这次读与下面那次写不在同一事务里,与 startGen 之间存
        // 在亚秒级 TOCTOU 窗口。这是本文件既有形状的通病(改名同样暴露),另票跟踪,别把它
        // 当成已解决。
        if (current.type === "CHARACTER") {
          const inFlight = await prisma.genJob.findFirst({
            where: {
              ownerId,
              status: { in: ["QUEUED", "GENERATING"] },
              entityIds: { has: entityId },
            },
            select: { id: true },
          });
          if (inFlight) {
            return { error: "A generation using this is still running — wait for it to finish, then change the type." };
          }
        }
        data.type = fields.type as EntityType;
        typeFrom = current.type;
      }
    }
    if (Object.keys(data).length === 0) return { ok: true };
    const { count } = await prisma.entity.updateMany({ where: { id: entityId, ownerId, deletedAt: null }, data });
    if (count === 0) return { error: "Entity not found." };
    await logAction(ownerId, "entity.update", null, {
      entityId,
      fields: Object.keys(data),
      // 每个东西都要有迹可循:类型换过之后,老作品为什么带着另一个名词,只有这一行答得出来。
      ...(typeFrom ? { typeFrom, typeTo: data.type } : {}),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/**
 * Aliases mutate as server-side deltas, never client-supplied full arrays —
 * a stale tab replacing the whole array would silently erase edits made
 * elsewhere (lost-update).
 */
export async function addEntityAlias(entityId: string, alias: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

export async function removeEntityAlias(entityId: string, alias: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const entity = await prisma.entity.findFirst({ where: { id: entityId, ownerId, deletedAt: null } });
    if (!entity) return { error: "Entity not found." };
    // atomic remove (same lost-update guard as the add above) (#9)
    await prisma.$executeRaw`UPDATE "Entity" SET "aliases" = array_remove("aliases", ${alias}) WHERE "id" = ${entityId} AND "ownerId" = ${ownerId} AND "deletedAt" IS NULL`;
    await logAction(ownerId, "entity.update", null, { entityId, removeAlias: alias });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Remove one reference image from an entity (soft — asset row is a tombstone, UNLESS this
 *  was the asset's last live reference and it was never used by any Generation, in which case
 *  the underlying storage object is purged for real — see ./asset-purge). */
export async function softDeleteReferenceImage(refImageId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const ref = await prisma.referenceImage.findFirst({ where: { id: refImageId, ownerId, deletedAt: null } });
    if (!ref) return { error: "Reference image not found." };
    const purged = await prisma.$transaction(async (tx) => {
      await tx.referenceImage.update({
        where: { id: refImageId },
        data: { deletedAt: new Date() },
      });
      // if we just removed the entity's base ref, repoint baseAssetId to the next live
      // base-level ref (or null) — otherwise it dangles at an orphaned asset and variant
      // generation would still condition on a base the user no longer has.
      const entity = await tx.entity.findFirst({ where: { id: ref.entityId, ownerId, deletedAt: null }, select: { baseAssetId: true } });
      if (entity?.baseAssetId === ref.assetId) {
        const next = await tx.referenceImage.findFirst({
          where: { ownerId, entityId: ref.entityId, deletedAt: null, variantId: null },
          orderBy: { position: "asc" },
          select: { assetId: true },
        });
        await tx.entity.updateMany({ where: { id: ref.entityId, ownerId, deletedAt: null }, data: { baseAssetId: next?.assetId ?? null } });
      }
      // 2026-09-03 staging 走查 S4 —— 「商家的 data 商家的权利」:同一张照片可能被去重挂在
      // 别的实体/变体上,或被某个 Generation 用过,判据见 asset-purge.ts;真删只发生在两者
      // 都不成立时。
      return purgeOrphanedReferenceAssets(tx, ownerId, [ref.assetId]);
    });
    await purgeAssetStorage(purged);
    await logAction(ownerId, "entity.update", null, { entityId: ref.entityId, refImageId, action: "ref-delete", assetPurged: purged.length > 0 });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Soft-delete the entity itself AND every reference image it still owns; any asset that
 *  became exclusive to it as a result is purged for real (2026-09-03 staging 走查 S4,Founder
 *  裁「现在就修」——「商家的 data 商家的权利」:删演员不能只藏一行数据库,底下的参考照
 *  字节也要真的从存储里消失)。判据见 ./asset-purge:共享引用(别的实体/变体还在用,或被
 *  任何 Generation 用过)只解引用、不删对象。 */
export async function softDeleteEntity(entityId: string): Promise<{ ok: true; shotRefs: number } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const refCount = await prisma.shotEntityRef.count({ where: { entityId } });
    const purged = await prisma.$transaction(async (tx) => {
      const { count } = await tx.entity.updateMany({
        where: { id: entityId, ownerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) return null; // not found — signal to the caller below
      const liveRefs = await tx.referenceImage.findMany({
        where: { entityId, ownerId, deletedAt: null },
        select: { assetId: true },
      });
      await tx.referenceImage.updateMany({
        where: { entityId, ownerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return purgeOrphanedReferenceAssets(tx, ownerId, liveRefs.map((r) => r.assetId));
    });
    if (purged === null) return { error: "Entity not found." };
    await purgeAssetStorage(purged);
    await logAction(ownerId, "entity.update", null, { entityId, action: "soft-delete", shotRefsAtDelete: refCount, assetsPurged: purged.length });
    revalidatePath("/", "layout");
    // History stays intact (snapshots); shots referencing it show a stale chip until edited.
    return { ok: true, shotRefs: refCount };
  });
}

// ---------- shots ----------

export async function createShot(projectId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
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
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

export async function updateShotTitle(shotId: string, title: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
    if (!shot) return { error: "Shot not found." };
    await prisma.shot.update({ where: { id: shotId }, data: { title: title.trim() } });
    await logAction(ownerId, "shot.update", shot.projectId, { shotId, field: "title" });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function updateShotStatus(shotId: string, status: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    if (!SHOT_STATUSES.has(status)) return { error: "Unknown shot status." };
    const shot = await prisma.shot.findFirst({ where: { id: shotId, ownerId, deletedAt: null } });
    if (!shot) return { error: "Shot not found." };
    await prisma.shot.update({ where: { id: shotId }, data: { status: status as ShotStatus } });
    await logAction(ownerId, "shot.update", shot.projectId, { shotId, status });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function softDeleteShot(shotId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

// ---------- generations (candidate zone + manual attach) ----------

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
 *  use it as an image-to-video source; the i2v itself is a separate (paid) gen job. */
export async function uploadReference(projectId: string, formData: FormData): Promise<{ id: string; src: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string; src: string } | { error: string }> => {
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
  });
}

/** Manual attach: candidate → shot, next version number, shot goes ATTACHED. */
export async function attachGeneration(generationId: string, shotId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

/** Detach back to the candidate zone (whitelist fields only). */
export async function detachGeneration(generationId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

/** Soft-delete a generation from the Assets library. If it was a shot's last
 *  live render, the shot drops back to DRAFT (same "last one out" rule). */
export async function deleteGeneration(generationId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
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
      // bump any ScheduledPost carrying this generation as scheduled media (via
      // scheduledPostMedia) so the approve/edit CAS (schedule-actions.ts, pinned on the
      // updatedAt it read) goes stale instead of sailing through on now-deleted media —
      // status is untouched; the approve/publish media check does the actual rejecting.
      prisma.scheduledPost.updateMany({
        where: { ownerId, deletedAt: null, media: { some: { generationId } } },
        data: { updatedAt: new Date() },
      }),
      ...(shotId && remaining === 0
        ? [prisma.shot.updateMany({ where: { id: shotId, ownerId, status: "ATTACHED" }, data: { status: "DRAFT" } })]
        : []),
    ]);
    await logAction(ownerId, "generation.delete", gen.projectId, { generationId, shotId });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

// ---------- editor (phase-③ tracer: contract → queue → worker → asset) ----------

/** Persist the working cut (replaces the phase-② localStorage mock).
 *  Optimistic concurrency (D1): when the client passes the `baseUpdatedAt` it
 *  loaded the cut at, we write ONLY if Project.updatedAt is still that value
 *  (Prisma auto-bumps it on every write) — a concurrent save from another
 *  tab/device bumps it, our conditional update matches 0 rows, and we report
 *  `conflict` instead of silently overwriting that work. Omitting baseUpdatedAt
 *  keeps the old bare write (back-compat: resetToBoard's deliberate replace).
 *
 *  TENANT CHAIN (#780 r2b). This is a server action, i.e. a POST endpoint, and its
 *  whole payload is client-authored timeline JSON — the one place in the product where
 *  the caller names the files we will later read. The contract checks each `src` is a
 *  well-FORMED /files/u/<owner>/<hash> URL and says nothing about whose owner segment
 *  it is, so a cut naming another org's key parsed clean, persisted, and was rendered
 *  and copied out as this org's own output. Every src is now checked against the
 *  AUTHENTICATED owner before anything is written, and one foreign src refuses the whole
 *  document rather than quietly dropping the clip. */
export async function saveProjectEdit(projectId: string, editJsonString: string, baseUpdatedAt?: string): Promise<{ ok: true; updatedAt: string | undefined } | { error: string; conflict?: true }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
    if (foreignEditSrcs(edit, ownerId).length > 0) return { error: FOREIGN_MEDIA_MESSAGE };
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
  });
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
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; added: boolean } | { error: string }> => {
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
      // The segment we append is resolved from an OWNED Generation, but `base` came off the
      // row — and a row written before the saveProjectEdit guard existed can carry someone
      // else's key. Checked on the RESULT, not the base, so a cut that drops the foreign clip
      // still saves and the merchant is never walled into a project they can't repair.
      if (foreignEditSrcs(parsed.data, ownerId).length > 0) return { error: FOREIGN_MEDIA_MESSAGE };

      const res = await prisma.project.updateMany({ where: { id: project.id, ownerId, updatedAt: project.updatedAt }, data: { editJson: parsed.data } });
      if (res.count === 1) {
        await logAction(ownerId, "edit.addSegment", project.id, { shotId, seconds: Math.round(seconds) });
        revalidatePath("/", "layout");
        return { ok: true, added: true };
      }
      // a concurrent write landed between our read and write — re-read and retry
    }
    return { error: "The cut changed while adding — please try again." };
  });
}

/** Export: persist the RenderJob row FIRST, then dispatch (triple-insurance rule).
 *  The RenderJob carries its own editJson snapshot, so "export renders what is saved"
 *  holds by construction. Project.editJson is NOT written here — exportCut does a
 *  GUARDED saveProjectEdit before calling this (D1 optimistic-concurrency). */
export async function startRender(projectId: string, editJsonString: string): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };
    let edit: FikirtiveEdit;
    try {
      edit = fikirtiveEdit.parse(JSON.parse(editJsonString));
    } catch {
      return { error: "That cut is out of contract — fix the flagged clip first." };
    }
    // Tenant chain, second link (#780 r2b): the write path above is now guarded, but this
    // is a server action of its own and it is where the merchant's cut becomes a job the
    // worker will FETCH FILES for. Rows written before that guard existed, or by any future
    // path that forgets it, must still be stopped here — before a RenderJob exists and
    // before anything is queued.
    if (foreignEditSrcs(edit, ownerId).length > 0) return { error: FOREIGN_MEDIA_MESSAGE };
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
  });
}

/** Poll target for the editor's render strip. */
export async function getRenderJobs(projectId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
export async function startCaption(projectId: string, src: string): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

/** Poll target for the editor's caption-generate flow. */
export async function getCaptionJob(jobId: string) {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const job = await prisma.captionJob.findFirst({ where: { id: jobId, ownerId } });
    if (!job) return null;
    return { id: job.id, status: job.status, progress: job.progress, error: job.error };
  });
}

/** Read the cached transcript for a clip → the editable CaptionCue[] seed the UI folds
 *  into timeline.captions after the caption job finishes. Returns [] when no transcript is
 *  cached yet (or the cached transcript is empty).
 *
 *  #787: this used to name the transcription model itself, hardcoded — a SECOND copy of a
 *  constant the worker also held. When the worker's model changed, this side kept asking for
 *  the old one and every merchant's captions came back empty, with no error anywhere.
 *
 *  The fix removes the second knower rather than syncing it: this side asks for the current
 *  TRANSCRIPT_GENERATION, a shared tag that is NOT the engine's name — which engine produced
 *  the cues stays the worker's business, and off this side of the wall where merchant-visible
 *  strings live. See the constant in packages/core for why the selection is an exact tag match
 *  and not "the newest row" (short version: during a rolling deploy an old worker can write the
 *  later row, so newest is not current, and the wrong-language transcript it returns would
 *  never correct itself). */
export async function getTranscript(projectId: string, src: string): Promise<CaptionCue[]> {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<CaptionCue[]> => {
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
    // exact tag match, never a comparison: a row either carries the generation this build reads
    // or it does not exist as far as this call is concerned, whenever it was written.
    const transcript = await prisma.transcript.findUnique({
      where: {
        contentHash_model: { contentHash: asset.contentHash, model: TRANSCRIPT_GENERATION },
      },
    });
    if (!transcript) return [];
    const parsed = captionCue.array().safeParse(transcript.cuesJson);
    return parsed.success ? parsed.data : [];
  });
}

/** Hide from candidate zone. The row is a tombstone; the sweeper handles blobs. */
export async function softDeleteGeneration(generationId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
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
  });
}

const EDITOR_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const EDITOR_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const EDITOR_AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]); // EXT_BY_TYPE.audio
/** A project's generated media as timeline-ready clips for the editor's Assets
 *  panel — click one to append it to the cut. `seconds` drives the clip length.
 *  image/video go on the visual track; audio (EP4) goes on its own audio track. */
export async function getEditorMedia(projectId: string): Promise<{ id: string; src: string; kind: "image" | "video" | "audio"; seconds: number }[]> {
  const gate = await requireOwner(); if ("error" in gate) throw new Error(gate.error);
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string; src: string; kind: "image" | "video" | "audio"; seconds: number }[]> => {
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
  });
}

/** Assets library "load more" (scale audit 2026-06-20). Fail-closed + tenant-scoped:
 *  getMediaPage filters by the resolved ownerId, so a forged projectId from another org
 *  returns an empty page (no leak). cursor = "<iso>|<id>" from the previous page. */
export async function loadMoreMedia(projectId: string, cursor?: string | null): Promise<MediaPage | { error: string }> {
  const owner = await requireOwner();
  if ("error" in owner) return { error: owner.error };
  const principal = await resolveUserPrincipal(owner);
  return runAsUser(principal, async (): Promise<MediaPage | { error: string }> => {
    if (typeof projectId !== "string" || !projectId) return { error: "Invalid request." };
    return getMediaPage(owner.ownerId, projectId, cursor ?? null);
  });
}

/** Append-only performance signal on a generated video. Generation is immutable
 *  (whitelist only) → record via ActionEvent. Read back by agent / Brand Brain. */
export async function recordGenerationOutcome(generationId: string, posted: boolean, result: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    const { ownerId } = gate;
    const clean = result.trim().slice(0, 280);
    const gen = await prisma.generation.findFirst({
      where: { id: generationId, ownerId, deletedAt: null }, select: { id: true, projectId: true },
    });
    if (!gen) return { error: "Generation not found." };
    await logAction(ownerId, "generation.outcome", gen.projectId, { generationId, posted, result: clean });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
