"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectNative } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import Link from "next/link";
import {
  Bell,
  Building2,
  ChevronLeft,
  Globe2,
  KeyRound,
  Link2,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AccountActivity } from "@/lib/account-actions";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { disconnectMeta } from "@/lib/meta-actions";
import {
  DEFAULT_R22_WORKSPACE_DIRECTORY,
  readR22WorkspaceDirectory,
  slugifyR22Workspace,
  writeR22WorkspaceDirectory,
  type R22FixtureWorkspaceDirectory,
} from "@/components/r22/r22-workspace-fixture";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import "./r22-settings.css";
import "./r22-settings-dialog.css";
import "./r22-settings-dialog-extra.css";

export type R22SettingsChannel = { id: string; label: string; status: string; statusLabel: string; connectUrl: string | null };
export type R22SettingsData = {
  workspaceName: string;
  displayName: string;
  email: string;
  balance: number | null;
  recent: AccountActivity[];
  accountReadable: boolean;
  spendCapCredits: number | null;
  channels: R22SettingsChannel[];
  timezone: string;
  dataError?: string;
};
export type R22SettingsSection = "preferences" | "profile" | "notifications" | "security" | "connected" | "workspace" | "members" | "roles" | "connections" | "billing" | "domains";

const GROUPS: Array<{ label: string; items: Array<{ id: R22SettingsSection; label: string; icon: typeof Bell }> }> = [
  { label: "Personal", items: [{ id: "preferences", label: "Preferences", icon: SlidersHorizontal }, { id: "profile", label: "Profile", icon: UserRound }, { id: "notifications", label: "Notifications", icon: Bell }, { id: "security", label: "Security and access", icon: ShieldCheck }, { id: "connected", label: "Connected accounts", icon: Link2 }] },
  { label: "Workspace", items: [{ id: "workspace", label: "General", icon: Building2 }, { id: "members", label: "Members", icon: UsersRound }, { id: "roles", label: "Roles and permissions", icon: KeyRound }] },
  { label: "Publishing", items: [{ id: "connections", label: "Connections", icon: Radio }, { id: "billing", label: "Billing and credits", icon: WalletCards }] },
  { label: "Administration", items: [{ id: "domains", label: "Domains", icon: Globe2 }] },
];

const SETTINGS_FIXTURE_KEY = "r22:settings:fixture:v2";
type FixtureMember = { id: string; name: string; email: string; role: string; status: "Active" | "Invited" };
type FixtureSession = { id: string; label: string; detail: string; current: boolean };
type FixtureDomain = { id: string; name: string; status: "Pending" | "Verified" };
type FixtureCapabilities = { create: boolean; approve: boolean; publish: boolean; billing: boolean };
type FixtureSettings = {
  workspaceName: string;
  displayName: string;
  timezone: string;
  language: string;
  startOfWeek: string;
  defaultHome: string;
  members: FixtureMember[];
  notifications: { inApp: boolean; email: boolean; approval: boolean; publishFailed: boolean; routine: boolean };
  sessions: FixtureSession[];
  connectedAccounts: { google: boolean; canva: boolean };
  domains: FixtureDomain[];
  channels: { instagram: boolean; facebook: boolean };
  balance: number;
  plan: string;
  roleCapabilities: Record<"Admin" | "Editor" | "Approver", FixtureCapabilities>;
  spendCap: number;
};

function readFixtureSettings(workspaceId: string, fallback: FixtureSettings): FixtureSettings | null {
  try {
    const stored = window.sessionStorage.getItem(SETTINGS_FIXTURE_KEY);
    if (!stored) return null;
    const directory = JSON.parse(stored) as Record<string, Partial<FixtureSettings>>;
    const saved = directory[workspaceId];
    if (!saved) return null;
    return {
      ...fallback,
      ...saved,
      notifications: { ...fallback.notifications, ...saved.notifications },
      connectedAccounts: { ...fallback.connectedAccounts, ...saved.connectedAccounts },
      channels: { ...fallback.channels, ...saved.channels },
      roleCapabilities: { ...fallback.roleCapabilities, ...saved.roleCapabilities },
      members: Array.isArray(saved.members) ? saved.members : fallback.members,
      sessions: Array.isArray(saved.sessions) ? saved.sessions : fallback.sessions,
      domains: Array.isArray(saved.domains) ? saved.domains : fallback.domains,
    };
  } catch { return null; }
}

function writeFixtureSettings(workspaceId: string, value: FixtureSettings) {
  try {
    const stored = window.sessionStorage.getItem(SETTINGS_FIXTURE_KEY);
    const directory = stored ? JSON.parse(stored) as Record<string, FixtureSettings> : {};
    window.sessionStorage.setItem(SETTINGS_FIXTURE_KEY, JSON.stringify({ ...directory, [workspaceId]: value }));
  } catch { /* Settings remains usable when browser storage is locked. */ }
}

function SettingsCard({ rows }: { rows: Array<{ label: string; value: React.ReactNode; action?: React.ReactNode }> }) {
  return <div className="r22-settings-card">{rows.map((row) => <div className="r22-settings-row" key={row.label}><b>{row.label}</b><span>{row.value}</span>{row.action ?? <span />}</div>)}</div>;
}

function Section({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <><h1>{title}</h1><p className="r22-settings-intro">{intro}</p>{children}</>;
}

function QuietAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <Button unstyled type="button" className="r22-settings-action" onClick={onClick}>{children}</Button>;
}

