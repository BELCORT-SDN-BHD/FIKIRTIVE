"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Home,
  ImageIcon,
  Megaphone,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RailAccount } from "@/components/navigation/rail/NavigationRail";
import { merchantNavLinks } from "@fikirtive/core/navigation";
import { loadGlobalSearchProjects, type GlobalSearchProject } from "@/lib/global-search-actions";
import { useOttoPanelControls } from "@/components/otto/panel/OttoPanelShell";
import { R22_NOTIFICATION_FIXTURE_EVENT, readR22NotificationFixture, writeR22NotificationFixture, type R22NotificationItem } from "@/components/notifications/r22-notification-fixture";
import { DEFAULT_R22_WORKSPACE_DIRECTORY, R22_WORKSPACE_FIXTURE_EVENT, readR22WorkspaceDirectory, writeR22WorkspaceDirectory, type R22FixtureWorkspaceDirectory } from "@/components/r22/r22-workspace-fixture";
import "./r22-dashboard.css";

const NAV_ICONS: Record<string, LucideIcon> = { home: Home, create: FolderKanban, library: ImageIcon, brand: Sparkles, campaign: Megaphone, approvals: CheckCircle2, schedule: CalendarDays, analytics: BarChart3, routines: RefreshCw };
const NAV_KEYS = ["home", "create", "library", "brand", "campaign", "approvals", "schedule", "analytics", "routines"] as const;
const NAV_LINKS = merchantNavLinks();
const DESTINATIONS: Array<{ href: string; label: string; icon: LucideIcon; exact?: boolean }> = NAV_KEYS.flatMap((key) => {
  const item = NAV_LINKS.find((candidate) => candidate.key === key);
  if (!item) return [];
  return [{ href: item.href, label: item.label, icon: NAV_ICONS[key]!, exact: key === "home" || key === "campaign" || key === "schedule" }];
});

type SearchResult = { id: string; href: string; label: string; detail: string; icon: LucideIcon; group: "Go to" | "Projects" };

function pathOnly(location: string): string {
  return location.split("?", 1)[0] || "/";
}

