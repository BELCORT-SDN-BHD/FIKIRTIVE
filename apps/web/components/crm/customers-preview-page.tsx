import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  FileText,
  Inbox,
  Send,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { navLinkByKey } from "@fikirtive/core/navigation";
import { SupportExit } from "@/components/exits/Exits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Customers —— 折叠之后的那一扇门(#792,Founder 裁决 2026-08-08)。
 *
 * 折叠前,导轨上并排站着七扇门(Inbox / Contacts / Segments / Templates / Broadcasts /
 * Workflows / Reports),每一扇都长得像一个能用的能力。可是**一个消息渠道都连不上** ——
 * Connections 里 Messaging 整段写着 "Not available yet",全仓没有任何一条商家可走的连接
 * 路径(能建 ChannelScope 的只有测试)。所以那六扇门后面一条消息也发不出去、收不进来。
 *
 * 这一页是收敛后唯一的入口,它的工作只有一件:**先说实话,再指路**。
 *   · 说实话 = 渠道连不上这件事写在第一屏,不藏在某个空态里;
 *   · 指路 = 现在真的做得到的(建档案、分群)在最上面,没通电的照旧进得去 —— 页面一页
 *     没删(4600 行引擎原地保留),只是不再假装它们是今天的能力。
 *
 * 纯服务端、零 I/O:这一页不读数据库,因为它说的每一句都是**产品形状**的事实,不是某个
 * 工作区的状态。渠道接通的那一天,这一页与导航里的 `preview` 一起删。
 */

/** 一条真能点开的去处 + 它今天的实话。 */
type PreviewEntry = {
  readonly href: string;
  readonly label: string;
  readonly truth: string;
  readonly icon: typeof Inbox;
};

/** 现在就成立的能力 —— 商家点进去能把事做完。 */
const WORKS_TODAY: readonly PreviewEntry[] = [
  {
    href: "/crm/contacts",
    label: "Contacts",
    truth:
      "Add a customer by hand or import a file, keep what you know about them, and read it back any time. These records are yours.",
    icon: UsersRound,
  },
  {
    href: "/crm/segments",
    label: "Segments",
    truth:
      "Group customers by what they spent, when they last ordered, or how you tagged them. The group is real and it counts real people — there is just nothing to send to it yet.",
    icon: Sparkles,
  },
];

/** 建好了、但等渠道 —— 每一句写明今天做不到什么,不写工期。 */
const WAITING_ON_A_CHANNEL: readonly PreviewEntry[] = [
  {
    href: "/crm/inbox",
    label: "Inbox",
    truth: "Where customer conversations land once a channel is connected. Nothing can arrive today.",
    icon: Inbox,
  },
  {
    href: "/crm/templates",
    label: "Message templates",
    truth:
      "The wording a messaging channel has to approve before it will carry your message. There is no channel to approve one against.",
    icon: FileText,
  },
  {
    href: "/crm/broadcasts",
    label: "Broadcasts",
    truth: "One message to a whole segment. It cannot be created without a channel to send it through.",
    icon: Send,
  },
  {
    href: "/crm/workflows",
    label: "Workflows",
    truth: "A reply or a follow-up that goes out automatically. Nothing goes out today.",
    icon: Sparkles,
  },
  {
    href: "/crm/reports",
    label: "Delivery reports",
    truth: "What a broadcast actually did — delivered, read, failed. There are no broadcasts to report on.",
    icon: BarChart3,
  },
];

function EntryRow({ entry }: { entry: PreviewEntry }) {
  const Icon = entry.icon;

  return (
    <Link
      href={entry.href}
      className="group flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent"
    >
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {entry.label}
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">{entry.truth}</span>
      </span>
    </Link>
  );
}

export function CustomersPreviewPage() {
  // 导轨怎么写这扇门,这一页就怎么写 —— 那句实话只有一处(#792)。
  const door = navLinkByKey("customers");

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-border pb-7">
          <Link
            href="/otto"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Return to Otto
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{door.label}</h1>
            <Badge variant="warning">Preview</Badge>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {door.preview}
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Posting to Instagram and Facebook already works — messaging is a different connection,
            and that one does not exist yet. Connections lists WhatsApp as not available, and there
            is no other messaging channel to connect.
          </p>
        </header>

        <Card className="mt-7">
          <CardHeader>
            <CardTitle>What works today</CardTitle>
            <CardDescription>
              These do the whole job right now, with no channel involved.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {WORKS_TODAY.map((entry) => (
              <EntryRow key={entry.href} entry={entry} />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Built, waiting on a channel</CardTitle>
            <CardDescription>
              These pages are finished and they open, so you can see exactly what is coming. Every
              one of them stops at the same missing piece, and each says where it stops.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {WAITING_ON_A_CHANNEL.map((entry) => (
              <EntryRow key={entry.href} entry={entry} />
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Which channel comes first</CardTitle>
            <CardDescription>
              WhatsApp is the channel we are connecting next. We are not putting a date on it here.
              If a different one matters more to your shop, tell us which —{" "}
              <SupportExit subject="The messaging channel my shop needs first" />.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link href="/crm/contacts">
                Start with contacts
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default CustomersPreviewPage;
