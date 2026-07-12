import type { Channel, ChannelId } from "./types";
import { instagram } from "./instagram";
import { facebook } from "./facebook";
import { x } from "./x";

// Adapters self-register by being imported here (Task 4 fills these in).
export const channelRegistry: Record<ChannelId, Channel> = {};

export function registerChannel(c: Channel): void { channelRegistry[c.id] = c; }
export function listChannels(): Channel[] { return Object.values(channelRegistry); }
export function getChannel(id: ChannelId): Channel | undefined { return channelRegistry[id]; }

registerChannel(instagram);
registerChannel(facebook);
registerChannel(x);
