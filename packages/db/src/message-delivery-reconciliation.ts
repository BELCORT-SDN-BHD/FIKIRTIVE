import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export const DELIVERY_LIFECYCLES = ["unknown", "accepted", "delivered", "read", "failed"] as const;
export type DeliveryLifecycle = (typeof DELIVERY_LIFECYCLES)[number];

export const RECONCILIATION_STATUSES = ["converged", "pending", "conflict", "timeout_unknown"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

// #719: a member that never had a sending attempt has no provider obligation, so there is
// nothing to reconcile — it is not "pending". Read-time only: never written to
// MessageDeliveryState, whose vocabulary stays RECONCILIATION_STATUSES.
export const RECONCILIATION_NOT_APPLICABLE = "not_applicable";
export type ReconciliationView = ReconciliationStatus | typeof RECONCILIATION_NOT_APPLICABLE;

export type DeliveryReceiptView = {
  logicalSendRef: string;
  channel: string;
  lifecycle: DeliveryLifecycle;
  reconciliation: ReconciliationView;
  simulatedAttempt: boolean;
  lastProviderEventAt: string | null;
  lastReconciledAt: string | null;
  reason?: string;
};

export type DeliveryFactKind = "accepted" | "delivered" | "read" | "failed" | "replied";

export type DeliveryEventForReconciliation = {
  id: string;
  sourceEventKey: string;
  sourcePayloadHash: string;
  factKind: string;
  receivedAt: Date | string;
  occurredAt?: Date | string | null;
};

export type DeliveryStateForReconciliation = {
  lifecycle: string;
  reconciliation: string;
} | null;

export type ReconcileDeliveryInput = {
  logicalSendRef: string;
  channel: string;
  attempted: boolean;
  simulatedAttempt: boolean;
  timeoutAt?: Date | string | null;
  events: readonly DeliveryEventForReconciliation[];
  priorState?: DeliveryStateForReconciliation;
};

export type ReplayClassification = "new" | "duplicate" | "conflict";

export type MessageDeliveryReconciliationDb = PrismaClient | Prisma.TransactionClient;
type ReceiptMember = { id: string; sendState: string };

const FACT_KINDS = new Set<DeliveryFactKind>(["accepted", "delivered", "read", "failed", "replied"]);
const LIFECYCLES = new Set<DeliveryLifecycle>(DELIVERY_LIFECYCLES);

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Delivery timestamps must be finite.");
  return date;
}

function eventOrder(left: DeliveryEventForReconciliation, right: DeliveryEventForReconciliation): number {
  const byTime = asDate(left.receivedAt).getTime() - asDate(right.receivedAt).getTime();
  return byTime || left.id.localeCompare(right.id);
}

function isLifecycle(value: string): value is DeliveryLifecycle {
  return LIFECYCLES.has(value as DeliveryLifecycle);
}

function isFactKind(value: string): value is DeliveryFactKind {
  return FACT_KINDS.has(value as DeliveryFactKind);
}

export function classifyDeliveryEventReplay(
  existing: { sourceEventKey: string; sourcePayloadHash: string } | null,
  incoming: { sourceEventKey: string; sourcePayloadHash: string },
): ReplayClassification {
  if (!existing || existing.sourceEventKey !== incoming.sourceEventKey) return "new";
  return existing.sourcePayloadHash === incoming.sourcePayloadHash ? "duplicate" : "conflict";
}

function hasReachedDelivery(lifecycle: DeliveryLifecycle): boolean {
  return lifecycle === "delivered" || lifecycle === "read";
}

