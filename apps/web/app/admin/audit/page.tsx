import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@artlio/db";
import { FOUNDER_OWNER_ID } from "@artlio/core";
import { AuditAdmin, type AuditRow } from "@/components/admin/AuditAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit · Artlio admin" };

// the money-gate taxonomy this viewer surfaces (the spend-relevant ActionEvent types)
const MONEY_GATE_TYPES = [
  "gen.start", "gen.guardian-block", "refgen.start",
  "cowork.turn", "cowork.enhance", "cowork.draft",
  "config.edit", "model.toggle", "directive.edit",
] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login?from=/admin/audit");

  const { type } = await searchParams;
  const active = type && (MONEY_GATE_TYPES as readonly string[]).includes(type) ? type : null;

  const events = await prisma.actionEvent.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, type: active ? active : { in: [...MONEY_GATE_TYPES] } },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: { id: true, type: true, projectId: true, payload: true, createdAt: true },
  });

  const rows: AuditRow[] = events.map((e) => ({
    id: e.id, type: e.type, projectId: e.projectId,
    payload: JSON.stringify(e.payload ?? {}), createdAt: e.createdAt.toISOString(),
  }));

  return <AuditAdmin rows={rows} types={[...MONEY_GATE_TYPES]} active={active} />;
}
