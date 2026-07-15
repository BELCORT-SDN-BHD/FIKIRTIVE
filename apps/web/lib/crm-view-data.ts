"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "@/lib/auth-guard";
import { isCrmLifecycleStage, type CrmLifecycleStage } from "./crm-identity";

export type CrmIdentityRow = {
  id: string;
  channel: string;
  externalId: string;
  handle: string | null;
  label: string | null;
};

export type CrmContactRow = {
  id: string;
  name: string;
  lifecycleStage: string;
  source: string;
  firstTouchCampaignId: string | null;
  firstTouchAt: Date;
  lastSeenAt: Date;
  marketingConsent: string;
  consentSource: string | null;
  consentAt: Date | null;
  doNotDisturb: boolean;
  /** Read-only receipt truth. null means no order receipt is available. */
  totalOrdersMyr: string | null;
  createdAt: Date;
  identities: CrmIdentityRow[];
};

export type CrmContactsResult = { ok: true; contacts: CrmContactRow[] } | { error: string };
export type CrmContactResult = { ok: true; contact: CrmContactRow } | { error: string };

function contactSelect(ownerId: string) {
  return {
    id: true,
    name: true,
    lifecycleStage: true,
    source: true,
    firstTouchCampaignId: true,
    firstTouchAt: true,
    lastSeenAt: true,
    marketingConsent: true,
    consentSource: true,
    consentAt: true,
    doNotDisturb: true,
    totalOrdersMyr: true,
    createdAt: true,
    identities: {
      // Nested reads are tenant reads too. Never trust a legacy/bad FK to make
      // ContactIdentity.ownerId agree with its parent Contact.
      where: { ownerId, deletedAt: null },
      select: { id: true, channel: true, externalId: true, handle: true, label: true },
      orderBy: { createdAt: "asc" },
    },
  } as const;
}

type DbContactRow = Omit<CrmContactRow, "totalOrdersMyr"> & {
  totalOrdersMyr: null | string | number | { toString(): string };
};

function presentContact(row: DbContactRow): CrmContactRow {
  return {
    ...row,
    // Never synthesize 0: absent receipts stay null, distinct from a real RM0 total.
    totalOrdersMyr: row.totalOrdersMyr == null ? null : row.totalOrdersMyr.toString(),
  };
}

function limitOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(value, 100))
    : 50;
}

async function readContacts(
  ownerId: string,
  options: { lifecycleStage?: CrmLifecycleStage; query?: string; limit: number },
): Promise<CrmContactRow[]> {
  const query = options.query;
  const rows = await prisma.contact.findMany({
    where: {
      ownerId,
      deletedAt: null,
      ...(options.lifecycleStage ? { lifecycleStage: options.lifecycleStage } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              {
                identities: {
                  some: {
                    ownerId,
                    deletedAt: null,
                    externalId: { contains: query, mode: "insensitive" as const },
                  },
                },
              },
              {
                identities: {
                  some: {
                    ownerId,
                    deletedAt: null,
                    handle: { contains: query, mode: "insensitive" as const },
                  },
                },
              },
            ],
          }
        : {}),
    },
    select: contactSelect(ownerId),
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: options.limit,
  });
  return (rows as unknown as DbContactRow[]).map(presentContact);
}

export async function listContacts(raw?: unknown): Promise<CrmContactsResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const input = (raw ?? {}) as { lifecycleStage?: unknown; limit?: unknown };
  if (input.lifecycleStage !== undefined && !isCrmLifecycleStage(input.lifecycleStage)) {
    return { error: "Pick a valid lifecycle stage." };
  }
  const contacts = await readContacts(gate.ownerId, {
    lifecycleStage: input.lifecycleStage as CrmLifecycleStage | undefined,
    limit: limitOf(input.limit),
  });
  return { ok: true, contacts };
}

export async function getContact(rawId: unknown): Promise<CrmContactResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!id) return { error: "Invalid request." };
  const row = await prisma.contact.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: contactSelect(gate.ownerId),
  });
  if (!row) return { error: "Contact not found." };
  return { ok: true, contact: presentContact(row as unknown as DbContactRow) };
}

export async function searchContacts(rawQuery: unknown, rawLimit?: unknown): Promise<CrmContactsResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const query = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 200) : "";
  if (!query) return { ok: true, contacts: [] };
  const contacts = await readContacts(gate.ownerId, { query, limit: limitOf(rawLimit) });
  return { ok: true, contacts };
}
