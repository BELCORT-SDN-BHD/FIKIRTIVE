/** Pure classifier for the unified Library (spec R3). No IO. */
import type { EntityDTO } from "./types";
import type { HistoryThumb } from "./data";
import type { AdTile } from "@/components/otto/OttoStuff";
import type { BrandRecordRow } from "./brand-record-actions";

export type StuffFilter = "all" | "images" | "videos" | "cast" | "products" | "ads";

export type StuffItem = {
  id: string;
  source: "entity" | "gen" | "ad";
  label: string;
  url: string | null;
  mediaKind: "image" | "video" | "other";
  entityId?: string;
  entityType?: EntityDTO["type"];
  generationId?: string;
  projectId?: string;
  assetId?: string;
  productName?: string;
};

/**
 * Is this Library item a generation — something a `Generation.id` can name (#704)?
 *
 * Two of the three sources are: `gen` (Library history) and `ad` (Otto's ad builds) both put a
 * real `Generation.id` in `generationId`, so anything keyed by generation id — the schedule's
 * thumbnail lookup, a post's stored media rows — has to accept both. `entity` is a saved
 * reference, not a generation, and carries no generation id: it stays out.
 *
 * Named here, beside the `source` union it reads, so a fourth source has to face this question
 * instead of silently joining (or silently missing, which is how ad media lost its thumbnail).
 */
export function isGenerationBackedItem(item: StuffItem): item is StuffItem & { generationId: string } {
  return (item.source === "gen" || item.source === "ad") && !!item.generationId;
}

export function productImageIndex(records: BrandRecordRow[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "product" || r.status !== "active") continue;
    const d = r.data as { name?: unknown; imageAssetId?: unknown };
    if (typeof d.imageAssetId === "string" && d.imageAssetId && typeof d.name === "string") {
      idx.set(d.imageAssetId, d.name);
    }
  }
  return idx;
}

export function buildStuffItems(args: {
  entities: EntityDTO[];
  history: HistoryThumb[];
  ads: AdTile[];
  records: BrandRecordRow[];
}): StuffItem[] {
  const pidx = productImageIndex(args.records);
  const items: StuffItem[] = [];
  for (const e of args.entities) {
    const base = e.refs.find((r) => r.assetId === e.baseAssetId) ?? e.refs[0];
    items.push({
      id: `entity:${e.id}`,
      source: "entity",
      label: e.name,
      url: base?.url ?? null,
      mediaKind: base ? base.kind : "other",
      entityId: e.id,
      entityType: e.type,
      ...(base ? { assetId: base.assetId } : {}),
      ...(base && pidx.has(base.assetId) ? { productName: pidx.get(base.assetId) } : {}),
    });
  }
  for (const h of args.history) {
    items.push({
      id: `gen:${h.id}`,
      source: "gen",
      label: h.prompt || h.id,
      url: h.src,
      mediaKind: h.kind,
      generationId: h.id,
      projectId: h.projectId,
      assetId: h.assetId,
    });
  }
  for (const a of args.ads) {
    items.push({
      id: `ad:${a.id}`,
      source: "ad",
      label: a.prompt || a.id,
      url: a.src,
      mediaKind: a.kind,
      generationId: a.id,
      projectId: a.projectId,
      assetId: a.assetId,
    });
  }
  return items;
}

export function filterStuffItems(items: StuffItem[], filter: StuffFilter, search: string): StuffItem[] {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !i.label.toLowerCase().includes(q)) return false;
    switch (filter) {
      case "all": return true;
      case "images": return i.mediaKind === "image";
      case "videos": return i.mediaKind === "video";
      case "cast": return i.entityType === "CHARACTER";
      case "products": return i.entityType === "PRODUCT";
      case "ads": return i.source === "ad";
    }
  });
}
