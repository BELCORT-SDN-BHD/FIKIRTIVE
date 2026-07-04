import { renderAdminV2Page } from "@/lib/admin-v2-page";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "System · Fikirtive admin" };

export default async function SystemPage() {
  return renderAdminV2Page("system", "system", "/admin/system");
}
