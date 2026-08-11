"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  Coins,
  Compass,
  Contact,
  CreditCard,
  FileText,
  Frame,
  Inbox,
  LayoutTemplate,
  Library,
  LogOut,
  Megaphone,
  Menu,
  Plug,
  Send,
  Settings,
  Sparkles,
  SlidersHorizontal,
  User,
  Users,
  UsersRound,
  CalendarDays,
  X,
} from "lucide-react";
import {
  CREATE_NAV_HREF,
  MERCHANT_NAV,
  OTTO_ASSISTANT,
  isNavGroup,
  merchantNavLinks,
  navLinkByKey,
  type MerchantNavLink,
} from "@fikirtive/core/navigation";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { getMyAccount } from "@/lib/account-actions";
import { creditsLabel } from "@/lib/credit-format";
import { createLatestReadGate, subscribeBalanceRefresh } from "@/lib/balance-refresh";

type NavigationIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/**
 * #801 — 这个文件不再自己写一份导航树。树在 `@fikirtive/core` 的 MERCHANT_NAV 里,
 * 这里只负责把它画出来:一条 key → 图标的对照表,加上壳的行为(高亮、折叠、抽屉)。
 *
 * 后面的票(#792 CRM 折叠成诚实预览、#802 Otto 界面地图)因此只改 core 里的数据,
 * 不必再动这层壳 —— 「说的」与「做的」从此共用同一份声明。
 */
const NAV_ICONS: Record<string, NavigationIcon> = {
  // 板块
  create: Frame,
  campaign: Megaphone,
  crm: Users,
  workspace: Library,
  settings: Settings,
  // CRM
  "crm-inbox": Inbox,
  "crm-contacts": Contact,
  "crm-segments": UsersRound,
  "crm-templates": FileText,
  "crm-broadcasts": Send,
  "crm-workflows": Sparkles,
  "crm-reports": BarChart3,
  // Workspace
  library: Library,
  brand: BookOpen,
  templates: LayoutTemplate,
  discover: Compass,
  schedule: CalendarDays,
  analytics: BarChart3,
  // Settings
  connections: Plug,
  preferences: SlidersHorizontal,
  billing: CreditCard,
};

/** The registry's own node, with its icon already resolved. Built ONCE at module scope:
 *  a component looked up during render is a component created during render, which React
 *  is right to refuse — and there is nothing per-render about a nav icon anyway. */
type RailLink = MerchantNavLink & { readonly icon: NavigationIcon };
type RailGroup = {
  readonly key: string;
  readonly label: string;
  readonly rootPath?: string;
  readonly icon: NavigationIcon;
  readonly items: readonly RailLink[];
};
type RailNode = RailLink | RailGroup;

function withIcon(link: MerchantNavLink): RailLink {
  return { ...link, icon: NAV_ICONS[link.key] ?? Frame };
}

function isRailGroup(node: RailNode): node is RailGroup {
  return "items" in node;
}

const RAIL_TREE: readonly RailNode[] = MERCHANT_NAV.map((node): RailNode =>
  isNavGroup(node)
    ? {
        key: node.key,
        label: node.label,
        rootPath: node.rootPath,
        icon: NAV_ICONS[node.key] ?? Frame,
        items: node.items.map(withIcon),
      }
    : withIcon(node),
);

const ASSISTANT: RailLink = withIcon(OTTO_ASSISTANT);
/** The credits row at the foot of the rail clicks through to this. Same destination the
 *  Settings group lists — read from the registry so there is one path, not two. */
const BILLING: MerchantNavLink = navLinkByKey("billing");
const NAV_GROUPS: readonly RailGroup[] = RAIL_TREE.filter(isRailGroup);
const NAV_TOP_LEVEL_LINKS: readonly RailLink[] = RAIL_TREE.filter((node) => !isRailGroup(node)) as RailLink[];

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
function activeItemHref(pathname: string, items: readonly RailLink[]): string | null {
  const matches = items.filter((item) => pathMatches(pathname, item.href));
  if (matches.length === 0) return null;
  return matches.reduce((longest, item) => (item.href.length > longest.href.length ? item : longest)).href;
}

/** True when `pathname`'s query exactly matches a query-qualified item on `basePath`
 *  anywhere in the tree (e.g. Library at "/otto?view=library"). A bare href sharing that
 *  base path — the Ask Otto assistant row — must not also count as active in that case,
 *  otherwise both light up together (#520). An unrelated or absent query on `pathname`
 *  leaves the bare href active, per pathMatches' own rule.
 *
 *  #801 — this used to look only at the Workspace-settings group because that was the
 *  only group holding `?view=` items. The whole tree is scanned now, so adding a
 *  query-qualified destination to core's registry can never re-open that defect. */
