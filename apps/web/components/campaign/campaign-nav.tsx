import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// #801 两个日历择一为准:Calendar 这一格没了。它指的那一页只是把计划条目的日期与 hook
// 摊平再编辑一次,而战役自己那一页本来就能改;真正会把东西发出去的日历只有 Workspace ›
// Schedule 一本。旧链接照旧可用(那条路由现在重定向到排期),只是不再在这里开第二扇门。
const items = [
  { href: "/campaign", label: "Campaigns", key: "list" },
  { href: "/campaign/new", label: "Plan campaign", key: "workbench" },
  { href: "/campaign/trends", label: "Trends", key: "trends" },
] as const;

/**
 * W2-12(#997,规格书 §5.6 ②/§9.2):三个页签换成 `ui/tabs`,不再手搓选中态。
 *
 * 三条都是真路由(`/campaign`、`/campaign/workbench`、`/campaign/trends`),`value` 由
 * `current` 派生(受控),`TabsTrigger asChild` 套一个真 `<Link>` —— 导航靠 `href` 本身,
 * 不接 `onValueChange`/`useRouter`:旧版手写的 `<Link>` 页签本来就只认点击和 Enter,
 * 原生 `<a>` 对 Space 没有默认行为,从来不支持空格切页签。这里不新增行为,也就不必为了
 * 接 `useRouter` 把这个纯展示组件拖成客户端组件——五个战役页的既有测试都是在无
 * app-router 的环境下直接渲染整页,加一个 client hook 会让它们全数因
 * 「invariant expected app router to be mounted」假红。
 */
export function CampaignNav({ current }: { current: (typeof items)[number]["key"] | "detail" }) {
  const active = current === "detail" ? "list" : current;
  return (
    <>
      <Link
        href="/campaign"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to campaigns
      </Link>
      <Tabs value={active} activationMode="manual">
        <TabsList
          aria-label="Campaign sections"
          className="mt-5 max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-xs"
        >
          {items.map((item) => (
            <TabsTrigger key={item.key} value={item.key} asChild>
              <Link href={item.href}>{item.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </>
  );
}
