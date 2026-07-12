import "server-only";
import { prisma } from "@fikirtive/db";
import { publishX, xScopeCanPublish, type XApiPort } from "@fikirtive/core/server";
import { decryptToken } from "../token-encryption";
import type { ChannelTarget, ChannelPost } from "./types";

/**
 * Server-side X organic-publish for the X channel adapter (E4-14). It is the fail-closed
 * authorization gate on the GENERIC ChannelConnection (kind="x", B0-30 — NOT MetaConnection), then
 * it drives the ONE shared orchestration in @fikirtive/core (publishX). The publish worker drives the
 * SAME publishX, so the human path and the worker path never diverge into two publish logics
 * (契约6 单一动作层).
 *
 * FAIL-CLOSED is the whole point (spec §一.4 shape / 契约3): canPublish is DERIVED from the
 * connection's ACTUALLY-granted scope (xScopeCanPublish → DEFAULT false, since a fresh connection's
 * scope is ""), so a read-only / unconnected X account can never publish. The per-channel
 * kill-switch (publishPaused), an expired token, or a revoked connection all refuse too — WITHOUT
 * touching X. There are NO X credentials in-block, so this path stays fail-closed in production;
 * mock/fixture tests exercise the branches (spec §六.1).
 *
 * Token safety: the access token is resolved + used entirely server-side; it is NEVER returned to a
 * caller (the adapter surface only ever sees { externalId } | { error }).
 */

export type AdapterPublishResult = { externalId: string } | { error: string };

type XConn = { accessTokenEnc: string; scope: string; status: string; publishPaused: boolean; tokenExpiresAt: Date | null };

/** Owner-scoped fail-closed gate → the decrypted token, or a human-readable refusal. */
async function authorizeX(ownerId: string): Promise<{ token: string } | { error: string }> {
  const conn = (await prisma.channelConnection.findFirst({
    where: { ownerId, kind: "x" },
    select: { accessTokenEnc: true, scope: true, status: true, publishPaused: true, tokenExpiresAt: true },
  })) as XConn | null;
  if (!conn) return { error: "Connect your X account before publishing." };
  if (!xScopeCanPublish(conn.scope)) return { error: "Publishing isn't enabled for this X connection yet — reconnect and grant posting access." };
  if (conn.publishPaused) return { error: "Publishing is paused for this X connection." };
  if (conn.status === "expired") return { error: "This X connection needs to be reconnected before it can publish." };
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= Date.now()) return { error: "This X connection expired — reconnect to publish." };
  try {
    return { token: decryptToken(conn.accessTokenEnc) };
  } catch {
    return { error: "This X connection needs to be reconnected before it can publish." };
  }
}

const X_API_BASE = "https://api.x.com";

/** Build an XApiPort bound to a bearer token. No real X call happens in-block (fail-closed); this is
 *  the shape the external-test phase (§六.2, founder-authorized) exercises against real credentials. */
function portFor(token: string): XApiPort {
  return {
    post: async (path, body) => {
      const r = await fetch(`${X_API_BASE}/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const e = new Error(String((j as { detail?: string }).detail ?? "X API error")) as Error & { status?: number };
        e.status = r.status;
        throw e;
      }
      return j as { data?: { id?: unknown } };
    },
  };
}

/** The X adapter's publish() body. Gate → drive the shared orchestration. Text-only in-block:
 *  attaching our media to X requires X media-upload (v1.1), which is external-test-phase (§六.2); a
 *  post that carries media is refused deterministically here rather than silently dropping it. */
export async function publishViaX(ownerId: string, _target: ChannelTarget, post: ChannelPost): Promise<AdapterPublishResult> {
  const auth = await authorizeX(ownerId);
  if ("error" in auth) return auth;
  if (post.mediaUrls.length > 0) {
    return { error: "Publishing images or video to X isn't available yet — post text only for now." };
  }
  const res = await publishX(portFor(auth.token), { text: post.caption });
  return "externalId" in res ? res : { error: res.error };
}
