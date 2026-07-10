import "server-only";
import { prisma } from "@fikirtive/db";
import { publishInstagram, publishFacebook, type MetaGraphPort } from "@fikirtive/core/server";
import { decryptToken } from "../token-encryption";
import { metaGraphGet, metaGraphPost } from "../meta-graph";
import type { ChannelTarget, ChannelPost } from "./types";

/**
 * Server-side Meta organic-publish for the channel adapters (L1 spec §四B/§五). This is the
 * fail-closed authorization gate + page-token/IG-business-account resolution; the actual Graph
 * choreography is the ONE shared implementation in @fikirtive/core/server (publishInstagram /
 * publishFacebook), which the publish worker also drives — so human path and worker path never
 * diverge (spec §五 单一动作层).
 *
 * FAIL-CLOSED is the whole point (spec §一.4): until Meta App Review grants the publish scopes,
 * every connection stays canPublish=false → this returns { error } WITHOUT touching Meta. The
 * kill-switch (organicPublishPaused), an expired token, or a revoked connection all refuse too.
 *
 * Token safety: the page access token is resolved + used entirely server-side here; it is NEVER
 * returned to any caller (the adapter surface only ever sees { externalId } | { error }).
 */

export type AdapterPublishResult = { externalId: string } | { error: string };

type Conn = {
  accessTokenEnc: string;
  canPublish: boolean;
  organicPublishPaused: boolean;
  status: string;
  tokenExpiresAt: Date | null;
};

/** Owner-scoped fail-closed gate → the decrypted USER token, or a human-readable refusal. */
async function authorize(ownerId: string): Promise<{ token: string } | { error: string }> {
  const conn = (await prisma.metaConnection.findUnique({
    where: { ownerId },
    select: { accessTokenEnc: true, canPublish: true, organicPublishPaused: true, status: true, tokenExpiresAt: true },
  })) as Conn | null;
  if (!conn) return { error: "Connect your account before publishing." };
  // App Review not passed (or the user declined the scope) → the primary fail-closed gate.
  if (!conn.canPublish) return { error: "Publishing isn't enabled for this connection yet — it's waiting on Meta's review." };
  if (conn.organicPublishPaused) return { error: "Publishing is paused for this connection." };
  if (conn.status === "expired") return { error: "This connection needs to be reconnected before it can publish." };
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= Date.now()) {
    return { error: "This connection expired — reconnect to publish." };
  }
  try {
    return { token: decryptToken(conn.accessTokenEnc) };
  } catch {
    return { error: "This connection needs to be reconnected before it can publish." };
  }
}

/** Resolve the FB page access token + (for IG) the connected instagram_business_account id for a
 *  target page the owner controls. Server-only; the page token never leaves this module. */
async function resolvePage(
  userToken: string,
  targetId: string,
): Promise<{ pageToken: string; igUserId: string | null } | { error: string }> {
  let pages: Record<string, unknown>[];
  try {
    const r = await metaGraphGet(userToken, "me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id}",
    });
    pages = (r.data ?? []) as Record<string, unknown>[];
  } catch {
    return { error: "Couldn't reach Meta to resolve the page — please try again." };
  }
  const page = pages.find((p) => String(p.id ?? "") === targetId);
  const pageToken = page && typeof page.access_token === "string" ? page.access_token : "";
  if (!page || !pageToken) return { error: "That account isn't one of your connected pages." };
  const iba = page.instagram_business_account as { id?: unknown } | undefined;
  const igUserId = iba && (typeof iba.id === "string" || typeof iba.id === "number") ? String(iba.id) : null;
  return { pageToken, igUserId };
}

/** Build a MetaGraphPort bound to a specific (page) token. */
function portFor(token: string): MetaGraphPort {
  return {
    post: (path, body) => metaGraphPost(token, path, body),
    get: (path, params) => metaGraphGet(token, path, params),
  };
}

/** The channel adapters' `publish()` body. Gate → resolve → drive the shared orchestration. */
export async function publishViaMeta(
  ownerId: string,
  target: ChannelTarget,
  post: ChannelPost,
  channel: "instagram" | "facebook",
): Promise<AdapterPublishResult> {
  const auth = await authorize(ownerId);
  if ("error" in auth) return auth;

  const resolved = await resolvePage(auth.token, target.id);
  if ("error" in resolved) return resolved;

  const port = portFor(resolved.pageToken);

  if (channel === "instagram") {
    // Reels / Stories are published as REMINDERS in L1 (autoPublishable → "reminder"), never
    // auto-published — refuse them here so this path only ever runs the feed-image / carousel flow.
    if (post.postType === "reel" || post.postType === "story") {
      return { error: "Reels and Stories are published as reminders, not automatically." };
    }
    if (!resolved.igUserId) return { error: "This page has no connected Instagram business account." };
    const res = await publishInstagram(port, {
      igUserId: resolved.igUserId,
      mediaUrls: post.mediaUrls,
      caption: post.caption,
      firstComment: post.firstComment ?? null,
    });
    return "externalId" in res ? res : { error: res.error };
  }

  // Facebook
  const res = await publishFacebook(port, {
    pageId: target.id,
    message: post.caption,
    mediaUrls: post.mediaUrls,
  });
  return "externalId" in res ? res : { error: res.error };
}
