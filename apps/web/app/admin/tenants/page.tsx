import { renderAdminV2Page } from "@/lib/admin-v2-page";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Tenants · Fikirtive admin" };

export default async function TenantsPage() {
  return renderAdminV2Page("tenants", "tenants", "/admin/tenants");
}
