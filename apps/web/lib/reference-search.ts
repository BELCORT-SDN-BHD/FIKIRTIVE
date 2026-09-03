import "server-only";
import { prisma } from "@fikirtive/db";
import { storageKey, storageKeyToSrc, type ReferenceType } from "@fikirtive/core";
import { storage } from "./storage";
import {
  REFERENCE_PAGE_LIMIT,
  RECENT_REFERENCE_LIMIT,
  dedupeReferenceResults,
  referenceMatchRank,
  referenceSourceLine,
  type ReferenceResult,
  type ReferenceSearchPage,
} from "./reference-search-model";

/**
 * The one reference search — the single server-side query behind every `@` menu.
 *
 * Spec: `docs/specs/frontend-baseline.md` §7.3③ ("一个服务端动作,租户内、按类型过滤、游标分页,
 * 返回类型化 ID … 覆盖 Generation／Asset／Entity 三个源"). Interaction contract:
 * `apps/web/design-system/information-architecture/reference-picker-contract.md`.
 *
 * TENANCY. Every query here is `ownerId`-scoped and skips soft-deleted rows. `ownerId` is a
 * parameter, and its only caller is the server action, which reads it from the authenticated
 * principal — no client-supplied owner can reach this file.
 *
 * WHAT PRODUCTION CAN ANSWER, AND WHAT IT CANNOT:
 *  - `product` / `character` / `official-avatar` / `location` / `brandmark` → `Entity` rows. An
 *    official avatar is an `Entity` whose `catalogKey` is set (the platform actor library,
 *    `docs/specs/creation-engine.md` §8.1③, seeded per org); a merchant's own character has
 *    `catalogKey = null`. That is the whole difference, so the picker can name it honestly
 *    instead of showing a fake `Official avatars` bucket (FRONT-A10).
 *  - `generation` / `upload` → `Generation` rows. An upload is a `Generation` whose `source` is
 *    `UPLOAD` (upload-actions writes one row per uploaded file), and it reports its **Asset** id,
 *    because contract §4 names the Asset as an upload's canonical object — re-uploading the same
 *    bytes reuses one Asset but writes a second `Generation`, so the Asset id is what makes
 *    "同一个底层对象只出现一次" true.
 *  - `clothes` → nothing. Production has no clothes record (the actor library's outfit presets are
 *    not built), so the type is understood and never returned. Registered, not faked.
 */

const MEDIA_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);

/**
 * How many rows one source may contribute to a single ranking pass. The menu shows ~8 rows
 * (contract §2), so this is a wide-enough net to rank honestly while staying a bounded query on a
 * library of any size. Matches past it are reached by typing more, not by scrolling; a full browse
 * is what the paginated Library read model (spec §7.3②) is for.
 */
const SOURCE_SCAN_CAP = 60;

const ENTITY_TYPE_BY_REFERENCE = {
  product: "PRODUCT",
  character: "CHARACTER",
  "official-avatar": "CHARACTER",
  location: "LOCATION",
  brandmark: "BRANDMARK",
} as const satisfies Partial<Record<ReferenceType, string>>;

type EntityBackedType = keyof typeof ENTITY_TYPE_BY_REFERENCE;

export interface ReferenceSearchOptions {
  query: string;
  /** Restrict to these types (the menu's category entries). Empty/undefined = every type. */
  types?: readonly ReferenceType[];
  limit?: number;
  cursor?: string | null;
}

function wants(types: readonly ReferenceType[] | undefined, type: ReferenceType): boolean {
  return !types || types.length === 0 || types.includes(type);
}

/** The cursor is an offset into this query's own deterministic ranking. Opaque to the client. */
function parseCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A ranked row plus the two fields only the merge step needs. */
type Ranked = ReferenceResult & { rank: number; recency: number; thumbKey: string | null };

/** A storage key only when the asset is a still — a video file is not a thumbnail. */
function thumbKeyFor(asset: { ownerId: string; contentHash: string; ext: string }): string | null {
  const ext = asset.ext.toLowerCase();
  if (MEDIA_VIDEO_EXTS.has(ext)) return null;
  try {
    return storageKey(asset.ownerId, asset.contentHash, ext);
  } catch {
    // storageKey validates hash/ext/owner shape and throws on a malformed row. A reference with an
    // unreadable key is still a real, selectable object — it just has no picture.
    return null;
  }
}

