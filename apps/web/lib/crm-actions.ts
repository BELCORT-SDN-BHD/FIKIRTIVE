"use server";

import { revalidatePath } from "next/cache";
import { prisma, recordConsentEvent, recordContactDndEvent } from "@fikirtive/db";
import { newId, MERCHANT_UNVERIFIED_IDENTITY, CHANNEL_VERIFIED_IDENTITY } from "@fikirtive/core";
import { isImpersonating } from "@/lib/better-auth/compat";
import { requireOwner } from "@/lib/auth-guard";
import {
  findContactDuplicateSuggestions,
  isCrmLifecycleStage,
  normalizeContactIdentity,
  type ContactDuplicateSuggestion,
  type CrmLifecycleStage,
  type NormalizedContactIdentity,
} from "./crm-identity";

const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";
const MAX_CSV_BYTES = 256_000;
const MAX_IMPORT_ROWS = 200;

export type CreateContactInput = {
  name: string;
  source?: string;
  lifecycleStage?: CrmLifecycleStage;
};

export type ContactMutationResult = { ok: true } | { error: string };
/** #803 — a stored merchant-entered number, returned with the id the edit/remove controls need. */
export type ContactPhoneResult =
  | { ok: true; identityId: string; phone: string }
  | { error: string };
export type CreateContactResult =
  | {
      ok: true;
      contactId: string;
      created: true;
      possibleDuplicates: ContactDuplicateSuggestion[];
    }
  | { error: string };

export type ImportContactRowResult = {
  rowNumber: number;
  name: string;
  status: "imported" | "imported_with_warning" | "failed";
  contactId: string | null;
  possibleDuplicates: ContactDuplicateSuggestion[];
  consentAssertion: "grant" | "revoke" | null;
  consentError?: string;
  warnings: string[];
};

export type ImportContactsResult =
  | {
      ok: true;
      importedCount: number;
      failedCount: number;
      rows: ImportContactRowResult[];
    }
  | { error: string };

