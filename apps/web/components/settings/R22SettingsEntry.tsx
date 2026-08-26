import "server-only";

import { redirect } from "next/navigation";
import { getMyAccount } from "@/lib/account-actions";
import { getAccountViewData } from "@/lib/account-view-data";
import { requireOwner } from "@/lib/auth-guard";
import { R22SettingsShell, type R22SettingsData } from "./R22SettingsShell";
import { R22_SETTINGS_SECTION_LABELS, isBetaSettingsSection, type R22SettingsSection } from "./r22-settings-sections";

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
const VALID_SECTIONS = new Set<R22SettingsSection>(["preferences", "profile", "notifications", "security", "connected", "workspace", "members", "roles", "connections", "billing", "domains"]);

/**
 * beta 收窄的那道闸(Founder 裁决 2026-08-27,台账 P2-22)。名单与理由在
 * `r22-settings-sections.ts` 的 `BETA_SETTINGS_SECTIONS`;这里只做两件事:
 *
 *   ① **回落**:落到被藏那八节的深链(`?section=members`、`/settings/connections`,以及
 *      cmd+K 与 Help 抽屉里还留着的旧链接)不 404、不报错,落到 Profile,并且**说出来** ——
 *      商家按的是 Members,眼前却是 Profile,不说一句就是骗人。口径照 workspace 切换失败:
 *      说清你现在在哪、什么没发生,不加自证话。
 *   ② **开闸**:`?sections=all` 把十一节原样放回来(壳里一节都没删)。
 */
const BETA_GATE_PARAM = "sections";
const BETA_GATE_OPEN_VALUE = "all";

export async function R22SettingsEntry({ searchParams, defaultSection = "workspace" }: { searchParams: Promise<Record<string, string | string[] | undefined>>; defaultSection?: R22SettingsSection }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  const requested = first(params.section);
  const requestedSection = requested && VALID_SECTIONS.has(requested as R22SettingsSection) ? requested as R22SettingsSection : undefined;
  const landing = requestedSection ?? defaultSection;
  const betaGateOpen = first(params[BETA_GATE_PARAM]) === BETA_GATE_OPEN_VALUE;
  const betaScope = !betaGateOpen;
  const fallsBack = betaScope && !isBetaSettingsSection(landing);
  /**
   * 「商家真的按了那扇门吗」—— 按了才说话。`?section=members` 是他按的;`/settings/connections`
   * 这条路由自带的 `defaultSection` 也是他按的(Help 抽屉那条链接就长这样)。只有 `/settings`
   * 自己那个 `"workspace"` 落点不是他选的 —— 那是这一面的默认门,beta 期换成 Profile
   * 无声无息即可,为一个他没按过的名字弹一句解释才是噪音。
   */
  const askedForDoor = requestedSection ?? (defaultSection === "workspace" ? undefined : defaultSection);
  const initialSection = fallsBack ? "profile" : landing;
  const betaFallbackFrom = fallsBack && askedForDoor ? R22_SETTINGS_SECTION_LABELS[askedForDoor] : undefined;
  if (fixture) {
    const data: R22SettingsData = { workspaceName: "Batik House", displayName: "Nadia Ahmad", email: "nadia@batikhouse.my", balance: 1240, recent: [], accountReadable: true, spendCapCredits: 40, timezone: "Malaysia Time · GMT+8", channels: [{ id: "instagram", label: "Instagram", status: "connected", statusLabel: "@batikhouse · connected", connectUrl: "/api/meta/authorize" }, { id: "facebook", label: "Facebook", status: "not_connected", statusLabel: "Not connected", connectUrl: "/api/meta/authorize" }] };
    const requestedState = first(params.state);
    const fixtureState = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(params.outcome);
    const fixtureOutcome = requestedOutcome === "error" || requestedOutcome === "conflict" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    return <R22SettingsShell key={initialSection} data={data} initialSection={initialSection} betaScope={betaScope} betaFallbackFrom={betaFallbackFrom} fixture fixtureState={fixtureState} fixtureOutcome={fixtureOutcome} />;
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
  return <R22SettingsShell key={initialSection} data={data} initialSection={initialSection} betaScope={betaScope} betaFallbackFrom={betaFallbackFrom} />;
}
