import { renderAdminV2Page } from "@/lib/admin-v2-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otto Ops · Fikirtive admin" };

export default async function OttoOpsPage() {
  return renderAdminV2Page("otto", "knowledge", "/admin/otto");
}
