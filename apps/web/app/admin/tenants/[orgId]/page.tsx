import { redirect, notFound } from "next/navigation";
import { requireRole } from "@/lib/auth-guard";
import { getTenantDetail } from "@/lib/tenant-admin";
import { TenantDetail } from "@/components/admin/TenantDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenant · Artlio admin" };

export default async function TenantDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const gate = await requireRole("tenants", "read");
  if ("error" in gate) redirect("/login?from=/admin/tenants");
  const { orgId } = await params;
  const detail = await getTenantDetail(orgId);
  if (!detail) notFound();
  return <TenantDetail detail={detail} />;
}
