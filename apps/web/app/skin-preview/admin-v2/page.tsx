import { notFound } from "next/navigation";
import { AdminDashboardV2Prototype } from "@/components/admin/AdminDashboardV2Prototype";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin dashboard v2 preview" };

export default function AdminDashboardV2PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AdminDashboardV2Prototype />;
}

