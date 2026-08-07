import type { ReactNode } from "react";

export type ChannelId = string; // "instagram" | "facebook" | future ids — OPEN, never a closed enum
export type PostType = "feed-image" | "carousel" | "reel" | "story" | "text-link";
export type PublishMode = "auto" | "reminder";
export type ConnectionStatus = "connected" | "needs_reconnect" | "not_connected";

export type ChannelCapabilities = {
  postTypes: PostType[];
  maxMediaCount: number;
  supportsFirstComment: boolean;
  supportsNativeSchedule: boolean;
  rateLimitPer24h?: number;
};

export type ChannelTarget = { id: string; name: string };

/**
 * What an adapter can honestly answer when asked "which accounts is this merchant connected to".
 *
 * THREE facts, not two (#741 r3 P1). A read that failed is not an empty list: the Meta adapters
 * used to turn `fetchOwnerPages`'s `{ transientError: true }` into `[]`, so one flaky Graph call
 * travelled all the way to the screen and came out as "you have no connected accounts" — with a
 * Connect button — for a merchant whose connection was fine. `unavailable` carries that "we could
 * not find out" all the way down, so every consumer must decide what to do about not knowing
 * instead of silently inheriting a false answer.
 */
export type ChannelTargetsResult = { targets: ChannelTarget[] } | { unavailable: true };

// Minimal post shape the connect-phase needs (Schedule fleshes this out later).
export type ChannelPost = {
  caption: string;
  mediaUrls: string[];
  firstComment?: string;
  postType: PostType;
};

export interface Channel {
  id: ChannelId;
  label: string;
  icon: ReactNode;
  capabilities: ChannelCapabilities;

  connectionStatus(ownerId: string): Promise<ConnectionStatus>;
  /** OAuth start URL (the page links to it; no token handling client-side). */
  connectUrl(): string;
  disconnect(): Promise<{ ok: true } | { error: string }>;
  listTargets(ownerId: string): Promise<ChannelTargetsResult>;

  // Filled by the Schedule/Analytics plans — stubbed now (throw "not implemented").
  autoPublishable(post: ChannelPost): PublishMode;
  publish(ownerId: string, target: ChannelTarget, post: ChannelPost): Promise<{ externalId: string } | { error: string }>;
  fetchAccountInsights(ownerId: string, target: ChannelTarget, range: string): Promise<unknown>;
  listPublishedPosts(ownerId: string, target: ChannelTarget, cursor?: string): Promise<unknown>;
  fetchPostInsights(ownerId: string, externalId: string): Promise<unknown>;
}
