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
  listTargets(ownerId: string): Promise<ChannelTarget[]>;

  // Filled by the Schedule/Analytics plans — stubbed now (throw "not implemented").
  autoPublishable(post: ChannelPost): PublishMode;
  publish(ownerId: string, target: ChannelTarget, post: ChannelPost): Promise<{ externalId: string } | { error: string }>;
  fetchAccountInsights(ownerId: string, target: ChannelTarget, range: string): Promise<unknown>;
  listPublishedPosts(ownerId: string, target: ChannelTarget, cursor?: string): Promise<unknown>;
  fetchPostInsights(ownerId: string, externalId: string): Promise<unknown>;
}
