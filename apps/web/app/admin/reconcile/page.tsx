import { redirect } from "next/navigation";
import { ReconcileBoard } from "@/components/admin/ReconcileBoard";
import { requireRole } from "@/lib/auth-guard";
import { listReconcileObservations } from "@/lib/reconcile-actions";

/**
 * MONEY-A12 —— 「商家付了钱,账本没有那一行」的未了结清单。
 *
 * 为什么要有这一页:对账哨兵每 30 分钟扫一轮,缺口在了结之前每天报一次警(规格 §7.5
 * 「持续追踪至人工关闭」)。它自己只关得掉一种 —— 账本行补上了。另一种(在 Stripe 后台
 * 退了款、那是一笔测试 session)只有人知道,而在这一页出现之前,人**没有地方**告诉它。
 * 一个关不掉的报警会被训练成「可以不看」,那比没有报警更糟。
 *
 * 与 `/admin/queue` 同样不走 `renderAdminV2Page`:那个 helper 会加载八个 v2 页共用的
 * 平台读模型,这一页一格都用不上。
 *
 * 两道闸,与邻居一致:founder-only 的 admin 外壳(`app/admin/layout.tsx`),以及这里的
 * `credits.mutate` —— 与人工调账同一把钥匙,读与关同一个能力,页面上不会出现一个
 * 「看得见却按不动」的按钮。
 */

// 读的是实时审计行,永不预渲染。
export const dynamic = "force-dynamic";
export const metadata = { title: "Payment reconciliation · Fikirtive admin" };

export default async function ReconcilePage() {
  const gate = await requireRole("credits", "mutate");
  if ("error" in gate) redirect("/login?from=/admin/reconcile");

  const result = await listReconcileObservations();
  return <ReconcileBoard result={result} />;
}
