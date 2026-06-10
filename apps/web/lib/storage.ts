import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { storageKey, parseStorageKey, FOUNDER_OWNER_ID } from "@artlio/core";

/**
 * Storage port (design doc D8/D14). Two adapters share the exact key scheme
 * u/<owner>/<sha256>.<ext>:
 *   - LocalDiskStorage (dev, below) → .data/storage/ at repo root
 *   - R2Storage (T4) → presigned multipart, same keys, config-only swap
 * The DB never stores locations; keys are always derived from content hashes.
 */
export interface Storage {
  /** Content-addressed write. Returns the hash + derived key (dedup by content). */
  put(ownerId: string, bytes: Uint8Array, ext: string): Promise<{ contentHash: string; key: string }>;
  get(key: string): Promise<Uint8Array>;
  /** Browser-reachable URL for <img>/<video>. Local: served by /files route. */
  url(key: string): string;
}

const LOCAL_ROOT = path.join(process.cwd(), "..", "..", ".data", "storage");

class LocalDiskStorage implements Storage {
  async put(ownerId: string, bytes: Uint8Array, ext: string) {
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const key = storageKey(ownerId, contentHash, ext);
    const file = path.join(LOCAL_ROOT, key);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await access(file); // dedup: same content already stored
    } catch {
      await writeFile(file, bytes);
    }
    return { contentHash, key };
  }

  async get(key: string): Promise<Uint8Array> {
    parseStorageKey(key); // validates shape — no path traversal possible
    return readFile(path.join(LOCAL_ROOT, key));
  }

  url(key: string): string {
    return `/files/${key}`;
  }
}

export const storage: Storage = new LocalDiskStorage();
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

export function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", avif: "image/avif", mp4: "video/mp4", mov: "video/quicktime",
    webm: "video/webm", mkv: "video/x-matroska",
  };
  return map[ext] ?? "application/octet-stream";
}
