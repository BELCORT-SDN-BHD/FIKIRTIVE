# Channel provider foundation — design spec (extensible platforms)

Date: 2026-06-30 · **Foundation — build first**, before Schedule/Analytics depend on it
Founder: "也要有一个选项可以给我们换平台(之后会有更多的平台,所以基础先建好)."

## Goal
One **channel/platform abstraction** so Instagram + Facebook are just the first two
adapters, and adding a new platform later (TikTok, LinkedIn, Threads, YouTube
Shorts, Pinterest, X…) = **drop in one adapter + register it** — no rewrite of
Schedule, Analytics, or Connections. Mirrors the existing `GenerationProvider`
seam (fal → BytePlus): a clean interface, swappable implementations.

## The seam
A new module — `apps/web/lib/channels/` (or a `packages/social` package; plan decides):

```ts
type ChannelId = string;            // "instagram" | "facebook" | future ids — open, not a closed enum

type PublishMode = "auto" | "reminder";
type PostType = "feed-image" | "carousel" | "reel" | "story" | "text-link";

interface ChannelCapabilities {
  postTypes: PostType[];
  maxMediaCount: number;            // e.g. carousel ≤ 10
  supportsFirstComment: boolean;
  supportsNativeSchedule: boolean;  // FB pages true; IG false → our timer
  rateLimitPer24h?: number;         // e.g. IG 25
}

interface Channel {
  id: ChannelId;
  label: string;
  icon: ReactNode;
  capabilities: ChannelCapabilities;

  // connection (OAuth) — owner-scoped, token stays server-side
  connectionStatus(ownerId): "connected" | "needs_reconnect" | "not_connected";
  beginConnect(ownerId): { url } ;          // OAuth start
  disconnect(ownerId): void;
  listTargets(ownerId): ChannelTarget[];    // pages / IG business accounts under this connection

  // publishing (organic) — used by the Schedule scheduler
  autoPublishable(post): PublishMode;       // some content → "reminder" (e.g. reel+music)
  validate(post): ValidationIssue[];        // per-network caption/format/media checks
  publish(ownerId, target, post): Promise<{ externalId: string }>;

  // analytics (read) — used by Analytics
  fetchAccountInsights(ownerId, target, range): AccountMetrics | NeedsReconnect | NotConnected;
  listPublishedPosts(ownerId, target, cursor?): { posts: PublishedPostRef[]; next?: cursor };
  fetchPostInsights(ownerId, externalId): PostMetrics;
}

const channelRegistry: Record<ChannelId, Channel>;   // the one place platforms are registered
```

- **Adapters (Phase A)**: `channels/instagram.ts`, `channels/facebook.ts` — both wrap
  the existing Meta OAuth + `meta-graph`; IG implements container→publish + media
  insights, FB implements page post + post insights. A future `channels/tiktok.ts`
  implements the same interface and registers itself; nothing else changes.
- **Everything iterates the registry**: the Connections UI lists
  `Object.values(channelRegistry)`; the composer's channel picker, the calendar's
  channel chips, the scheduler's publish, and Analytics' per-channel breakdown all
  go through `Channel`, never a hardcoded "if instagram / if facebook".

## Data model
- `ChannelConnection` (generic, owner-scoped): `ownerId, channelId, externalAccountId,
  accessTokenEnc, status, label`. One OAuth grant can back multiple channels/targets
  (Meta login → IG business + FB pages), so connection ↔ channel-target is 1-to-many;
  the plan decides whether to reuse the existing `metaConnection` row + a target map,
  or introduce `ChannelConnection` + `ChannelTarget`. Either way the **interface**
  above is what callers use.
- `ScheduledPost.channel` and `PublishedPostRef.channel` are `ChannelId` (open
  string), never a closed IG/FB enum — so a new platform's rows just work.

## How the three features use it
- **Account → Connections**: renders one row per registered channel (connect /
  reconnect / disconnect, show targets). Add a platform → a new row appears for free.
- **Schedule**: composer channel picker = registered channels whose
  `capabilities.postTypes` fit the media; scheduler calls `channel.publish(...)`
  + `channel.autoPublishable(...)`; rate-limit from `capabilities.rateLimitPer24h`.
- **Analytics**: per-channel KPIs + posts via `channel.fetchAccountInsights` /
  `listPublishedPosts` / `fetchPostInsights`; "all platforms" = iterate the registry.

## Money / safety
- Pure integration seam — no spend path. Tokens stay server-side (no client URLs/IDOR),
  same trust boundary as the current Meta connector. Publishing still gated on owner
  approval (the Schedule spec's consent rule).

## Extensibility checklist (the payoff)
Adding a platform later =
1. `channels/<platform>.ts` implementing `Channel`.
2. Register it in `channelRegistry`.
3. Its OAuth creds/scopes in env + (if needed) its own App Review.
→ Connections, composer, calendar, scheduler, and Analytics pick it up automatically.

## Open questions for the plan
- `metaConnection` reuse vs new `ChannelConnection`/`ChannelTarget` tables.
- Where the registry lives (`apps/web/lib/channels` vs a `packages/social` package
  shared with the worker, since the scheduler worker also needs `publish`).
- Capability-gating in the composer (hide post types a channel can't do).