export function reconcileDeliveryReceipt(
  input: ReconcileDeliveryInput,
  clock: () => Date = () => new Date(),
): DeliveryReceiptView {
  const reconciledAt = asDate(clock()).toISOString();
  const ordered = [...input.events].sort(eventOrder);

  // No attempt and no provider fact: nothing was ever owed a receipt. A fact that does exist
  // is still reconciled below, so a real outcome is never hidden behind "not applicable".
  if (!input.attempted && ordered.length === 0) {
    return {
      logicalSendRef: input.logicalSendRef,
      channel: input.channel,
      lifecycle: "unknown",
      reconciliation: RECONCILIATION_NOT_APPLICABLE,
      simulatedAttempt: input.simulatedAttempt,
      lastProviderEventAt: null,
      lastReconciledAt: reconciledAt,
      reason: "NO_SENDING_ATTEMPT",
    };
  }

  const usePrior = ordered.length > 0 && input.priorState && isLifecycle(input.priorState.lifecycle);
  let lifecycle: DeliveryLifecycle = usePrior ? input.priorState!.lifecycle as DeliveryLifecycle : "unknown";
  let conflictReason = usePrior && input.priorState!.reconciliation === "conflict"
    ? "EXISTING_RECONCILIATION_CONFLICT"
    : undefined;
  const seen = new Map<string, string>();

  for (const event of ordered) {
    const priorHash = seen.get(event.sourceEventKey);
    if (priorHash !== undefined) {
      if (priorHash !== event.sourcePayloadHash) conflictReason ??= "SOURCE_EVENT_CONFLICT";
      continue;
    }
    seen.set(event.sourceEventKey, event.sourcePayloadHash);

    if (!isFactKind(event.factKind)) {
      conflictReason ??= "UNRECOGNIZED_DELIVERY_FACT";
      continue;
    }
    if (event.factKind === "replied") continue;
    if (event.factKind === "accepted") {
      if (lifecycle === "unknown") lifecycle = "accepted";
      continue;
    }
    if (event.factKind === "delivered" || event.factKind === "read") {
      if (lifecycle === "failed") {
        conflictReason ??= "MUTUALLY_EXCLUSIVE_TERMINAL_FACTS";
      } else if (event.factKind === "read" || lifecycle === "unknown" || lifecycle === "accepted") {
        lifecycle = event.factKind;
      }
      continue;
    }
    if (hasReachedDelivery(lifecycle)) {
      conflictReason ??= "MUTUALLY_EXCLUSIVE_TERMINAL_FACTS";
    } else if (lifecycle !== "failed") {
      lifecycle = "failed";
    }
  }

  const lastProviderEventAt = ordered.length === 0
    ? null
    : asDate(ordered[ordered.length - 1]!.receivedAt).toISOString();
  const timedOut = input.attempted && !input.simulatedAttempt && !hasReachedDelivery(lifecycle)
    && lifecycle !== "failed" && input.timeoutAt != null
    && asDate(input.timeoutAt).getTime() <= asDate(clock()).getTime();

  if (conflictReason) {
    return {
      logicalSendRef: input.logicalSendRef,
      channel: input.channel,
      lifecycle,
      reconciliation: "conflict",
      simulatedAttempt: input.simulatedAttempt,
      lastProviderEventAt,
      lastReconciledAt: reconciledAt,
      reason: conflictReason,
    };
  }

  if (timedOut) {
    return {
      logicalSendRef: input.logicalSendRef,
      channel: input.channel,
      lifecycle: ordered.length === 0 ? "unknown" : lifecycle,
      reconciliation: "timeout_unknown",
      simulatedAttempt: input.simulatedAttempt,
      lastProviderEventAt,
      lastReconciledAt: reconciledAt,
      reason: "EXTERNAL_RESPONSE_TIMEOUT",
    };
  }

  return {
    logicalSendRef: input.logicalSendRef,
    channel: input.channel,
    lifecycle: ordered.length === 0 ? "unknown" : lifecycle,
    reconciliation: hasReachedDelivery(lifecycle) || lifecycle === "failed" ? "converged" : "pending",
    simulatedAttempt: input.simulatedAttempt,
    lastProviderEventAt,
    lastReconciledAt: reconciledAt,
    ...(ordered.length === 0 && input.simulatedAttempt ? { reason: "SIMULATED_ATTEMPT_NO_EXTERNAL_FACT" } : {}),
  };
}

