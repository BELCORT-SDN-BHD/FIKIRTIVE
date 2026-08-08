/** Pure R-010 consent/DND/provider-refusal validation and replay folds. */

export const CONSENT_PURPOSES = ["marketing", "review_request", "transactional"] as const;
export const PROACTIVE_NON_TRANSACTIONAL_PURPOSES = ["marketing", "review_request"] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentAction = "grant" | "revoke";
export type ConsentActorKind = "customer" | "merchant" | "legacy_unknown";
export type ConsentEntryMode = "interactive" | "backfill";
export type ConsentEvidenceStatus = "verified" | "asserted" | "unresolved";
export type ConsentSourceKind =
  | "explicit_inbox_optin"
  | "unsubscribe_link"
  | "resubscribe_link"
  | "stop_keyword"
  | "start_keyword"
  | "double_optin"
  | "crm_manual"
  | "import"
  | "legacy_contact_snapshot"
  | "historical_verified_revoke"
  | "historical_verified_stop"
  | "stop_purpose_expansion";
export type ConsentState = "unknown" | "verified_grant" | "effective_revoke";

export type ConsentRuntimeErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_WRITER_COMBINATION"
  | "IDEMPOTENCY_CONFLICT"
  | "TENANT_RESOURCE_NOT_FOUND"
  | "ACTIVE_BLOCK_REQUIRED"
  | "REPLAY_INTEGRITY"
  | "D5_DEFERRED";

export class ConsentRuntimeError extends Error {
  readonly code: ConsentRuntimeErrorCode;

  constructor(code: ConsentRuntimeErrorCode, message: string) {
    super(message);
    this.name = "ConsentRuntimeError";
    this.code = code;
  }
}

type ConsentWriterRule = {
  actions: readonly ConsentAction[];
  actorKind: ConsentActorKind;
  entryMode: ConsentEntryMode;
  evidenceStatus: ConsentEvidenceStatus;
};

export const CONSENT_WRITER_RULES: Readonly<Record<ConsentSourceKind, ConsentWriterRule>> = {
  explicit_inbox_optin: {
    actions: ["grant"],
    actorKind: "customer",
    entryMode: "interactive",
    evidenceStatus: "verified",
  },
  unsubscribe_link: {
    actions: ["revoke"],
    actorKind: "customer",
    entryMode: "interactive",
    evidenceStatus: "verified",
  },
  resubscribe_link: {
    actions: ["grant"],
    actorKind: "customer",
    entryMode: "interactive",
    evidenceStatus: "verified",
  },
  stop_keyword: {
    actions: ["revoke"],
    actorKind: "customer",
    entryMode: "interactive",
    evidenceStatus: "verified",
  },
  start_keyword: {
    actions: ["grant"],
    actorKind: "customer",
    entryMode: "interactive",
    evidenceStatus: "verified",
  },
  double_optin: {
    actions: ["grant"],
    actorKind: "customer",
    entryMode: "interactive",
    evidenceStatus: "verified",
  },
  crm_manual: {
    actions: ["grant", "revoke"],
    actorKind: "merchant",
    entryMode: "backfill",
    evidenceStatus: "asserted",
  },
  import: {
    actions: ["grant", "revoke"],
    actorKind: "merchant",
    entryMode: "backfill",
    evidenceStatus: "asserted",
  },
  legacy_contact_snapshot: {
    actions: ["grant", "revoke"],
    actorKind: "legacy_unknown",
    entryMode: "backfill",
    evidenceStatus: "unresolved",
  },
  historical_verified_revoke: {
    actions: ["revoke"],
    actorKind: "customer",
    entryMode: "backfill",
    evidenceStatus: "verified",
  },
  historical_verified_stop: {
    actions: ["revoke"],
    actorKind: "customer",
    entryMode: "backfill",
    evidenceStatus: "verified",
  },
  stop_purpose_expansion: {
    actions: ["revoke"],
    actorKind: "customer",
    entryMode: "backfill",
    evidenceStatus: "verified",
  },
};

export type ConsentWriterCombination = {
  sourceKind: string;
  action: string;
  actorKind: string;
  entryMode: string;
  evidenceStatus: string;
};

export function validateConsentWriterCombination(
  combination: ConsentWriterCombination,
): asserts combination is ConsentWriterCombination & {
  sourceKind: ConsentSourceKind;
  action: ConsentAction;
  actorKind: ConsentActorKind;
  entryMode: ConsentEntryMode;
  evidenceStatus: ConsentEvidenceStatus;
} {
  const rule = CONSENT_WRITER_RULES[combination.sourceKind as ConsentSourceKind];
  if (
    !rule ||
    !(rule.actions as readonly string[]).includes(combination.action) ||
    rule.actorKind !== combination.actorKind ||
    rule.entryMode !== combination.entryMode ||
    rule.evidenceStatus !== combination.evidenceStatus
  ) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "The consent event source, action, actor, entry mode, and evidence status are not an R-010 closed writer combination.",
    );
  }
}

