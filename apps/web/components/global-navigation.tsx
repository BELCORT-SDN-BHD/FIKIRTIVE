"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Bot,
  ChevronDown,
  Coins,
  Contact,
  CreditCard,
  FileText,
  Inbox,
  LogOut,
  Megaphone,
  Menu,
  Plug,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getMyAccount } from "@/lib/account-actions";
import { creditsLabel } from "@/lib/credit-format";
import { createLatestReadGate, subscribeBalanceRefresh } from "@/lib/balance-refresh";

type NavigationIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type NavigationItem = {
  href: string;
  label: string;
  icon: NavigationIcon;
};

// Order matches the Founder-approved nav tree (#513 三.1). Templates was left out
// on purpose during A's rework (#513 A组返工 item 4) pending work-order-group E's
// formal /crm/templates route; E has since merged (#515), so Templates is back in
// here, ordered to match the routes as they actually exist on merged main (#520
// conflict resolution — every href below was verified against apps/web/app/crm/*).
const CRM_ITEMS: NavigationItem[] = [
  { href: "/crm/inbox", label: "Inbox", icon: Inbox },
  { href: "/crm/contacts", label: "Contacts", icon: Contact },
  { href: "/crm/segments", label: "Segments", icon: UsersRound },
  { href: "/crm/templates", label: "Templates", icon: FileText },
  { href: "/crm/broadcasts", label: "Broadcasts", icon: Send },
  { href: "/crm/workflows", label: "Workflows", icon: Sparkles },
  { href: "/crm/reports", label: "Reports", icon: BarChart3 },
];

// Connections points at Otto's already-shipped connections view (work-order-group
// B's real current entry point) rather than the not-yet-built /connections page,
// so this link works today instead of 404ing (#513 A组返工 item 4). Swap it to the
// standalone /connections page once B merges its unified Connections surface
// (#513 四.2).
//
// Preferences points at OttoAccount (?view=account) — spend cap, notifications,
// schedule defaults, and Delete account had no clickable entry point anywhere
// after OttoNav's "Account" item was removed (#513 A组返工·三轮 item 1: the page
// itself never moved, it was an island). Named "Preferences" rather than "Account"
// so it doesn't re-create the identity-menu/Profile ambiguity that got the old
// OttoNav entry pulled — see the comment on OttoNav's TOOL_ITEMS.
const WORKSPACE_SETTINGS_ITEMS: NavigationItem[] = [
  { href: "/otto?view=connections", label: "Connections", icon: Plug },
  { href: "/otto?view=account", label: "Preferences", icon: SlidersHorizontal },
  { href: "/billing", label: "Billing & credits", icon: CreditCard },
];

const navigationLinkClass =
  "flex h-11 items-center gap-3 rounded-[10px] text-sm transition-colors outline-none " +
  "focus-visible:ring-[3px] focus-visible:ring-ring/40 px-3 lg:justify-center lg:px-0 xl:justify-start xl:px-3";

/** Splits "/otto?view=connections" into its path and query. */
function splitLocation(value: string): { path: string; query: URLSearchParams } {
  const [path, query = ""] = value.split("?");
  return { path, query: new URLSearchParams(query) };
}

/** Query-aware: an href with no query (e.g. "/billing") matches on path alone, same
 *  as before. An href that pins a query (e.g. "/otto?view=connections") additionally
 *  requires that exact query on the current location — otherwise bare "/otto" would
 *  also light up Connections (#513 A组返工·三轮 item 2 — pathname carries the query
 *  via MerchantAppShell now, see its useSearchParams comment). */
function pathMatches(pathname: string, href: string): boolean {
  const current = splitLocation(pathname);
  const target = splitLocation(href);
  const pathOk = current.path === target.path || current.path.startsWith(`${target.path}/`);
  if (!pathOk) return false;
  for (const [key, value] of target.query) {
    if (current.query.get(key) !== value) return false;
  }
  return true;
}