type ParsedImportRow = {
  rowNumber: number;
  name: string;
  lifecycleStage: CrmLifecycleStage;
  identities: NormalizedContactIdentity[];
  identityFields: string[];
  consentAction: "grant" | "revoke" | null;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function opaqueRequestId(value: unknown): string | null {
  const id = text(value, 128);
  return id && !/\s|[\u0000-\u001f\u007f]/.test(id) ? id : null;
}

function engineCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function consentEngineMessage(error: unknown): string {
  switch (engineCode(error)) {
    case "IDEMPOTENCY_CONFLICT":
      return "This request was already used for a different consent record. Start a new attempt.";
    case "INVALID_WRITER_COMBINATION":
      return "This consent record does not match the approved evidence rules.";
    case "INVALID_ARGUMENT":
      return "The consent record contains invalid evidence details.";
    case "TENANT_RESOURCE_NOT_FOUND":
      return "Contact not found.";
    case "REPLAY_INTEGRITY":
      return "Consent history could not be safely updated. Please retry.";
    default:
      return "Couldn't record consent — please try again.";
  }
}

function dndEngineMessage(error: unknown): string {
  switch (engineCode(error)) {
    case "IDEMPOTENCY_CONFLICT":
      return "This request was already used for a different do-not-disturb change. Start a new attempt.";
    case "INVALID_WRITER_COMBINATION":
      return "This do-not-disturb change does not match the approved action rules.";
    case "INVALID_ARGUMENT":
      return "The do-not-disturb change contains invalid details.";
    case "TENANT_RESOURCE_NOT_FOUND":
      return "Contact not found.";
    case "REPLAY_INTEGRITY":
      return "Do-not-disturb history could not be safely updated. Please retry.";
    default:
      return "Couldn't update do not disturb — please try again.";
  }
}

function refreshContactPaths(contactId?: string): void {
  revalidatePath("/crm/contacts");
  if (contactId) revalidatePath(`/crm/contacts/${contactId}`);
}

type CreatedContactRecord =
  | {
      ok: true;
      contactId: string;
      created: true;
      possibleDuplicates: ContactDuplicateSuggestion[];
      /** Identities stored for this row, all at the merchant-entered grade (#803). */
      storedIdentities: string[];
      /** Identities the tenant already holds on another contact, skipped rather than moved. */
      skippedIdentities: string[];
    }
  | { error: string };

async function createContactRecord(input: {
  ownerId: string;
  name: string;
  source: string;
  lifecycleStage: CrmLifecycleStage;
  identities?: NormalizedContactIdentity[];
}): Promise<CreatedContactRecord> {
  const possibleDuplicates = await findContactDuplicateSuggestions({
    ownerId: input.ownerId,
    name: input.name,
    identities: input.identities,
  });
  const contactId = newId();
  const now = new Date();
  const requested = input.identities ?? [];
  const storedIdentities: string[] = [];
  const skippedIdentities: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.create({
        data: {
          id: contactId,
          ownerId: input.ownerId,
          name: input.name,
          source: input.source,
          lifecycleStage: input.lifecycleStage,
          firstTouchAt: now,
          lastSeenAt: now,
        },
      });
      // #803 — an imported phone or email is the merchant's own record, so it is stored as
      // exactly that: merchant entered, unverified, and not audience material. A number this
      // tenant already holds elsewhere is left where it is; an import may not silently move a
      // customer's identity from one contact to another.
      for (const identity of requested) {
        const clash = await tx.contactIdentity.findFirst({
          where: {
            ownerId: input.ownerId,
            channel: identity.channel,
            externalId: identity.externalId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (clash) {
          skippedIdentities.push(identity.externalId);
          continue;
        }
        await tx.contactIdentity.create({
          data: {
            id: newId(),
            ownerId: input.ownerId,
            contactId,
            channel: identity.channel,
            externalId: identity.externalId,
            handle: identity.handle,
            label: identity.label,
            verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
            verifiedAt: null,
            verifiedSourceKind: null,
          },
        });
        storedIdentities.push(identity.externalId);
      }
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: input.ownerId,
          type: "crm.contact.create",
          payload: {
            contactId,
            source: input.source,
            identityWrite: storedIdentities.length > 0,
            verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
            storedIdentityCount: storedIdentities.length,
          },
        },
      });
    });
  } catch {
    return { error: "Couldn't save that contact — please try again." };
  }
  return { ok: true, contactId, created: true, possibleDuplicates, storedIdentities, skippedIdentities };
}

/** Creates a Contact only. Identity signals are deliberately not accepted by this write path. */
export async function createContact(raw: unknown): Promise<CreateContactResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  if ("identity" in input || "identities" in input) {
    return { error: "Identity editing is not available. Add the contact without attaching an identity." };
  }
  const name = text(input.name, 200);
  if (!name) return { error: "A contact needs a name." };
  const source = text(input.source, 120) ?? "manual";
  const lifecycleStage = input.lifecycleStage ?? "New";
  if (!isCrmLifecycleStage(lifecycleStage)) return { error: "Pick a valid lifecycle stage." };

  const result = await createContactRecord({
    ownerId: gate.ownerId,
    name,
    source,
    lifecycleStage,
  });
  if (!("ok" in result)) return result;
  refreshContactPaths(result.contactId);
  // This path never attaches an identity, so the import-only bookkeeping stays out of its shape.
  return {
    ok: true,
    contactId: result.contactId,
    created: true,
    possibleDuplicates: result.possibleDuplicates,
  };
}

