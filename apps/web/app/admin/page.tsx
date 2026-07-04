import { renderAdminV2Page } from "@/lib/admin-v2-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview · Fikirtive admin" };

export default async function AdminIndexPage() {
  return renderAdminV2Page("overview", "system", "/admin");
}
