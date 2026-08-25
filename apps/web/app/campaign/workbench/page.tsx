/**
 * `/campaign/workbench` —— 收敛掉的旧地址,只做一件事:把人送到 `/approvals`。
 *
 * 审批从来不是战役的一个子页面:它收的是 routine 产出、团队草稿与排期改动,战役只是
 * 其中一个来源。地址挂在 `/campaign/` 底下时,导航里的第六格与它自己的路径互相矛盾 ——
 * 商家读到的是「Approvals」,地址栏写的是「campaign/workbench」。W2-11 之后这一面
 * 已经是七格之一,所以这一票把身份与地址对齐:`/approvals` 变正主,这一条变重定向。
 *
 * 落点引 `SHELL_ROUTES.approvals` 而不是再写一遍字面量 —— 新地址只有一份权威。
 * query 原样带走(`?fixture=r22`、`?state=`、`?outcome=` 都是这一面真的会用的深链)。
 */
import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals · Fikirtive" };

export default async function CampaignWorkbenchAliasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
    else if (value !== undefined) next.set(key, value);
  }
  const query = next.toString();
  redirect(`${SHELL_ROUTES.approvals}${query ? `?${query}` : ""}`);
}
