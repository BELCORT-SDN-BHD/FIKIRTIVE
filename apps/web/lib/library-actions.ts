"use server";

import { prisma } from "@fikirtive/db";
import { storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { storage } from "./storage";

export type LibraryItem = {
  id: string;
  url: string;
  kind: "image" | "video";
  prompt: string;
  favorite: boolean;
  createdAt: string;
};
export type LibraryPage = { items: LibraryItem[]; nextCursor: string | null; hasMore: boolean };

const LIBRARY_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const LIBRARY_SCAN_BUFFER = 20;

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

/**
 * One keyset page of a project's full generation history (every source: cowork, canvas,
 * upload, crop), newest first. Cursor = "<createdAt-iso>|<id>" (id breaks ties so no row is
 * skipped/repeated). Owner+project scoped; read-only. Optional prompt search + favorites filter.
 */
export async function getGenerationHistory(
  projectId: string,
  opts?: { search?: string; favoriteOnly?: boolean; cursor?: string | null; take?: number },
): Promise<LibraryPage | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  if (!(await ownedProject(projectId, ownerId))) return { error: "Project not found." };

  const take = opts?.take ?? 60;
  const scanTake = Math.min(Math.max(take + LIBRARY_SCAN_BUFFER, take + 1), 100);
  const search = opts?.search?.trim();

  let cursorWhere = {};
  if (opts?.cursor) {
    const sep = opts.cursor.lastIndexOf("|");
    const at = new Date(opts.cursor.slice(0, sep));
    const id = opts.cursor.slice(sep + 1);
    if (!Number.isNaN(at.getTime()) && id) {
      cursorWhere = { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
    }
  }

  const rows = await prisma.generation.findMany({
    where: {
      ownerId,
      projectId,
      deletedAt: null,
      ...(opts?.favoriteOnly ? { favorite: true } : {}),
      ...(search ? { promptText: { contains: search, mode: "insensitive" as const } } : {}),
      ...cursorWhere,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scanTake + 1,
    include: { asset: true },
  });

  const scanned = rows.slice(0, scanTake);
  const resolved = await Promise.all(scanned.map(async (g) => {
    const ext = g.asset.ext.toLowerCase();
    const key = storageKey(g.asset.ownerId, g.asset.contentHash, ext);
    if (!(await storage.exists(key))) return null;
    return {
      row: g,
      item: {
        id: g.id,
        url: storageKeyToSrc(key),
        kind: LIBRARY_VIDEO_EXTS.has(ext) ? "video" : "image",
        prompt: g.promptText ?? "",
        favorite: g.favorite,
        createdAt: g.createdAt.toISOString(),
      } satisfies LibraryItem,
    };
  }));
  const existing = resolved.filter((entry): entry is NonNullable<typeof entry> => entry != null);
  const items = existing.slice(0, take).map((entry) => entry.item);
  const cursorRow = existing.length > take
    ? existing[take - 1].row
    : rows.length > scanTake
      ? scanned[scanned.length - 1]
      : null;
  const nextCursor = cursorRow ? `${cursorRow.createdAt.toISOString()}|${cursorRow.id}` : null;
  return { items, nextCursor, hasMore: nextCursor != null };
}
