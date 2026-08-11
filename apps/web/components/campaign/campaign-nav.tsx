import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// #801 两个日历择一为准:Calendar 这一格没了。它指的那一页只是把计划条目的日期与 hook
// 摊平再编辑一次,而战役自己那一页本来就能改;真正会把东西发出去的日历只有 Workspace ›
// Schedule 一本。旧链接照旧可用(那条路由现在重定向到排期),只是不再在这里开第二扇门。
const items = [
  { href: "/campaign", label: "Campaigns", key: "list" },
  { href: "/campaign/workbench", label: "Workbench", key: "workbench" },
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

