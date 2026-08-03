import "server-only";

import { effectiveOrgRoles, orgRolesAllow } from "@fikirtive/core";

import {
  aggregateDeliveryAxes,
  createMessageDeliveryReconciliation,
  type DeliveryReceiptView,
  type KnownDeliveryMetric,
  type MessageDeliveryReconciliationDb,
} from "@fikirtive/db";

export const CUSTOMER_BROADCAST_REPORT_ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  ACTION_DENIED: "ACTION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
} as const;

export type CustomerBroadcastReportErrorCode =
  (typeof CUSTOMER_BROADCAST_REPORT_ERROR_CODES)[keyof typeof CUSTOMER_BROADCAST_REPORT_ERROR_CODES];

export class CustomerBroadcastReportError extends Error {
  constructor(public readonly code: CustomerBroadcastReportErrorCode) {
    super(code);
    this.name = "CustomerBroadcastReportError";
  }
}

export type CustomerBroadcastReportPrincipal = {
  ownerId: string;
  membershipId: string;
  impersonating?: boolean;
};

export type BroadcastDeliveryReceiptInput = {
  broadcastRunId: string;
  audienceMemberId: string;
};

export type CustomerBroadcastReportInput = {
  broadcastRunId: string;
  contactId?: string;
};

export type CustomerBroadcastReport = {
  broadcastRunId: string;
  contactId: string | null;
  simulatedEra: true;
  sending: {
    authority: "C5_BROADCAST_AUDIENCE_MEMBER";
    freshness: { lastDataLoadedAt: string };
    attempted: KnownDeliveryMetric;
    pending: KnownDeliveryMetric;
    skipped: KnownDeliveryMetric & { byReason: Record<string, number> };
    unavailable: KnownDeliveryMetric;
  };
  delivery: {
    authority: "C6_MESSAGE_DELIVERY_STATE";
    freshness: { lastProviderEventAt: string | null; lastDataLoadedAt: string };
    delivered: { status: "unknown"; value: null };
    read: { status: "unknown"; value: null };
    failed: { status: "unknown"; value: null };
  };
  reconciliation: {
    authority: "C6_RECONCILIATION";
    freshness: { lastReconciledAt: string | null; lastDataLoadedAt: string };
    pending: KnownDeliveryMetric;
    conflict: KnownDeliveryMetric;
    timeoutUnknown: KnownDeliveryMetric;
  };
  replyRate: { status: "deferred"; value: null };
};

const MAX_TEXT = 512;

function fail(code: CustomerBroadcastReportErrorCode): never {
  throw new CustomerBroadcastReportError(code);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("INVALID_ARGUMENT");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) fail("INVALID_ARGUMENT");
  return record;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT) {
    fail("INVALID_ARGUMENT");
  }
  return value.trim();
}

