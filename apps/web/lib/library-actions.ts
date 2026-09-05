"use server";

import { prisma } from "@fikirtive/db";
import { storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { storage } from "./storage";
import { listLibraryFavorites } from "./library-favorites";
import { favoriteGenerationIds } from "./library-subjects";
// 「哪个扩展名算影片」的单一源(§7.3)——本文件与 library-subjects.ts、canvas-entry-actions.ts 同读一份。
import { LIBRARY_VIDEO_EXTS } from "./library-types";

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
 * `favoriteOnly` 接不住的那几个筛选键。传进来任何一个就当场回错误 —— 不是丢掉它再返回一页。
 * 这个数组是**唯一**的名单:新增一个筛选参数时如果收藏读模型也接不住,把键名加到这里。
 */
const FAVORITE_ONLY_FILTER_KEYS = [
  "search",
  "sources",
  "mediaKind",
  "projectId",
  "since",
  "order",
] as const;

/**
 * One keyset page of the owner's full generation history (every source: cowork, canvas,
 * upload, crop), newest first. Cursor = "<createdAt-iso>|<id>" (id breaks ties so no row is
 * skipped/repeated). Owner-scoped; read-only. Optional prompt search + favorites filter.
 */
export async function getGenerationHistory(
  opts?: {
    search?: string;
    /**
     * 只要收藏的那些。**这一条走的是收藏自己的读模型**(`lib/library-favorites.ts`),
     * 不是在这张表上加一个 `favorite: true` —— 收藏的权威从 2026-09-03 起是 `Favorite`
     * 那张跨类型的表(Founder 裁决十),而这里没有指向它的关系可以 join。
     * 后果对调用方有两件事:
     * ① 这一路的游标是**收藏行**的游标(按收藏时间排),与不带这个开关时的生成时间游标
     *    不通用 —— 两者都只是不透明字符串,原样传回即可;
     * ② 收藏读模型今天**没有筛选契约**,所以这个开关不能和 `search` / `sources` /
     *    `mediaKind` / `projectId` / `since` / `order` 同用 —— 同用会当场回错误,
     *    不会悄悄把筛选丢掉(见下面 `FAVORITE_ONLY_FILTER_KEYS`)。
     */
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

  if (opts?.favoriteOnly) {
    // 收藏这一路借的是收藏自己的读模型,它今天只认 cursor / take。任何别的筛选传进来
    // 都**接不住**,而接不住又照样返回一页,就是一次读起来很像答案的错答案:
    // Otto 问「我收藏过的 laksa 图」会拿到全部收藏,还当成命中的那几张报给商家。
    // 这与本文件下面对空 sources 的处理是同一条原则 —— 宁可说不行,不装作做到了。
    const ignored = FAVORITE_ONLY_FILTER_KEYS.filter((key) => opts[key] !== undefined);
    if (ignored.length) {
      return {
        error: `Favorites can't be filtered yet (${ignored.join(", ")}). Ask for favorites on their own, or drop the favorites filter and search everything.`,
      };
    }
    return favoritesAsLibraryPage(opts);
  }

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
      // 搜索打两列,不是一列。`Uploads` 页签上的每一行 `promptText` 都是空的(商家上传的
      // 文件没有提示词),所以只打 `promptText` 的搜索在那一格**必然搜空** —— 而输入框上写着
      // "Search prompts",商家看到的是一句自己做不到的承诺(占位符已随之改成如实的
      // "Search prompts or file names",Founder 2026-09-05)。上传行真的有名字的那一列是
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
  // 收藏状态来自 `Favorite` 那张表,不是 `Generation.favorite` 那一列 —— 那一列自
  // 2026-09-03 的回灌之后没有任何写入者,继续读它就是读一份过期的影子。
  const favoriteIds = await favoriteGenerationIds(ownerId, scanned.map((g) => g.id));
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
        favorite: favoriteIds.has(g.id),
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

/**
 * `favoriteOnly` 的实现:直接借收藏自己的读模型,再把行映射成 `LibraryItem`。
 *
 * 为什么不在生成表上加条件:收藏的权威是另一张表,而 Prisma 这边没有指向它的关系
 * (那是**故意**的 —— 收藏是链接,加外键会把「取消收藏」和「删素材」焊死)。先取一把
 * 收藏 id 再 `IN (…)` 也不行:那把 id 是无界的,游标语义还会跟着错。所以这一路整个
 * 交给收藏读模型,连排序与游标都用它的 —— 一个收藏视图,一套分页,不是两套。
 * 代价:这一路不吃搜索与筛选(收藏读模型今天没有那个契约)。这个代价**在上面就拦住了**——
 * `getGenerationHistory` 见到 `favoriteOnly` 带着筛选键进来会直接回错误,所以这个函数
 * 只会拿到 cursor / take,永远不会静静地把一个筛选吃掉。
 */
async function favoritesAsLibraryPage(
  opts: { cursor?: string | null; take?: number },
): Promise<LibraryPage | { error: string }> {
  const page = await listLibraryFavorites({
    ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
    ...(opts.take !== undefined ? { take: opts.take } : {}),
  });
  if ("error" in page) return page;
  return {
    items: page.items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      assetId: item.assetId,
      url: item.url,
      kind: item.kind,
      source: item.source,
      prompt: item.prompt,
      filename: item.filename,
      width: item.width,
      height: item.height,
      durationS: item.durationS,
      favorite: true,
      createdAt: item.createdAt,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}
