import type { Channel, ChannelPost } from "./types";
import { disconnectMeta } from "../meta-actions";
import { fetchOwnerPages } from "../meta-pages";
import { metaStatus, notImpl } from "./meta-shared";

export const instagram: Channel = {
  id: "instagram",
  label: "Instagram",
  icon: null,
  capabilities: { postTypes: ["feed-image", "carousel", "reel", "story"], maxMediaCount: 10, supportsFirstComment: true, supportsNativeSchedule: false, rateLimitPer24h: 25 },
  connectionStatus: async () => metaStatus(),
  connectUrl: () => "/api/meta/authorize",
  disconnect: () => disconnectMeta(),
  // IG business accounts hang off FB pages. For the connect surface we list the
  // pages as the targets; resolving page → instagram_business_account id is a
  // Schedule-plan concern (a single metaGraphGet on the page). Returning pages
  // here lets the Connections UI show "connected" + which pages back IG.
  listTargets: async (ownerId) => {
    const r = await fetchOwnerPages(ownerId);
    return "pages" in r ? r.pages.map((p) => ({ id: p.id, name: p.name })) : [];
  },
  autoPublishable: (post: ChannelPost) =>
    post.postType === "reel" || post.postType === "story" ? "reminder" : "auto",
  publish: notImpl, fetchAccountInsights: notImpl, listPublishedPosts: notImpl, fetchPostInsights: notImpl,
};