function maxTimestamp(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

export function createCustomerBroadcastReportService(
  db: MessageDeliveryReconciliationDb,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  const reconciliation = createMessageDeliveryReconciliation(db, { clock });

  async function requireBroadcastRead(principal: CustomerBroadcastReportPrincipal): Promise<void> {
    if (!principal || typeof principal.ownerId !== "string" || typeof principal.membershipId !== "string") {
      fail("NOT_AUTHORIZED");
    }
    const membership = await db.membership.findFirst({
      where: {
        id: principal.membershipId,
        orgId: principal.ownerId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true, roles: { select: { role: true } } },
    });
    const roles = effectiveOrgRoles(
      (membership?.roles ?? []).map((assignment) => assignment.role),
    );
    if (!orgRolesAllow(roles, "broadcast.report.read") || principal.impersonating) {
      fail("ACTION_DENIED");
    }
  }

  function receiptInput(value: unknown): BroadcastDeliveryReceiptInput {
    const input = exactObject(value, ["broadcastRunId", "audienceMemberId"]);
    return {
      broadcastRunId: requiredString(input.broadcastRunId),
      audienceMemberId: requiredString(input.audienceMemberId),
    };
  }

  function reportInput(value: unknown): Required<CustomerBroadcastReportInput> {
    const input = exactObject(value, ["broadcastRunId", "contactId"]);
    return {
      broadcastRunId: requiredString(input.broadcastRunId),
      contactId: input.contactId === undefined ? "" : requiredString(input.contactId),
    };
  }

  async function getBroadcastDeliveryReceipt(
    principal: CustomerBroadcastReportPrincipal,
    rawInput: BroadcastDeliveryReceiptInput,
  ): Promise<DeliveryReceiptView> {
    await requireBroadcastRead(principal);
    const input = receiptInput(rawInput);
    const receipt = await reconciliation.getBroadcastMemberReceipt(principal.ownerId, input);
    if (!receipt) fail("RESOURCE_NOT_FOUND");
    return receipt;
  }

  async function getCustomerBroadcastReport(
    principal: CustomerBroadcastReportPrincipal,
    rawInput: CustomerBroadcastReportInput,
  ): Promise<CustomerBroadcastReport> {
    await requireBroadcastRead(principal);
    const input = reportInput(rawInput);
    const run = await db.broadcastRun.findFirst({
      where: { id: input.broadcastRunId, ownerId: principal.ownerId },
      select: { id: true, channel: true },
    });
    if (!run) fail("RESOURCE_NOT_FOUND");

    if (input.contactId) {
      const contact = await db.contact.findFirst({
        where: { id: input.contactId, ownerId: principal.ownerId },
        select: { id: true },
      });
      if (!contact) fail("RESOURCE_NOT_FOUND");
    }

    const members = await db.broadcastAudienceMember.findMany({
      where: {
        ownerId: principal.ownerId,
        broadcastRunId: run.id,
        ...(input.contactId ? { contactId: input.contactId } : {}),
      },
      orderBy: [{ id: "asc" }],
      select: { id: true, sendState: true, skipReason: true },
    });
    const attemptedMembers = members.filter((member) => member.sendState === "simulated_sent");
    const receipts = await reconciliation.readReceipts(principal.ownerId, run.channel, attemptedMembers);
    const axes = aggregateDeliveryAxes(receipts, true);
    const loadedAt = new Date(clock().getTime()).toISOString();
    const byReason: Record<string, number> = {};
    for (const member of members) {
      if (member.sendState !== "skipped_ineligible") continue;
      const reason = member.skipReason ?? "UNKNOWN_SKIP_REASON";
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    const known = (value: number): KnownDeliveryMetric => ({ status: "known", value });

    return {
      broadcastRunId: run.id,
      contactId: input.contactId || null,
      simulatedEra: true,
      sending: {
        authority: "C5_BROADCAST_AUDIENCE_MEMBER",
        freshness: { lastDataLoadedAt: loadedAt },
        attempted: known(attemptedMembers.length),
        pending: known(members.filter((member) => member.sendState === "pending").length),
        skipped: {
          ...known(members.filter((member) => member.sendState === "skipped_ineligible").length),
          byReason,
        },
        unavailable: known(members.filter((member) => member.sendState === "send_unavailable").length),
      },
      delivery: {
        authority: "C6_MESSAGE_DELIVERY_STATE",
        freshness: {
          lastProviderEventAt: maxTimestamp(receipts.map((receipt) => receipt.lastProviderEventAt)),
          lastDataLoadedAt: loadedAt,
        },
        delivered: { status: "unknown", value: null },
        read: { status: "unknown", value: null },
        failed: { status: "unknown", value: null },
      },
      reconciliation: {
        authority: "C6_RECONCILIATION",
        freshness: {
          lastReconciledAt: maxTimestamp(receipts.map((receipt) => receipt.lastReconciledAt)),
          lastDataLoadedAt: loadedAt,
        },
        ...axes.reconciliation,
      },
      replyRate: { status: "deferred", value: null },
    };
  }

  return { getBroadcastDeliveryReceipt, getCustomerBroadcastReport };
}
