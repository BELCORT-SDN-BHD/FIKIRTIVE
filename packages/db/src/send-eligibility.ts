/**
 * C5-M2 four-axis send-eligibility READ evaluator, plus the sole writer of the frequency
 * rolling-window counter (ContactSendFrequencyEvent). Spec:
 * docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md §4/§5.
 *
 * consent-runtime.ts stays the SOLE writer of consent/DND/provider-refusal facts — this
 * module only fold-reads ConsentStateProjection / Contact.doNotDisturb (the DND compatibility
 * projection consent-runtime already maintains) / Contact.marketingConsent (the pre-ledger
 * consent mirror, read through consent-fold's fence — #806) / ProviderRefusalState. It never
 * writes them.
 * The four axes are evaluated and reported SEPARATELY — never merged into one boolean or a
 * suppression list (§3.2). The `aggregate` field always takes the M1-M3 `unavailable` branch
 * (§4.4): AggregateDisposition only activates once a real send path exists (M4).
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { contactConsentTruth, CRM_CONSENT_SCOPE, isKnownOptOut } from "./consent-fold.js";
import { prisma } from "./index.js";

type Tx = Prisma.TransactionClient;
export type SendEligibilityDb = typeof prisma | Tx;

export type SendEligibilityErrorCode =
  | "INVALID_ARGUMENT"
  | "IDEMPOTENCY_CONFLICT"
  | "MISSING_CHANNEL_POLICY"
  | "FREQUENCY_CAP_REACHED";

export class SendEligibilityError extends Error {
  readonly code: SendEligibilityErrorCode;

  constructor(code: SendEligibilityErrorCode, message: string) {
    super(message);
    this.name = "SendEligibilityError";
    this.code = code;
  }
}

export type EligibilityAxisStatus = "pass" | "block" | "risk" | "unknown" | "unavailable";

export type EligibilityAxis = {
  status: EligibilityAxisStatus;
  source: string;
  reason?: string;
  checkedAt: string;
};

export const SEND_PURPOSES = [
  "marketing",
  "review_request",
  "transactional",
  "reactive_service_reply",
] as const;
export type SendPurpose = (typeof SEND_PURPOSES)[number];

export const CALLER_CLASSES = ["unconfirmed_automatic", "merchant_manual"] as const;
export type SendCallerClass = (typeof CALLER_CLASSES)[number];

// The two purposes that ever accrue ConsentEvent tuples under D4's unqualified-STOP fan-out
// and that frequency gates (§3.1.5, §4.2 bullet list). transactional/reactive_service_reply
// never count against the cap.
const PROACTIVE_NON_TRANSACTIONAL_PURPOSES = new Set<SendPurpose>(["marketing", "review_request"]);
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type SendEligibilityInput = {
  ownerId: string;
  contactId: string;
  contactIdentityId: string;
  channel: string;
  /** chokepoint-derived; callers never accept this from client/Otto/connector payload (§3.2). */
  purpose: SendPurpose;
  /**
   * Nullable by design: neither BroadcastRun nor CustomerConversation stores a provider
   * connection reference in the M1 schema — callers resolve one dynamically from the
   * ChannelScope, and the simulated-provider era frequently has none at all. §4.3's
   * "空态 ≠ 缺能力" carve-out makes "no connection resolved" the same honest empty state as
   * "connection resolved, no refusal history": the refusal-history axis reads `pass`, never
   * a fabricated `unavailable` (that word is reserved for genuinely unreadable authority).
   */
  providerConnectionId: string | null;
  /** chokepoint-derived; callers never accept this from client/Otto/connector payload (§3.2). */
  callerClass: SendCallerClass;
};

export type SendEligibilityResult = {
  consentStop: EligibilityAxis;
  doNotDisturb: EligibilityAxis;
  providerRefusal: EligibilityAxis;
  frequency: EligibilityAxis;
  aggregate: { status: "unavailable"; reason: "SEND_PATH_UNAVAILABLE" };
  checkedAt: string;
};

export type SendFrequencyPolicy = Readonly<Record<string, { windowHours: number; maxProactiveSends: number }>>;

