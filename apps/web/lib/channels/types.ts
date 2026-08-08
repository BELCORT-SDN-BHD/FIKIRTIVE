import type { ReactNode } from "react";
import type { ConnectionBlocker } from "@fikirtive/core/schedule-draft";

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
 * FOUR facts, not two. Two rounds of this ticket were spent discovering that an empty list is a
 * much stronger claim than it looks — it licenses the whole product to say "you have not connected
 * anything", so anything else that lands in that branch becomes a lie:
 *   · `targets`     — we read it; `[]` here means genuinely nothing is connected;
 *   · `unavailable` — the read FAILED (transient platform error). We do not know (#741 r3 P1);
 *   · `blocked`     — the connection EXISTS but can't publish right now: its access expired, or it
 *                     lacks page permission. Saying "connect your account" to this merchant
 *                     contradicts both the truth and the Connections page (#741 r5 P1).
 */
export type ChannelTargetsResult =
  | { targets: ChannelTarget[] }
  | { blocked: ConnectionBlocker }
  | { unavailable: true };

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
