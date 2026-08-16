import { redirect } from "next/navigation";
import type { Section } from "@fikirtive/core";
import { AdminDashboardV2 } from "@/components/admin/AdminDashboardV2";
import { requireRole } from "@/lib/auth-guard";
import { getAdminV2Data, type AdminV2Section } from "@/lib/admin-v2";

export async function renderAdminV2Page(section: AdminV2Section, gateSection: Section, from: string) {
  const gate = await requireRole(gateSection, "read");
  if ("error" in gate) redirect(`/login?from=${from}`);

  const data = await getAdminV2Data();
  return <AdminDashboardV2 section={section} data={data} selfEmail={gate.email} />;
}
