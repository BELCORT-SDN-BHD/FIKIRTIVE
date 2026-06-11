import path from "node:path";
import { createStorage } from "@artlio/storage";

/** Worker's storage handle — same env-driven factory as the web side.
 *  Local dev: cwd = apps/worker → repo/.data (matches apps/web). */
const LOCAL_ROOT =
  process.env.ARTLIO_DATA_DIR ?? path.join(process.cwd(), "..", "..", ".data", "storage");

export const storage = createStorage(LOCAL_ROOT);
