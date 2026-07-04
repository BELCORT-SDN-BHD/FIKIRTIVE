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
];

export function channelMeta(id: ChannelId): ChannelMeta | undefined {
  return CHANNEL_META.find((c) => c.id === id);
}
