import "server-only";
import { prisma } from "@artlio/db";
import { newId } from "@artlio/core";
import { FOUNDER_OWNER_ID } from "./storage";

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
      referenceImages: {
        where: notDeleted,
        orderBy: { position: "asc" },
        include: { asset: true },
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
    include: { asset: true, shot: { select: { id: true, number: true, scene: true } } },
  });
}

export type EntityWithRefs = Awaited<ReturnType<typeof getEntities>>[number];
export type ShotWithDetail = Awaited<ReturnType<typeof getShots>>[number];
export type CandidateGen = Awaited<ReturnType<typeof getCandidates>>[number];
export type ProjectMedia = Awaited<ReturnType<typeof getProjectMedia>>[number];
