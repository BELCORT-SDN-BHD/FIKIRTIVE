"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "@/lib/auth-guard";
import { contactConsentTruth } from "./consent-authority";
import { ownedContactsWhere } from "./crm-contact-scope";
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
  /**
   * #752 — the pre-ledger fence, read from the SAME predicate segment selection reads
   * (`contactConsentTruth`), so a contact this product keeps out of every audience is never
   * described as "Unknown" on the page the merchant opens to check.
   *
   * The ledger genuinely knows nothing about this contact (`state` stays `unknown`), so the
   * badge cannot come from `state` alone — the honest sentence needs both halves of the fact.
   */
  unresolvedLegacyOptOut: boolean;
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
/**
 * `contacts` is one page. `totalCount` is how many rows the same owner-scoped filter has in
 * total, so the merchant is never shown a truncated list that pretends to be everything.
 */
export type CrmContactsResult =
  | {
      ok: true;
      contacts: CrmContactRow[];
      totalCount: number;
      nextCursor: string | null;
      hasMore: boolean;
    }
  | { error: string };
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
    // Never an authority of its own (#726) and never a source of a badge on its own: it is fed
    // to `contactConsentTruth`, which can only hold a contact OUT, never let one in. Same read,
    // same direction, same one predicate the segments page and the broadcast freeze use (#752).
    marketingConsent: true,
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
  marketingConsent: string | null;
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
  // One predicate, not a second copy of it: `contactConsentTruth` is the same function segment
  // selection calls, in the same whatsapp × marketing scope these pages already display.
  const truth = contactConsentTruth(
    { state, unresolvedLegacyOptOut: false, reportedOptOut: false },
    row.marketingConsent,
  );
  return {
    id: row.id,
    name: row.name,
    lifecycleStage: row.lifecycleStage,
    source: row.source,
    firstTouchCampaignId: row.firstTouchCampaignId,
    firstTouchAt: row.firstTouchAt,
    lastSeenAt: row.lastSeenAt,
    consentState: {
      state: truth.state,
      stateSourceKind: projection?.stateSourceKind ?? null,
      evidenceStatus: projection?.evidenceStatus ?? null,
      lastReceivedAt: projection?.lastReceivedAt ?? null,
      unresolvedLegacyOptOut: truth.unresolvedLegacyOptOut,
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

type ContactCursor = { lastSeenAt: Date; id: string };

/** Keyset position, matching the `lastSeenAt desc, id asc` read order. */
function encodeCursor(row: CrmContactRow): string {
  return `${row.lastSeenAt.toISOString()}|${row.id}`;
}

function readCursor(value: unknown): { ok: true; cursor: ContactCursor | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, cursor: null };
  if (typeof value !== "string") return { ok: false };
  const separator = value.indexOf("|");
  if (separator <= 0) return { ok: false };
  const lastSeenAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (Number.isNaN(lastSeenAt.getTime()) || !id || id.length > 64) return { ok: false };
  return { ok: true, cursor: { lastSeenAt, id } };
}

type ContactPage = { contacts: CrmContactRow[]; nextCursor: string | null; hasMore: boolean };

async function readContactPage(
  ownerId: string,
  options: {
    lifecycleStage?: CrmLifecycleStage;
    query?: string;
    limit: number;
    cursor: ContactCursor | null;
  },
): Promise<ContactPage> {
  const scope = ownedContactsWhere(ownerId, {
    lifecycleStage: options.lifecycleStage,
    query: options.query,
  });
  const cursor = options.cursor;
  const rows = await prisma.contact.findMany({
    // `AND` (not a second `OR`) so the keyset never widens a search filter.
    where: cursor
      ? {
          ...scope,
          AND: [{
            OR: [
              { lastSeenAt: { lt: cursor.lastSeenAt } },
              { lastSeenAt: cursor.lastSeenAt, id: { gt: cursor.id } },
            ],
          }],
        }
      : scope,
    select: contactSelect(ownerId),
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    // One extra row answers "is there more" without a second query.
    take: options.limit + 1,
  });
  const hasMore = rows.length > options.limit;
  const contacts = (rows as unknown as DbContactRow[]).slice(0, options.limit).map(presentContact);
  const last = contacts.at(-1);
  return {
    contacts,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export async function listContacts(raw?: unknown): Promise<CrmContactsResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const input = (raw ?? {}) as {
    lifecycleStage?: unknown;
    query?: unknown;
    limit?: unknown;
    cursor?: unknown;
  };
  if (input.lifecycleStage !== undefined && !isCrmLifecycleStage(input.lifecycleStage)) {
    return { error: "Pick a valid lifecycle stage." };
  }
  const cursor = readCursor(input.cursor);
  if (!cursor.ok) return { error: "Refresh the contact list and try again." };
  const filter = {
    lifecycleStage: input.lifecycleStage as CrmLifecycleStage | undefined,
    query: queryOf(input.query),
  };
  const [page, totalCount] = await Promise.all([
    readContactPage(gate.ownerId, { ...filter, limit: limitOf(input.limit), cursor: cursor.cursor }),
    prisma.contact.count({ where: ownedContactsWhere(gate.ownerId, filter) }),
  ]);
  return { ok: true, ...page, totalCount };
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
    ? { query: raw, lifecycleStage: undefined, limit: undefined, cursor: undefined }
    : ((raw ?? {}) as {
        query?: unknown;
        lifecycleStage?: unknown;
        limit?: unknown;
        cursor?: unknown;
      });
  const query = queryOf(input.query);
  if (!query) return { ok: true, contacts: [], totalCount: 0, nextCursor: null, hasMore: false };
  if (input.lifecycleStage !== undefined && !isCrmLifecycleStage(input.lifecycleStage)) {
    return { error: "Pick a valid lifecycle stage." };
  }
  const cursor = readCursor(input.cursor);
  if (!cursor.ok) return { error: "Refresh the contact list and try again." };
  const filter = {
    query,
    lifecycleStage: input.lifecycleStage as CrmLifecycleStage | undefined,
  };
  const [page, totalCount] = await Promise.all([
    readContactPage(gate.ownerId, { ...filter, limit: limitOf(input.limit), cursor: cursor.cursor }),
    prisma.contact.count({ where: ownedContactsWhere(gate.ownerId, filter) }),
  ]);
  return { ok: true, ...page, totalCount };
}