export type OrderedConsentEvent = {
  id: string;
  receivedAt: string;
  action: ConsentAction;
  actorKind: ConsentActorKind;
  entryMode: ConsentEntryMode;
  sourceKind: ConsentSourceKind;
  evidenceStatus: ConsentEvidenceStatus;
};

export type ConsentFoldResult = {
  state: ConsentState;
  lastEventId: string;
  lastReceivedAt: string;
  stateActorKind: ConsentActorKind;
  stateSourceKind: ConsentSourceKind;
  evidenceStatus: ConsentEvidenceStatus;
  stateEventId: string | null;
};

function compareOrderedEvents(
  left: { receivedAt: string; id: string },
  right: { receivedAt: string; id: string },
): number {
  const timestampOrder = left.receivedAt.localeCompare(right.receivedAt);
  return timestampOrder === 0 ? left.id.localeCompare(right.id) : timestampOrder;
}

export function foldConsentEvents(events: readonly OrderedConsentEvent[]): ConsentFoldResult | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort(compareOrderedEvents);
  let state: ConsentState = "unknown";
  let stateEvent: OrderedConsentEvent | null = null;
  let hasVerifiedInteractive = false;

  for (const event of ordered) {
    validateConsentWriterCombination(event);
    const interactive =
      event.evidenceStatus === "verified" &&
      event.actorKind === "customer" &&
      event.entryMode === "interactive";
    if (interactive) {
      state = event.action === "grant" ? "verified_grant" : "effective_revoke";
      stateEvent = event;
      hasVerifiedInteractive = true;
      continue;
    }

    const verifiedRevokeBaseline =
      event.evidenceStatus === "verified" &&
      event.actorKind === "customer" &&
      event.entryMode === "backfill" &&
      event.action === "revoke" &&
      (event.sourceKind === "historical_verified_revoke" ||
        event.sourceKind === "historical_verified_stop" ||
        event.sourceKind === "stop_purpose_expansion");
    if (verifiedRevokeBaseline && !hasVerifiedInteractive) {
      state = "effective_revoke";
      stateEvent = event;
    }
  }

  const last = ordered[ordered.length - 1];
  if (!last) return null;
  const stateReason = stateEvent ?? last;
  return {
    state,
    lastEventId: last.id,
    lastReceivedAt: last.receivedAt,
    stateActorKind: stateReason.actorKind,
    stateSourceKind: stateReason.sourceKind,
    evidenceStatus: stateReason.evidenceStatus,
    stateEventId: stateEvent?.id ?? null,
  };
}

export type ContactConsentCompatibility = {
  marketingConsent: "unknown" | "opt_in" | "opt_out";
  consentSource: string | null;
  consentAtEventId: string | null;
};

export function contactConsentCompatibility(fold: ConsentFoldResult): ContactConsentCompatibility {
  if (fold.state === "unknown") {
    return { marketingConsent: "unknown", consentSource: null, consentAtEventId: null };
  }
  return {
    marketingConsent: fold.state === "verified_grant" ? "opt_in" : "opt_out",
    consentSource: `consent_event:${fold.stateSourceKind}`,
    consentAtEventId: fold.stateEventId,
  };
}

/**
 * #716 / #726 / #806 — the single predicate deciding whether a contact has opted out.
 *
 * It lived in apps/web/lib/consent-authority.ts until #806, where the send-eligibility engine
 * (this package) turned out to need the very same reading: it read ConsentStateProjection alone,
 * so a contact held out of every audience by the pre-ledger fence still reached the send gate as
 * plain "unknown consent". A second copy of the rule down here would be exactly the two-answers
 * defect #716 closed, so the rule moved down instead and consent-authority.ts re-exports it —
 * every existing call site is unchanged and there is still one definition.
 *
 * The reading carries THREE separate facts, and they are never collapsed into one:
 *  - `state` — the verified consent state. Only `effective_revoke` is a verified opt-out.
 *  - `unresolvedLegacyOptOut` — an opt-out recorded before this contact had a consent history.
 *  - `reportedOptOut` — the merchant's OWN latest record says "opted out". R-010 keeps this out
 *    of the verified state on purpose: a merchant assertion is not customer-verified evidence
 *    (#496, Founder's option B). It is surfaced, never silently folded into "unknown".
 */

