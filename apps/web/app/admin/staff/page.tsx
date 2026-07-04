import { renderAdminV2Page } from "@/lib/admin-v2-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff · Fikirtive admin" };

export default async function StaffPage() {
  return renderAdminV2Page("staff", "team", "/admin/staff");
}
