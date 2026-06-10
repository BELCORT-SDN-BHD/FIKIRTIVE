import { ulid } from "ulidx";

/** ULID primary keys: sortable by creation time, safe in URLs (design doc D14). */
export function newId(): string {
  return ulid();
}
