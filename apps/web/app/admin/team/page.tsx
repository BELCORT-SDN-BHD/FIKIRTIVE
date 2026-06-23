import { redirect } from "next/navigation";
import { prisma } from "@fikirtive/db";
import { ROLES } from "@fikirtive/core";
import { requireRole } from "@/lib/auth-guard";
import { TeamAdmin, type TeamRow } from "@/components/admin/TeamAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Team & access · Fikirtive admin" };

export default async function TeamPage() {
  // §④ Team & access is super-admin-only (matrix). requireRole audits a denied read.
  const gate = await requireRole("team", "read");
  if ("error" in gate) redirect("/login?from=/admin/team");

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true },
    orderBy: { email: "asc" },
  });
  const rows: TeamRow[] = users.map((u) => ({ id: u.id, email: u.email, name: u.name ?? "", role: u.role }));
  return <TeamAdmin rows={rows} roles={[...ROLES]} selfEmail={gate.email} />;
}
