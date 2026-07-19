/**
 * Closed transactional writers and rebuildable projections for the R-010 consent carriers.
 * ownerId is a trusted server contract input; browser/client payloads must never supply it.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import {
  CONSENT_PURPOSES,
  CONSENT_WRITER_RULES,
  PROACTIVE_NON_TRANSACTIONAL_PURPOSES,
  ConsentRuntimeError,
  contactConsentCompatibility,
  foldConsentEvents,
  foldDndEvents,
  foldProviderRefusalEvents,
  validateConsentWriterCombination,
  validateDndWriterCombination,
  validateProviderRefusalWriterCombination,
  type ConsentAction,
  type ConsentActorKind,
  type ConsentEntryMode,
  type ConsentEvidenceStatus,
  type ConsentFoldResult,
  type ConsentPurpose,
  type ConsentSourceKind,
  type DndAction,
  type DndActorKind,
  type DndFoldResult,
  type DndSourceKind,
  type OrderedConsentEvent,
  type OrderedDndEvent,
  type OrderedProviderRefusalEvent,
  type ProviderRefusalAction,
  type ProviderRefusalActorKind,
  type ProviderRefusalFoldResult,
  type ProviderRefusalKind,
} from "./consent-fold.js";
import { prisma } from "./index.js";

type Tx = Prisma.TransactionClient;

export type ConsentEventWriteResult = {
  duplicate: boolean;
  eventIds: string[];
  receivedAt: string[];
};

type DirectConsentSource = Exclude<
  ConsentSourceKind,
  "stop_keyword" | "historical_verified_stop" | "stop_purpose_expansion"
>;

export type RecordConsentEventInput = {
  ownerId: string;
  contactId: string;
  channel: string;
  purpose: ConsentPurpose;
  sourceKind: DirectConsentSource;
  action: ConsentAction;
  evidenceRef?: string | null;
  occurredAt?: Date | null;
  idempotencyKey: string;
};

export type RecordUnqualifiedStopInput = {
  ownerId: string;
  contactId: string;
  channel: string;
  sourceKind: "stop_keyword" | "historical_verified_stop";
  channelEventRef: string;
  opaqueMessageId: string;
  occurredAt?: Date | null;
};

export type RecordStopPurposeExpansionInput = {
  ownerId: string;
  contactId: string;
  channel: string;
  purpose: (typeof PROACTIVE_NON_TRANSACTIONAL_PURPOSES)[number];
  originalStopOperationId: string;
  evidenceRef: string;
};

export type RecordDndEventInput = {
  ownerId: string;
  contactId: string;
  sourceKind: DndSourceKind;
  action: DndAction;
  actorId?: string | null;
  evidenceRef?: string | null;
  idempotencyKey: string;
};

type ProviderBaseInput = {
  ownerId: string;
  providerConnectionId: string;
  providerCode: string;
  receiptRef: string;
  actorId?: string | null;
  idempotencyKey: string;
};

export type RecordProviderRefusalEventInput =
  | (ProviderBaseInput & {
      kind: "permanent_recipient";
      action: "block" | "clear";
      channel: string;
      contactIdentityId: string;
      reversesEventId?: string | null;
    })
  | (ProviderBaseInput & {
      kind: "account_level";
      action: "block" | "clear";
      expiresAt?: Date | null;
      reversesEventId?: string | null;
    })
  | (ProviderBaseInput & {
      kind: "transient";
      action: "observe";
      channel?: string | null;
      contactIdentityId?: string | null;
    });

export type ExpireProviderRefusalInput = {
  ownerId: string;
  blockEventId: string;
  actorId?: string | null;
};

export type RebuildConsentRuntimeResult = {
  consentProjectionCount: number;
  dndContactCount: number;
  providerProjectionCount: number;
};

type ConsentDraft = {
  ownerId: string;
  contactId: string;
  channel: string;
  purpose: ConsentPurpose;
  action: ConsentAction;
  actorKind: ConsentActorKind;
  entryMode: ConsentEntryMode;
  sourceKind: ConsentSourceKind;
  evidenceStatus: ConsentEvidenceStatus;
  evidenceRef: string | null;
  operationId: string;
  idempotencyKey: string;
  occurredAt: Date | null;
};

type ConsentFoldRow = OrderedConsentEvent & {
  ownerId: string;
  contactId: string;
  channel: string;
  purpose: ConsentPurpose;
};

type DndFoldRow = OrderedDndEvent & {
  ownerId: string;
  contactId: string;
};

type ProviderFoldRow = OrderedProviderRefusalEvent & {
  ownerId: string;
  scopeKey: string;
};

type ProviderDraft = {
  ownerId: string;
  scopeKey: string;
  providerConnectionId: string;
  channel: string | null;
  contactIdentityId: string | null;
  kind: ProviderRefusalKind;
  action: ProviderRefusalAction;
  actorKind: ProviderRefusalActorKind;
  actorId: string | null;
  providerCode: string;
  receiptRef: string;
  reversesEventId: string | null;
  idempotencyKey: string;
  expiresAt: Date | null;
};

const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_OPAQUE_LENGTH = 512;

function requireText(value: string, field: string): string {
  if (!value || value.length > MAX_OPAQUE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConsentRuntimeError("INVALID_ARGUMENT", `${field} must be a compact non-empty value.`);
  }
  return value;
}

function requireOpaque(value: string, field: string): string {
  requireText(value, field);
  if (/\s/.test(value)) {
    throw new ConsentRuntimeError(
      "INVALID_ARGUMENT",
      `${field} must be an opaque reference/key, not copied raw content.`,
    );
  }
  return value;
}

function requireToken(value: string, field: string): string {
  if (!TOKEN.test(value)) {
    throw new ConsentRuntimeError("INVALID_ARGUMENT", `${field} is outside the closed server taxonomy.`);
  }
  return value;
}

function optionalOpaque(value: string | null | undefined, field: string): string | null {
  return value == null ? null : requireOpaque(value, field);
}

function optionalDate(value: Date | null | undefined, field: string): Date | null {
  if (value == null) return null;
  if (!Number.isFinite(value.getTime())) {
    throw new ConsentRuntimeError("INVALID_ARGUMENT", `${field} must be a finite timestamp.`);
  }
  return value;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

async function advisoryLock(tx: Tx, key: string): Promise<void> {
  // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function lockOwner(tx: Tx, ownerId: string): Promise<void> {
  requireText(ownerId, "ownerId");
  await advisoryLock(tx, `consent-runtime:owner:${ownerId}`);
}

async function ensureContact(tx: Tx, ownerId: string, contactId: string): Promise<void> {
  requireText(contactId, "contactId");
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Contact"
    WHERE "ownerId" = ${ownerId} AND "id" = ${contactId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new ConsentRuntimeError(
      "TENANT_RESOURCE_NOT_FOUND",
      "The Contact was not found in the authenticated tenant.",
    );
  }
}

async function canonicalReceivedAt(tx: Tx, table: string, id: string): Promise<string> {
  const allowed = new Set(["ConsentEvent", "ContactDndEvent", "ProviderRefusalEvent"]);
  if (!allowed.has(table)) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "Unknown event table.");
  const rows = await tx.$queryRawUnsafe<Array<{ receivedAt: string }>>(
    `SELECT to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt" FROM "${table}" WHERE "id" = $1`,
    id,
  );
  const row = rows[0];
  if (!row) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "The written event could not be read back.");
  return row.receivedAt;
}

function consentRule(sourceKind: ConsentSourceKind, action: ConsentAction): ConsentWriterRuleResult {
  const rule = CONSENT_WRITER_RULES[sourceKind];
  if (!rule) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "The consent source is not in the R-010 closed writer matrix.",
    );
  }
  validateConsentWriterCombination({
    sourceKind,
    action,
    actorKind: rule.actorKind,
    entryMode: rule.entryMode,
    evidenceStatus: rule.evidenceStatus,
  });
  return rule;
}

type ConsentWriterRuleResult = {
  actorKind: ConsentActorKind;
  entryMode: ConsentEntryMode;
  evidenceStatus: ConsentEvidenceStatus;
};

function validateConsentDraft(draft: ConsentDraft): void {
  requireToken(draft.channel, "channel");
  requireToken(draft.purpose, "purpose");
  if (!(CONSENT_PURPOSES as readonly string[]).includes(draft.purpose)) {
    throw new ConsentRuntimeError("INVALID_ARGUMENT", "purpose is outside the Phase-1 closed set.");
  }
  requireOpaque(draft.idempotencyKey, "idempotencyKey");
  requireOpaque(draft.operationId, "operationId");
  validateConsentWriterCombination(draft);
  if (draft.evidenceStatus === "verified" && draft.evidenceRef === null) {
    throw new ConsentRuntimeError(
      "INVALID_ARGUMENT",
      "Verified customer consent events require an opaque evidenceRef.",
    );
  }
}

function sameConsentPayload(existing: {
  ownerId: string;
  contactId: string;
  channel: string;
  purpose: string;
  action: string;
  actorKind: string;
  entryMode: string;
  sourceKind: string;
  evidenceStatus: string;
  evidenceRef: string | null;
  operationId: string;
  idempotencyKey: string;
  occurredAt: Date | null;
}, draft: ConsentDraft): boolean {
  return (
    existing.ownerId === draft.ownerId &&
    existing.contactId === draft.contactId &&
    existing.channel === draft.channel &&
    existing.purpose === draft.purpose &&
    existing.action === draft.action &&
    existing.actorKind === draft.actorKind &&
    existing.entryMode === draft.entryMode &&
    existing.sourceKind === draft.sourceKind &&
    existing.evidenceStatus === draft.evidenceStatus &&
    existing.evidenceRef === draft.evidenceRef &&
    existing.operationId === draft.operationId &&
    existing.idempotencyKey === draft.idempotencyKey &&
    sameDate(existing.occurredAt, draft.occurredAt)
  );
}

async function existingConsentReplay(
  tx: Tx,
  draft: ConsentDraft,
): Promise<{ id: string; receivedAt: string } | null> {
  const existing = await tx.consentEvent.findFirst({
    where: { ownerId: draft.ownerId, idempotencyKey: draft.idempotencyKey },
  });
  if (!existing) return null;
  if (!sameConsentPayload(existing, draft)) {
    throw new ConsentRuntimeError(
      "IDEMPOTENCY_CONFLICT",
      "The consent idempotency key is already bound to a different semantic payload.",
    );
  }
  return { id: existing.id, receivedAt: await canonicalReceivedAt(tx, "ConsentEvent", existing.id) };
}

async function insertConsentEvent(tx: Tx, draft: ConsentDraft): Promise<{ id: string; receivedAt: string }> {
  const id = randomUUID();
  const inserted = await tx.$queryRaw<Array<{ id: string; receivedAt: string }>>`
    INSERT INTO "ConsentEvent" (
      "id", "ownerId", "contactId", "channel", "purpose", "action", "actorKind",
      "entryMode", "sourceKind", "evidenceStatus", "evidenceRef", "operationId",
      "idempotencyKey", "occurredAt", "receivedAt", "createdAt"
    )
    VALUES (
      ${id}, ${draft.ownerId}, ${draft.contactId}, ${draft.channel}, ${draft.purpose},
      ${draft.action}, ${draft.actorKind}, ${draft.entryMode}, ${draft.sourceKind},
      ${draft.evidenceStatus}, ${draft.evidenceRef}, ${draft.operationId},
      ${draft.idempotencyKey}, ${draft.occurredAt},
      GREATEST(
        date_trunc('microseconds', clock_timestamp()),
        COALESCE((
          SELECT MAX("receivedAt") + INTERVAL '1 microsecond'
          FROM "ConsentEvent"
          WHERE "ownerId" = ${draft.ownerId}
            AND "contactId" = ${draft.contactId}
            AND "channel" = ${draft.channel}
            AND "purpose" = ${draft.purpose}
        ), '-infinity'::timestamptz)
      ),
      clock_timestamp()
    )
    RETURNING "id", to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
  `;
  const row = inserted[0];
  if (!row) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "Consent event insertion returned no row.");
  return row;
}

async function readConsentTuple(
  tx: Tx,
  ownerId: string,
  contactId: string,
  channel: string,
  purpose: ConsentPurpose,
): Promise<ConsentFoldRow[]> {
  return tx.$queryRaw<ConsentFoldRow[]>`
    SELECT
      "id", "ownerId", "contactId", "channel", "purpose", "action", "actorKind",
      "entryMode", "sourceKind", "evidenceStatus",
      to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
    FROM "ConsentEvent"
    WHERE "ownerId" = ${ownerId}
      AND "contactId" = ${contactId}
      AND "channel" = ${channel}
      AND "purpose" = ${purpose}
    ORDER BY "receivedAt", "id"
  `;
}

async function writeConsentProjectionFromFold(
  tx: Tx,
  ownerId: string,
  contactId: string,
  channel: string,
  purpose: ConsentPurpose,
  fold: ConsentFoldResult,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "ConsentStateProjection" (
      "ownerId", "contactId", "channel", "purpose", "state", "lastEventId",
      "lastReceivedAt", "stateActorKind", "stateSourceKind", "evidenceStatus", "updatedAt"
    )
    SELECT
      ${ownerId}, ${contactId}, ${channel}, ${purpose}, ${fold.state}, ${fold.lastEventId},
      event."receivedAt", ${fold.stateActorKind}, ${fold.stateSourceKind},
      ${fold.evidenceStatus}, clock_timestamp()
    FROM "ConsentEvent" AS event
    WHERE event."id" = ${fold.lastEventId} AND event."ownerId" = ${ownerId}
    ON CONFLICT ("ownerId", "contactId", "channel", "purpose") DO UPDATE SET
      "state" = EXCLUDED."state",
      "lastEventId" = EXCLUDED."lastEventId",
      "lastReceivedAt" = EXCLUDED."lastReceivedAt",
      "stateActorKind" = EXCLUDED."stateActorKind",
      "stateSourceKind" = EXCLUDED."stateSourceKind",
      "evidenceStatus" = EXCLUDED."evidenceStatus",
      "updatedAt" = EXCLUDED."updatedAt"
  `;

  if (channel !== "whatsapp" || purpose !== "marketing" || fold.stateEventId === null) return;
  const compatibility = contactConsentCompatibility(fold);
  await tx.$executeRaw`
    UPDATE "Contact" AS contact
    SET
      "marketingConsent" = ${compatibility.marketingConsent},
      "consentSource" = ${compatibility.consentSource},
      -- Contact.consentAt is millisecond-precision; truncate (not round) so the stored
      -- value round-trips equal to the microsecond event receivedAt as seen from JS.
      "consentAt" = date_trunc('milliseconds', state_event."receivedAt")
    FROM "ConsentEvent" AS state_event
    WHERE contact."ownerId" = ${ownerId}
      AND contact."id" = ${contactId}
      AND state_event."ownerId" = ${ownerId}
      AND state_event."id" = ${fold.stateEventId}
  `;
}

async function foldAndProjectConsentTuple(tx: Tx, draft: ConsentDraft): Promise<void> {
  const fold = foldConsentEvents(
    await readConsentTuple(tx, draft.ownerId, draft.contactId, draft.channel, draft.purpose),
  );
  if (!fold) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "Consent tuple fold was empty after insert.");
  await writeConsentProjectionFromFold(
    tx,
    draft.ownerId,
    draft.contactId,
    draft.channel,
    draft.purpose,
    fold,
  );
}

async function writeOneConsentEvent(tx: Tx, draft: ConsentDraft): Promise<{ id: string; receivedAt: string }> {
  validateConsentDraft(draft);
  await advisoryLock(tx, `consent:idempotency:${draft.ownerId}:${draft.idempotencyKey}`);
  const replay = await existingConsentReplay(tx, draft);
  if (replay) return replay;
  await advisoryLock(
    tx,
    `consent:tuple:${draft.ownerId}:${draft.contactId}:${draft.channel}:${draft.purpose}`,
  );
  const event = await insertConsentEvent(tx, draft);
  await foldAndProjectConsentTuple(tx, draft);
  return event;
}

export async function recordConsentEvent(
  input: RecordConsentEventInput,
): Promise<ConsentEventWriteResult> {
  const requestedSource = input.sourceKind as string;
  if (["stop_keyword", "historical_verified_stop", "stop_purpose_expansion"].includes(requestedSource)) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "STOP sources may only use the atomic fan-out or purpose-expansion writer.",
    );
  }
  const rule = consentRule(input.sourceKind, input.action);
  const evidenceRef = optionalOpaque(input.evidenceRef, "evidenceRef");
  const draft: ConsentDraft = {
    ownerId: requireText(input.ownerId, "ownerId"),
    contactId: requireText(input.contactId, "contactId"),
    channel: requireToken(input.channel, "channel"),
    purpose: input.purpose,
    action: input.action,
    actorKind: rule.actorKind,
    entryMode: rule.entryMode,
    sourceKind: input.sourceKind,
    evidenceStatus: rule.evidenceStatus,
    evidenceRef,
    operationId: `consent:${requireOpaque(input.idempotencyKey, "idempotencyKey")}`,
    idempotencyKey: input.idempotencyKey,
    occurredAt: optionalDate(input.occurredAt, "occurredAt"),
  };

  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, draft.ownerId);
    await ensureContact(tx, draft.ownerId, draft.contactId);
    const replay = await existingConsentReplay(tx, draft);
    if (replay) return { duplicate: true, eventIds: [replay.id], receivedAt: [replay.receivedAt] };
    const event = await writeOneConsentEvent(tx, draft);
    return { duplicate: false, eventIds: [event.id], receivedAt: [event.receivedAt] };
  });
}

function stopOperation(input: RecordUnqualifiedStopInput): {
  operationId: string;
  evidenceRef: string;
} {
  const namespace = requireOpaque(input.channelEventRef, "channelEventRef");
  const messageId = requireOpaque(input.opaqueMessageId, "opaqueMessageId");
  const prefix = input.sourceKind === "stop_keyword" ? "stop" : "historical-stop";
  return {
    operationId: `${prefix}:${input.channel}:${namespace}:${messageId}`,
    evidenceRef: `${namespace}:${messageId}`,
  };
}

export async function recordUnqualifiedStop(
  input: RecordUnqualifiedStopInput,
): Promise<ConsentEventWriteResult> {
  const ownerId = requireText(input.ownerId, "ownerId");
  const contactId = requireText(input.contactId, "contactId");
  const channel = requireToken(input.channel, "channel");
  const { operationId, evidenceRef } = stopOperation({ ...input, channel });
  const rule = consentRule(input.sourceKind, "revoke");
  const occurredAt = optionalDate(input.occurredAt, "occurredAt");
  const drafts = [...PROACTIVE_NON_TRANSACTIONAL_PURPOSES].sort().map<ConsentDraft>((purpose) => ({
    ownerId,
    contactId,
    channel,
    purpose,
    action: "revoke",
    actorKind: rule.actorKind,
    entryMode: rule.entryMode,
    sourceKind: input.sourceKind,
    evidenceStatus: rule.evidenceStatus,
    evidenceRef,
    operationId,
    idempotencyKey: `${operationId}:${purpose}`,
    occurredAt,
  }));

  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    await ensureContact(tx, ownerId, contactId);
    await advisoryLock(tx, `consent:fanout:${ownerId}:${contactId}:${channel}`);

    const existing = [] as Array<{ id: string; receivedAt: string } | null>;
    for (const draft of drafts) {
      validateConsentDraft(draft);
      await advisoryLock(tx, `consent:idempotency:${ownerId}:${draft.idempotencyKey}`);
      existing.push(await existingConsentReplay(tx, draft));
    }
    const existingCount = existing.filter(Boolean).length;
    if (existingCount > 0 && existingCount !== drafts.length) {
      throw new ConsentRuntimeError(
        "REPLAY_INTEGRITY",
        "A STOP operation has an incomplete pre-existing fan-out and cannot be guessed or partially repaired.",
      );
    }
    if (existingCount === drafts.length) {
      const replayed = existing.filter((event): event is { id: string; receivedAt: string } => event !== null);
      return {
        duplicate: true,
        eventIds: replayed.map((event) => event.id),
        receivedAt: replayed.map((event) => event.receivedAt),
      };
    }

    for (const draft of drafts) {
      await advisoryLock(
        tx,
        `consent:tuple:${ownerId}:${contactId}:${channel}:${draft.purpose}`,
      );
    }
    const inserted: Array<{ id: string; receivedAt: string }> = [];
    for (const draft of drafts) {
      inserted.push(await insertConsentEvent(tx, draft));
      await foldAndProjectConsentTuple(tx, draft);
    }
    return {
      duplicate: false,
      eventIds: inserted.map((event) => event.id),
      receivedAt: inserted.map((event) => event.receivedAt),
    };
  });
}

export async function recordStopPurposeExpansion(
  input: RecordStopPurposeExpansionInput,
): Promise<ConsentEventWriteResult> {
  const ownerId = requireText(input.ownerId, "ownerId");
  const contactId = requireText(input.contactId, "contactId");
  const channel = requireToken(input.channel, "channel");
  const originalStopOperationId = requireOpaque(input.originalStopOperationId, "originalStopOperationId");
  const evidenceRef = requireOpaque(input.evidenceRef, "evidenceRef");
  const purpose = input.purpose;
  const operationId = `purpose-expand:${originalStopOperationId}:${purpose}`;
  const rule = consentRule("stop_purpose_expansion", "revoke");
  const draft: ConsentDraft = {
    ownerId,
    contactId,
    channel,
    purpose,
    action: "revoke",
    actorKind: rule.actorKind,
    entryMode: rule.entryMode,
    sourceKind: "stop_purpose_expansion",
    evidenceStatus: rule.evidenceStatus,
    evidenceRef,
    operationId,
    idempotencyKey: operationId,
    occurredAt: null,
  };

  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    await ensureContact(tx, ownerId, contactId);
    await advisoryLock(tx, `consent:fanout:${ownerId}:${contactId}:${channel}`);
    const original = await tx.consentEvent.findFirst({
      where: {
        ownerId,
        contactId,
        channel,
        operationId: originalStopOperationId,
        sourceKind: { in: ["stop_keyword", "historical_verified_stop"] },
      },
      select: { id: true },
    });
    if (!original) {
      throw new ConsentRuntimeError(
        "TENANT_RESOURCE_NOT_FOUND",
        "The verified original unqualified STOP operation was not found in this tenant/scope.",
      );
    }
    const replay = await existingConsentReplay(tx, draft);
    if (replay) return { duplicate: true, eventIds: [replay.id], receivedAt: [replay.receivedAt] };
    // R-010 :206/:268 — stop_purpose_expansion may only write into a purpose tuple that
    // previously did not exist (no prior events, hence no interactive stance). With
    // Phase-1's proactive purpose set fully covered by STOP fan-out, this writer is
    // effectively dormant until a genuinely new purpose is approved.
    const priorTupleEvent = await tx.consentEvent.findFirst({
      where: { ownerId, contactId, channel, purpose },
      select: { id: true },
    });
    if (priorTupleEvent) {
      throw new ConsentRuntimeError(
        "INVALID_WRITER_COMBINATION",
        "stop_purpose_expansion may only target a purpose with no prior consent events for this contact/channel.",
      );
    }
    const event = await writeOneConsentEvent(tx, draft);
    return { duplicate: false, eventIds: [event.id], receivedAt: [event.receivedAt] };
  });
}

function dndActor(sourceKind: DndSourceKind): DndActorKind {
  if (sourceKind === "crm_ui") return "merchant";
  if (sourceKind === "otto_approved_action") return "otto";
  return "legacy_migration";
}

function sameDndPayload(existing: {
  ownerId: string;
  contactId: string;
  action: string;
  actorKind: string;
  actorId: string | null;
  sourceKind: string;
  evidenceRef: string | null;
  idempotencyKey: string;
}, draft: Omit<DndFoldRow, "id" | "receivedAt"> & {
  actorId: string | null;
  evidenceRef: string | null;
  idempotencyKey: string;
}): boolean {
  return (
    existing.ownerId === draft.ownerId &&
    existing.contactId === draft.contactId &&
    existing.action === draft.action &&
    existing.actorKind === draft.actorKind &&
    existing.actorId === draft.actorId &&
    existing.sourceKind === draft.sourceKind &&
    existing.evidenceRef === draft.evidenceRef &&
    existing.idempotencyKey === draft.idempotencyKey
  );
}

async function readDndContact(tx: Tx, ownerId: string, contactId: string): Promise<DndFoldRow[]> {
  return tx.$queryRaw<DndFoldRow[]>`
    SELECT
      "id", "ownerId", "contactId", "action", "actorKind", "sourceKind",
      to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
    FROM "ContactDndEvent"
    WHERE "ownerId" = ${ownerId} AND "contactId" = ${contactId}
    ORDER BY "receivedAt", "id"
  `;
}

async function writeDndProjectionFromFold(
  tx: Tx,
  ownerId: string,
  contactId: string,
  fold: DndFoldResult,
): Promise<void> {
  const updated = await tx.contact.updateMany({
    where: { ownerId, id: contactId },
    data: { doNotDisturb: fold.doNotDisturb },
  });
  if (updated.count !== 1) {
    throw new ConsentRuntimeError("REPLAY_INTEGRITY", "DND compatibility projection lost its Contact.");
  }
}

export async function recordContactDndEvent(
  input: RecordDndEventInput,
): Promise<ConsentEventWriteResult> {
  const ownerId = requireText(input.ownerId, "ownerId");
  const contactId = requireText(input.contactId, "contactId");
  const actorKind = dndActor(input.sourceKind);
  const actorId = optionalOpaque(input.actorId, "actorId");
  const evidenceRef = optionalOpaque(input.evidenceRef, "evidenceRef");
  const idempotencyKey = requireOpaque(input.idempotencyKey, "idempotencyKey");
  validateDndWriterCombination({ sourceKind: input.sourceKind, actorKind, action: input.action });
  const draft = {
    ownerId,
    contactId,
    action: input.action,
    actorKind,
    actorId,
    sourceKind: input.sourceKind,
    evidenceRef,
    idempotencyKey,
  };

  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    await ensureContact(tx, ownerId, contactId);
    await advisoryLock(tx, `dnd:idempotency:${ownerId}:${idempotencyKey}`);
    const existing = await tx.contactDndEvent.findFirst({ where: { ownerId, idempotencyKey } });
    if (existing) {
      if (!sameDndPayload(existing, draft)) {
        throw new ConsentRuntimeError(
          "IDEMPOTENCY_CONFLICT",
          "The DND idempotency key is already bound to a different semantic payload.",
        );
      }
      return {
        duplicate: true,
        eventIds: [existing.id],
        receivedAt: [await canonicalReceivedAt(tx, "ContactDndEvent", existing.id)],
      };
    }
    await advisoryLock(tx, `dnd:contact:${ownerId}:${contactId}`);
    const id = randomUUID();
    const inserted = await tx.$queryRaw<Array<{ id: string; receivedAt: string }>>`
      INSERT INTO "ContactDndEvent" (
        "id", "ownerId", "contactId", "action", "actorKind", "actorId", "sourceKind",
        "evidenceRef", "idempotencyKey", "receivedAt", "createdAt"
      )
      VALUES (
        ${id}, ${ownerId}, ${contactId}, ${input.action}, ${actorKind}, ${actorId},
        ${input.sourceKind}, ${evidenceRef}, ${idempotencyKey},
        GREATEST(
          date_trunc('microseconds', clock_timestamp()),
          COALESCE((
            SELECT MAX("receivedAt") + INTERVAL '1 microsecond'
            FROM "ContactDndEvent"
            WHERE "ownerId" = ${ownerId} AND "contactId" = ${contactId}
          ), '-infinity'::timestamptz)
        ),
        clock_timestamp()
      )
      RETURNING "id", to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
    `;
    const event = inserted[0];
    if (!event) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "DND insertion returned no row.");
    const fold = foldDndEvents(await readDndContact(tx, ownerId, contactId));
    if (!fold) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "DND fold was empty after insert.");
    await writeDndProjectionFromFold(tx, ownerId, contactId, fold);
    return { duplicate: false, eventIds: [event.id], receivedAt: [event.receivedAt] };
  });
}

function providerScope(input: RecordProviderRefusalEventInput): {
  scopeKey: string;
  channel: string | null;
  contactIdentityId: string | null;
} {
  const connectionId = requireText(input.providerConnectionId, "providerConnectionId");
  if (input.kind === "account_level") {
    const extra = input as RecordProviderRefusalEventInput & {
      channel?: unknown;
      contactIdentityId?: unknown;
    };
    if (extra.channel != null || extra.contactIdentityId != null) {
      throw new ConsentRuntimeError(
        "INVALID_WRITER_COMBINATION",
        "An account-level refusal may only target its provider connection.",
      );
    }
    return { scopeKey: `account:${connectionId}`, channel: null, contactIdentityId: null };
  }
  const channel = input.channel == null ? null : requireToken(input.channel, "channel");
  const contactIdentityId =
    input.contactIdentityId == null ? null : requireText(input.contactIdentityId, "contactIdentityId");
  if (channel === null && contactIdentityId === null) {
    return { scopeKey: `account:${connectionId}`, channel, contactIdentityId };
  }
  if (channel === null || contactIdentityId === null) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "A recipient refusal scope requires both channel and ContactIdentity.",
    );
  }
  return {
    scopeKey: `recipient:${connectionId}:${channel}:${contactIdentityId}`,
    channel,
    contactIdentityId,
  };
}

async function ensureProviderTarget(tx: Tx, draft: ProviderDraft): Promise<void> {
  const connections = await tx.$queryRaw<Array<{ id: string; kind: string }>>`
    SELECT "id", "kind"
    FROM "ChannelConnection"
    WHERE "ownerId" = ${draft.ownerId} AND "id" = ${draft.providerConnectionId}
    FOR UPDATE
  `;
  const connection = connections[0];
  if (!connection) {
    throw new ConsentRuntimeError(
      "TENANT_RESOURCE_NOT_FOUND",
      "The provider connection was not found in the authenticated tenant.",
    );
  }
  if (draft.channel === null) return;
  if (connection.kind !== draft.channel) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "The provider connection channel does not match the refusal recipient scope.",
    );
  }
  const identities = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT identity."id"
    FROM "ContactIdentity" AS identity
    JOIN "Contact" AS contact
      ON contact."id" = identity."contactId" AND contact."ownerId" = identity."ownerId"
    WHERE identity."ownerId" = ${draft.ownerId}
      AND identity."id" = ${draft.contactIdentityId}
      AND identity."channel" = ${draft.channel}
      AND identity."deletedAt" IS NULL
      AND contact."deletedAt" IS NULL
    FOR UPDATE OF identity
  `;
  if (identities.length !== 1) {
    throw new ConsentRuntimeError(
      "TENANT_RESOURCE_NOT_FOUND",
      "The ContactIdentity was not found in the authenticated tenant/channel.",
    );
  }
}

function sameProviderPayload(existing: {
  ownerId: string;
  scopeKey: string;
  providerConnectionId: string;
  channel: string | null;
  contactIdentityId: string | null;
  kind: string;
  action: string;
  actorKind: string;
  actorId: string | null;
  providerCode: string;
  receiptRef: string;
  reversesEventId: string | null;
  idempotencyKey: string;
  expiresAt: Date | null;
}, draft: ProviderDraft): boolean {
  return (
    existing.ownerId === draft.ownerId &&
    existing.scopeKey === draft.scopeKey &&
    existing.providerConnectionId === draft.providerConnectionId &&
    existing.channel === draft.channel &&
    existing.contactIdentityId === draft.contactIdentityId &&
    existing.kind === draft.kind &&
    existing.action === draft.action &&
    existing.actorKind === draft.actorKind &&
    existing.actorId === draft.actorId &&
    existing.providerCode === draft.providerCode &&
    existing.receiptRef === draft.receiptRef &&
    existing.reversesEventId === draft.reversesEventId &&
    existing.idempotencyKey === draft.idempotencyKey &&
    sameDate(existing.expiresAt, draft.expiresAt)
  );
}

async function existingProviderReplay(
  tx: Tx,
  draft: ProviderDraft,
): Promise<{ id: string; receivedAt: string } | null> {
  const existing = await tx.providerRefusalEvent.findFirst({
    where: { ownerId: draft.ownerId, idempotencyKey: draft.idempotencyKey },
  });
  if (!existing) return null;
  if (!sameProviderPayload(existing, draft)) {
    throw new ConsentRuntimeError(
      "IDEMPOTENCY_CONFLICT",
      "The provider-refusal idempotency key is already bound to a different semantic payload.",
    );
  }
  return {
    id: existing.id,
    receivedAt: await canonicalReceivedAt(tx, "ProviderRefusalEvent", existing.id),
  };
}

async function readProviderScope(tx: Tx, ownerId: string, scopeKey: string): Promise<ProviderFoldRow[]> {
  return tx.$queryRaw<ProviderFoldRow[]>`
    SELECT
      "id", "ownerId", "scopeKey", "kind", "action", "actorKind", "reversesEventId",
      CASE WHEN "expiresAt" IS NULL THEN NULL
        ELSE to_char("expiresAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "expiresAt",
      "channel", "contactIdentityId",
      to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
    FROM "ProviderRefusalEvent"
    WHERE "ownerId" = ${ownerId} AND "scopeKey" = ${scopeKey}
    ORDER BY "receivedAt", "id"
  `;
}

async function writeProviderProjectionFromFold(
  tx: Tx,
  ownerId: string,
  scopeKey: string,
  fold: ProviderRefusalFoldResult,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "ProviderRefusalState" (
      "ownerId", "scopeKey", "blocked", "lastEventId", "lastReceivedAt"
    )
    SELECT ${ownerId}, ${scopeKey}, ${fold.blocked}, ${fold.lastEventId}, event."receivedAt"
    FROM "ProviderRefusalEvent" AS event
    WHERE event."ownerId" = ${ownerId} AND event."id" = ${fold.lastEventId}
    ON CONFLICT ("ownerId", "scopeKey") DO UPDATE SET
      "blocked" = EXCLUDED."blocked",
      "lastEventId" = EXCLUDED."lastEventId",
      "lastReceivedAt" = EXCLUDED."lastReceivedAt"
  `;
}

async function activeProviderBlock(
  tx: Tx,
  ownerId: string,
  scopeKey: string,
): Promise<ProviderRefusalFoldResult | null> {
  return foldProviderRefusalEvents(await readProviderScope(tx, ownerId, scopeKey));
}

async function insertProviderEvent(
  tx: Tx,
  draft: ProviderDraft,
): Promise<{ id: string; receivedAt: string }> {
  const id = randomUUID();
  const inserted = await tx.$queryRaw<Array<{ id: string; receivedAt: string }>>`
    INSERT INTO "ProviderRefusalEvent" (
      "id", "ownerId", "scopeKey", "providerConnectionId", "channel", "contactIdentityId",
      "kind", "action", "actorKind", "actorId", "providerCode", "receiptRef",
      "reversesEventId", "idempotencyKey", "receivedAt", "expiresAt", "createdAt"
    )
    VALUES (
      ${id}, ${draft.ownerId}, ${draft.scopeKey}, ${draft.providerConnectionId}, ${draft.channel},
      ${draft.contactIdentityId}, ${draft.kind}, ${draft.action}, ${draft.actorKind}, ${draft.actorId},
      ${draft.providerCode}, ${draft.receiptRef}, ${draft.reversesEventId}, ${draft.idempotencyKey},
      GREATEST(
        date_trunc('microseconds', clock_timestamp()),
        COALESCE((
          SELECT MAX("receivedAt") + INTERVAL '1 microsecond'
          FROM "ProviderRefusalEvent"
          WHERE "ownerId" = ${draft.ownerId} AND "scopeKey" = ${draft.scopeKey}
        ), '-infinity'::timestamptz)
      ),
      ${draft.expiresAt},
      clock_timestamp()
    )
    RETURNING "id", to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
  `;
  const event = inserted[0];
  if (!event) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "Provider refusal insertion returned no row.");
  return event;
}

async function writeProviderDraft(tx: Tx, draft: ProviderDraft): Promise<{ id: string; receivedAt: string }> {
  validateProviderRefusalWriterCombination({
    kind: draft.kind,
    action: draft.action,
    actorKind: draft.actorKind,
    hasChannel: draft.channel !== null,
    hasContactIdentity: draft.contactIdentityId !== null,
    hasExpiresAt: draft.expiresAt !== null,
    hasReversesEventId: draft.reversesEventId !== null,
  });
  await advisoryLock(tx, `refusal:idempotency:${draft.ownerId}:${draft.idempotencyKey}`);
  const replay = await existingProviderReplay(tx, draft);
  if (replay) return replay;
  await ensureProviderTarget(tx, draft);
  await advisoryLock(tx, `refusal:scope:${draft.ownerId}:${draft.scopeKey}`);
  const before = await activeProviderBlock(tx, draft.ownerId, draft.scopeKey);
  if (draft.action === "clear" || draft.action === "expire") {
    if (!before?.blocked || before.activeBlockEventId !== draft.reversesEventId) {
      throw new ConsentRuntimeError(
        "ACTIVE_BLOCK_REQUIRED",
        "A provider-refusal clear/expire must reference the active block in the same exact scope.",
      );
    }
  }
  const event = await insertProviderEvent(tx, draft);
  const fold = await activeProviderBlock(tx, draft.ownerId, draft.scopeKey);
  if (!fold) throw new ConsentRuntimeError("REPLAY_INTEGRITY", "Provider refusal fold was empty after insert.");
  await writeProviderProjectionFromFold(tx, draft.ownerId, draft.scopeKey, fold);
  return event;
}

export async function recordProviderRefusalEvent(
  input: RecordProviderRefusalEventInput,
): Promise<ConsentEventWriteResult> {
  const ownerId = requireText(input.ownerId, "ownerId");
  const providerConnectionId = requireText(input.providerConnectionId, "providerConnectionId");
  const scope = providerScope(input);
  const expiresAt =
    "expiresAt" in input ? optionalDate(input.expiresAt, "expiresAt") : null;
  const reversesEventId =
    "reversesEventId" in input ? optionalOpaque(input.reversesEventId, "reversesEventId") : null;
  const draft: ProviderDraft = {
    ownerId,
    scopeKey: scope.scopeKey,
    providerConnectionId,
    channel: scope.channel,
    contactIdentityId: scope.contactIdentityId,
    kind: input.kind,
    action: input.action,
    actorKind: "provider",
    actorId: optionalOpaque(input.actorId, "actorId"),
    providerCode: requireOpaque(input.providerCode, "providerCode"),
    receiptRef: requireOpaque(input.receiptRef, "receiptRef"),
    reversesEventId,
    idempotencyKey: requireOpaque(input.idempotencyKey, "idempotencyKey"),
    expiresAt,
  };

  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const replay = await existingProviderReplay(tx, draft);
    if (replay) return { duplicate: true, eventIds: [replay.id], receivedAt: [replay.receivedAt] };
    const event = await writeProviderDraft(tx, draft);
    return { duplicate: false, eventIds: [event.id], receivedAt: [event.receivedAt] };
  });
}

export async function expireProviderRefusal(
  input: ExpireProviderRefusalInput,
): Promise<ConsentEventWriteResult> {
  const ownerId = requireText(input.ownerId, "ownerId");
  const blockEventId = requireText(input.blockEventId, "blockEventId");
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const block = await tx.providerRefusalEvent.findFirst({
      where: { ownerId, id: blockEventId },
    });
    if (
      !block ||
      block.kind !== "account_level" ||
      block.action !== "block" ||
      block.actorKind !== "provider" ||
      block.expiresAt === null ||
      block.channel !== null ||
      block.contactIdentityId !== null
    ) {
      throw new ConsentRuntimeError(
        "ACTIVE_BLOCK_REQUIRED",
        "System expiry requires a finite provider-verifiable account-level block in this tenant.",
      );
    }
    const expiresAt = block.expiresAt;
    const draft: ProviderDraft = {
      ownerId,
      scopeKey: `account:${block.providerConnectionId}`,
      providerConnectionId: block.providerConnectionId,
      channel: null,
      contactIdentityId: null,
      kind: "account_level",
      action: "expire",
      actorKind: "system",
      actorId: optionalOpaque(input.actorId, "actorId"),
      providerCode: block.providerCode,
      receiptRef: block.receiptRef,
      reversesEventId: block.id,
      idempotencyKey: `refusal-expire:${block.id}:${expiresAt.toISOString()}`,
      expiresAt,
    };
    const replay = await existingProviderReplay(tx, draft);
    if (replay) return { duplicate: true, eventIds: [replay.id], receivedAt: [replay.receivedAt] };
    const expiry = await tx.$queryRaw<Array<{ due: boolean }>>`
      SELECT clock_timestamp() >= ${expiresAt}::timestamptz AS "due"
    `;
    if (!expiry[0]?.due) {
      throw new ConsentRuntimeError(
        "INVALID_WRITER_COMBINATION",
        "An account-level refusal remains blocked until its verified expiry is due.",
      );
    }
    const event = await writeProviderDraft(tx, draft);
    return { duplicate: false, eventIds: [event.id], receivedAt: [event.receivedAt] };
  });
}

function grouped<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = groups.get(key(row));
    if (value) value.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

export async function rebuildConsentRuntimeProjections(
  ownerIdInput: string,
): Promise<RebuildConsentRuntimeResult> {
  const ownerId = requireText(ownerIdInput, "ownerId");
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const organization = await tx.organization.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!organization) {
      throw new ConsentRuntimeError(
        "TENANT_RESOURCE_NOT_FOUND",
        "The authenticated tenant was not found.",
      );
    }

    const consentRows = await tx.$queryRaw<ConsentFoldRow[]>`
      SELECT
        "id", "ownerId", "contactId", "channel", "purpose", "action", "actorKind",
        "entryMode", "sourceKind", "evidenceStatus",
        to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
      FROM "ConsentEvent"
      WHERE "ownerId" = ${ownerId}
      ORDER BY "contactId", "channel", "purpose", "receivedAt", "id"
    `;
    await tx.consentStateProjection.deleteMany({ where: { ownerId } });
    const consentGroups = grouped(
      consentRows,
      (row) => JSON.stringify([row.contactId, row.channel, row.purpose]),
    );
    for (const rows of consentGroups.values()) {
      const first = rows[0];
      const fold = foldConsentEvents(rows);
      if (!first || !fold) continue;
      await writeConsentProjectionFromFold(
        tx,
        ownerId,
        first.contactId,
        first.channel,
        first.purpose,
        fold,
      );
    }

    const dndRows = await tx.$queryRaw<DndFoldRow[]>`
      SELECT
        "id", "ownerId", "contactId", "action", "actorKind", "sourceKind",
        to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
      FROM "ContactDndEvent"
      WHERE "ownerId" = ${ownerId}
      ORDER BY "contactId", "receivedAt", "id"
    `;
    const dndGroups = grouped(dndRows, (row) => row.contactId);
    for (const rows of dndGroups.values()) {
      const first = rows[0];
      const fold = foldDndEvents(rows);
      if (!first || !fold) continue;
      await writeDndProjectionFromFold(tx, ownerId, first.contactId, fold);
    }

    const providerRows = await tx.$queryRaw<ProviderFoldRow[]>`
      SELECT
        "id", "ownerId", "scopeKey", "kind", "action", "actorKind", "reversesEventId",
        CASE WHEN "expiresAt" IS NULL THEN NULL
          ELSE to_char("expiresAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "expiresAt",
        "channel", "contactIdentityId",
        to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt"
      FROM "ProviderRefusalEvent"
      WHERE "ownerId" = ${ownerId}
      ORDER BY "scopeKey", "receivedAt", "id"
    `;
    await tx.providerRefusalState.deleteMany({ where: { ownerId } });
    const providerGroups = grouped(providerRows, (row) => row.scopeKey);
    for (const rows of providerGroups.values()) {
      const first = rows[0];
      const fold = foldProviderRefusalEvents(rows);
      if (!first || !fold) continue;
      await writeProviderProjectionFromFold(tx, ownerId, first.scopeKey, fold);
    }

    return {
      consentProjectionCount: consentGroups.size,
      dndContactCount: dndGroups.size,
      providerProjectionCount: providerGroups.size,
    };
  });
}
