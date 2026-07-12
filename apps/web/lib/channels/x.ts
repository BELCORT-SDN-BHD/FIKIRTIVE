import type { Channel } from "./types";
import { prisma } from "@fikirtive/db";
import { requireOwner } from "../auth-guard";
import { notImpl } from "./meta-shared";
import { publishViaX } from "./x-publish-adapter";

/**
 * X (Twitter) channel adapter (E4-14) — same registry shape as instagram.ts / facebook.ts. Its
 * connection carrier is the GENERIC ChannelConnection (kind="x", B0-30), NOT MetaConnection. publish()
 * is fail-closed until a connection actually grants the X publish scope (契约3, see x-publish-adapter);
 * insights stay stubbed (Analytics plan). No X credentials exist in-block, so publish() refuses in
 * production; mock/fixture tests exercise the authorized branch (spec §六.1).
 */
export const x: Channel = {
  id: "x",
  label: "X",
  icon: null, // the UI (OttoSchedule ChannelIcon) supplies the brand glyph
  capabilities: { postTypes: ["feed-image", "text-link"], maxMediaCount: 4, supportsFirstComment: false, supportsNativeSchedule: false },
  connectionStatus: async (ownerId) => {
    const c = await prisma.channelConnection.findFirst({ where: { ownerId, kind: "x" }, select: { status: true } });
    if (!c) return "not_connected";
    return c.status === "expired" ? "needs_reconnect" : "connected";
  },
  connectUrl: () => "/api/x/authorize", // X OAuth start (route lands with the connect flow; external-test phase)
  disconnect: async () => {
    const gate = await requireOwner();
    if ("error" in gate) return { error: "Sign in to disconnect X." };
    await prisma.channelConnection.deleteMany({ where: { ownerId: gate.ownerId, kind: "x" } });
    return { ok: true };
  },
  listTargets: async (ownerId) => {
    const c = await prisma.channelConnection.findFirst({
      where: { ownerId, kind: "x" },
      select: { id: true, externalId: true, displayName: true },
    });
    return c ? [{ id: c.externalId ?? c.id, name: c.displayName ?? "X account" }] : [];
  },
  autoPublishable: () => "auto",
  publish: (ownerId, target, post) => publishViaX(ownerId, target, post),
  fetchAccountInsights: notImpl,
  listPublishedPosts: notImpl,
  fetchPostInsights: notImpl,
};
