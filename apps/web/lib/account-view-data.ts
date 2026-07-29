"use server";
import { requireOwner } from "./auth-guard";
import { getOwnerSettings } from "./owner-settings-actions";
import { listCreditPacks, type CreditPack } from "./billing-actions";
import { listChannels } from "./channels/registry";
import { META_BACKED_CHANNEL_IDS, metaConnectionToStatus } from "./channels/meta-shared";
import { getMetaConnection, type MetaConnectionResult } from "./meta-actions";
import { DEFAULT_SETTINGS, type OwnerSettings } from "./owner-settings";
import type { ChannelState } from "@/components/otto/settings/sections";

export type AccountViewData = {
  settings: OwnerSettings;
  channels: ChannelState[];
  packs: CreditPack[];
  adsAutonomy: "ASK" | "AUTO";
  canPublish: boolean;
  // The one Meta connection read for this whole view — the Connections page's ad-account
  // panel reads this instead of calling getMetaConnection() again itself (#518 rework
  // finding 2: up to four independent Meta reads per page load, collapsed to one).
  meta: MetaConnectionResult;
};

export async function getAccountViewData(): Promise<AccountViewData | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  // Single Meta read for the whole view. Meta-backed channels (instagram/facebook) derive
  // their row status from THIS SAME promise below instead of calling their own
  // connectionStatus() (which would call getMetaConnection() again) — awaiting a promise
  // twice resolves to the one cached result, it does not re-run the request.
  const metaConnPromise = getMetaConnection().catch(() => ({ error: "load-failed" } as const));
  const channelsPromise = Promise.all(
    listChannels().map(async (c) => ({
      id: c.id,
      label: c.label,
      connectUrl: c.connectUrl(),
      status: META_BACKED_CHANNEL_IDS.has(c.id)
        ? metaConnectionToStatus(await metaConnPromise)
        : await c.connectionStatus(ownerId).catch(() => "not_connected" as const),
      targets: await c.listTargets(ownerId).then((t) => t.map((x) => x.name)).catch(() => [] as string[]),
    })),
  );
  const [settingsRes, packs, metaConn, channels] = await Promise.all([
    getOwnerSettings().catch(() => ({ error: "load-failed" } as const)),
    listCreditPacks().catch(() => []),
    metaConnPromise,
    channelsPromise,
  ]);
  const settings = settingsRes && !("error" in settingsRes) ? settingsRes : DEFAULT_SETTINGS;
  const adsAutonomy: "ASK" | "AUTO" = !("error" in metaConn) && metaConn.adsAutonomy === "AUTO" ? "AUTO" : "ASK";
  const canPublish = !("error" in metaConn) && metaConn.canPublish === true;
  return { settings, channels, packs, adsAutonomy, canPublish, meta: metaConn };
}
