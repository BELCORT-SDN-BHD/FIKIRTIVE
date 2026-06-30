import type { ConnectionStatus } from "./types";
import { getMetaConnection } from "../meta-actions";

// NOTE: metaStatus() intentionally ignores any per-call ownerId argument because
// the Meta connection is org-scoped and the request context (via requireOwner()
// inside getMetaConnection) already resolves the owner. A FUTURE multi-connection
// or non-Meta platform adapter MUST use its ownerId argument instead of copying
// this shortcut.
export async function metaStatus(): Promise<ConnectionStatus> {
  const c = await getMetaConnection();
  if ("error" in c || !c.connected) return "not_connected";
  return c.needsReconnect || c.status === "expired" ? "needs_reconnect" : "connected";
}

export const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };
