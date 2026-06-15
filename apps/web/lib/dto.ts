import "server-only";
import { storageKey } from "@artlio/core";
import { storage, kindOf } from "./storage";
import type { EntityWithRefs } from "./data";
import type { EntityDTO } from "./types";

export function assetUrl(ownerId: string, contentHash: string, ext: string) {
  return storage.url(storageKey(ownerId, contentHash, ext));
}

/** Shared Entity → DTO mapping (workbench + library render the same store). */
export function toEntityDTO(e: EntityWithRefs): EntityDTO {
  return {
    id: e.id,
    type: e.type,
    name: e.name,
    aliases: e.aliases,
    notes: e.notes,
    negativeConstraints: e.negativeConstraints,
    refs: e.referenceImages.map((r) => ({
      id: r.id,
      assetId: r.assetId,
      url: assetUrl(r.asset.ownerId, r.asset.contentHash, r.asset.ext),
      kind: kindOf(r.asset.ext),
    })),
    baseAssetId: e.baseAssetId,
    usageCount: e._count.shotRefs,
  };
}
