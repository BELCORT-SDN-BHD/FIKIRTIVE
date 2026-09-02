/**
 * Exits — 把 lib/exits.ts 里的去处渲染成商家真的能点的东西。
 *
 * 只有三个组件,因为整个产品只有三种「下一步」:找人、去充值、去 Brand memory。
 * 谁要指路都用它们,不许再在别处手写一句不能点的文字(#686 #687 #701 #707)。
 */
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BILLING_HREF, supportMailto } from "@/lib/exits";
import { SPEND_CAP_RAISE_CTA, SPEND_CAP_RAISE_HREF, TOP_UP_CTA } from "@/lib/credit-format";

/** 行内出口链接 —— 长得像句子的一部分,但是真的能点。 */
export function ExitLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={`underline underline-offset-4 ${className ?? ""}`.trim()}>
      {children}
    </a>
  );
}

/** 人工出口。subject 说清商家为什么写信;label 让它读起来像原来那句话的一部分。 */
export function SupportExit({ subject, label = "Email support" }: { subject: string; label?: string }) {
  return <ExitLink href={supportMailto(subject)}>{label}</ExitLink>;
}

/**
 * 积分不够时,卡片对商家说的那一句 —— 连同去充值的路(#707)。
 *
 * 四个卡面出口曾经各写一份自己的措辞,全是 `role="alert"` 纯文本:商家已经想花钱了,
 * 还得自己找去 Billing 的路。这里把句子和路绑在一起,所以「换一句好听的死文字」这件事
 * 不可能再发生。
 *
 * `need` 是这一次做不成的事(「run this research」「make all 3」),`alternative` 是
 * 充值之外真的还有的另一条路 —— 没有就别写,产品不发明不存在的选项。
 */
/**
 * 认得出来的两句收尾,各自的去处(2026-09-03 走查 D2 补上第二句)。
 *
 * 走查在画布的拒绝提示里读到「Paused by your spend cap — … Raise the cap in Billing &
 * credits to run it.」,整句是死文字:商家已经决定要把上限调上去了,产品还是让他自己去找
 * 那一页 —— 和 #979 那次「Top up in Billing.」不能点是同一个病,只是换了一句话。
 *
 * 两句都不是模糊匹配:各钉一份服务端拼句子时用的同一个常量。上限那一句的地址来自
 * `SPEND_CAP_RAISE_HREF`(与句子里念的那个名字取自同一格 `SETTINGS_SECTIONS`),所以
 * 「句子念的名字」和「链接去的地方」不可能分头改。
 *
 * 刻意**不**给它们同一条路的两种说法:钱不够去买,上限拦住去改上限。给被上限拦住的商家一条
 * 充值链接是假话 —— 他不缺钱,买了也照样跑不了。
 */
const EXIT_TAILS: readonly { readonly cta: string; readonly href: string }[] = [
  { cta: TOP_UP_CTA, href: BILLING_HREF },
  { cta: SPEND_CAP_RAISE_CTA, href: SPEND_CAP_RAISE_HREF },
];

/**
 * 服务端拼好的那句拒绝 —— 照原样说出来,但把结尾那句出路换成一条真的能点的路(#979)。
 *
 * 为什么不是 `TopUpNotice`:那个组件自己写句子,而这几句拒绝的**数字**只有服务端知道
 * (这一次报价是多少、余额还剩多少、上限定在几)。丢掉数字就退回 #699 之前那种「不说它是
 * 拿什么判的」的拒绝。所以句子不动,只把最后那一句接上路。
 *
 * 认的是常量字面量(与拼句子的那一处同一份),不是模糊匹配:不以它们收尾的错误(队列不可用、
 * 找不到项目、租户拒绝……)原样渲染,一条凭空的链接都不会长出来。名字留作 `ErrorWithTopUp`
 * 是刻意的 —— 三个卡面出口的反向围栏(`lib/__tests__/refgen-topup-exit.test.ts`)逐字钉着
 * 这个标签,改名只会让围栏认不出自己要守的东西。
 */
export function ErrorWithTopUp({ text }: { text: string }) {
  const tail = EXIT_TAILS.find((candidate) => text.endsWith(candidate.cta));
  if (!tail) return <>{text}</>;
  const head = text.slice(0, text.length - tail.cta.length);
  return (
    <>
      {head}
      <ExitLink href={tail.href}>{tail.cta.replace(/\.$/, "")}</ExitLink>.
    </>
  );
}

export function TopUpNotice({ need, alternative }: { need: string; alternative?: string }) {
  return (
    <Alert role="alert" variant="destructive" density="compact">
      <AlertTitle>Not enough credits</AlertTitle>
      <AlertDescription>
        To {need}, <ExitLink href={BILLING_HREF}>top up in Billing</ExitLink>
        {alternative ? ` or ${alternative}` : ""}.
      </AlertDescription>
    </Alert>
  );
}