/**
 * §5.5: server-owned, Founder-tunable config — never scattered as literals through business/UI
 * code. Phase-1 conservative default: 1 proactive WhatsApp send per contact per rolling 24h.
 */
export const SEND_FREQUENCY_POLICY: SendFrequencyPolicy = Object.freeze({
  whatsapp: { windowHours: 24, maxProactiveSends: 1 },
});

function requireText(value: string, field: string): string {
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new SendEligibilityError("INVALID_ARGUMENT", `${field} must be a compact non-empty value.`);
  }
  return value;
}

function requireToken(value: string, field: string): string {
  if (!TOKEN.test(value)) {
    throw new SendEligibilityError("INVALID_ARGUMENT", `${field} is outside the closed server taxonomy.`);
  }
  return value;
}

function requireOpaque(value: string, field: string): string {
  requireText(value, field);
  if (/\s/.test(value)) {
    throw new SendEligibilityError(
      "INVALID_ARGUMENT",
      `${field} must be an opaque reference/key, not copied raw content.`,
    );
  }
  return value;
}

function validateInput(input: SendEligibilityInput): void {
  requireText(input.ownerId, "ownerId");
  requireText(input.contactId, "contactId");
  requireText(input.contactIdentityId, "contactIdentityId");
  requireToken(input.channel, "channel");
  if (!(SEND_PURPOSES as readonly string[]).includes(input.purpose)) {
    throw new SendEligibilityError("INVALID_ARGUMENT", "purpose is outside the closed set.");
  }
  if (!(CALLER_CLASSES as readonly string[]).includes(input.callerClass)) {
    throw new SendEligibilityError("INVALID_ARGUMENT", "callerClass is outside the closed set.");
  }
  if (input.providerConnectionId !== null) requireText(input.providerConnectionId, "providerConnectionId");
}

