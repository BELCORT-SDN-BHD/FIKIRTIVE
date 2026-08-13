"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Banknote,
  Bot,
  Building2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  ShieldCheck,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/money", label: "Money", icon: Banknote },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/staff", label: "Staff & permissions", icon: ShieldCheck },
  { href: "/admin/cases", label: "Cases", icon: ClipboardList },
  { href: "/admin/otto", label: "Otto Ops", icon: Bot },
  { href: "/admin/audit", label: "Audit", icon: Activity },
  { href: "/admin/system", label: "System Health", icon: Gauge },
  { href: "/admin/queue", label: "Queue health", icon: ListOrdered },
] as const;

function activeHref(pathname: string) {
  const exact = NAV.find((item) => item.href === pathname);
  if (exact) return exact.href;
  const match = NAV.find((item) => item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
  return match?.href ?? "/admin";
}

export function AdminV2Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const currentHref = activeHref(pathname);
  const current = NAV.find((item) => item.href === currentHref) ?? NAV[0];

  return (
    <>
      <aside className="hidden w-[222px] shrink-0 border-r border-border bg-[#F8F8F7] px-3 py-[18px] md:flex md:min-h-dvh md:flex-col">
        <Link href="/admin" className="mb-4 flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-sm font-semibold text-foreground">
          <span className="grid size-7 place-items-center rounded-[8px] bg-foreground text-[11px] font-bold text-background">FK</span>
          <span className="leading-tight">
            FIKIRTIVE
            <span className="block text-[11px] font-medium text-muted-foreground">Admin</span>
          </span>
        </Link>
        <nav className="grid gap-0.5" aria-label="Admin sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.href === currentHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-[9px] px-2.5 text-[13.5px] font-medium text-muted-foreground transition-colors",
                  "hover:bg-[#EAEAE8] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
                  active && "bg-[#EAEAE8] text-foreground",
                )}
              >
                <Icon className={cn("size-4", item.href === "/admin/otto" && "text-brand")} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="sticky top-0 z-30 border-b border-border bg-[#F8F8F7]/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/admin" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="grid size-7 place-items-center rounded-[8px] bg-foreground text-[11px] font-bold text-background">FK</span>
            Admin
          </Link>
          <Select value={currentHref} onValueChange={(href) => router.push(href)}>
            <SelectTrigger size="sm" className="w-[190px] bg-card text-foreground">
              <span className="truncate">{current.label}</span>
            </SelectTrigger>
            <SelectContent align="end">
              {NAV.map((item) => (
                <SelectItem key={item.href} value={item.href}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}