export type KnownDeliveryMetric = { status: "known"; value: number };
export type UnknownDeliveryMetric = { status: "unknown"; value: null };
export type DeliveryMetric = KnownDeliveryMetric | UnknownDeliveryMetric;

export type DeliveryAxisAggregation = {
  delivery: { delivered: DeliveryMetric; read: DeliveryMetric; failed: DeliveryMetric };
  reconciliation: {
    pending: KnownDeliveryMetric;
    conflict: KnownDeliveryMetric;
    timeoutUnknown: KnownDeliveryMetric;
  };
};

export function aggregateDeliveryAxes(
  receipts: readonly DeliveryReceiptView[],
  simulatedEra: boolean,
): DeliveryAxisAggregation {
  const known = (value: number): KnownDeliveryMetric => ({ status: "known", value });
  const unknown = (): UnknownDeliveryMetric => ({ status: "unknown", value: null });
  const converged = receipts.filter((receipt) => receipt.reconciliation === "converged");
  return {
    delivery: simulatedEra
      ? { delivered: unknown(), read: unknown(), failed: unknown() }
      : {
          delivered: known(converged.filter((receipt) => hasReachedDelivery(receipt.lifecycle)).length),
          read: known(converged.filter((receipt) => receipt.lifecycle === "read").length),
          failed: known(converged.filter((receipt) => receipt.lifecycle === "failed").length),
        },
    reconciliation: {
      pending: known(receipts.filter((receipt) => receipt.reconciliation === "pending").length),
      conflict: known(receipts.filter((receipt) => receipt.reconciliation === "conflict").length),
      timeoutUnknown: known(receipts.filter((receipt) => receipt.reconciliation === "timeout_unknown").length),
    },
  };
}

export function createMessageDeliveryReconciliation(
  db: MessageDeliveryReconciliationDb,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());

  async function readReceipts(
    ownerId: string,
    channel: string,
    members: readonly ReceiptMember[],
  ): Promise<DeliveryReceiptView[]> {
    if (members.length === 0) return [];
    const logicalSendRefs = members.map((member) => member.id);
    const [events, states] = await Promise.all([
      db.messageDeliveryEvent.findMany({
        where: { ownerId, logicalSendRef: { in: logicalSendRefs } },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          logicalSendRef: true,
          sourceEventKey: true,
          sourcePayloadHash: true,
          factKind: true,
          receivedAt: true,
          occurredAt: true,
        },
      }),
      db.messageDeliveryState.findMany({
        where: { ownerId, logicalSendRef: { in: logicalSendRefs } },
        select: { logicalSendRef: true, lifecycle: true, reconciliation: true },
      }),
    ]);
    const stateByRef = new Map(states.map((state) => [state.logicalSendRef, state]));
    return members.map((member) => {
      const memberEvents = events.filter((event) => event.logicalSendRef === member.id);
      return reconcileDeliveryReceipt(
        {
          logicalSendRef: member.id,
          channel,
          attempted: member.sendState === "simulated_sent",
          simulatedAttempt: member.sendState === "simulated_sent",
          events: memberEvents,
          priorState: memberEvents.length > 0 ? stateByRef.get(member.id) ?? null : null,
        },
        clock,
      );
    });
  }

  async function getBroadcastMemberReceipt(
    ownerId: string,
    input: { broadcastRunId: string; audienceMemberId: string },
  ): Promise<DeliveryReceiptView | null> {
    const run = await db.broadcastRun.findFirst({
      where: { id: input.broadcastRunId, ownerId },
      select: { id: true, channel: true },
    });
    if (!run) return null;
    const member = await db.broadcastAudienceMember.findFirst({
      where: { id: input.audienceMemberId, ownerId, broadcastRunId: run.id },
      select: { id: true, sendState: true },
    });
    if (!member) return null;
    return (await readReceipts(ownerId, run.channel, [member]))[0] ?? null;
  }

  return { getBroadcastMemberReceipt, readReceipts };
}