function axis(status: EligibilityAxisStatus, source: string, checkedAt: string, reason?: string): EligibilityAxis {
  return reason === undefined ? { status, source, checkedAt } : { status, source, reason, checkedAt };
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * §4.2.1's 3×2 consent-state × callerClass mapping, over the WHOLE consent authority — the
 * ConsentStateProjection plus the pre-ledger fence. Axis `unknown`/`unavailable` is reserved
 * STRICTLY for "the authority is physically unreadable" — a resolved consent state of "unknown"
 * (fold-null or literal projection state) always maps to `risk`/`block`, never axis-`unknown`.
 *
 * #806: reading the projection alone was not the whole authority. A contact whose only opt-out
 * record is the legacy `Contact.marketingConsent` column (R-010 §4.6.5's pre-ledger fence) has
 * no projection row at all, so this axis called an audience-wide known opt-out plain "unknown
 * consent" and handed `merchant_manual` — which is what a broadcast and the inbox both are — a
 * `risk`, the D5-overridable tier. The fence is fail-closed by the Founder's #750 ruling, so it
 * is a `block` here, on the same predicate the segment/audience side reads (`contactConsentTruth`
 * in consent-fold.ts). Same rule, one definition, two layers.
 */
async function evalConsentStop(
  db: SendEligibilityDb,
  input: SendEligibilityInput,
  checkedAt: string,
): Promise<EligibilityAxis> {
  if (input.purpose === "reactive_service_reply") {
    // Independent send class (R-010 §4.3.3): not consent-purpose-gated at all.
    return axis("pass", "reactive_service_reply_not_consent_gated", checkedAt);
  }

  let state: string;
  try {
    const row = await db.consentStateProjection.findUnique({
      where: {
        ownerId: input.ownerId,
        ownerId_contactId_channel_purpose: {
          ownerId: input.ownerId,
          contactId: input.contactId,
          channel: input.channel,
          purpose: input.purpose,
        },
      },
      select: { state: true },
    });
    // fold-null (no projection row yet) counts as consent-state "unknown" (§4.2.1 header note).
    state = row?.state ?? "unknown";
  } catch {
    return axis("unavailable", "consent_state_projection", checkedAt, "projection_unreadable");
  }

  if (state === "verified_grant") return axis("pass", "consent_state_projection", checkedAt);
  if (state === "effective_revoke") {
    return axis("block", "consent_state_projection", checkedAt, "effective_revoke");
  }

  // state === "unknown": the pre-ledger fence is the other half of the authority, and it only
  // ever holds a customer OUT. Read only in the one scope the legacy column mirrors, so no other
  // channel/purpose pays for a query that could not change the answer.
  let fenced = false;
  try {
    fenced = isKnownOptOut(
      contactConsentTruth(
        undefined,
        await readLegacyMarketingConsent(db, input),
        { channel: input.channel, purpose: input.purpose },
      ),
    );
  } catch {
    // The fence source is unreadable, so "not fenced" would be a guess in the direction of
    // sending. Fail closed the honest way: name the unreadable authority (no axis reads `pass`,
    // so nothing is sent on a fabricated all-clear).
    return axis("unavailable", "consent_legacy_mirror", checkedAt, "legacy_mirror_unreadable");
  }
  if (fenced) {
    return axis("block", "consent_legacy_mirror", checkedAt, "unresolved_legacy_opt_out");
  }

  // Genuinely unknown: D5-eligible risk for a human, hard block for anything unconfirmed.
  return input.callerClass === "merchant_manual"
    ? axis("risk", "consent_state_projection", checkedAt, "consent_unknown_d5_eligible")
    : axis("block", "consent_state_projection", checkedAt, "consent_unknown_unconfirmed_automatic_hard_block");
}

/**
 * The legacy whatsapp+marketing consent mirror for this contact, or null when this send's scope
 * is not the one tuple the column mirrors (R-010 §4.6.1) — passing null there is what makes
 * `contactConsentTruth` a no-op for every other channel/purpose, exactly as on the web side.
 * A contact row missing inside the tenant carries no column either; the DND axis is the one that
 * reports that shape as `unavailable`, so this read stays silent about it.
 */
async function readLegacyMarketingConsent(
  db: SendEligibilityDb,
  input: SendEligibilityInput,
): Promise<string | null> {
  if (input.channel !== CRM_CONSENT_SCOPE.channel || input.purpose !== CRM_CONSENT_SCOPE.purpose) {
    return null;
  }
  const contact = await db.contact.findFirst({
    where: { ownerId: input.ownerId, id: input.contactId },
    select: { marketingConsent: true },
  });
  return contact?.marketingConsent ?? null;
}

/**
 * Authority: ContactDndEvent's fold, read via the Contact.doNotDisturb compatibility
 * projection consent-runtime.ts already maintains (§4.2 row explicitly allows either read
 * path). Contact-wide, covers every channel/purpose; clearing DND never manufactures grant.
 */
async function evalDoNotDisturb(
  db: SendEligibilityDb,
  input: SendEligibilityInput,
  checkedAt: string,
): Promise<EligibilityAxis> {
  try {
    const contact = await db.contact.findFirst({
      where: { ownerId: input.ownerId, id: input.contactId },
      select: { doNotDisturb: true },
    });
    if (!contact) {
      return axis("unavailable", "contact_dnd_fold", checkedAt, "contact_not_found_in_tenant");
    }
    return contact.doNotDisturb
      ? axis("block", "contact_dnd_fold", checkedAt, "dnd_set")
      : axis("pass", "contact_dnd_fold", checkedAt);
  } catch {
    return axis("unavailable", "contact_dnd_fold", checkedAt, "fold_unreadable");
  }
}

/**
 * Authority: ProviderRefusalState at the recipient scope (`recipient:<connectionId>:<channel>:
 * <identityId>`) and the account scope (`account:<connectionId>`) — both server-derived,
 * never caller-supplied (§4.3). transient refusals never enter this projection (R-010
 * §4.5.1) so they can never surface here as a block.
 */
async function evalProviderRefusal(
  db: SendEligibilityDb,
  input: SendEligibilityInput,
  checkedAt: string,
): Promise<EligibilityAxis> {
  if (!input.providerConnectionId) {
    // §4.3 "空态 ≠ 缺能力": no connection resolved is the same honest empty state as a
    // connection with zero refusal history — this axis reads pass, not a fabricated block.
    return axis("pass", "provider_refusal_state", checkedAt, "no_provider_connection");
  }
  const recipientScope = `recipient:${input.providerConnectionId}:${input.channel}:${input.contactIdentityId}`;
  const accountScope = `account:${input.providerConnectionId}`;
  try {
    const [recipient, account] = await Promise.all([
      db.providerRefusalState.findUnique({
        where: {
          ownerId: input.ownerId,
          ownerId_scopeKey: { ownerId: input.ownerId, scopeKey: recipientScope },
        },
        select: { blocked: true },
      }),
      db.providerRefusalState.findUnique({
        where: {
          ownerId: input.ownerId,
          ownerId_scopeKey: { ownerId: input.ownerId, scopeKey: accountScope },
        },
        select: { blocked: true },
      }),
    ]);
    if (recipient?.blocked) return axis("block", "provider_refusal_state", checkedAt, "permanent_recipient_block");
    if (account?.blocked) return axis("block", "provider_refusal_state", checkedAt, "account_level_block");
    return axis("pass", "provider_refusal_state", checkedAt);
  } catch {
    return axis("unavailable", "provider_refusal_state", checkedAt, "state_unreadable");
  }
}

/**
 * Authority: rolling-window row count over ContactSendFrequencyEvent (§5.4). Only
 * proactive_non_transactional purposes are gated; transactional/reactive_service_reply read
 * pass without ever touching the counter. Missing channel config fails closed (`unavailable`).
 *
 * Era filter: the read side hardcodes `simulated: true`. M1-M3 is entirely the
 * simulated-provider era (ledger #359 item 28) — there is no reachable real-send attempt yet
 * for this evaluator to be called from, so §5.4's "filter by the attempt's own simulated flag"
 * degenerates to a constant. M4 must thread a real per-attempt flag through this input before
 * any real send path opens (SendEligibilityInput carries no such field today — see the M2
 * worker report for this documented interpretation).
 */
async function evalFrequency(
  db: SendEligibilityDb,
  input: SendEligibilityInput,
  checkedAt: string,
): Promise<EligibilityAxis> {
  if (!PROACTIVE_NON_TRANSACTIONAL_PURPOSES.has(input.purpose)) {
    return axis("pass", "send_frequency_counter", checkedAt, "not_proactive_not_counted");
  }
  const policy = SEND_FREQUENCY_POLICY[input.channel];
  if (!policy) {
    return axis("unavailable", "send_frequency_counter", checkedAt, "missing_channel_policy");
  }
  const windowStart = new Date(Date.parse(checkedAt) - policy.windowHours * 60 * 60 * 1000);
  try {
    const count = await db.contactSendFrequencyEvent.count({
      where: {
        ownerId: input.ownerId,
        contactId: input.contactId,
        channel: input.channel,
        purposeClass: "proactive_non_transactional",
        countedAt: { gt: windowStart },
        simulated: true,
      },
    });
    return count < policy.maxProactiveSends
      ? axis("pass", "send_frequency_counter", checkedAt)
      : axis("block", "send_frequency_counter", checkedAt, "frequency_cap_reached");
  } catch {
    return axis("unavailable", "send_frequency_counter", checkedAt, "counter_unreadable");
  }
}

/**
 * The one and only C5 evaluator (§4.1). Pure, owner-scoped READ — never writes consent/DND/
 * refusal facts. `db` may be the default client or an open transaction, so callers folding
 * this into a larger CAS transaction (e.g. freezeAudience) get a consistent snapshot.
 */
export async function evaluateSendEligibility(
  db: SendEligibilityDb,
  input: SendEligibilityInput,
): Promise<SendEligibilityResult> {
  validateInput(input);
  const checkedAt = new Date().toISOString();
  const [consentStop, doNotDisturb, providerRefusal, frequency] = await Promise.all([
    evalConsentStop(db, input, checkedAt),
    evalDoNotDisturb(db, input, checkedAt),
    evalProviderRefusal(db, input, checkedAt),
    evalFrequency(db, input, checkedAt),
  ]);
  return {
    consentStop,
    doNotDisturb,
    providerRefusal,
    frequency,
    // §4.4: AggregateDisposition only activates once a real send path exists (M4). M1-M3
    // always takes this branch, matching live getConversationPreflight's existing shape.
    aggregate: { status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" },
    checkedAt,
  };
}

export type RecordSendFrequencyEventInput = {
  ownerId: string;
  contactId: string;
  channel: string;
  purposeClass: "proactive_non_transactional";
  sourceKind: "broadcast_run" | "conversation_reply";
  /** Opaque ref to the send that produced this count — never a receipt (§5.4). */
  sendRef: string;
  /** M1-M3 callers always pass true; a real send only ever writes false, and only after M6. */
  simulated: boolean;
  /**
   * Server-derived, frozen logical-send identity (§5.4): broadcast source =
   * `freq:<ownerId>:<broadcastRunId>:<contactIdentityId>:<channel>:<purposeClass>` (excludes
   * audienceRevision so a re-freeze/retry never double-counts). Conversation source =
   * `freq:conv:<ownerId>:<conversationSendId>` — one key PER SENT MESSAGE, never collapsed to
   * conversationId (§5.4, §11.3: collapsing would silently cap only the first reply per thread).
   */
  idempotencyKey: string;
  occurredAt?: Date | null;
};

export type RecordSendFrequencyEventResult = {
  duplicate: boolean;
  id: string;
  countedAt: string;
};

type FrequencyEventDraft = {
  ownerId: string;
  contactId: string;
  channel: string;
  purposeClass: "proactive_non_transactional";
  sourceKind: "broadcast_run" | "conversation_reply";
  sendRef: string;
  simulated: boolean;
  idempotencyKey: string;
  occurredAt: Date | null;
};

function frequencyEventDraft(input: RecordSendFrequencyEventInput): FrequencyEventDraft {
  const ownerId = requireText(input.ownerId, "ownerId");
  const contactId = requireText(input.contactId, "contactId");
  const channel = requireToken(input.channel, "channel");
  if (input.purposeClass !== "proactive_non_transactional") {
    throw new SendEligibilityError("INVALID_ARGUMENT", "purposeClass is outside the Phase-1 closed set.");
  }
  if (input.sourceKind !== "broadcast_run" && input.sourceKind !== "conversation_reply") {
    throw new SendEligibilityError("INVALID_ARGUMENT", "sourceKind is outside the closed set.");
  }
  const sendRef = requireOpaque(input.sendRef, "sendRef");
  const idempotencyKey = requireOpaque(input.idempotencyKey, "idempotencyKey");
  if (typeof input.simulated !== "boolean") {
    throw new SendEligibilityError("INVALID_ARGUMENT", "simulated must be a boolean.");
  }
  if (!SEND_FREQUENCY_POLICY[channel]) {
    throw new SendEligibilityError(
      "MISSING_CHANNEL_POLICY",
      `No SEND_FREQUENCY_POLICY entry for channel "${channel}".`,
    );
  }
  return {
    ownerId,
    contactId,
    channel,
    purposeClass: input.purposeClass,
    sourceKind: input.sourceKind,
    sendRef,
    simulated: input.simulated,
    idempotencyKey,
    occurredAt: input.occurredAt ?? null,
  };
}

function sameFrequencyEventPayload(
  existing: {
    ownerId: string;
    contactId: string;
    channel: string;
    purposeClass: string;
    sourceKind: string;
    sendRef: string;
    simulated: boolean;
    idempotencyKey: string;
    occurredAt: Date | null;
  },
  draft: FrequencyEventDraft,
): boolean {
  return (
    existing.ownerId === draft.ownerId &&
    existing.contactId === draft.contactId &&
    existing.channel === draft.channel &&
    existing.purposeClass === draft.purposeClass &&
    existing.sourceKind === draft.sourceKind &&
    existing.sendRef === draft.sendRef &&
    existing.simulated === draft.simulated &&
    existing.idempotencyKey === draft.idempotencyKey &&
    (existing.occurredAt?.getTime() ?? null) === (draft.occurredAt?.getTime() ?? null)
  );
}

async function existingFrequencyEventReplay(
  tx: Tx,
  draft: FrequencyEventDraft,
): Promise<RecordSendFrequencyEventResult | null> {
  const existing = await tx.contactSendFrequencyEvent.findFirst({
    where: { ownerId: draft.ownerId, idempotencyKey: draft.idempotencyKey },
  });
  if (!existing) return null;
  if (!sameFrequencyEventPayload(existing, draft)) {
    throw new SendEligibilityError(
      "IDEMPOTENCY_CONFLICT",
      "The frequency-event idempotency key is already bound to a different semantic payload.",
    );
  }
  return { duplicate: true, id: existing.id, countedAt: existing.countedAt.toISOString() };
}

async function recordFrequencyEventInTransaction(
  tx: Tx,
  draft: FrequencyEventDraft,
): Promise<RecordSendFrequencyEventResult> {
  const policy = SEND_FREQUENCY_POLICY[draft.channel]!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`send-frequency:${draft.ownerId}:${draft.contactId}:${draft.channel}:${draft.purposeClass}`}, 0))`;

  const existing = await existingFrequencyEventReplay(tx, draft);
  if (existing) return existing;

  const windowStart = new Date(Date.now() - policy.windowHours * 60 * 60 * 1000);
  const count = await tx.contactSendFrequencyEvent.count({
    where: {
      ownerId: draft.ownerId,
      contactId: draft.contactId,
      channel: draft.channel,
      purposeClass: draft.purposeClass,
      countedAt: { gt: windowStart },
      simulated: draft.simulated,
    },
  });
  if (count >= policy.maxProactiveSends) {
    throw new SendEligibilityError(
      "FREQUENCY_CAP_REACHED",
      "The rolling-window frequency cap is already reached for this contact/channel/purposeClass.",
    );
  }

  const inserted = await tx.contactSendFrequencyEvent.create({
    data: {
      id: randomUUID(),
      ownerId: draft.ownerId,
      contactId: draft.contactId,
      channel: draft.channel,
      purposeClass: draft.purposeClass,
      sourceKind: draft.sourceKind,
      sendRef: draft.sendRef,
      simulated: draft.simulated,
      idempotencyKey: draft.idempotencyKey,
      occurredAt: draft.occurredAt,
      countedAt: new Date(),
    },
  });
  return { duplicate: false, id: inserted.id, countedAt: inserted.countedAt.toISOString() };
}

/**
 * Transaction-composable form used when the caller must commit a send-state CAS and its
 * frequency event atomically. The caller owns the transaction boundary.
 */
export async function recordSendFrequencyEventInTransaction(
  tx: Tx,
  input: RecordSendFrequencyEventInput,
): Promise<RecordSendFrequencyEventResult> {
  return recordFrequencyEventInTransaction(tx, frequencyEventDraft(input));
}

/**
 * The ONLY writer of ContactSendFrequencyEvent (§5.4). Atomic count-and-insert under a
 * per-(ownerId,contactId,channel,purposeClass) advisory transaction lock — same
 * scoped-lock precedent as consent-runtime's STOP fan-out (R-010 §4.3.4) — so two distinct
 * concurrent sends racing for the last cap slot never both count. A retry with the same
 * idempotencyKey is a no-op (zero new rows); a send that never reaches simulated_sent/
 * reached-provider-terminal must never call this at all (untouched sends don't spend cap).
 */
export async function recordSendFrequencyEvent(
  input: RecordSendFrequencyEventInput,
  db: typeof prisma = prisma,
): Promise<RecordSendFrequencyEventResult> {
  const draft = frequencyEventDraft(input);
  try {
    return await db.$transaction((tx) => recordFrequencyEventInTransaction(tx, draft));
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      // PostgreSQL aborts the losing transaction after a unique violation. Recovery must
      // unwind first, then compare the committed winner in a fresh transaction.
      const raced = await db.$transaction((tx) => existingFrequencyEventReplay(tx, draft));
      if (raced) return raced;
    }
    throw error;
  }
}