async function entityRows(ownerId: string, options: ReferenceSearchOptions): Promise<Ranked[]> {
  const asked = (Object.keys(ENTITY_TYPE_BY_REFERENCE) as EntityBackedType[]).filter((type) =>
    wants(options.types, type),
  );
  if (asked.length === 0) return [];
  const entityTypes = [...new Set(asked.map((type) => ENTITY_TYPE_BY_REFERENCE[type]))];

  const query = options.query.trim();
  const rows = await prisma.entity.findMany({
    where: {
      ownerId,
      deletedAt: null,
      type: { in: entityTypes },
      ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: SOURCE_SCAN_CAP,
    select: {
      id: true,
      name: true,
      type: true,
      catalogKey: true,
      baseAssetId: true,
      updatedAt: true,
      referenceImages: {
        where: { deletedAt: null, variantId: null },
        orderBy: { position: "asc" },
        select: { asset: { select: { id: true, ownerId: true, contentHash: true, ext: true } } },
      },
    },
  });

  const out: Ranked[] = [];
  for (const row of rows) {
    const type: ReferenceType =
      row.type === "PRODUCT"
        ? "product"
        : row.type === "LOCATION"
          ? "location"
          : row.type === "BRANDMARK"
            ? "brandmark"
            : row.catalogKey
              ? "official-avatar"
              : "character";
    // an official avatar and a merchant's own character are both CHARACTER rows, so the DB filter
    // above cannot separate them — drop the half the caller did not ask for here
    if (!wants(options.types, type)) continue;
    const rank = referenceMatchRank(row.name, query);
    if (rank === null) continue;
    const assets = row.referenceImages.map((ref) => ref.asset);
    const base = assets.find((asset) => asset.id === row.baseAssetId) ?? assets[0];
    out.push({
      type,
      id: row.id,
      name: row.name,
      source: referenceSourceLine(type),
      thumbUrl: null,
      thumbKey: base ? thumbKeyFor(base) : null,
      rank,
      recency: row.updatedAt.getTime(),
    });
  }
  return out;
}

/** A generation has no title of its own — the prompt is what a merchant would recognise it by. */
function generationName(promptText: string, filename: string): string {
  const prompt = promptText.replace(/\s+/g, " ").trim();
  if (prompt) return prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt;
  return filename.trim() || "Untitled";
}

async function mediaRows(ownerId: string, options: ReferenceSearchOptions): Promise<Ranked[]> {
  const wantsGeneration = wants(options.types, "generation");
  const wantsUpload = wants(options.types, "upload");
  if (!wantsGeneration && !wantsUpload) return [];

  const query = options.query.trim();
  const rows = await prisma.generation.findMany({
    where: {
      ownerId,
      deletedAt: null,
      ...(wantsGeneration && wantsUpload
        ? {}
        : { source: wantsUpload ? ("UPLOAD" as const) : { not: "UPLOAD" as const } }),
      ...(query
        ? {
            OR: [
              { promptText: { contains: query, mode: "insensitive" as const } },
              { asset: { originalFilename: { contains: query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SOURCE_SCAN_CAP,
    select: {
      id: true,
      source: true,
      promptText: true,
      createdAt: true,
      project: { select: { name: true } },
      asset: {
        select: { id: true, ownerId: true, contentHash: true, ext: true, originalFilename: true },
      },
    },
  });

  const out: Ranked[] = [];
  for (const row of rows) {
    const isUpload = row.source === "UPLOAD";
    const type: ReferenceType = isUpload ? "upload" : "generation";
    const name = isUpload
      ? row.asset.originalFilename.trim() || generationName(row.promptText, "")
      : generationName(row.promptText, row.asset.originalFilename);
    const rank = referenceMatchRank(name, query);
    if (rank === null) continue;
    out.push({
      type,
      // contract §4: an upload's canonical object is its Asset, a generation's is the Generation
      id: isUpload ? row.asset.id : row.id,
      name,
      source: referenceSourceLine(type, isUpload ? null : row.project.name),
      thumbUrl: null,
      thumbKey: thumbKeyFor(row.asset),
      rank,
      recency: row.createdAt.getTime(),
    });
  }
  return out;
}

/**
 * Resolve the display URLs of the rows that survived, and only those: it is one storage `exists`
 * per visible row — the same check `getGenerationThumbs` makes — so the menu never draws a broken
 * picture for bytes the store no longer has.
 */
async function withThumbs(rows: Ranked[]): Promise<ReferenceResult[]> {
  return Promise.all(
    rows.map(async (row) => {
      const item: ReferenceResult = {
        type: row.type,
        id: row.id,
        name: row.name,
        source: row.source,
        thumbUrl: null,
      };
      if (!row.thumbKey) return item;
      const present = await storage.exists(row.thumbKey).catch(() => false);
      return present ? { ...item, thumbUrl: storageKeyToSrc(row.thumbKey) } : item;
    }),
  );
}

/**
 * One ranked, tenant-scoped, deduplicated page across all three sources.
 *
 * Ordering is rank (how well the name answers the query) first, then recency, then id — contract
 * §2 minus its "current Canvas relevance" term, which has no production signal and is registered
 * rather than guessed. The id tiebreak is what makes paging stable: two rows created in the same
 * millisecond must not swap places between page 1 and page 2.
 */
export async function searchReferences(
  ownerId: string,
  options: ReferenceSearchOptions,
): Promise<ReferenceSearchPage> {
  const limit = Math.min(Math.max(options.limit ?? REFERENCE_PAGE_LIMIT, 1), REFERENCE_PAGE_LIMIT * 4);
  const offset = parseCursor(options.cursor);

  const [entities, media] = await Promise.all([
    entityRows(ownerId, options),
    mediaRows(ownerId, options),
  ]);

  const ranked = [...entities, ...media].sort(
    (a, b) => a.rank - b.rank || b.recency - a.recency || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  // dedupe before slicing, or a duplicate would silently shorten a page
  const unique = dedupeReferenceResults(ranked);
  const page = unique.slice(offset, offset + limit);
  return {
    items: await withThumbs(page),
    nextCursor: unique.length > offset + limit ? String(offset + limit) : null,
  };
}

/**
 * Bare `@` — the most recent references this workspace has (contract §2, at most 5).
 *
 * Honest naming caveat: "recent" is the recency of the object itself (an entity's `updatedAt`, a
 * generation's `createdAt`), not "recently referenced in a message". Production keeps no
 * per-reference usage log, and inventing an ordering would be worse than a truthful one.
 * Registered for the slice that persists reference ids on the message.
 */
export async function recentReferences(
  ownerId: string,
  types?: readonly ReferenceType[],
): Promise<ReferenceResult[]> {
  const page = await searchReferences(ownerId, { query: "", types, limit: RECENT_REFERENCE_LIMIT });
  return page.items;
}
