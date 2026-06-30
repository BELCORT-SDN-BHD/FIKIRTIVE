import type { Channel, ChannelPost, ChannelTarget, ConnectionStatus } from "./types";
import { getMetaConnection, disconnectMeta } from "../meta-actions";
import { fetchOwnerPages } from "../meta-pages";

const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };

async function metaStatus(): Promise<ConnectionStatus> {
  const c = await getMetaConnection();
  if ("error" in c || !c.connected) return "not_connected";
  return c.needsReconnect || c.status === "expired" ? "needs_reconnect" : "connected";
}

export const facebook: Channel = {
  id: "facebook",
  label: "Facebook",
  icon: null, // page supplies the brand glyph
  capabilities: { postTypes: ["feed-image", "text-link"], maxMediaCount: 1, supportsFirstComment: false, supportsNativeSchedule: true },
  connectionStatus: async () => metaStatus(),
  connectUrl: () => "/api/meta/authorize",
  disconnect: () => disconnectMeta(),
  listTargets: async (ownerId) => {
    const r = await fetchOwnerPages(ownerId);
    return "pages" in r ? r.pages.map((p) => ({ id: p.id, name: p.name })) : [];
  },
  autoPublishable: () => "auto",
  publish: notImpl, fetchAccountInsights: notImpl, listPublishedPosts: notImpl, fetchPostInsights: notImpl,
};
