/**
 * C5-M2 four-axis send-eligibility READ evaluator, plus the sole writer of the frequency
 * rolling-window counter (ContactSendFrequencyEvent). Spec:
 * docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md §4/§5.
 *
 * consent-runtime.ts stays the SOLE writer of consent/DND/provider-refusal facts — this
 * module only fold-reads ConsentStateProjection / Contact.doNotDisturb (the DND compatibility
 * projection consent-runtime already maintains) / ProviderRefusalState. It never writes them.
 * The four axes are evaluated and reported SEPARATELY — never merged into one boolean or a
 * suppression list (§3.2). The `aggregate` field always takes the M1-M3 `unavailable` branch
 * (§4.4): AggregateDisposition only activates once a real send path exists (M4).
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./index.js";

type Tx = Prisma.TransactionClient;
export type SendEligibilityDb = typeof prisma | Tx;

export type SendEligibilityErrorCode =
  | "INVALID_ARGUMENT"
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
 * §4.2.1's 3×2 consent-state × callerClass mapping. Axis `unknown`/`unavailable` is reserved
 * STRICTLY for "projection physically unreadable" — a resolved consent state of "unknown"
 * (fold-null or literal projection state) always maps to `risk`/`block`, never axis-`unknown`.
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
  // state === "unknown": D5-eligible risk for a human, hard block for anything unconfirmed.
  return input.callerClass === "merchant_manual"
    ? axis("risk", "consent_state_projection", checkedAt, "consent_unknown_d5_eligible")
    : axis("block", "consent_state_projection", checkedAt, "consent_unknown_unconfirmed_automatic_hard_block");
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
        where: { ownerId_scopeKey: { ownerId: input.ownerId, scopeKey: recipientScope } },
        select: { blocked: true },
      }),
      db.providerRefusalState.findUnique({
        where: { ownerId_scopeKey: { ownerId: input.ownerId, scopeKey: accountScope } },
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
): Promise<RecordSendFrequencyEventResult> {
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
  const policy = SEND_FREQUENCY_POLICY[channel];
  if (!policy) {
    throw new SendEligibilityError(
      "MISSING_CHANNEL_POLICY",
      `No SEND_FREQUENCY_POLICY entry for channel "${channel}".`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`send-frequency:${ownerId}:${contactId}:${channel}:${input.purposeClass}`}, 0))`;

    const existing = await tx.contactSendFrequencyEvent.findFirst({
      where: { ownerId, idempotencyKey },
      select: { id: true, countedAt: true },
    });
    if (existing) {
      return { duplicate: true, id: existing.id, countedAt: existing.countedAt.toISOString() };
    }

    const windowStart = new Date(Date.now() - policy.windowHours * 60 * 60 * 1000);
    const count = await tx.contactSendFrequencyEvent.count({
      where: {
        ownerId,
        contactId,
        channel,
        purposeClass: input.purposeClass,
        countedAt: { gt: windowStart },
        simulated: input.simulated,
      },
    });
    if (count >= policy.maxProactiveSends) {
      throw new SendEligibilityError(
        "FREQUENCY_CAP_REACHED",
        "The rolling-window frequency cap is already reached for this contact/channel/purposeClass.",
      );
    }

    try {
      const inserted = await tx.contactSendFrequencyEvent.create({
        data: {
          id: randomUUID(),
          ownerId,
          contactId,
          channel,
          purposeClass: input.purposeClass,
          sourceKind: input.sourceKind,
          sendRef,
          simulated: input.simulated,
          idempotencyKey,
          occurredAt: input.occurredAt ?? null,
          countedAt: new Date(),
        },
      });
      return { duplicate: false, id: inserted.id, countedAt: inserted.countedAt.toISOString() };
    } catch (error) {
      if (prismaCode(error) === "P2002") {
        // The advisory lock serializes same-key writers, so this should be unreachable in
        // practice; stay defensive and replay rather than surface a spurious constraint error.
        const raced = await tx.contactSendFrequencyEvent.findFirstOrThrow({
          where: { ownerId, idempotencyKey },
        });
        return { duplicate: true, id: raced.id, countedAt: raced.countedAt.toISOString() };
      }
      throw error;
    }
  });
}
