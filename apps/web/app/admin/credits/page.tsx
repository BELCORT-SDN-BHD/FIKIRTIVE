import { redirect } from "next/navigation";
import { prisma } from "@artlio/db";
import { FOUNDER_OWNER_ID, displayCredits } from "@artlio/core";
import { requireRole } from "@/lib/auth-guard";
import { CreditsAdmin, type LedgerRow } from "@/components/admin/CreditsAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Credits · Artlio admin" };

export default async function CreditsPage() {
  // §⑦ Credits read = finance (or super-admin). requireRole re-asserts the allowlist
  // outer wall + the section→role matrix, and audits a denied read.
  const gate = await requireRole("credits", "read");
  if ("error" in gate) redirect("/login?from=/admin/credits");

  // P2 is founder-scoped (one org). P3 (multi-tenant) will list orgs / accept an orgId.
  const orgId = FOUNDER_OWNER_ID;
  const [account, ledger] = await Promise.all([
    prisma.creditAccount.findUnique({ where: { orgId }, select: { balance: true, reserved: true } }),
    prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const rows: LedgerRow[] = ledger.map((l) => ({
    id: l.id,
    kind: l.kind,
    source: l.source,
    displayedDelta: displayCredits(l.balanceDelta), // internal → displayed credits
    displayedReservedDelta: displayCredits(l.reservedDelta), // the hold movement (SETTLE moves only this)
    reason: l.reason,
    createdBy: l.createdBy,
    createdAt: l.createdAt.toISOString(),
  }));

  return <CreditsAdmin orgId={orgId} balance={account?.balance ?? 0} reserved={account?.reserved ?? 0} rows={rows} />;
}