function queryClaimedBySibling(pathname: string, basePath: string): boolean {
  return merchantNavLinks().some((item) => {
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

/** A group is "on" when the current location is one of its own destinations — or, for a
 *  group that owns a whole path prefix, anywhere under that prefix (so an unlisted
 *  sub-route like /crm/inbox/templates still lights its group up). The prefix comes from
 *  the registry, never from a literal written here. */
function groupMatches(group: RailGroup, pathname: string): boolean {
  if (group.rootPath && pathMatches(pathname, group.rootPath)) return true;
  return activeItemHref(pathname, group.items) !== null;
}

export function nextGroupDisclosureOpen(group: RailGroup, update: DisclosureUpdate): boolean {
  return nextDisclosureOpenFor((p) => groupMatches(group, p), update);
}

/** Kept for the existing CRM fence — it is `nextGroupDisclosureOpen` for the CRM group,
 *  named. The group is looked up by key, so the route prefix stays in the registry. */
export function nextCrmDisclosureOpen(update: DisclosureUpdate): boolean {
  const crm = NAV_GROUPS.find((group) => group.key === "crm");
  if (!crm) return update.type === "toggle" ? update.open : false;
  return nextGroupDisclosureOpen(crm, update);
}

/** Every path prefix the merchant shell owns. Derived from the registry, so a new
 *  destination can never land on a page with no rail around it — the exact "alive but
 *  no door" state #801 was filed against. `/profile` and `/connections` are shell
 *  surfaces reachable from the identity menu rather than nav destinations of their own. */
const MERCHANT_SURFACE_PATHS: readonly string[] = [
  ...new Set([
    ...merchantNavLinks().map((item) => splitLocation(item.href).path),
    splitLocation(OTTO_ASSISTANT.href).path,
    "/profile",
    "/connections",
  ]),
];

export function isMerchantSurface(pathname: string): boolean {
  return MERCHANT_SURFACE_PATHS.some((href) => pathMatches(pathname, href));
}

/** True when the surface draws its own in-flow chrome over a full-height (100dvh)
 *  workspace, and therefore owns the WHOLE below-`lg` navigation entry: the shell
 *  reserves no space for its floating trigger (see MOBILE_NAV_TRIGGER_INSET below),
 *  renders no trigger at all (#747), and hangs no SectionTabs bar above it (#801).
 *
 *  Two surfaces do. Otto renders an in-flow `.otto-mobile-topbar` above a 100dvh
 *  workspace, so a second reservation would push its bar down and add a scrollbar to a
 *  pane that must not scroll (#685). The trigger half is #747: reserving no space is
 *  exactly what left the shell's `fixed` button sitting ON TOP of Otto's own — 40×40 at
 *  (12,12) over Otto's 44×44 "Open menu" at (16,4) below 680px, and over Otto's 34×34
 *  "Show sidebar" at (12,12) from 681 to 1023px. Two hamburgers, one on top of the
 *  other, opening two different drawers: which one the merchant hit was luck.
 *
 *  Create (the immersive canvas surface) joined them in #801, for the same reason and
 *  with the same handoff: it is `h-dvh` with its own 52px bar, and that bar's hamburger
 *  opens THIS drawer rather than a second nav of its own.
 *
 *  A surface that owns the bar owns the entry, so the global drawer reaches it from
 *  INSIDE that bar's own menu instead — see useOpenGlobalNavigation below. */
export function ownsFullHeightWorkspace(pathname: string): boolean {
  return pathMatches(pathname, OTTO_ASSISTANT.href) || pathMatches(pathname, CREATE_NAV_HREF);
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
  item: RailLink;
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

/** Otto — the assistant, drawn ABOVE the sections and never inside them (#801).
 *
 *  The old rail made Otto the first section row, which said "Otto is one of the parts of
 *  this product". It is not: it is the thing that helps with all of them. So it gets its
 *  own place at the top of every merchant surface, its own face, and none of the section
 *  chrome — no group, no disclosure, no position in the ordered list of places.
 *
 *  Motion (emil): a rail row is pressed many times a day, so nothing here animates on
 *  hover beyond colour. The one addition is press feedback — 160ms ease-out scale(0.97),
 *  the cheapest possible "the interface heard you". */
function AssistantRow({ active }: { active: boolean }) {
  return (
    <Link
      href={ASSISTANT.href}
      aria-current={active ? "page" : undefined}
      title={ASSISTANT.label}
      className={cn(
        "flex h-11 items-center gap-3 rounded-[10px] border px-3 text-sm outline-none",
        "transition-[color,background-color,border-color,transform] duration-[160ms] ease-out",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.97]",
        // Reduced motion keeps the colour change (it aids comprehension) and drops the movement.
        "motion-reduce:transition-colors motion-reduce:active:scale-100",
        "lg:justify-center lg:px-0 xl:justify-start xl:px-3",
        active
          ? "border-transparent bg-secondary font-semibold text-foreground"
          : "border-border bg-card font-medium text-foreground hover:bg-accent",
      )}
    >
      <OttoAvatar size={22} mood="idle" className="shrink-0" />
      <span className="lg:hidden xl:inline">{ASSISTANT.label}</span>
    </Link>
  );
}

/** #513 三.4 — the grouped sections (CRM, Workspace, Settings) collapse to a single icon
 *  at the 1024–1279px rail; their children surface here instead, as horizontal tabs in
 *  the content area. Rendered by MerchantShellContent, never by a business page, so it
 *  never touches page-internal content.
 *
 *  #801 — not on a surface that owns a full-height workspace. Those surfaces list the very
 *  same destinations in their own rail, so the bar repeats them; and being an in-flow bar
 *  above a 100dvh pane, it also pushes that pane into a scrollbar — the #685 shape. */
export function SectionTabs({ pathname }: { pathname: string }) {
  const group = NAV_GROUPS.find((g) => groupMatches(g, pathname));

  if (!group || ownsFullHeightWorkspace(pathname)) return null;
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

/** One grouped section: a real disclosure at the drawer and 1280+ tiers, a single icon
 *  link at the 1024–1279 rail (its children move to SectionTabs there). */
function NavigationGroup({ group, pathname }: { group: RailGroup; pathname: string }) {
  const active = groupMatches(group, pathname);
  const nextOpen = (update: DisclosureUpdate) => nextGroupDisclosureOpen(group, update);

  const [open, setOpen] = useState(() => nextOpen({ type: "navigation", pathname }));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation intentionally resets manual disclosure toggles on route change.
    setOpen(nextOpen({ type: "navigation", pathname }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nextOpen is derived from `group`, which is a module constant.
  }, [pathname]);

  const GroupIcon = group.icon;
  const activeHref = activeItemHref(pathname, group.items);
  // At 1024–1279 the group is one icon, and its children surface in SectionTabs. So the
  // icon must lead somewhere those tabs actually render — i.e. NOT onto a surface that
  // owns its own full-height workspace, where the bar is withheld. Settings therefore
  // still opens on Billing (as it always did), where all three of its rows are on screen;
  // a group whose every child lives on such a surface falls back to its first child, whose
  // own rail lists its siblings.
  const railHref = (group.items.find((item) => !ownsFullHeightWorkspace(item.href)) ?? group.items[0]!).href;

  return (
    <>
      <div className="block lg:hidden xl:block">
        <details
          className="group"
          open={open}
          onToggle={(event) => setOpen(nextOpen({ type: "toggle", open: event.currentTarget.open }))}
        >
          <summary
            className={cn(
              navigationLinkClass,
              "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
              active
                ? "bg-secondary/60 font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <GroupIcon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{group.label}</span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-1 space-y-1">
            {group.items.map((item) => (
              <NavigationLink key={item.href} item={item} active={activeHref === item.href} nested />
            ))}
          </div>
        </details>
      </div>
      <Link
        href={railHref}
        title={group.label}
        aria-label={group.label}
        className={cn(
          navigationLinkClass,
          "hidden justify-center lg:flex xl:hidden",
          active
            ? "bg-secondary/60 font-semibold text-foreground"
            : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <GroupIcon className="size-4 shrink-0" aria-hidden />
      </Link>
    </>
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
  const [account, setAccount] = useState<{ email: string; balance: number } | null>(null);

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

  const assistantActive =
    pathMatches(pathname, OTTO_ASSISTANT.href) &&
    !queryClaimedBySibling(pathname, splitLocation(OTTO_ASSISTANT.href).path);

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
            href={OTTO_ASSISTANT.href}
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
          {/* The assistant — above the sections, outside the ordered list of places. */}
          <AssistantRow active={assistantActive} />

          <div className="mt-4 space-y-1 border-t border-border pt-4">
            {NAV_TOP_LEVEL_LINKS.map((item) => (
              <NavigationLink
                key={item.href}
                item={item}
                active={
                  pathMatches(pathname, item.href) &&
                  !queryClaimedBySibling(pathname, splitLocation(item.href).path)
                }
              />
            ))}
            {NAV_GROUPS.filter((group) => group.key !== "settings").map((group) => (
              <NavigationGroup key={group.key} group={group} pathname={pathname} />
            ))}
          </div>

          <div className="mt-auto space-y-1 border-t border-border pt-3">
            {NAV_GROUPS.filter((group) => group.key === "settings").map((group) => (
              <NavigationGroup key={group.key} group={group} pathname={pathname} />
            ))}

            {/* Credits — sits above the identity area, clicks through to Billing & credits. */}
            <Link href={BILLING.href} title={BILLING.label} className={navigationLinkClass}>
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
          showMobileTrigger={!ownsFullHeightWorkspace(pathname)}
        />
        <div
          className={cn(
            "min-h-dvh min-w-0 pl-0 lg:pl-16 xl:pl-60",
            !ownsFullHeightWorkspace(pathname) && MOBILE_NAV_TRIGGER_INSET,
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
  // Settings) need the query on the location string to match against
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
