"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
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

/**
 * 导航当前项要在**按下的那一瞬**亮,不等路由跑完。
 *
 * 高亮此前完全由 `usePathname()` 算,而 App Router 的 pathname 要等这一跳 commit 了才变 ——
 * 没有 `loading.tsx` 的门(过去的 /create、/approvals、/routines)得等服务端把整页读完,
 * 那一整段里商家按了一下,侧栏一点反应都没有。`useLinkStatus` 报的是这条 Link 自己的
 * 在途状态,按下即为真,所以「已经在去了」这件事先到,路由随后追上。
 *
 * 它不画任何东西 —— 只是一个给 `:has()` 用的记号,真正的底色还是那一份 `.is-active`
 * 配方,不另开第二种高亮画法。
 */
function NavPendingMark() {
  const { pending } = useLinkStatus();
  return pending ? <span data-nav-pending aria-hidden="true" /> : null;
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
  const fixture = process.env.NODE_ENV !== "production" && new URLSearchParams(location.split("?", 2)[1] ?? "").get("fixture") === "r22";
  const [fixtureWorkspaces, setFixtureWorkspaces] = useState<R22FixtureWorkspaceDirectory>(DEFAULT_R22_WORKSPACE_DIRECTORY);
  const [workspaceSwitching, setWorkspaceSwitching] = useState("");
  const activeFixtureWorkspace = fixtureWorkspaces.workspaces.find((workspace) => workspace.id === fixtureWorkspaces.activeId) ?? fixtureWorkspaces.workspaces[0];
  const identity = fixture ? activeFixtureWorkspace?.name ?? "Batik House" : (account?.displayName || account?.email || "Workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /**
   * 原型 L12211:右上角头像的处理是 `var wsb=$('#workspaceBtn'); if(wsb)wsb.click()` ——
   * 它不另开一个「账号菜单」,它按下侧栏那一个。所以这里存的是**哪个触发点开的**,不是
   * 「开没开」:菜单只有一份(`workspaceMenu`),状态只有一份,两个触发点共用,弹出时锚在
   * 按下的那一个旁边(原型让菜单永远弹在左下角侧栏,离手指 900px —— 那是它 `wsb.click()`
   * 转发的副作用,不是它想要的效果)。
   */
  const [menuAnchor, setMenuAnchor] = useState<"rail" | "account" | null>(null);
  const workspaceOpen = menuAnchor !== null;
  const [fixtureNotifications, setFixtureNotifications] = useState<R22NotificationItem[]>([]);
  const [projects, setProjects] = useState<GlobalSearchProject[]>(fixture ? [{ id: "fixture-raya", name: "Raya launch" }] : []);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">(fixture ? "ready" : "loading");
  const [selectedResult, setSelectedResult] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const notificationsTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  /** 开菜单的那一颗按钮本身。记元素而不是记「哪个锚点」,关闭逻辑就不用读任何 state ——
   *  焦点也还得更准:还给真正被按下的那一颗。 */
  const menuOpenerRef = useRef<HTMLButtonElement | null>(null);
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

  /** 关掉工作区菜单,并把焦点还给**当初按下的那个**触发点(侧栏或右上角)。 */
  const closeWorkspaceMenu = (restoreFocus = true) => {
    const opener = menuOpenerRef.current;
    setMenuAnchor(null);
    if (restoreFocus) requestAnimationFrame(() => opener?.focus());
  };

  const closeNotifications = (restoreFocus = true) => {
    setNotificationsOpen(false);
    if (restoreFocus) requestAnimationFrame(() => notificationsTriggerRef.current?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        if (searchOpen) return;
        // 一次 Esc 只剥最上面一层。全屏与切换器住在 OttoPanelShell,那一层在时这一记
        // 归它的链处理,壳不动面板:defaultPrevented 兜 Radix capture 阶段先消费的
        // 情形,DOM 查询兜两个处理器都挂 window 冒泡、注册顺序不可靠的情形。
        if (event.defaultPrevented) return;
        if (document.querySelector("[data-otto-panel-fullscreen], [data-otto-panel-rooms]")) return;
        if (notificationsOpen) closeNotifications();
        if (helpOpen) { setHelpOpen(false); requestAnimationFrame(() => workspaceTriggerRef.current?.focus()); }
        if (workspaceOpen) closeWorkspaceMenu();
        otto?.closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen, notificationsOpen, otto, searchOpen, workspaceOpen]);

  /**
   * 点外面就关 —— 这一层此前**整个不存在**:菜单与通知抽屉只认 Esc 和再按一次触发点,
   * 商家点到页面别处它们就那么开着。用 `pointerdown` 而不是 `click`,手指一落下就关,
   * 不用等到抬起;捕获阶段监听,免得内部 `stopPropagation` 把它吃掉。
   */
  useEffect(() => {
    if (!workspaceOpen && !notificationsOpen && !helpOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (workspaceOpen && !target.closest("[data-r22-workspace-region]")) closeWorkspaceMenu(false);
      if (notificationsOpen && !target.closest("[data-r22-notifications-region]")) closeNotifications(false);
      if (helpOpen && !target.closest("[data-r22-help-region]")) setHelpOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [helpOpen, notificationsOpen, workspaceOpen]);

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
      setMenuAnchor(null);
      window.location.reload();
    }, 320);
  };

  function updateFixtureNotifications(items: R22NotificationItem[]) {
    setFixtureNotifications(items);
    writeR22NotificationFixture(items);
  }

  const unreadCount = fixtureNotifications.filter((item) => !item.read).length;

  /**
   * 工作区菜单 —— 全产品**一份**。侧栏底部与 Home 右上角是它的两个触发点,弹出时长在
   * 按下的那一个旁边(`menuAnchor` 决定),内容、状态与登出 action 都不复制第二遍。
   */
  const workspaceMenu = (
    <div className={menuAnchor === "account" ? "r22-dashboard-workspace-menu is-account-anchored" : "r22-dashboard-workspace-menu"}>
      <p>Workspace</p>
      {fixture ? fixtureWorkspaces.workspaces.map((workspace) => { const current = workspace.id === fixtureWorkspaces.activeId; return <Button unstyled type="button" key={workspace.id} disabled={Boolean(workspaceSwitching)} onClick={() => switchFixtureWorkspace(workspace.id)}><span className="r22-dashboard-avatar">{initials(workspace.name)}</span><span><b>{workspace.name}</b><small>{current ? "Current workspace" : workspaceSwitching === workspace.id ? "Authorizing…" : `${workspace.role} access`}</small></span>{current ? <CheckCircle2 data-icon="inline-end" /> : null}</Button>; }) : <Button unstyled type="button"><span className="r22-dashboard-avatar">{initials(identity)}</span><span><b>{identity}</b><small>Current workspace</small></span><CheckCircle2 data-icon="inline-end" /></Button>}
      <Separator className="r22-dashboard-workspace-separator" />
      <Link href={fixtureHref("/settings", fixture)} onClick={() => setMenuAnchor(null)}>Workspace settings</Link>
      <Button unstyled type="button" onClick={() => { setMenuAnchor(null); setHelpOpen(true); }}>Help</Button>
      <form action={signOutAction}><Button unstyled type="submit">Sign out</Button></form>
    </div>
  );

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
                <NavPendingMark />
              </Link>
            );
          })}
        </nav>

        <p className="r22-dashboard-nav-label">Workspace</p>
        <Link className={pathname.startsWith("/settings") ? "r22-dashboard-settings is-active" : "r22-dashboard-settings"} href={fixtureHref("/settings", fixture)}>
          <Settings aria-hidden="true" />
          <span>Settings</span>
          <NavPendingMark />
        </Link>

        <div className="r22-dashboard-rail-spacer" />
        <div className="r22-dashboard-workspace-wrap" data-r22-workspace-region>
          {menuAnchor === "rail" && workspaceMenu}
          <Button unstyled ref={workspaceTriggerRef} type="button" className="r22-dashboard-workspace" aria-haspopup="menu" aria-expanded={menuAnchor === "rail"} onClick={() => { menuOpenerRef.current = workspaceTriggerRef.current; setMenuAnchor((anchor) => (anchor === "rail" ? null : "rail")); }}>
            <span className="r22-dashboard-avatar">{initials(identity)}</span>
            <span>{identity}</span>
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
      </aside>

      <main className="r22-dashboard-content">{children}</main>

      {/*
        Home 右上角那一组。原型 L12199 的 `.dh-page-actions` 是「铃 + 头像 + chevron」三件,
        这里三件都接了真东西:
          · 铃 → 壳自己那一份通知抽屉(下面那个 `r22-dashboard-side-panel`),badge 从
            `fixtureNotifications` 的未读数派生,没有写死的数字;
          · 头像 → 商家真名字的首字母(fixture 取当前工作区名,生产取 displayName / email),
            不是写死的 `NA`;
          · chevron → 和头像同属一个按钮,按下开的就是上面那一份工作区菜单。
        原型把头像与 chevron 拆成一颗按钮加一个不可按的图标;合成一个按钮是有意的偏离 ——
        Founder 点名的正是「chevron 是死的」,把它留在按钮外面等于把那句话再犯一次。
      */}
      {pathname === "/" ? <div className="r22-dashboard-quick-actions" aria-label="Account actions">
        <span data-r22-notifications-region>
          <Button unstyled ref={notificationsTriggerRef} type="button" className="r22-dashboard-bell" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setHelpOpen(false); setMenuAnchor(null); }}><Bell data-icon="inline-start" />{unreadCount ? <i>{unreadCount}</i> : null}</Button>
        </span>
        <span className="r22-dashboard-account-wrap" data-r22-workspace-region>
          {menuAnchor === "account" && workspaceMenu}
          <Button unstyled ref={accountTriggerRef} type="button" className="r22-dashboard-account" aria-haspopup="menu" aria-expanded={menuAnchor === "account"} aria-label={`Account menu for ${identity}`} onClick={() => { menuOpenerRef.current = accountTriggerRef.current; setMenuAnchor((anchor) => (anchor === "account" ? null : "account")); setNotificationsOpen(false); setHelpOpen(false); }}>
            <span className="r22-dashboard-account-avatar">{initials(identity)}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        </span>
      </div> : null}

      {notificationsOpen && pathname === "/" && (
        <aside className="r22-dashboard-side-panel" aria-label="Notifications" data-r22-notifications-region>
          <header><div><b>Notifications</b><p>Updates that need your attention</p></div>{fixture && unreadCount ? <Button unstyled type="button" aria-label="Mark all notifications as read" onClick={() => updateFixtureNotifications(fixtureNotifications.map((item) => ({ ...item, read: true })))}><CheckCircle2 /></Button> : null}<Link href={fixture ? "/notifications?fixture=r22" : "/notifications"}>View all</Link><Button unstyled type="button" aria-label="Close notifications" onClick={() => closeNotifications()}><X data-icon="inline-start" /></Button></header>
          {fixture ? (
            fixtureNotifications.length ? <ul>{fixtureNotifications.slice(0, 3).map((item) => <li key={item.id} className={item.read ? "is-read" : ""}><span className={!item.read ? "is-coral" : ""} /><div><b>{item.title}</b><p>{item.detail}</p><Link href={`/notifications?fixture=r22&notification=${encodeURIComponent(item.id)}`} onClick={() => updateFixtureNotifications(fixtureNotifications.map((row) => row.id === item.id ? { ...row, read: true } : row))}>View detail</Link></div></li>)}</ul> : <div className="r22-dashboard-panel-empty"><Bell /><b>No notification history</b><p>Dismissed fixture events stay removed after refresh.</p><Link href="/notifications?fixture=r22">Open notifications</Link></div>
          ) : <div className="r22-dashboard-panel-empty"><Bell /><b>Notification delivery is not connected yet</b><p>No empty feed or read state was inferred. Open the full page for the backend contract and preferences.</p><Link href="/notifications">Open notifications</Link></div>}
        </aside>
      )}

      {helpOpen && (
        <aside className="r22-dashboard-side-panel" aria-label="Help" data-r22-help-region>
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
