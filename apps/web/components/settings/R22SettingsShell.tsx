"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { SelectNative } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ShieldCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { BETA_SETTINGS_SECTIONS, R22_SETTINGS_SECTION_LABELS, SETTINGS_GROUPS, type R22SettingsSection } from "./r22-settings-sections";
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
/** 分节名单与 beta 收窄名单的权威在 `r22-settings-sections.ts`(壳是 client,服务端取不了它的值)。 */
export type { R22SettingsSection } from "./r22-settings-sections";

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

/**
 * 每一节末尾那段边界说明,收进按需层(审计 B-3,判尺③/⑥)。
 *
 * 此前 Settings 有 7 段 `r22-settings-contract` 加 1 段 `r22-settings-note`,每一段都
 * **永远在屏幕上**。话本身没错 —— 它们说的是「这个开关到底改了什么、没改什么」,商家
 * 真要动那一行的时候必须读得到。问题是他不动的时候也得读:一屏能看的地方就那么大,
 * 常驻的解释句每多一段,真正在做的事就少一格。
 *
 * 所以内容一个字没改,只是从常驻改成按需 —— 触发字样是三个词以内的标签,不是句子。
 * 用 `collapsible` 而不是 `tooltip`,因为这几段里有带链接的、也有两句长的:tooltip 里
 * 的链接键盘到不了,长句子也读不下来。
 */
