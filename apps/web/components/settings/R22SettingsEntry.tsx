import "server-only";

import { redirect } from "next/navigation";
import { getMyAccount } from "@/lib/account-actions";
import { getAccountViewData } from "@/lib/account-view-data";
import { requireOwner } from "@/lib/auth-guard";
import { R22SettingsShell, type R22SettingsData, type R22SettingsSection } from "./R22SettingsShell";

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
const VALID_SECTIONS = new Set<R22SettingsSection>(["preferences", "profile", "notifications", "security", "connected", "workspace", "members", "roles", "connections", "billing", "domains"]);

export async function R22SettingsEntry({ searchParams, defaultSection = "workspace" }: { searchParams: Promise<Record<string, string | string[] | undefined>>; defaultSection?: R22SettingsSection }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  const requested = first(params.section);
  const initialSection = requested && VALID_SECTIONS.has(requested as R22SettingsSection) ? requested as R22SettingsSection : defaultSection;
  if (fixture) {
    const data: R22SettingsData = { workspaceName: "Batik House", displayName: "Nadia Ahmad", email: "nadia@batikhouse.my", balance: 1240, recent: [], accountReadable: true, spendCapCredits: 40, timezone: "Malaysia Time · GMT+8", channels: [{ id: "instagram", label: "Instagram", status: "connected", statusLabel: "@batikhouse · connected", connectUrl: "/api/meta/authorize" }, { id: "facebook", label: "Facebook", status: "not_connected", statusLabel: "Not connected", connectUrl: "/api/meta/authorize" }] };
    const requestedState = first(params.state);
    const fixtureState = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(params.outcome);
    const fixtureOutcome = requestedOutcome === "error" || requestedOutcome === "conflict" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    return <R22SettingsShell key={initialSection} data={data} initialSection={initialSection} fixture fixtureState={fixtureState} fixtureOutcome={fixtureOutcome} />;
  }
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const [accountResult, viewResult] = await Promise.all([
    getMyAccount().catch(() => ({ error: "account-read-failed" } as const)),
    getAccountViewData().catch(() => ({ error: "settings-read-failed" } as const)),
  ]);
  const account = "error" in accountResult ? null : accountResult;
  const view = "error" in viewResult ? null : viewResult;
  const channelsReadable = !!view && !("error" in view.meta);
  const data: R22SettingsData = {
    workspaceName: account?.organizationName ?? "Workspace name unavailable",
    displayName: account?.displayName ?? "",
    email: account?.email ?? owner.email,
    balance: account?.balance ?? null,
    recent: account?.recent ?? [],
    accountReadable: !!account,
    spendCapCredits: view?.settingsReadable ? view.settings.spendCapCredits : null,
    timezone: view?.settings.timezone ?? "Timezone could not be read",
    channels: channelsReadable ? view.channels.map((channel) => ({ id: channel.id, label: channel.label, status: channel.status, statusLabel: channel.blocker ? "Reconnect required" : channel.status === "connected" ? channel.targets.join(", ") || "Connected" : channel.status === "needs_reconnect" ? "Reconnect required" : "Not connected", connectUrl: channel.connectUrl })) : [],
    dataError: !account ? "account" : !view ? "connections and workspace settings" : !channelsReadable ? "connections" : undefined,
  };
  return <R22SettingsShell key={initialSection} data={data} initialSection={initialSection} />;
}
