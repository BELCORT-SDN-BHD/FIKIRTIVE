import { renderAdminV2Page } from "@/lib/admin-v2-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cases · Fikirtive admin" };

export default async function CasesPage() {
  return renderAdminV2Page("cases", "content", "/admin/cases");
}