/** Records a merchant assertion in ConsentEvent; it does not create verified customer consent. */
export async function setContactConsent(raw: unknown): Promise<ContactMutationResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const contactId = text(input.contactId, 64);
  const requestId = opaqueRequestId(input.requestId);
  const action = input.action;
  if (!contactId || !requestId || (action !== "grant" && action !== "revoke")) {
    return { error: "Add the contact, consent assertion, and request id." };
  }
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!contact) return { error: "Contact not found." };

  try {
    await recordConsentEvent({
      ownerId: gate.ownerId,
      contactId,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "crm_manual",
      action,
      idempotencyKey: `crm-manual:${contactId}:${requestId}`,
    });
    refreshContactPaths(contactId);
    return { ok: true };
  } catch (error) {
    return { error: consentEngineMessage(error) };
  }
}

/** Bounded profile edits. Order truth, identity, consent, and DND each stay outside this patch. */
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
  if ("doNotDisturb" in patch) return { error: "Use the do-not-disturb control for that setting." };
  const allowed = new Set(["name", "lifecycleStage"]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) {
    return { error: "That field can't be edited here." };
  }
  if (!Object.keys(patch).length) return { error: "Nothing to update." };

  const requested: { name?: string; lifecycleStage?: CrmLifecycleStage } = {};
  if ("name" in patch) {
    const name = text(patch.name, 200);
    if (!name) return { error: "A contact needs a name." };
    requested.name = name;
  }
  if ("lifecycleStage" in patch) {
    if (!isCrmLifecycleStage(patch.lifecycleStage)) return { error: "Pick a valid lifecycle stage." };
    requested.lifecycleStage = patch.lifecycleStage;
  }

  const result = await prisma.$transaction(async (tx): Promise<ContactMutationResult> => {
    const current = await tx.contact.findFirst({
      where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
      select: { name: true, lifecycleStage: true },
    });
    if (!current) return { error: "Contact not found." };

    const data: { name?: string; lifecycleStage?: CrmLifecycleStage } = {};
    const changes: Record<string, { from: string; to: string }> = {};
    if (requested.name !== undefined && requested.name !== current.name) {
      data.name = requested.name;
      changes.name = { from: current.name, to: requested.name };
    }
    if (
      requested.lifecycleStage !== undefined
      && requested.lifecycleStage !== current.lifecycleStage
    ) {
      data.lifecycleStage = requested.lifecycleStage;
      changes.lifecycleStage = { from: current.lifecycleStage, to: requested.lifecycleStage };
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
  if ("ok" in result) refreshContactPaths(contactId);
  return result;
}

async function writeDnd(
  raw: unknown,
  sourceKind: "crm_ui" | "otto_approved_action",
): Promise<ContactMutationResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const contactId = text(input.contactId, 64);
  const requestId = opaqueRequestId(input.requestId);
  if (!contactId || !requestId || typeof input.enabled !== "boolean") {
    return { error: "Add the contact, do-not-disturb setting, and request id." };
  }
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!contact) return { error: "Contact not found." };

  try {
    await recordContactDndEvent({
      ownerId: gate.ownerId,
      contactId,
      sourceKind,
      action: input.enabled ? "set" : "clear",
      idempotencyKey: `crm-dnd:${contactId}:${requestId}`,
    });
    refreshContactPaths(contactId);
    return { ok: true };
  } catch (error) {
    return { error: dndEngineMessage(error) };
  }
}

/** Human CRM toggle: the runtime derives merchant × crm_ui provenance. */
export async function setContactDnd(raw: unknown): Promise<ContactMutationResult> {
  return writeDnd(raw, "crm_ui");
}

/** Otto parity wrapper: the runtime derives otto × otto_approved_action provenance. */
export async function setContactDndFromOtto(raw: unknown): Promise<ContactMutationResult> {
  return writeDnd(raw, "otto_approved_action");
}

