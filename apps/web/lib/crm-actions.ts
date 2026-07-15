"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { isImpersonating } from "@/lib/better-auth/compat";
import { requireOwner } from "@/lib/auth-guard";
import {
  findOrCreateContactByIdentity,
  isCrmLifecycleStage,
  type ContactIdentityInput,
  type CrmLifecycleStage,
} from "./crm-identity";

const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";
const CONSENT_VALUES = ["opt_in", "opt_out", "unknown"] as const;
type MarketingConsent = (typeof CONSENT_VALUES)[number];

export type AddLeadContactInput = {
  name: string;
  source?: string;
  lifecycleStage?: CrmLifecycleStage;
  identity?: ContactIdentityInput;
};

export type ContactMutationResult = { ok: true } | { error: string };
export type AddLeadContactResult =
  | { ok: true; contactId: string; created: boolean; possibleDuplicateIds: string[] }
  | { error: string };

class MergeRollbackError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function isMarketingConsent(value: unknown): value is MarketingConsent {
  return CONSENT_VALUES.includes(value as MarketingConsent);
}

/** Manual Add lead. A supplied strong identity goes through the shared convergence
 * authority; a name-only lead remains distinct and merely reports exact-name candidates. */
export async function addLeadContact(raw: unknown): Promise<AddLeadContactResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const name = text(input.name, 200);
  if (!name) return { error: "A contact needs a name." };
  const source = text(input.source, 120) ?? "manual";
  const lifecycleStage = input.lifecycleStage ?? "New";
  if (!isCrmLifecycleStage(lifecycleStage)) return { error: "Pick a valid lifecycle stage." };

  if (input.identity !== undefined) {
    if (!input.identity || typeof input.identity !== "object" || Array.isArray(input.identity)) {
      return { error: "Add a valid contact identity." };
    }
    const result = await findOrCreateContactByIdentity({
      ownerId: gate.ownerId,
      name,
      source,
      lifecycleStage,
      identity: input.identity as ContactIdentityInput,
    });
    if ("ok" in result) revalidatePath("/", "layout");
    return result;
  }

  const possibleDuplicates = await prisma.contact.findMany({
    where: { ownerId: gate.ownerId, deletedAt: null, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
    take: 10,
  });
  const contactId = newId();
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.create({
        data: {
          id: contactId,
          ownerId: gate.ownerId,
          name,
          source,
          lifecycleStage,
          firstTouchAt: now,
          lastSeenAt: now,
          marketingConsent: "unknown",
          consentSource: null,
          consentAt: null,
        },
      });
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: gate.ownerId,
          type: "crm.contact.create",
          payload: { contactId, source, channel: null },
        },
      });
    });
  } catch {
    return { error: "Couldn't save that contact — please try again." };
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    contactId,
    created: true,
    possibleDuplicateIds: possibleDuplicates.map((contact) => contact.id),
  };
}

/** The only CRM consent mutation. opt_in requires an explicit assertion that the
 * customer confirmed it; imports and ordinary contact creation never call this path. */
export async function setContactConsent(raw: unknown): Promise<ContactMutationResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const contactId = text(input.contactId, 64);
  const consentSource = text(input.consentSource, 120);
  if (!contactId || !isMarketingConsent(input.marketingConsent) || !consentSource) {
    return { error: "Add the consent status and its source." };
  }
  const marketingConsent = input.marketingConsent;
  if (marketingConsent === "opt_in" && input.customerConfirmed !== true) {
    return { error: "Confirm that the customer explicitly opted in." };
  }
  const consentAt = new Date();

  const result = await prisma.$transaction(async (tx): Promise<ContactMutationResult> => {
    const current = await tx.contact.findFirst({
      where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
      select: { marketingConsent: true, consentSource: true, consentAt: true },
    });
    if (!current) return { error: "Contact not found." };
    const { count } = await tx.contact.updateMany({
      where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
      data: { marketingConsent, consentSource, consentAt },
    });
    if (!count) return { error: "Contact not found." };
    await tx.actionEvent.create({
      data: {
        id: newId(),
        ownerId: gate.ownerId,
        type: "crm.contact.consent",
        payload: {
          contactId,
          from: current.marketingConsent,
          to: marketingConsent,
          consentSource,
        },
      },
    });
    return { ok: true };
  }).catch(() => ({ error: "Couldn't update consent — please try again." }) as const);
  if ("ok" in result) revalidatePath("/", "layout");
  return result;
}

/** Bounded manual profile edits. Order truth and consent are intentionally absent:
 * totalOrdersMyr is read-only, and consent has the dedicated audited action above. */
