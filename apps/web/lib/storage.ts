import "server-only";
import path from "node:path";
import { createStorage } from "@artlio/storage";
import { FOUNDER_OWNER_ID } from "@artlio/core";

/**
 * Web's storage handle — driver picked by env (STORAGE_DRIVER=r2 in prod,
 * local disk in dev). Key scheme and semantics live in @artlio/storage.
 */
const LOCAL_ROOT = path.join(process.cwd(), "..", "..", ".data", "storage");

export const storage = createStorage(LOCAL_ROOT);
export { FOUNDER_OWNER_ID };

export function extFromFilename(name: string): string {
  const ext = path.extname(name).replace(".", "").toLowerCase();
  // storageKey() only accepts short alphanumeric extensions — anything odd
  // (uppercase unicode, 'tar.gz' leftovers, 20-char junk) falls back to bin
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

export function kindOf(ext: string): "image" | "video" | "other" {
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "other";
}

export { mimeOf } from "@artlio/storage";