/**
 * Every consent surface a merchant can reach today — the contact profile's opt-out control, CSV
 * import, the contacts list badge — writes and reads this one scope. Segment selection has no
 * channel or purpose of its own, so it reads the same scope those pages display; a broadcast and
 * the send-eligibility engine read their own run's channel + purpose through the same functions.
 *
 * R-010 §4.6.1 also fixes this as the ONLY scope the legacy `Contact.marketingConsent` column
 * mirrors, which is why the pre-ledger fence below is scoped to it and to nothing else.
 */
export const CRM_CONSENT_SCOPE = { channel: "whatsapp", purpose: "marketing" } as const;

export type ConsentScope = { channel: string; purpose: string };

export type ContactConsentTruth = {
  /** Verified R-010 state folded from the consent ledger. */
  state: ConsentState;
  /**
   * An opt-out that predates this contact's consent history and nothing has resolved since
   * (R-010 §4.6.5). It holds the contact OUT of every audience until the customer's own verified
   * evidence supersedes it. See `contactConsentTruth`.
   */
  unresolvedLegacyOptOut: boolean;
  /** The merchant's own latest record says "opted out" — recorded, not verified. */
  reportedOptOut: boolean;
};

/** No consent record of any kind exists for this contact in this scope. */
export const NO_CONSENT_RECORD: ContactConsentTruth = {
  state: "unknown",
  unresolvedLegacyOptOut: false,
  reportedOptOut: false,
};

/** The one definition of "known opt-out" — shared by segment selection, freeze, send and display. */
export function isKnownOptOut(truth: ContactConsentTruth): boolean {
  return truth.state === "effective_revoke" || truth.unresolvedLegacyOptOut;
}

/**
 * The pre-ledger fence (R-010 §4.6.5): a `Contact.marketingConsent` of `opt_out` that the
 * consent ledger has not yet reached is a KNOWN historical revoke, and R-010 forbids losing it
 * silently in the cutover. Until the tuple is resolved one contact at a time, it is fail-closed:
 * the customer stays out.
 *
 * Fail-closed means the merchant's own newer assertion cannot release it either — re-recording
 * an opt-out, or asserting an opt-in, both leave the state `unknown` and the fence standing.
 * Only the customer's own verified evidence (an opt-in through their channel, folding to
 * `verified_grant`) supersedes the stale byte, which is exactly R-010 §4.6.4's rule that a
 * historical baseline is neutral once a newer interactive stance covers it.
 *
 * Scoped to whatsapp+marketing because that is the only tuple the legacy column mirrors
 * (R-010 §4.6.1); for any other channel or purpose the column carries no meaning and is not read.
 */
export function contactConsentTruth(
  projected: ContactConsentTruth | undefined,
  legacyMarketingConsent: string | null | undefined,
  scope: ConsentScope = CRM_CONSENT_SCOPE,
): ContactConsentTruth {
  const truth = projected ?? NO_CONSENT_RECORD;
  const fenced =
    truth.state === "unknown" &&
    legacyMarketingConsent === "opt_out" &&
    scope.channel === CRM_CONSENT_SCOPE.channel &&
    scope.purpose === CRM_CONSENT_SCOPE.purpose;
  return fenced ? { ...truth, unresolvedLegacyOptOut: true } : truth;
}

export type DndAction = "set" | "clear";
export type DndActorKind = "merchant" | "otto" | "legacy_migration";
export type DndSourceKind = "crm_ui" | "otto_approved_action" | "legacy_contact_snapshot";

export type DndWriterCombination = {
  sourceKind: string;
  actorKind: string;
  action: string;
};

export function validateDndWriterCombination(
  combination: DndWriterCombination,
): asserts combination is DndWriterCombination & {
  sourceKind: DndSourceKind;
  actorKind: DndActorKind;
  action: DndAction;
} {
  const valid =
    (combination.sourceKind === "crm_ui" &&
      combination.actorKind === "merchant" &&
      (combination.action === "set" || combination.action === "clear")) ||
    (combination.sourceKind === "otto_approved_action" &&
      combination.actorKind === "otto" &&
      (combination.action === "set" || combination.action === "clear")) ||
    (combination.sourceKind === "legacy_contact_snapshot" &&
      combination.actorKind === "legacy_migration" &&
      combination.action === "set");
  if (!valid) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "The DND source, actor, and action are not an R-010 closed writer combination.",
    );
  }
}

export type OrderedDndEvent = {
  id: string;
  receivedAt: string;
  action: DndAction;
  actorKind: DndActorKind;
  sourceKind: DndSourceKind;
};

export type DndFoldResult = {
  doNotDisturb: boolean;
  lastEventId: string;
  lastReceivedAt: string;
};