/** The longest-href item matching pathname wins — a nested route like
 *  /crm/inbox/templates must not also light up its shorter sibling /crm/inbox. */
function activeItemHref(pathname: string, items: NavigationItem[]): string | null {
  const matches = items.filter((item) => pathMatches(pathname, item.href));
  if (matches.length === 0) return null;
  return matches.reduce((longest, item) => (item.href.length > longest.href.length ? item : longest)).href;
}

/** True when `pathname`'s query exactly matches a query-qualified sibling item on
 *  `basePath` (e.g. Connections at "/otto?view=connections"). A bare href sharing
 *  that base path (e.g. the top-level Otto link) must not also count as active in
 *  that case — otherwise both light up together (#520). An unrelated or absent
 *  query on `pathname` leaves the bare href active, per pathMatches' own rule. */
function queryClaimedBySibling(pathname: string, basePath: string): boolean {
  return WORKSPACE_SETTINGS_ITEMS.some((item) => {
    const target = splitLocation(item.href);
    return target.path === basePath && [...target.query.keys()].length > 0 && pathMatches(pathname, item.href);
  });
}

type DisclosureUpdate =
  | { type: "navigation"; pathname: string }
  | { type: "toggle"; open: boolean };

function nextDisclosureOpenFor(matches: (pathname: string) => boolean, update: DisclosureUpdate): boolean {
  return update.type === "toggle" ? update.open : matches(update.pathname);
}

export function nextCrmDisclosureOpen(update: DisclosureUpdate): boolean {
  return nextDisclosureOpenFor((p) => pathMatches(p, "/crm"), update);
}

function nextSettingsDisclosureOpen(update: DisclosureUpdate): boolean {
  return nextDisclosureOpenFor((p) => activeItemHref(p, WORKSPACE_SETTINGS_ITEMS) !== null, update);
}

export function isMerchantSurface(pathname: string): boolean {
  return ["/otto", "/campaign", "/crm", "/billing", "/connections", "/profile"].some((href) =>
    pathMatches(pathname, href),
  );
}

/** True when the surface draws its own mobile top bar and therefore owns the WHOLE
 *  mobile navigation entry: the shell reserves no space for its floating trigger (see
 *  MOBILE_NAV_TRIGGER_INSET below) and renders no trigger at all (#747).
 *
 *  Only Otto does. OttoApp renders an in-flow `.otto-mobile-topbar` above a 100dvh
 *  workspace, so a second reservation would push its bar down and add a scrollbar to a
 *  pane that must not scroll (#685). The trigger half is #747: reserving no space is
 *  exactly what left the shell's `fixed` button sitting ON TOP of Otto's own — 40×40 at
 *  (12,12) over Otto's 44×44 "Open menu" at (16,4) below 680px, and over Otto's 34×34
 *  "Show sidebar" at (12,12) from 681 to 1023px. Two hamburgers, one on top of the
 *  other, opening two different drawers: which one the merchant hit was luck.
 *
 *  A surface that owns the bar owns the entry, so the global drawer reaches it from
 *  INSIDE that bar's own menu instead — see useOpenGlobalNavigation below. */
function ownsMobileTopBar(pathname: string): boolean {
  return pathMatches(pathname, "/otto");
}

/** The one way to open the global navigation drawer from a surface that owns the mobile
 *  top bar (#747, Founder 2026-08-08: hide the global hamburger on Otto's phone layout,
 *  keep Otto's own menu, and put the global entry inside it as a single item).
 *
 *  Null outside the merchant shell — /skin-preview mounts the real Otto shell with mock
 *  data and has no global drawer to open, so the item must not render there. Handing the
 *  opener down rather than duplicating the nav tree keeps ONE source of truth for what
 *  the global navigation contains: credits, identity, and Sign out included, none of
 *  which Otto's rail knows how to draw. */
type GlobalNavigationDrawer = {
  /** Open the global drawer. */
  open: () => void;
  /** True while it is on screen. */
  isOpen: boolean;
};

