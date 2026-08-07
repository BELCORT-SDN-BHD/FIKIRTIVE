import type { Channel } from "./types";
import { disconnectMeta } from "../meta-actions";
import { fetchOwnerPages } from "../meta-pages";
import { metaPagesToTargets, metaStatus, notImpl } from "./meta-shared";
import { publishViaMeta } from "./meta-publish-adapter";

export const facebook: Channel = {
  id: "facebook",
  label: "Facebook",
  icon: null, // page supplies the brand glyph
  capabilities: { postTypes: ["feed-image", "text-link"], maxMediaCount: 1, supportsFirstComment: false, supportsNativeSchedule: true },
  connectionStatus: async () => metaStatus(),
  connectUrl: () => "/api/meta/authorize",
  disconnect: () => disconnectMeta(),
  // A failed read is reported as a failed read, never as "no accounts" (#741 r3 P1).
  listTargets: async (ownerId) => metaPagesToTargets(await fetchOwnerPages(ownerId)),
  autoPublishable: () => "auto",
  // L1: real organic publish — fail-closed until App Review (canPublish=false ⇒ refuse). Shared
  // orchestration in @fikirtive/core/server (spec §五). Insights stay stubbed (Analytics plan).
  publish: (ownerId, target, post) => publishViaMeta(ownerId, target, post, "facebook"),
  fetchAccountInsights: notImpl, listPublishedPosts: notImpl, fetchPostInsights: notImpl,
};
