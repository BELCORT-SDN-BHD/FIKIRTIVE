import "server-only";

import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";

export const CRM_LIFECYCLE_STAGES = ["New", "Active", "Dormant"] as const;
export type CrmLifecycleStage = (typeof CRM_LIFECYCLE_STAGES)[number];

export type ContactIdentityInput = {
  channel: string;
  externalId: string;
  handle?: string | null;
  label?: string | null;
};

export type NormalizedContactIdentity = {
  channel: string;
  externalId: string;
  handle: string | null;
  label: string | null;
};

export type FindOrCreateContactInput = {
  ownerId: string;
  name: string;
  source: string;
  lifecycleStage: CrmLifecycleStage;
  identity: ContactIdentityInput;
  seenAt?: Date;
};

export type FindOrCreateContactResult =
  | { ok: true; contactId: string; created: boolean; possibleDuplicateIds: string[] }
  | { error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNEL = /^[a-z0-9][a-z0-9_-]*$/;

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function isCrmLifecycleStage(value: unknown): value is CrmLifecycleStage {
  return CRM_LIFECYCLE_STAGES.includes(value as CrmLifecycleStage);
}

/** Deterministic strong-identity normalization. We never guess a country code: a
 * WhatsApp identity must already include one, then formatting punctuation is removed. */
export function normalizeContactIdentity(
  input: ContactIdentityInput,
): NormalizedContactIdentity | { error: string } {
  const channel = typeof input?.channel === "string" ? input.channel.trim().toLowerCase() : "";
  if (!channel || channel.length > 40 || !CHANNEL.test(channel)) {
    return { error: "Pick a valid contact channel." };
  }
  const rawExternalId = typeof input?.externalId === "string" ? input.externalId.trim() : "";
  if (!rawExternalId || rawExternalId.length > 256) return { error: "Add a valid contact identity." };

  let externalId = rawExternalId;
  if (channel === "whatsapp") {
    externalId = rawExternalId.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(externalId)) {
      return { error: "Use a WhatsApp number in E.164 format, including the country code." };
    }
  } else if (channel === "email") {
    externalId = rawExternalId.toLowerCase();
    if (!EMAIL.test(externalId)) return { error: "Add a valid email address." };
  }

  return {
    channel,
    externalId,
    handle: optionalText(input.handle, 120),
    label: optionalText(input.label, 120),
  };
}

async function findLiveIdentity(ownerId: string, identity: NormalizedContactIdentity) {
  return prisma.contactIdentity.findFirst({
    where: {
      ownerId,
      channel: identity.channel,
      externalId: identity.externalId,
      deletedAt: null,
      contact: { ownerId, deletedAt: null },
    },
    select: { contactId: true },
  });
}

async function refreshExistingContact(
  ownerId: string,
  contactId: string,
  seenAt: Date,
): Promise<FindOrCreateContactResult> {
  const { count } = await prisma.contact.updateMany({
    where: { id: contactId, ownerId, deletedAt: null },
    data: { lastSeenAt: seenAt },
  });
  if (!count) return { error: "Contact not found." };
  return { ok: true, contactId, created: false, possibleDuplicateIds: [] };
}

/** Shared identity authority for manual CRM now and channel/CSV ingestion later.
 * The caller must derive ownerId from requireOwner; this module is server-only and
 * is deliberately not a client-callable action. A strong-identity hit mutates only
 * lastSeenAt. The live partial unique index closes the concurrent create race. */
export async function findOrCreateContactByIdentity(
  input: FindOrCreateContactInput,
): Promise<FindOrCreateContactResult> {
  if (!input.ownerId || !input.name?.trim() || !input.source?.trim() || !isCrmLifecycleStage(input.lifecycleStage)) {
    return { error: "Invalid contact details." };
  }
  const identity = normalizeContactIdentity(input.identity);
  if ("error" in identity) return identity;
  const name = input.name.trim().slice(0, 200);
  const source = input.source.trim().slice(0, 120);
  const seenAt = input.seenAt ?? new Date();

  const existing = await findLiveIdentity(input.ownerId, identity);
  if (existing) return refreshExistingContact(input.ownerId, existing.contactId, seenAt);

  // Same-name rows are only suggestions. They never participate in identity convergence.
  const possibleDuplicates = await prisma.contact.findMany({
    where: { ownerId: input.ownerId, deletedAt: null, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
    take: 10,
  });
  const contactId = newId();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.create({
        data: {
          id: contactId,
          ownerId: input.ownerId,
          name,
          source,
          lifecycleStage: input.lifecycleStage,
          firstTouchAt: seenAt,
          lastSeenAt: seenAt,
          marketingConsent: "unknown",
          consentSource: null,
          consentAt: null,
        },
      });
      await tx.contactIdentity.create({
        data: {
          id: newId(),
          ownerId: input.ownerId,
          contactId,
          ...identity,
        },
      });
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: input.ownerId,
          type: "crm.contact.create",
          payload: { contactId, source, channel: identity.channel },
        },
      });
    });
  } catch (error) {
    // The live (ownerId,channel,externalId) index is the race-proof authority.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      const winner = await findLiveIdentity(input.ownerId, identity);
      if (winner) return refreshExistingContact(input.ownerId, winner.contactId, seenAt);
    }
    return { error: "Couldn't save that contact — please try again." };
  }

  return {
    ok: true,
    contactId,
    created: true,
    possibleDuplicateIds: possibleDuplicates.map((contact) => contact.id),
  };
}
