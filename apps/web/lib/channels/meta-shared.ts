import type { ChannelTargetsResult, ConnectionStatus } from "./types";
import type { fetchOwnerPages } from "../meta-pages";
import { classifyPagesRead, type ConnectionBlocker } from "@fikirtive/core/schedule-draft";
import { getMetaConnection, type MetaConnectionResult } from "../meta-actions";

// Instagram and Facebook connect through the ONE Meta connection — same token, same
// status. Anywhere that needs to know "is this channel id backed by the Meta
// connection" reads this set, so it can't drift from the adapters registered below
// (#518 rework finding 2).
export const META_BACKED_CHANNEL_IDS = ["instagram", "facebook"];

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

/**
 * fetchOwnerPages → the adapter's honest answer. Instagram and Facebook read the SAME pages through
 * the SAME connection, so the mapping lives here once — and the classification itself lives in
 * @fikirtive/core, shared with Otto's listMetaPages skill, so the two cannot drift (#741 r5 P1).
 *
 * `[]` is the strongest thing this function can say: it licenses the product to tell the merchant
 * they have connected nothing. Exactly one input earns it — `notConnected`, where there genuinely
 * is no MetaConnection row. `needsReconnect` and `needsPageScope` both happen with a connection
 * sitting right there (meta-pages.ts reads it first), which is why they get their own class.
 */
export function metaPagesToTargets(r: Awaited<ReturnType<typeof fetchOwnerPages>>): ChannelTargetsResult {
  switch (classifyPagesRead(r)) {
    case "ok":
      return { targets: ("pages" in r ? r.pages : []).map((p) => ({ id: p.id, name: p.name })) };
    case "unreadable":
      return { unavailable: true };
    case "not_connected":
      return { targets: [] };
    default:
      return { blocked: classifyPagesRead(r) as ConnectionBlocker };
  }
}

export const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };
