"use client";

import { useEffect, useState, type ComponentType } from "react";
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
}: {
  pathname: string;
  signOutAction: () => Promise<void>;
}) {
  const crmActive = pathMatches(pathname, "/crm");
  const settingsActive = activeItemHref(pathname, WORKSPACE_SETTINGS_ITEMS) !== null;

  const [crmOpen, setCrmOpen] = useState(() =>
    nextCrmDisclosureOpen({ type: "navigation", pathname }),
  );
  const [settingsOpen, setSettingsOpen] = useState(() =>
    nextSettingsDisclosureOpen({ type: "navigation", pathname }),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [account, setAccount] = useState<{ email: string; balance: number } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation intentionally resets manual disclosure toggles and the mobile drawer on route change.
    setCrmOpen(nextCrmDisclosureOpen({ type: "navigation", pathname }));
    setSettingsOpen(nextSettingsDisclosureOpen({ type: "navigation", pathname }));
    setMobileOpen(false);
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
  // Returning to the tab also re-reads. That is the backstop for charges started on
  // surfaces that do not announce yet (see UNANNOUNCED_BLOCKED in
  // lib/__tests__/spend-visibility-seams.test.ts) and for money the worker settles while
  // the tab is in the background. It is event-driven, not a timer.
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
          two desktop tiers only needs to not clip, not to be polished). */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-30 flex size-10 items-center justify-center rounded-[10px] border border-border bg-card text-foreground shadow-sm lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <div
        onClick={() => setMobileOpen(false)}
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
            onClick={() => setMobileOpen(false)}
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

export function MerchantShellContent({
  children,
  pathname,
  signOutAction,
}: {
  children?: React.ReactNode;
  pathname: string;
  signOutAction: () => Promise<void>;
}) {
  if (!isMerchantSurface(pathname)) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <GlobalNavigation pathname={pathname} signOutAction={signOutAction} />
      <div className="min-h-dvh min-w-0 pl-0 lg:pl-16 xl:pl-60">
        <SectionTabs pathname={pathname} />
        {children}
      </div>
    </div>
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
