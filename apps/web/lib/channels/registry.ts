import type { Channel, ChannelId } from "./types";
import { instagram } from "./instagram";
import { facebook } from "./facebook";
import { x } from "./x";

// Adapters self-register by being imported here (Task 4 fills these in).
export const channelRegistry: Record<ChannelId, Channel> = {};

export function registerChannel(c: Channel): void { channelRegistry[c.id] = c; }
export function listChannels(): Channel[] { return Object.values(channelRegistry); }
// Single-adapter lookup is `channelRegistry[id]` — schedule-actions.ts uses exactly that.
// A `getChannel(id)` wrapper existed here with zero callers and was removed in C2b.

registerChannel(instagram);
registerChannel(facebook);
registerChannel(x);
