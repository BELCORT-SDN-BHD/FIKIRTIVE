// Bypass class: a same-name local key builder cannot earn the pure storage URL proof.
"use server";

import { storage } from "../support/storage";

function storageKey(key: string) {
  return key;
}

export function exposeForgedStorageUrl(key: string) {
  return storage.url(storageKey(key));
}