function SectionNote({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <Collapsible className="r22-settings-note-fold" data-r22-settings-note={id}>
      <CollapsibleTrigger className="r22-settings-note-trigger">What changes here<ChevronDown aria-hidden="true" /></CollapsibleTrigger>
      <CollapsibleContent className="r22-settings-note-body"><p>{children}</p></CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 对话框里的一行表单,归位 `ui/field`(审计 A-11)。
 *
 * 此前这里是 11 个 `<label>文案<Input/></label>` 分支,而那句 `role="alert"` 的错误
 * 统一挂在**整块字段的末尾** —— 商家在唯一那一格填错,话出现在它下面一块砖之外,而且
 * 与那个输入框没有任何程序上的关联。现在错误长在出错的那一格旁边,并用
 * `aria-describedby` 接进控件。
 */
function DialogField({ id, label, error, children }: {
  id: string;
  label: React.ReactNode;
  error?: string;
  children: (control: { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined }) => React.ReactNode;
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({ id, "aria-describedby": errorId, "aria-invalid": error ? true : undefined })}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
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
    if (!Number.isInteger(next) || next < 0) return onNotice("Spend cap must be a whole number of cr, 0 or more.");
    if (fixture) { onFixtureSave?.(next); return onNotice("Spend cap updated in this preview. Nothing has been saved to your live account yet."); }
    setBusy(true);
    const result = await setOwnerSetting("spendCapCredits", next);
    setBusy(false);
    onNotice("error" in result ? result.error : "Spend cap saved.");
  }}><Input unstyled aria-label="Spend cap in cr per action" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} /><span>cr per action</span><Button unstyled type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></form>;
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
  return <AlertDialog><AlertDialogTrigger asChild><Button unstyled type="button" className="r22-settings-action" disabled={busy}>{busy ? "Disconnecting…" : "Disconnect Meta"}</Button></AlertDialogTrigger><AlertDialogContent className="r22-settings-confirm"><AlertDialogHeader><AlertDialogTitle>Disconnect Meta?</AlertDialogTitle><AlertDialogDescription>Instagram and Facebook will both stop using this workspace connection. Scheduled posts will stay visible but cannot be described as publishable.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep connected</AlertDialogCancel><AlertDialogAction disabled={busy || fixture} onClick={() => void disconnect()}>{fixture ? "Not available in preview" : "Disconnect Meta"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

type FixtureSurfaceState = "ready" | "loading" | "error" | "permission" | "unknown";

export function R22SettingsShell({ data, initialSection = "workspace", fixture = false, fixtureState = "ready", fixtureOutcome = "success", betaScope = false, betaFallbackFrom }: { data: R22SettingsData; initialSection?: R22SettingsSection; fixture?: boolean; fixtureState?: FixtureSurfaceState; fixtureOutcome?: "success" | "error" | "conflict" | "unknown"; /** beta 收窄开着:侧栏只画 `BETA_SETTINGS_SECTIONS` 三节。闸在 `R22SettingsEntry`。 */ betaScope?: boolean; /** 商家刚才按的是哪扇被藏的门 —— 有值就在内容区顶上说一句他落在了哪。 */ betaFallbackFrom?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [section, setSection] = useState<R22SettingsSection>(initialSection);
  /** 回落提示只说这一次落地 —— 商家自己按了别的一节,它就该走。 */
  const [fallbackFrom, setFallbackFrom] = useState(betaFallbackFrom ?? "");
  /**
   * 回执一律走 `toast()`(审计 A-4)—— 这一面此前自己画一条 `.r22-settings-notice`,
   * 另外四扇门各画各的。措辞一个字没改,只是不再各造各的条。空串是「没有话要说」,
   * 不弹一条空的。
   */
  const setNotice = useCallback((message: string) => { if (message) toast(message); }, []);
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
  /** 出错的是**哪一格**(审计 A-11)。空串 = 整块的错,仍住在字段区末尾。 */
  const [actionErrorField, setActionErrorField] = useState("");
  const failAction = (field: string, message: string) => { setActionErrorField(field); setActionError(message); };
  /** 这一格自己认领的错 —— 认不到就返回 undefined,`FieldError` 什么都不画。 */
  const fieldError = (field: string) => actionErrorField === field ? actionError : undefined;
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
    setActiveAction(label); setActionError(""); setActionErrorField(""); setActionSuccess(""); setActionFailedOnce(false); setWorkspaceSwitchFailedOnce(false); setInviteEmail(""); setInviteRole("Editor"); setSecondaryValue("");
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
        setActionError(fixtureOutcome === "conflict" ? "Your access to that workspace changed somewhere else. You are still in this one — look again, then try the same switch." : fixtureOutcome === "unknown" ? "We could not tell whether the switch went through. You are still in this workspace — check this one before picking another." : "The switch was not confirmed. You are still in this workspace, and trying again is safe.");
        return;
      }
      const nextWorkspace = workspaceDirectory.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!nextWorkspace) {
        setWorkspaceSwitching(false); setActionError("You no longer have access to that workspace."); return;
      }
      setFixtureReady(false);
      const fallback = fixtureFallback(nextWorkspace.name);
      applyFixtureSettings(readFixtureSettings(nextWorkspace.id, fallback) ?? fallback);
      const nextDirectory = { ...workspaceDirectory, activeId: nextWorkspace.id };
      setWorkspaceDirectory(nextDirectory); setActiveWorkspaceId(nextWorkspace.id); writeR22WorkspaceDirectory(nextDirectory);
      setWorkspaceSwitching(false); setFixtureReady(true); setActiveAction("");
      setNotice(`Switched to ${nextWorkspace.name}. Its settings were loaded fresh.`);
    }, 320);
  };

  const submitAction = () => {
    if (actionBusy) return;
    setActionError(""); setActionErrorField(""); setActionSuccess("");
    if (activeAction === "Invite member") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) return failAction("invite-email", "Enter a complete email address.");
      if (members.some((member) => member.email.toLowerCase() === inviteEmail.trim().toLowerCase())) return failAction("invite-email", "This person is already listed in the workspace.");
    } else if (activeAction === "Add domain") {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(actionValue.trim())) return failAction("value", "Enter a complete domain, such as example.com.");
      if (domains.some((domain) => domain.name.toLowerCase() === actionValue.trim().toLowerCase())) return failAction("value", "This domain is already listed.");
    } else if (activeAction === "Top up") {
      if (!Number.isInteger(Number(actionValue)) || Number(actionValue) <= 0) return failAction("value", "Choose a whole number of cr above 0.");
    } else if (activeAction === "Manage sign-in") {
      if (actionValue.length < 8) return failAction("value", "Use at least 8 characters for the new password.");
      if (actionValue !== secondaryValue) return failAction("secondary", "The password confirmation does not match.");
    } else if (activeAction === "Edit profile" && !actionValue.trim()) {
      return failAction("value", "Enter your display name.");
    } else if (activeAction === "Create workspace") {
      if (actionValue.trim().length < 2) return failAction("value", "Enter a workspace name with at least 2 characters.");
      if (workspaceDirectory.workspaces.some((workspace) => workspace.name.toLowerCase() === actionValue.trim().toLowerCase())) return failAction("value", "A workspace with this name is already in this preview.");
    } else if (["Edit", "Change timezone", "Change", "Change language", "Change default language", "Change start of week", "Change default home"].includes(activeAction) && !actionValue.trim()) return failAction("value", "Choose or enter a value before saving.");
    if (!fixture) return failAction("", `${activeAction} is not switched on yet. Nothing changed.`);
    const fixtureActions = ["Invite member", "Edit", "Edit profile", "Create workspace", "Change", "Change timezone", "Change language", "Change default language", "Change start of week", "Change default home", "Manage sign-in", "Connect Google", "Disconnect Google", "Connect Canva", "Disconnect Canva", "Top up", "Change plan", "Add domain", "Connect Instagram", "Connect Facebook", "Disconnect Instagram", "Disconnect Facebook"];
    if (!fixtureActions.includes(activeAction) && !activeAction.startsWith("View ") && !activeAction.startsWith("Change role:") && !activeAction.startsWith("Remove member:") && !activeAction.startsWith("Verify domain:")) return failAction("", `${activeAction} is not ready in this preview, so nothing was changed.`);
    setActionBusy(true);
    window.setTimeout(() => {
      if (fixtureOutcome !== "success" && !actionFailedOnce) {
        setActionFailedOnce(true);
        setActionBusy(false);
        failAction("", fixtureOutcome === "conflict" ? "This setting changed elsewhere. Review the latest value and retry the same change." : fixtureOutcome === "unknown" ? "We could not tell whether this saved. Check this one change before starting another; nothing is treated as saved." : "This change was not confirmed. Nothing changed, so it is safe to try again.");
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
      const successCopy = activeAction === "Invite member" ? "Invitation prepared in this preview." : activeAction === "Create workspace" ? `${actionValue.trim()} created and opened in this preview.` : activeAction === "Top up" ? `${actionValue} cr added in this preview.` : activeAction.startsWith("Remove member:") ? "Member removed from this workspace in the preview." : activeAction.startsWith("Verify domain:") ? "Domain verified in this preview." : `${activeAction.split(":")[0]} saved in this preview.`;
      setActionBusy(false); setActionSuccess(successCopy);
    }, 420);
  };

  const choose = (next: R22SettingsSection) => {
    setSection(next);
    setFallbackFrom("");
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set("section", next);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  let content: React.ReactNode;
  switch (section) {
    case "preferences":
      content = <Section title="Preferences" intro="Personal display and workflow defaults."><div className="r22-settings-section"><h2>Experience</h2><SettingsCard rows={[{ label: "Spend cap", value: <SpendCapControl value={fixture ? spendCap : data.spendCapCredits} onNotice={setNotice} fixture={fixture} onFixtureSave={setSpendCap} /> }, { label: "Language", value: language, action: action("Change language") }, { label: "Start of week", value: startOfWeek, action: action("Change start of week") }, { label: "Default home", value: defaultHome, action: action("Change default home") }]} /></div><SectionNote id="preferences">Creative defaults live in <Link href={fixture ? "/brand?fixture=r22" : "/brand"}>Otto IQ</Link>, so brand knowledge remains in one place.</SectionNote></Section>;
      break;
    case "profile":
      content = <Section title="Profile" intro="Your personal identity across every workspace."><div className="r22-settings-section"><h2>Profile details</h2><SettingsCard rows={[{ label: "Name", value: displayName || "Not set", action: fixture ? action("Edit profile") : <Link className="r22-settings-action" href="/profile">Edit</Link> }, { label: "Email", value: data.email }, { label: "Role", value: "Workspace member", action: <Badge variant="outline" className="r22-settings-pill">Authenticated</Badge> }]} /></div></Section>;
      break;
    case "notifications":
      content = <Section title="Notifications" intro="Choose what needs your attention and where it reaches you."><div className="r22-settings-section"><h2>Delivery channels</h2><SettingsCard rows={[{ label: "In-app", value: fixture ? "Workspace feed" : "Not connected yet", action: <Switch unstyled checked={fixture && notifications.inApp} disabled={!fixture || actionBusy} aria-label="In-app notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, inApp: checked }))} /> }, { label: "Email", value: fixture ? data.email : "Not connected yet", action: <Switch unstyled checked={fixture && notifications.email} disabled={!fixture || actionBusy} aria-label="Email notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, email: checked }))} /> }]} /></div><div className="r22-settings-section"><h2>Event preferences</h2><SettingsCard rows={[{ label: "Approval needed", value: notifications.inApp || notifications.email ? "Uses enabled channels" : "Delivery off", action: <Switch unstyled checked={fixture && notifications.approval} disabled={!fixture || (!notifications.inApp && !notifications.email)} aria-label="Approval needed notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, approval: checked }))} /> }, { label: "Publish failed", value: notifications.inApp || notifications.email ? "Uses enabled channels" : "Delivery off", action: <Switch unstyled checked={fixture && notifications.publishFailed} disabled={!fixture || (!notifications.inApp && !notifications.email)} aria-label="Publish failed notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, publishFailed: checked }))} /> }, { label: "Routine completed", value: notifications.inApp || notifications.email ? "Uses enabled channels" : "Delivery off", action: <Switch unstyled checked={fixture && notifications.routine} disabled={!fixture || (!notifications.inApp && !notifications.email)} aria-label="Routine completed notifications" onCheckedChange={(checked) => setNotifications((current) => ({ ...current, routine: checked }))} /> }]} /></div><SectionNote id="notifications">{fixture ? "Notification choices are saved here for now. Real email and phone alerts switch on when your account goes live." : "Your channels and alert choices will be saved together once notifications are switched on. Nothing here claims a message was sent, and no choice is kept for show."}</SectionNote></Section>;
      break;
    case "security":
      content = <Section title="Security and access" intro="Protect your account and review active sessions."><div className="r22-settings-section"><h2>Account access</h2><SettingsCard rows={[{ label: "Sign-in method", value: fixture ? "Email and password" : "Signed in on this device", action: action("Manage sign-in") }, { label: "Active sessions", value: fixture ? `${sessions.length} sessions` : "Your sessions are not switched on yet", action: action("Review sessions") }]} /></div></Section>;
      break;
    case "connected":
      content = <Section title="Connected accounts" intro="Personal services connected to your Fikirtive account."><div className="r22-settings-section"><h2>Accounts</h2><SettingsCard rows={[{ label: "Google", value: fixture ? connectedAccounts.google ? `Connected as ${data.email}` : "Not connected" : "Status not available yet", action: fixture ? action(connectedAccounts.google ? "Disconnect Google" : "Connect Google") : undefined }, { label: "Canva", value: fixture ? connectedAccounts.canva ? "Connected to personal account" : "Not connected" : "Not connected", action: fixture ? action(connectedAccounts.canva ? "Disconnect Canva" : "Connect Canva") : undefined }]} /></div><SectionNote id="connected">Personal connections do not grant access to a client workspace. Workspace publishing channels remain under Connections.</SectionNote></Section>;
      break;
    case "members":
      content = <Section title="Members" intro={`Manage access to ${workspaceName} without exposing other workspaces.`}><div className="r22-settings-section"><div className="r22-settings-section-head"><h2>Workspace members</h2>{action("Invite member")}</div><div className="r22-settings-card"><div className="r22-settings-members"><div><b>Member</b><b>Role</b><b>Status</b></div>{fixture ? members.map((member) => <div key={member.id}><span><b>{member.name}</b><small>{member.email}</small></span><span>{member.role}</span><span><Badge variant="outline" className="r22-settings-pill" data-r22-member-status={member.status}>{member.status}</Badge>{member.id !== "fixture-founder" ? <><Button unstyled type="button" className="r22-settings-row-action" onClick={() => openAction(`Change role:${member.id}`)}>Change role</Button><Button unstyled type="button" className="r22-settings-row-action is-danger" onClick={() => openAction(`Remove member:${member.id}`)}>Remove</Button></> : null}</span></div>) : <div><span><b>{data.displayName || data.email}</b><small>{data.email}</small></span><span>Signed in</span><span><Badge variant="outline" className="r22-settings-pill">Active</Badge></span></div>}</div></div></div><SectionNote id="members">{fixture ? "Invited members stay in this preview. Changing a role or removing someone always asks you to confirm first." : "Only the person signed in is shown today. Nobody else is added to this list for show."}</SectionNote></Section>;
      break;
    case "roles":
      content = <Section title="Roles and permissions" intro="Control capabilities for this client workspace."><div className="r22-settings-section"><h2>Workspace roles</h2><SettingsCard rows={[{ label: "Admin", value: "Full workspace and billing access", action: action("View Admin") }, { label: "Editor", value: "Create, edit and submit for approval", action: action("View Editor") }, { label: "Approver", value: "Review and approve published work", action: action("View Approver") }]} /></div><SectionNote id="roles">A role name is only a summary. Every action is still checked against what you are actually allowed to do.</SectionNote></Section>;
      break;
    case "connections":
      content = <Section title="Connections" intro="Channels and tools connected to this workspace."><div className="r22-settings-section"><h2>Publishing channels</h2><div className="r22-settings-card">{fixture ? ([{ id: "instagram", label: "Instagram", connected: channels.instagram }, { id: "facebook", label: "Facebook", connected: channels.facebook }] as const).map((channel) => <div className="r22-settings-row" key={channel.id}><b>{channel.label}</b><span>{channel.connected ? `@${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "")} · connected` : "Not connected"}</span>{action(`${channel.connected ? "Disconnect" : "Connect"} ${channel.label}`)}</div>) : data.channels.length ? data.channels.map((channel) => <div className="r22-settings-row" key={channel.id}><b>{channel.label}</b><span>{channel.statusLabel}</span>{channel.status === "connected" ? <span className="r22-settings-muted">Connected through Meta</span> : channel.connectUrl ? <a className="r22-settings-action" href={channel.connectUrl}>{channel.status === "needs_reconnect" ? "Reconnect" : "Connect"}</a> : <span className="r22-settings-muted">Not available</span>}</div>) : <div className="r22-settings-empty-row">We could not read your connection status. No channel was marked disconnected.</div>}</div>{!fixture && data.channels.some((channel) => channel.status === "connected" && (channel.id === "instagram" || channel.id === "facebook")) ? <div className="r22-settings-section-action"><DisconnectMetaAction onNotice={setNotice} /></div> : null}</div><SectionNote id="connections">Connection changes apply to this workspace only. Disconnecting never deletes your Schedule history — work that was ready to go out waits until a channel is back.</SectionNote></Section>;
      break;
    case "billing":
      content = <Section title="Billing and credits" intro="One place for the workspace balance, plan and credit history."><div className="r22-settings-section"><h2>Current balance</h2><SettingsCard rows={[{ label: "Credits", value: data.balance === null ? "Could not load" : <><b className="r22-settings-mono">{fixture ? fixtureBalance.toLocaleString("en-US") : data.balance.toLocaleString("en-US")}</b> cr available</>, action: data.accountReadable ? fixture ? action("Top up") : <Link className="r22-settings-action" href="/billing">Top up</Link> : undefined }, { label: "Workspace plan", value: fixture ? plan : "Not connected yet", action: fixture ? action("Change plan") : undefined }, { label: "Invoices", value: fixture ? "No invoices yet" : "Not connected yet", action: fixture ? action("View invoices") : undefined }]} /></div><div className="r22-settings-section"><h2>Recent credit activity</h2><div className="r22-settings-card">{!data.accountReadable ? <div className="r22-settings-empty-row">Credit activity could not be loaded.</div> : data.recent.length ? data.recent.map((item) => <div className="r22-settings-ledger" key={item.id}><span><b>{item.label}</b><small>{item.atLabel}{item.detail ? ` · ${item.detail}` : ""}</small></span><strong>{item.delta > 0 ? "+" : ""}{item.delta} cr</strong></div>) : <div className="r22-settings-empty-row">No credit activity is available.</div>}</div></div><SectionNote id="billing">Top-up and plan changes are shown here for now. On your live account the balance only moves after a payment goes through.</SectionNote></Section>;
      break;
    case "domains":
      content = <Section title="Domains" intro="Verified domains for agency and client identities."><div className="r22-settings-section"><div className="r22-settings-section-head"><h2>Verified domains</h2>{fixture ? action("Add domain") : null}</div><SettingsCard rows={fixture ? domains.map((domain) => ({ label: domain.name, value: domain.status, action: domain.status === "Pending" ? action(`Verify domain:${domain.id}`) : <Badge variant="outline" className="r22-settings-pill">Verified</Badge> })) : [{ label: data.email.includes("@") ? data.email.split("@")[1]! : "Workspace domain", value: "Not shown yet" }]} /></div><SectionNote id="domains">A domain is only trusted after we verify that you own it. Verifying it here changes nothing about your real domain or who can reach it.</SectionNote></Section>;
      break;
    case "workspace":
    default:
      content = <Section title="Workspace" intro={`Manage the identity and defaults for ${workspaceName}.`}><div className="r22-settings-section"><h2>General</h2><SettingsCard rows={[{ label: "Workspace name", value: workspaceName, action: fixture ? action("Edit") : <Link className="r22-settings-action" href="/profile">Edit</Link> }, { label: "Workspace URL", value: fixture ? <span className="r22-settings-mono">fikirtive.com/{workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}</span> : <span className="r22-settings-muted">No workspace URL yet</span>, action: fixture ? action("Copy") : undefined }, { label: "Timezone", value: timezone, action: action(fixture ? "Change" : "Change timezone") }, { label: "Default language", value: language, action: action(fixture ? "Change language" : "Change default language") }]} /></div><div className="r22-settings-section"><h2>Agency</h2><SettingsCard rows={[{ label: "Client workspace", value: fixture ? "Managed by Fikirtive agency · Nicks is an admin" : "Only people signed in to this workspace can see it", action: action(fixture ? "Manage" : "Manage agency") }]} /></div></Section>;
  }

  const visibleState: FixtureSurfaceState = fixture && !fixtureReady && fixtureState === "ready" ? "loading" : fixtureState;
  const retryParams = new URLSearchParams(params.toString()); retryParams.delete("state");
  const renderedContent = visibleState === "ready" ? content : <section className="r22-settings-state" role={visibleState === "error" ? "alert" : "status"} aria-busy={visibleState === "loading" || undefined}><ShieldCheck aria-hidden="true" /><h1>{visibleState === "loading" ? `Loading ${section} settings…` : visibleState === "permission" ? "This settings section is not available to this member" : visibleState === "unknown" ? "We could not tell whether these settings loaded" : "This settings section could not be loaded"}</h1><p>{visibleState === "loading" ? "We are checking your access to this workspace." : visibleState === "permission" ? "Ask an admin to give you access to this section." : visibleState === "unknown" ? "It may still finish. Try the same page again." : "Try the same page again."}</p>{visibleState === "error" || visibleState === "unknown" ? <Link href={`${pathname}?${retryParams.toString()}`}>Retry</Link> : null}</section>;

  const destructiveAction = activeAction.startsWith("Remove member:") || activeAction.startsWith("Disconnect ");
  const showSubmit = activeAction !== "Review sessions" && activeAction !== "View invoices" && activeAction !== "Manage";
  let dialogFields: React.ReactNode;
  if (activeAction === "Invite member") dialogFields = <><DialogField id="invite-email" label="Email" error={fieldError("invite-email")}>{(control) => <Input unstyled autoFocus type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" {...control} />}</DialogField><DialogField id="invite-role" label="Role">{(control) => <SelectNative unstyled value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} {...control}><option>Editor</option><option>Approver</option><option>Admin</option></SelectNative>}</DialogField></>;
  else if (activeAction === "Review sessions") dialogFields = <div className="r22-settings-session-list">{sessions.map((session) => <Item key={session.id} size="sm"><ItemContent><ItemTitle>{session.label}</ItemTitle><ItemDescription>{session.detail}</ItemDescription></ItemContent><ItemActions>{session.current ? <Badge variant="outline" className="r22-settings-pill">Current</Badge> : <Button unstyled type="button" onClick={() => { setSessions((current) => current.filter((item) => item.id !== session.id)); setNotice("Session signed out in this preview."); }}>Revoke</Button>}</ItemActions></Item>)}</div>;
  else if (activeAction === "View invoices") dialogFields = <Empty className="r22-settings-dialog-empty"><EmptyHeader><EmptyTitle>No invoices yet</EmptyTitle><EmptyDescription>Invoices appear here once billing is switched on for this workspace.</EmptyDescription></EmptyHeader></Empty>;
  else if (activeAction === "Manage") dialogFields = <div className="r22-settings-workspace-directory" aria-busy={workspaceSwitching || undefined}><div className="r22-settings-workspace-directory-head"><span><b>Client workspaces</b><small>Only workspaces you are allowed to open are shown here.</small></span><Button unstyled type="button" disabled={workspaceSwitching} onClick={() => openAction("Create workspace")}>Create workspace</Button></div>{workspaceDirectory.workspaces.map((workspace) => { const current = workspace.id === activeWorkspaceId; return <Item className="r22-settings-workspace-directory-row" size="sm" key={workspace.id}><ItemMedia className="r22-settings-workspace-directory-avatar">{workspace.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</ItemMedia><ItemContent><ItemTitle>{workspace.name}</ItemTitle><ItemDescription>{workspace.role} access</ItemDescription></ItemContent><ItemActions>{current ? <Badge variant="outline" className="r22-settings-pill">Current</Badge> : <Button unstyled type="button" disabled={workspaceSwitching} onClick={() => switchFixtureWorkspace(workspace.id)}>{workspaceSwitching ? "Authorizing…" : "Switch"}</Button>}</ItemActions></Item>; })}{actionError ? <p role="alert">{actionError}</p> : null}</div>;
  else if (activeAction.startsWith("View ")) dialogFields = <div className="r22-settings-permissions">{([['create','Create and edit'],['approve','Approve work'],['publish','Publish approved work'],['billing','Manage billing']] as const).map(([key,label]) => <label key={key}><span>{label}</span><Switch unstyled checked={permissionDraft[key]} onCheckedChange={(checked) => setPermissionDraft((current) => ({ ...current, [key]: checked }))} aria-label={label} /></label>)}</div>;
  else if (activeAction === "Manage sign-in") dialogFields = <><DialogField id="signin-password" label="New password" error={fieldError("value")}>{(control) => <Input unstyled autoFocus type="password" value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control} />}</DialogField><DialogField id="signin-confirm" label="Confirm password" error={fieldError("secondary")}>{(control) => <Input unstyled type="password" value={secondaryValue} onChange={(event) => setSecondaryValue(event.target.value)} {...control} />}</DialogField></>;
  else if (activeAction.startsWith("Change role:")) dialogFields = <DialogField id="member-role" label="Workspace role" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option>Editor</option><option>Approver</option><option>Admin</option></SelectNative>}</DialogField>;
  else if (activeAction === "Top up") dialogFields = <DialogField id="topup-amount" label="Credits" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option value="200">200 cr</option><option value="500">500 cr</option><option value="1000">1,000 cr</option></SelectNative>}</DialogField>;
  else if (activeAction === "Change plan") dialogFields = <DialogField id="plan" label="Workspace plan" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option>Starter · monthly</option><option>Studio · monthly</option><option>Agency · monthly</option></SelectNative>}</DialogField>;
  else if (activeAction === "Add domain") dialogFields = <DialogField id="domain" label="Domain" error={fieldError("value")}>{(control) => <Input unstyled autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} placeholder="example.com" {...control} />}</DialogField>;
  else if (activeAction === "Create workspace") dialogFields = <><DialogField id="workspace-name" label="Workspace name" error={fieldError("value")}>{(control) => <Input unstyled autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} placeholder="Client or brand name" {...control} />}</DialogField><Empty className="r22-settings-dialog-empty"><EmptyHeader><EmptyTitle>This creates a completely separate workspace</EmptyTitle><EmptyDescription>Members, roles, channels, credits and settings all start empty. Nothing from {workspaceName} is copied across.</EmptyDescription></EmptyHeader></Empty></>;
  else if (activeAction.includes("timezone") || activeAction === "Change") dialogFields = <DialogField id="timezone" label="Timezone" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur · GMT+8</option><option value="Asia/Singapore">Asia/Singapore · GMT+8</option><option value="UTC">UTC · GMT+0</option></SelectNative>}</DialogField>;
  else if (activeAction.includes("language")) dialogFields = <DialogField id="language" label="Language" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option>English</option><option>Bahasa Malaysia</option><option>Chinese</option></SelectNative>}</DialogField>;
  else if (activeAction.includes("start of week")) dialogFields = <DialogField id="start-of-week" label="Start of week" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option>Monday</option><option>Sunday</option></SelectNative>}</DialogField>;
  else if (activeAction.includes("default home")) dialogFields = <DialogField id="default-home" label="Default home" error={fieldError("value")}>{(control) => <SelectNative unstyled value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control}><option>Home</option><option>Canvas</option><option>Approvals</option></SelectNative>}</DialogField>;
  else if (destructiveAction || activeAction.startsWith("Connect ") || activeAction.startsWith("Verify domain:")) dialogFields = <Empty className="r22-settings-dialog-empty"><EmptyHeader><EmptyTitle>{destructiveAction ? "Check what this does before you continue" : "This changes only the workspace you have open"}</EmptyTitle><EmptyDescription>{activeAction.startsWith("Disconnect ") ? "Scheduled work stays visible and waits until a channel is connected again. Nothing on Meta or your live account changes." : activeAction.startsWith("Remove member:") ? "They lose access to this workspace only. Their personal account is not deleted." : "No outside service, domain record or live permission is changed."}</EmptyDescription></EmptyHeader></Empty>;
  else dialogFields = <DialogField id="action-value" label={activeAction === "Edit profile" ? "Display name" : "Workspace name"} error={fieldError("value")}>{(control) => <Input unstyled autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} {...control} />}</DialogField>;

  return <main className="r22-settings-shell" data-r22-settings data-fixture={fixture || undefined}><aside className="r22-settings-nav" aria-label="Settings sections"><Link href={fixture ? "/?fixture=r22" : "/"} className="r22-settings-back"><ChevronLeft />Back to app</Link>{SETTINGS_GROUPS.map((group) => {
      // beta 收窄:名单外的格子不画,整组空掉就连分组标题一起不画(留一个空的「Workspace」
      // 标题等于告诉商家这里本该有东西却坏了)。权威表本身没动 —— 见 BETA_SETTINGS_SECTIONS。
      const items = betaScope ? group.items.filter((item) => (BETA_SETTINGS_SECTIONS as readonly R22SettingsSection[]).includes(item.id)) : group.items;
      if (!items.length) return null;
      return <div className="r22-settings-group" key={group.label}><p>{group.label}</p>{items.map((item) => { const Icon = item.icon; return <Button unstyled type="button" key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => choose(item.id)}><Icon aria-hidden="true" />{item.label}</Button>; })}</div>;
    })}<div className="r22-settings-workspace"><span>{initials}</span><b>{workspaceName}</b></div></aside><section className="r22-settings-content" aria-live="polite">{data.dataError && <p className="r22-settings-error" role="alert">Some settings could not be loaded: {data.dataError}.</p>}{fallbackFrom ? <p className="r22-settings-error" role="status" data-r22-settings-fallback={fallbackFrom}>{fallbackFrom} is closed during this beta, so {R22_SETTINGS_SECTION_LABELS[section]} is open instead.</p> : null}{renderedContent}</section>
    <Dialog open={Boolean(activeAction)} onOpenChange={(open) => { if (!open && !actionBusy && !workspaceSwitching) setActiveAction(""); }}><DialogContent className="r22-settings-dialog" showCloseButton={false}>{actionSuccess ? <div className="r22-settings-action-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>{actionSuccess}</DialogTitle>{/* P2-14:收尾句照现行 preview 口径。上一版逐件否认「没有 channel、没有 domain record、
                 没有发出邀请」—— beta 三节里根本没有这三样东西,它在替不存在的动作道歉。标题那句
                 「… saved in this preview」已经把发生了什么说完,这里只补一句边界,不再堆免责。 */}
      <DialogDescription>Nothing outside this preview changed.</DialogDescription><Button unstyled type="button" onClick={() => setActiveAction("")}>Done</Button></div> : <><DialogHeader><DialogTitle>{activeAction.includes(":") ? activeAction.split(":")[0] : activeAction}</DialogTitle><DialogDescription>{activeAction === "Invite member" ? `Invite someone to ${workspaceName} with a specific workspace role.` : activeAction === "Manage" ? "You switch only once we have checked your access and loaded that workspace." : activeAction === "View invoices" ? "See invoices for this workspace only." : activeAction === "View Admin" || activeAction === "View Editor" || activeAction === "View Approver" ? "See exactly what this role can do. Every action is still checked when it runs." : destructiveAction ? "This action affects only the active workspace and requires confirmation." : "Review the value before saving it to this workspace."}</DialogDescription></DialogHeader><div className="r22-settings-dialog-fields">{dialogFields}{activeAction !== "Manage" && actionError && !actionErrorField ? <p role="alert">{actionError}</p> : null}</div><DialogFooter><Button unstyled type="button" disabled={actionBusy || workspaceSwitching} onClick={() => setActiveAction("")}>{showSubmit ? "Cancel" : "Done"}</Button>{showSubmit ? <Button unstyled type="button" className={destructiveAction ? "is-danger" : undefined} disabled={actionBusy || workspaceSwitching} onClick={submitAction}>{actionBusy ? "Saving…" : activeAction === "Invite member" ? "Send invitation" : activeAction === "Create workspace" ? "Create workspace" : activeAction === "View Admin" || activeAction === "View Editor" || activeAction === "View Approver" ? "Save role" : destructiveAction ? "Confirm" : "Save changes"}</Button> : null}</DialogFooter></>}</DialogContent></Dialog>
  </main>;
}