/* ── #803 merchant-entered phone numbers ──────────────────────────────────────────────────
 *
 * Founder ruling (2026-08-08): a merchant may store his customers' numbers himself, marked as
 * what they are — merchant entered, not verified. Three things follow, and all three are here
 * rather than in the two surfaces, because the human page and Otto must not be able to disagree:
 *
 *  1. The grade is written by the writer, never taken from the caller. There is no input by
 *     which a form, an Otto turn, or a replayed request can store a number as verified.
 *  2. Editing and removing are confined to what the merchant typed. A number a channel has
 *     confirmed is evidence, not a text field, so this path refuses it instead of silently
 *     downgrading it.
 *  3. Consent is untouched. Storing a number is not permission to message it — the consent
 *     ledger stays the one authority (#716/#726/#750), and an unverified number is not audience
 *     material at all (see contactChannelFacts and the broadcast's send targets).
 */

type PhoneEntrySurface = "crm_ui" | "otto_approved_action";

const PHONE_ALREADY_SAVED = "That number is already saved on another contact.";
const PHONE_VERIFIED_LOCKED =
  "This number was confirmed by a connected channel, so it can't be edited or removed here.";
const PHONE_NOT_FOUND = "That number is no longer saved on this contact.";

/** Normalizes to E.164 under the Malaysia default both entry surfaces state in their copy. */
function phoneEntry(value: unknown): { phone: string } | { error: string } {
  if (typeof value !== "string" || !value.trim()) return { error: "Add a phone number." };
  const normalized = normalizeContactIdentity(
    { channel: "whatsapp", externalId: value },
    { assumeMalaysianPhone: true },
  );
  return "error" in normalized ? normalized : { phone: normalized.externalId };
}

async function phoneGate(
  raw: unknown,
): Promise<{ ownerId: string; contactId: string; input: Record<string, unknown> } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const contactId = text(input.contactId, 64);
  if (!contactId) return { error: "Invalid request." };
  // The tenant fence is on the read, and again on every write below.
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!contact) return { error: "Contact not found." };
  return { ownerId: gate.ownerId, contactId, input };
}

async function writeAddPhone(raw: unknown, surface: PhoneEntrySurface): Promise<ContactPhoneResult> {
  const gate = await phoneGate(raw);
  if ("error" in gate) return gate;
  const entry = phoneEntry(gate.input.phone);
  if ("error" in entry) return entry;

  const identityId = newId();
  try {
    return await prisma.$transaction(async (tx): Promise<ContactPhoneResult> => {
      const existing = await tx.contactIdentity.findFirst({
        where: {
          ownerId: gate.ownerId,
          channel: "whatsapp",
          externalId: entry.phone,
          deletedAt: null,
        },
        select: { id: true, contactId: true },
      });
      // A retry after a lost response must not read as a failure: the same number on the same
      // contact is already the requested state.
      if (existing) {
        return existing.contactId === gate.contactId
          ? { ok: true, identityId: existing.id, phone: entry.phone }
          : { error: PHONE_ALREADY_SAVED };
      }
      await tx.contactIdentity.create({
        data: {
          id: identityId,
          ownerId: gate.ownerId,
          contactId: gate.contactId,
          channel: "whatsapp",
          externalId: entry.phone,
          // The grade and its (absent) evidence are stated, never defaulted into.
          verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
          verifiedAt: null,
          verifiedSourceKind: null,
        },
      });
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: gate.ownerId,
          type: "crm.contact.identity.add",
          payload: {
            contactId: gate.contactId,
            identityId,
            channel: "whatsapp",
            verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
            entrySurface: surface,
          },
        },
      });
      return { ok: true, identityId, phone: entry.phone };
    });
  } catch {
    // The live partial unique index is the last word if two attempts race each other.
    return { error: PHONE_ALREADY_SAVED };
  } finally {
    refreshContactPaths(gate.contactId);
  }
}

