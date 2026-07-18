import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const items = [
  { href: "/campaign", label: "Campaigns", key: "list" },
  { href: "/campaign/workbench", label: "Workbench", key: "workbench" },
  { href: "/campaign/calendar", label: "Calendar", key: "calendar" },
  { href: "/campaign/trends", label: "Trends", key: "trends" },
] as const;

export function CampaignNav({ current }: { current: (typeof items)[number]["key"] | "detail" }) {
  return (
    <>
      <Link
        href="/otto"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Return to Otto
      </Link>
      <nav className="mt-5 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-xs">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current === item.key || (current === "detail" && item.key === "list") ? "page" : undefined}
            className={`min-h-10 shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              current === item.key || (current === "detail" && item.key === "list")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

