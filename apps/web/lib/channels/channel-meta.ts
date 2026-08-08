// Client-safe channel metadata — pure data, NO adapter behaviour. The full `registry`
// (instagram.ts / facebook.ts) transitively imports server-only code (Prisma, node:crypto
// via meta-pages/token-encryption), so a client component must NOT import it. This mirror
// carries only the display + capability facts the UI needs (label, post-type gating, media
// caps, first-comment support). Keep the capability values in sync with the adapters.

import type { ChannelId, ChannelCapabilities } from "./types";

export type ChannelMeta = {
  id: ChannelId;
  label: string;
  capabilities: ChannelCapabilities;
};

export const CHANNEL_META: ChannelMeta[] = [
  {
    id: "instagram",
    label: "Instagram",
    capabilities: {
      postTypes: ["feed-image", "carousel", "reel", "story"],
      maxMediaCount: 10,
      supportsFirstComment: true,
      supportsNativeSchedule: false,
      rateLimitPer24h: 25,
    },
  },
  {
    id: "facebook",
    label: "Facebook",
    capabilities: {
      postTypes: ["feed-image", "text-link"],
      maxMediaCount: 1,
      supportsFirstComment: false,
      supportsNativeSchedule: true,
    },
  },
  {
    id: "x",
    label: "X",
    capabilities: {
      postTypes: ["text-link"],
      maxMediaCount: 0,
      supportsFirstComment: false,
      supportsNativeSchedule: false,
    },
  },
];

export function channelMeta(id: ChannelId): ChannelMeta | undefined {
  return CHANNEL_META.find((c) => c.id === id);
}

// ── Which publishing channels a merchant can actually connect today (#694) ───────────────────
// X has no OAuth route: lib/channels/x.ts's connectUrl points at an unbuilt /api/x/authorize, and
// Connections deliberately renders it as a button-less "Not available yet" row. Schedule disagreed —
// with zero connections its composer fell back to "every channel", so a brand-new merchant was
// offered X, sent to a Connections row with nothing to press, and could still save an X draft that
// can never publish. This set is the single filter every merchant-facing entry point runs: the
// Connections page, the composer's channel list, the Plan/Queue channel filter, and the account
// page's "x of y connected". When X OAuth lands, deleting one id here lights all four up at once.
//
// CHANNEL_META itself keeps X — existing X drafts, their capability blurb and their queue rows must
// still render truthfully; this is about which channels we OFFER, not which we can display.
export const UNAVAILABLE_PUBLISHING_CHANNEL_IDS: ReadonlySet<ChannelId> = new Set<ChannelId>(["x"]);

export function isConnectableChannel(id: ChannelId): boolean {
  return !UNAVAILABLE_PUBLISHING_CHANNEL_IDS.has(id);
}

export const CONNECTABLE_CHANNEL_META: ChannelMeta[] = CHANNEL_META.filter((c) => isConnectableChannel(c.id));
