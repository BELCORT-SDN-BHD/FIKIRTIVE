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

export type CrmConsentState = {
  state: "unknown" | "verified_grant" | "effective_revoke";
  stateSourceKind: string | null;
  evidenceStatus: string | null;
  lastReceivedAt: Date | null;
};

export type CrmConsentEventRow = {
  id: string;
  channel: string;
  purpose: string;
  action: string;
  actorKind: string;
  entryMode: string;
  sourceKind: string;
  evidenceStatus: string;
  occurredAt: Date | null;
  receivedAt: Date;
};

export type CrmContactRow = {
  id: string;
  name: string;
  lifecycleStage: string;
  source: string;
  firstTouchCampaignId: string | null;
  firstTouchAt: Date;
  lastSeenAt: Date;
  consentState: CrmConsentState;
  doNotDisturb: boolean;
  /** Read-only receipt truth. null means no order receipt is available. */
  totalOrdersMyr: string | null;
  createdAt: Date;
  identities: CrmIdentityRow[];
};

export type CrmContactDetailRow = CrmContactRow & { consentEvents: CrmConsentEventRow[] };
export type CrmContactsResult = { ok: true; contacts: CrmContactRow[] } | { error: string };
export type CrmContactResult = { ok: true; contact: CrmContactDetailRow } | { error: string };

function contactSelect(ownerId: string) {
  return {
    id: true,
    name: true,
    lifecycleStage: true,
    source: true,
    firstTouchCampaignId: true,
    firstTouchAt: true,
    lastSeenAt: true,
    doNotDisturb: true,
    totalOrdersMyr: true,
    createdAt: true,
    identities: {
      where: { ownerId, deletedAt: null },
      select: { id: true, channel: true, externalId: true, handle: true, label: true },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    },
    consentStateProjections: {
      where: { ownerId, channel: "whatsapp", purpose: "marketing" },
      select: {
        state: true,
        stateSourceKind: true,
        evidenceStatus: true,
        lastReceivedAt: true,
      },
      take: 1,
    },
  };
}

type DbContactRow = {
  id: string;
  name: string;
  lifecycleStage: string;
  source: string;
  firstTouchCampaignId: string | null;
  firstTouchAt: Date;
  lastSeenAt: Date;
  doNotDisturb: boolean;
  totalOrdersMyr: null | string | number | { toString(): string };
  createdAt: Date;
  identities: CrmIdentityRow[];
  consentStateProjections: Array<{
    state: string;
    stateSourceKind: string;
    evidenceStatus: string;
    lastReceivedAt: Date;
  }>;
};

function presentContact(row: DbContactRow): CrmContactRow {
  const projection = row.consentStateProjections[0];
  const state =
    projection?.state === "verified_grant" || projection?.state === "effective_revoke"
      ? projection.state
      : "unknown";
  return {
    id: row.id,
    name: row.name,
    lifecycleStage: row.lifecycleStage,
    source: row.source,
    firstTouchCampaignId: row.firstTouchCampaignId,
    firstTouchAt: row.firstTouchAt,
    lastSeenAt: row.lastSeenAt,
    consentState: {
      state,
      stateSourceKind: projection?.stateSourceKind ?? null,
      evidenceStatus: projection?.evidenceStatus ?? null,
      lastReceivedAt: projection?.lastReceivedAt ?? null,
    },
    doNotDisturb: row.doNotDisturb,
    totalOrdersMyr: row.totalOrdersMyr == null ? null : row.totalOrdersMyr.toString(),
    createdAt: row.createdAt,
    identities: row.identities,
  };
}

function limitOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(value, 100))
    : 50;
}

function queryOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const query = value.trim().slice(0, 200);
  return query || undefined;
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
  const input = (raw ?? {}) as { lifecycleStage?: unknown; query?: unknown; limit?: unknown };
  if (input.lifecycleStage !== undefined && !isCrmLifecycleStage(input.lifecycleStage)) {
    return { error: "Pick a valid lifecycle stage." };
  }
  const contacts = await readContacts(gate.ownerId, {
    lifecycleStage: input.lifecycleStage as CrmLifecycleStage | undefined,
    query: queryOf(input.query),
    limit: limitOf(input.limit),
  });
  return { ok: true, contacts };
}

export async function getContact(rawId: unknown): Promise<CrmContactResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const id = typeof rawId === "string" ? rawId.trim().slice(0, 64) : "";
  if (!id) return { error: "Invalid request." };
  const row = await prisma.contact.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: {
      ...contactSelect(gate.ownerId),
      consentEvents: {
        where: { ownerId: gate.ownerId },
        select: {
          id: true,
          channel: true,
          purpose: true,
          action: true,
          actorKind: true,
          entryMode: true,
          sourceKind: true,
          evidenceStatus: true,
          occurredAt: true,
          receivedAt: true,
        },
        orderBy: [{ receivedAt: "desc" as const }, { id: "desc" as const }],
        take: 100,
      },
    },
  });
  if (!row) return { error: "Contact not found." };
  const dbRow = row as unknown as DbContactRow & { consentEvents: CrmConsentEventRow[] };
  return { ok: true, contact: { ...presentContact(dbRow), consentEvents: dbRow.consentEvents } };
}

export async function searchContacts(raw: unknown): Promise<CrmContactsResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const input = typeof raw === "string"
    ? { query: raw, lifecycleStage: undefined, limit: undefined }
    : ((raw ?? {}) as { query?: unknown; lifecycleStage?: unknown; limit?: unknown });
  const query = queryOf(input.query);
  if (!query) return { ok: true, contacts: [] };
  if (input.lifecycleStage !== undefined && !isCrmLifecycleStage(input.lifecycleStage)) {
    return { error: "Pick a valid lifecycle stage." };
  }
  const contacts = await readContacts(gate.ownerId, {
    query,
    lifecycleStage: input.lifecycleStage as CrmLifecycleStage | undefined,
    limit: limitOf(input.limit),
  });
  return { ok: true, contacts };
}
