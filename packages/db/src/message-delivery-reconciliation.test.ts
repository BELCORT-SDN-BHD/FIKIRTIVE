import { describe, expect, it } from "vitest";
import {
  aggregateDeliveryAxes,
  classifyDeliveryEventReplay,
  reconcileDeliveryReceipt,
  type DeliveryEventForReconciliation,
  type DeliveryReceiptView,
  type DeliveryStateForReconciliation,
} from "./message-delivery-reconciliation.js";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const clock = () => NOW;

function event(
  id: string,
  factKind: string,
  receivedAt: string,
  occurredAt = receivedAt,
  sourceEventKey = id,
  sourcePayloadHash = `hash-${id}`,
): DeliveryEventForReconciliation {
  return { id, factKind, receivedAt, occurredAt, sourceEventKey, sourcePayloadHash };
}

function reconcile(
  events: readonly DeliveryEventForReconciliation[],
  priorState: DeliveryStateForReconciliation = null,
) {
  return reconcileDeliveryReceipt(
    {
      logicalSendRef: "member-1",
      channel: "whatsapp",
      attempted: true,
      simulatedAttempt: false,
      events,
      priorState,
    },
    clock,
  );
}

describe("C6-M2 replay placeholder", () => {
  it("classifies a fresh fact, an exact duplicate, and a same-key hash conflict without writing", () => {
    const existing = { sourceEventKey: "delivery:1", sourcePayloadHash: "v1:aaa" };
    expect(classifyDeliveryEventReplay(null, existing)).toBe("new");
    expect(classifyDeliveryEventReplay(existing, { ...existing })).toBe("duplicate");
    expect(classifyDeliveryEventReplay(existing, { ...existing, sourcePayloadHash: "v1:bbb" })).toBe("conflict");
  });

  it("deduplicates same-key/same-hash and exposes same-key/different-hash only on the reconciliation axis", () => {
    const accepted = event("a", "accepted", "2026-07-22T09:00:00.000Z", undefined, "delivery:1", "v1:aaa");
    expect(reconcile([accepted, { ...accepted, id: "b" }])).toMatchObject({
      lifecycle: "accepted",
      reconciliation: "pending",
    });
    expect(reconcile([accepted, { ...accepted, id: "b", sourcePayloadHash: "v1:bbb", factKind: "read" }])).toMatchObject({
      lifecycle: "accepted",
      reconciliation: "conflict",
      reason: "SOURCE_EVENT_CONFLICT",
    });
  });
});

describe("C6-M2 canonical order and truthful unknown", () => {
  it("uses receivedAt plus stable id, not occurredAt, and never regresses a reached lifecycle", () => {
    const result = reconcile([
      event("z", "accepted", "2026-07-22T09:02:00.000Z", "2026-07-22T08:00:00.000Z"),
      event("a", "read", "2026-07-22T09:01:00.000Z", "2026-07-22T11:00:00.000Z"),
    ]);
    expect(result).toMatchObject({ lifecycle: "read", reconciliation: "converged" });
    expect(result.lastProviderEventAt).toBe("2026-07-22T09:02:00.000Z");
  });

  it("ignores a stale projection when the event table is empty", () => {
    const result = reconcileDeliveryReceipt(
      {
        logicalSendRef: "member-simulated",
        channel: "whatsapp",
        attempted: true,
        simulatedAttempt: true,
        events: [],
        priorState: { lifecycle: "read", reconciliation: "converged" },
      },
      clock,
    );
    expect(result).toMatchObject({
      lifecycle: "unknown",
      reconciliation: "pending",
      simulatedAttempt: true,
      lastProviderEventAt: null,
    });
  });

  it("uses the fake clock and an explicit elapsed deadline for timeout_unknown without claiming a terminal result", () => {
    const result = reconcileDeliveryReceipt(
      {
        logicalSendRef: "member-timeout",
        channel: "whatsapp",
        attempted: true,
        simulatedAttempt: false,
        timeoutAt: "2026-07-22T09:59:59.000Z",
        events: [],
      },
      clock,
    );
    expect(result).toMatchObject({ lifecycle: "unknown", reconciliation: "timeout_unknown" });
  });
});

describe("C6-M2 terminal conflict placeholder", () => {
  it("keeps delivered stable when failed arrives later", () => {
    expect(reconcile([
      event("a", "delivered", "2026-07-22T09:00:00.000Z"),
      event("b", "failed", "2026-07-22T09:01:00.000Z"),
    ])).toMatchObject({ lifecycle: "delivered", reconciliation: "conflict" });
  });

  it("keeps failed stable when delivered arrives later", () => {
    expect(reconcile([
      event("a", "failed", "2026-07-22T09:00:00.000Z"),
      event("b", "delivered", "2026-07-22T09:01:00.000Z"),
    ])).toMatchObject({ lifecycle: "failed", reconciliation: "conflict" });
  });

  it("does not silently clear an existing conflict while terminal selection remains deferred", () => {
    expect(reconcile(
      [event("a", "accepted", "2026-07-22T09:02:00.000Z")],
      { lifecycle: "delivered", reconciliation: "conflict" },
    )).toMatchObject({
      lifecycle: "delivered",
      reconciliation: "conflict",
      reason: "EXISTING_RECONCILIATION_CONFLICT",
    });
  });
});

describe("C6-M2 orthogonal report aggregation", () => {
  const receipt = (
    logicalSendRef: string,
    lifecycle: DeliveryReceiptView["lifecycle"],
    reconciliation: DeliveryReceiptView["reconciliation"],
  ): DeliveryReceiptView => ({
    logicalSendRef,
    channel: "whatsapp",
    lifecycle,
    reconciliation,
    simulatedAttempt: false,
    lastProviderEventAt: NOW.toISOString(),
    lastReconciledAt: NOW.toISOString(),
  });

  it("counts only converged rows in B while keeping pending/conflict/timeout independent in C", () => {
    const receipts = [
      receipt("read", "read", "converged"),
      receipt("failed", "failed", "converged"),
      receipt("conflict", "read", "conflict"),
      receipt("timeout", "delivered", "timeout_unknown"),
      receipt("pending", "accepted", "pending"),
    ];
    expect(aggregateDeliveryAxes(receipts, false)).toEqual({
      delivery: {
        delivered: { status: "known", value: 1 },
        read: { status: "known", value: 1 },
        failed: { status: "known", value: 1 },
      },
      reconciliation: {
        pending: { status: "known", value: 1 },
        conflict: { status: "known", value: 1 },
        timeoutUnknown: { status: "known", value: 1 },
      },
    });
  });

  it("never replaces simulated-era unknown delivery metrics with numeric zero", () => {
    expect(aggregateDeliveryAxes([], true).delivery).toEqual({
      delivered: { status: "unknown", value: null },
      read: { status: "unknown", value: null },
      failed: { status: "unknown", value: null },
    });
  });
});
