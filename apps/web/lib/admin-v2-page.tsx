import { redirect } from "next/navigation";
import type { Section } from "@fikirtive/core";
import { AdminDashboardV2 } from "@/components/admin/AdminDashboardV2";
import { requireRole, staffPrincipal } from "@/lib/auth-guard";
import { runAsStaff } from "@fikirtive/db/principal";
import { getAdminV2Data, type AdminV2Section } from "@/lib/admin-v2";

export async function renderAdminV2Page(section: AdminV2Section, gateSection: Section, from: string) {
  const gate = await requireRole(gateSection, "read");
  if ("error" in gate) redirect(`/login?from=${from}`);

  // #1379（规格 TENANT 切片④，#479 并案裁定）：八个 v2 页共用的平台读模型，没有单一目标租户 ——
  // ownerId=null（同 kind:"system" 的扫描域，规格 §1.6）。
  const data = await runAsStaff(staffPrincipal(gate, null), () => getAdminV2Data());
  return <AdminDashboardV2 section={section} data={data} selfEmail={gate.email} />;
}
