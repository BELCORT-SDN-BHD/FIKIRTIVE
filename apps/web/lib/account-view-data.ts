"use server";
import { requireOwner } from "./auth-guard";
import { getOwnerSettings } from "./owner-settings-actions";
import { listCreditPacks, type CreditPack } from "./billing-actions";
import { listChannels } from "./channels/registry";
import { getMetaConnection } from "./meta-actions";
import { DEFAULT_SETTINGS, type OwnerSettings } from "./owner-settings";
import type { ChannelState } from "@/components/otto/settings/sections";

export type AccountViewData = {
  settings: OwnerSettings;
  channels: ChannelState[];
  packs: CreditPack[];
  adsAutonomy: "ASK" | "AUTO";
};

export async function getAccountViewData(): Promise<AccountViewData | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;
  const channelsPromise = Promise.all(
    listChannels().map(async (c) => ({
      id: c.id,
      label: c.label,
      connectUrl: c.connectUrl(),
      status: await c.connectionStatus(ownerId).catch(() => "not_connected" as const),
      targets: await c.listTargets(ownerId).then((t) => t.map((x) => x.name)).catch(() => [] as string[]),
    })),
  );
  const [settingsRes, packs, metaConn, channels] = await Promise.all([
    getOwnerSettings().catch(() => ({ error: "load-failed" } as const)),
    listCreditPacks().catch(() => []),
    getMetaConnection().catch(() => ({ error: "load-failed" } as const)),
    channelsPromise,
  ]);
  const settings = settingsRes && !("error" in settingsRes) ? settingsRes : DEFAULT_SETTINGS;
  const adsAutonomy: "ASK" | "AUTO" = !("error" in metaConn) && metaConn.adsAutonomy === "AUTO" ? "AUTO" : "ASK";
  return { settings, channels, packs, adsAutonomy };
}