function fixtureHref(href: string, fixture: boolean): string {
  if (!fixture || !href.startsWith("/") || /(?:\?|&)fixture=/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}fixture=r22`;
}

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "BH";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

export function R22DashboardShell({
  children,
  location,
  account,
  signOutAction,
}: {
  children: React.ReactNode;
  location: string;
  account: RailAccount | null;
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const otto = useOttoPanelControls();
  const pathname = pathOnly(location);
  const fixture = new URLSearchParams(location.split("?", 2)[1] ?? "").get("fixture") === "r22";
  const [fixtureWorkspaces, setFixtureWorkspaces] = useState<R22FixtureWorkspaceDirectory>(DEFAULT_R22_WORKSPACE_DIRECTORY);
  const [workspaceSwitching, setWorkspaceSwitching] = useState("");
  const activeFixtureWorkspace = fixtureWorkspaces.workspaces.find((workspace) => workspace.id === fixtureWorkspaces.activeId) ?? fixtureWorkspaces.workspaces[0];
  const identity = fixture ? activeFixtureWorkspace?.name ?? "Batik House" : (account?.displayName || account?.email || "Workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [fixtureNotifications, setFixtureNotifications] = useState<R22NotificationItem[]>([]);
  const [projects, setProjects] = useState<GlobalSearchProject[]>(fixture ? [{ id: "fixture-raya", name: "Raya launch" }] : []);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">(fixture ? "ready" : "loading");
  const [selectedResult, setSelectedResult] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const notificationsTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const projectsRequestedRef = useRef(fixture);

  const searchResults = useMemo<SearchResult[]>(() => {
    const staticResults: SearchResult[] = [
      ...DESTINATIONS.map((item) => ({ id: `door:${item.href}`, href: fixtureHref(item.href, fixture), label: item.label, detail: item.href, icon: item.icon, group: "Go to" as const })),
      { id: "settings:connections", href: fixtureHref("/settings?section=connections", fixture), label: "Connections", detail: "Settings", icon: Settings, group: "Go to" },
      { id: "settings:billing", href: fixtureHref("/settings?section=billing", fixture), label: "Billing and credits", detail: "Settings", icon: Settings, group: "Go to" },
      { id: "settings:members", href: fixtureHref("/settings?section=members", fixture), label: "Members", detail: "Settings", icon: Settings, group: "Go to" },
    ];
    const projectResults: SearchResult[] = projects.map((project) => ({ id: `project:${project.id}`, href: fixtureHref(`/create/canvas?project=${encodeURIComponent(project.id)}`, fixture), label: project.name, detail: "Canvas project", icon: FolderKanban, group: "Projects" }));
    const all = [...staticResults, ...projectResults];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return all;
    return all.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(normalized));
  }, [fixture, projects, query]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setSelectedResult(0);
    requestAnimationFrame(() => searchTriggerRef.current?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        if (searchOpen) return;
        if (notificationsOpen) { setNotificationsOpen(false); requestAnimationFrame(() => notificationsTriggerRef.current?.focus()); }
        if (helpOpen) { setHelpOpen(false); requestAnimationFrame(() => workspaceTriggerRef.current?.focus()); }
        if (workspaceOpen) { setWorkspaceOpen(false); requestAnimationFrame(() => workspaceTriggerRef.current?.focus()); }
        otto?.closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen, notificationsOpen, otto, searchOpen, workspaceOpen]);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    if (!fixture) return;
    setFixtureNotifications(readR22NotificationFixture());
    const sync = (event: Event) => setFixtureNotifications((event as CustomEvent<R22NotificationItem[]>).detail ?? readR22NotificationFixture());
    window.addEventListener(R22_NOTIFICATION_FIXTURE_EVENT, sync);
    return () => window.removeEventListener(R22_NOTIFICATION_FIXTURE_EVENT, sync);
  }, [fixture]);

  useEffect(() => {
    if (!fixture) return;
    setFixtureWorkspaces(readR22WorkspaceDirectory());
    const sync = (event: Event) => setFixtureWorkspaces((event as CustomEvent<R22FixtureWorkspaceDirectory>).detail ?? readR22WorkspaceDirectory());
    window.addEventListener(R22_WORKSPACE_FIXTURE_EVENT, sync);
    return () => window.removeEventListener(R22_WORKSPACE_FIXTURE_EVENT, sync);
  }, [fixture]);

  const switchFixtureWorkspace = (workspaceId: string) => {
    if (!fixture || workspaceId === fixtureWorkspaces.activeId || workspaceSwitching) return;
    setWorkspaceSwitching(workspaceId);
    window.setTimeout(() => {
      const next = { ...fixtureWorkspaces, activeId: workspaceId };
      writeR22WorkspaceDirectory(next);
      setFixtureWorkspaces(next);
      setWorkspaceOpen(false);
      window.location.reload();
    }, 320);
  };

  function updateFixtureNotifications(items: R22NotificationItem[]) {
    setFixtureNotifications(items);
    writeR22NotificationFixture(items);
  }

  useEffect(() => {
    if (!searchOpen || fixture || projectsRequestedRef.current) return;
    projectsRequestedRef.current = true;
    let alive = true;
    void loadGlobalSearchProjects().then((result) => {
      if (!alive) return;
      if ("error" in result) setProjectsState("error");
      else { setProjects(result.projects); setProjectsState("ready"); setSelectedResult(0); }
    }).catch(() => { if (alive) setProjectsState("error"); });
    return () => { alive = false; };
  }, [fixture, searchOpen]);

  return (
    <div className="r22-dashboard-shell" data-r22-dashboard-shell>
      <aside className="r22-dashboard-rail" aria-label="Global navigation">
        <Link className="r22-dashboard-brand" href={fixtureHref("/", fixture)} aria-label="Fikirtive Home">
          <Image src="/brand/r22-mark.svg" width={24} height={30} alt="" />
          <span className="r22-dashboard-wordmark">fikirtive</span>
        </Link>

        <Button unstyled ref={searchTriggerRef} type="button" className="r22-dashboard-search" onClick={() => setSearchOpen(true)}>
          <Search data-icon="inline-start" aria-hidden="true" />
          <span>Search anything</span>
          <kbd>⌘K</kbd>
        </Button>

        <nav className="r22-dashboard-nav">
          {DESTINATIONS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link key={href} href={fixtureHref(href, fixture)} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {fixture && label === "Approvals" && <em>5</em>}
              </Link>
            );
          })}
        </nav>

        <p className="r22-dashboard-nav-label">Workspace</p>
        <Link className={pathname.startsWith("/settings") ? "r22-dashboard-settings is-active" : "r22-dashboard-settings"} href={fixtureHref("/settings", fixture)}>
          <Settings aria-hidden="true" />
          <span>Settings</span>
        </Link>

        <div className="r22-dashboard-rail-spacer" />
        <div className="r22-dashboard-workspace-wrap">
          {workspaceOpen && (
            <div className="r22-dashboard-workspace-menu">
              <p>Workspace</p>
              {fixture ? fixtureWorkspaces.workspaces.map((workspace) => { const current = workspace.id === fixtureWorkspaces.activeId; return <Button unstyled type="button" key={workspace.id} disabled={Boolean(workspaceSwitching)} onClick={() => switchFixtureWorkspace(workspace.id)}><span className="r22-dashboard-avatar">{initials(workspace.name)}</span><span><b>{workspace.name}</b><small>{current ? "Current workspace" : workspaceSwitching === workspace.id ? "Authorizing…" : `${workspace.role} access`}</small></span>{current ? <CheckCircle2 data-icon="inline-end" /> : null}</Button>; }) : <Button unstyled type="button"><span className="r22-dashboard-avatar">{initials(identity)}</span><span><b>{identity}</b><small>Current workspace</small></span><CheckCircle2 data-icon="inline-end" /></Button>}
              <Separator className="r22-dashboard-workspace-separator" />
              <Link href={fixtureHref("/settings", fixture)}>Workspace settings</Link>
              <Button unstyled type="button" onClick={() => { setWorkspaceOpen(false); setHelpOpen(true); }}>Help</Button>
              <form action={signOutAction}><Button unstyled type="submit">Sign out</Button></form>
            </div>
          )}
          <Button unstyled ref={workspaceTriggerRef} type="button" className="r22-dashboard-workspace" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen((open) => !open)}>
            <span className="r22-dashboard-avatar">{initials(identity)}</span>
            <span>{identity}</span>
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
      </aside>

      <main className="r22-dashboard-content">{children}</main>

      {pathname === "/" ? <div className="r22-dashboard-quick-actions">
        <Button unstyled ref={notificationsTriggerRef} type="button" aria-label={`Notifications${fixtureNotifications.filter((item) => !item.read).length ? `, ${fixtureNotifications.filter((item) => !item.read).length} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setHelpOpen(false); }}><Bell data-icon="inline-start" />{fixture && fixtureNotifications.some((item) => !item.read) ? <i>{fixtureNotifications.filter((item) => !item.read).length}</i> : null}</Button>
      </div> : null}

      {notificationsOpen && pathname === "/" && (
        <aside className="r22-dashboard-side-panel" aria-label="Notifications">
          <header><div><b>Notifications</b><p>Updates that need your attention</p></div>{fixture && fixtureNotifications.some((item) => !item.read) ? <Button unstyled type="button" aria-label="Mark all notifications as read" onClick={() => updateFixtureNotifications(fixtureNotifications.map((item) => ({ ...item, read: true })))}><CheckCircle2 /></Button> : null}<Link href={fixture ? "/notifications?fixture=r22" : "/notifications"}>View all</Link><Button unstyled type="button" aria-label="Close notifications" onClick={() => { setNotificationsOpen(false); requestAnimationFrame(() => notificationsTriggerRef.current?.focus()); }}><X data-icon="inline-start" /></Button></header>
          {fixture ? (
            fixtureNotifications.length ? <ul>{fixtureNotifications.slice(0, 3).map((item) => <li key={item.id} className={item.read ? "is-read" : ""}><span className={!item.read ? "is-coral" : ""} /><div><b>{item.title}</b><p>{item.detail}</p><Link href={`/notifications?fixture=r22&notification=${encodeURIComponent(item.id)}`} onClick={() => updateFixtureNotifications(fixtureNotifications.map((row) => row.id === item.id ? { ...row, read: true } : row))}>View detail</Link></div></li>)}</ul> : <div className="r22-dashboard-panel-empty"><Bell /><b>No notification history</b><p>Dismissed fixture events stay removed after refresh.</p><Link href="/notifications?fixture=r22">Open notifications</Link></div>
          ) : <div className="r22-dashboard-panel-empty"><Bell /><b>Notification delivery is not connected yet</b><p>No empty feed or read state was inferred. Open the full page for the backend contract and preferences.</p><Link href="/notifications">Open notifications</Link></div>}
        </aside>
      )}

      {helpOpen && (
        <aside className="r22-dashboard-side-panel" aria-label="Help">
          <header><div><b>Help</b><p>Find the fastest way forward</p></div><Button unstyled type="button" aria-label="Close help" onClick={() => { setHelpOpen(false); requestAnimationFrame(() => workspaceTriggerRef.current?.focus()); }}><X data-icon="inline-start" /></Button></header>
          <div className="r22-dashboard-help-list">
            <Button unstyled type="button" disabled={!otto} onClick={() => { setHelpOpen(false); otto?.openPanel(); }}><b>Ask Otto</b><span>Open the real workspace conversation and history.</span></Button>
            <Link href={fixtureHref("/settings/connections", fixture)}><b>Connection help</b><span>Check channel access and reconnect safely.</span></Link>
            <Link href={fixture ? "/help?fixture=r22" : "/help"}><b>Help and support</b><span>Search verified guidance or review a support request.</span></Link>
          </div>
        </aside>
      )}

      <Dialog open={searchOpen} onOpenChange={(open) => { if (open) setSearchOpen(true); else closeSearch(); }}>
          <DialogContent unstyled showCloseButton={false} overlayClassName="r22-dashboard-search-scrim" className="r22-dashboard-search-dialog">
            <DialogTitle className="sr-only">Global Search</DialogTitle>
            <DialogDescription className="sr-only">Search destinations and workspace projects.</DialogDescription>
            <div><Search /><Input unstyled
              ref={searchRef}
              aria-label="Search anything"
              role="combobox"
              aria-expanded="true"
              aria-controls="r22-global-search-results"
              aria-activedescendant={searchResults[selectedResult]?.id ? `r22-search-${searchResults[selectedResult]!.id.replace(/[^a-z0-9_-]/gi, "-")}` : undefined}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSelectedResult(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && searchResults.length) { event.preventDefault(); setSelectedResult((value) => (value + 1) % searchResults.length); }
                if (event.key === "ArrowUp" && searchResults.length) { event.preventDefault(); setSelectedResult((value) => (value - 1 + searchResults.length) % searchResults.length); }
                if (event.key === "Enter" && searchResults[selectedResult]) { event.preventDefault(); const href = searchResults[selectedResult]!.href; closeSearch(); router.push(href); }
              }}
              placeholder="Search Fikirtive"
            /><kbd>Esc</kbd></div>
            <p>{query.trim() ? "Results" : "Go to"}</p>
            <ul id="r22-global-search-results" role="listbox">{searchResults.map(({ id, href, label, detail, icon: Icon }, index) => <li id={`r22-search-${id.replace(/[^a-z0-9_-]/gi, "-")}`} role="option" aria-selected={selectedResult === index} className={selectedResult === index ? "is-selected" : ""} key={id}><Link href={href} onMouseEnter={() => setSelectedResult(index)} onClick={closeSearch}><Icon /><span>{label}</span><small>{detail}</small></Link></li>)}</ul>
            {projectsState === "loading" && <div className="r22-dashboard-search-empty">Loading workspace projects…</div>}
            {projectsState === "error" && <div className="r22-dashboard-search-empty">Projects could not be searched. Navigation results remain available.</div>}
            {!searchResults.length && <div className="r22-dashboard-search-empty">No matching result</div>}
          </DialogContent>
      </Dialog>
    </div>
  );
}

export default R22DashboardShell;
