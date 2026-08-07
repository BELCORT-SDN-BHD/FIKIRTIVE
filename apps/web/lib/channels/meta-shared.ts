import type { ChannelTargetsResult, ConnectionStatus } from "./types";
import type { fetchOwnerPages } from "../meta-pages";
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
 * fetchOwnerPages → the adapter's honest answer (#741 r3 P1). Instagram and Facebook read the SAME
 * pages through the SAME connection, so the mapping lives here once.
 *
 * The dividing line is "did this read produce an answer?", NOT "did it produce pages":
 *   · transientError — network / 5xx / rate limit. We did NOT find out. The only `unavailable`.
 *   · notConnected · needsPageScope · needsReconnect — all DETERMINATE. There is nothing this
 *     merchant can post to right now, the Connections page says exactly that, and the honest next
 *     step really is to (re)connect. A real, empty list.
 * Collapsing the first into the rest is the bug: it told a connected merchant they had no accounts.
 */
export function metaPagesToTargets(r: Awaited<ReturnType<typeof fetchOwnerPages>>): ChannelTargetsResult {
  if ("pages" in r) return { targets: r.pages.map((p) => ({ id: p.id, name: p.name })) };
  if ("transientError" in r) return { unavailable: true };
  return { targets: [] };
}

export const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };
