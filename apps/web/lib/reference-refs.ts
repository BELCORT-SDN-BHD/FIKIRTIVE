import "server-only";
import { prisma } from "@fikirtive/db";
import {
  entityOrigin,
  formatReferenceRef,
  MAX_TURN_REFERENCES,
  parseReferenceRef,
  parseReferenceRefs,
  type ReferenceRef,
  type ReferenceType,
} from "@fikirtive/core";
import { libraryElementKind } from "./library-elements-model";
import { referenceSourceLine, type ReferenceLink } from "./reference-search-model";

/**
 * The typed references a chat turn carries — resolved against ONE owner, both on the way in and on
 * the way out.
 *
 * Spec: `docs/specs/frontend-baseline.md` §7.3③ slice ③ ("消息落引用 ID 与回链"), acceptance
 * FRONT-A10 ("消息记录保存该对象的真实 ID,可回链").
 *
 * WHY THIS FILE EXISTS AT ALL. Until now a turn carried `payload.entityIds` — bare strings the
 * client chose. Two consequences, both closed here:
 *  1. A bare id cannot say which table it belongs to, so nothing could link a sent message back to
 *     the object it named. `ReferenceRef` ({type, id}) can.
 *  2. Nothing checked, at write time, that those ids were this merchant's (judge P2-1, registered
 *     in spec §5 on 2026-09-05: "收口的正位在第③刀…落库前按 owner 核一遍"). The two known read
 *     paths filtered by owner, so a foreign id fetched nothing — but "reads nothing" is a property
 *     of the readers, re-earned by every future reader. Ownership is checked HERE, once, before
 *     the row is written.
 *
 * TENANCY. `ownerId` is a parameter and every query below is scoped by it; the only callers are
 * server actions and route handlers that read it from the authenticated principal. Nothing in this
 * file accepts an owner from a request body.
 *
 * NON-LEAKAGE. A ref that does not resolve is reported as one number — how many. The caller says
 * "one of these isn't available", the same sentence for a deleted object of your own and for
 * another shop's id, so the answer never doubles as an existence oracle for someone else's data.
 */

/** The types that resolve to an `Entity` row, mapped to the `EntityType` they are stored as. */
const ENTITY_TYPE_BY_REFERENCE = {
  product: "PRODUCT",
  character: "CHARACTER",
  "official-avatar": "CHARACTER",
  location: "LOCATION",
  brandmark: "BRANDMARK",
} as const satisfies Partial<Record<ReferenceType, string>>;

type EntityBackedType = keyof typeof ENTITY_TYPE_BY_REFERENCE;

function isEntityBacked(type: ReferenceType): type is EntityBackedType {
  return type in ENTITY_TYPE_BY_REFERENCE;
}

export interface ResolvedTurnReferences {
  /** Every ref that resolved to a live object owned by this merchant, in the order given. */
  refs: ReferenceRef[];
  /** Wire form of `refs` — what goes into `ChatMessage.referenceRefs`. */
  wire: string[];
  /** Rows the merchant can be shown, with a link back to the object. */
  links: ReferenceLink[];
  /**
   * How many of the submitted refs did NOT resolve: malformed, deleted, or another shop's. One
   * number, never which — see NON-LEAKAGE above.
   */
  unresolved: number;
}

/** Everything a resolved ref renders as. Names come from the DB, never from the client. */
type Resolved = { link: ReferenceLink; ref: ReferenceRef };

/** The Library address that shows this object. */
function entityHref(kind: ReturnType<typeof libraryElementKind>): string {
  // Library has no per-row deep link for an element today (its `?element=` is the COLUMN, not an
  // id) — so the link lands on the column the object lives in rather than pretending to select it.
  // Registered in spec §5; a per-element deep link is the honest next cut.
  return `/library?view=elements&element=${kind ?? "products"}`;
}

/** A generation and an upload both open the Library detail panel, which needs both ids. */
function mediaHref(generationId: string, projectId: string): string {
  return `/library?asset=${encodeURIComponent(generationId)}&project=${encodeURIComponent(projectId)}`;
}

/** A generation has no title of its own — same rule as the search rows (`reference-search.ts`). */
function generationName(promptText: string, filename: string): string {
  const prompt = promptText.replace(/\s+/g, " ").trim();
  if (prompt) return prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt;
  return filename.trim() || "Untitled";
}

async function resolveEntityRefs(ownerId: string, refs: ReferenceRef[]): Promise<Resolved[]> {
  const ids = refs.map((ref) => ref.id);
  if (ids.length === 0) return [];
  const rows = await prisma.entity.findMany({
    where: { id: { in: ids }, ownerId, deletedAt: null },
    select: { id: true, name: true, type: true, catalogKey: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: Resolved[] = [];
  for (const ref of refs) {
    if (!isEntityBacked(ref.type)) continue;
    const row = byId.get(ref.id);
    if (!row) continue;
    // The claimed type must be the row's real type, or a merchant could file their own product
    // under `official-avatar` and read a read-only badge on a row they can still edit. The
    // official/own criterion is `entityOrigin` — the same function the DTO, Library and the search
    // ask — never a second reading of `catalogKey` here.
    if (row.type !== ENTITY_TYPE_BY_REFERENCE[ref.type]) continue;
    if (row.type === "CHARACTER") {
      const official = entityOrigin(row) === "OFFICIAL_CATALOG";
      if (official !== (ref.type === "official-avatar")) continue;
    }
    out.push({
      ref,
      link: {
        type: ref.type,
        id: row.id,
        name: row.name,
        source: referenceSourceLine(ref.type),
        href: entityHref(libraryElementKind(row.type, row.catalogKey)),
      },
    });
  }
  return out;
}

async function resolveMediaRefs(ownerId: string, refs: ReferenceRef[]): Promise<Resolved[]> {
  const generationIds = refs.filter((ref) => ref.type === "generation").map((ref) => ref.id);
  const assetIds = refs.filter((ref) => ref.type === "upload").map((ref) => ref.id);
  if (generationIds.length === 0 && assetIds.length === 0) return [];

  // An upload's canonical object is its Asset (contract §4), but the Library panel opens on a
  // Generation — so an upload ref is resolved through the row that ingested it.
  //
  // Both source filters are spelled in Prisma's explicit operator form (`{ equals }` / `{ not }`)
  // rather than the bare `source: "UPLOAD"` shorthand. That shorthand is the exact shape of a
  // `create({ data: … })` upload WRITE, and the MONEY-A9 disclosure census (`lib/__tests__/
  // understanding-disclosure.test.ts`) reads it as one — which would enrol this read-only module,
  // and every function it exports, into the list of billable upload entry points. The operator
  // form is identical to Prisma and can never be mistaken for a write payload.
  const rows = await prisma.generation.findMany({
    where: {
      ownerId,
      deletedAt: null,
      OR: [
        ...(generationIds.length ? [{ id: { in: generationIds }, source: { not: "UPLOAD" as const } }] : []),
        ...(assetIds.length ? [{ assetId: { in: assetIds }, source: { equals: "UPLOAD" as const } }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      assetId: true,
      source: true,
      promptText: true,
      projectId: true,
      project: { select: { name: true } },
      asset: { select: { originalFilename: true } },
    },
  });
  const generationById = new Map(rows.filter((row) => row.source !== "UPLOAD").map((row) => [row.id, row]));
  const uploadByAssetId = new Map<string, (typeof rows)[number]>();
  // Re-uploading the same bytes reuses one Asset and writes a second Generation; the newest row
  // wins so the link opens the panel the merchant would find in Library.
  for (const row of rows) {
    if (row.source === "UPLOAD" && !uploadByAssetId.has(row.assetId)) uploadByAssetId.set(row.assetId, row);
  }

  const out: Resolved[] = [];
  for (const ref of refs) {
    if (ref.type !== "generation" && ref.type !== "upload") continue;
    const row = ref.type === "generation" ? generationById.get(ref.id) : uploadByAssetId.get(ref.id);
    if (!row) continue;
    const filename = row.asset.originalFilename;
    const name =
      ref.type === "upload"
        ? filename.trim() || generationName(row.promptText, "")
        : generationName(row.promptText, filename);
    out.push({
      ref,
      link: {
        type: ref.type,
        id: ref.id,
        name,
        source: referenceSourceLine(ref.type, ref.type === "upload" ? null : row.project.name),
        href: mediaHref(row.id, row.projectId),
      },
    });
  }
  return out;
}

/**
 * Resolve every typed ref this turn submitted against `ownerId`, keeping only the ones that are a
 * live object of this merchant's.
 *
 * `clothes` never resolves — production has no clothes record at all (`reference-search.ts` says
 * the same), so a `clothes:` ref counts as unresolved rather than being waved through.
 */
export async function resolveOwnedReferenceRefs(
  ownerId: string,
  raw: readonly string[] | null | undefined,
): Promise<ResolvedTurnReferences> {
  const all = raw ?? [];
  const submitted = all.slice(0, MAX_TURN_REFERENCES);
  /**
   * The two ways a submitted entry is lost before a database is even asked. Both count as
   * unresolved: a ref the merchant picked and the server quietly forgot is the "假成功" they
   * cannot see. Duplicates deliberately do NOT count — `parseReferenceRefs` dedupes by identity,
   * and picking the same object twice is one reference, not a failure.
   */
  const malformed = submitted.filter((entry) => parseReferenceRef(entry) === null).length;
  const overflow = all.length - submitted.length;
  const parsed = parseReferenceRefs(submitted);
  if (parsed.length === 0) {
    return { refs: [], wire: [], links: [], unresolved: malformed + overflow };
  }
  const [entities, media] = await Promise.all([
    resolveEntityRefs(ownerId, parsed),
    resolveMediaRefs(ownerId, parsed),
  ]);
  const byKey = new Map<string, Resolved>();
  for (const item of [...entities, ...media]) byKey.set(formatReferenceRef(item.ref), item);

  const refs: ReferenceRef[] = [];
  const links: ReferenceLink[] = [];
  for (const ref of parsed) {
    const hit = byKey.get(formatReferenceRef(ref));
    if (!hit) continue;
    refs.push(hit.ref);
    links.push(hit.link);
  }
  return {
    refs,
    wire: refs.map(formatReferenceRef),
    links,
    unresolved: malformed + overflow + (parsed.length - refs.length),
  };
}

/**
 * The read half: a stored message's refs → rows the merchant can click back to the object.
 *
 * Owner-scoped for the second time on purpose. The write gate is what keeps foreign ids out of the
 * column; this one is what keeps a row that has since been deleted — or a row written before the
 * gate existed — from rendering a link to something that is not there.
 */
export async function resolveReferenceLinks(
  ownerId: string,
  raw: readonly string[] | null | undefined,
): Promise<ReferenceLink[]> {
  if (!raw || raw.length === 0) return [];
  const resolved = await resolveOwnedReferenceRefs(ownerId, raw);
  return resolved.links;
}
