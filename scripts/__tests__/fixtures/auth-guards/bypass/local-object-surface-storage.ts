// Bypass class: a local object surface laundering a storage capability is an unguarded read.
"use server";

import { storage } from "../support/storage";

export async function leakStorageViaLocalObject(key: string) {
  const dispatch = { read: (client: typeof storage, objectKey: string) => client.get(objectKey) };
  return dispatch.read(storage, key);
}