async function writeUpdatePhone(raw: unknown, surface: PhoneEntrySurface): Promise<ContactPhoneResult> {
  const gate = await phoneGate(raw);
  if ("error" in gate) return gate;
  const identityId = text(gate.input.identityId, 64);
  if (!identityId) return { error: "Invalid request." };
  const entry = phoneEntry(gate.input.phone);
  if ("error" in entry) return entry;

  try {
    return await prisma.$transaction(async (tx): Promise<ContactPhoneResult> => {
      const current = await tx.contactIdentity.findFirst({
        where: {
          id: identityId,
          ownerId: gate.ownerId,
          contactId: gate.contactId,
          channel: "whatsapp",
          deletedAt: null,
        },
        select: { id: true, externalId: true, verificationStatus: true },
      });
      if (!current) return { error: PHONE_NOT_FOUND };
      if (current.verificationStatus === CHANNEL_VERIFIED_IDENTITY) {
        return { error: PHONE_VERIFIED_LOCKED };
      }
      if (current.externalId === entry.phone) {
        return { ok: true, identityId: current.id, phone: entry.phone };
      }
      const clash = await tx.contactIdentity.findFirst({
        where: {
          ownerId: gate.ownerId,
          channel: "whatsapp",
          externalId: entry.phone,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (clash) return { error: PHONE_ALREADY_SAVED };

      // Compare-and-set on the grade: a channel confirmation landing between the read and the
      // write must win, not be overwritten by an edit that was decided before it existed.
      const { count } = await tx.contactIdentity.updateMany({
        where: {
          id: identityId,
          ownerId: gate.ownerId,
          contactId: gate.contactId,
          deletedAt: null,
          verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
        },
        data: { externalId: entry.phone },
      });
      if (!count) return { error: PHONE_VERIFIED_LOCKED };
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: gate.ownerId,
          type: "crm.contact.identity.update",
          payload: {
            contactId: gate.contactId,
            identityId,
            channel: "whatsapp",
            from: current.externalId,
            to: entry.phone,
            entrySurface: surface,
          },
        },
      });
      return { ok: true, identityId, phone: entry.phone };
    });
  } catch {
    return { error: "Couldn't update that number — please try again." };
  } finally {
    refreshContactPaths(gate.contactId);
  }
}

async function writeRemovePhone(raw: unknown, surface: PhoneEntrySurface): Promise<ContactMutationResult> {
  const gate = await phoneGate(raw);
  if ("error" in gate) return gate;
  const identityId = text(gate.input.identityId, 64);
  if (!identityId) return { error: "Invalid request." };

  try {
    return await prisma.$transaction(async (tx): Promise<ContactMutationResult> => {
      const current = await tx.contactIdentity.findFirst({
        where: {
          id: identityId,
          ownerId: gate.ownerId,
          contactId: gate.contactId,
          channel: "whatsapp",
          deletedAt: null,
        },
        select: { id: true, externalId: true, verificationStatus: true },
      });
      if (!current) return { error: PHONE_NOT_FOUND };
      if (current.verificationStatus === CHANNEL_VERIFIED_IDENTITY) {
        return { error: PHONE_VERIFIED_LOCKED };
      }
      // Soft delete: the row stays readable as history, and the live partial unique index frees
      // the number so the merchant can save it on the contact it actually belongs to.
      const { count } = await tx.contactIdentity.updateMany({
        where: {
          id: identityId,
          ownerId: gate.ownerId,
          contactId: gate.contactId,
          deletedAt: null,
          verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
        },
        data: { deletedAt: new Date() },
      });
      if (!count) return { error: PHONE_VERIFIED_LOCKED };
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: gate.ownerId,
          type: "crm.contact.identity.remove",
          payload: {
            contactId: gate.contactId,
            identityId,
            channel: "whatsapp",
            removed: current.externalId,
            entrySurface: surface,
          },
        },
      });
      return { ok: true };
    });
  } catch {
    return { error: "Couldn't remove that number — please try again." };
  } finally {
    refreshContactPaths(gate.contactId);
  }
}

