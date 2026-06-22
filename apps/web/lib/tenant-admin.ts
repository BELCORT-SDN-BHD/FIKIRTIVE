import "server-only";
import { prisma } from "@artlio/db";
import { displayCredits, FOUNDER_OWNER_ID } from "@artlio/core";

export type TenantRow = {
  orgId: string;
  name: string;
  ownerEmail: string;
  status: string;
  balance: number;
  genCount: number;
  lastActiveAt: string | null;
};

export type InvitedRow = {
  email: string;
  status: string;
  invitedBy: string;
  createdAt: string;
};

export type TenantDetail = {
  orgId: string;
  name: string;
  ownerEmail: string;
  status: string;
  balance: number;
  reserved: number;
  spentUsd: number;
  projectCount: number;
  genCount: number;
  ledger: { id: string; kind: string; displayedDelta: number; reason: string; createdAt: string }[];
  audit: { id: string; type: string; createdAt: string }[];
};

export async function listTenants(): Promise<{ tenants: TenantRow[]; invited: InvitedRow[] }> {
  const [orgs, memberships, accounts, genAgg, invitedRows] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { not: FOUNDER_OWNER_ID }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.membership.findMany({
      where: { orgId: { not: FOUNDER_OWNER_ID }, deletedAt: null, role: "owner" },
      select: { orgId: true, status: true, user: { select: { email: true } } },
    }),
    prisma.creditAccount.findMany({
      where: { orgId: { not: FOUNDER_OWNER_ID } },
      select: { orgId: true, balance: true },
    }),
    prisma.generation.groupBy({
      by: ["ownerId"],
      where: { deletedAt: null, ownerId: { not: FOUNDER_OWNER_ID } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.allowedEmail.findMany({
      orderBy: { createdAt: "desc" },
      select: { email: true, status: true, invitedBy: true, createdAt: true },
    }),
  ]);

  const ownerByOrg = new Map(memberships.map((m) => [m.orgId, m]));
  const balByOrg = new Map(accounts.map((a) => [a.orgId, a.balance]));
  const genByOrg = new Map(genAgg.map((g) => [g.ownerId, g]));

  const tenants: TenantRow[] = orgs.map((o) => {
    const m = ownerByOrg.get(o.id);
    const g = genByOrg.get(o.id);
    return {
      orgId: o.id,
      name: o.name,
      ownerEmail: m?.user?.email ?? "",
      status: m?.status ?? "unknown",
      balance: displayCredits(balByOrg.get(o.id) ?? 0),
      genCount: g?._count?._all ?? 0,
      lastActiveAt: g?._max?.createdAt ? g._max.createdAt.toISOString() : null,
    };
  });

  // Once a merchant signs in they own a tenant org (above). Their AllowedEmail row stays
  // 'invited' (sign-in doesn't flip it), so drop already-active emails from the invite list
  // — otherwise a signed-in merchant lingers under "Invited (not yet signed in)".
  const activeEmails = new Set(tenants.map((t) => t.ownerEmail.toLowerCase()).filter(Boolean));
  const invited: InvitedRow[] = invitedRows
    .filter((r) => !activeEmails.has(r.email.toLowerCase()))
    .map((r) => ({
      email: r.email,
      status: r.status,
      invitedBy: r.invitedBy,
      createdAt: r.createdAt.toISOString(),
    }));

  return { tenants, invited };
}

export async function getTenantDetail(orgId: string): Promise<TenantDetail | null> {
  if (orgId === FOUNDER_OWNER_ID) return null;

  const org = await prisma.organization.findFirst({
    where: { id: orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!org) return null;

  const [membership, account, ledgerRows, genSpend, refSpend, projectCount, genCount, auditRows] = await Promise.all([
    prisma.membership.findFirst({
      where: { orgId, deletedAt: null, role: "owner" },
      select: { status: true, user: { select: { email: true } } },
    }),
    prisma.creditAccount.findUnique({
      where: { orgId },
      select: { balance: true, reserved: true },
    }),
    prisma.creditLedger.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, kind: true, balanceDelta: true, reason: true, createdAt: true },
    }),
    prisma.genJob.aggregate({
      where: { ownerId: orgId },
      _sum: { spentUsd: true },
    }),
    prisma.refGenJob.aggregate({
      where: { ownerId: orgId },
      _sum: { spentUsd: true },
    }),
    prisma.project.count({ where: { ownerId: orgId, deletedAt: null } }),
    prisma.generation.count({ where: { ownerId: orgId, deletedAt: null } }),
    prisma.actionEvent.findMany({
      where: { ownerId: orgId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, type: true, createdAt: true },
    }),
  ]);

  return {
    orgId: org.id,
    name: org.name,
    ownerEmail: membership?.user?.email ?? "",
    status: membership?.status ?? "unknown",
    balance: displayCredits(account?.balance ?? 0),
    reserved: displayCredits(account?.reserved ?? 0),
    spentUsd: Number(genSpend._sum.spentUsd ?? 0) + Number(refSpend._sum.spentUsd ?? 0),
    projectCount,
    genCount,
    ledger: ledgerRows.map((l) => ({
      id: l.id,
      kind: l.kind,
      displayedDelta: displayCredits(l.balanceDelta),
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
    })),
    audit: auditRows.map((a) => ({
      id: a.id,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
