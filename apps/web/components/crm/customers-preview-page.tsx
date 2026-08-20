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
import { MESSAGING_STATUS_MERCHANT } from "@fikirtive/core/messaging-status";
import { SupportExit } from "@/components/exits/Exits";
import { sendStatePresentation } from "@/components/crm/reports/report-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Customers —— 折叠之后的那一扇门(#792,Founder 裁决 2026-08-08)。
 *
 * 折叠前,导轨上并排站着七扇门(Inbox / Contacts / Segments / Templates / Broadcasts /
 * Workflows / Reports),每一扇都长得像一个能用的能力。
 *
 * **r2 判词 P1 —— 这一页第一版自己就犯了它要修的病**:它写着这些面「已经完成、全都只差
 * 渠道」。逐面读实现之后,那句话不成立 ——
 *   · 收件箱:`submitConversationReply` 永远 `fail("SEND_PATH_UNAVAILABLE")`,而且没有任何
 *     provider 入站,所以进不来也出不去,不是「只差一根线」;
 *   · 消息模板:`submitTemplateReview` 永远 `fail("TEMPLATE_SUBMISSION_UNAVAILABLE")` ——
 *     送审这条路根本没建,版本因此永远拿不到批准,拿不到批准就永远发不了;
 *   · 广播:真发的 chokepoint `submitBroadcastRun` 无条件失败,唯一会动的是**模拟**执行
 *     (`simulated_sent`),与渠道状态无关;
 *   · Routine:每一次 run 都是 `simulated: true`,投递与花费都断开;
 *   · 投递报告:没有 provider 回执,delivered / read / failed 永远是 Unknown。
 * 「差一样东西」和「差四样东西」是两句不同的话,后者才是实话。所以每一面分成两句写:
 * **今天真的做得到什么**,和**今天真实卡在哪**。
 *
 * 「What works today」那两面同样逐能力核过:分群五个事实只接通三个(`UNAVAILABLE_FACTS`
 * = lastOrderAt / tags),所以不能笼统说「按你标的标签分群」。
 *
 * 纯服务端、零 I/O:这一页不读数据库,因为它说的每一句都是**产品形状**的事实,不是某个
 * 工作区的状态。这些卡点一处一处接通时,`crm-honest-preview.test.ts` 会红着提醒来改这一页。
 */

/**
 * 商家看到的「模拟发送」四个字 —— 从**展示层**取,不自己造(r3 判词 P2-3)。
 *
 * 这一句原来写着 `simulated-sent`:那是内部列 `sendState` 的值换了个连字符,商家从来不该
 * 读到它。产品早就有这个状态的译法(投递报告页的 `sendStatePresentation`),所以这里读它 ——
 * 译法哪天改了,这一页跟着改,不会剩下一句只有我们看得懂的话。
 */
const SIMULATED_ATTEMPT_LABEL = sendStatePresentation("simulated_sent").label;

/**
 * 这一页自己的标题(W2-13 / #993)。
 *
 * 它原来读 `navLinkByKey("customers").label` —— 导轨怎么写这扇门,这一页就怎么写。CRM 整段
 * 收起来之后导轨上没有这一格了(Founder 裁决 2026-08-18 裁决2),那个 key 一取就炸,所以标题
 * 落在这一页自己身上。**没有第二份真相可漂**:今天没有任何导航条目说 Customers。
 * 那句实话仍然来自唯一权威 `MESSAGING_STATUS_MERCHANT`,一个字都没抄。
 *
 * 这一页现在够不着(`/crm` 已是 `redirect("/")`),留在盘上是因为它记着 CRM 每一面**今天真正
 * 卡在哪** —— Meta verification 通过、CRM 接回来那天,这份账要照着核。
 */
const PREVIEW_PAGE_TITLE = "Customers";

/** 一条真能点开的去处。`works` 与 `blocked` 分开写 —— 只写一句,总会有一半被吞掉。
 *  两张表都是 export 的:`crm-honest-preview.test.ts` 逐条把 `blocked` 与实现里的证据
 *  绑在一起(实现变了围栏就红,文案跟着改),用正则去源码里刮字是刮不准的。 */
