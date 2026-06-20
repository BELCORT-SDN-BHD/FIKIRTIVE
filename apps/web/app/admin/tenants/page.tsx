import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-guard";
import { listTenants } from "@/lib/tenant-admin";
import { TenantsAdmin } from "@/components/admin/TenantsAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Tenants · Artlio admin" };

export default async function TenantsPage() {
  const gate = await requireRole("tenants", "read");
  if ("error" in gate) redirect("/login?from=/admin/tenants");
  const { tenants, invited } = await listTenants();
  return <TenantsAdmin tenants={tenants} invited={invited} />;
}
