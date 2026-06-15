import "server-only";
import { prisma } from "@artlio/db";
import { newId, storageKey, storageKeyToSrc } from "@artlio/core";
import { FOUNDER_OWNER_ID } from "./storage";

const THUMB_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
/** Resolve generation ids → { src, kind } thumbnails (segment frame slots). */
export async function getGenerationThumbs(ids: string[]): Promise<Record<string, { src: string; kind: "image" | "video" }>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const gens = await prisma.generation.findMany({ where: { id: { in: clean }, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, include: { asset: true } });
  const out: Record<string, { src: string; kind: "image" | "video" }> = {};
  for (const g of gens) {
    const ext = g.asset.ext.toLowerCase();
    out[g.id] = { src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)), kind: THUMB_VIDEO_EXTS.has(ext) ? "video" : "image" };
  }
  return out;
}

/** All M0 queries are owner-scoped and exclude soft-deleted rows (D21). */
const notDeleted = { deletedAt: null } as const;

export async function ensureDefaultProject() {
  const existing = await prisma.project.findFirst({
    where: { ownerId: FOUNDER_OWNER_ID, ...notDeleted },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.project.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, name: "My First Project" },
  });
}

export async function getProjects() {
  return prisma.project.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, ...notDeleted },
    orderBy: { createdAt: "asc" },
  });
}

export async function getEntities() {
  return prisma.entity.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, ...notDeleted },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      // base-level refs only (variantId null) — variant refs live under `variants`
      referenceImages: {
        where: { ...notDeleted, variantId: null },
        orderBy: { position: "asc" },
        include: { asset: true },
      },
      variants: {
        where: notDeleted,
        orderBy: { createdAt: "asc" },
        include: {
          referenceImages: { where: notDeleted, orderBy: { position: "asc" }, include: { asset: true } },
        },
      },
      _count: { select: { shotRefs: true } },
    },
  });
}

export async function getShots(projectId: string) {
  return prisma.shot.findMany({
    where: { projectId, ...notDeleted },
    orderBy: [{ scene: "asc" }, { number: "asc" }],
    include: {
      entityRefs: { include: { entity: true } },
      generations: {
        where: notDeleted,
        orderBy: { version: "desc" },
        include: { asset: true },
      },
    },
  });
}

/** Candidate zone = generations not yet attached to a shot (design doc: shotId IS NULL). */
export async function getCandidates(projectId: string) {
  return prisma.generation.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, projectId, shotId: null, ...notDeleted },
    orderBy: { createdAt: "desc" },
    include: { asset: true },
  });
}

/** All generated media in a project (attached + candidates) for the Assets
 *  library — each row carries its asset and, if attached, its shot. */
export async function getProjectMedia(projectId: string) {
  return prisma.generation.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, projectId, ...notDeleted },
    orderBy: { createdAt: "desc" },
    include: { asset: true }, // the Assets DTO derives `attached` from the scalar shotId
  });
}

export type EntityWithRefs = Awaited<ReturnType<typeof getEntities>>[number];
export type ShotWithDetail = Awaited<ReturnType<typeof getShots>>[number];
export type CandidateGen = Awaited<ReturnType<typeof getCandidates>>[number];
export type ProjectMedia = Awaited<ReturnType<typeof getProjectMedia>>[number];
