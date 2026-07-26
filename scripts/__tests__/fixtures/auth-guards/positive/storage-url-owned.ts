// Positive class: pure URL formatting is safe through the exact canonical storage-key builder.

import { storageKey } from "@fikirtive/core";
import { storage } from "../support/storage";

export function ownerStorageUrl(
  ownerId: string,
  contentHash: string,
  ext: string,
) {
  return storage.url(storageKey(ownerId, contentHash, ext));
}
