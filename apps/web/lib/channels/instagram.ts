import type { Channel, ChannelPost } from "./types";
import { disconnectMeta } from "../meta-actions";
import { fetchOwnerPages } from "../meta-pages";
import { metaPagesToTargets, metaStatus, notImpl } from "./meta-shared";
import { publishViaMeta } from "./meta-publish-adapter";

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
  // A failed read is reported as a failed read, never as "no accounts" (#741 r3 P1).
  listTargets: async (ownerId) => metaPagesToTargets(await fetchOwnerPages(ownerId)),
  autoPublishable: (post: ChannelPost) =>
    post.postType === "reel" || post.postType === "story" ? "reminder" : "auto",
  // L1: real organic publish — fail-closed until App Review grants the scopes (canPublish=false ⇒
  // refuse, no Meta call). The shared orchestration in @fikirtive/core/server is the single
  // implementation the publish worker also drives (spec §五). Insights stay stubbed (Analytics plan).
  publish: (ownerId, target, post) => publishViaMeta(ownerId, target, post, "instagram"),
  fetchAccountInsights: notImpl, listPublishedPosts: notImpl, fetchPostInsights: notImpl,
};
