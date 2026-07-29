import type { ConnectionStatus } from "./types";
import { getMetaConnection, type MetaConnectionResult } from "../meta-actions";

// Instagram and Facebook connect through the ONE Meta connection — same token, same
// status. Anywhere that needs to know "is this channel id backed by the Meta
// connection" reads this set, so it can't drift from the adapters registered below
// (#518 rework finding 2).
export const META_BACKED_CHANNEL_IDS = new Set(["instagram", "facebook"]);

// Pure mapping from a single getMetaConnection() read to the channel-row status —
// the ONLY place this logic lives, so a caller holding one already-fetched
// MetaConnectionResult (account-view-data.ts) derives the identical status a fresh
// metaStatus() call would, without spending a second Meta read to get it.
export function metaConnectionToStatus(c: MetaConnectionResult): ConnectionStatus {
  if ("error" in c || !c.connected) return "not_connected";
  return c.needsReconnect || c.status === "expired" ? "needs_reconnect" : "connected";
}

// NOTE: metaStatus() intentionally ignores any per-call ownerId argument because
// the Meta connection is org-scoped and the request context (via requireOwner()
// inside getMetaConnection) already resolves the owner. A FUTURE multi-connection
// or non-Meta platform adapter MUST use its ownerId argument instead of copying
// this shortcut.
export async function metaStatus(): Promise<ConnectionStatus> {
  return metaConnectionToStatus(await getMetaConnection());
}

export const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };
