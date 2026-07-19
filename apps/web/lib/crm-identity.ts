import "server-only";

import { prisma } from "@fikirtive/db";

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

export type ContactDuplicateSuggestion = {
  contactId: string;
  name: string;
  reasons: string[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNEL = /^[a-z0-9][a-z0-9_-]*$/;

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function comparableName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function identityReason(channel: string): string {
  if (channel === "whatsapp") return "Same WhatsApp number";
  if (channel === "email") return "Same email address";
  return `Same ${channel} identity`;
}

export function isCrmLifecycleStage(value: unknown): value is CrmLifecycleStage {
  return CRM_LIFECYCLE_STAGES.includes(value as CrmLifecycleStage);
}

/**
 * Read-only normalization for duplicate suggestions and identity display. It never creates,
 * attaches, merges, revives, or otherwise mutates ContactIdentity rows.
 */
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

/**
 * Deterministic, owner-scoped duplicate suggestions. Ordinary profile signals are suggestions
 * only: this function has no write path and its stable ordering never implies a merge decision.
 */
export async function findContactDuplicateSuggestions(input: {
  ownerId: string;
  name: string;
  identities?: NormalizedContactIdentity[];
  excludeContactId?: string;
  limit?: number;
}): Promise<ContactDuplicateSuggestion[]> {
  const name = input.name.trim().slice(0, 200);
  const identities = [...(input.identities ?? [])]
    .sort((left, right) =>
      `${left.channel}:${left.externalId}`.localeCompare(`${right.channel}:${right.externalId}`),
    );
  const matches = await prisma.contact.findMany({
    where: {
      ownerId: input.ownerId,
      deletedAt: null,
      ...(input.excludeContactId ? { id: { not: input.excludeContactId } } : {}),
      OR: [
        { name: { equals: name, mode: "insensitive" as const } },
        ...identities.map((identity) => ({
          identities: {
            some: {
              ownerId: input.ownerId,
              deletedAt: null,
              channel: identity.channel,
              externalId: identity.externalId,
            },
          },
        })),
      ],
    },
    select: {
      id: true,
      name: true,
      identities: {
        where: { ownerId: input.ownerId, deletedAt: null },
        select: { channel: true, externalId: true },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(input.limit ?? 20, 50)),
  });

  const normalizedName = comparableName(name);
  return matches.map((contact) => {
    const reasons = new Set<string>();
    if (comparableName(contact.name) === normalizedName) reasons.add("Same name");
    for (const identity of identities) {
      if (
        contact.identities.some(
          (candidate) =>
            candidate.channel === identity.channel && candidate.externalId === identity.externalId,
        )
      ) {
        reasons.add(identityReason(identity.channel));
      }
    }
    return { contactId: contact.id, name: contact.name, reasons: [...reasons].sort() };
  });
}