export function foldDndEvents(events: readonly OrderedDndEvent[]): DndFoldResult | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort(compareOrderedEvents);
  let doNotDisturb = false;
  for (const event of ordered) {
    validateDndWriterCombination(event);
    doNotDisturb = event.action === "set";
  }
  const last = ordered[ordered.length - 1];
  if (!last) return null;
  return { doNotDisturb, lastEventId: last.id, lastReceivedAt: last.receivedAt };
}

export type ProviderRefusalKind = "permanent_recipient" | "transient" | "account_level";
export type ProviderRefusalAction = "block" | "observe" | "clear" | "expire";
export type ProviderRefusalActorKind = "provider" | "system";

export type ProviderRefusalWriterCombination = {
  kind: string;
  action: string;
  actorKind: string;
  hasChannel: boolean;
  hasContactIdentity: boolean;
  hasExpiresAt: boolean;
  hasReversesEventId: boolean;
};

export function validateProviderRefusalWriterCombination(
  combination: ProviderRefusalWriterCombination,
): void {
  const recipientTarget = combination.hasChannel && combination.hasContactIdentity;
  const accountTarget = !combination.hasChannel && !combination.hasContactIdentity;
  let valid = false;

  if (combination.kind === "permanent_recipient") {
    valid =
      recipientTarget &&
      combination.actorKind === "provider" &&
      !combination.hasExpiresAt &&
      ((combination.action === "block" && !combination.hasReversesEventId) ||
        (combination.action === "clear" && combination.hasReversesEventId));
  } else if (combination.kind === "account_level") {
    valid =
      accountTarget &&
      ((combination.actorKind === "provider" &&
        combination.action === "block" &&
        !combination.hasReversesEventId) ||
        (combination.actorKind === "provider" &&
          combination.action === "clear" &&
          !combination.hasExpiresAt &&
          combination.hasReversesEventId) ||
        (combination.actorKind === "system" &&
          combination.action === "expire" &&
          combination.hasExpiresAt &&
          combination.hasReversesEventId));
  } else if (combination.kind === "transient") {
    valid =
      (recipientTarget || accountTarget) &&
      combination.action === "observe" &&
      combination.actorKind === "provider" &&
      !combination.hasExpiresAt &&
      !combination.hasReversesEventId;
  }

  if (!valid) {
    throw new ConsentRuntimeError(
      "INVALID_WRITER_COMBINATION",
      "The provider-refusal target, kind, action, actor, expiry, and reversal are not an R-010 closed writer combination.",
    );
  }
}

export type OrderedProviderRefusalEvent = {
  id: string;
  receivedAt: string;
  kind: ProviderRefusalKind;
  action: ProviderRefusalAction;
  actorKind: ProviderRefusalActorKind;
  reversesEventId: string | null;
  expiresAt: string | null;
  channel: string | null;
  contactIdentityId: string | null;
};

export type ProviderRefusalFoldResult = {
  blocked: boolean;
  activeBlockEventId: string | null;
  lastEventId: string;
  lastReceivedAt: string;
};

export function foldProviderRefusalEvents(
  events: readonly OrderedProviderRefusalEvent[],
): ProviderRefusalFoldResult | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort(compareOrderedEvents);
  let activeBlockEventId: string | null = null;

  for (const event of ordered) {
    validateProviderRefusalWriterCombination({
      kind: event.kind,
      action: event.action,
      actorKind: event.actorKind,
      hasChannel: event.channel !== null,
      hasContactIdentity: event.contactIdentityId !== null,
      hasExpiresAt: event.expiresAt !== null,
      hasReversesEventId: event.reversesEventId !== null,
    });
    if (event.action === "block") {
      activeBlockEventId = event.id;
    } else if (event.action === "clear" || event.action === "expire") {
      if (activeBlockEventId === null || event.reversesEventId !== activeBlockEventId) {
        throw new ConsentRuntimeError(
          "REPLAY_INTEGRITY",
          "A provider-refusal clear or expire event does not reference the active same-scope block.",
        );
      }
      activeBlockEventId = null;
    }
  }

  const last = ordered[ordered.length - 1];
  if (!last) return null;
  return {
    blocked: activeBlockEventId !== null,
    activeBlockEventId,
    lastEventId: last.id,
    lastReceivedAt: last.receivedAt,
  };
}

/** D5 carriers/runtime are intentionally absent from this batch. */
export function failClosedD5Override(): never {
  throw new ConsentRuntimeError(
    "D5_DEFERRED",
    "D5 two-confirm consent override carriers and runtime are not implemented or available.",
  );
}
