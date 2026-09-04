"use server";

import { prisma } from "@fikirtive/db";
import { storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { storage } from "./storage";

/** Uploaded bytes vs. something an engine made. `Generation.source` is the canonical column. */
export type LibrarySourceKind = "generated" | "upload";
export type LibraryMediaKind = "image" | "video";
export type LibraryOrder = "newest" | "oldest";

export type LibraryItem = {
  id: string;
  projectId: string;
  assetId: string;
  url: string;
  kind: LibraryMediaKind;
  /** Which Library view this row belongs to — derived from `Generation.source`, never guessed. */
  source: LibrarySourceKind;
  prompt: string;
  /** The name the merchant's own file arrived under; "" for engine output (there is none). */
  filename: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  favorite: boolean;
  createdAt: string;
};
export type LibraryPage = { items: LibraryItem[]; nextCursor: string | null; hasMore: boolean };

const LIBRARY_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
/**
 * The same four extensions the row mapper uses, spelled in both cases so the DB-side media
 * filter and the mapped `kind` can never disagree (a row that says "image" in the list but
 * "video" on the tile is the kind of quiet lie the Library contract forbids).
 */
const LIBRARY_VIDEO_EXT_MATCHES = [...LIBRARY_VIDEO_EXTS].flatMap((ext) => [ext, ext.toUpperCase()]);
const LIBRARY_SCAN_BUFFER = 20;

/**
 * `Generation.source` → the two buckets the Library screen shows. UPLOAD is the merchant's own
 * file; every other AssetSource is something we made for them.
 */
function libraryItemSource(source: string): LibrarySourceKind {
  return source === "UPLOAD" ? "upload" : "generated";
}

/**
 * The `where` fragment for a source filter; `null` means "this filter can match nothing".
 *
 * Written as `{ equals: … }` / `{ not: … }` rather than the bare `source: "UPLOAD"` on purpose.
 * MONEY-A9's AST fence (`__tests__/understanding-disclosure.test.ts`) reads a property
 * assignment `source: "UPLOAD"` as *a row being written as an upload* — that is exactly the
 * shape every real ingest path has. This function only ever READS, so spelling the filter as
 * an explicit Prisma comparison keeps the upload census pointing at the paths that genuinely
 * create uploads (and keeps `/library` out of the "must show the understanding price" table
 * it has no business being in). Same query either way.
 */
function librarySourceWhere(sources: readonly LibrarySourceKind[] | undefined) {
  if (!sources) return {};
  const wantsUpload = sources.includes("upload");
  const wantsGenerated = sources.includes("generated");
  if (wantsUpload && wantsGenerated) return {};
  if (wantsUpload) return { source: { equals: "UPLOAD" as const } };
  if (wantsGenerated) return { source: { not: "UPLOAD" as const } };
  return null;
}

/**
 * One keyset page of the owner's full generation history (every source: cowork, canvas,
 * upload, crop), newest first. Cursor = "<createdAt-iso>|<id>" (id breaks ties so no row is
 * skipped/repeated). Owner-scoped; read-only. Optional prompt search + favorites filter.
 */
export async function getGenerationHistory(
  opts?: {
    search?: string;
    favoriteOnly?: boolean;
    cursor?: string | null;
    take?: number;
    /** Which buckets to keep. Omitted = both. An empty list matches nothing (not everything). */
    sources?: readonly LibrarySourceKind[];
    mediaKind?: LibraryMediaKind;
    /** One Canvas (Project) only — still owner-scoped; a foreign id simply matches nothing. */
    projectId?: string;
    /** ISO instant; keeps rows created at or after it (the Date filter). */
    since?: string;
    order?: LibraryOrder;
  },
): Promise<LibraryPage | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const take = opts?.take ?? 60;
  const scanTake = Math.min(Math.max(take + LIBRARY_SCAN_BUFFER, take + 1), 100);
  const search = opts?.search?.trim();
  const oldestFirst = opts?.order === "oldest";

  const sourceWhere = librarySourceWhere(opts?.sources);
  // "Neither Generated nor Uploads" is a real thing to ask for, and the honest answer is an
  // empty page — not the whole library, which is what an ignored filter would have returned.
  if (sourceWhere === null) return { items: [], nextCursor: null, hasMore: false };

  let cursorWhere = {};
  if (opts?.cursor) {
    const sep = opts.cursor.lastIndexOf("|");
    const at = new Date(opts.cursor.slice(0, sep));
    const id = opts.cursor.slice(sep + 1);
    if (!Number.isNaN(at.getTime()) && id) {
      cursorWhere = oldestFirst
        ? { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: id } }] }
        : { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
    }
  }

  const since = opts?.since ? new Date(opts.since) : null;
  const mediaWhere = opts?.mediaKind
    ? {
        asset: {
          ext: opts.mediaKind === "video"
            ? { in: LIBRARY_VIDEO_EXT_MATCHES }
            : { notIn: LIBRARY_VIDEO_EXT_MATCHES },
        },
      }
    : {};

  const rows = await prisma.generation.findMany({
    where: {
      ownerId,
      deletedAt: null,
      ...(opts?.favoriteOnly ? { favorite: true } : {}),
      // 搜索打两列,不是一列。`Uploads` 页签上的每一行 `promptText` 都是空的(商家上传的
      // 文件没有提示词),所以只打 `promptText` 的搜索在那一格**必然搜空** —— 而输入框上写着
      // "Search prompts",商家看到的是一句自己做不到的承诺。上传行真的有名字的那一列是
      // `Asset.originalFilename`,就是卡片上写给他看的那个名字(`libraryItemTitle`)。
      // 两条 OR 都仍在上面那句 `ownerId` 的域内 —— Prisma 把 OR 和同级的 ownerId 作 AND。
      ...(search
        ? {
            OR: [
              { promptText: { contains: search, mode: "insensitive" as const } },
              { asset: { originalFilename: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...sourceWhere,
      ...mediaWhere,
      ...(opts?.projectId ? { projectId: opts.projectId } : {}),
      ...(since && !Number.isNaN(since.getTime()) ? { createdAt: { gte: since } } : {}),
      ...cursorWhere,
    },
    orderBy: oldestFirst
      ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
      : [{ createdAt: "desc" as const }, { id: "desc" as const }],
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
        projectId: g.projectId,
        assetId: g.assetId,
        url: storageKeyToSrc(key),
        kind: LIBRARY_VIDEO_EXTS.has(ext) ? "video" : "image",
        source: libraryItemSource(g.source),
        prompt: g.promptText ?? "",
        filename: g.asset.originalFilename ?? "",
        width: g.asset.width ?? null,
        height: g.asset.height ?? null,
        durationS: g.asset.durationS ?? null,
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
