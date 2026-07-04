import { renderAdminV2Page } from "@/lib/admin-v2-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money · Fikirtive admin" };

export default async function MoneyPage() {
  return renderAdminV2Page("money", "credits", "/admin/money");
}
