"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  ChevronDown,
  Contact,
  CreditCard,
  FileText,
  Inbox,
  LogOut,
  Megaphone,
  Send,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavigationIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type NavigationItem = {
  href: string;
  label: string;
  icon: NavigationIcon;
};

const CRM_ITEMS: NavigationItem[] = [
  { href: "/crm/inbox", label: "Inbox", icon: Inbox },
  { href: "/crm/contacts", label: "Contacts", icon: Contact },
  { href: "/crm/segments", label: "Segments", icon: UsersRound },
  { href: "/crm/templates", label: "Templates", icon: FileText },
  { href: "/crm/broadcasts", label: "Broadcasts", icon: Send },
  { href: "/crm/workflows", label: "Workflows", icon: Sparkles },
  { href: "/crm/reports", label: "Reports", icon: BarChart3 },
];

const navigationLinkClass =
  "flex h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors outline-none " +
  "focus-visible:ring-[3px] focus-visible:ring-ring/40";

function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type CrmDisclosureUpdate =
  | { type: "navigation"; pathname: string }
  | { type: "toggle"; open: boolean };

export function nextCrmDisclosureOpen(update: CrmDisclosureUpdate): boolean {
  return update.type === "toggle" ? update.open : pathMatches(update.pathname, "/crm");
}

export function isMerchantSurface(pathname: string): boolean {
  return ["/otto", "/campaign", "/crm", "/billing"].some((href) =>
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
      className={cn(
        navigationLinkClass,
        nested && "pl-10",
        active
          ? "bg-secondary font-semibold text-foreground"
          : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{item.label}</span>
    </Link>
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
  const [crmOpen, setCrmOpen] = useState(() =>
    nextCrmDisclosureOpen({ type: "navigation", pathname }),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation intentionally resets a manual disclosure toggle.
    setCrmOpen(nextCrmDisclosureOpen({ type: "navigation", pathname }));
  }, [pathname]);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card text-foreground">
      <Link
        href="/otto"
        aria-label="FIKIRTIVE home"
        className="mx-3 mt-3 flex h-12 items-center rounded-[10px] px-3 text-lg font-extrabold tracking-[-0.03em] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        FIKIRTIVE
      </Link>

      <nav
        aria-label="Global navigation"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-5"
      >
        <div className="space-y-1">
          <NavigationLink
            item={{ href: "/otto", label: "Otto", icon: Bot }}
            active={pathMatches(pathname, "/otto")}
          />
          <NavigationLink
            item={{ href: "/campaign", label: "Campaign", icon: Megaphone }}
            active={pathMatches(pathname, "/campaign")}
          />

          <details
            className="group"
            open={crmOpen}
            onToggle={(event) =>
              setCrmOpen(
                nextCrmDisclosureOpen({ type: "toggle", open: event.currentTarget.open }),
              )
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
                  active={pathMatches(pathname, item.href)}
                  nested
                />
              ))}
            </div>
          </details>
        </div>

        <div className="mt-auto space-y-3 border-t border-border pt-3">
          <NavigationLink
            item={{ href: "/billing", label: "Billing", icon: CreditCard }}
            active={pathMatches(pathname, "/billing")}
          />
          <div className="rounded-[10px] bg-muted/50 p-2">
            <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">Account</p>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex h-10 w-full items-center gap-3 rounded-lg px-2 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <LogOut className="size-4 shrink-0" aria-hidden />
                <span>Log out</span>
              </button>
            </form>
          </div>
        </div>
      </nav>
    </aside>
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
      <div className="min-h-dvh min-w-0 pl-60">{children}</div>
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

  return (
    <MerchantShellContent pathname={pathname} signOutAction={signOutAction}>
      {children}
    </MerchantShellContent>
  );
}