function SpendCapControl({ value, onNotice, fixture = false, onFixtureSave }: { value: number | null; onNotice: (message: string) => void; fixture?: boolean; onFixtureSave?: (value: number) => void }) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  if (value === null) return <span className="r22-settings-muted">Could not load</span>;
  return <form className="r22-settings-inline-control" onSubmit={async (event) => {
    event.preventDefault();
    const next = Number(draft);
    if (!Number.isInteger(next) || next < 0) return onNotice("Spend cap must be a whole number of credits, 0 or more.");
    if (fixture) { onFixtureSave?.(next); return onNotice("Spend cap updated in this fixture only. No server setting changed."); }
    setBusy(true);
    const result = await setOwnerSetting("spendCapCredits", next);
    setBusy(false);
    onNotice("error" in result ? result.error : "Spend cap saved.");
  }}><Input unstyled aria-label="Spend cap in credits" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} /><span>cr per action</span><Button unstyled type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></form>;
}

function DisconnectMetaAction({ onNotice, fixture = false }: { onNotice: (message: string) => void; fixture?: boolean }) {
  const [busy, setBusy] = useState(false);
  const disconnect = async () => {
    if (fixture) return;
    setBusy(true);
    const result = await disconnectMeta();
    setBusy(false);
    onNotice("error" in result ? result.error : "Meta disconnected. Refreshing connection status…");
    if (!("error" in result)) window.location.reload();
  };
  return <AlertDialog><AlertDialogTrigger asChild><Button unstyled type="button" className="r22-settings-action" disabled={busy}>{busy ? "Disconnecting…" : "Disconnect Meta"}</Button></AlertDialogTrigger><AlertDialogContent className="r22-settings-confirm"><AlertDialogHeader><AlertDialogTitle>Disconnect Meta?</AlertDialogTitle><AlertDialogDescription>Instagram and Facebook will both stop using this workspace connection. Scheduled posts will stay visible but cannot be described as publishable.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep connected</AlertDialogCancel><AlertDialogAction disabled={busy || fixture} onClick={() => void disconnect()}>{fixture ? "Fixture does not write" : "Disconnect Meta"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

type FixtureSurfaceState = "ready" | "loading" | "error" | "permission" | "unknown";

export function R22SettingsShell({ data, initialSection = "workspace", fixture = false, fixtureState = "ready", fixtureOutcome = "success" }: { data: R22SettingsData; initialSection?: R22SettingsSection; fixture?: boolean; fixtureState?: FixtureSurfaceState; fixtureOutcome?: "success" | "error" | "conflict" | "unknown" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [section, setSection] = useState<R22SettingsSection>(initialSection);
  const [notice, setNotice] = useState("");
  const [workspaceName, setWorkspaceName] = useState(data.workspaceName);
  const [displayName, setDisplayName] = useState(data.displayName);
  const [timezone, setTimezone] = useState(data.timezone);
  const [language, setLanguage] = useState("English");
  const [startOfWeek, setStartOfWeek] = useState("Monday");
  const [defaultHome, setDefaultHome] = useState("Home");
  const [members, setMembers] = useState<FixtureMember[]>(fixture ? [{ id: "fixture-founder", name: data.displayName || "Nadia", email: data.email, role: "Admin", status: "Active" }] : []);
  const [notifications, setNotifications] = useState({ inApp: true, email: true, approval: true, publishFailed: true, routine: false });
  const [sessions, setSessions] = useState<FixtureSession[]>([{ id: "current", label: "Current session", detail: "Kuala Lumpur · Safari · active now", current: true }, { id: "studio", label: "Studio Mac", detail: "Kuala Lumpur · Chrome · 2 days ago", current: false }]);
  const [connectedAccounts, setConnectedAccounts] = useState({ google: true, canva: false });
  const [domains, setDomains] = useState<FixtureDomain[]>([{ id: "batikhouse", name: data.email.includes("@") ? data.email.split("@")[1]! : "batikhouse.my", status: "Verified" }]);
  const [channels, setChannels] = useState({ instagram: true, facebook: false });
  const [fixtureBalance, setFixtureBalance] = useState(data.balance ?? 1240);
  const [plan, setPlan] = useState("Studio · monthly");
  const [spendCap, setSpendCap] = useState(data.spendCapCredits ?? 40);
  const [fixtureReady, setFixtureReady] = useState(!fixture);
  const [activeAction, setActiveAction] = useState("");
  const [actionValue, setActionValue] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Editor");
  const [roleCapabilities, setRoleCapabilities] = useState<Record<"Admin" | "Editor" | "Approver", FixtureCapabilities>>({ Admin: { create: true, approve: true, publish: true, billing: true }, Editor: { create: true, approve: false, publish: false, billing: false }, Approver: { create: false, approve: true, publish: true, billing: false } });
  const [permissionDraft, setPermissionDraft] = useState<FixtureCapabilities>({ create: true, approve: false, publish: false, billing: false });
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionFailedOnce, setActionFailedOnce] = useState(false);
  const [secondaryValue, setSecondaryValue] = useState("");
  const [workspaceDirectory, setWorkspaceDirectory] = useState<R22FixtureWorkspaceDirectory>(DEFAULT_R22_WORKSPACE_DIRECTORY);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(DEFAULT_R22_WORKSPACE_DIRECTORY.activeId);
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false);
  const [workspaceSwitchFailedOnce, setWorkspaceSwitchFailedOnce] = useState(false);
  const initials = workspaceName.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  const fixtureFallback = (name: string): FixtureSettings => ({
    workspaceName: name,
    displayName: data.displayName,
    timezone: data.timezone,
    language: "English",
    startOfWeek: "Monday",
    defaultHome: "Home",
    members: [{ id: "fixture-founder", name: data.displayName || "Nadia", email: data.email, role: "Admin", status: "Active" }],
    notifications: { inApp: true, email: true, approval: true, publishFailed: true, routine: false },
    sessions: [{ id: "current", label: "Current session", detail: "Kuala Lumpur · Safari · active now", current: true }, { id: "studio", label: "Studio Mac", detail: "Kuala Lumpur · Chrome · 2 days ago", current: false }],
    connectedAccounts: { google: true, canva: false },
    domains: [{ id: slugifyR22Workspace(name), name: name === "Batik House" ? "batikhouse.my" : `${slugifyR22Workspace(name)}.my`, status: "Verified" }],
    channels: name === "Batik House" ? { instagram: true, facebook: false } : { instagram: false, facebook: false },
    balance: name === "Batik House" ? data.balance ?? 1240 : 600,
    plan: "Studio · monthly",
    roleCapabilities: { Admin: { create: true, approve: true, publish: true, billing: true }, Editor: { create: true, approve: false, publish: false, billing: false }, Approver: { create: false, approve: true, publish: true, billing: false } },
    spendCap: data.spendCapCredits ?? 40,
  });

  const applyFixtureSettings = (saved: FixtureSettings) => {
    setWorkspaceName(saved.workspaceName); setDisplayName(saved.displayName); setTimezone(saved.timezone); setLanguage(saved.language); setStartOfWeek(saved.startOfWeek); setDefaultHome(saved.defaultHome); setMembers(saved.members); setNotifications(saved.notifications); setSessions(saved.sessions); setConnectedAccounts(saved.connectedAccounts); setDomains(saved.domains); setChannels(saved.channels); setFixtureBalance(saved.balance); setPlan(saved.plan); setRoleCapabilities(saved.roleCapabilities); setSpendCap(saved.spendCap);
  };

  useEffect(() => {
    if (!fixture) return;
    const directory = readR22WorkspaceDirectory();
    const active = directory.workspaces.find((workspace) => workspace.id === directory.activeId) ?? directory.workspaces[0]!;
    const fallback = fixtureFallback(active.name);
    const saved = readFixtureSettings(active.id, fallback) ?? fallback;
    setWorkspaceDirectory(directory);
    setActiveWorkspaceId(active.id);
    applyFixtureSettings(saved);
    setFixtureReady(true);
    // The fallback is intentionally captured only once; later writes use the persistence effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture]);

  useEffect(() => {
    if (!fixture || !fixtureReady) return;
    writeFixtureSettings(activeWorkspaceId, { workspaceName, displayName, timezone, language, startOfWeek, defaultHome, members, notifications, sessions, connectedAccounts, domains, channels, balance: fixtureBalance, plan, roleCapabilities, spendCap });
  }, [activeWorkspaceId, channels, connectedAccounts, defaultHome, displayName, domains, fixture, fixtureBalance, fixtureReady, language, members, notifications, plan, roleCapabilities, sessions, spendCap, startOfWeek, timezone, workspaceName]);

  const openAction = (label: string) => {
    setActiveAction(label); setActionError(""); setActionSuccess(""); setActionFailedOnce(false); setWorkspaceSwitchFailedOnce(false); setInviteEmail(""); setInviteRole("Editor"); setSecondaryValue("");
    setActionValue(label.includes("timezone") || label === "Change" ? timezone : label.includes("language") ? language : label.includes("start of week") ? startOfWeek : label.includes("default home") ? defaultHome : label === "Edit" ? workspaceName : label === "Edit profile" ? displayName : label.startsWith("Change role:") ? members.find((member) => member.id === label.split(":")[1])?.role ?? "Editor" : label === "Top up" ? "200" : label === "Change plan" ? plan : "");
    if (label === "View Admin" || label === "View Editor" || label === "View Approver") {
      const role = label.replace("View ", "") as keyof typeof roleCapabilities;
      setPermissionDraft(roleCapabilities[role]);
    }
  };
  const action = (label: string) => <QuietAction onClick={() => {
    if (label === "Copy") {
      void navigator.clipboard?.writeText(`fikirtive.com/${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).then(() => setNotice("Workspace URL copied."), () => setNotice("The workspace URL could not be copied. Nothing else changed."));
      return;
    }
    openAction(label);
  }}>{label}</QuietAction>;

  const switchFixtureWorkspace = (workspaceId: string) => {
    if (!fixture || workspaceId === activeWorkspaceId || workspaceSwitching) return;
    setWorkspaceSwitching(true); setActionError("");
    writeFixtureSettings(activeWorkspaceId, { workspaceName, displayName, timezone, language, startOfWeek, defaultHome, members, notifications, sessions, connectedAccounts, domains, channels, balance: fixtureBalance, plan, roleCapabilities, spendCap });
    window.setTimeout(() => {
      if (fixtureOutcome !== "success" && !workspaceSwitchFailedOnce) {
        setWorkspaceSwitchFailedOnce(true);
        setWorkspaceSwitching(false);
        setActionError(fixtureOutcome === "conflict" ? "Workspace access changed elsewhere. The current workspace remains active; retry the same switch after review." : fixtureOutcome === "unknown" ? "Workspace switch outcome is unknown. The current workspace remains active; check this same switch before selecting another." : "The workspace directory did not confirm the switch. The current workspace remains active; retry is safe.");
        return;
      }
      const nextWorkspace = workspaceDirectory.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!nextWorkspace) {
        setWorkspaceSwitching(false); setActionError("This workspace is no longer in the authorized directory."); return;
      }
      setFixtureReady(false);
      const fallback = fixtureFallback(nextWorkspace.name);
      applyFixtureSettings(readFixtureSettings(nextWorkspace.id, fallback) ?? fallback);
      const nextDirectory = { ...workspaceDirectory, activeId: nextWorkspace.id };
      setWorkspaceDirectory(nextDirectory); setActiveWorkspaceId(nextWorkspace.id); writeR22WorkspaceDirectory(nextDirectory);
      setWorkspaceSwitching(false); setFixtureReady(true); setActiveAction("");
      setNotice(`Switched to ${nextWorkspace.name}. Workspace-scoped settings were reloaded before display.`);
    }, 320);
  };

  const submitAction = () => {
    if (actionBusy) return;
    setActionError(""); setActionSuccess("");
    if (activeAction === "Invite member") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) return setActionError("Enter a complete email address.");
      if (members.some((member) => member.email.toLowerCase() === inviteEmail.trim().toLowerCase())) return setActionError("This person is already listed in the workspace.");
    } else if (activeAction === "Add domain") {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(actionValue.trim())) return setActionError("Enter a complete domain, such as example.com.");
      if (domains.some((domain) => domain.name.toLowerCase() === actionValue.trim().toLowerCase())) return setActionError("This domain is already listed.");
    } else if (activeAction === "Top up") {
      if (!Number.isInteger(Number(actionValue)) || Number(actionValue) <= 0) return setActionError("Choose a whole number of credits above 0.");
    } else if (activeAction === "Manage sign-in") {
      if (actionValue.length < 8) return setActionError("Use at least 8 characters for the new password.");
      if (actionValue !== secondaryValue) return setActionError("The password confirmation does not match.");
    } else if (activeAction === "Edit profile" && !actionValue.trim()) {
      return setActionError("Enter your display name.");
    } else if (activeAction === "Create workspace") {
      if (actionValue.trim().length < 2) return setActionError("Enter a workspace name with at least 2 characters.");
      if (workspaceDirectory.workspaces.some((workspace) => workspace.name.toLowerCase() === actionValue.trim().toLowerCase())) return setActionError("A workspace with this name is already in the fixture directory.");
    } else if (["Edit", "Change timezone", "Change", "Change language", "Change default language", "Change start of week", "Change default home"].includes(activeAction) && !actionValue.trim()) return setActionError("Choose or enter a value before saving.");
    if (!fixture) return setActionError(`${activeAction} is not connected to a production mutation yet. Nothing changed.`);
    const fixtureActions = ["Invite member", "Edit", "Edit profile", "Create workspace", "Change", "Change timezone", "Change language", "Change default language", "Change start of week", "Change default home", "Manage sign-in", "Connect Google", "Disconnect Google", "Connect Canva", "Disconnect Canva", "Top up", "Change plan", "Add domain", "Connect Instagram", "Connect Facebook", "Disconnect Instagram", "Disconnect Facebook"];
    if (!fixtureActions.includes(activeAction) && !activeAction.startsWith("View ") && !activeAction.startsWith("Change role:") && !activeAction.startsWith("Remove member:") && !activeAction.startsWith("Verify domain:")) return setActionError(`${activeAction} needs its backend contract. This fixture does not pretend it changed.`);
    setActionBusy(true);
    window.setTimeout(() => {
      if (fixtureOutcome !== "success" && !actionFailedOnce) {
        setActionFailedOnce(true);
        setActionBusy(false);
        setActionError(fixtureOutcome === "conflict" ? "This setting changed elsewhere. Review the latest value and retry the same change." : fixtureOutcome === "unknown" ? "This setting outcome is unknown. Check this same change before starting another; nothing is assumed saved." : "The settings adapter did not confirm the change. Nothing changed; retry is safe.");
        return;
      }
      if (activeAction === "Create workspace") {
        const baseId = slugifyR22Workspace(actionValue);
        const id = workspaceDirectory.workspaces.some((workspace) => workspace.id === baseId) ? `${baseId}-${workspaceDirectory.workspaces.length + 1}` : baseId;
        const nextWorkspace = { id, name: actionValue.trim(), role: "Admin" as const };
        const nextDirectory = { activeId: id, workspaces: [...workspaceDirectory.workspaces, nextWorkspace] };
        const nextSettings = fixtureFallback(nextWorkspace.name);
        writeFixtureSettings(id, nextSettings); writeR22WorkspaceDirectory(nextDirectory);
        setFixtureReady(false); setWorkspaceDirectory(nextDirectory); setActiveWorkspaceId(id); applyFixtureSettings(nextSettings); setFixtureReady(true);
      } else if (activeAction === "Invite member") setMembers((current) => [...current, { id: `fixture-member-${slugifyR22Workspace(inviteEmail)}`, name: inviteEmail.split("@")[0]!, email: inviteEmail.trim(), role: inviteRole, status: "Invited" }]);
      else if (activeAction === "Edit") {
        const name = actionValue.trim();
        setWorkspaceName(name);
        const nextDirectory = { ...workspaceDirectory, workspaces: workspaceDirectory.workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, name } : workspace) };
        setWorkspaceDirectory(nextDirectory); writeR22WorkspaceDirectory(nextDirectory);
      }
      else if (activeAction === "Edit profile") setDisplayName(actionValue.trim());
      else if (activeAction.includes("timezone") || activeAction === "Change") setTimezone(actionValue);
      else if (activeAction.includes("language")) setLanguage(actionValue);
      else if (activeAction.includes("start of week")) setStartOfWeek(actionValue);
      else if (activeAction.includes("default home")) setDefaultHome(actionValue);
      else if (activeAction === "Connect Canva") setConnectedAccounts((current) => ({ ...current, canva: true }));
      else if (activeAction === "Disconnect Canva") setConnectedAccounts((current) => ({ ...current, canva: false }));
      else if (activeAction === "Connect Google") setConnectedAccounts((current) => ({ ...current, google: true }));
      else if (activeAction === "Disconnect Google") setConnectedAccounts((current) => ({ ...current, google: false }));
      else if (activeAction === "Top up") setFixtureBalance((current) => current + Number(actionValue));
      else if (activeAction === "Change plan") setPlan(actionValue);
      else if (activeAction.startsWith("View ")) setRoleCapabilities((current) => ({ ...current, [activeAction.replace("View ", "")]: permissionDraft }));
      else if (activeAction === "Add domain") setDomains((current) => [...current, { id: `fixture-domain-${slugifyR22Workspace(actionValue)}`, name: actionValue.trim().toLowerCase(), status: "Pending" }]);
      else if (activeAction.startsWith("Verify domain:")) setDomains((current) => current.map((domain) => domain.id === activeAction.split(":")[1] ? { ...domain, status: "Verified" } : domain));
      else if (activeAction.startsWith("Change role:")) setMembers((current) => current.map((member) => member.id === activeAction.split(":")[1] ? { ...member, role: actionValue } : member));
      else if (activeAction.startsWith("Remove member:")) setMembers((current) => current.filter((member) => member.id !== activeAction.split(":")[1]));
      else if (activeAction === "Connect Instagram") setChannels((current) => ({ ...current, instagram: true }));
      else if (activeAction === "Connect Facebook") setChannels((current) => ({ ...current, facebook: true }));
      else if (activeAction === "Disconnect Instagram") setChannels((current) => ({ ...current, instagram: false }));
      else if (activeAction === "Disconnect Facebook") setChannels((current) => ({ ...current, facebook: false }));
      const successCopy = activeAction === "Invite member" ? "Invitation prepared in this fixture." : activeAction === "Create workspace" ? `${actionValue.trim()} created and opened in this fixture.` : activeAction === "Top up" ? `${actionValue} credits added in this fixture.` : activeAction.startsWith("Remove member:") ? "Member removed from this fixture workspace." : activeAction.startsWith("Verify domain:") ? "Domain verified in this fixture." : `${activeAction.split(":")[0]} saved in this fixture.`;
      setActionBusy(false); setActionSuccess(successCopy);
    }, 420);
  };

  const choose = (next: R22SettingsSection) => {
    setSection(next);
    setNotice("");
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set("section", next);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  let content: React.ReactNode;
  switch (section) {
    case "preferences":
      content = <Section title="Preferences" intro="Personal display and workflow defaults."><div className="r22-settings-section"><h2>Experience</h2><SettingsCard rows={[{ label: "Spend cap", value: <SpendCapControl value={fixture ? spendCap : data.spendCapCredits} onNotice={setNotice} fixture={fixture} onFixtureSave={setSpendCap} /> }, { label: "Language", value: language, action: action("Change language") }, { label: "Start of week", value: startOfWeek, action: action("Change start of week") }, { label: "Default home", value: defaultHome, action: action("Change default home") }]} /></div><p className="r22-settings-note">Creative defaults live in <Link href={fixture ? "/brand?fixture=r22" : "/brand"}>Otto IQ</Link>, so brand knowledge remains in one place.</p></Section>;
      break;
    case "profile":
      content = <Section title="Profile" intro="Your personal identity across every workspace."><div className="r22-settings-section"><h2>Profile details</h2><SettingsCard rows={[{ label: "Name", value: displayName || "Not set", action: fixture ? action("Edit profile") : <Link className="r22-settings-action" href="/profile">Edit</Link> }, { label: "Email", value: data.email }, { label: "Role", value: "Workspace member", action: <i className="r22-settings-pill">Authenticated</i> }]} /></div></Section>;
      break;
    case "notifications":
      content = <Section title="Notifications" intro="Choose what needs your attention and where it reaches you."><div className="r22-settings-section"><h2>Delivery channels</h2><SettingsCard rows={[{ label: "In-app", value: fixture ? "Workspace feed" : "Backend adapter unavailable", action: <Switch unstyled checked={fixture && notifications.inApp} disabled={!fixture || actionBusy} aria-label="In-app notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, inApp: checked }))} /> }, { label: "Email", value: fixture ? data.email : "Backend adapter unavailable", action: <Switch unstyled checked={fixture && notifications.email} disabled={!fixture || actionBusy} aria-label="Email notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, email: checked }))} /> }]} /></div><div className="r22-settings-section"><h2>Event preferences</h2><SettingsCard rows={[{ label: "Approval needed", value: notifications.inApp || notifications.email ? "Uses enabled channels" : "Delivery off", action: <Switch unstyled checked={fixture && notifications.approval} disabled={!fixture || (!notifications.inApp && !notifications.email)} aria-label="Approval needed notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, approval: checked }))} /> }, { label: "Publish failed", value: notifications.inApp || notifications.email ? "Uses enabled channels" : "Delivery off", action: <Switch unstyled checked={fixture && notifications.publishFailed} disabled={!fixture || (!notifications.inApp && !notifications.email)} aria-label="Publish failed notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, publishFailed: checked }))} /> }, { label: "Routine completed", value: notifications.inApp || notifications.email ? "Uses enabled channels" : "Delivery off", action: <Switch unstyled checked={fixture && notifications.routine} disabled={!fixture || (!notifications.inApp && !notifications.email)} aria-label="Routine completed notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, routine: checked }))} /> }]} /></div><p className="r22-settings-contract">{fixture ? "These controls update the non-production notification fixture only. Production delivery still requires a durable server receipt." : "Channel masters and event preferences will be saved together once the server-backed notification store exists. Nothing on this page claims delivery or saves a fake preference."}</p></Section>;
      break;
    case "security":
      content = <Section title="Security and access" intro="Protect your account and review active sessions."><div className="r22-settings-section"><h2>Account access</h2><SettingsCard rows={[{ label: "Sign-in method", value: fixture ? "Email and password" : "Session-authenticated account", action: action("Manage sign-in") }, { label: "Active sessions", value: fixture ? `${sessions.length} sessions` : "Session list not connected", action: action("Review sessions") }]} /></div></Section>;
      break;
    case "connected":
      content = <Section title="Connected accounts" intro="Personal services connected to your Fikirtive account."><div className="r22-settings-section"><h2>Accounts</h2><SettingsCard rows={[{ label: "Google", value: fixture ? connectedAccounts.google ? `Connected as ${data.email}` : "Not connected" : "Status not exposed by the account contract", action: fixture ? action(connectedAccounts.google ? "Disconnect Google" : "Connect Google") : undefined }, { label: "Canva", value: fixture ? connectedAccounts.canva ? "Connected to personal account" : "Not connected" : "Not connected", action: fixture ? action(connectedAccounts.canva ? "Disconnect Canva" : "Connect Canva") : undefined }]} /></div><p className="r22-settings-contract">Personal connections do not grant access to a client workspace. Workspace publishing channels remain under Connections.</p></Section>;
      break;
    case "members":
      content = <Section title="Members" intro={`Manage access to ${workspaceName} without exposing other workspaces.`}><div className="r22-settings-section"><div className="r22-settings-section-head"><h2>Workspace members</h2>{action("Invite member")}</div><div className="r22-settings-card"><div className="r22-settings-members"><div><b>Member</b><b>Role</b><b>Status</b></div>{fixture ? members.map((member) => <div key={member.id}><span><b>{member.name}</b><small>{member.email}</small></span><span>{member.role}</span><span><i className="r22-settings-pill">{member.status}</i>{member.id !== "fixture-founder" ? <><Button unstyled type="button" className="r22-settings-row-action" onClick={() => openAction(`Change role:${member.id}`)}>Change role</Button><Button unstyled type="button" className="r22-settings-row-action is-danger" onClick={() => openAction(`Remove member:${member.id}`)}>Remove</Button></> : null}</span></div>) : <div><span><b>{data.displayName || data.email}</b><small>{data.email}</small></span><span>Authenticated member</span><span><i className="r22-settings-pill">Active</i></span></div>}</div></div></div><p className="r22-settings-contract">{fixture ? "Invited members stay in this non-production workspace fixture. Role and remove actions require explicit confirmation." : "The current frontend contract exposes the signed-in member only. It will not invent additional workspace members."}</p></Section>;
      break;
    case "roles":
      content = <Section title="Roles and permissions" intro="Control capabilities for this client workspace."><div className="r22-settings-section"><h2>Workspace roles</h2><SettingsCard rows={[{ label: "Admin", value: "Full workspace and billing access", action: action("View Admin") }, { label: "Editor", value: "Create, edit and submit for approval", action: action("View Editor") }, { label: "Approver", value: "Review and approve published work", action: action("View Approver") }]} /></div><p className="r22-settings-contract">Role names are summaries. Server authorization continues to check concrete permissions and resource scope.</p></Section>;
      break;
    case "connections":
      content = <Section title="Connections" intro="Channels and tools connected to this workspace."><div className="r22-settings-section"><h2>Publishing channels</h2><div className="r22-settings-card">{fixture ? ([{ id: "instagram", label: "Instagram", connected: channels.instagram }, { id: "facebook", label: "Facebook", connected: channels.facebook }] as const).map((channel) => <div className="r22-settings-row" key={channel.id}><b>{channel.label}</b><span>{channel.connected ? `@${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "")} · connected` : "Not connected"}</span>{action(`${channel.connected ? "Disconnect" : "Connect"} ${channel.label}`)}</div>) : data.channels.length ? data.channels.map((channel) => <div className="r22-settings-row" key={channel.id}><b>{channel.label}</b><span>{channel.statusLabel}</span>{channel.status === "connected" ? <span className="r22-settings-muted">Connected through Meta</span> : channel.connectUrl ? <a className="r22-settings-action" href={channel.connectUrl}>{channel.status === "needs_reconnect" ? "Reconnect" : "Connect"}</a> : <span className="r22-settings-muted">Not available</span>}</div>) : <div className="r22-settings-empty-row">Connection status could not be read. No channel was assumed disconnected.</div>}</div>{!fixture && data.channels.some((channel) => channel.status === "connected" && (channel.id === "instagram" || channel.id === "facebook")) ? <div className="r22-settings-section-action"><DisconnectMetaAction onNotice={setNotice} /></div> : null}</div><p className="r22-settings-contract">Connection changes are workspace-scoped. Disconnecting never deletes Schedule history; it moves publishable work to held-connection.</p></Section>;
      break;
    case "billing":
      content = <Section title="Billing and credits" intro="One place for the workspace balance, plan and credit history."><div className="r22-settings-section"><h2>Current balance</h2><SettingsCard rows={[{ label: "Credits", value: data.balance === null ? "Could not load" : <><b className="r22-settings-mono">{fixture ? fixtureBalance.toLocaleString("en-US") : data.balance.toLocaleString("en-US")}</b> cr available</>, action: data.accountReadable ? fixture ? action("Top up") : <Link className="r22-settings-action" href="/billing">Top up</Link> : undefined }, { label: "Workspace plan", value: fixture ? plan : "Plan contract not connected", action: fixture ? action("Change plan") : undefined }, { label: "Invoices", value: fixture ? "No invoice in this fixture" : "Invoice contract not connected", action: fixture ? action("View invoices") : undefined }]} /></div><div className="r22-settings-section"><h2>Recent credit activity</h2><div className="r22-settings-card">{!data.accountReadable ? <div className="r22-settings-empty-row">Credit activity could not be loaded. No empty history was inferred.</div> : data.recent.length ? data.recent.map((item) => <div className="r22-settings-ledger" key={item.id}><span><b>{item.label}</b><small>{item.atLabel}{item.detail ? ` · ${item.detail}` : ""}</small></span><strong>{item.delta > 0 ? "+" : ""}{item.delta} cr</strong></div>) : <div className="r22-settings-empty-row">No credit activity is available.</div>}</div></div><p className="r22-settings-contract">Top-up and plan controls are complete frontend states in fixture only. Production requires a payment receipt before the balance changes.</p></Section>;
      break;
    case "domains":
      content = <Section title="Domains" intro="Verified domains for agency and client identities."><div className="r22-settings-section"><div className="r22-settings-section-head"><h2>Verified domains</h2>{fixture ? action("Add domain") : null}</div><SettingsCard rows={fixture ? domains.map((domain) => ({ label: domain.name, value: domain.status, action: domain.status === "Pending" ? action(`Verify domain:${domain.id}`) : <i className="r22-settings-pill">Verified</i> })) : [{ label: data.email.includes("@") ? data.email.split("@")[1]! : "Workspace domain", value: "Verification status not exposed" }]} /></div><p className="r22-settings-contract">A domain is not trusted until the server verifies ownership. Fixture verification never changes DNS or production access.</p></Section>;
      break;
    case "workspace":
    default:
      content = <Section title="Workspace" intro={`Manage the identity and defaults for ${workspaceName}.`}><div className="r22-settings-section"><h2>General</h2><SettingsCard rows={[{ label: "Workspace name", value: workspaceName, action: fixture ? action("Edit") : <Link className="r22-settings-action" href="/profile">Edit</Link> }, { label: "Workspace URL", value: fixture ? <span className="r22-settings-mono">fikirtive.com/{workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}</span> : <span className="r22-settings-muted">No workspace URL contract</span>, action: fixture ? action("Copy") : undefined }, { label: "Timezone", value: timezone, action: action(fixture ? "Change" : "Change timezone") }, { label: "Default language", value: language, action: action(fixture ? "Change language" : "Change default language") }]} /></div><div className="r22-settings-section"><h2>Agency</h2><SettingsCard rows={[{ label: "Client workspace", value: fixture ? "Managed by Fikirtive agency · Nicks is an admin" : "Workspace isolation is enforced by the authenticated server principal", action: action(fixture ? "Manage" : "Manage agency") }]} /></div></Section>;
  }

  const visibleState: FixtureSurfaceState = fixture && !fixtureReady && fixtureState === "ready" ? "loading" : fixtureState;
  const retryParams = new URLSearchParams(params.toString()); retryParams.delete("state");
  const renderedContent = visibleState === "ready" ? content : <section className="r22-settings-state" role={visibleState === "error" ? "alert" : "status"} aria-busy={visibleState === "loading" || undefined}><ShieldCheck aria-hidden="true" /><h1>{visibleState === "loading" ? `Loading ${section} settings…` : visibleState === "permission" ? "This settings section is not available to this member" : visibleState === "unknown" ? "This settings read outcome is unknown" : "This settings section could not be loaded"}</h1><p>{visibleState === "loading" ? "The active workspace is being re-authorized. Old workspace values are not shown while this read is pending." : visibleState === "permission" ? "Ask an administrator for the concrete capability required by this section. A role name alone does not grant it." : visibleState === "unknown" ? "The read may still finish. No setting or default value was inferred; retry this same workspace-scoped read." : "No default or empty value was inferred. Retry the same workspace-scoped read."}</p>{visibleState === "error" || visibleState === "unknown" ? <Link href={`${pathname}?${retryParams.toString()}`}>Retry</Link> : null}</section>;

  const destructiveAction = activeAction.startsWith("Remove member:") || activeAction.startsWith("Disconnect ");
  const showSubmit = activeAction !== "Review sessions" && activeAction !== "View invoices" && activeAction !== "Manage";
  let dialogFields: React.ReactNode;
  if (activeAction === "Invite member") dialogFields = <><label>Email<Input unstyled autoFocus type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" /></label><label>Role<SelectNative unstyled value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option>Editor</option><option>Approver</option><option>Admin</option></SelectNative></label></>;
  else if (activeAction === "Review sessions") dialogFields = <div className="r22-settings-session-list">{sessions.map((session) => <div key={session.id}><span><b>{session.label}</b><small>{session.detail}</small></span>{session.current ? <i className="r22-settings-pill">Current</i> : <Button unstyled type="button" onClick={() => { setSessions((current) => current.filter((item) => item.id !== session.id)); setNotice("Session revoked in this fixture."); }}>Revoke</Button>}</div>)}</div>;
  else if (activeAction === "View invoices") dialogFields = <div className="r22-settings-dialog-empty"><b>No invoices in this R22 fixture</b><p>Production invoices remain unavailable until the billing adapter returns an authorized workspace list.</p></div>;
  else if (activeAction === "Manage") dialogFields = <div className="r22-settings-workspace-directory" aria-busy={workspaceSwitching || undefined}><div className="r22-settings-workspace-directory-head"><span><b>Client workspaces</b><small>Only workspaces in this authorized fixture directory are shown.</small></span><Button unstyled type="button" disabled={workspaceSwitching} onClick={() => openAction("Create workspace")}>Create workspace</Button></div>{workspaceDirectory.workspaces.map((workspace) => { const current = workspace.id === activeWorkspaceId; return <div className="r22-settings-workspace-directory-row" key={workspace.id}><span className="r22-settings-workspace-directory-avatar">{workspace.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</span><span><b>{workspace.name}</b><small>{workspace.role} access</small></span>{current ? <i className="r22-settings-pill">Current</i> : <Button unstyled type="button" disabled={workspaceSwitching} onClick={() => switchFixtureWorkspace(workspace.id)}>{workspaceSwitching ? "Authorizing…" : "Switch"}</Button>}</div>; })}{actionError ? <p role="alert">{actionError}</p> : null}</div>;
  else if (activeAction.startsWith("View ")) dialogFields = <div className="r22-settings-permissions">{([['create','Create and edit'],['approve','Approve work'],['publish','Publish approved work'],['billing','Manage billing']] as const).map(([key,label]) => <label key={key}><span>{label}</span><Switch unstyled checked={permissionDraft[key]} onCheckedChange={(checked) => setPermissionDraft((current) => ({ ...current, [key]: checked }))} aria-label={label} /></label>)}</div>;
  else if (activeAction === "Manage sign-in") dialogFields = <><label>New password<Input unstyled autoFocus type="password" value={actionValue} onChange={(event) => setActionValue(event.target.value)} /></label><label>Confirm password<Input unstyled type="password" value={secondaryValue} onChange={(event) => setSecondaryValue(event.target.value)} /></label></>;
  else if (activeAction.startsWith("Change role:")) dialogFields = <label>Workspace role<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option>Editor</option><option>Approver</option><option>Admin</option></SelectNative></label>;
  else if (activeAction === "Top up") dialogFields = <label>Credits<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option value="200">200 credits</option><option value="500">500 credits</option><option value="1000">1,000 credits</option></SelectNative></label>;
  else if (activeAction === "Change plan") dialogFields = <label>Workspace plan<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option>Starter · monthly</option><option>Studio · monthly</option><option>Agency · monthly</option></SelectNative></label>;
  else if (activeAction === "Add domain") dialogFields = <label>Domain<Input unstyled autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} placeholder="example.com" /></label>;
  else if (activeAction === "Create workspace") dialogFields = <><label>Workspace name<Input unstyled autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} placeholder="Client or brand name" /></label><div className="r22-settings-dialog-empty"><b>A separate workspace boundary will be created</b><p>Members, roles, channels, credits and settings start from an isolated fixture state. Data from {workspaceName} is not copied.</p></div></>;
  else if (activeAction.includes("timezone") || activeAction === "Change") dialogFields = <label>Timezone<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur · GMT+8</option><option value="Asia/Singapore">Asia/Singapore · GMT+8</option><option value="UTC">UTC · GMT+0</option></SelectNative></label>;
  else if (activeAction.includes("language")) dialogFields = <label>Language<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option>English</option><option>Bahasa Malaysia</option><option>Chinese</option></SelectNative></label>;
  else if (activeAction.includes("start of week")) dialogFields = <label>Start of week<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option>Monday</option><option>Sunday</option></SelectNative></label>;
  else if (activeAction.includes("default home")) dialogFields = <label>Default home<SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option>Home</option><option>Canvas</option><option>Approvals</option></SelectNative></label>;
  else if (destructiveAction || activeAction.startsWith("Connect ") || activeAction.startsWith("Verify domain:")) dialogFields = <div className="r22-settings-dialog-empty"><b>{destructiveAction ? "Review the consequence before continuing" : "This fixture will update only the active workspace"}</b><p>{activeAction.startsWith("Disconnect ") ? "Scheduled work stays visible and moves to held-connection. No provider or production account is changed." : activeAction.startsWith("Remove member:") ? "The member loses access to this fixture workspace only. Their personal account is not deleted." : "No external provider, DNS record or production permission is changed."}</p></div>;
  else dialogFields = <label>{activeAction === "Edit profile" ? "Display name" : "Workspace name"}<Input unstyled autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} /></label>;

  return <main className="r22-settings-shell" data-r22-settings data-fixture={fixture || undefined}><aside className="r22-settings-nav" aria-label="Settings sections"><Link href={fixture ? "/?fixture=r22" : "/"} className="r22-settings-back"><ChevronLeft />Back to app</Link>{GROUPS.map((group) => <div className="r22-settings-group" key={group.label}><p>{group.label}</p>{group.items.map((item) => { const Icon = item.icon; return <Button unstyled type="button" key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => choose(item.id)}><Icon aria-hidden="true" />{item.label}</Button>; })}</div>)}<div className="r22-settings-workspace"><span>{initials}</span><b>{workspaceName}</b></div></aside><section className="r22-settings-content" aria-live="polite">{data.dataError && <p className="r22-settings-error" role="alert">Some settings could not be loaded: {data.dataError}. Missing values were not inferred.</p>}{notice && <p className="r22-settings-notice" role="status">{notice}</p>}{renderedContent}</section>
    <Dialog open={Boolean(activeAction)} onOpenChange={(open) => { if (!open && !actionBusy && !workspaceSwitching) setActiveAction(""); }}><DialogContent className="r22-settings-dialog" showCloseButton={false}>{actionSuccess ? <div className="r22-settings-action-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>{actionSuccess}</DialogTitle><DialogDescription>No production setting, provider, DNS record or external invitation was changed.</DialogDescription><Button unstyled type="button" onClick={() => setActiveAction("")}>Done</Button></div> : <><DialogHeader><DialogTitle>{activeAction.includes(":") ? activeAction.split(":")[0] : activeAction}</DialogTitle><DialogDescription>{activeAction === "Invite member" ? `Invite someone to ${workspaceName} with a specific workspace role.` : activeAction === "Manage" ? "Switch only after the selected workspace is authorized and its scoped data is ready." : activeAction === "View invoices" ? "Review invoices returned for the active workspace only." : activeAction === "View Admin" || activeAction === "View Editor" || activeAction === "View Approver" ? "Review the concrete capabilities in this role. Server authorization still checks each resource." : destructiveAction ? "This action affects only the active workspace and requires confirmation." : "Review the value before saving it to this workspace."}</DialogDescription></DialogHeader><div className="r22-settings-dialog-fields">{dialogFields}{activeAction !== "Manage" && actionError ? <p role="alert">{actionError}</p> : null}</div><DialogFooter><Button unstyled type="button" disabled={actionBusy || workspaceSwitching} onClick={() => setActiveAction("")}>{showSubmit ? "Cancel" : "Done"}</Button>{showSubmit ? <Button unstyled type="button" className={destructiveAction ? "is-danger" : undefined} disabled={actionBusy || workspaceSwitching} onClick={submitAction}>{actionBusy ? "Saving…" : activeAction === "Invite member" ? "Send invitation" : activeAction === "Create workspace" ? "Create workspace" : activeAction === "View Admin" || activeAction === "View Editor" || activeAction === "View Approver" ? "Save role" : destructiveAction ? "Confirm" : "Save changes"}</Button> : null}</DialogFooter></>}</DialogContent></Dialog>
  </main>;
}