/** Human CRM entry. Stores the number as merchant entered, never as verified. */
export async function addContactPhone(raw: unknown): Promise<ContactPhoneResult> {
  return writeAddPhone(raw, "crm_ui");
}

/** Otto parity: the same writer, the same grade, a different recorded entry surface. */
export async function addContactPhoneFromOtto(raw: unknown): Promise<ContactPhoneResult> {
  return writeAddPhone(raw, "otto_approved_action");
}

/** Corrects a typo in a merchant-entered number. Channel-confirmed numbers are refused. */
export async function updateContactPhone(raw: unknown): Promise<ContactPhoneResult> {
  return writeUpdatePhone(raw, "crm_ui");
}

/** Otto parity for the correction path. */
export async function updateContactPhoneFromOtto(raw: unknown): Promise<ContactPhoneResult> {
  return writeUpdatePhone(raw, "otto_approved_action");
}

/** Soft-removes a merchant-entered number. Channel-confirmed numbers are refused. */
export async function removeContactPhone(raw: unknown): Promise<ContactMutationResult> {
  return writeRemovePhone(raw, "crm_ui");
}

/** Otto parity for the removal path. */
export async function removeContactPhoneFromOtto(raw: unknown): Promise<ContactMutationResult> {
  return writeRemovePhone(raw, "otto_approved_action");
}

function parseCsv(csv: string): string[][] | { error: string } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field.length > 0) return { error: "The CSV contains an invalid quote." };
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) return { error: "The CSV contains an unclosed quote." };
  row.push(field);
  rows.push(row);
  return rows.filter((candidate) => candidate.some((value) => value.trim().length > 0));
}

function importLifecycle(value: string): CrmLifecycleStage | null {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!normalized) return "New";
  if (normalized === "new") return "New";
  if (normalized === "active") return "Active";
  if (normalized === "dormant") return "Dormant";
  return null;
}

function importConsent(value: string): "grant" | "revoke" | null | "invalid" {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!normalized || normalized === "unknown") return null;
  if (normalized === "opt_in") return "grant";
  if (normalized === "opt_out") return "revoke";
  return "invalid";
}

function parsedImportRows(csv: string): ParsedImportRow[] | { error: string } {
  const parsed = parseCsv(csv);
  if ("error" in parsed) return parsed;
  const header = parsed[0]?.map((value) => value.replace(/^\uFEFF/, "").trim().toLocaleLowerCase("en-US"));
  if (!header?.length) return { error: "Add a CSV header row." };
  if (!header.includes("name")) return { error: "The CSV needs a name column." };
  const allowed = new Set(["name", "lifecycle_stage", "consent", "phone", "whatsapp", "email"]);
  const unsupported = header.filter((value) => !allowed.has(value));
  if (unsupported.some((value) => value === "tags" || value.includes("custom"))) {
    return { error: "Tags and custom fields are not available in this contacts slice." };
  }
  if (unsupported.length) return { error: `Unsupported CSV column: ${unsupported[0]}.` };
  if (new Set(header).size !== header.length) return { error: "The CSV contains a duplicate column." };

  const valueAt = (values: string[], name: string) => {
    const index = header.indexOf(name);
    return index === -1 ? "" : values[index] ?? "";
  };
  const dataRows = parsed.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { error: `Import up to ${MAX_IMPORT_ROWS} contacts at a time.` };
  }

  const result: ParsedImportRow[] = [];
  for (let index = 0; index < dataRows.length; index += 1) {
    const values = dataRows[index] ?? [];
    const rowNumber = index + 2;
    const name = text(valueAt(values, "name"), 200);
    if (!name) return { error: `Row ${rowNumber} needs a name.` };
    const lifecycleStage = importLifecycle(valueAt(values, "lifecycle_stage"));
    if (!lifecycleStage) return { error: `Row ${rowNumber} has an invalid lifecycle stage.` };
    const consentAction = importConsent(valueAt(values, "consent"));
    if (consentAction === "invalid") {
      return { error: `Row ${rowNumber} consent must be opt_in, opt_out, unknown, or blank.` };
    }

    const identityInputs = [
      { field: "whatsapp", channel: "whatsapp", value: valueAt(values, "whatsapp") },
      { field: "phone", channel: "whatsapp", value: valueAt(values, "phone") },
      { field: "email", channel: "email", value: valueAt(values, "email") },
    ].filter((identity) => identity.value.trim().length > 0);
    const identities: NormalizedContactIdentity[] = [];
    for (const identityInput of identityInputs) {
      const normalized = normalizeContactIdentity(
        { channel: identityInput.channel, externalId: identityInput.value },
        // Same Malaysia default as the contact page's own phone field, stated in the same
        // words on the import card. One rule for everything the merchant types.
        { assumeMalaysianPhone: true },
      );
      if ("error" in normalized) return { error: `Row ${rowNumber}: ${normalized.error}` };
      if (!identities.some((identity) =>
        identity.channel === normalized.channel && identity.externalId === normalized.externalId
      )) {
        identities.push(normalized);
      }
    }
    result.push({
      rowNumber,
      name,
      lifecycleStage,
      identities,
      identityFields: identityInputs.map((identity) => identity.field),
      consentAction,
    });
  }
  if (!result.length) return { error: "The CSV has no contact rows." };
  return result;
}

