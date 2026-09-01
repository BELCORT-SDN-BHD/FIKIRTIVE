import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/** CRM 整段收起来了(W2-13 / #993)。文件保留、内容换成重定向,旧书签不撞墙 ——
 *  原委与恢复条件写在 app/crm/page.tsx。 */
export default async function CrmTemplatesRoute() {
  redirect(SHELL_ROUTES.home);
}
