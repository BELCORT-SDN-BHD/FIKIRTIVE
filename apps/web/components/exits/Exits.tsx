/**
 * Exits — 把 lib/exits.ts 里的去处渲染成商家真的能点的东西。
 *
 * 只有三个组件,因为整个产品只有三种「下一步」:找人、去充值、去 Brand memory。
 * 谁要指路都用它们,不许再在别处手写一句不能点的文字(#686 #687 #701 #707)。
 */
import type { ReactNode } from "react";
import { BILLING_HREF, supportMailto } from "@/lib/exits";
import { TOP_UP_CTA } from "@/lib/credit-format";

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
 * 服务端拼好的那句拒绝 —— 照原样说出来,但把结尾那句「Top up in Billing.」换成一条真的
 * 能点的路(#979)。
 *
 * 为什么不是 `TopUpNotice`:那个组件自己写句子,而这几句拒绝的**数字**只有服务端知道
 * (这一次报价是多少、余额还剩多少)。丢掉数字就退回 #699 之前那种「不说它是拿什么判的」
 * 的拒绝。所以句子不动,只把最后那一句接上路。
 *
 * 认的是 `TOP_UP_CTA` 这一份字面量(与拼句子的那一处同一个常量),不是模糊匹配:
 * 不以它收尾的错误(队列不可用、找不到项目、租户拒绝……)原样渲染,一个凭空的充值链接
 * 都不会长出来。
 */
export function ErrorWithTopUp({ text }: { text: string }) {
  if (!text.endsWith(TOP_UP_CTA)) return <>{text}</>;
  const head = text.slice(0, text.length - TOP_UP_CTA.length);
  return (
    <>
      {head}
      <ExitLink href={BILLING_HREF}>{TOP_UP_CTA.replace(/\.$/, "")}</ExitLink>.
    </>
  );
}

export function TopUpNotice({ need, alternative }: { need: string; alternative?: string }) {
  return (
    <div role="alert" className="text-[0.875rem] text-[var(--error-soft-foreground)]">
      Not enough credits to {need} — <ExitLink href={BILLING_HREF}>top up in Billing</ExitLink>
      {alternative ? ` or ${alternative}` : ""}.
    </div>
  );
}
