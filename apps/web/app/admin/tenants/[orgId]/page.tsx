import { redirect, notFound } from "next/navigation";
import { requireRole, staffPrincipal } from "@/lib/auth-guard";
import { runAsStaff } from "@fikirtive/db/principal";
import { getTenantDetail } from "@/lib/tenant-admin";
import { TenantDetail } from "@/components/admin/TenantDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenant · Fikirtive admin" };

export default async function TenantDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireRole("tenants", "read");
  if ("error" in gate) redirect("/login?from=/admin/tenants");
  const { orgId } = await params;
  // #1379：目标租户已知（路径参数）—— ownerId=orgId。
  const detail = await runAsStaff(staffPrincipal(gate, orgId), () => getTenantDetail(orgId));
  if (!detail) notFound();
  return <TenantDetail detail={detail} />;
}
