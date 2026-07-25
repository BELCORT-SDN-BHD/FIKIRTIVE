// Bypass class: URL formatting is not globally exempt when the key has no owner proof.
"use server";

import { storage } from "../support/storage";

export function exposeClientStorageUrl(key: string) {
  return storage.url(key);
}