const GlobalNavigationDrawerContext = createContext<GlobalNavigationDrawer | null>(null);

export function useOpenGlobalNavigation(): (() => void) | null {
  return useContext(GlobalNavigationDrawerContext)?.open ?? null;
}

/** True while the global drawer is on screen. A surface that owns the mobile top bar must
 *  show NO navigation control of its own while it is (#747 r2): the drawer sits at the same
 *  left edge, so anything the page keeps there lands on top of it — which is the very
 *  defect this ticket is about, just with the layers swapped. */
export function useGlobalNavigationOpen(): boolean {
  return useContext(GlobalNavigationDrawerContext)?.isOpen ?? false;
}

function NavigationLink({
  item,
  active,
  nested = false,
}: {
  item: NavigationItem;
  active: boolean;
  nested?: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        navigationLinkClass,
        nested && "pl-10",
        active
          ? "bg-secondary font-semibold text-foreground"
          : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="lg:hidden xl:inline">{item.label}</span>
    </Link>
  );
}

/** #513 三.4 — the Settings-style groups (CRM, Workspace settings) collapse to a
 *  single icon at the 1024–1279px rail; their children surface here instead, as
 *  horizontal tabs in the content area. Rendered by MerchantShellContent, never by
 *  a business page, so it never touches page-internal content. */
export function SectionTabs({ pathname }: { pathname: string }) {
  const group = [
    { label: "CRM", items: CRM_ITEMS },
    { label: "Workspace settings", items: WORKSPACE_SETTINGS_ITEMS },
  ].find((g) => activeItemHref(pathname, g.items) !== null);

  if (!group) return null;
  const activeHref = activeItemHref(pathname, group.items);

  return (
    <div
      role="tablist"
      aria-label={`${group.label} sections`}
      className="hidden items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 lg:flex xl:hidden"
    >
      {group.items.map((item) => {
        const Icon = item.icon;
        const active = activeHref === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm outline-none transition-colors",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "border-foreground font-semibold text-foreground"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function GlobalNavigation({
  pathname,
  signOutAction,
  mobileOpen,
  onMobileOpenChange,
  showMobileTrigger,
}: {
  pathname: string;
  signOutAction: () => Promise<void>;
  /** Owned by MerchantShellContent so a surface that owns the mobile top bar can open
   *  this drawer from its own menu (#747 — see useOpenGlobalNavigation). */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  /** False on a surface that draws its own mobile top bar; that bar carries the entry. */
  showMobileTrigger: boolean;
}) {
  const crmActive = pathMatches(pathname, "/crm");
  const settingsActive = activeItemHref(pathname, WORKSPACE_SETTINGS_ITEMS) !== null;

  const [crmOpen, setCrmOpen] = useState(() =>
    nextCrmDisclosureOpen({ type: "navigation", pathname }),
  );
  const [settingsOpen, setSettingsOpen] = useState(() =>
    nextSettingsDisclosureOpen({ type: "navigation", pathname }),
  );
  const [account, setAccount] = useState<{ email: string; balance: number } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation intentionally resets manual disclosure toggles on route change.
    setCrmOpen(nextCrmDisclosureOpen({ type: "navigation", pathname }));
    setSettingsOpen(nextSettingsDisclosureOpen({ type: "navigation", pathname }));
  }, [pathname]);

  // This rail holds the only credits figure in the product, so it must re-read the
  // balance whenever a charge settles — not only at mount. Subscribing to the spend
  // signal (rather than adding a timer) keeps the number honest within a click of the
  // charge and adds no polling (#550: it used to sit on the mount value until a full
  // page reload, lagging the database by 84s+).
  //
  // A settle fires several reads back to back, so every response passes the latest-read
  // gate first: a slow earlier read must be discarded rather than repaint an older
  // balance over a newer one.
  //
  // Returning to the tab also re-reads. Every client spend entry now announces (the
  // enumeration in lib/__tests__/spend-visibility-seams.test.ts fences that with no
  // exemptions), so this is no longer covering for unwired surfaces — it catches the money
  // a WORKER settles while the tab sits in the background, where there is no click to hang
  // an announcement off. It is event-driven, not a timer.
  useEffect(() => {
    let alive = true;
    const beginRead = createLatestReadGate();
    const load = () => {
      const isLatest = beginRead();
      getMyAccount().then((result) => {
        if (!alive || !isLatest() || "error" in result) return;
        setAccount({ email: result.email, balance: result.balance });
      }).catch(() => {});
    };
    const loadIfVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const unsubscribe = subscribeBalanceRefresh(load);
    document.addEventListener("visibilitychange", loadIfVisible);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", loadIfVisible);
    };
  }, []);

  return (
    <>
      {/* Mobile/tablet-under-1024 trigger — the persistent rail below becomes an
          off-canvas drawer at this tier (#513 global constraint: narrower than the
          two desktop tiers only needs to not clip, not to be polished).
          It is `fixed`, so it takes NO space of its own: the shell reserves that space
          once, for every merchant surface, in MerchantShellContent (#685). Keep the
          geometry here and MOBILE_NAV_TRIGGER_INSET in step.
          Not rendered at all where the surface draws its own mobile top bar — the same
          `fixed` that makes it free of layout is what let it land on top of Otto's own
          hamburger (#747). Reservation and trigger now answer to one predicate. */}
      {showMobileTrigger && (
        <button
          type="button"
          onClick={() => onMobileOpenChange(true)}
          aria-label="Open navigation"
          className="fixed left-3 top-3 z-30 flex size-10 items-center justify-center rounded-[10px] border border-border bg-card text-foreground shadow-sm lg:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      )}

      <div
        onClick={() => onMobileOpenChange(false)}
        aria-hidden
        className={cn("fixed inset-0 z-30 bg-black/35 lg:hidden", mobileOpen ? "block" : "hidden")}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card text-foreground transition-transform duration-200",
          "lg:w-16 lg:translate-x-0 xl:w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 px-3 pt-3">
          <Link
            href="/otto"
            aria-label="FIKIRTIVE home"
            className="flex h-12 flex-1 items-center rounded-[10px] px-3 text-lg font-extrabold tracking-[-0.03em] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 lg:justify-center lg:px-0 xl:justify-start xl:px-3"
          >
            <span className="lg:hidden xl:inline">FIKIRTIVE</span>
            <span className="hidden lg:inline xl:hidden">F</span>
          </Link>
          <button
            type="button"
            onClick={() => onMobileOpenChange(false)}
            aria-label="Close navigation"
            className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground lg:hidden"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav
          aria-label="Global navigation"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-5"
        >
          <div className="space-y-1">
            <NavigationLink
              item={{ href: "/otto", label: "Otto", icon: Bot }}
              active={pathMatches(pathname, "/otto") && !queryClaimedBySibling(pathname, "/otto")}
            />
            <NavigationLink
              item={{ href: "/campaign", label: "Campaign", icon: Megaphone }}
              active={pathMatches(pathname, "/campaign")}
            />

            {/* CRM — full disclosure at the mobile drawer and 1280+ tiers. */}
            <div className="block lg:hidden xl:block">
              <details
                className="group"
                open={crmOpen}
                onToggle={(event) =>
                  setCrmOpen(nextCrmDisclosureOpen({ type: "toggle", open: event.currentTarget.open }))
                }
              >
                <summary
                  className={cn(
                    navigationLinkClass,
                    "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
                    crmActive
                      ? "bg-secondary/60 font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Users className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">CRM</span>
                  <ChevronDown
                    className="size-4 shrink-0 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="mt-1 space-y-1">
                  {CRM_ITEMS.map((item) => (
                    <NavigationLink
                      key={item.href}
                      item={item}
                      active={activeItemHref(pathname, CRM_ITEMS) === item.href}
                      nested
                    />
                  ))}
                </div>
              </details>
            </div>
            {/* CRM — 1024–1279 icon rail: a single link; its children move to the
                content-area SectionTabs bar instead of nesting in 64px of width. */}
            <Link
              href="/crm/inbox"
              title="CRM"
              aria-label="CRM"
              className={cn(
                navigationLinkClass,
                "hidden justify-center lg:flex xl:hidden",
                crmActive
                  ? "bg-secondary/60 font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Users className="size-4 shrink-0" aria-hidden />
            </Link>
          </div>

          <div className="mt-auto space-y-1 border-t border-border pt-3">
            {/* Workspace settings — full disclosure at the mobile drawer and 1280+ tiers. */}
            <div className="block lg:hidden xl:block">
              <details
                className="group"
                open={settingsOpen}
                onToggle={(event) =>
                  setSettingsOpen(nextSettingsDisclosureOpen({ type: "toggle", open: event.currentTarget.open }))
                }
              >
                <summary
                  className={cn(
                    navigationLinkClass,
                    "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
                    settingsActive
                      ? "bg-secondary/60 font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Settings className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">Workspace settings</span>
                  <ChevronDown
                    className="size-4 shrink-0 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="mt-1 space-y-1">
                  {WORKSPACE_SETTINGS_ITEMS.map((item) => (
                    <NavigationLink
                      key={item.href}
                      item={item}
                      active={activeItemHref(pathname, WORKSPACE_SETTINGS_ITEMS) === item.href}
                      nested
                    />
                  ))}
                </div>
              </details>
            </div>
            {/* Workspace settings — 1024–1279 icon rail (same pattern as CRM above). */}
            <Link
              href="/billing"
              title="Workspace settings"
              aria-label="Workspace settings"
              className={cn(
                navigationLinkClass,
                "hidden justify-center lg:flex xl:hidden",
                settingsActive
                  ? "bg-secondary/60 font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Settings className="size-4 shrink-0" aria-hidden />
            </Link>

            {/* Credits — sits above the identity area, clicks through to Billing & credits. */}
            <Link href="/billing" title="Billing & credits" className={navigationLinkClass}>
              <Coins className="size-4 shrink-0" aria-hidden />
              <span className="truncate lg:hidden xl:inline">
                {account ? creditsLabel(account.balance) : "Credits"}
              </span>
            </Link>

            {/* Identity — the avatar is now a real menu (Profile, Sign out), replacing
                the old "Account" box and its standalone Log out button. */}
            <details className="group/identity">
              <summary
                className={cn(
                  navigationLinkClass,
                  "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
                )}
              >
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback className="bg-accent text-[0.6rem] font-semibold text-accent-foreground">
                    {(account?.email ?? "?").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate lg:hidden xl:inline">{account?.email ?? "Account"}</span>
              </summary>
              <div
                role="menu"
                aria-label="Account menu"
                className="mt-1 space-y-0.5 rounded-[10px] border border-border bg-card p-1 shadow-lg"
              >
                <Link
                  role="menuitem"
                  href="/profile"
                  title="Profile"
                  className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <User className="size-4 shrink-0" aria-hidden />
                  <span className="lg:hidden xl:inline">Profile</span>
                </Link>
                <form action={signOutAction}>
                  <button
                    role="menuitem"
                    type="submit"
                    title="Sign out"
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <LogOut className="size-4 shrink-0" aria-hidden />
                    <span className="lg:hidden xl:inline">Sign out</span>
                  </button>
                </form>
              </div>
            </details>
          </div>
        </nav>
      </aside>
    </>
  );
}

/** Space the content area keeps clear for the floating mobile nav trigger (#685).
 *  The trigger is `fixed left-3 top-3` at `size-10`, i.e. it ends 52px down, so 56px
 *  (pt-14) clears it. Reserving it HERE is the whole point: the shell owns the button,
 *  so the shell owns its footprint — a page must never have to know the button exists.
 *  Every page that dodged it by hand instead was a page that could forget to (it did:
 *  /billing and /profile ate their own H1, and eight campaign/CRM surfaces ate the
 *  "Return to Otto" link, which is a LINK — covered meant unclickable, not just unreadable).
 *  Mirrors `lg:pl-16 xl:pl-60`, which already reserves the rail's width the same way. */
const MOBILE_NAV_TRIGGER_INSET = "pt-14 lg:pt-0";

/** Tailwind's `lg`, written out. Above this width the rail is a permanent column and the
 *  drawer's own controls — the trigger, the close button, the backdrop — are all `lg:hidden`.
 *  Keep this in step with every `lg:` class in this file; it is the same breakpoint. */
const RAIL_IS_PERMANENT = "(min-width: 1024px)";

export function MerchantShellContent({
  children,
  pathname,
  signOutAction,
}: {
  children?: React.ReactNode;
  pathname: string;
  signOutAction: () => Promise<void>;
}) {
  // The drawer's open state lives here, not in GlobalNavigation, so it is reachable from
  // BOTH sides of the shell: the rail's own trigger and — where that trigger is withheld
  // — the page's own menu, through the context below (#747).
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A route change must never leave the drawer open over the page it navigated to.
    setMobileOpen(false);
  }, [pathname]);

  // #820 — the drawer only exists below `lg`, but nothing told it when the window grew past
  // that line. Crossing it left `mobileOpen` true with every control that could clear it now
  // `lg:hidden`: no close button, no backdrop, no trigger. And an open drawer is what makes
  // Otto's rail and "Show sidebar" step aside (OttoNav / OttoApp read it), so those stayed
  // withdrawn too — the merchant was left with no rail at all until a navigation, a reload,
  // or a shrink back. Closing on the crossing is the whole fix: the state that only the small
  // layout can express must not survive into the layout that cannot express it.
  useEffect(() => {
    const permanent = window.matchMedia?.(RAIL_IS_PERMANENT);
    if (!permanent) return;
    const close = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    permanent.addEventListener("change", close);
    return () => permanent.removeEventListener("change", close);
  }, []);

  const openGlobalNavigation = useCallback(() => setMobileOpen(true), []);
  const drawer = useMemo<GlobalNavigationDrawer>(
    () => ({ open: openGlobalNavigation, isOpen: mobileOpen }),
    [openGlobalNavigation, mobileOpen],
  );

  if (!isMerchantSurface(pathname)) return <>{children}</>;

  return (
    <GlobalNavigationDrawerContext.Provider value={drawer}>
      <div className="min-h-dvh bg-background text-foreground">
        <GlobalNavigation
          pathname={pathname}
          signOutAction={signOutAction}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
          showMobileTrigger={!ownsMobileTopBar(pathname)}
        />
        <div
          className={cn(
            "min-h-dvh min-w-0 pl-0 lg:pl-16 xl:pl-60",
            !ownsMobileTopBar(pathname) && MOBILE_NAV_TRIGGER_INSET,
          )}
        >
          <SectionTabs pathname={pathname} />
          {children}
        </div>
      </div>
    </GlobalNavigationDrawerContext.Provider>
  );
}

export function MerchantAppShell({
  children,
  signOutAction,
}: {
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  // Query-qualified nav items (e.g. "/otto?view=connections" for Connections under
  // Workspace settings) need the query on the location string to match against
  // (#513 A组返工·三轮 item 2 — see pathMatches). Safe without a <Suspense>
  // boundary: app/layout.tsx already calls headers() in isImpersonating() before
  // rendering this shell, which forces the whole tree to render dynamically per
  // request — there is no static shell for useSearchParams to bail out of.
  const query = useSearchParams().toString();
  const pathWithQuery = query ? `${pathname}?${query}` : pathname;

  return (
    <MerchantShellContent pathname={pathWithQuery} signOutAction={signOutAction}>
      {children}
    </MerchantShellContent>
  );
}
