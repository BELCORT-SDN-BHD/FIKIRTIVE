import { renderAdminV2Page } from "@/lib/admin-v2-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit · Fikirtive admin" };

export default async function AuditPage() {
  return renderAdminV2Page("audit", "content", "/admin/audit");
}
