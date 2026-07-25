// Bypass class: an unguarded object-storage export must not disappear from coverage.
"use server";

import { storage } from "../support/storage";

export async function leak(key: string) {
  return storage.get(key);
}