/** CSV import creates Contact rows only; identity fields remain read-only suggestion signals. */
export async function importContacts(raw: unknown): Promise<ImportContactsResult> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const input = (raw ?? {}) as Record<string, unknown>;
  const csv = typeof input.csv === "string" ? input.csv : "";
  const importId = opaqueRequestId(input.importId);
  if (!csv || !importId) return { error: "Choose a CSV file and start a new import." };
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    return { error: "The CSV is too large. Import a file smaller than 256 KB." };
  }
  const rows = parsedImportRows(csv);
  if ("error" in rows) return rows;

  const results: ImportContactRowResult[] = [];
  for (const row of rows) {
    const created = await createContactRecord({
      ownerId: gate.ownerId,
      name: row.name,
      source: "import",
      lifecycleStage: row.lifecycleStage,
      identities: row.identities,
    });
    if (!("ok" in created)) {
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        status: "failed",
        contactId: null,
        possibleDuplicates: [],
        consentAssertion: null,
        warnings: [created.error],
      });
      continue;
    }

    // A stored number is not a warning — the import card says once, for the whole file, that
    // everything imported is merchant entered and unverified. Only what did NOT happen is a
    // per-row surprise worth naming.
    const warnings = created.skippedIdentities.map(
      (skipped) => `${skipped} is already saved on another contact, so it was not added here.`,
    );
    let consentError: string | undefined;
    if (row.consentAction) {
      try {
        await recordConsentEvent({
          ownerId: gate.ownerId,
          contactId: created.contactId,
          channel: "whatsapp",
          purpose: "marketing",
          sourceKind: "import",
          action: row.consentAction,
          evidenceRef: `csv:${importId}:${row.rowNumber}`,
          idempotencyKey: `crm-import:${importId}:${row.rowNumber}`,
        });
      } catch (error) {
        consentError = consentEngineMessage(error);
        warnings.push(consentError);
      }
    }
    results.push({
      rowNumber: row.rowNumber,
      name: row.name,
      status: warnings.length ? "imported_with_warning" : "imported",
      contactId: created.contactId,
      possibleDuplicates: created.possibleDuplicates,
      consentAssertion: consentError ? null : row.consentAction,
      ...(consentError ? { consentError } : {}),
      warnings,
    });
  }

  const importedCount = results.filter((row) => row.contactId !== null).length;
  if (importedCount) refreshContactPaths();
  return {
    ok: true,
    importedCount,
    failedCount: results.length - importedCount,
    rows: results,
  };
}
