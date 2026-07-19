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