export async function updateContact(raw: unknown): Promise<ContactMutationResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as { contactId?: unknown; patch?: unknown };
  const contactId = text(input.contactId, 64);
  if (!contactId || !input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) {
    return { error: "Invalid request." };
  }
  const patch = input.patch as Record<string, unknown>;
  if ("totalOrdersMyr" in patch) return { error: "That field is read-only." };
  const allowed = new Set(["name", "lifecycleStage", "doNotDisturb"]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) return { error: "That field can't be edited here." };
  if (!Object.keys(patch).length) return { error: "Nothing to update." };

  const requested: { name?: string; lifecycleStage?: CrmLifecycleStage; doNotDisturb?: boolean } = {};
  if ("name" in patch) {
    const name = text(patch.name, 200);
    if (!name) return { error: "A contact needs a name." };
    requested.name = name;
  }
  if ("lifecycleStage" in patch) {
    if (!isCrmLifecycleStage(patch.lifecycleStage)) return { error: "Pick a valid lifecycle stage." };
    requested.lifecycleStage = patch.lifecycleStage;
  }
  if ("doNotDisturb" in patch) {
    if (typeof patch.doNotDisturb !== "boolean") return { error: "Pick a valid do-not-disturb setting." };
    requested.doNotDisturb = patch.doNotDisturb;
  }

  const result = await prisma.$transaction(async (tx): Promise<ContactMutationResult> => {
    const current = await tx.contact.findFirst({
      where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
      select: { name: true, lifecycleStage: true, doNotDisturb: true },
    });
    if (!current) return { error: "Contact not found." };

    const data: Record<string, string | boolean> = {};
    const changes: Record<string, { from: string | boolean; to: string | boolean }> = {};
    for (const key of ["name", "lifecycleStage", "doNotDisturb"] as const) {
      const next = requested[key];
      if (next !== undefined && next !== current[key]) {
        data[key] = next;
        changes[key] = { from: current[key], to: next };
      }
    }
    if (!Object.keys(data).length) return { ok: true };

    const { count } = await tx.contact.updateMany({
      where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
      data,
    });
    if (!count) return { error: "Contact not found." };
    await tx.actionEvent.create({
      data: {
        id: newId(),
        ownerId: gate.ownerId,
        type: "crm.contact.update",
        payload: { contactId, changes },
      },
    });
    return { ok: true };
  }).catch(() => ({ error: "Couldn't update that contact — please try again." }) as const);
  if ("ok" in result) revalidatePath("/", "layout");
  return result;
}

/** Manual-confirmation-only merge. Identities move to the target, the duplicate is
 * soft-deleted, and the earlier first-touch pair wins. Order totals are never written. */
export async function mergeContacts(raw: unknown): Promise<ContactMutationResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const sourceContactId = text(input.sourceContactId, 64);
  const targetContactId = text(input.targetContactId, 64);
  if (!sourceContactId || !targetContactId || sourceContactId === targetContactId) {
    return { error: "Pick two different contacts." };
  }
  if (input.confirmed !== true) return { error: "Confirm this merge before continuing." };

  const result = await prisma.$transaction(async (tx): Promise<ContactMutationResult> => {
    const select = { id: true, firstTouchAt: true, firstTouchCampaignId: true } as const;
    const source = await tx.contact.findFirst({
      where: { id: sourceContactId, ownerId: gate.ownerId, deletedAt: null },
      select,
    });
    const target = await tx.contact.findFirst({
      where: { id: targetContactId, ownerId: gate.ownerId, deletedAt: null },
      select,
    });
    if (!source || !target) return { error: "Contact not found." };

    const sourceIsEarlier = source.firstTouchAt.getTime() < target.firstTouchAt.getTime();
    // firstTouchCampaignId is a soft FK. Re-assert its tenant before propagating it;
    // a corrupt/legacy cross-tenant pointer must fail closed, not cross the iron curtain.
    if (sourceIsEarlier && source.firstTouchCampaignId) {
      const campaign = await tx.campaign.findFirst({
        where: { id: source.firstTouchCampaignId, ownerId: gate.ownerId },
        select: { id: true },
      });
      if (!campaign) return { error: "Contact attribution is invalid." };
    }
    const moved = await tx.contactIdentity.updateMany({
      where: { ownerId: gate.ownerId, contactId: sourceContactId, deletedAt: null },
      data: { contactId: targetContactId },
    });
    if (sourceIsEarlier) {
      const inherited = await tx.contact.updateMany({
        where: { id: targetContactId, ownerId: gate.ownerId, deletedAt: null },
        data: {
          firstTouchAt: source.firstTouchAt,
          firstTouchCampaignId: source.firstTouchCampaignId,
        },
      });
      if (!inherited.count) throw new MergeRollbackError("Contact not found.");
    }
    const archived = await tx.contact.updateMany({
      where: { id: sourceContactId, ownerId: gate.ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!archived.count) throw new MergeRollbackError("Contact not found.");
    await tx.actionEvent.create({
      data: {
        id: newId(),
        ownerId: gate.ownerId,
        type: "crm.contact.merge",
        payload: {
          sourceContactId,
          targetContactId,
          movedIdentityCount: moved.count,
          attributionInheritedFrom: sourceIsEarlier ? sourceContactId : targetContactId,
        },
      },
    });
    return { ok: true };
  }).catch((error): ContactMutationResult =>
    error instanceof MergeRollbackError
      ? { error: error.userMessage }
      : { error: "Couldn't merge those contacts — please try again." },
  );
  if ("ok" in result) revalidatePath("/", "layout");
  return result;
}
