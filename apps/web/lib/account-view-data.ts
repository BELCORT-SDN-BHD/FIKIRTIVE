"use server";
import { requireOwner } from "./auth-guard";
import { getOwnerSettings } from "./owner-settings-actions";
import { listCreditPacks, type CreditPackShelf } from "./billing-actions";
import { listChannels } from "./channels/registry";
import { META_BACKED_CHANNEL_IDS, metaConnectionToStatus } from "./channels/meta-shared";
import { getMetaConnection, type MetaConnectionResult } from "./meta-actions";
import { DEFAULT_SETTINGS, type OwnerSettings } from "./owner-settings";
import type { ChannelState } from "@/components/otto/settings/sections";

export type AccountViewData = {
  settings: OwnerSettings;
  channels: ChannelState[];
  shelf: CreditPackShelf;
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
      status: META_BACKED_CHANNEL_IDS.includes(c.id)
        ? metaConnectionToStatus(await metaConnPromise)
        : await c.connectionStatus(ownerId).catch(() => "not_connected" as const),
      // Page names decorate a row whose CLAIM is `status` above. An unreadable list simply drops
      // the names and asserts nothing (#741 r3 P1). A BLOCKED connection is different: it is a
      // fact the merchant needs, and it must reach this row in the same words Schedule uses, or
      // the product ends up describing one connection two ways (#741 r5 P1).
      ...(await c
        .listTargets(ownerId)
        .then((r) => ({
          targets: "targets" in r ? r.targets.map((t) => t.name) : [],
          blocker: "blocked" in r ? r.blocked : null,
        }))
        .catch(() => ({ targets: [] as string[], blocker: null }))),
    })),
  );
  const [settingsRes, shelf, metaConn, channels] = await Promise.all([
    getOwnerSettings().catch(() => ({ error: "load-failed" } as const)),
    // A throw is one more way of not seeing the shelf — it must not be flattened into
    // "nothing is on sale" (#786), which is what `catch(() => [])` used to say.
    listCreditPacks().catch(() => ({ unreadable: true } as const)),
    metaConnPromise,
    channelsPromise,
  ]);
  const settings = settingsRes && !("error" in settingsRes) ? settingsRes : DEFAULT_SETTINGS;
  const adsAutonomy: "ASK" | "AUTO" = !("error" in metaConn) && metaConn.adsAutonomy === "AUTO" ? "AUTO" : "ASK";
  const canPublish = !("error" in metaConn) && metaConn.canPublish === true;
  return { settings, channels, shelf, adsAutonomy, canPublish, meta: metaConn };
}