export type PreviewEntry = {
  readonly href: string;
  readonly label: string;
  /** 今天真的做得到什么。 */
  readonly works: string;
  /** 今天真实卡在哪。**必填** —— 七个面每一个都有自己的限度,只写好话就是回到 r1 那句
   *  「全都只差渠道」。围栏逐条核这一句在实现里找得到证据。 */
  readonly blocked: string;
  readonly icon: typeof Inbox;
};

/** 现在就成立的能力 —— 商家点进去能把事做完。 */
export const WORKS_TODAY: readonly PreviewEntry[] = [
  {
    href: "/crm/contacts",
    label: "Contacts",
    works:
      "Add a customer by hand or import a file, search your records, and keep phone numbers, consent facts and do-not-disturb on each one. These records are yours.",
    blocked: "A number you type in is saved as not verified, and an unverified number is never used for a broadcast.",
    icon: UsersRound,
  },
  {
    href: "/crm/segments",
    label: "Segments",
    works:
      "Group customers by lifetime spend, by channel, and by whether they are a known opt-out. The group is real and it counts real people.",
    blocked:
      "Two of the five facts are not connected yet — last order recency and tags — so a rule using either one matches nobody rather than guessing.",
    icon: Sparkles,
  },
];

/** 建好了、但每一面卡在不同的地方 —— 逐面写明今天做不到什么,不写工期。 */
export const IN_PREVIEW: readonly PreviewEntry[] = [
  {
    href: "/crm/inbox",
    label: "Inbox",
    works: "Read, search and organize the conversation records this workspace holds, and write a draft reply.",
    blocked:
      "Nothing comes in and nothing goes out. No channel delivers customer messages here, and sending a reply is refused by Fikirtive itself — the send path is not built, so there is no setting that would turn it on.",
    icon: Inbox,
  },
  {
    href: "/crm/templates",
    label: "Message templates",
    works: "Write the wording you would send and keep every version of it, with its own review record.",
    blocked:
      "A version can never become sendable. Submitting one for a messaging provider's approval is not built, so every version stays unapproved — and an unapproved version cannot carry a message.",
    icon: FileText,
  },
  {
    href: "/crm/broadcasts",
    label: "Broadcasts",
    works:
      "Build a broadcast, freeze exactly who is in it, and run it as a simulation that re-checks every contact's eligibility and records who would be skipped and why.",
    blocked: `The real send is refused at all times, whatever the broadcast's state. A run only ever records a ${SIMULATED_ATTEMPT_LABEL.toLowerCase()} against a contact — no message leaves Fikirtive.`,
    icon: Send,
  },
  {
    href: "/crm/workflows",
    label: "Workflows",
    works: "Write a rule, authorize exactly what a Routine may do, and inspect every decision it takes.",
    blocked:
      "Every run is simulated, and delivery and spend are disconnected. A published rule is not an active Routine, and no workflow action reaches a customer.",
    icon: Sparkles,
  },
  {
    href: "/crm/reports",
    label: "Delivery reports",
    works: "See what each broadcast attempted, contact by contact, and why anyone was skipped.",
    blocked:
      "Delivered, read and failed stay unknown — never zero, never a green tick. No provider receipts are connected, and the attempts on record are simulated ones.",
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
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">{entry.works}</span>
        <span className="mt-1.5 block text-sm leading-6 text-warning-soft-foreground">
          {entry.blocked}
        </span>
      </span>
    </Link>
  );
}

export function CustomersPreviewPage() {
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
            <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              {PREVIEW_PAGE_TITLE}
            </h1>
            <Badge variant="warning">Preview</Badge>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {MESSAGING_STATUS_MERCHANT}
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Posting to Instagram and Facebook is a different connection, and that one does work. A
            messaging channel on its own would still not be enough here: each page below stops in
            its own place, and each one says where.
          </p>
        </header>

        <Card className="mt-7">
          <CardHeader>
            <CardTitle>What works today</CardTitle>
            <CardDescription>
              These do their whole job right now, with no channel involved — and each says where its
              own limit is.
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
            <CardTitle>In preview — open, but they cannot reach a customer</CardTitle>
            <CardDescription>
              These pages open and do real work inside your own records. What none of them can do is
              reach a customer, and they are not all missing the same thing.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {IN_PREVIEW.map((entry) => (
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
